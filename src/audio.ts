import type { IEventRecorder, AudioStartPayload } from './events.js'
import { readFile } from 'fs/promises'
import { createHash } from 'crypto'
import { dirname, resolve } from 'path'
import { isInsideHide } from './hide.js'
import { MAX_AUDIO_LEVEL } from './asset.js'
import {
  getScreenCIRuntimeContext,
  getRuntimeAudioRecorder,
  setRuntimeAudioRecorder,
  resetAudioRuntimeState,
  type ActiveAudioRun,
} from './runtimeContext.js'

/**
 * Display/playback options for a background audio track.
 *
 * Background audio is mixed *under* the recording (and any narration). Unlike
 * overlays it has no visual and never freezes a frame: it simply plays from the
 * point it is started until it is ended (or until the end of the video).
 */
export type AudioConfig = {
  /** File path: `.mp3`, `.wav`, `.m4a`, `.aac`, or an audio-only `.mp4`. */
  path: string
  /**
   * Linear gain. `1` (the default) plays the source at its natural level, `0`
   * mutes it, and values above `1` boost it (e.g. `2` is twice as loud). Capped
   * at {@link MAX_AUDIO_LEVEL}.
   */
  volume?: number
  /**
   * Loop the source to fill the playback span. With `repeat: true` a short
   * track repeats until the track is ended (or the video ends). Defaults to
   * `false` (the source plays once and then falls silent).
   */
  repeat?: boolean
}

/**
 * A value accepted by {@link createAudio} for each key: a file path string or an
 * {@link AudioConfig} object.
 */
export type AudioInput = string | AudioConfig

/**
 * A background audio controller.
 *
 * Calling it (`await music.theme()`) starts the track at the current point and
 * lets it play for the rest of the video. Use `start()`/`end()` to bound the
 * track to a specific span. Tracks are non-exclusive: starting one never stops
 * another, so music and a sound effect can overlap.
 *
 * @example
 * ```ts
 * // Background music for the whole video:
 * await music.theme()
 *
 * // Bounded span:
 * await music.sting.start()
 * await page.click('#celebrate')
 * await music.sting.end()
 * ```
 */
export type AudioController = {
  (): Promise<void>
  start(): Promise<void>
  end(): Promise<void>
}

/** Typed audio controllers keyed by the names passed to {@link createAudio}. */
export type AudioTracks<T extends Record<string, AudioInput>> = {
  [K in keyof T]: AudioController
}

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.mp4'] as const

export function setActiveAudioRecorder(recorder: IEventRecorder | null): void {
  setRuntimeAudioRecorder(recorder)
  resetAudioRuntimeState()
}

export function resetAudioChain(): void {
  resetAudioRuntimeState()
}

function hasAudioExtension(path: string): boolean {
  const dotIndex = path.lastIndexOf('.')
  if (dotIndex === -1) return false
  const extension = path.slice(dotIndex).toLowerCase()
  return (AUDIO_EXTENSIONS as readonly string[]).includes(extension)
}

/**
 * Resolves an audio file path (as-is or relative to the test file) and returns
 * its absolute path plus a SHA-256 hash for upload/caching. Throws when the file
 * does not exist.
 */
async function resolveAudioFile(
  name: string,
  path: string,
  testFilePath: string | null
): Promise<{ path: string; fileHash: string }> {
  const candidates = [path]
  if (testFilePath !== null) {
    candidates.push(resolve(dirname(testFilePath), path))
  }
  for (const candidate of candidates) {
    try {
      const fileBuffer = await readFile(candidate)
      return {
        path,
        fileHash: createHash('sha256').update(fileBuffer).digest('hex'),
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error(`[screenci] Audio file not found for "${name}": ${path}`)
}

function normalizeAudioConfig(name: string, input: AudioInput): AudioConfig {
  const config: AudioConfig =
    typeof input === 'string' ? { path: input } : input
  if (!hasAudioExtension(config.path)) {
    throw new Error(
      `[screenci] Audio "${name}" must use one of: ${AUDIO_EXTENSIONS.join(', ')}. Received: ${config.path}`
    )
  }
  if (
    config.volume !== undefined &&
    (!Number.isFinite(config.volume) ||
      config.volume < 0 ||
      config.volume > MAX_AUDIO_LEVEL)
  ) {
    throw new Error(
      `[screenci] Audio "${name}" (${config.path}) must provide a finite volume between 0 and ${MAX_AUDIO_LEVEL}. 1 is the natural level, 0 is silent, and values above 1 boost it.`
    )
  }
  return config
}

/**
 * Creates a set of typed background audio controllers, one per key in the map.
 * Each value is a file path string or an {@link AudioConfig} object.
 *
 * Background audio is mixed under the recording (and narration). Calling a
 * controller starts the track at the current point and plays it for the rest of
 * the video; `start()`/`end()` bound it to a span. Set `repeat: true` to loop a
 * short track and `volume` to balance it against the recording.
 *
 * @example
 * ```ts
 * const music = createAudio({
 *   theme: { path: 'bg.mp3', volume: 0.3, repeat: true },
 *   sting: 'celebrate.wav',
 * })
 *
 * video('Product demo', async ({ page }) => {
 *   await music.theme()          // plays under the whole video, looping
 *   await page.goto('/dashboard')
 *   await music.sting.start()
 *   await page.click('#celebrate')
 *   await music.sting.end()
 * })
 * ```
 */
export function createAudio<const T extends Record<string, AudioInput>>(
  tracks: T
): AudioTracks<T> {
  const result = {} as AudioTracks<T>
  for (const name in tracks) {
    result[name] = buildAudioController(name, tracks[name]!)
  }
  return result
}

/**
 * Creates typed background audio controllers whose files, volume, and repeat are
 * configured on the ScreenCI Studio page instead of in code. Business tier only.
 *
 * Each key becomes a callable controller with the same timeline behavior as
 * {@link createAudio} controllers, including `start()`/`end()`. The audio file,
 * volume, and repeat all come from Studio (mirrors {@link createStudioOverlays}
 * for overlays).
 *
 * On the first upload of a studio-mode video, rendering is held until the video
 * is configured in Studio (the CLI prints a direct link). Later uploads reuse
 * the saved Studio configuration automatically.
 *
 * @example
 * ```ts
 * const music = createStudioAudio('theme', 'sting')
 *
 * video('Product demo', async ({ page }) => {
 *   await music.theme()          // plays under the whole video
 *   await page.goto('/dashboard')
 *   await music.sting.start()
 *   await page.click('#celebrate')
 *   await music.sting.end()
 * })
 * ```
 */
export function createStudioAudio<
  const K extends readonly [string, ...string[]],
>(...keys: K): Record<K[number], AudioController> {
  const seen = new Set<string>()
  for (const key of keys) {
    if (seen.has(key)) {
      throw new Error(
        `Duplicate audio key "${key}" passed to createStudioAudio. Audio keys must be unique.`
      )
    }
    seen.add(key)
  }

  const result = {} as Record<K[number], AudioController>
  for (const key of keys) {
    result[key as K[number]] = buildStudioAudioController(key)
  }
  return result
}

/**
 * Builds the callable/`start()`/`end()` audio controller shared by code-defined
 * ({@link createAudio}) and Studio ({@link createStudioAudio}) tracks. The only
 * difference is how `emitStart` records the start event.
 */
function createAudioControllerCore(
  name: string,
  emitStart: (recorder: IEventRecorder) => Promise<void>
): AudioController {
  // start()/end() register a live run so end() can pair to its start and a
  // double start() is rejected.
  const start = async (): Promise<void> => {
    if (isInsideHide()) {
      throw new Error('[screenci] Cannot start audio inside hide()')
    }
    const context = getScreenCIRuntimeContext()
    if (context.audio.activeRuns.has(name)) {
      throw new Error(
        `[screenci] Audio "${name}" is already started. Call end() for it before starting it again.`
      )
    }
    let resolveFinished!: () => void
    const finished = new Promise<void>((res) => {
      resolveFinished = res
    })
    const run: ActiveAudioRun = { finished, resolveFinished }
    context.audio.activeRuns.set(name, run)
    await emitStart(getRuntimeAudioRecorder())
  }

  const end = async (): Promise<void> => {
    if (isInsideHide()) {
      throw new Error('[screenci] Cannot call end() for audio inside hide()')
    }
    const context = getScreenCIRuntimeContext()
    const run = context.audio.activeRuns.get(name)
    if (run === undefined) {
      throw new Error(
        `Cannot call end() for audio "${name}" because it is not a started track`
      )
    }
    getRuntimeAudioRecorder().addAudioEnd(name, 'wait')
    context.audio.activeRuns.delete(name)
    run.resolveFinished()
    await run.finished
  }

  // Bare call: play from here to the end of the video (no end recorded). It is
  // fire-and-forget, so it never registers a live run.
  const controller = (async (): Promise<void> => {
    if (isInsideHide()) {
      throw new Error('[screenci] Cannot start audio inside hide()')
    }
    await emitStart(getRuntimeAudioRecorder())
  }) as AudioController

  controller.start = start
  controller.end = end
  return controller
}

function buildAudioController(
  name: string,
  input: AudioInput
): AudioController {
  const config = normalizeAudioConfig(name, input)

  const buildPayload = async (): Promise<AudioStartPayload> => {
    const testFilePath = getScreenCIRuntimeContext().testFilePath
    const resolved = await resolveAudioFile(name, config.path, testFilePath)
    return {
      path: resolved.path,
      fileHash: resolved.fileHash,
      volume: config.volume ?? 1,
      repeat: config.repeat ?? false,
    }
  }

  return createAudioControllerCore(name, async (recorder) => {
    const payload = await buildPayload()
    recorder.addAudioStart(name, payload)
  })
}

function buildStudioAudioController(name: string): AudioController {
  return createAudioControllerCore(name, (recorder) => {
    recorder.addStudioAudioStart(name)
    return Promise.resolve()
  })
}
