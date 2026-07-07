import type { NormalizedFeature } from './declare.js'
import type { IEventRecorder, AudioStartPayload } from './events.js'
import { access } from 'fs/promises'
import { dirname, resolve } from 'path'
import { captureCallerFile } from './callerFile.js'
import {
  assetCandidatePaths,
  hashAssetFile,
  prewarmAssetFile,
} from './assetHash.js'
import { isInsideHide } from './hide.js'
import { logMissingAsset } from './missingAssetLog.js'
import { MAX_AUDIO_LEVEL, validateSpeedTime } from './asset.js'
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
  /** File path to an audio file: `.mp3`, `.wav`, `.m4a`, `.aac`, `.ogg`,
   *  `.flac`, `.opus`, or an audio-only `.mp4`. */
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
  /**
   * Playback-rate multiplier. `2` plays the track twice as fast, `0.5` at half
   * speed; `1` (the default) is the natural rate. Works like {@link speed} for
   * a recording. The track keeps its output span (it never freezes a frame or
   * shifts the recording); only the source is consumed faster or slower.
   * Mutually exclusive with {@link time}.
   */
  speed?: number
  /**
   * Target playback duration (ms), an alternative to {@link speed}: the source
   * is sped up or slowed down so it plays over exactly this long. Works like
   * {@link time} for a recording. Mutually exclusive with {@link speed}.
   */
  time?: number
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

const AUDIO_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.flac',
  '.opus',
  '.mp4',
] as const

/**
 * Audio file paths registered by `createAudio` at module load, each attributed
 * to the `.screenci` script that declared it (or `null` when the caller could
 * not be determined). Validated up front when a recording starts (see
 * {@link validateRegisteredAudioPaths}) so a missing audio file fails fast with
 * a clean error instead of only when the track is first played. Attribution
 * keeps tracks declared by another test file sharing the worker from being
 * validated against the wrong test file.
 */
const registeredAudio: Array<{ ownerFile: string | null; path: string }> = []

function registerAudioPath(path: string): void {
  const ownerFile = captureCallerFile(import.meta.url)
  if (
    registeredAudio.some(
      (entry) => entry.path === path && entry.ownerFile === ownerFile
    )
  ) {
    return
  }
  registeredAudio.push({ ownerFile, path })
}

export function resetRegisteredAudioPaths(): void {
  registeredAudio.length = 0
}

const warnedMissingAudioPaths = new Set<string>()

function warnMissingAudio(path: string): void {
  if (warnedMissingAudioPaths.has(path)) return
  warnedMissingAudioPaths.add(path)
  logMissingAsset('audio', path)
}

export function resetMissingAudioWarnings(): void {
  warnedMissingAudioPaths.clear()
}

/**
 * Validates the audio files declared by the `.screenci` script at
 * {@link testFilePath} (plus any unattributed registrations), resolving each
 * as-is and relative to that file. A missing file is not fatal: it is reused
 * from a previous upload of this video (matched by path) at upload time, so a
 * gitignored audio file does not have to be committed. Tracks attributed to a
 * different test file are skipped.
 */
export async function validateRegisteredAudioPaths(
  testFilePath: string | null
): Promise<void> {
  for (const { ownerFile, path } of registeredAudio) {
    if (ownerFile !== null && ownerFile !== testFilePath) continue
    if ((await resolveExistingAudioPath(path, testFilePath)) === null) {
      warnMissingAudio(path)
    }
  }
}

/**
 * Resolves an audio file path to an existing path, trying it as-is and relative
 * to the test file. Returns null when no candidate exists.
 */
async function resolveExistingAudioPath(
  path: string,
  testFilePath: string | null
): Promise<string | null> {
  const candidates = [path]
  if (testFilePath !== null) {
    candidates.push(resolve(dirname(testFilePath), path))
  }
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // try next candidate
    }
  }
  return null
}

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
 * its path plus a SHA-256 hash for upload/caching. When the file is absent the
 * hash is undefined: the track is recovered from a previous upload of this video
 * (matched by path) at upload time, so a gitignored audio file need not be
 * committed.
 */
async function resolveAudioFile(
  path: string,
  testFilePath: string | null
): Promise<{ path: string; fileHash?: string }> {
  // Cached + pre-warmable (see assetHash.ts): when the track was pre-warmed
  // before the recording clock started, the hash is returned without a disk read
  // so the audio start() does not pay the read on the timeline.
  const fileHash = await hashAssetFile(assetCandidatePaths(path, testFilePath))
  if (fileHash === undefined) {
    warnMissingAudio(path)
    return { path }
  }
  return { path, fileHash }
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
  validateSpeedTime(
    `Audio "${name}" (${config.path})`,
    config.speed,
    config.time
  )
  registerAudioPath(config.path)
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
 * Builds audio controllers for Studio-managed tracks declared via
 * `video.audio([...])`. Each name becomes a callable controller with
 * the same timeline behavior as a {@link createAudio} controller, including
 * `start()`/`end()`. The audio file, volume, and repeat all come from Studio.
 *
 * Internal: the `audio` fixture exposes these to the test body.
 */
export function buildStudioAudioTracks(
  names: readonly string[]
): Record<string, AudioController> {
  const result: Record<string, AudioController> = {}
  for (const name of names) {
    result[name] = buildStudioAudioController(name)
  }
  return result
}

/**
 * Build audio controllers for a `video.audio(...)` declaration. Studio (array)
 * names become Studio-managed controllers; code (object) names resolve their
 * input for the active language (`byLang[language] ?? shared`).
 */
export function buildAudio(
  feature: NormalizedFeature<AudioInput> | null | undefined,
  language: string | undefined,
  // The `.screenci` script audio paths resolve against. When provided, each code
  // track's file is pre-warmed (hashed) up front so its start() reuses the cached
  // hash instead of reading the file on the recording timeline. Omitted (no
  // pre-warm) outside the recording fixture.
  anchorFile?: string
): Record<string, AudioController> {
  const result: Record<string, AudioController> = {}
  if (!feature) return result
  for (const name of feature.studioNames) {
    result[name] = buildStudioAudioController(name)
  }
  for (const name of feature.codeNames) {
    const input =
      (language !== undefined ? feature.byLang[language]?.[name] : undefined) ??
      feature.shared[name]
    if (input === undefined) continue
    if (anchorFile !== undefined) {
      prewarmAssetFile(
        typeof input === 'string' ? input : input.path,
        anchorFile
      )
    }
    result[name] = buildAudioController(name, input)
  }
  return result
}

/**
 * Builds the callable/`start()`/`end()` audio controller shared by code-defined
 * ({@link createAudio}) and Studio ({@link buildStudioAudioTracks}) tracks. The
 * only difference is how `emitStart` records the start event.
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
    const resolved = await resolveAudioFile(config.path, testFilePath)
    return {
      path: resolved.path,
      ...(resolved.fileHash !== undefined && { fileHash: resolved.fileHash }),
      volume: config.volume ?? 1,
      repeat: config.repeat ?? false,
      ...(config.speed !== undefined && { speed: config.speed }),
      ...(config.time !== undefined && { time: config.time }),
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
