import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { existsSync, readFileSync, realpathSync } from 'fs'
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { basename, delimiter, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { Command, CommanderError } from 'commander'
import { input } from '@inquirer/prompts'
import ora from 'ora'
import pc from 'picocolors'
import { logger } from './logger.js'

const PLAYWRIGHT_TEST_VERSION = '^1.59.0'
const PLAYWRIGHT_CLI_VERSION = 'latest'
const NODE_TYPES_VERSION = '^25.9.1'
export type PackageManager = 'npm' | 'pnpm' | 'yarn'

export type InitOptions = {
  verbose: boolean
  yes: boolean
  packageManager: PackageManager
  agent?: string
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
  const userAgent = process.env.npm_config_user_agent
  if (userAgent?.includes('pnpm')) return 'pnpm'
  if (userAgent?.includes('yarn')) return 'yarn'

  // Filesystem detection is only performed during init (when cwd is provided).
  // record/test commands rely solely on the user agent, which correctly reflects
  // how the CLI was invoked (e.g. "pnpm exec screenci record" sets the agent).
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

function detectYarnWorkspace(cwd: string): boolean {
  try {
    const raw = readFileSync(resolve(cwd, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as { workspaces?: unknown }
    return pkg.workspaces !== undefined
  } catch {
    return false
  }
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
  installArgs: (pkg: string) => string[]
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
      installArgs: (pkg) => ['add', '--save-dev', ...workspaceFlag, pkg],
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
      installArgs: (pkg) => ['add', '--dev', ...workspaceFlag, pkg],
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
    installArgs: (pkg) => ['install', '--save-dev', pkg],
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

function getSkillsManualCommand(
  packageManager: PackageManager,
  skills: string[],
  agent?: string
): string {
  const prefix =
    packageManager === 'pnpm'
      ? ['pnpm', 'dlx']
      : packageManager === 'yarn'
        ? ['yarn', 'dlx']
        : ['npx']
  return [...prefix, 'skills', 'add', 'screenci/screenci']
    .concat(agent ? ['--agent', agent] : [])
    .concat(skills.flatMap((skillName) => ['--skill', skillName]))
    .concat(['-y'])
    .join(' ')
}

function generateEmptyPackageJson(): string {
  return '{\n  "type": "module"\n}\n'
}

async function ensurePackageJsonTypeModule(
  packageJsonPath: string
): Promise<void> {
  try {
    const raw = await readFile(packageJsonPath, 'utf-8')
    const pkg = JSON.parse(raw) as Record<string, unknown>
    if (pkg['type'] === 'module') return
    pkg['type'] = 'module'
    await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n')
  } catch {
    // Malformed or unreadable package.json — leave it untouched.
  }
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

async function ensureSupportedPnpmVersion(cwd: string): Promise<void> {
  const versionSupport = await detectPnpmVersionSupport(cwd)
  if (!versionSupport.supported) {
    throw buildUnsupportedPnpmError(versionSupport)
  }
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

function generateGitignore(packageManager: PackageManager = 'npm'): string {
  const yarnSection = packageManager === 'yarn' ? '\n# Yarn\n.yarn/\n' : ''
  return `# ScreenCI
.screenci
.playwright-cli/
.env

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
  commands: ReturnType<typeof getPackageManagerCommand>
): Promise<void> {
  const installSteps: Array<{ message: string; args: string[] }> = [
    {
      message: 'Installing Playwright Test...',
      args: commands.installArgs(`@playwright/test@${PLAYWRIGHT_TEST_VERSION}`),
    },
    {
      message: 'Installing ScreenCI...',
      args: commands.screenciInstallArgs(`screenci@${screenciDependency}`),
    },
    {
      message: 'Installing Node.js types...',
      args: commands.installArgs(`@types/node@${NODE_TYPES_VERSION}`),
    },
  ]

  if (includePlaywrightCli) {
    installSteps.push({
      message: 'Installing playwright-cli...',
      args: commands.installArgs(`@playwright/cli@${PLAYWRIGHT_CLI_VERSION}`),
    })
  }

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

function printInitNextSteps(
  projectDir: string,
  packageManager: PackageManager
): void {
  const resolvedProjectDir = realpathSync(projectDir)
  const commands = getPackageManagerCommand(packageManager)

  logger.info(
    `${pc.green('✔ Success!')} Created a ScreenCI project at ${resolvedProjectDir}`
  )
  logger.info('')
  logger.info('Inside that directory, you can run several commands:')
  logger.info('')
  logger.info(`  ${pc.cyan(`${commands.screenciRun} test`)}`)
  logger.info('    Tests your video scripts fast locally.')
  logger.info('')
  logger.info(`  ${pc.cyan(`${commands.screenciRun} test --ui`)}`)
  logger.info('    Tests your video scripts in interactive UI mode.')
  logger.info('')
  logger.info(`  ${pc.cyan(`${commands.screenciRun} record`)}`)
  logger.info(
    '    Records locally and pauses for first-time ScreenCI setup if needed.'
  )
  logger.info('')
  logger.info('We suggest that you begin by typing:')
  logger.info('')
  logger.info(`    ${pc.cyan(`${commands.screenciRun} test`)}`)
  logger.info('')
  logger.info('And check out the following files:')
  logger.info('  - ./videos/example.video.ts - Example video script')
  logger.info('  - ./screenci.config.ts - ScreenCI configuration')
  logger.info('')
  logger.info(
    `Visit ${pc.cyan('https://screenci.com/docs')} for more information.`
  )
  logger.info('')
  logger.info('Happy hacking! 🎥')
}

function generateGithubAction(
  packageManager: PackageManager,
  isWorkspace = false
): string {
  const commands = getPackageManagerCommand(packageManager, isWorkspace)
  return `name: ScreenCI

on:
  push:
    branches: [main]
  workflow_dispatch:

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

      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: ${commands.cacheName}
          cache-dependency-path: ${commands.lockfileName}

      - name: Install dependencies
        working-directory: .
        env:
          HUSKY: 0
          npm_config_strict_dep_builds: false
        run: ${commands.frozenInstallCommand}

      - name: Install Chromium Headless Shell
        working-directory: .
        run: ${commands.playwrightRun} install --only-shell chromium

      - id: record
        name: Record
        working-directory: .
        env:
          SCREENCI_SECRET: \${{ secrets.SCREENCI_SECRET }}
        run: ${commands.screenciRun} record
`
}

export function generateExampleVideo(): string {
  return `import { autoZoom, createNarration, hide, video, voices } from 'screenci'

const narration = createNarration({
  // Default voice settings for all languages.
  voice: { name: voices.Sophie },
  // Localized narration cues by language.
  en: {
    docs: 'Here is where to find ScreenCI [pronounce: screen see eye] docs.',
  },
  es: {
    docs: 'Aqui es donde encontrar la documentacion de ScreenCI [pronounce: screen see eye].',
  },
})

video('How to find docs', async ({ page }) => {
  // Run setup without showing these actions in the final recording.
  await hide(async () => {
    await page.goto('https://screenci.com/')
    await page.waitForLoadState('networkidle')
  })

  // Play the matching narration line for this step.
  await narration.docs()

  // Automatically zoom into interactions so they are easier to follow.
  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })
})
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
    default: defaultValue ? 'y' : 'n',
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
  return promptYesNo('Add a GitHub Actions workflow? (Y/n)', true)
}

async function promptInitPlaywrightBrowsersForPackageManager(
  packageManager: PackageManager
): Promise<boolean> {
  const commands = getPackageManagerCommand(packageManager)
  return promptYesNo(
    `Install Playwright browsers (can be done manually via '${commands.playwrightRun} install --only-shell chromium')? (Y/n)`,
    true
  )
}

async function promptInitPlaywrightOsDependenciesForPackageManager(
  packageManager: PackageManager
): Promise<boolean> {
  const commands = getPackageManagerCommand(packageManager)
  return promptYesNo(
    `Install Playwright operating system dependencies (might require sudo / root and can be done manually via '${commands.playwrightRun} install-deps chromium')? (y/N)`,
    false
  )
}

async function promptInitScreenCISkill(
  packageManager: PackageManager,
  agent?: string
): Promise<boolean> {
  return promptYesNo(
    `Install the ScreenCI skill for AI agents (can be done manually via '${getSkillsManualCommand(packageManager, ['screenci'], agent)}')? (Y/n)`,
    true
  )
}

async function promptInitPlaywrightCliSkillForPackageManager(
  packageManager: PackageManager,
  agent?: string
): Promise<boolean> {
  const cmds = getPackageManagerCommand(packageManager)
  const installPlaywrightCli = [
    cmds.installCommand,
    ...cmds.installArgs('@playwright/cli'),
  ].join(' ')
  return promptYesNo(
    `Install playwright-cli for URL-based browser inspection (can be done manually via '${getSkillsManualCommand(packageManager, ['playwright-cli'], agent)} && ${installPlaywrightCli}')? (Y/n)`,
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
  const isWorkspace =
    packageManager === 'pnpm'
      ? detectPnpmWorkspace(initCwd)
      : packageManager === 'yarn'
        ? detectYarnWorkspace(initCwd)
        : false
  const commands = getPackageManagerCommand(packageManager, isWorkspace)

  if (packageManager === 'yarn') {
    await ensureSupportedYarnVersion(initCwd)
  }

  let projectName = projectNameArg?.trim()

  if (!projectName) {
    projectName = yes ? getDefaultInitProjectName() : await promptProjectName()
  }

  if (!projectName) {
    logger.error('Error: Project name is required')
    process.exit(1)
  }

  const projectDir = initCwd
  const githubWorkflowsDir = resolve(projectDir, '.github', 'workflows')
  const githubActionPath = resolve(githubWorkflowsDir, 'screenci.yaml')
  const shouldAddGithubActionWorkflow = yes
    ? true
    : await promptInitGithubActionWorkflow()
  const shouldInstallPlaywrightBrowsers = yes
    ? true
    : await promptInitPlaywrightBrowsersForPackageManager(packageManager)
  const shouldInstallPlaywrightOsDependencies = yes
    ? false
    : await promptInitPlaywrightOsDependenciesForPackageManager(packageManager)
  const shouldInstallScreenCISkill = yes
    ? true
    : await promptInitScreenCISkill(packageManager, agent)
  const shouldInstallPlaywrightCli = yes
    ? true
    : await promptInitPlaywrightCliSkillForPackageManager(packageManager, agent)

  if (shouldAddGithubActionWorkflow && existsSync(githubActionPath)) {
    logger.error(
      'Error: GitHub Actions workflow ".github/workflows/screenci.yaml" already exists'
    )
    process.exit(1)
  }

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
  const packageJsonPath = resolve(projectDir, 'package.json')
  const hasExistingPackageJson = existsSync(packageJsonPath)

  await mkdir(resolve(projectDir, 'videos'), { recursive: true })
  if (shouldAddGithubActionWorkflow) {
    await mkdir(githubWorkflowsDir, { recursive: true })
  }
  await writeFile(
    resolve(projectDir, 'screenci.config.ts'),
    generateConfig(projectName)
  )
  if (!hasExistingPackageJson) {
    await writeFile(packageJsonPath, generateEmptyPackageJson())
  } else {
    await ensurePackageJsonTypeModule(packageJsonPath)
  }
  await writeInitGitignore(projectDir, packageManager)
  await writeFile(
    resolve(projectDir, 'videos', 'example.video.ts'),
    generateExampleVideo()
  )
  if (shouldAddGithubActionWorkflow) {
    await writeFile(
      githubActionPath,
      generateGithubAction(packageManager, isWorkspace)
    )
  }

  if (packageManager === 'pnpm') {
    await ensureSupportedPnpmVersion(projectDir)
  }

  if (packageManager === 'yarn') {
    await writeFile(
      resolve(projectDir, '.yarnrc.yml'),
      'nodeLinker: node-modules\n'
    )
  }

  if (skillsArgs !== null) {
    if (verbose) {
      logger.info(`Running '${skillsCommand}'...`)
      await spawnInherited(
        commands.skillsCommand,
        skillsArgs,
        projectDir,
        'screenci init'
      )
    } else {
      const spinner = ora('Adding selected AI skills...').start()
      try {
        await spawnSilent(commands.skillsCommand, skillsArgs, projectDir)
        spinner.succeed('Installing selected AI skills')
      } catch (err) {
        spinner.fail('AI skills install failed')
        throw err
      }
    }
  }

  await installInitDependencies(
    projectDir,
    verbose,
    screenciDependency,
    shouldInstallPlaywrightCli,
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
    await spawnInherited(browserCmd!, browserArgs, projectDir, 'screenci init')
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
    await spawnInherited(depsCmd!, depsArgs, projectDir, 'screenci init')
    logger.info(
      `${pc.green('✔')} Playwright operating system dependencies installed successfully`
    )
  }

  printInitNextSteps(projectDir, packageManager)
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
      })
    }
  )

  try {
    await program.parseAsync(argv)
  } catch (err) {
    handleCreateCommanderError(err)
  }
}

function generateConfig(projectName: string): string {
  return `import { defineConfig } from 'screenci'

export default defineConfig({
  // Used to identify this project in ScreenCI.
  projectName: ${JSON.stringify(projectName)},
  // Load SCREENCI_SECRET and other env vars from this file.
  envFile: '.env',
  // Look for *.video.ts files in this directory.
  videoDir: './videos',
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
