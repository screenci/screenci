import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { existsSync, readFileSync, realpathSync, rmSync } from 'fs'
import { appendFile, copyFile, mkdir, readFile, writeFile } from 'fs/promises'
import { basename, delimiter, dirname, relative, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { Command, CommanderError } from 'commander'
import { input } from '@inquirer/prompts'
import ora from 'ora'
import pc from 'picocolors'
import { logger } from './logger.js'
import {
  getScreenCISecretsUrl,
  looksLikeScreenCISecret,
  persistScreenCISecret,
  verifyScreenCISecret,
} from './linkSession.js'
import { SCREENCI_TERMS_URL } from './anonSession.js'

const PLAYWRIGHT_TEST_VERSION = '^1.59.0'
const PLAYWRIGHT_CLI_VERSION = 'latest'
const NODE_TYPES_VERSION = '^25.9.1'
const REACT_VERSION = '^19.0.0'
const REACT_DOM_VERSION = '^19.0.0'
const REACT_TYPES_VERSION = '^19.0.0'
const REACT_DOM_TYPES_VERSION = '^19.0.0'
export type PackageManager = 'npm' | 'pnpm' | 'yarn'

export type InitOptions = {
  verbose: boolean
  yes: boolean
  packageManager: PackageManager
  agent?: string
  // Each optional flag defaults to the "accept" behavior when left unset, so the
  // init wizard stays low-friction. They exist so scripts / CI can opt out of an
  // auto-applied default without dropping to a fully interactive session.
  githubWorkflow?: boolean // --no-github-workflow -> false
  skills?: boolean // --no-skills -> false (skips both AI skills + their prompt)
  playwrightCli?: boolean // --no-playwright-cli -> false
  react?: boolean // --no-react -> false
  playwrightBrowsers?: boolean // --no-playwright-browsers -> false
  playwrightOsDeps?: boolean // --playwright-os-deps -> true
}

const MIN_SUPPORTED_PNPM_VERSION = '10.26.0'
const MIN_SUPPORTED_YARN_VERSION = '2.0.0'

export type YarnVersionSupport = {
  supported: boolean
  detectedVersion?: string
  reason:
    | 'supported'
    | 'yarn-not-found'
    | 'malformed-version'
    | 'version-too-old'
}

export type PnpmVersionSupport = {
  supported: boolean
  detectedVersion?: string
  reason:
    | 'supported'
    | 'pnpm-not-found'
    | 'malformed-version'
    | 'version-too-old'
}

export function detectPackageManagerFromLockfile(
  dir: string
): PackageManager | null {
  let current = dir
  while (true) {
    if (existsSync(resolve(current, 'pnpm-lock.yaml'))) return 'pnpm'
    if (existsSync(resolve(current, 'yarn.lock'))) return 'yarn'
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

export function detectPackageManagerFromPackageJson(
  dir: string
): PackageManager | null {
  try {
    const raw = readFileSync(resolve(dir, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as { packageManager?: unknown }
    const pm = pkg.packageManager
    if (typeof pm !== 'string') return null
    if (pm.startsWith('pnpm')) return 'pnpm'
    if (pm.startsWith('yarn')) return 'yarn'
    if (pm.startsWith('npm')) return 'npm'
  } catch {
    // ignore missing or unparseable package.json
  }
  return null
}

export function determinePackageManager(cwd?: string): PackageManager {
  // 1. The package manager that spawned the process is explicit intent
  //    (`pnpm create screenci`, `yarn create screenci`, `npm init screenci`) and
  //    always wins — including npm, so `npm init` gives an npm island even in a
  //    pnpm/yarn repo. Check pnpm/yarn before npm because their user-agent
  //    strings also contain an `npm/...` segment.
  const userAgent = process.env.npm_config_user_agent
  if (userAgent?.includes('pnpm')) return 'pnpm'
  if (userAgent?.includes('yarn')) return 'yarn'
  if (userAgent?.includes('npm')) return 'npm'

  // 2. No package-manager wrapper set a user agent (e.g. a global or direct
  //    `screenci init`). Fall back to the surrounding repo's toolchain so the
  //    island matches it, then to npm. Pass `--package-manager` to override.
  //    (record/test pass no cwd and rely solely on the user agent.)
  if (cwd !== undefined) {
    const fromLockfile = detectPackageManagerFromLockfile(cwd)
    if (fromLockfile) return fromLockfile

    const fromPkgJson = detectPackageManagerFromPackageJson(cwd)
    if (fromPkgJson) return fromPkgJson
  }

  return 'npm'
}

export function detectPnpmWorkspace(cwd: string): boolean {
  let current = cwd
  while (true) {
    if (existsSync(resolve(current, 'pnpm-workspace.yaml'))) return true
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return false
}

/**
 * Locate the repository root by walking up from `startDir` until a `.git`
 * directory is found. Used to place the GitHub Actions workflow (which GitHub
 * only discovers at the repo root) and the agent skills. Falls back to
 * `startDir` when no `.git` is found.
 */
function findRepoRoot(startDir: string): string {
  let current = startDir
  while (true) {
    if (existsSync(resolve(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return startDir
}

/**
 * Convert a filesystem-relative path to a POSIX-style path suitable for YAML
 * `working-directory` / `cache-dependency-path` fields in the workflow.
 */
function toWorkflowPath(relativePath: string): string {
  const normalized = relativePath.split(sep).join('/')
  return normalized.length === 0 ? '.' : normalized
}

function resolveSpawnSpec(
  cmd: string,
  args: string[]
): {
  command: string
  args: string[]
  shell?: boolean
  windowsVerbatimArguments?: boolean
} {
  if (process.platform !== 'win32') {
    return { command: cmd, args }
  }

  const windowsCmdShims = new Set(['npm', 'npx', 'playwright', 'pnpm', 'yarn'])
  if (!windowsCmdShims.has(cmd)) {
    return { command: cmd, args }
  }

  return {
    command: process.env.comspec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${buildWindowsBatchCommandLine(cmd, args)}"`],
    windowsVerbatimArguments: true,
  }
}

function quoteWindowsBatchArg(arg: string): string {
  if (arg.length === 0) {
    return '""'
  }

  return `"${arg
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/g, '$1$1')
    .replace(/%/g, '%%')}"`
}

function buildWindowsBatchCommandLine(cmd: string, args: string[]): string {
  return [resolveWindowsCmdShim(cmd), ...args]
    .map(quoteWindowsBatchArg)
    .join(' ')
}

function resolveWindowsCmdShim(cmd: string): string {
  const shimName = `${cmd}.cmd`
  const pathEntries = process.env.PATH?.split(delimiter) ?? []
  for (const entry of pathEntries) {
    if (!entry) continue
    const shimPath = resolve(entry, shimName)
    if (existsSync(shimPath)) {
      return shimPath
    }
  }

  const bundledShimCommands = new Set(['npm', 'npx'])
  if (bundledShimCommands.has(cmd)) {
    const bundledShimPath = resolve(dirname(process.execPath), shimName)
    if (existsSync(bundledShimPath)) {
      return bundledShimPath
    }
  }

  return shimName
}

function forwardChildSignals(
  child: ChildProcess,
  activityLabel: string
): { cleanup: () => void; getForwardedSignal: () => NodeJS.Signals | null } {
  let forwardedSignal: NodeJS.Signals | null = null

  const forwardSignal = (signal: NodeJS.Signals) => {
    if (forwardedSignal !== null) return
    forwardedSignal = signal
    if (process.env.SCREENCI_SIGNAL_LOGGING !== 'silent') {
      logger.info(`Received ${signal}, stopping ${activityLabel}...`)
    }
    if (!child.killed) {
      child.kill(signal)
    }
  }

  const cleanup = () => {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
  }

  const onSigint = () => forwardSignal('SIGINT')
  const onSigterm = () => forwardSignal('SIGTERM')

  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)

  return {
    cleanup,
    getForwardedSignal: () => forwardedSignal,
  }
}

function spawnSilent(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const spawnSpec = resolveSpawnSpec(cmd, args)
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: 'pipe',
      ...(spawnSpec.shell !== undefined ? { shell: spawnSpec.shell } : {}),
      ...(spawnSpec.windowsVerbatimArguments !== undefined
        ? {
            windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments,
          }
        : {}),
      ...(cwd ? { cwd } : {}),
    })
    const childSignals = forwardChildSignals(child, cmd)
    let stdout = ''
    let stderr = ''

    child.stdout?.setEncoding?.('utf8')
    child.stderr?.setEncoding?.('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('close', (code, signal) => {
      const forwardedSignal = childSignals.getForwardedSignal()
      childSignals.cleanup()
      if (forwardedSignal) {
        process.kill(process.pid, forwardedSignal)
        return
      }
      if (signal) {
        process.kill(process.pid, signal)
        return
      }
      if (code === 0) {
        resolve()
        return
      }

      const output = stderr.trim() || stdout.trim()
      reject(
        new Error(
          output.length > 0
            ? `${cmd} exited with code ${code}: ${output}`
            : `${cmd} exited with code ${code}`
        )
      )
    })
    child.on('error', (err) => {
      childSignals.cleanup()
      reject(err)
    })
  })
}

function spawnCaptured(
  cmd: string,
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const spawnSpec = resolveSpawnSpec(cmd, args)
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: 'pipe',
      ...(spawnSpec.shell !== undefined ? { shell: spawnSpec.shell } : {}),
      ...(spawnSpec.windowsVerbatimArguments !== undefined
        ? {
            windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments,
          }
        : {}),
      ...(cwd ? { cwd } : {}),
    })
    const childSignals = forwardChildSignals(child, cmd)
    let stdout = ''
    let stderr = ''

    child.stdout?.setEncoding?.('utf8')
    child.stderr?.setEncoding?.('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('close', (code, signal) => {
      const forwardedSignal = childSignals.getForwardedSignal()
      childSignals.cleanup()
      if (forwardedSignal) {
        process.kill(process.pid, forwardedSignal)
        return
      }
      if (signal) {
        process.kill(process.pid, signal)
        return
      }
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      const output = stderr.trim() || stdout.trim()
      reject(
        new Error(
          output.length > 0
            ? `${cmd} exited with code ${code}: ${output}`
            : `${cmd} exited with code ${code}`
        )
      )
    })
    child.on('error', (err) => {
      childSignals.cleanup()
      reject(err)
    })
  })
}

function spawnInherited(
  cmd: string,
  args: string[],
  cwd?: string,
  activityLabel = cmd
): Promise<void> {
  const spawnSpec = resolveSpawnSpec(cmd, args)
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    stdio: 'inherit',
    ...(spawnSpec.shell !== undefined ? { shell: spawnSpec.shell } : {}),
    ...(spawnSpec.windowsVerbatimArguments !== undefined
      ? {
          windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments,
        }
      : {}),
    ...(cwd ? { cwd } : {}),
  })
  const childSignals = forwardChildSignals(child, activityLabel)

  return new Promise<void>((resolve, reject) => {
    child.on('close', (code, signal) => {
      const forwardedSignal = childSignals.getForwardedSignal()
      childSignals.cleanup()
      if (forwardedSignal) {
        process.kill(process.pid, forwardedSignal)
        return
      }
      if (signal) {
        process.kill(process.pid, signal)
        return
      }
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${cmd} exited with code ${code}`))
    })

    child.on('error', (err) => {
      childSignals.cleanup()
      reject(err)
    })
  })
}

export function parsePackageManager(
  value: string | undefined,
  cwd?: string
): PackageManager {
  if (value === undefined) {
    return determinePackageManager(cwd)
  }

  if (value === 'npm' || value === 'pnpm' || value === 'yarn') {
    return value
  }

  throw new Error('Expected package manager to be one of: npm, pnpm, yarn')
}

function getPackageManagerCommand(
  packageManager: PackageManager,
  isWorkspace = false
): {
  screenciRun: string
  playwrightRun: string
  installCommand: string
  installArgs: (...pkgs: string[]) => string[]
  screenciInstallArgs: (pkg: string) => string[]
  skillsCommand: string
  skillsArgs: (skills: string[], agent?: string) => string[]
  cacheName: PackageManager
  lockfileName: string
  frozenInstallCommand: string
} {
  if (packageManager === 'pnpm') {
    const workspaceFlag = isWorkspace ? ['-w'] : []
    return {
      screenciRun: 'pnpm exec screenci',
      playwrightRun: 'pnpm exec playwright',
      installCommand: 'pnpm',
      installArgs: (...pkgs) => [
        'add',
        '--save-dev',
        ...workspaceFlag,
        ...pkgs,
      ],
      screenciInstallArgs: (pkg) => [
        'add',
        '--save-dev',
        ...workspaceFlag,
        '--allow-build=ffmpeg-static',
        pkg,
      ],
      skillsCommand: 'pnpm',
      skillsArgs: (skills, agent) => [
        'dlx',
        'skills',
        'add',
        'screenci/screenci',
        ...(agent ? ['--agent', agent] : []),
        ...skills.flatMap((skillName) => ['--skill', skillName]),
        '-y',
      ],
      cacheName: 'pnpm',
      lockfileName: 'pnpm-lock.yaml',
      frozenInstallCommand: 'pnpm install --frozen-lockfile',
    }
  }

  if (packageManager === 'yarn') {
    const workspaceFlag = isWorkspace ? ['-W'] : []
    return {
      screenciRun: 'yarn screenci',
      playwrightRun: 'yarn playwright',
      installCommand: 'yarn',
      installArgs: (...pkgs) => ['add', '--dev', ...workspaceFlag, ...pkgs],
      screenciInstallArgs: (pkg) => ['add', '--dev', ...workspaceFlag, pkg],
      skillsCommand: 'yarn',
      skillsArgs: (skills, agent) => [
        'dlx',
        'skills',
        'add',
        'screenci/screenci',
        ...(agent ? ['--agent', agent] : []),
        ...skills.flatMap((skillName) => ['--skill', skillName]),
        '-y',
      ],
      cacheName: 'yarn',
      lockfileName: 'yarn.lock',
      frozenInstallCommand: 'yarn install --frozen-lockfile',
    }
  }

  return {
    screenciRun: 'npx screenci',
    playwrightRun: 'npx playwright',
    installCommand: 'npm',
    installArgs: (...pkgs) => ['install', '--save-dev', ...pkgs],
    screenciInstallArgs: (pkg) => ['install', '--save-dev', pkg],
    skillsCommand: 'npm',
    skillsArgs: (skills, agent) => [
      'exec',
      '--yes',
      '--package=skills',
      '--',
      'skills',
      'add',
      'screenci/screenci',
      ...(agent ? ['--agent', agent] : []),
      ...skills.flatMap((skillName) => ['--skill', skillName]),
      '-y',
    ],
    cacheName: 'npm',
    lockfileName: 'package-lock.json',
    frozenInstallCommand: 'npm ci',
  }
}

function buildPlaywrightSpawnArgs(
  packageManager: PackageManager,
  ...playwrightArgs: string[]
): [string, ...string[]] {
  if (packageManager === 'pnpm') {
    return ['pnpm', 'exec', 'playwright', ...playwrightArgs]
  }
  if (packageManager === 'yarn') {
    return ['yarn', 'playwright', ...playwrightArgs]
  }
  return ['npx', 'playwright', ...playwrightArgs]
}

/**
 * Turn a human project name into a valid npm package name for the island's own
 * package.json. We use the project name (the repository root directory name by
 * default) directly. The name must NOT be `screenci` (a package cannot depend
 * on a package with its own name), so we fall back to `screenci-videos` only
 * when the slug is empty or would collide with `screenci`.
 */
export function toIslandPackageName(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length === 0 || slug === 'screenci') {
    return 'screenci-videos'
  }
  return slug
}

function generateIslandPackageJson(projectName: string): string {
  return (
    JSON.stringify(
      {
        name: toIslandPackageName(projectName),
        private: true,
        type: 'module',
        scripts: {
          test: 'screenci test',
          record: 'screenci record',
        },
      },
      null,
      2
    ) + '\n'
  )
}

export function generateIslandTsconfig(withReact = false): string {
  // Minimal config so an editor type-checks the island as its own project
  // instead of inheriting a surrounding repo's tsconfig or the legacy TS
  // defaults. `module`/`moduleResolution` let TypeScript read screenci's ESM
  // `exports` map; `target` gives the example's async/await a modern lib.
  // `types: ['node']` makes the `process` global resolve in screenci.config.ts
  // (which reads `process.env.CI`) without depending on whether the editor's TS
  // server auto-discovers @types/node, which is unreliable under pnpm's isolated
  // node_modules layout.
  //
  // `jsx: 'react-jsx'` is added only when React overlay support is scaffolded
  // so user-authored `.screenci.tsx` files type-check with the automatic JSX
  // runtime. It is the one piece of React setup a published package cannot do
  // for the user, so the scaffold owns it.
  return (
    JSON.stringify(
      {
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ESNext',
          ...(withReact && { jsx: 'react-jsx' }),
          types: ['node'],
        },
      },
      null,
      2
    ) + '\n'
  )
}

/**
 * Resolve the package-manager-specific command a user types to run the island's
 * own `test` / `record` scripts. npm needs `run` for non-`test` scripts and `--`
 * to forward flags; pnpm and yarn forward both implicitly.
 */
function getIslandScriptInvocations(packageManager: PackageManager): {
  test: string
  testUi: string
  record: string
} {
  if (packageManager === 'pnpm') {
    return {
      test: 'pnpm test',
      testUi: 'pnpm test --ui',
      record: 'pnpm record',
    }
  }
  if (packageManager === 'yarn') {
    return {
      test: 'yarn test',
      testUi: 'yarn test --ui',
      record: 'yarn record',
    }
  }
  return {
    test: 'npm test',
    testUi: 'npm test -- --ui',
    record: 'npm run record',
  }
}

export function generateIslandReadme(
  projectName: string,
  packageManager: PackageManager
): string {
  const scripts = getIslandScriptInvocations(packageManager)
  return `# ${projectName}

Check \`recordings/\` for videos and screenshots, and \`screenci.config.ts\`
for configuration.

## Commands

- \`${scripts.test}\` tests your video scripts fast locally.
- \`${scripts.testUi}\` tests your video scripts in interactive UI mode.
- \`${scripts.record}\` records and pauses for first-time setup if needed.

## Recording without an account

Note: before signing up, you can record once for free. Just run
\`${scripts.record}\` with no SCREENCI_SECRET and your first video uploads
anonymously. Sign up to claim it and keep recording.

## Learn more

Visit https://screenci.com/docs for the full documentation.
`
}

function generatePnpmWorkspaceYaml(pnpmMajor: number): string {
  // A nested `pnpm-workspace.yaml` makes pnpm treat the island as its own
  // workspace root, so a surrounding monorepo workspace does not absorb it (no
  // hoisting, no `-w` install). It also pre-approves the ffmpeg-static build
  // script so non-interactive installs (e.g. `pnpm install --frozen-lockfile`
  // in CI) build the bundled binary without prompting.
  //
  // pnpm 10 and 11 spell this approval differently: pnpm 11 removed
  // `onlyBuiltDependencies` in favour of the `allowBuilds` map. Emit the key
  // that matches the installed pnpm so the approval is actually honoured.
  const buildApproval =
    pnpmMajor >= 11
      ? `allowBuilds:
  ffmpeg-static: true
`
      : `onlyBuiltDependencies:
  - ffmpeg-static
`
  return `packages:
  - '.'

${buildApproval}`
}

function parseSemverTriplet(version: string): [number, number, number] | null {
  const match = version
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) {
    return null
  }

  return [
    Number.parseInt(match[1]!, 10),
    Number.parseInt(match[2]!, 10),
    Number.parseInt(match[3]!, 10),
  ]
}

function compareSemverTriplets(
  left: [number, number, number],
  right: [number, number, number]
): number {
  const [leftMajor, leftMinor, leftPatch] = left
  const [rightMajor, rightMinor, rightPatch] = right
  if (leftMajor !== rightMajor) {
    return leftMajor > rightMajor ? 1 : -1
  }
  if (leftMinor !== rightMinor) {
    return leftMinor > rightMinor ? 1 : -1
  }
  if (leftPatch !== rightPatch) {
    return leftPatch > rightPatch ? 1 : -1
  }

  return 0
}

export function parsePnpmVersionSupport(
  versionOutput: string
): PnpmVersionSupport {
  const detectedVersion = versionOutput.trim()
  const parsedDetectedVersion = parseSemverTriplet(detectedVersion)
  if (parsedDetectedVersion === null) {
    return {
      supported: false,
      ...(detectedVersion.length > 0 ? { detectedVersion } : {}),
      reason: 'malformed-version',
    }
  }

  const minimumVersion = parseSemverTriplet(MIN_SUPPORTED_PNPM_VERSION)
  if (minimumVersion === null) {
    throw new Error('Invalid minimum pnpm version configuration')
  }

  if (compareSemverTriplets(parsedDetectedVersion, minimumVersion) < 0) {
    return {
      supported: false,
      detectedVersion,
      reason: 'version-too-old',
    }
  }

  return {
    supported: true,
    detectedVersion,
    reason: 'supported',
  }
}

async function detectPnpmVersionSupport(
  cwd: string
): Promise<PnpmVersionSupport> {
  try {
    const { stdout } = await spawnCaptured('pnpm', ['--version'], cwd)
    return parsePnpmVersionSupport(stdout)
  } catch {
    return {
      supported: false,
      reason: 'pnpm-not-found',
    }
  }
}

function buildUnsupportedPnpmError(versionSupport: PnpmVersionSupport): Error {
  if (versionSupport.reason === 'pnpm-not-found') {
    return new Error(
      [
        `pnpm could not be detected. ScreenCI requires pnpm ${MIN_SUPPORTED_PNPM_VERSION} or newer to use pnpm native --allow-build support for ffmpeg-static.`,
        'Upgrade pnpm and rerun, or use `--package-manager npm`.',
        'Examples:',
        '  corepack use pnpm@latest',
        '  pnpm create screenci',
        '  npm init screenci@latest',
      ].join('\n')
    )
  }

  if (versionSupport.reason === 'version-too-old') {
    return new Error(
      [
        `Detected pnpm ${versionSupport.detectedVersion}. ScreenCI requires pnpm ${MIN_SUPPORTED_PNPM_VERSION} or newer because it relies on pnpm native --allow-build support for ffmpeg-static.`,
        'Upgrade pnpm and rerun, or use `--package-manager npm`.',
        'Examples:',
        '  corepack use pnpm@latest',
        '  pnpm create screenci',
        '  npm init screenci@latest',
      ].join('\n')
    )
  }

  return new Error(
    [
      `Detected pnpm version output ${JSON.stringify(versionSupport.detectedVersion ?? '')}, which ScreenCI could not parse. ScreenCI requires pnpm ${MIN_SUPPORTED_PNPM_VERSION} or newer to use pnpm native --allow-build support for ffmpeg-static.`,
      'Upgrade pnpm and rerun, or use `--package-manager npm`.',
      'Examples:',
      '  corepack use pnpm@latest',
      '  pnpm create screenci',
      '  npm init screenci@latest',
    ].join('\n')
  )
}

async function ensureSupportedPnpmVersion(
  cwd: string
): Promise<PnpmVersionSupport> {
  const versionSupport = await detectPnpmVersionSupport(cwd)
  if (!versionSupport.supported) {
    throw buildUnsupportedPnpmError(versionSupport)
  }
  return versionSupport
}

// A supported pnpm version always parses (the support check rejects malformed
// versions), so the major is reliable here; fall back to 10 defensively.
function pnpmMajorFromSupport(versionSupport: PnpmVersionSupport): number {
  const parsed = versionSupport.detectedVersion
    ? parseSemverTriplet(versionSupport.detectedVersion)
    : null
  return parsed?.[0] ?? 10
}

export function parseYarnVersionSupport(
  versionOutput: string
): YarnVersionSupport {
  const detectedVersion = versionOutput.trim()
  const parsedDetectedVersion = parseSemverTriplet(detectedVersion)
  if (parsedDetectedVersion === null) {
    return { supported: false, detectedVersion, reason: 'malformed-version' }
  }

  const parsedMin = parseSemverTriplet(MIN_SUPPORTED_YARN_VERSION)!
  if (compareSemverTriplets(parsedDetectedVersion, parsedMin) < 0) {
    return { supported: false, detectedVersion, reason: 'version-too-old' }
  }

  return { supported: true, detectedVersion, reason: 'supported' }
}

async function detectYarnVersionSupport(
  cwd: string
): Promise<YarnVersionSupport> {
  try {
    const { stdout } = await spawnCaptured('yarn', ['--version'], cwd)
    const result = parseYarnVersionSupport(stdout)
    if (result.supported) return result
    // yarn --version resolved to v1 or a malformed string (e.g. yarn 1.x is
    // first in PATH and shadows the corepack shim). Try `corepack yarn --version`
    // as a fallback — corepack routes directly to the activated berry release.
    try {
      const { stdout: corStdout } = await spawnCaptured(
        'corepack',
        ['yarn', '--version'],
        cwd
      )
      const corResult = parseYarnVersionSupport(corStdout)
      if (corResult.supported) return corResult
    } catch {
      // corepack not available or yarn not configured in corepack; fall through
    }
    return result
  } catch {
    return { supported: false, reason: 'yarn-not-found' }
  }
}

function buildUnsupportedYarnError(versionSupport: YarnVersionSupport): Error {
  const upgrade = [
    'Upgrade to yarn 2+ and rerun, or use a different package manager:',
    '  corepack enable && corepack prepare yarn@stable --activate',
    '  yarn create screenci',
    '  npm init screenci@latest',
  ].join('\n')

  if (versionSupport.reason === 'yarn-not-found') {
    return new Error(
      [
        'yarn could not be detected. ScreenCI requires yarn 2+ (yarn berry) because it uses `yarn dlx` for skill installation.',
        upgrade,
      ].join('\n')
    )
  }

  if (versionSupport.reason === 'version-too-old') {
    return new Error(
      [
        `Detected yarn ${versionSupport.detectedVersion}. ScreenCI requires yarn 2+ (yarn berry) because it uses \`yarn dlx\` for skill installation.`,
        upgrade,
      ].join('\n')
    )
  }

  return new Error(
    [
      `Detected yarn version output ${JSON.stringify(versionSupport.detectedVersion ?? '')}, which ScreenCI could not parse. ScreenCI requires yarn 2+ (yarn berry).`,
      upgrade,
    ].join('\n')
  )
}

async function ensureSupportedYarnVersion(cwd: string): Promise<void> {
  const versionSupport = await detectYarnVersionSupport(cwd)
  if (!versionSupport.supported) {
    throw buildUnsupportedYarnError(versionSupport)
  }
}

// Resolve the bundled template logo PNG. It ships under the package's
// `templates/` directory (declared in package.json "files"), so the same lookup
// must work both from `src/init.ts` during tests and from the compiled
// `dist/src/init.js` once published. tsc copies no binary assets, so resolve the
// asset by an absolute path relative to this module's location, trying both
// depths and returning the first that exists (mirroring the bundled-shim lookup
// in cli.ts).
export function resolveBundledLogoPath(): string {
  const currentFileDir = dirname(fileURLToPath(import.meta.url))
  const relativeAssetPath = ['templates', 'recordings', 'assets', 'logo.png']
  const candidates = [
    // From src/init.ts (tests): packages/screenci/templates/...
    resolve(currentFileDir, '..', ...relativeAssetPath),
    // From dist/src/init.js (published): packages/screenci/templates/...
    resolve(currentFileDir, '..', '..', ...relativeAssetPath),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  // Fall back to the src-relative path so callers get a clear ENOENT pointing at
  // the expected location if the asset is somehow missing.
  return candidates[0] ?? resolve(currentFileDir, '..', ...relativeAssetPath)
}

async function readCurrentScreenciVersion(): Promise<string> {
  const currentFileDir = dirname(fileURLToPath(import.meta.url))
  const packageJsonPaths = [
    resolve(currentFileDir, 'package.json'),
    resolve(currentFileDir, '../package.json'),
  ]

  for (const packageJsonPath of packageJsonPaths) {
    try {
      const packageJson = JSON.parse(
        await readFile(packageJsonPath, 'utf-8')
      ) as {
        version?: unknown
      }
      if (typeof packageJson.version === 'string') {
        return packageJson.version
      }
    } catch {
      // Try the next candidate path.
    }
  }

  return 'latest'
}

// Binary overlay / audio media that ScreenCI uploads to the backend on first
// record and reuses on later runs. Only true binary formats are listed: HTML,
// TSX, and SVG overlay sources under recordings/assets/ are editable text and
// must stay committed, so we ignore by extension instead of the whole folder.
// Keep in sync with the overlay (.png/.mp4) and audio (see audio.ts) file
// formats ScreenCI supports.
const IGNORED_ASSET_MEDIA_EXTENSIONS = [
  // Images
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  // Video
  'mp4',
  'mov',
  'webm',
  // Audio
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'flac',
  'opus',
] as const

export function generateGitignore(
  packageManager: PackageManager = 'npm'
): string {
  const yarnSection = packageManager === 'yarn' ? '\n# Yarn\n.yarn/\n' : ''
  const assetMediaRules = IGNORED_ASSET_MEDIA_EXTENSIONS.map(
    (extension) => `recordings/assets/**/*.${extension}`
  ).join('\n')
  return `# ScreenCI
.screenci
.playwright-cli/
.env

# Video asset media under recordings/assets/: image, video, and audio overlay
# and soundtrack files. These binary files are uploaded to the ScreenCI backend
# on first record and reused on later runs (CI included), so the large media do
# not need to be committed. HTML, TSX, and SVG overlay sources under
# recordings/assets/ are text and stay committed. Delete these rules to commit
# the media too.
${assetMediaRules}

# Playwright
node_modules/
/test-results/
/playwright-report/
/blob-report/
/playwright/.cache/
/playwright/.auth/
${yarnSection}`
}

async function writeInitGitignore(
  projectDir: string,
  packageManager: PackageManager
): Promise<void> {
  const gitignorePath = resolve(projectDir, '.gitignore')
  const content = generateGitignore(packageManager)

  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, content)
    return
  }

  const existing = await readFile(gitignorePath, 'utf-8')
  const separator =
    existing.length === 0
      ? ''
      : existing.endsWith('\n\n')
        ? ''
        : existing.endsWith('\n')
          ? '\n'
          : '\n\n'
  await appendFile(gitignorePath, `${separator}${content}`)
}

async function installInitDependencies(
  projectDir: string,
  verbose: boolean,
  screenciDependency: string,
  includePlaywrightCli: boolean,
  includeReact: boolean,
  commands: ReturnType<typeof getPackageManagerCommand>
): Promise<void> {
  // Packages that share identical install flags are installed in a single
  // command so the package manager resolves the dependency graph once instead
  // of once per package. ScreenCI stays separate because on pnpm it needs an
  // extra '--allow-build=ffmpeg-static' flag the others don't carry.
  const sharedPackages = [
    `@playwright/test@${PLAYWRIGHT_TEST_VERSION}`,
    `@types/node@${NODE_TYPES_VERSION}`,
    ...(includePlaywrightCli
      ? [`@playwright/cli@${PLAYWRIGHT_CLI_VERSION}`]
      : []),
    // React element overlays render via react/react-dom, which are optional
    // peer deps imported lazily by createOverlays. Install them (and their
    // types) so user-authored `.screenci.tsx` files resolve out of the box.
    ...(includeReact
      ? [
          `react@${REACT_VERSION}`,
          `react-dom@${REACT_DOM_VERSION}`,
          `@types/react@${REACT_TYPES_VERSION}`,
          `@types/react-dom@${REACT_DOM_TYPES_VERSION}`,
        ]
      : []),
  ]

  const installSteps: Array<{ message: string; args: string[] }> = [
    {
      message: 'Installing dependencies...',
      args: commands.installArgs(...sharedPackages),
    },
    {
      message: 'Installing ScreenCI...',
      args: commands.screenciInstallArgs(`screenci@${screenciDependency}`),
    },
  ]

  for (const step of installSteps) {
    if (verbose) {
      logger.info(
        `Running '${commands.installCommand} ${step.args.join(' ')}'...`
      )
      await spawnInherited(
        commands.installCommand,
        step.args,
        projectDir,
        'screenci init'
      )
    } else {
      const spinner = ora(step.message).start()
      try {
        await spawnSilent(commands.installCommand, step.args, projectDir)
        spinner.succeed(step.message.replace(/\.\.\.$/, ''))
      } catch (err) {
        spinner.fail(step.message.replace(/\.\.\.$/, ' failed'))
        throw err
      }
    }
  }
}

// How the new project is set up to authenticate: `ready` means a
// SCREENCI_SECRET is already configured (a pasted secret was verified, or the
// env already had one); `manual` means the user still needs to copy their
// secret from the secrets page, or just run `screenci record` with no secret
// to try it anonymously first (see anonSession.ts).
export type InitSecretOutcome = 'ready' | 'manual'

/**
 * Turns init's secret input into a persisted SCREENCI_SECRET.
 *
 * A pasted SCREENCI_SECRET (a bare UUID) is verified against the backend and
 * written into `.env`. Neither present, or a failed verification, degrades
 * gracefully to the manual "copy your secret from the secrets page" path (or
 * just record anonymously with no secret at all). Never throws: setup
 * guidance is always better than a failed scaffold.
 */
export async function setUpInitSecret(
  islandDir: string,
  options: {
    env?: NodeJS.ProcessEnv
    pastedSecret?: string
    fetchImpl?: typeof fetch
    backendUrl?: string
  } = {}
): Promise<InitSecretOutcome> {
  const env = options.env ?? process.env
  if (env.SCREENCI_SECRET) return 'ready'

  const envPath = resolve(islandDir, '.env')
  if (!options.pastedSecret) return 'manual'

  // Only include keys that are set: `exactOptionalPropertyTypes` forbids passing
  // an explicit `undefined` for these optional fields.
  const verifyOptions = {
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.backendUrl ? { backendUrl: options.backendUrl } : {}),
  }

  const verification = await verifyScreenCISecret(
    options.pastedSecret,
    verifyOptions
  )
  if (!verification.ok && verification.kind === 'invalid') {
    logger.warn(
      `That secret was not recognized. Copy your SCREENCI_SECRET from ${getScreenCISecretsUrl()} and add it to ${envPath} manually.`
    )
    return 'manual'
  }
  if (!verification.ok) {
    logger.warn(
      'Could not verify the secret right now; writing it anyway. `screenci record` will confirm it.'
    )
  }
  // The generated config sets `envFile: '.env'`, so this matches what
  // `screenci record` resolves later.
  await persistScreenCISecret(envPath, options.pastedSecret)
  return 'ready'
}

function printInitNextSteps(
  projectDir: string,
  islandDirName: string,
  packageManager: PackageManager,
  secretOutcome: InitSecretOutcome
): void {
  const resolvedProjectDir = realpathSync(projectDir)
  const commands = getPackageManagerCommand(packageManager)

  logger.info(
    `${pc.green('✔ Success!')} Created a ScreenCI project at ${resolvedProjectDir}`
  )
  logger.info('')
  logger.info('You can now run these commands:')
  logger.info('')
  logger.info(`  ${pc.cyan(`${commands.screenciRun} test`)}`)
  logger.info('    Tests your video scripts fast locally.')
  logger.info('')
  logger.info(`  ${pc.cyan(`${commands.screenciRun} test --ui`)}`)
  logger.info('    Tests your video scripts in interactive UI mode.')
  logger.info('')
  logger.info(`  ${pc.cyan(`${commands.screenciRun} record`)}`)
  logger.info('    Records locally and uploads the result to ScreenCI.')
  logger.info('')
  logger.info('We suggest that you begin by typing:')
  logger.info('')
  logger.info(`    ${pc.cyan(`cd ${islandDirName}`)}`)
  logger.info(`    ${pc.cyan(`${commands.screenciRun} test`)}`)
  logger.info('')
  logger.info('And check out:')
  logger.info(`  - ./${islandDirName}/recordings/ - Videos and screenshots`)
  logger.info(
    `  - ./${islandDirName}/screenci.config.ts - ScreenCI configuration`
  )
  logger.info(
    `  - ./${islandDirName}/README.md - Project commands and docs link`
  )
  logger.info('')
  if (secretOutcome === 'ready') {
    logger.info(
      `${pc.green('✔')} You're set up on the free tier. Run ${pc.cyan(`${commands.screenciRun} record`)} to render your first video.`
    )
    logger.info(
      'Free renders include a ScreenCI watermark. Upgrade any time to remove it.'
    )
  } else {
    logger.info(
      `Before your first ${pc.cyan(`${commands.screenciRun} record`)}, add your SCREENCI_SECRET:`
    )
    logger.info(
      `Copy it from ${pc.cyan(getScreenCISecretsUrl())} into ${pc.cyan(`${islandDirName}/.env`)}.`
    )
  }
  logger.info('')
  logger.info(
    `Visit ${pc.cyan('https://screenci.com/docs')} for more information.`
  )
  logger.info(
    `Recording during an anonymous trial agrees to the Terms: ${pc.cyan(SCREENCI_TERMS_URL)}`
  )
  logger.info('')
  logger.info('Happy hacking! 🎥')
}

function generateGithubAction(
  packageManager: PackageManager,
  islandWorkflowPath: string
): string {
  const commands = getPackageManagerCommand(packageManager)
  const cacheDependencyPath =
    islandWorkflowPath === '.'
      ? commands.lockfileName
      : `${islandWorkflowPath}/${commands.lockfileName}`

  // When the island is nested (e.g. `screenci/`), the repo has a parent app
  // that videos may record locally. The generated workflow stays island-only by
  // default (correct when recording a remote URL), but carries commented hints
  // so an agent or human can wire up a local app build without reconstructing it
  // from https://screenci.com/integrate.md. When the island is the repo root
  // there is no separate app, so the hints are omitted.
  const isNested = islandWorkflowPath !== '.'
  const rootLockfile = commands.lockfileName
  const cacheHint = isNested
    ? `
          # To also record this project's own locally-built app, cache its
          # lockfile too by listing both paths here:
          #   cache-dependency-path: |
          #     ${rootLockfile}
          #     ${cacheDependencyPath}`
    : ''
  const appBuildHint = isNested
    ? `
      # If your videos navigate to this project's own dev server, install and
      # build the app before recording. Uncomment and adjust the build command
      # and ports to match your framework. See https://screenci.com/docs.
      #   - name: Install app dependencies
      #     run: ${commands.frozenInstallCommand}
      #   - name: Build app
      #     run: ${commands.installCommand} run build

`
    : '\n'

  return `name: ScreenCI

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      grep:
        description: Only record videos whose title matches this pattern (optional)
        required: false
        type: string

jobs:
  record:
    runs-on: ubuntu-latest
    environment:
      name: screenci
      url: \${{ steps.record.outputs.screenci_project_url }}
    steps:
      - name: Check SCREENCI_SECRET
        env:
          SCREENCI_SECRET: \${{ secrets.SCREENCI_SECRET }}
        run: |
          if [ -z "$SCREENCI_SECRET" ]; then
            echo "::error::SCREENCI_SECRET is not set. Copy it from https://app.screenci.com/secrets or ./.env, add it under Settings → Secrets and variables → Actions → Repository secrets, and then rerun this action."
            exit 1
          fi

      - uses: actions/checkout@v5

      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: ${commands.cacheName}${cacheHint}
          cache-dependency-path: ${cacheDependencyPath}
${appBuildHint}      - name: Install dependencies
        working-directory: ${islandWorkflowPath}
        run: ${commands.frozenInstallCommand}

      # Capturing system audio (enableCaptureAudio + recordOptions.captureAudio,
      # Linux only) needs the full Chromium browser (not just the headless shell)
      # and a running PulseAudio server. See
      # https://screenci.com/docs/guides/screen-audio#ci-setup
      - name: Install Chromium Headless Shell
        working-directory: ${islandWorkflowPath}
        run: ${commands.playwrightRun} install --only-shell chromium

      - id: record
        name: Record
        working-directory: ${islandWorkflowPath}
        env:
          SCREENCI_SECRET: \${{ secrets.SCREENCI_SECRET }}
          SCREENCI_GREP: \${{ inputs.grep }}
        run: |
          if [ -n "$SCREENCI_GREP" ]; then
            ${commands.screenciRun} record --grep "$SCREENCI_GREP"
          else
            ${commands.screenciRun} record
          fi
`
}

export function generateExampleVideo(): string {
  return `import { autoZoom, hide, video } from 'screenci'

video
  .overlays({
    logo: { path: './assets/logo.png', duration: '2s', overMouse: true },
  })
  .narration({
    docs: 'Here is where to find ScreenCI [pronounce: screen see eye] docs.',
  })('How to find docs', async ({ page, narration, overlays }) => {
  // Run setup without showing these actions in the final recording.
  await hide(async () => {
    await page.goto('https://screenci.com/')
  })

  // Open with a brief brand intro card before the walkthrough begins.
  await overlays.logo.for('2s')

  // Play the narration line for this step.
  await narration.docs()

  // Automatically zoom into interactions so they are easier to follow.
  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })
})
`
}

export function generateExampleScreenshot(): string {
  return `import type { Locator } from '@playwright/test'
import { screenshot } from 'screenci'

screenshot.describe('Example screenshot', () => {
  // use() takes the same options for \`screenshot\` and \`video\` as Playwright test.
  // https://playwright.dev/docs/emulation#color-scheme-and-media
  screenshot.use({
    colorScheme: 'dark',
  })

  // A branded still that rings one element, using a plain HTML overlay page (see
  // ./assets/ring.html) so it needs no React dependency.
  screenshot.overlays({
    ring: (target: Locator) => ({
      path: './assets/ring.html',
      over: target,
      margin: 8,
    }),
  })('Where to find docs', async ({ page, overlays }) => {
    await page.goto('https://screenci.com/')
    await page.waitForLoadState('load')

    await overlays
      .ring(page.getByRole('link', { name: 'View Documentation' }))
      .start()
  })
})
`
}

export function generateReactExampleScreenshot(): string {
  return `import type { Locator } from '@playwright/test'
import { screenshot } from 'screenci'

screenshot.describe('Example screenshot', () => {
  // use() takes the same options for \`screenshot\` and \`video\` as Playwright test.
  // https://playwright.dev/docs/emulation#color-scheme-and-media
  screenshot.use({
    colorScheme: 'dark',
  })

  screenshot.overlays({
    ring: (target: Locator) => ({
      path: './assets/Ring.tsx',
      over: target,
      margin: 8,
    }),
  })('Where to find docs', async ({ page, overlays }) => {
    await page.goto('https://screenci.com/')
    await page.waitForLoadState('load')

    await overlays
      .ring(page.getByRole('link', { name: 'View Documentation' }))
      .start()
  })
})
`
}

// The .tsx overlay page bundled and rendered by the React screenshot example. A
// static ring (no animation) that fills its box.
export function generateRingOverlayTsx(): string {
  return `// A code-defined overlay: a full .tsx page that default-exports a React
// component. screenci bundles this and renders it client-side, so it fills its
// box (sized to the element by \`over\`) and rings it in the still.
export default function Ring() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        border: '3px solid #ec4899',
        borderRadius: '14px',
        boxShadow:
          '0 0 0 6px rgba(236, 72, 153, 0.16), 0 14px 34px rgba(236, 72, 153, 0.26)',
      }}
    />
  )
}
`
}

// The plain HTML overlay page used by the non-React screenshot example, so the
// example never depends on a package the user opted out of. A full document
// with a transparent background (the author's job) and a single ring that fills
// its box, so \`over\` sizes the page to the element and the ring lands on it.
export function generateRingOverlayHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        background: transparent;
      }
      .ring {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        border: 3px solid #ec4899;
        border-radius: 14px;
        box-shadow:
          0 0 0 6px rgba(236, 72, 153, 0.16),
          0 14px 34px rgba(236, 72, 153, 0.26);
      }
    </style>
  </head>
  <body>
    <div class="ring"></div>
  </body>
</html>
`
}

function getInitProjectRoot(): string {
  return process.env['SCREENCI_INIT_CWD'] ?? process.cwd()
}

function getDefaultInitProjectName(): string {
  const directoryName = basename(getInitProjectRoot())
  return directoryName.length > 0 ? directoryName : 'screenci-project'
}

async function promptProjectName(): Promise<string> {
  return input({
    message: 'Project name:',
    default: getDefaultInitProjectName(),
  })
}

async function promptYesNo(
  message: string,
  defaultValue: boolean
): Promise<boolean> {
  const answer = await input({
    message,
    // Capitalize the default so it reads as the recommended answer (Y/N).
    default: defaultValue ? 'Y' : 'N',
    validate: (value) => {
      const normalized = value.trim().toLowerCase()
      if (
        normalized === '' ||
        normalized === 'y' ||
        normalized === 'yes' ||
        normalized === 'n' ||
        normalized === 'no'
      ) {
        return true
      }
      return 'Enter y or n'
    },
  })

  const normalized = answer.trim().toLowerCase()
  if (normalized === '') return defaultValue
  return normalized === 'y' || normalized === 'yes'
}

async function promptInitGithubActionWorkflow(): Promise<boolean> {
  return promptYesNo('Add a GitHub Actions CI workflow? (Y/n)', true)
}

async function promptInitAiSkills(): Promise<boolean> {
  return promptYesNo(
    'Install AI agent skills (ScreenCI + playwright-cli) for your coding agent? (Y/n)',
    true
  )
}

function getInitScreenciDependencyOverride(): string | undefined {
  return process.env['SCREENCI_INIT_SCREENCI_DEPENDENCY']
}

export async function runInit(
  projectNameArg: string | undefined,
  options: InitOptions
): Promise<void> {
  const { verbose, yes, agent, packageManager } = options
  const initCwd = getInitProjectRoot()
  const commands = getPackageManagerCommand(packageManager)

  // ScreenCI scaffolds a self-contained `screenci/` island under the current
  // directory: its own package.json + local install, deliberately NOT a member
  // of any surrounding workspace. This keeps installation deterministic in
  // monorepos. The GitHub workflow and agent skills, however, must live at the
  // repository root (that is where GitHub and coding agents discover them).
  const repoRoot = findRepoRoot(initCwd)
  const islandDir = resolve(initCwd, 'screenci')
  const islandDirName = toWorkflowPath(relative(initCwd, islandDir))
  const islandWorkflowPath = toWorkflowPath(relative(repoRoot, islandDir))

  if (existsSync(islandDir)) {
    logger.error(
      `Error: ${islandDirName}/ already exists. Remove it (or run init in a different directory) and try again.`
    )
    process.exit(1)
  }

  if (packageManager === 'yarn') {
    await ensureSupportedYarnVersion(initCwd)
  }

  // The single positional is either a pasted SCREENCI_SECRET (a bare UUID,
  // written straight to `.env`) or otherwise the project name
  // (backward-friendly). With no secret at all, `screenci record` uploads
  // anonymously instead (see anonSession.ts) — no setup token is needed.
  let projectName = projectNameArg?.trim()
  let pastedSecret: string | undefined
  if (projectName && looksLikeScreenCISecret(projectName)) {
    pastedSecret = projectName
    projectName = undefined
  }

  if (!projectName) {
    projectName = yes ? getDefaultInitProjectName() : await promptProjectName()
  }

  if (!projectName) {
    logger.error('Error: Project name is required')
    process.exit(1)
  }

  const githubWorkflowsDir = resolve(repoRoot, '.github', 'workflows')
  const githubActionPath = resolve(githubWorkflowsDir, 'screenci.yaml')

  // Only the decisions that genuinely vary between users are prompted for
  // (project name above, the GitHub workflow, and the combined AI skills). The
  // rest are auto-applied at their safe default and can be steered with flags,
  // so the common path stays a couple of questions instead of seven.
  const shouldAddGithubActionWorkflow =
    options.githubWorkflow === false
      ? false
      : yes
        ? true
        : await promptInitGithubActionWorkflow()

  const shouldAddReactOverlays = yes ? true : options.react !== false
  const shouldInstallPlaywrightBrowsers = yes
    ? true
    : options.playwrightBrowsers !== false
  const shouldInstallPlaywrightOsDependencies = yes
    ? false
    : options.playwrightOsDeps === true

  // The two agent skills are decided together (one prompt). `--no-skills` skips
  // both without asking; `--no-playwright-cli` keeps the ScreenCI skill but drops
  // playwright-cli (skill + the `@playwright/cli` dev dependency).
  const shouldInstallAiSkills =
    options.skills === false ? false : yes ? true : await promptInitAiSkills()
  const shouldInstallScreenCISkill = shouldInstallAiSkills
  const shouldInstallPlaywrightCli =
    shouldInstallAiSkills && options.playwrightCli !== false

  // In verbose mode, surface the auto-applied choices and the flag that flips
  // each one without adding noise to the normal interactive path.
  if (verbose && !yes) {
    logger.info(
      'Using defaults (override with flags): ' +
        `React overlays ${shouldAddReactOverlays ? 'on' : 'off'} (--no-react), ` +
        `Playwright browsers ${shouldInstallPlaywrightBrowsers ? 'on' : 'off'} (--no-playwright-browsers), ` +
        `OS deps ${shouldInstallPlaywrightOsDependencies ? 'on' : 'off'} (--playwright-os-deps).`
    )
  }

  // The workflow lives at the repo root. If one already exists, skip it (do not
  // overwrite, do not fail) so re-running init stays non-destructive.
  const workflowAlreadyExists =
    shouldAddGithubActionWorkflow && existsSync(githubActionPath)
  if (workflowAlreadyExists) {
    logger.info(
      `Skipping GitHub Actions workflow: ${toWorkflowPath(relative(repoRoot, githubActionPath))} already exists`
    )
  }
  const shouldWriteGithubActionWorkflow =
    shouldAddGithubActionWorkflow && !workflowAlreadyExists

  const skills: string[] = []
  if (shouldInstallScreenCISkill) {
    skills.push('screenci')
  }
  if (shouldInstallPlaywrightCli) {
    skills.push('playwright-cli')
  }
  const skillsArgs =
    skills.length === 0 ? null : commands.skillsArgs(skills, agent)
  const skillsCommand =
    skillsArgs === null
      ? null
      : `${commands.skillsCommand} ${skillsArgs.join(' ')}`
  const screenciDependency =
    getInitScreenciDependencyOverride() ?? (await readCurrentScreenciVersion())

  // Everything below creates files / runs installs. If anything fails (or the
  // user interrupts), roll back the `screenci/` directory we created so the
  // next `init` run starts from a clean slate. Pre-existing repo-root files
  // (e.g. .github/, .claude/) are left untouched.
  let islandCreated = false
  let scaffoldComplete = false
  const removePartialIsland = (): void => {
    if (!islandCreated || scaffoldComplete) return
    try {
      rmSync(islandDir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
  const onSigint = (): void => {
    removePartialIsland()
    process.exit(130)
  }
  const onSigterm = (): void => {
    removePartialIsland()
    process.exit(143)
  }
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  process.on('exit', removePartialIsland)

  try {
    await mkdir(resolve(islandDir, 'recordings'), { recursive: true })
    islandCreated = true

    // Ship the brand intro logo used by the example script. It lands in the
    // gitignored assets folder: the example uploads it to the backend on first
    // record and reuses it afterwards, so it need not be committed.
    const assetsDir = resolve(islandDir, 'recordings', 'assets')
    await mkdir(assetsDir, { recursive: true })
    await copyFile(resolveBundledLogoPath(), resolve(assetsDir, 'logo.png'))

    await writeFile(
      resolve(islandDir, 'screenci.config.ts'),
      generateConfig(projectName)
    )
    await writeFile(
      resolve(islandDir, 'package.json'),
      generateIslandPackageJson(projectName)
    )
    await writeFile(
      resolve(islandDir, 'tsconfig.json'),
      generateIslandTsconfig(shouldAddReactOverlays)
    )
    await writeFile(
      resolve(islandDir, 'README.md'),
      generateIslandReadme(projectName, packageManager)
    )
    await writeInitGitignore(islandDir, packageManager)
    await writeFile(
      resolve(islandDir, 'recordings', 'example.screenci.ts'),
      generateExampleVideo()
    )
    // Also scaffold a screenshot example: a branded still that rings one element.
    // With React overlays it renders the ring from a `.tsx` overlay page while
    // the test file remains `.ts`; under `--no-react` it uses a plain `.html`
    // overlay page. Each references its overlay source under recordings/assets/,
    // scaffolded alongside it.
    await writeFile(
      resolve(islandDir, 'recordings', 'example-screenshot.screenci.ts'),
      shouldAddReactOverlays
        ? generateReactExampleScreenshot()
        : generateExampleScreenshot()
    )
    if (shouldAddReactOverlays) {
      await writeFile(resolve(assetsDir, 'Ring.tsx'), generateRingOverlayTsx())
    } else {
      await writeFile(
        resolve(assetsDir, 'ring.html'),
        generateRingOverlayHtml()
      )
    }
    if (packageManager === 'pnpm') {
      // Resolve (and gate on) the pnpm version before writing the workspace
      // file so the build-approval key matches the installed pnpm.
      const pnpmVersionSupport = await ensureSupportedPnpmVersion(islandDir)
      await writeFile(
        resolve(islandDir, 'pnpm-workspace.yaml'),
        generatePnpmWorkspaceYaml(pnpmMajorFromSupport(pnpmVersionSupport))
      )
    }
    if (packageManager === 'yarn') {
      await writeFile(
        resolve(islandDir, '.yarnrc.yml'),
        'nodeLinker: node-modules\n'
      )
    }

    if (shouldWriteGithubActionWorkflow) {
      await mkdir(githubWorkflowsDir, { recursive: true })
      await writeFile(
        githubActionPath,
        generateGithubAction(packageManager, islandWorkflowPath)
      )
    }

    // Install skills at the repo root so coding agents discover them when the
    // repository is opened as the workspace.
    if (skillsArgs !== null) {
      if (verbose) {
        logger.info(`Running '${skillsCommand}'...`)
        await spawnInherited(
          commands.skillsCommand,
          skillsArgs,
          repoRoot,
          'screenci init'
        )
      } else {
        const spinner = ora('Adding selected AI skills...').start()
        try {
          await spawnSilent(commands.skillsCommand, skillsArgs, repoRoot)
          spinner.succeed('Installing selected AI skills')
        } catch (err) {
          spinner.fail('AI skills install failed')
          throw err
        }
      }
    }

    await installInitDependencies(
      islandDir,
      verbose,
      screenciDependency,
      shouldInstallPlaywrightCli,
      shouldAddReactOverlays,
      commands
    )

    if (shouldInstallPlaywrightBrowsers) {
      logger.info(
        `Installing Playwright Chromium headless shell with '${commands.playwrightRun} install --only-shell chromium'...`
      )
      const [browserCmd, ...browserArgs] = buildPlaywrightSpawnArgs(
        packageManager,
        'install',
        '--only-shell',
        'chromium'
      )
      await spawnInherited(browserCmd!, browserArgs, islandDir, 'screenci init')
      logger.info(
        `${pc.green('✔')} Playwright Chromium headless shell installed successfully`
      )
    }

    if (shouldInstallPlaywrightOsDependencies) {
      logger.info(
        `Installing Playwright operating system dependencies with '${commands.playwrightRun} install-deps chromium'...`
      )
      const [depsCmd, ...depsArgs] = buildPlaywrightSpawnArgs(
        packageManager,
        'install-deps',
        'chromium'
      )
      await spawnInherited(depsCmd!, depsArgs, islandDir, 'screenci init')
      logger.info(
        `${pc.green('✔')} Playwright operating system dependencies installed successfully`
      )
    }

    scaffoldComplete = true
  } catch (err) {
    removePartialIsland()
    throw err
  } finally {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
    process.off('exit', removePartialIsland)
  }

  const secretOutcome = await setUpInitSecret(
    islandDir,
    pastedSecret ? { pastedSecret } : {}
  )

  printInitNextSteps(islandDir, islandDirName, packageManager, secretOutcome)
}

function handleCreateCommanderError(err: unknown): void {
  if (!(err instanceof CommanderError)) {
    throw err
  }

  if (err.code === 'commander.help' || err.code === 'commander.helpDisplayed') {
    return
  }

  logger.error(`Error: ${err.message}`)
  process.exit(1)
}

/**
 * Registers the shared `init` toggle flags on a commander program/command.
 * Both entry points (`create-screenci` and `screenci init`) must expose the
 * exact same flag set, so it lives in one place.
 */
export function registerInitToggleOptions<T extends Command>(target: T): T {
  return target
    .option('--no-github-workflow', 'skip adding the GitHub Actions workflow')
    .option(
      '--no-skills',
      'skip installing AI agent skills (ScreenCI + playwright-cli)'
    )
    .option(
      '--no-playwright-cli',
      'skip the playwright-cli skill and @playwright/cli dependency'
    )
    .option('--no-react', 'skip React overlay support (react/react-dom, JSX)')
    .option('--no-playwright-browsers', 'skip installing Playwright browsers')
    .option(
      '--playwright-os-deps',
      'install Playwright operating system dependencies (may require sudo)'
    )
}

/**
 * Maps the commander-parsed toggle flags onto `InitOptions`. Negatable flags
 * (`--no-*`) default to `true` in commander, so they are always defined;
 * `--playwright-os-deps` is only defined when passed. Undefined values are
 * omitted to satisfy `exactOptionalPropertyTypes`.
 */
export function initToggleOptionsFromCommander(
  options: Record<string, unknown>
): Partial<InitOptions> {
  const bool = (key: string): boolean | undefined =>
    typeof options[key] === 'boolean' ? (options[key] as boolean) : undefined
  const result: Partial<InitOptions> = {}
  const githubWorkflow = bool('githubWorkflow')
  if (githubWorkflow !== undefined) result.githubWorkflow = githubWorkflow
  const skills = bool('skills')
  if (skills !== undefined) result.skills = skills
  const playwrightCli = bool('playwrightCli')
  if (playwrightCli !== undefined) result.playwrightCli = playwrightCli
  const react = bool('react')
  if (react !== undefined) result.react = react
  const playwrightBrowsers = bool('playwrightBrowsers')
  if (playwrightBrowsers !== undefined)
    result.playwrightBrowsers = playwrightBrowsers
  const playwrightOsDeps = bool('playwrightOsDeps')
  if (playwrightOsDeps !== undefined) result.playwrightOsDeps = playwrightOsDeps
  return result
}

export async function runCreateScreenciCli(
  argv: string[] = process.argv
): Promise<void> {
  const defaultPackageManager = determinePackageManager()
  const program = new Command()
  program.name('create-screenci')
  program.description('Initialize a new screenci project')
  program.argument('[name]')
  program.exitOverride()
  program.option(
    '--agent <name>',
    'target agent for skills install, e.g. opencode. Supported agents: https://github.com/vercel-labs/skills#supported-agents'
  )
  program.option(
    '--package-manager <manager>',
    `package manager to use: npm, pnpm, or yarn (default: ${defaultPackageManager})`
  )
  program.option('-y, --yes', 'accept init defaults')
  program.option('-v, --verbose', 'verbose output')
  registerInitToggleOptions(program)
  program.action(
    async (name: string | undefined, options: Record<string, unknown>) => {
      const agent = options['agent'] as string | undefined
      await runInit(name, {
        verbose: (options['verbose'] as boolean | undefined) ?? false,
        yes: (options['yes'] as boolean | undefined) ?? false,
        packageManager: parsePackageManager(
          options['packageManager'] as string | undefined,
          getInitProjectRoot()
        ),
        ...(agent !== undefined ? { agent } : {}),
        ...initToggleOptionsFromCommander(options),
      })
    }
  )

  try {
    await program.parseAsync(argv)
  } catch (err) {
    handleCreateCommanderError(err)
  }
}

export function generateConfig(projectName: string): string {
  return `import { defineConfig } from 'screenci'

export default defineConfig({
  // Used to identify this project in ScreenCI.
  projectName: ${JSON.stringify(projectName)},
  // Load SCREENCI_SECRET and other env vars from this file.
  envFile: '.env',
  // Look for *.screenci.ts files in this directory.
  recordingDir: './recordings',
  // Let independent video files run in parallel.
  fullyParallel: true,
  // Make sure CI recordings are smooth even if resources are constrained
  // by limiting to 1 worker. Locally, use as many workers as possible for speed.
  workers: process.env.CI ? 1 : undefined,
  use: {
    recordOptions: {
      aspectRatio: '16:9',
      quality: '1080p',
      fps: 60,
      // Lightest encode on constrained CI runners; full quality locally.
      encoder: process.env.CI ? 'fast' : 'sharp',
    },
    // Shared framing for videos and screenshots
    renderOptions: {
      screenshot: { margin: 64 },
      output: {
        background: {
          // ScreenCI brand orange, baked into layered gradients (the renderer
          // screenshots this CSS once, so the motion is in the gradient, not animated).
          backgroundCss:
            'radial-gradient(circle at 14% 10%, oklch(0.93 0.07 78) 0%, transparent 42%),' +
            'radial-gradient(circle at 62% 30%, oklch(0.88 0.1 72) 0%, transparent 40%),' +
            'radial-gradient(circle at 32% 78%, oklch(0.84 0.12 66.29) 0%, transparent 44%),' +
            'radial-gradient(circle at 88% 86%, oklch(0.5 0.16 37.304) 0%, transparent 52%),' +
            'linear-gradient(313deg, oklch(0.74 0.18 50) 0%, oklch(0.69 0.21 45) 38%, oklch(0.62 0.21 41.116) 72%, oklch(0.52 0.18 38.402) 100%)',
        },
      },
      recording: {
        roundness: 0.04,
        dropShadow: 'drop-shadow(0 12px 32px rgba(0, 0, 0, 0.22))',
      },
    },
  },
  projects: [
    {
      // ScreenCI currently supports Chromium only
      name: 'chromium',
    },
  ],
})
`
}
