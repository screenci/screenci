#!/usr/bin/env -S npx tsx

import { spawn, spawnSync } from 'child_process'
import { createReadStream } from 'fs'
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'fs'
import { createHash } from 'crypto'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { dirname, relative as pathRelative, resolve } from 'path'
import { createInterface } from 'readline/promises'
import { fileURLToPath } from 'url'
import { logger } from './src/logger.js'
import type { RecordingData } from './src/events.js'
import type { ScreenCIConfig } from './src/types.js'

function clearDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true })
  for (const entry of readdirSync(dir)) {
    rmSync(resolve(dir, entry), { recursive: true, force: true })
  }
}

function findScreenCIConfig(customPath?: string): string | null {
  if (customPath) {
    const resolvedPath = resolve(process.cwd(), customPath)
    if (existsSync(resolvedPath)) {
      return resolvedPath
    }
    return null
  }

  const cwd = process.cwd()
  const configPath = resolve(cwd, 'screenci.config.ts')

  if (existsSync(configPath)) {
    return configPath
  }

  return null
}

function findRepoRoot(startDir: string): string | null {
  let current = startDir
  while (true) {
    if (
      existsSync(resolve(current, '.git')) ||
      existsSync(resolve(current, 'pnpm-workspace.yaml'))
    ) {
      return current
    }
    const parent = resolve(current, '..')
    if (parent === current) return null
    current = parent
  }
}

function parseArgs(args: string[]): {
  command: string
  configPath: string | undefined
  noContainer: boolean
  otherArgs: string[]
} {
  const command = args[0]
  if (command === undefined) {
    logger.error('Error: No command provided')
    logger.error('Available commands: record, dev, upload-latest, init')
    process.exit(1)
  }
  let configPath: string | undefined
  let noContainer = false
  const otherArgs: string[] = []

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--config' || arg === '-c') {
      const nextArg = args[i + 1]
      if (nextArg !== undefined) {
        configPath = nextArg
        i++ // skip next arg
      } else {
        logger.error('Error: --config requires a path argument')
        process.exit(1)
      }
    } else if (arg === '--no-container') {
      noContainer = true
    } else if (arg !== undefined) {
      otherArgs.push(arg)
    }
  }

  return { command, configPath, noContainer, otherArgs }
}

async function findLatestEntry(screenciDir: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await readdir(screenciDir)
  } catch {
    return null
  }

  let latestEntry: string | null = null
  let latestMtime = 0

  for (const entry of entries) {
    try {
      const entryPath = resolve(screenciDir, entry)
      const s = await stat(entryPath)
      if (s.mtimeMs > latestMtime) {
        latestMtime = s.mtimeMs
        latestEntry = entry
      }
    } catch {
      // skip unreadable entries
    }
  }

  return latestEntry
}

async function uploadAssets(
  data: RecordingData,
  apiUrl: string,
  secret: string,
  recordingId: string,
  configDir: string
): Promise<void> {
  type AssetStartEvent = Extract<
    RecordingData['events'][number],
    { type: 'assetStart' }
  >
  const assetEvents = (data.events as RecordingData['events']).filter(
    (e): e is AssetStartEvent => e.type === 'assetStart'
  )
  if (assetEvents.length === 0) return

  // Deduplicate by name — each unique asset name is uploaded once
  const seenNames = new Set<string>()
  for (const event of assetEvents) {
    const assetPath = event.path
    if (seenNames.has(event.name)) continue
    seenNames.add(event.name)

    // Resolve the asset file. Recording runs in a Docker container where configDir → /app,
    // so stored paths may be container-internal absolute or relative paths.
    // Resolution order:
    //   1. Path as-is (works for absolute host paths)
    //   2. Relative path resolved from configDir/videos (the video scripts directory)
    //   3. Container path translated: /some/path → configDir/../some/path
    const candidates = [
      assetPath,
      resolve(configDir, 'videos', assetPath),
      resolve(configDir, pathRelative('/app', assetPath)),
    ]
    let fileBuffer: Buffer | undefined
    let resolvedPath = assetPath
    for (const candidate of candidates) {
      try {
        fileBuffer = await readFile(candidate)
        resolvedPath = candidate
        break
      } catch {
        // try next
      }
    }
    if (fileBuffer === undefined) {
      logger.warn(`Asset file not found, skipping upload: ${assetPath}`)
      continue
    }

    const sha256 = createHash('sha256').update(fileBuffer).digest('hex')
    const ext = assetPath.split('.').pop()?.toLowerCase() ?? 'bin'
    const contentTypeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      webm: 'video/webm',
      svg: 'image/svg+xml',
    }
    const contentType = contentTypeMap[ext] ?? 'application/octet-stream'

    try {
      const res = await fetch(`${apiUrl}/cli/upload/${recordingId}/asset`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-ScreenCI-Secret': secret,
        },
        body: JSON.stringify({
          sha256,
          fileBase64: fileBuffer.toString('base64'),
          contentType,
          assetName: event.name,
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        logger.warn(
          `Failed to upload asset ${assetPath}: ${res.status} ${text}`
        )
      } else {
        logger.info(`Asset uploaded: ${assetPath}`)
      }
    } catch (err) {
      logger.warn(`Network error uploading asset ${assetPath}:`, err)
    }
  }
}

async function uploadRecordings(
  screenciDir: string,
  projectName: string,
  apiUrl: string,
  secret: string,
  specificEntry?: string
): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(screenciDir)
  } catch {
    logger.warn('No .screenci directory found, skipping upload')
    return
  }

  if (specificEntry !== undefined) {
    entries = entries.filter((e) => e === specificEntry)
  }

  for (const entry of entries) {
    const dataJsonPath = resolve(screenciDir, entry, 'data.json')
    if (!existsSync(dataJsonPath)) continue

    let data: RecordingData
    try {
      const raw = await readFile(dataJsonPath, 'utf-8')
      data = JSON.parse(raw) as RecordingData
    } catch {
      logger.warn(`Failed to read ${dataJsonPath}, skipping`)
      continue
    }

    const videoName = data.metadata?.videoName ?? entry

    logger.info(`Uploading "${videoName}"...`)
    try {
      // Step 1: register upload and get recordingId
      const startResponse = await fetch(`${apiUrl}/cli/upload/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ScreenCI-Secret': secret,
        },
        body: JSON.stringify({ projectName, videoName, data }),
      })
      if (!startResponse.ok) {
        const text = await startResponse.text()
        logger.warn(
          `Failed to start upload for "${videoName}": ${startResponse.status} ${text}`
        )
        continue
      }
      const { recordingId } = (await startResponse.json()) as {
        recordingId: string
      }

      // Step 1b: upload asset files referenced in data.json
      await uploadAssets(
        data,
        apiUrl,
        secret,
        recordingId,
        resolve(screenciDir, '..')
      )

      // Step 2: stream the recording video file (if it exists)
      const recordingPath = resolve(screenciDir, entry, 'recording.mp4')
      if (existsSync(recordingPath)) {
        const fileStat = await stat(recordingPath)
        const stream = createReadStream(recordingPath)
        const recordingResponse = await fetch(
          `${apiUrl}/cli/upload/${recordingId}/recording`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'video/mp4',
              'Content-Length': String(fileStat.size),
              'X-ScreenCI-Secret': secret,
            },
            body: stream as unknown as BodyInit,
            // @ts-expect-error Node.js fetch supports duplex for streaming
            duplex: 'half',
          }
        )
        if (!recordingResponse.ok) {
          const text = await recordingResponse.text()
          logger.warn(
            `Failed to upload recording for "${videoName}": ${recordingResponse.status} ${text}`
          )
          continue
        }
      }

      logger.info(`Uploaded "${videoName}" successfully`)
    } catch (err) {
      logger.warn(`Network error uploading "${videoName}":`, err)
    }
  }
}

async function uploadLatest(configPath: string | undefined): Promise<void> {
  const resolvedConfigPath = findScreenCIConfig(configPath)
  if (!resolvedConfigPath) {
    const errorMsg = configPath
      ? `Error: Config file not found: ${configPath}`
      : 'Error: screenci.config.ts not found in current directory'
    logger.error(errorMsg)
    process.exit(1)
  }

  let screenciConfig: ScreenCIConfig
  try {
    const configModule = await import(resolvedConfigPath)
    screenciConfig = configModule.default as ScreenCIConfig
  } catch (err) {
    logger.error('Failed to load config:', err)
    process.exit(1)
  }

  if (screenciConfig.envFile) {
    const envFilePath = resolve(
      dirname(resolvedConfigPath),
      screenciConfig.envFile
    )
    try {
      process.loadEnvFile(envFilePath)
    } catch (err) {
      logger.warn(`Failed to load env file ${envFilePath}:`, err)
    }
  }

  const convexUrl = screenciConfig.apiUrl ?? process.env.SCREENCI_URL
  if (!convexUrl) {
    logger.error(
      'No API URL configured. Set apiUrl in screenci.config.ts or SCREENCI_URL env var.'
    )
    process.exit(1)
  }

  const secret = process.env.SCREENCI_SECRET
  if (!secret) {
    logger.error(
      'No secret configured. Set SCREENCI_SECRET in your .env file (get it from the API Key page in the dashboard).'
    )
    process.exit(1)
  }

  const configDir = dirname(resolvedConfigPath)
  const screenciDir = resolve(configDir, '.screenci')

  const latestEntry = await findLatestEntry(screenciDir)
  if (!latestEntry) {
    logger.warn('No recordings found in .screenci directory')
    return
  }

  logger.info(`Uploading latest recording: "${latestEntry}"`)
  await uploadRecordings(
    screenciDir,
    screenciConfig.projectName,
    convexUrl,
    secret,
    latestEntry
  )
}

function generateConfig(projectName: string): string {
  return `import { defineConfig } from 'screenci'

export default defineConfig({
  projectName: ${JSON.stringify(projectName)},
  apiUrl: process.env.SCREENCI_URL ?? 'http://localhost:8787',
  envFile: '.env',
  videoDir: './videos',
  forbidOnly: !!process.env.CI,
  reporter: 'html',
  use: {
    trace: 'retain-on-failure',
    sendTraces: true,
    recordOptions: {
      aspectRatio: '16:9',
      quality: '1080p',
      fps: 30,
    },
  },
  projects: [
    {
      name: 'chromium',
    },
  ],
})
`
}

function generatePackageJson(
  projectName: string,
  localPackagePath?: string
): string {
  const npmName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const screenciVersion = localPackagePath
    ? `file:${localPackagePath}`
    : 'latest'
  return (
    JSON.stringify(
      {
        name: npmName,
        version: '1.0.0',
        description: '',
        type: 'module',
        scripts: {
          record: 'screenci record',
          'upload-latest': 'screenci upload-latest',
          dev: 'screenci dev',
        },
        dependencies: {
          screenci: screenciVersion,
        },
        devDependencies: {
          '@types/node': '^25.0.0',
          tsx: '^4.21.0',
        },
      },
      null,
      2
    ) + '\n'
  )
}

function generateDockerfile(): string {
  return `FROM ghcr.io/screenci/record:latest

COPY package.json ./
COPY screenci.config.ts ./
COPY videos ./videos
`
}

function generateGitignore(): string {
  return `/playwright-report/
.screenci
node_modules/
.env
`
}

function generateGithubAction(): string {
  return `name: Record

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  record:
    runs-on: ubuntu-latest
    steps:
      - name: Check SCREENCI_SECRET
        env:
          SCREENCI_SECRET: \${{ secrets.SCREENCI_SECRET }}
        run: |
          if [ -z "$SCREENCI_SECRET" ]; then
            echo "::error::SCREENCI_SECRET is not set. Add it under Settings → Secrets and variables → Actions."
            exit 1
          fi

      - uses: actions/checkout@v4

      - name: Build Docker image
        run: docker build -t screenci-project .

      - name: Record
        env:
          SCREENCI_SECRET: \${{ secrets.SCREENCI_SECRET }}
        run: |
          docker run --rm \\
            -e SCREENCI_SECRET \\
            -e SCREENCI_IN_CONTAINER=true \\
            -e SCREENCI_RECORD=true \\
            screenci-project \\
            npm run record
`
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open'
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref()
}

async function performBrowserLogin(appUrl: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url ?? '/', 'http://localhost')
        const secret = reqUrl.searchParams.get('secret')

        if (secret) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p style="font-size:1.2rem">Authentication successful! You can close this tab.</p></body></html>'
          )
          server.close()
          resolve(secret)
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p style="color:red;font-size:1.2rem">Authentication failed: no secret received. Please try again.</p></body></html>'
          )
          server.close()
          reject(new Error('No secret received in callback'))
        }
      } catch (err) {
        res.writeHead(500)
        res.end('Internal error')
        server.close()
        reject(err)
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      const callbackUrl = `http://localhost:${port}/callback`
      const loginUrl = `${appUrl}/cli-auth?callback=${encodeURIComponent(callbackUrl)}`

      logger.info('Opening browser for authentication...')
      logger.info(`If the browser does not open automatically, visit:`)
      logger.info(`  ${loginUrl}`)

      openBrowser(loginUrl)
    })

    const timeout = setTimeout(
      () => {
        server.close()
        reject(new Error('Authentication timed out after 5 minutes'))
      },
      5 * 60 * 1000
    )

    server.on('close', () => clearTimeout(timeout))
  })
}

function generateExampleVideo(): string {
  return `import { video } from 'screenci'

video('Example video', async ({ page }) => {
  await page.goto('https://example.com')
  await page.waitForTimeout(3000)
})
`
}

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    const answer = await rl.question(question)
    return answer.trim()
  } finally {
    rl.close()
  }
}

async function promptProjectName(): Promise<string> {
  return promptLine('Project name: ')
}

function toKebabCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

async function runInitAuth(): Promise<void> {
  const devPort = process.env.DEV_PORT
  const appUrl =
    process.env.SCREENCI_APP_URL ??
    (devPort ? `http://localhost:${devPort}` : 'https://app.screenci.com')
  try {
    const secret = await performBrowserLogin(appUrl)
    await writeFile(
      resolve(process.cwd(), '.env'),
      `SCREENCI_SECRET=${secret}\n`
    )
    logger.info('API key saved to .env')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`Authentication failed: ${msg}`)
    logger.info(
      'You can add SCREENCI_SECRET manually to .env later (get it from the API Key page in the dashboard).'
    )
  }
}

function checkNodeVersion(): void {
  const [major] = process.versions.node.split('.').map(Number)
  if (major === undefined || major < 18) {
    logger.error(
      `Error: Node.js 18 or higher is required (current: v${process.versions.node})`
    )
    process.exit(1)
  }
}

async function runInit(
  projectNameArg?: string,
  localPackagePath?: string
): Promise<void> {
  checkNodeVersion()

  let projectName = projectNameArg?.trim()

  if (!projectName) {
    projectName = await promptProjectName()
  }

  if (!projectName) {
    logger.error('Error: Project name is required')
    process.exit(1)
  }

  const dirName = toKebabCase(projectName)
  const projectDir = resolve(process.cwd(), dirName)

  if (existsSync(projectDir)) {
    logger.error(`Error: Directory "${dirName}" already exists`)
    process.exit(1)
  }

  await mkdir(resolve(projectDir, 'videos'), { recursive: true })
  await mkdir(resolve(projectDir, '.github', 'workflows'), { recursive: true })
  await writeFile(
    resolve(projectDir, 'screenci.config.ts'),
    generateConfig(projectName)
  )
  await writeFile(
    resolve(projectDir, 'package.json'),
    generatePackageJson(dirName, localPackagePath)
  )
  await writeFile(resolve(projectDir, 'Dockerfile'), generateDockerfile())
  await writeFile(resolve(projectDir, '.gitignore'), generateGitignore())
  await writeFile(
    resolve(projectDir, 'videos', 'example.video.ts'),
    generateExampleVideo()
  )
  await writeFile(
    resolve(projectDir, '.github', 'workflows', 'record.yml'),
    generateGithubAction()
  )

  logger.info(`Initialized screenci project "${projectName}" in ${dirName}/`)
  logger.info('Files created:')
  logger.info('  screenci.config.ts')
  logger.info('  package.json')
  logger.info('  Dockerfile')
  logger.info('  .gitignore')
  logger.info('  videos/example.video.ts')
  logger.info('  .github/workflows/record.yml')
  logger.info('')

  logger.info('Running npm install...')
  await spawnInherited('npm', ['install', '--prefix', projectDir])

  logger.info('')
  logger.info('Next steps:')
  logger.info(`  cd ${dirName}`)
  logger.info('  screenci record')
}

export async function main() {
  const args = process.argv.slice(2)
  const { command, configPath, noContainer, otherArgs } = parseArgs(args)

  switch (command) {
    case 'record': {
      const useContainer =
        !noContainer && process.env.SCREENCI_IN_CONTAINER !== 'true'

      // Validate early so we don't build the container unnecessarily
      if (useContainer) {
        validateArgs(otherArgs)
      }

      // On the host, acquire secret before recording if missing
      if (process.env.SCREENCI_IN_CONTAINER !== 'true') {
        const resolvedConfigForSecret = findScreenCIConfig(configPath)
        if (resolvedConfigForSecret) {
          let envFilePath: string | null = null
          try {
            const configModule = await import(resolvedConfigForSecret)
            const screenciConfig = configModule.default as ScreenCIConfig
            envFilePath = screenciConfig.envFile
              ? resolve(
                  dirname(resolvedConfigForSecret),
                  screenciConfig.envFile
                )
              : null
            if (envFilePath) {
              try {
                process.loadEnvFile(envFilePath)
              } catch {
                // env file may not exist yet
              }
            }
          } catch (err) {
            if (!process.env.SCREENCI_SECRET) {
              const msg = err instanceof Error ? err.message : String(err)
              logger.error(`Failed to acquire secret: ${msg}`)
              process.exit(1)
            }
            // Config import failed but SCREENCI_SECRET is already in env — continue
          }

          if (!process.env.SCREENCI_SECRET) {
            logger.info(
              'SCREENCI_SECRET not found. Opening browser to sign in and select a plan...'
            )
            const devPort = process.env.DEV_PORT
            const appUrl =
              process.env.SCREENCI_APP_URL ??
              (devPort
                ? `http://localhost:${devPort}`
                : 'https://app.screenci.com')
            const secret = await performBrowserLogin(appUrl)
            const savePath =
              envFilePath ?? resolve(dirname(resolvedConfigForSecret), '.env')
            await writeFile(savePath, `SCREENCI_SECRET=${secret}\n`)
            process.env.SCREENCI_SECRET = secret
            logger.info('API key saved.')
          }
        }
      }

      if (useContainer) {
        await runWithContainer(otherArgs, configPath)
      } else {
        await run(command, otherArgs, configPath)
      }

      // Upload only from the host, not from inside the container
      if (process.env.SCREENCI_IN_CONTAINER === 'true') break

      // After recording, upload results to Convex if configured
      const resolvedConfigPath = findScreenCIConfig(configPath)
      if (resolvedConfigPath) {
        try {
          const configModule = await import(resolvedConfigPath)
          const screenciConfig = configModule.default as ScreenCIConfig
          if (screenciConfig.envFile) {
            const envFilePath = resolve(
              dirname(resolvedConfigPath),
              screenciConfig.envFile
            )
            try {
              process.loadEnvFile(envFilePath)
            } catch (err) {
              logger.warn(`Failed to load env file ${envFilePath}:`, err)
            }
          }
          const convexUrl = screenciConfig.apiUrl ?? process.env.SCREENCI_URL
          if (!convexUrl) {
            logger.info(
              'No API URL configured, skipping upload. Set apiUrl in screenci.config.ts or SCREENCI_URL env var.'
            )
            break
          }
          const secret = process.env.SCREENCI_SECRET
          if (!secret) {
            logger.info(
              'No secret configured, skipping upload. Set SCREENCI_SECRET in your .env file.'
            )
            break
          }
          const configDir = dirname(resolvedConfigPath)
          const screenciDir = resolve(configDir, '.screenci')
          await uploadRecordings(
            screenciDir,
            screenciConfig.projectName,
            convexUrl,
            secret
          )
        } catch (err) {
          logger.warn('Failed to load config for upload:', err)
        }
      }
      break
    }
    case 'dev':
      await run(command, otherArgs, configPath)
      break
    case 'upload-latest':
      await uploadLatest(configPath)
      break
    case 'init': {
      if (otherArgs[0] === 'auth') {
        await runInitAuth()
      } else {
        const localFlagIndex = otherArgs.indexOf('--local')
        let localPackagePath: string | undefined
        let initArgs = otherArgs
        if (localFlagIndex !== -1) {
          const cliDir = dirname(fileURLToPath(import.meta.url))
          // cli.ts is at package root; dist/cli.js is one level down
          localPackagePath = existsSync(resolve(cliDir, 'package.json'))
            ? cliDir
            : resolve(cliDir, '..')
          initArgs = otherArgs.filter((_, i) => i !== localFlagIndex)
        }
        await runInit(initArgs[0], localPackagePath)
      }
      break
    }
    default:
      logger.error(`Unknown command: ${command}`)
      logger.error('Available commands: record, dev, upload-latest, init')
      process.exit(1)
  }
}

function validateArgs(args: string[]): void {
  const disallowedFlags = ['--fully-parallel', '--workers', '-j', '--retries']

  for (const arg of args) {
    if (arg === undefined) continue

    // Check if it's a disallowed flag
    if (disallowedFlags.includes(arg)) {
      throw new Error(
        `Flag "${arg}" is not supported by screenci. ` +
          'screenci enforces sequential test execution with a single worker and no retries for proper video recording.'
      )
    }

    // Check if it's a --workers=N, -j=N, or --retries=N format
    if (
      arg.startsWith('--workers=') ||
      arg.startsWith('-j=') ||
      arg.startsWith('--retries=')
    ) {
      throw new Error(
        `Flag "${arg}" is not supported by screenci. ` +
          'screenci enforces sequential test execution with a single worker and no retries for proper video recording.'
      )
    }
  }
}

function spawnInherited(cmd: string, args: string[]): Promise<void> {
  const child = spawn(cmd, args, { stdio: 'inherit' })

  const forwardSignal = (signal: NodeJS.Signals) => {
    logger.info(`Received ${signal}, stopping...`)
    if (!child.killed) {
      child.kill(signal)
    }
    const forceKill = setTimeout(() => {
      if (child.exitCode === null) {
        logger.info('Forcing kill after timeout...')
        child.kill('SIGKILL')
      }
    }, 3000)
    forceKill.unref()
  }

  process.on('SIGINT', forwardSignal)
  process.on('SIGTERM', forwardSignal)

  return new Promise<void>((resolve, reject) => {
    child.on('close', (code) => {
      process.off('SIGINT', forwardSignal)
      process.off('SIGTERM', forwardSignal)
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${cmd} exited with code ${code}`))
      }
    })

    child.on('error', (err) => {
      process.off('SIGINT', forwardSignal)
      process.off('SIGTERM', forwardSignal)
      reject(err)
    })
  })
}

export function detectContainerRuntime(): string {
  for (const runtime of ['podman', 'docker']) {
    const result = spawnSync(runtime, ['--version'], { stdio: 'ignore' })
    if (result.status === 0 && result.error === undefined) {
      return runtime
    }
  }
  logger.error('Error: Neither podman nor docker found.')
  logger.error(
    'Please install podman (recommended) or docker to use screenci record.'
  )
  logger.error('  podman: https://podman.io/docs/installation')
  logger.error('  docker: https://docs.docker.com/get-docker/')
  process.exit(1)
}

async function runWithContainer(
  additionalArgs: string[],
  customConfigPath?: string
) {
  const configPath = findScreenCIConfig(customConfigPath)

  if (!configPath) {
    const errorMsg = customConfigPath
      ? `Error: Config file not found: ${customConfigPath}`
      : 'Error: screenci.config.ts not found in current directory'
    logger.error(errorMsg)
    process.exit(1)
  }

  const configDir = dirname(configPath)
  const dockerfilePath = resolve(configDir, 'Dockerfile')

  if (!existsSync(dockerfilePath)) {
    logger.error(`Error: Dockerfile not found at ${dockerfilePath}`)
    logger.error(
      'Container mode requires a Dockerfile next to screenci.config.ts'
    )
    process.exit(1)
  }

  const repoRoot = findRepoRoot(configDir)
  if (!repoRoot) {
    logger.error(
      'Error: Could not find repository root (.git or pnpm-workspace.yaml)'
    )
    process.exit(1)
  }

  const containerRuntime = detectContainerRuntime()

  if (process.env['SCREENCI_LOCAL_IMAGE']) {
    logger.info('SCREENCI_LOCAL_IMAGE set — skipping screenci image build')
  } else {
    const cliDir = dirname(fileURLToPath(import.meta.url))
    const screenciDockerfilePath = resolve(cliDir, 'Dockerfile')

    logger.info(`Building container image with ${containerRuntime}...`)
    logger.info(`Using Dockerfile: ${screenciDockerfilePath}`)
    logger.info(`Build context: ${repoRoot}`)
    await spawnInherited(containerRuntime, [
      'build',
      '-f',
      screenciDockerfilePath,
      '-t',
      'screenci',
      repoRoot,
    ])
  }

  logger.info(`Using Dockerfile: ${dockerfilePath}`)
  logger.info(`Build context: ${configDir}`)
  await spawnInherited(containerRuntime, [
    'build',
    '-f',
    dockerfilePath,
    '-t',
    'screenci',
    configDir,
  ])

  clearDirectory(resolve(configDir, '.screenci'))

  logger.info('Running recording in container...')
  await spawnInherited(containerRuntime, [
    'run',
    '--rm',
    '-e',
    'SCREENCI_IN_CONTAINER=true',
    '-e',
    'SCREENCI_RECORD=true',
    '-v',
    `${configDir}/.screenci:/app/.screenci`,
    '-v',
    `${configPath}:/app/screenci.config.ts`,
    '-v',
    `${configDir}/videos:/app/videos`,
    'screenci',
    'screenci',
    'record',
    ...additionalArgs,
  ])
}

async function run(
  command: string,
  additionalArgs: string[],
  customConfigPath?: string
) {
  const configPath = findScreenCIConfig(customConfigPath)

  if (!configPath) {
    const errorMsg = customConfigPath
      ? `Error: Config file not found: ${customConfigPath}`
      : 'Error: screenci.config.ts not found in current directory'
    logger.error(errorMsg)
    process.exit(1)
  }

  // Only validate args for record command (dev allows parallel execution)
  if (command === 'record') {
    validateArgs(additionalArgs)
    const screenciDir = resolve(dirname(configPath), '.screenci')
    clearDirectory(screenciDir)
  }

  // For dev command: use --ui unless --headed is specified
  const isHeaded = additionalArgs.includes('--headed')
  const shouldUseUI = command === 'dev' && !isHeaded

  const mode =
    command === 'dev' ? (isHeaded ? 'headed mode' : 'UI mode') : 'recorder'
  logger.info(`Running ScreenCI ${mode} with npx...`)
  logger.info(`Using config: ${configPath}`)

  const playwrightArgs = [
    'playwright',
    'test',
    '--config',
    configPath,
    ...(shouldUseUI ? ['--ui'] : []),
    ...additionalArgs,
  ]

  const child = spawn('npx', playwrightArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Enable recording only for record command
      ...(command === 'record' ? { SCREENCI_RECORD: 'true' } : {}),
    },
  })

  const forwardSignal = (signal: NodeJS.Signals) => {
    logger.info(`Received ${signal}, stopping recording...`)
    if (!child.killed) {
      child.kill(signal)
    }
    // Force-kill after 3 s if the child hasn't actually exited yet.
    // child.killed becomes true as soon as we send the signal, so we check
    // child.exitCode instead — it stays null until the process truly exits.
    // unref() so the timer doesn't keep the process alive on its own.
    const forceKill = setTimeout(() => {
      if (child.exitCode === null) {
        logger.info('Forcing kill after timeout...')
        child.kill('SIGKILL')
      }
    }, 3000)
    forceKill.unref()
  }

  process.on('SIGINT', forwardSignal)
  process.on('SIGTERM', forwardSignal)

  return new Promise<void>((resolve, reject) => {
    child.on('close', (code) => {
      process.off('SIGINT', forwardSignal)
      process.off('SIGTERM', forwardSignal)
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Playwright exited with code ${code}`))
      }
    })

    child.on('error', (err) => {
      reject(err)
    })
  })
}

// Only run if this file is being executed directly
// Check if this module is the main module (handles symlinks properly)
const currentFile = fileURLToPath(import.meta.url)
const mainFile = process.argv[1] ? realpathSync(process.argv[1]) : null

if (
  mainFile &&
  (currentFile === mainFile || currentFile === realpathSync(mainFile))
) {
  main().catch((error) => {
    logger.error('Error:', error.message)
    process.exit(1)
  })
}
