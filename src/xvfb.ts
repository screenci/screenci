import { spawn, exec, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import { logger } from './logger.js'

const execAsync = promisify(exec)

export interface XvfbInstance {
  process: ChildProcess
  display: string
  cleanup: () => Promise<void>
}

/**
 * Check if we're running in a headless environment (no DISPLAY set)
 */
export function isHeadless(): boolean {
  return !process.env.DISPLAY
}

/**
 * Poll until the X display responds to xdpyinfo or the timeout elapses.
 */
async function waitForDisplay(
  display: string,
  timeoutMs = 10000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await execAsync(`DISPLAY=${display} xdpyinfo >/dev/null 2>&1`)
      return
    } catch (err) {
      lastError = err
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw new Error(`Display ${display} did not become ready: ${lastError}`)
}

/**
 * Start Xvfb (X Virtual Framebuffer) at the given resolution.
 *
 * Xvfb is purpose-built for virtual X11 displays — no config file or video
 * driver needed. Resolution is passed directly as a screen argument.
 *
 * Start once per worker at the maximum dimensions that cover all tests
 * (see getMaxDimensionsForQuality). Individual test viewports and FFmpeg
 * capture regions handle per-test sizing from there.
 */
export async function startXvfb(
  width: number,
  height: number
): Promise<XvfbInstance> {
  const displayNumber = await findAvailableDisplay()
  const display = `:${displayNumber}`

  logger.info(`Starting Xvfb on ${display} with resolution ${width}x${height}`)

  const xvfbProcess = spawn(
    'Xvfb',
    [
      display,
      '-screen',
      '0',
      `${width}x${height}x24`,
      '-ac', // disable access control so ffmpeg x11grab can connect
      '-nolisten',
      'tcp',
    ],
    { stdio: 'pipe', detached: false }
  )

  await waitForDisplay(display)

  if (xvfbProcess.exitCode !== null) {
    throw new Error('Xvfb failed to start')
  }

  const cleanup = async () => {
    logger.info(`Stopping Xvfb on ${display}`)
    xvfbProcess.kill('SIGTERM')

    await new Promise<void>((resolve) => {
      xvfbProcess.on('exit', () => resolve())
      setTimeout(() => {
        if (xvfbProcess.exitCode === null) {
          xvfbProcess.kill('SIGKILL')
          resolve()
        }
      }, 5000)
    })

    await execAsync(
      `rm -f /tmp/.X${displayNumber}-lock /tmp/.X11-unix/X${displayNumber}`
    ).catch(() => {})
  }

  return { process: xvfbProcess, display, cleanup }
}

/**
 * Find an available X display number and clean up any stale lock files.
 */
async function findAvailableDisplay(): Promise<number> {
  for (let i = 99; i >= 1; i--) {
    try {
      await execAsync(`DISPLAY=:${i} xdpyinfo >/dev/null 2>&1`)
    } catch {
      await execAsync(`rm -f /tmp/.X${i}-lock /tmp/.X11-unix/X${i}`).catch(
        () => {}
      )
      return i
    }
  }
  return 99
}
