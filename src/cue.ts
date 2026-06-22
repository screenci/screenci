import type {
  IEventRecorder,
  CueTranslation,
  RecordingCustomVoiceRef,
  VideoCueTranslation,
  VideoCueTranslationFile,
  VoiceLanguageMeta,
} from './events.js'
import {
  supportedLanguages,
  voices,
  type VoiceKey,
  type ModelVoiceKey,
  type ElevenLabsVoiceKey,
  type Lang,
  type CustomVoiceRef,
  type ModelType,
} from './voices.js'
import { isCustomVoiceRef } from './customVoiceRef.js'
import { MAX_AUDIO_LEVEL } from './asset.js'
import { isInsideHide } from './hide.js'
import { logger } from './logger.js'
import { readFile } from 'fs/promises'
import { createHash } from 'crypto'
import { dirname, resolve } from 'path'
import {
  getScreenCIRuntimeContext,
  getRuntimeCueRecorder,
  resetCueRuntimeState,
  setRuntimeCueRecorder,
} from './runtimeContext.js'
import { resolveRecordingTimingDuration } from './runtimeMode.js'

// One frame at 24fps — ensures at least one rendered frame captures each cue state.
export const ONE_FRAME_MS = 1000 / 24
const ELEVENLABS_DOCS_URL =
  'https://screenci.com/docs/guides/narration-and-localization'

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

async function resolveAssetFileHash(
  assetPath: string,
  testFilePath: string | null
): Promise<string> {
  const candidates = [assetPath]
  if (testFilePath !== null) {
    const testDir = dirname(testFilePath)
    candidates.push(resolve(testDir, assetPath))
  }

  for (const candidate of candidates) {
    try {
      const fileBuffer = await readFile(candidate)
      return createHash('sha256').update(fileBuffer).digest('hex')
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Asset file not found: ${assetPath}`)
}

async function toRecordedVoice(
  voice: VoiceKey | CustomVoiceRef
): Promise<VoiceKey | RecordingCustomVoiceRef> {
  if (!isCustomVoiceRef(voice)) return voice
  const testFilePath = getScreenCIRuntimeContext().testFilePath
  return {
    assetHash: await resolveAssetFileHash(voice.path, testFilePath),
    assetPath: voice.path,
  }
}

function usesElevenLabsVoice(voice: VoiceKey | CustomVoiceRef): boolean {
  if (isCustomVoiceRef(voice)) return true
  return voice.startsWith('elevenlabs:')
}

function assertElevenLabsApiKeyConfigured(
  voice: VoiceKey | CustomVoiceRef,
  location: string
): void {
  if (!usesElevenLabsVoice(voice)) return
  if (process.env.ELEVENLABS_API_KEY?.trim()) return

  throw new Error(
    `${location} uses an ElevenLabs voice, but ELEVENLABS_API_KEY is not set. Add ELEVENLABS_API_KEY to your env file or process environment. See ${ELEVENLABS_DOCS_URL}.`
  )
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
 * ```
 */
export type NarrationCue = {
  (): Promise<void>
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

type NarrationCueObject =
  | ({ text: string } & NarrationVolume)
  | ({ media: string; subtitle?: string } & NarrationVolume)
  | ({ path: string; subtitle?: string } & NarrationVolume)

/** A single narration cue value in a multi-language map. */
export type CueMapValue = string | NarrationCueObject

/** Typed narration controllers keyed by the cue names in a language map. */
export type Cues<T extends Record<string, CueMapValue>> = {
  [K in keyof T]: NarrationCue
}

/**
 * Top-level voice configuration shared across all languages.
 * `seed` is not allowed here — use per-language `voice` overrides instead.
 *
 * Built-in model voices support expressive/consistent model controls.
 * ElevenLabs voices support only the numeric settings documented below.
 */
type ElevenLabsVoiceSettings = {
  /** Voice stability for ElevenLabs `eleven_multilingual_v2`. Valid range: 0 to 1. */
  stability?: number
  /** Similarity enhancement for ElevenLabs `eleven_multilingual_v2`. Valid range: 0 to 1. */
  similarityBoost?: number
  /** Style exaggeration for ElevenLabs `eleven_multilingual_v2`. Valid range: 0 to 1. */
  style?: number
  /** Playback speed for ElevenLabs `eleven_multilingual_v2`. Valid range: 0.7 to 1.2. */
  speed?: number
  /** Enables ElevenLabs speaker boost. Defaults to `true`. */
  useSpeakerBoost?: boolean
}

type ElevenLabsVoiceConfig = ElevenLabsVoiceSettings & {
  name: ElevenLabsVoiceKey | CustomVoiceRef
  modelType?: never
  accent?: never
  pacing?: never
}

export type TopLevelVoiceConfig =
  | ElevenLabsVoiceConfig
  | {
      name: ModelVoiceKey
      /** Speaking style prompt for expressive synthesis. Business tier only. Implies `expressive` model type. */
      style: string
      /** Can be omitted when `style` is set — `expressive` is implied. Business tier only. */
      modelType?: 'expressive'
      /**
       * Accent description for expressive synthesis.
       * The more specific, the better — e.g. `'Southern American English'` or `'Received Pronunciation British'`.
       * Omitted from the prompt when not set — the voice uses its natural default.
       */
      accent?: string
      /**
       * Pacing description for expressive synthesis.
       * Describes the overall speed and tempo — e.g. `'Measured and deliberate'` or `'Brisk and energetic'`.
       */
      pacing?: string
    }
  | {
      name: ModelVoiceKey
      style?: never
      accent?: never
      /** Speaking rate for consistent synthesis. Valid range: 0.25 to 2. */
      pacing?: number
      /** TTS model type — `modelTypes.expressive` or `modelTypes.consistent`. Defaults to `consistent`. */
      modelType?: Exclude<ModelType, 'expressive'> | undefined
    }

/**
 * Per-language narration override. Can override the top-level voice name and
 * optionally set a `seed` for TTS generation.
 *
 * The voice name discriminates provider-specific settings: built-in model
 * voices use expressive/consistent controls, while ElevenLabs voices use the
 * numeric `eleven_multilingual_v2` controls.
 */
export type LangNarrationOverride =
  | (ElevenLabsVoiceConfig & {
      /**
       * Integer seed included in the audio cache key and forwarded to ElevenLabs.
       * A different seed always forces regeneration.
       */
      seed?: number
    })
  | {
      name: ModelVoiceKey
      /**
       * Integer seed included in the audio cache key. A different seed always forces
       * regeneration. Consistent output is not guaranteed across all voice types.
       */
      seed?: number
      /** Speaking style prompt for expressive synthesis. Business tier only. Implies `expressive` model type. */
      style: string
      /** Can be omitted when `style` is set — `expressive` is implied. Business tier only. */
      modelType?: 'expressive'
      /**
       * Accent description for expressive synthesis.
       * The more specific, the better — e.g. `'Southern American English'` or `'Received Pronunciation British'`.
       * Omitted from the prompt when not set — the voice uses its natural default.
       */
      accent?: string
      /**
       * Pacing description for expressive synthesis.
       * Describes the overall speed and tempo — e.g. `'Measured and deliberate'` or `'Brisk and energetic'`.
       */
      pacing?: string
    }
  | {
      name: ModelVoiceKey
      /**
       * Integer seed included in the audio cache key. A different seed always forces
       * regeneration. Consistent output is not guaranteed across all voice types.
       */
      seed?: number
      style?: never
      accent?: never
      /** Speaking rate for consistent synthesis. Valid range: 0.25 to 2. */
      pacing?: number
      /** TTS model type — `modelTypes.expressive` or `modelTypes.consistent`. Defaults to `consistent`. */
      modelType?: Exclude<ModelType, 'expressive'> | undefined
    }

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

function createCueController(
  name: string,
  emitStart: (recorder: IEventRecorder) => void | Promise<void>
): NarrationCue {
  let didRegisterName = false

  const start = async (startedWithExplicitStart = true): Promise<void> => {
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
    await emitStart(recorder)
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

  const cue = (async (): Promise<void> => {
    await start(false)
    sleepForCueFrameGap()
    await end()
  }) as NarrationCue

  cue.start = start
  cue.end = end
  return cue
}

/**
 * Creates typed narration controllers whose text and voice are configured on
 * the ScreenCI Studio page instead of in code. Business tier only.
 *
 * Each key becomes a cue with the same behavior as {@link createNarration}
 * cues — callable, with explicit `start()` and `end()` methods. Languages,
 * narration text, and voice settings all come from Studio.
 *
 * On the first upload of a studio-mode video, rendering is held until the
 * video is configured in Studio (the CLI prints a direct link). Later uploads
 * reuse the saved Studio configuration automatically.
 *
 * @example
 * ```ts
 * const narration = createStudioNarration('intro', 'checkout', 'outro')
 *
 * await narration.intro()
 * await page.goto('/checkout')
 * await narration.checkout.start()
 * await narration.checkout.end()
 * ```
 */
export function createStudioNarration<
  const K extends readonly [string, ...string[]],
>(...keys: K): Cues<Record<K[number], CueMapValue>> {
  const seen = new Set<string>()
  for (const key of keys) {
    if (seen.has(key)) {
      throw new Error(
        `Duplicate cue key "${key}" passed to createStudioNarration. Cue keys must be unique.`
      )
    }
    seen.add(key)
  }

  const result = {} as Cues<Record<K[number], CueMapValue>>
  for (const key of keys) {
    result[key as K[number]] = createCueController(key, (recorder) => {
      sleepForCueFrameGap()
      recorder.addStudioCueStart(key)
    })
  }
  return result
}

type NormalizedCueMapValue =
  | { type: 'text'; text: string; volume?: number }
  | { type: 'file'; path: string; subtitle?: string; volume?: number }

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

  return {
    type: 'file',
    path: mediaPath,
    ...(value.subtitle !== undefined && { subtitle: value.subtitle }),
    ...(value.volume !== undefined && { volume: value.volume }),
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

    assertElevenLabsApiKeyConfigured(
      effectiveVoiceName,
      `createNarration(${lang})`
    )

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
      result[keyStr] = createCueController(keyStr, async (recorder) => {
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
          // Spread so the volume arg is omitted entirely (not passed as
          // undefined) when no per-cue volume was set.
          ...(cueVolume !== undefined ? [cueVolume] : [])
        )
      })
    } else {
      result[keyStr] = createCueController(keyStr, async (recorder) => {
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
          // Spread so the volume arg is omitted entirely (not passed as
          // undefined) when no per-cue volume was set.
          ...(cueVolume !== undefined ? [cueVolume] : [])
        )
      })
    }
  }
  return result
}

async function entryToVideoTranslation(
  testFilePath: string | null,
  entry: string | { path: string; subtitle?: string }
): Promise<VideoCueTranslationFile> {
  const path = typeof entry === 'string' ? entry : entry.path
  const subtitle = typeof entry === 'string' ? undefined : entry.subtitle
  return {
    assetHash: await resolveAssetFileHash(path, testFilePath),
    assetPath: path,
    ...(subtitle !== undefined && { subtitle }),
  }
}
