import type {
  IEventRecorder,
  CueTranslation,
  OverlayCrop,
  RecordingCustomVoiceRef,
  SourceTrimPoint,
  TimelineAnchorInput,
  VideoCueTranslation,
  VideoCueTranslationFile,
  VoiceLanguageMeta,
} from './events.js'
import { parseTimelineOffset, type TimelineOffset } from './timelineOffset.js'
import { validateCrop, resolveSourceTrim } from './sourceTrim.js'
import {
  supportedLanguages,
  voices,
  type VoiceKey,
  type Lang,
  type CustomVoiceRef,
} from './voices.js'
import type {
  TopLevelVoiceConfig,
  LangNarrationOverride,
} from './voiceConfig.js'
export type { TopLevelVoiceConfig, LangNarrationOverride }
import type { NormalizedNarration } from './localize.js'
import { isCustomVoiceRef } from './customVoiceRef.js'
import { MAX_AUDIO_LEVEL } from './asset.js'
import { isInsideHide } from './hide.js'
import { logger } from './logger.js'
import { logMissingAsset } from './missingAssetLog.js'
import {
  assetCandidatePaths,
  hashAssetFile,
  prewarmAssetFile,
} from './assetHash.js'
import {
  getScreenCIRuntimeContext,
  getRuntimeCueRecorder,
  resetCueRuntimeState,
  setRuntimeCueRecorder,
} from './runtimeContext.js'
import { resolveRecordingTimingDuration } from './runtimeMode.js'

// One frame at 24fps — ensures at least one rendered frame captures each cue state.
export const ONE_FRAME_MS = 1000 / 24

// Blocking sleep — spin until the elapsed time has passed
let sleepFn = (ms: number): void => {
  const end = performance.now() + ms
  while (performance.now() < end) {
    /* spin */
  }
}

function sleepForCueFrameGap(): void {
  const durationMs = resolveRecordingTimingDuration(2 * ONE_FRAME_MS)
  if (durationMs <= 0) {
    return
  }

  sleepFn(durationMs)
}

export function setSleepFn(fn: (ms: number) => void): void {
  sleepFn = fn
}

export function setActiveCueRecorder(recorder: IEventRecorder | null): void {
  setRuntimeCueRecorder(recorder)
  resetCueRuntimeState()
}

export function resetCueChain(): void {
  resetCueRuntimeState()
}

export function resetRegisteredCustomVoiceRefs(): void {
  // Voice assets are resolved lazily at cue start, so there is no shared
  // registration state to reset anymore.
}

export async function validateCustomVoiceRefs(
  _testFilePath: string
): Promise<void> {
  // Cue and custom voice assets are now resolved lazily at cue start using the
  // current test file path from the runtime context, so there is nothing to
  // pre-validate here.
}

const warnedMissingAssetPaths = new Set<string>()

function warnMissingNarrationAsset(assetPath: string): void {
  if (warnedMissingAssetPaths.has(assetPath)) return
  warnedMissingAssetPaths.add(assetPath)
  logMissingAsset('narration media', assetPath)
}

export function resetMissingNarrationAssetWarnings(): void {
  warnedMissingAssetPaths.clear()
}

/**
 * Hashes a narration media file for upload and caching. Returns undefined when
 * the file is absent locally: the asset is then recovered from a previous upload
 * of this video (matched by path) at upload time, so a gitignored media file
 * does not have to be committed. See resolveMissingUploadAssets in cli.ts.
 */
async function resolveAssetFileHash(
  assetPath: string,
  testFilePath: string | null
): Promise<string | undefined> {
  // Cached + pre-warmable: see assetHash.ts. When the file was pre-warmed before
  // the recording clock started, this returns the cached hash without a disk read
  // so the cue's start() lands right after the previous action instead of trailing
  // it by the file-read latency.
  return hashAssetFile(assetCandidatePaths(assetPath, testFilePath))
}

async function toRecordedVoice(
  voice: VoiceKey | CustomVoiceRef
): Promise<VoiceKey | RecordingCustomVoiceRef> {
  if (!isCustomVoiceRef(voice)) return voice
  const testFilePath = getScreenCIRuntimeContext().testFilePath
  // A custom voice sample identifies a cloned voice for synthesis. When it is
  // missing locally (e.g. a gitignored sample on CI) we cannot hash it here, but
  // the clone can still be recovered from a previous upload of this video, matched
  // by path (see prepareCustomVoiceAssets / resolveMissingUploadAssets in cli.ts).
  // So warn and emit a path-only ref instead of failing, exactly like narration
  // media. The upload fails later only if no previous upload exists to reuse.
  const assetHash = await resolveAssetFileHash(voice.path, testFilePath)
  if (assetHash === undefined) {
    warnMissingNarrationAsset(voice.path)
    return {
      assetPath: voice.path,
    }
  }
  return {
    assetHash,
    assetPath: voice.path,
  }
}

/**
 * Auto-ends any currently active cue before starting a new one.
 * Called internally at the start of every narration controller.
 */
function cueAutoEnd(nextCueName: string): void {
  const context = getScreenCIRuntimeContext()
  if (context.cue.activeCueRun === null) return
  if (
    context.cue.activeCueRun.startedWithExplicitStart &&
    context.cue.activeCueName !== null
  ) {
    logger.warn(
      `[screenci] Cue "${context.cue.activeCueName}" was started with .start() and auto-ended when cue "${nextCueName}" started. Call .end() explicitly before starting the next narration cue.`
    )
  }
  context.cueRecorder.addCueEnd('auto')
  sleepForCueFrameGap()
  context.cue.activeCueRun.resolveFinished()
  context.cue.activeCueName = null
  context.cue.activeCueRun = null
}

function assertUniqueCueName(name: string): void {
  const usedCueNames = getScreenCIRuntimeContext().cue.usedCueNames
  if (usedCueNames.has(name)) {
    throw new Error(
      `Duplicate cue name "${name}" in one video recording. Cue names must be unique.`
    )
  }
  usedCueNames.add(name)
}

function createDeferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>((resolveFn) => {
    resolve = resolveFn
  })
  return { promise, resolve }
}

function createActiveCueRun(startedWithExplicitStart: boolean): {
  finished: Promise<void>
  resolveFinished: () => void
  startedWithExplicitStart: boolean
} {
  const deferred = createDeferred()
  return {
    finished: deferred.promise,
    resolveFinished: deferred.resolve,
    startedWithExplicitStart,
  }
}

async function endActiveCue(): Promise<void> {
  const context = getScreenCIRuntimeContext()
  if (context.cue.activeCueRun === null) return
  if (isInsideHide()) throw new Error('Cannot call end() inside hide()')
  const run = context.cue.activeCueRun
  context.cueRecorder.addCueEnd('wait')
  sleepForCueFrameGap()
  run.resolveFinished()
  if (context.cue.activeCueRun === run) {
    context.cue.activeCueName = null
    context.cue.activeCueRun = null
  }
}

/**
 * A narration cue controller.
 *
 * @example
 * ```ts
 * await narration.intro()
 * await page.goto('/dashboard')
 * await narration.nextStep.start()
 * await narration.nextStep.end()
 *
 * // Hold the cue until an absolute position in the final video:
 * await narration.outro.until('1:05')   // until 1 minute 5 seconds
 * await narration.outro.until('90%')    // until 90% through
 * ```
 */
export type NarrationCue = {
  /** No argument: play the line and block until its audio finishes. */
  (): Promise<void>
  /**
   * Start the line now and hold the cue window until this absolute point in the
   * final video (a `'<n>s'`/timecode position, or a `'<n>%'` fraction). The audio
   * is never cut: if it runs longer than the position, the window extends to let
   * it finish. Successive `.until(...)` targets must be monotonic.
   */
  until(position: TimelineOffset): Promise<void>
  start(): Promise<void>
  end(): Promise<void>
}

/**
 * Linear gain applied to a cue's narration audio at mix time. `1` is the natural
 * level (the default), `0` mutes it, and values above `1` boost it. Capped at
 * {@link MAX_AUDIO_LEVEL}.
 *
 * Volume is a per-cue, render-time mix property: it is applied with ffmpeg when
 * the narration is mixed and is deliberately not part of the voice/generation
 * settings, so changing it never regenerates the audio. When more than one
 * language sets a volume for the same cue, the first one wins.
 */
type NarrationVolume = { volume?: number }

/**
 * Source crop/trim for a file-based narration cue (`media`/`path`). `crop`
 * reframes the source video before the square tile crop; `start`/`end` trim the
 * played slice (time strings: `'2s'`/`'0:02'`/`'50%'` of the source).
 */
type NarrationMediaFields = {
  subtitle?: string
  crop?: OverlayCrop
  start?: TimelineOffset
  end?: TimelineOffset
}
type NarrationCueObject =
  | ({ text: string } & NarrationVolume)
  | ({ media: string } & NarrationMediaFields & NarrationVolume)
  | ({ path: string } & NarrationMediaFields & NarrationVolume)

/** A single narration cue value in a multi-language map. */
export type CueMapValue = string | NarrationCueObject

/** Typed narration controllers keyed by the cue names in a language map. */
export type Cues<T extends Record<string, CueMapValue>> = {
  [K in keyof T]: NarrationCue
}

// Voice config types (TopLevelVoiceConfig, LangNarrationOverride) now live in
// the leaf module `voiceConfig.ts` and are imported/re-exported at the top of
// this file, so `renderOptions.narration` in `types.ts` can use them too.

/** Converts a union type to an intersection: `A | B` → `A & B` */
type UnionToIntersection<U> = (
  U extends unknown ? (x: U) => void : never
) extends (x: infer I) => void
  ? I
  : never

/**
 * Produces a record requiring every key that appears in any language's cues.
 * Uses each language's key set with CueMapValue values before intersecting,
 * so value types don't conflict (e.g. string vs { path, subtitle } for the same key).
 */
type LanguageEntryBase = {
  voice?: LangNarrationOverride
}

type LanguageMetadataKey = keyof LanguageEntryBase

type NarrationLanguageInput = LanguageEntryBase & Record<string, unknown>

type LanguageEntry<C extends Record<string, CueMapValue>> = LanguageEntryBase &
  C

type OmitLanguageMetadata<T extends NarrationLanguageInput> = Omit<
  T,
  LanguageMetadataKey
>

type EnsureCueRecord<T> = T extends Record<string, CueMapValue> ? T : never

type LanguageRootKeys<M> = Extract<keyof M, Lang>

type AllCues<M extends Partial<Record<Lang, NarrationLanguageInput>>> =
  EnsureCueRecord<
    UnionToIntersection<
      {
        [L in LanguageRootKeys<M>]-?: NonNullable<
          M[L]
        > extends NarrationLanguageInput
          ? Record<
              keyof OmitLanguageMetadata<NonNullable<M[L]>> & string,
              CueMapValue
            >
          : never
      }[LanguageRootKeys<M>]
    >
  >

type LanguagesMap<M extends Partial<Record<Lang, NarrationLanguageInput>>> =
  M & {
    [L in LanguageRootKeys<M>]-?: {
      voice?: LangNarrationOverride
    } & {
      [K in keyof OmitLanguageMetadata<NonNullable<M[L]>>]: CueMapValue
    } & AllCues<M>
  }

type NarrationInput<M extends Partial<Record<Lang, NarrationLanguageInput>>> = {
  voice?: TopLevelVoiceConfig
} & LanguagesMap<M>

/**
 * Creates a set of typed narration controllers, one per key in the map.
 *
 * Each cue is callable, and also has explicit `start()` and `end()` methods.
 * At render time screenci generates narration, and syncs the audio to the
 * recording. You write text; the voice is handled for you.
 *
 * The top-level `voice` applies to all languages. Override it per-language via
 * the `voice` field inside each language entry. Only language-level overrides
 * may set `seed`.
 *
 * TypeScript enforces that every language has the same cue keys.
 * Forget a translation key → compile error.
 *
 * @example
 * ```ts
 * const narration = createNarration({
 *   voice: { name: voices.Ava },
 *   en: { intro: 'Welcome.', next: 'Click here.' },
 *   fi: {
 *     voice: { name: voices.Nora, seed: 42 },
 *     intro: 'Tervetuloa.',
 *     next: 'Napsauta tästä.',
 *   },
 * })
 *
 * // Start a narration segment directly:
 * await narration.intro.start()
 * await page.goto('/dashboard')
 *
 * // Consecutive narration segments sequence automatically:
 * await narration.intro.start()
 * await narration.next.start()  // ends intro, then starts next
 *
 * // Run a line completely before the next action:
 * await narration.intro()
 * await page.click('#start')
 * ```
 */
export function createNarration<
  M extends Partial<Record<Lang, NarrationLanguageInput>>,
>(input: NarrationInput<M>): Cues<AllCues<M>> {
  if ('languages' in input) {
    throw new Error(
      'createNarration no longer accepts a top-level "languages" wrapper. Move each language code to the top level, for example { voice, en: {...}, fi: {...} }.'
    )
  }

  const languages = normalizeLanguagesInput(input)

  return buildCuesFromInput(
    input.voice ?? { name: voices.Sophie },
    languages
  ) as Cues<AllCues<M>>
}

/**
 * Asserts that a narration input's language keys match a video's declared
 * languages exactly. Used by the `narration` fixture so the languages declared
 * via `video.languages([...])` stay the single source of truth: a missing or
 * unexpected language fails loudly instead of silently drifting.
 */
export function assertNarrationLanguagesMatch(
  input: Record<string, unknown>,
  declared: readonly string[]
): void {
  const declaredSet = new Set(declared)
  const inputLangs = Object.keys(input).filter(
    (key) => !RESERVED_LANGUAGE_METADATA_KEYS.has(key as LanguageMetadataKey)
  )
  const inputSet = new Set(inputLangs)

  const missing = declared.filter((lang) => !inputSet.has(lang))
  const unexpected = inputLangs.filter((lang) => !declaredSet.has(lang))
  if (missing.length === 0 && unexpected.length === 0) return

  const parts: string[] = []
  if (missing.length > 0) parts.push(`missing ${missing.join(', ')}`)
  if (unexpected.length > 0) parts.push(`unexpected ${unexpected.join(', ')}`)

  throw new Error(
    `[screenci] narration languages must match the video's declared languages (${declared.join(
      ', '
    )}): ${parts.join('; ')}.`
  )
}

/**
 * Resolves a string narration position into the anchor passed to the recorder.
 * Returns `undefined` for a no-arg call. Throws on a non-string value so a stray
 * number (which narration does not accept) fails loudly instead of crashing in
 * the parser.
 */
/**
 * Builds the optional trailing `volume`/`until` arguments for the cue recorder
 * methods. Kept positional and minimal (omit a trailing arg rather than pass
 * `undefined`) so the recorded events, and the call shape itself, stay identical
 * to before whenever no position or volume is set.
 */
type CueTrailingArgs = [
  volume?: number | undefined,
  until?: TimelineAnchorInput,
]

function cueTrailingArgs(
  volume: number | undefined,
  until: TimelineAnchorInput | undefined
): CueTrailingArgs {
  const tail: CueTrailingArgs = []
  if (until !== undefined) {
    tail[0] = volume
    tail[1] = until
  } else if (volume !== undefined) {
    tail[0] = volume
  }
  return tail
}

function resolveCueAnchor(
  until: TimelineOffset | undefined
): TimelineAnchorInput | undefined {
  if (until === undefined) return undefined
  if (typeof until !== 'string') {
    throw new Error(
      `narration positions must be a string such as '0:05' or '56%', got ${typeof until}`
    )
  }
  const parsed = parseTimelineOffset(until)
  return parsed.kind === 'percent'
    ? { percent: parsed.fraction }
    : { outputMs: parsed.ms }
}

function createCueController(
  name: string,
  emitStart: (
    recorder: IEventRecorder,
    until?: TimelineAnchorInput
  ) => void | Promise<void>
): NarrationCue {
  let didRegisterName = false

  const start = async (
    startedWithExplicitStart = true,
    until?: TimelineAnchorInput
  ): Promise<void> => {
    if (isInsideHide()) throw new Error('Cannot start narration inside hide()')
    const recorder = getRuntimeCueRecorder()
    const context = getScreenCIRuntimeContext()
    if (!didRegisterName) {
      assertUniqueCueName(name)
      didRegisterName = true
    }
    cueAutoEnd(name)
    const run = createActiveCueRun(startedWithExplicitStart)
    context.cue.activeCueName = name
    context.cue.activeCueRun = run
    await emitStart(recorder, until)
  }

  const end = async (): Promise<void> => {
    if (isInsideHide()) throw new Error('Cannot call end() inside hide()')
    const context = getScreenCIRuntimeContext()
    if (
      context.cue.activeCueName !== name ||
      context.cue.activeCueRun === null
    ) {
      throw new Error(
        `Cannot call end() for cue "${name}" because it is not the active started cue`
      )
    }

    const run = context.cue.activeCueRun
    await endActiveCue()
    await run.finished
  }

  const block = async (until?: TimelineAnchorInput): Promise<void> => {
    await start(false, until)
    sleepForCueFrameGap()
    await end()
  }

  const cue = (async (): Promise<void> => {
    await block()
  }) as NarrationCue

  cue.until = (position: TimelineOffset): Promise<void> =>
    block(resolveCueAnchor(position))
  cue.start = start
  cue.end = end
  return cue
}

/**
 * Builds narration controllers for Studio-managed cues declared via
 * `video.narration(editable([...]))`. Their text and voice are configured on
 * the ScreenCI Studio page instead of in code. Each name becomes a cue with the
 * same behavior as a seeded narration cue (callable, with `start()`/`end()`);
 * languages, narration text, and voice all come from Studio.
 *
 * Internal: the `narration` fixture merges these with the seeded localize cues.
 */
export function buildStudioNarrationCues(
  names: readonly string[]
): Record<string, NarrationCue> {
  const result: Record<string, NarrationCue> = {}
  for (const name of names) {
    result[name] = createCueController(name, (recorder, until) => {
      sleepForCueFrameGap()
      recorder.addStudioCueStart(name, until)
    })
  }
  return result
}

type NormalizedCueMapValue =
  | { type: 'text'; text: string; volume?: number }
  | {
      type: 'file'
      path: string
      subtitle?: string
      volume?: number
      crop?: OverlayCrop
      sourceStart?: SourceTrimPoint
      sourceEnd?: SourceTrimPoint
    }

const RESERVED_LANGUAGE_METADATA_KEYS = new Set<LanguageMetadataKey>(['voice'])
const SUPPORTED_LANGUAGE_SET = new Set<Lang>(supportedLanguages)

/**
 * Validates a per-cue narration volume and returns it unchanged. A volume must
 * be a finite number between 0 and {@link MAX_AUDIO_LEVEL}. Throws otherwise.
 */
function validateCueVolume(name: string, volume: number): number {
  if (!Number.isFinite(volume) || volume < 0 || volume > MAX_AUDIO_LEVEL) {
    throw new Error(
      `[screenci] Narration cue "${name}" must provide a finite volume between 0 and ${MAX_AUDIO_LEVEL}. 1 is the natural level, 0 is silent, and values above 1 boost it.`
    )
  }
  return volume
}

function normalizeCueMapValue(value: CueMapValue): NormalizedCueMapValue {
  if (typeof value === 'string') {
    return { type: 'text', text: value }
  }

  if ('text' in value) {
    return {
      type: 'text',
      text: value.text,
      ...(value.volume !== undefined && { volume: value.volume }),
    }
  }

  const mediaPath = 'media' in value ? value.media : value.path

  const label = `Narration cue media "${mediaPath}"`
  if (value.crop !== undefined) validateCrop(label, value.crop)
  const { sourceStart, sourceEnd } = resolveSourceTrim(
    label,
    value.start,
    value.end
  )

  return {
    type: 'file',
    path: mediaPath,
    ...(value.subtitle !== undefined && { subtitle: value.subtitle }),
    ...(value.volume !== undefined && { volume: value.volume }),
    ...(value.crop !== undefined && { crop: value.crop }),
    ...(sourceStart !== undefined && { sourceStart }),
    ...(sourceEnd !== undefined && { sourceEnd }),
  }
}

function getLanguageCues(
  lang: Lang,
  entry: LanguageEntry<Record<string, CueMapValue>> | undefined
): Record<string, CueMapValue> | undefined {
  if (entry === undefined) return undefined
  if ('cues' in entry) {
    throw new Error(
      `createNarration no longer supports ${lang}.cues. Move cue keys directly into ${lang} and keep only optional voice metadata alongside them.`
    )
  }

  if ('region' in entry) {
    throw new Error(
      `createNarration no longer supports ${lang}.region. Remove the region override and keep ${lang} as the top-level language key.`
    )
  }

  return Object.fromEntries(
    Object.entries(entry).filter(
      ([key]) =>
        !RESERVED_LANGUAGE_METADATA_KEYS.has(key as LanguageMetadataKey)
    )
  ) as Record<string, CueMapValue>
}

function voiceToKeyString(voice: VoiceKey | CustomVoiceRef): string {
  if (isCustomVoiceRef(voice)) return `custom:${voice.path}`
  return voice
}

function normalizeLanguagesInput(
  input: NarrationInput<Partial<Record<Lang, NarrationLanguageInput>>>
): Partial<Record<Lang, LanguageEntry<Record<string, CueMapValue>>>> {
  const languages: Partial<
    Record<Lang, LanguageEntry<Record<string, CueMapValue>>>
  > = {}

  for (const [key, value] of Object.entries(input)) {
    if (key === 'voice') {
      continue
    }

    if (!SUPPORTED_LANGUAGE_SET.has(key as Lang)) {
      throw new Error(
        `createNarration received unsupported top-level key "${key}". Use "voice" or a supported language code such as "en" or "fi".`
      )
    }

    languages[key as Lang] = value as LanguageEntry<Record<string, CueMapValue>>
  }

  return languages
}

function buildCuesFromInput(
  topVoice: TopLevelVoiceConfig,
  languages: Partial<Record<Lang, LanguageEntry<Record<string, CueMapValue>>>>
): Cues<Record<string, CueMapValue>> {
  const langs = Object.keys(languages) as Lang[]
  const firstLang = langs[0]
  if (firstLang === undefined) {
    throw new Error(
      'createNarration requires at least one top-level language such as "en" or "fi"'
    )
  }

  // Resolve effective voice metadata per language
  const resolvedVoices = new Map<string, VoiceKey | CustomVoiceRef>()
  const resolvedVoiceMeta = new Map<string, VoiceLanguageMeta>()

  for (const lang of langs) {
    const entry = languages[lang]
    const langOverride = entry?.voice
    const effectiveVoiceName = langOverride?.name ?? topVoice.name
    const effectiveSeed = langOverride?.seed
    // A language override owns all provider settings. This prevents settings
    // for one provider from leaking across a voice override to another.
    const effectiveStyle =
      langOverride !== undefined ? langOverride.style : topVoice.style
    const effectiveAccent =
      langOverride !== undefined
        ? langOverride?.accent
        : 'accent' in topVoice
          ? (topVoice as { accent?: string }).accent
          : undefined
    const effectivePacing =
      langOverride !== undefined
        ? langOverride?.pacing
        : 'pacing' in topVoice
          ? (topVoice as { pacing?: string | number }).pacing
          : undefined
    const effectiveStability =
      langOverride !== undefined
        ? 'stability' in langOverride
          ? langOverride.stability
          : undefined
        : 'stability' in topVoice
          ? topVoice.stability
          : undefined
    const effectiveSimilarityBoost =
      langOverride !== undefined
        ? 'similarityBoost' in langOverride
          ? langOverride.similarityBoost
          : undefined
        : 'similarityBoost' in topVoice
          ? topVoice.similarityBoost
          : undefined
    const effectiveSpeed =
      langOverride !== undefined
        ? 'speed' in langOverride
          ? langOverride.speed
          : undefined
        : 'speed' in topVoice
          ? topVoice.speed
          : undefined
    const effectiveUseSpeakerBoost =
      langOverride !== undefined
        ? 'useSpeakerBoost' in langOverride
          ? langOverride.useSpeakerBoost
          : undefined
        : 'useSpeakerBoost' in topVoice
          ? topVoice.useSpeakerBoost
          : undefined
    const effectiveModelType =
      typeof effectiveStyle === 'string'
        ? 'expressive'
        : (langOverride?.modelType ?? topVoice.modelType)

    resolvedVoices.set(lang, effectiveVoiceName)
    resolvedVoiceMeta.set(lang, {
      name: voiceToKeyString(effectiveVoiceName),
      ...(effectiveSeed !== undefined && { seed: effectiveSeed }),
      ...(effectiveModelType !== undefined && {
        modelType: effectiveModelType,
      }),
      ...(effectiveStyle !== undefined && { style: effectiveStyle }),
      ...(effectiveAccent !== undefined && { accent: effectiveAccent }),
      ...(effectivePacing !== undefined && { pacing: effectivePacing }),
      ...(effectiveStability !== undefined && {
        stability: effectiveStability,
      }),
      ...(effectiveSimilarityBoost !== undefined && {
        similarityBoost: effectiveSimilarityBoost,
      }),
      ...(effectiveSpeed !== undefined && { speed: effectiveSpeed }),
      ...(effectiveUseSpeakerBoost !== undefined && {
        useSpeakerBoost: effectiveUseSpeakerBoost,
      }),
    })
  }

  const firstEntry = languages[firstLang]
  if (!firstEntry) return {} as Cues<Record<string, CueMapValue>>

  const result = {} as Cues<Record<string, CueMapValue>>

  const firstCues = getLanguageCues(firstLang, firstEntry)
  if (firstCues === undefined) return {} as Cues<Record<string, CueMapValue>>

  for (const key in firstCues) {
    const keyStr = key

    const normalizedByLang = new Map<Lang, NormalizedCueMapValue>()

    // Normalize shorthand values and determine if any language uses a file entry for this key.
    let hasFileEntry = false
    // Volume is per-cue (a render-time mix property, not per-language): the first
    // language that sets a volume for this cue wins.
    let cueVolume: number | undefined
    for (const lang of langs) {
      const val = getLanguageCues(lang, languages[lang])?.[keyStr]
      if (val !== undefined) {
        const normalized = normalizeCueMapValue(val)
        normalizedByLang.set(lang, normalized)
        if (normalized.type === 'file') {
          hasFileEntry = true
        }
        if (cueVolume === undefined && normalized.volume !== undefined) {
          cueVolume = validateCueVolume(keyStr, normalized.volume)
        }
      }
    }

    if (hasFileEntry) {
      result[keyStr] = createCueController(keyStr, async (recorder, until) => {
        const testFilePath = getScreenCIRuntimeContext().testFilePath
        for (const lang of langs) {
          recorder.registerVoiceForLang(lang, resolvedVoiceMeta.get(lang)!)
        }
        const videoTranslations: Record<string, VideoCueTranslation> = {}
        for (const lang of langs) {
          const val = normalizedByLang.get(lang)
          if (val === undefined) continue
          const voice = resolvedVoices.get(lang)!
          const meta = resolvedVoiceMeta.get(lang)
          const modelType = meta?.modelType
          const style = meta?.style
          const accent = meta?.accent
          const pacing = meta?.pacing
          const stability = meta?.stability
          const similarityBoost = meta?.similarityBoost
          const speed = meta?.speed
          const useSpeakerBoost = meta?.useSpeakerBoost
          const seed = meta?.seed
          if (val.type === 'text') {
            videoTranslations[lang] = {
              text: val.text,
              voice: await toRecordedVoice(voice),
              ...(modelType !== undefined && { modelType }),
              ...(style !== undefined && { style }),
              ...(accent !== undefined && { accent }),
              ...(pacing !== undefined && { pacing }),
              ...(stability !== undefined && { stability }),
              ...(similarityBoost !== undefined && { similarityBoost }),
              ...(speed !== undefined && { speed }),
              ...(useSpeakerBoost !== undefined && { useSpeakerBoost }),
              ...(seed !== undefined && { seed }),
            }
          } else {
            videoTranslations[lang] = await entryToVideoTranslation(
              testFilePath,
              {
                path: val.path,
                ...(val.subtitle !== undefined && { subtitle: val.subtitle }),
                ...(val.crop !== undefined && { crop: val.crop }),
                ...(val.sourceStart !== undefined && {
                  sourceStart: val.sourceStart,
                }),
                ...(val.sourceEnd !== undefined && {
                  sourceEnd: val.sourceEnd,
                }),
              }
            )
          }
        }
        sleepForCueFrameGap()
        recorder.addVideoCueStart(
          keyStr,
          undefined,
          undefined,
          undefined,
          videoTranslations,
          ...cueTrailingArgs(cueVolume, until)
        )
      })
    } else {
      result[keyStr] = createCueController(keyStr, async (recorder, until) => {
        for (const lang of langs) {
          recorder.registerVoiceForLang(lang, resolvedVoiceMeta.get(lang)!)
        }
        const textTranslations: Record<string, CueTranslation> = {}
        for (const lang of langs) {
          const val = normalizedByLang.get(lang)
          if (val !== undefined && val.type === 'text') {
            const voice = resolvedVoices.get(lang)!
            const meta = resolvedVoiceMeta.get(lang)
            const modelType = meta?.modelType
            const style = meta?.style
            const accent = meta?.accent
            const pacing = meta?.pacing
            const stability = meta?.stability
            const similarityBoost = meta?.similarityBoost
            const speed = meta?.speed
            const useSpeakerBoost = meta?.useSpeakerBoost
            const seed = meta?.seed
            textTranslations[lang] = {
              text: val.text,
              voice: await toRecordedVoice(voice),
              ...(modelType !== undefined && { modelType }),
              ...(style !== undefined && { style }),
              ...(accent !== undefined && { accent }),
              ...(pacing !== undefined && { pacing }),
              ...(stability !== undefined && { stability }),
              ...(similarityBoost !== undefined && { similarityBoost }),
              ...(speed !== undefined && { speed }),
              ...(useSpeakerBoost !== undefined && { useSpeakerBoost }),
              ...(seed !== undefined && { seed }),
            }
          }
        }
        sleepForCueFrameGap()
        recorder.addCueStart(
          '',
          keyStr,
          undefined,
          textTranslations,
          ...cueTrailingArgs(cueVolume, until)
        )
      })
    }
  }
  return result
}

async function entryToVideoTranslation(
  testFilePath: string | null,
  entry:
    | string
    | {
        path: string
        subtitle?: string
        crop?: OverlayCrop
        sourceStart?: SourceTrimPoint
        sourceEnd?: SourceTrimPoint
      }
): Promise<VideoCueTranslationFile> {
  const path = typeof entry === 'string' ? entry : entry.path
  const subtitle = typeof entry === 'string' ? undefined : entry.subtitle
  const crop = typeof entry === 'string' ? undefined : entry.crop
  const sourceStart = typeof entry === 'string' ? undefined : entry.sourceStart
  const sourceEnd = typeof entry === 'string' ? undefined : entry.sourceEnd
  const assetHash = await resolveAssetFileHash(path, testFilePath)
  if (assetHash === undefined) warnMissingNarrationAsset(path)
  return {
    ...(assetHash !== undefined && { assetHash }),
    assetPath: path,
    ...(subtitle !== undefined && { subtitle }),
    ...(crop !== undefined && { crop }),
    ...(sourceStart !== undefined && { sourceStart }),
    ...(sourceEnd !== undefined && { sourceEnd }),
  }
}

/**
 * Resolve a single voice config into its recorded name and language metadata.
 * Unlike {@link buildCuesFromInput}, the config here is already fully resolved by
 * the localize voice cascade, so there is no top-level/override merge: every
 * provider setting comes from this one config.
 */
export function resolveVoiceMeta(
  config: TopLevelVoiceConfig | LangNarrationOverride
): { name: VoiceKey | CustomVoiceRef; meta: VoiceLanguageMeta } {
  const name = config.name
  const seed = 'seed' in config ? config.seed : undefined
  const style = 'style' in config ? config.style : undefined
  const accent = 'accent' in config ? config.accent : undefined
  const pacing = 'pacing' in config ? config.pacing : undefined
  const stability = 'stability' in config ? config.stability : undefined
  const similarityBoost =
    'similarityBoost' in config ? config.similarityBoost : undefined
  const speed = 'speed' in config ? config.speed : undefined
  const useSpeakerBoost =
    'useSpeakerBoost' in config ? config.useSpeakerBoost : undefined
  const modelType =
    typeof style === 'string'
      ? 'expressive'
      : 'modelType' in config
        ? config.modelType
        : undefined

  return {
    name,
    meta: {
      name: voiceToKeyString(name),
      ...(seed !== undefined && { seed }),
      ...(modelType !== undefined && { modelType }),
      ...(style !== undefined && { style }),
      ...(accent !== undefined && { accent }),
      ...(pacing !== undefined && { pacing }),
      ...(stability !== undefined && { stability }),
      ...(similarityBoost !== undefined && { similarityBoost }),
      ...(speed !== undefined && { speed }),
      ...(useSpeakerBoost !== undefined && { useSpeakerBoost }),
    },
  }
}

/** The voice fields of a cue translation derived from resolved meta (no name). */
function translationVoiceFields(
  meta: VoiceLanguageMeta
): Omit<CueTranslation, 'text' | 'voice'> {
  return {
    ...(meta.modelType !== undefined && { modelType: meta.modelType }),
    ...(meta.style !== undefined && { style: meta.style }),
    ...(meta.accent !== undefined && { accent: meta.accent }),
    ...(meta.pacing !== undefined && { pacing: meta.pacing }),
    ...(meta.stability !== undefined && { stability: meta.stability }),
    ...(meta.similarityBoost !== undefined && {
      similarityBoost: meta.similarityBoost,
    }),
    ...(meta.speed !== undefined && { speed: meta.speed }),
    ...(meta.useSpeakerBoost !== undefined && {
      useSpeakerBoost: meta.useSpeakerBoost,
    }),
  }
}

/**
 * Build the narration cue controllers for a localized recording, directly from
 * the normalized localize spec. Per-cue voice can override the per-language
 * (`voiceByLang`) and config/global (`defaultVoice`) voices, so the cascade is
 * resolved per `(cue, language)` here rather than routed through
 * {@link buildCuesFromInput} (which is per-language only).
 *
 * Seeded cues emit translations carrying the resolved voice + spoken text (the
 * recorder filters to the active language). Studio-managed cues emit studio cue
 * starts whose content is owned by Studio.
 */
/**
 * Pre-warm (hash) every file-backed narration cue's media before recording, so a
 * video cue's start() reuses the cached hash rather than reading the file on the
 * timeline. Walks each language's seeded cues and pre-warms the media path of
 * every file entry. Fire-and-forget per path (see {@link prewarmAssetFile}).
 */
function prewarmNarrationMedia(
  narration: NonNullable<NormalizedNarration>,
  anchorFile: string
): void {
  for (const langCues of Object.values(narration.seedByLang)) {
    for (const value of Object.values(langCues ?? {})) {
      if (value.kind === 'media') {
        prewarmAssetFile(value.path, anchorFile)
      }
    }
  }
}

export function buildLocalizedNarrationCues(
  narration: NormalizedNarration,
  voiceByLang: Partial<Record<string, LangNarrationOverride>>,
  defaultVoice: TopLevelVoiceConfig | LangNarrationOverride | undefined,
  // The `.screenci` script media paths are resolved relative to. When provided,
  // every file-backed cue's media is pre-warmed (hashed) now, before the
  // recording clock starts, so the cue's start() reuses the cached hash instead
  // of paying the file read on the timeline. Omitted (no pre-warm) outside the
  // recording fixture, where the anchor and timing do not apply.
  anchorFile?: string
): Record<string, NarrationCue> {
  if (narration === null) return {}

  if (anchorFile !== undefined) {
    prewarmNarrationMedia(narration, anchorFile)
  }

  const studioSet = new Set(narration.studioNames)
  const result: Record<string, NarrationCue> = {}

  for (const cueName of narration.cueNames) {
    const isStudio = studioSet.has(cueName)

    // Languages that seed this cue, with the per-(cue, language) voice resolved.
    const langs = Object.keys(narration.seedByLang).filter(
      (lang) => narration.seedByLang[lang as Lang]?.[cueName] !== undefined
    )

    // A blank studio cue (`editable([...])`, no seed) is text-less: the web app
    // fills it and the render is held until then. A seeded studio cue
    // (`editable({...})`) falls through and emits its seed translations like a code
    // cue, but tagged `studio` so the web app can still override it (a Studio edit
    // wins over the seed) and so the render is not held.
    if (isStudio && langs.length === 0) {
      result[cueName] = createCueController(cueName, (recorder, until) => {
        sleepForCueFrameGap()
        recorder.addStudioCueStart(cueName, until)
      })
      continue
    }

    let hasFileEntry = false
    // Volume is per-cue (a render-time mix property): the first language that
    // sets a volume for this cue wins.
    let cueVolume: number | undefined
    for (const lang of langs) {
      const value = narration.seedByLang[lang as Lang]![cueName]!
      if (value.kind === 'media') hasFileEntry = true
      if (cueVolume === undefined && value.volume !== undefined) {
        cueVolume = validateCueVolume(cueName, value.volume)
      }
    }

    const resolveLang = (
      lang: string
    ): {
      value: NonNullable<
        NonNullable<NormalizedNarration>['seedByLang'][Lang]
      >[string]
      voice: VoiceKey | CustomVoiceRef
      meta: VoiceLanguageMeta
    } => {
      const value = narration.seedByLang[lang as Lang]![cueName]!
      const config = (value.kind === 'text' ? value.voice : undefined) ??
        voiceByLang[lang] ??
        defaultVoice ?? { name: voices.Sophie }
      const { name, meta } = resolveVoiceMeta(config)
      return { value, voice: name, meta }
    }

    if (hasFileEntry) {
      result[cueName] = createCueController(
        cueName,
        async (recorder, until) => {
          const testFilePath = getScreenCIRuntimeContext().testFilePath
          const resolved = new Map(
            langs.map((lang) => [lang, resolveLang(lang)])
          )
          for (const lang of langs) {
            recorder.registerVoiceForLang(lang, resolved.get(lang)!.meta)
          }
          const videoTranslations: Record<string, VideoCueTranslation> = {}
          for (const lang of langs) {
            const { value, voice, meta } = resolved.get(lang)!
            if (value.kind === 'text') {
              videoTranslations[lang] = {
                text: value.text,
                voice: await toRecordedVoice(voice),
                ...translationVoiceFields(meta),
                ...(value.language !== undefined &&
                  value.language !== lang && { language: value.language }),
              }
            } else {
              videoTranslations[lang] = await entryToVideoTranslation(
                testFilePath,
                {
                  path: value.path,
                  ...(value.subtitle !== undefined && {
                    subtitle: value.subtitle,
                  }),
                  ...(value.crop !== undefined && { crop: value.crop }),
                  ...(value.sourceStart !== undefined && {
                    sourceStart: value.sourceStart,
                  }),
                  ...(value.sourceEnd !== undefined && {
                    sourceEnd: value.sourceEnd,
                  }),
                }
              )
            }
          }
          sleepForCueFrameGap()
          recorder.addVideoCueStart(
            cueName,
            undefined,
            undefined,
            undefined,
            videoTranslations,
            cueVolume,
            until,
            isStudio
          )
        }
      )
    } else {
      result[cueName] = createCueController(
        cueName,
        async (recorder, until) => {
          const resolved = new Map(
            langs.map((lang) => [lang, resolveLang(lang)])
          )
          for (const lang of langs) {
            recorder.registerVoiceForLang(lang, resolved.get(lang)!.meta)
          }
          const textTranslations: Record<string, CueTranslation> = {}
          for (const lang of langs) {
            const { value, voice, meta } = resolved.get(lang)!
            if (value.kind !== 'text') continue
            textTranslations[lang] = {
              text: value.text,
              voice: await toRecordedVoice(voice),
              ...translationVoiceFields(meta),
              ...(value.language !== undefined &&
                value.language !== lang && { language: value.language }),
            }
          }
          sleepForCueFrameGap()
          recorder.addCueStart(
            '',
            cueName,
            undefined,
            textTranslations,
            cueVolume,
            until,
            isStudio
          )
        }
      )
    }
  }

  return result
}
