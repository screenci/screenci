import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { existsSync, realpathSync } from 'fs'
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
export type PackageManager = 'npm' | 'pnpm'

export type InitOptions = {
  verbose: boolean
  yes: boolean
  packageManager: PackageManager
  agent?: string
}

const MIN_SUPPORTED_PNPM_VERSION = '10.26.0'

export type PnpmVersionSupport = {
  supported: boolean
  detectedVersion?: string
  reason:
    | 'supported'
    | 'pnpm-not-found'
    | 'malformed-version'
    | 'version-too-old'
}

export function determinePackageManager(): PackageManager {
  const userAgent = process.env.npm_config_user_agent
  if (userAgent?.includes('pnpm')) {
    return 'pnpm'
  }

  return 'npm'
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

  const windowsCmdShims = new Set(['npm', 'npx', 'playwright', 'pnpm'])
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

export function parsePackageManager(value: string | undefined): PackageManager {
  if (value === undefined) {
    return determinePackageManager()
  }

  if (value === 'npm' || value === 'pnpm') {
    return value
  }

  throw new Error('Expected package manager to be one of: npm, pnpm')
}

function getPackageManagerCommand(packageManager: PackageManager): {
  screenciRun: string
  playwrightRun: string
  installCommand: string
  installArgs: (pkg: string) => string[]
  skillsCommand: string
  skillsArgs: (skills: string[], agent?: string) => string[]
  cacheName: PackageManager
  lockfileName: string
} {
  if (packageManager === 'pnpm') {
    return {
      screenciRun: 'pnpm exec screenci',
      playwrightRun: 'pnpm exec playwright',
      installCommand: 'pnpm',
      installArgs: (pkg) => ['add', '--save-dev', pkg],
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
    }
  }

  return {
    screenciRun: 'npx screenci',
    playwrightRun: 'npx playwright',
    installCommand: 'npm',
    installArgs: (pkg) => ['install', '--save-dev', pkg],
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
  }
}

function getSkillsManualCommand(
  packageManager: PackageManager,
  skills: string[],
  agent?: string
): string {
  return [
    packageManager === 'pnpm' ? 'pnpm' : 'npx',
    ...(packageManager === 'pnpm' ? ['dlx'] : []),
    'skills',
    'add',
    'screenci/screenci',
  ]
    .concat(agent ? ['--agent', agent] : [])
    .concat(skills.flatMap((skillName) => ['--skill', skillName]))
    .concat(['-y'])
    .join(' ')
}

function generateEmptyPackageJson(): string {
  return '{\n  "type": "module"\n}\n'
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

function generateGitignore(): string {
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
`
}

async function writeInitGitignore(projectDir: string): Promise<void> {
  const gitignorePath = resolve(projectDir, '.gitignore')

  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, generateGitignore())
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
  await appendFile(gitignorePath, `${separator}${generateGitignore()}`)
}

async function installInitDependencies(
  projectDir: string,
  verbose: boolean,
  screenciDependency: string,
  includePlaywrightCli: boolean,
  packageManager: PackageManager
): Promise<void> {
  const commands = getPackageManagerCommand(packageManager)
  const installSteps: Array<{ message: string; args: string[] }> = [
    {
      message: 'Installing Playwright Test...',
      args: commands.installArgs(`@playwright/test@${PLAYWRIGHT_TEST_VERSION}`),
    },
    {
      message: 'Installing ScreenCI...',
      args:
        packageManager === 'pnpm'
          ? [
              'add',
              '--save-dev',
              '--allow-build=ffmpeg-static',
              `screenci@${screenciDependency}`,
            ]
          : commands.installArgs(`screenci@${screenciDependency}`),
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
  logger.info(`  ${pc.cyan(`${commands.screenciRun} login`)}`)
  logger.info('    Saves SCREENCI_SECRET for uploads and remote rendering.')
  logger.info('')
  logger.info(`  ${pc.cyan(`${commands.screenciRun} record`)}`)
  logger.info('    Records, uploads and renders final videos after login.')
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

function generateGithubAction(packageManager: PackageManager): string {
  const commands = getPackageManagerCommand(packageManager)
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
        run: ${packageManager === 'pnpm' ? 'pnpm install --frozen-lockfile' : 'npm ci'}

      - name: Cache Playwright Chromium
        uses: actions/cache@v5
        id: pw-cache
        with:
          path: ~/.cache/ms-playwright
          key: playwright-\${{ runner.os }}-\${{ hashFiles('${commands.lockfileName}') }}

      - name: Install Chromium
        if: steps.pw-cache.outputs.cache-hit != 'true'
        working-directory: .
        run: ${commands.playwrightRun} install chromium

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
    `Install Playwright browsers (can be done manually via '${commands.playwrightRun} install chromium')? (Y/n)`,
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
  const installPlaywrightCli =
    packageManager === 'pnpm'
      ? 'pnpm add --save-dev @playwright/cli'
      : 'npm install @playwright/cli'
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
  const commands = getPackageManagerCommand(packageManager)
  const initCwd = getInitProjectRoot()

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
  }
  await writeInitGitignore(projectDir)
  await writeFile(
    resolve(projectDir, 'videos', 'example.video.ts'),
    generateExampleVideo()
  )
  if (shouldAddGithubActionWorkflow) {
    await writeFile(githubActionPath, generateGithubAction(packageManager))
  }

  if (packageManager === 'pnpm') {
    await ensureSupportedPnpmVersion(projectDir)
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
    packageManager
  )

  if (shouldInstallPlaywrightBrowsers) {
    logger.info(
      `Installing Playwright Chromium with '${commands.playwrightRun} install chromium'...`
    )
    await spawnInherited(
      packageManager === 'pnpm' ? 'pnpm' : 'npx',
      packageManager === 'pnpm'
        ? ['exec', 'playwright', 'install', 'chromium']
        : ['playwright', 'install', 'chromium'],
      projectDir,
      'screenci init'
    )
    logger.info(`${pc.green('✔')} Playwright Chromium installed successfully`)
  }

  if (shouldInstallPlaywrightOsDependencies) {
    logger.info(
      `Installing Playwright operating system dependencies with '${commands.playwrightRun} install-deps chromium'...`
    )
    await spawnInherited(
      packageManager === 'pnpm' ? 'pnpm' : 'npx',
      packageManager === 'pnpm'
        ? ['exec', 'playwright', 'install-deps', 'chromium']
        : ['playwright', 'install-deps', 'chromium'],
      projectDir,
      'screenci init'
    )
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
    `package manager to use: npm or pnpm (default: ${defaultPackageManager})`
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
          options['packageManager'] as string | undefined
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
