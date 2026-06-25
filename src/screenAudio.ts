import { spawn as nodeSpawn } from 'child_process'
import { createHash } from 'crypto'
import { readFile as nodeReadFile } from 'fs/promises'

export const SCREEN_AUDIO_DOCS_URL =
  'https://screenci.com/docs/guides/screen-audio'

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
 * Exposed for testing; callers should use {@link startScreenAudioCapture}.
 */
export function resolvePlatformAudioArgs(
  platform: NodeJS.Platform = process.platform
): PlatformAudioArgs {
  switch (platform) {
    case 'linux':
      return { inputArgs: ['-f', 'pulse'], device: 'default.monitor' }
    case 'darwin':
      return { inputArgs: ['-f', 'avfoundation'], device: ':0' }
    case 'win32':
      return { inputArgs: ['-f', 'wasapi', '-loopback', '1'], device: '' }
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
