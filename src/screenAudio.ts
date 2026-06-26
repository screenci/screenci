import { spawn as nodeSpawn } from 'child_process'
import { createHash } from 'crypto'
import { readFile as nodeReadFile } from 'fs/promises'

export const SCREEN_AUDIO_DOCS_URL =
  'https://screenci.com/docs/guides/screen-audio'

/**
 * Screen audio capture is supported on Linux only. macOS and Windows have no
 * way to route just the recording browser into an isolated capture device
 * without third-party tooling, so capturing there would either pick up every
 * app's sound or require muting the whole machine. On those platforms screenci
 * skips capture and warns instead of writing a misleading track.
 */
export function isScreenAudioSupported(
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === 'linux'
}

/**
 * Warning shown (at run start and end) when audio capture is requested on a
 * platform where it is not supported. Returns `null` on supported platforms.
 */
export function screenAudioUnsupportedMessage(
  platform: NodeJS.Platform = process.platform
): string | null {
  if (isScreenAudioSupported(platform)) {
    return null
  }
  return (
    `[screenci] captureAudio is only supported on Linux. ` +
    `This run on "${platform}" will record no audio (the video will be silent ` +
    `where screen audio was expected). See ${SCREEN_AUDIO_DOCS_URL}`
  )
}

/**
 * The capture device for the current worker. Set by the recording browser
 * fixture once it provisions this worker's dedicated null sink, so capture taps
 * that sink's monitor; left `null` (capturing the default monitor) only as a
 * fallback when a sink could not be created. Module-scoped, so it is private to
 * one worker process.
 */
let activeCaptureDevice: string | null = null

/** Sets (or clears with `null`) the capture device for this worker. */
export function setActiveCaptureDevice(device: string | null): void {
  activeCaptureDevice = device
}

/** @internal */
export type PlatformAudioArgs = {
  /** Args that appear before `-i`, e.g. `['-f', 'pulse']`. */
  inputArgs: string[]
  /** The device string passed to `-i`. */
  device: string
}

/**
 * Resolves the ffmpeg audio capture arguments for the current (or given)
 * platform. Throws when the platform is not supported.
 *
 * When a capture device has been set for this worker (its dedicated null sink's
 * monitor) it replaces the platform default device while keeping the platform's
 * input format args.
 *
 * Exposed for testing; callers should use {@link startScreenAudioCapture}.
 */
export function resolvePlatformAudioArgs(
  platform: NodeJS.Platform = process.platform,
  device: string | null = activeCaptureDevice
): PlatformAudioArgs {
  const withDevice = (args: PlatformAudioArgs): PlatformAudioArgs =>
    device ? { ...args, device } : args

  switch (platform) {
    case 'linux':
      return withDevice({
        inputArgs: ['-f', 'pulse'],
        device: 'default.monitor',
      })
    case 'darwin':
      return withDevice({ inputArgs: ['-f', 'avfoundation'], device: ':0' })
    case 'win32':
      return withDevice({
        inputArgs: ['-f', 'wasapi', '-loopback', '1'],
        device: '',
      })
    default:
      throw new Error(
        `[screenci] captureAudio is not supported on platform "${platform}". ` +
          `See ${SCREEN_AUDIO_DOCS_URL}`
      )
  }
}

export type ScreenAudioCaptureResult = {
  path: string
  fileHash: string
}

export type ScreenAudioCapture = {
  stop(): Promise<ScreenAudioCaptureResult>
}

/** @internal - injected in tests */
export type ScreenAudioDeps = {
  spawn: typeof nodeSpawn
  readFile: typeof nodeReadFile
}

/**
 * Starts a background ffmpeg process that captures audio from the system's
 * default input and writes it to `outputPath` as PCM WAV.
 *
 * Call the returned `stop()` to send a graceful quit signal and await the
 * captured file. If ffmpeg fails to start or the output file is missing, the
 * promise rejects with a message that links to the setup docs.
 */
export function startScreenAudioCapture(
  outputPath: string,
  deps: ScreenAudioDeps = { spawn: nodeSpawn, readFile: nodeReadFile }
): ScreenAudioCapture {
  const { inputArgs, device } = resolvePlatformAudioArgs()

  const args = [
    '-loglevel',
    'quiet',
    ...inputArgs,
    '-i',
    device,
    '-c:a',
    'pcm_s16le',
    '-y',
    outputPath,
  ]

  // Use piped stdin so we can send 'q' for a clean shutdown on all platforms.
  const proc = deps.spawn('ffmpeg', args, {
    stdio: ['pipe', 'ignore', 'ignore'],
  })

  let spawnError: Error | null = null
  let exited = false

  // Settle callbacks waiting in stop() when the process exits.
  type Settler = (err: Error | null) => void
  const exitSettlers: Settler[] = []

  proc.once('error', (err) => {
    spawnError = new Error(
      `[screenci] captureAudio: could not start ffmpeg. ` +
        `See ${SCREEN_AUDIO_DOCS_URL} for setup instructions. ` +
        `Original error: ${err.message}`
    )
  })

  proc.once('exit', () => {
    exited = true
    for (const settle of exitSettlers) settle(spawnError)
    exitSettlers.length = 0
  })

  function waitForExit(): Promise<void> {
    if (exited) return Promise.resolve()
    return new Promise((resolve) => {
      exitSettlers.push(() => resolve())
    })
  }

  return {
    async stop(): Promise<ScreenAudioCaptureResult> {
      if (spawnError !== null) throw spawnError

      // Send 'q' to stdin for a graceful shutdown. ffmpeg responds to this
      // on all platforms and finalizes the output file cleanly before exiting.
      try {
        proc.stdin?.write('q')
        proc.stdin?.end()
      } catch {
        // stdin may already be closed if the process exited early
      }

      await waitForExit()

      if (spawnError !== null) throw spawnError

      try {
        const buffer = await deps.readFile(outputPath)
        const fileHash = createHash('sha256').update(buffer).digest('hex')
        return { path: outputPath, fileHash }
      } catch (err) {
        throw new Error(
          `[screenci] captureAudio: audio file was not written after recording. ` +
            `Check that the audio device is available. ` +
            `See ${SCREEN_AUDIO_DOCS_URL} for per-OS setup instructions. ` +
            `Original error: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    },
  }
}
