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
  type Lang,
  type CustomVoiceRef,
  type ModelType,
} from './voices.js'
import { isCustomVoiceRef } from './customVoiceRef.js'
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

type NarrationCueObject =
  | { text: string }
  | { media: string; subtitle?: string }
  | { path: string; subtitle?: string }

/** A single narration cue value in a multi-language map. */
export type CueMapValue = string | NarrationCueObject

export type Cues<T extends Record<string, CueMapValue>> = {
  [K in keyof T]: NarrationCue
}

/**
 * Top-level voice configuration shared across all languages.
 * `seed` is not allowed here — use per-language `voice` overrides instead.
 *
 * Use `style` for expressive synthesis, or `modelType` for an explicit
 * model choice. `style` and `modelType` are mutually exclusive. Expressive
 * synthesis and `style` prompts require the Business tier.
 */
export type TopLevelVoiceConfig =
  | {
      name: VoiceKey | CustomVoiceRef
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
      name: VoiceKey | CustomVoiceRef
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
 * Use `style` for expressive synthesis, or `modelType` for an explicit
 * model choice. `style` and `modelType` are mutually exclusive. Expressive
 * synthesis and `style` prompts require the Business tier.
 */
export type LangNarrationOverride =
  | {
      name: VoiceKey | CustomVoiceRef
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
      name: VoiceKey | CustomVoiceRef
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

type NormalizedCueMapValue =
  | { type: 'text'; text: string }
  | { type: 'file'; path: string; subtitle?: string }

const RESERVED_LANGUAGE_METADATA_KEYS = new Set<LanguageMetadataKey>(['voice'])
const SUPPORTED_LANGUAGE_SET = new Set<Lang>(supportedLanguages)

function normalizeCueMapValue(value: CueMapValue): NormalizedCueMapValue {
  if (typeof value === 'string') {
    return { type: 'text', text: value }
  }

  if ('text' in value) {
    return { type: 'text', text: value.text }
  }

  const mediaPath = 'media' in value ? value.media : value.path

  return {
    type: 'file',
    path: mediaPath,
    ...(value.subtitle !== undefined && { subtitle: value.subtitle }),
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
    // If a lang override exists it owns style/accent/pacing entirely — no inheritance from the
    // top-level voice. This prevents a top-level `style` from forcing `expressive` on a lang
    // that explicitly sets `modelType: 'consistent'`.
    const effectiveStyle =
      langOverride !== undefined
        ? langOverride?.style
        : 'style' in topVoice
          ? (topVoice as { style: string }).style
          : undefined
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
    const effectiveModelType = effectiveStyle
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
    })
  }

  const firstEntry = languages[firstLang]
  if (!firstEntry) return {} as Cues<Record<string, CueMapValue>>

  const result = {} as Cues<Record<string, CueMapValue>>

  const firstCues = getLanguageCues(firstLang, firstEntry)
  if (firstCues === undefined) return {} as Cues<Record<string, CueMapValue>>

  function createCueController(
    name: string,
    emitStart: (recorder: IEventRecorder) => void | Promise<void>
  ): NarrationCue {
    let didRegisterName = false

    const start = async (startedWithExplicitStart = true): Promise<void> => {
      if (isInsideHide())
        throw new Error('Cannot start narration inside hide()')
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

  for (const key in firstCues) {
    const keyStr = key

    const normalizedByLang = new Map<Lang, NormalizedCueMapValue>()

    // Normalize shorthand values and determine if any language uses a file entry for this key.
    let hasFileEntry = false
    for (const lang of langs) {
      const val = getLanguageCues(lang, languages[lang])?.[keyStr]
      if (val !== undefined) {
        const normalized = normalizeCueMapValue(val)
        normalizedByLang.set(lang, normalized)
        if (normalized.type === 'file') {
          hasFileEntry = true
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
          if (val.type === 'text') {
            videoTranslations[lang] = {
              text: val.text,
              voice: await toRecordedVoice(voice),
              ...(modelType !== undefined && { modelType }),
              ...(style !== undefined && { style }),
              ...(accent !== undefined && { accent }),
              ...(pacing !== undefined && { pacing }),
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
          videoTranslations
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
            textTranslations[lang] = {
              text: val.text,
              voice: await toRecordedVoice(voice),
              ...(modelType !== undefined && { modelType }),
              ...(style !== undefined && { style }),
              ...(accent !== undefined && { accent }),
              ...(pacing !== undefined && { pacing }),
            }
          }
        }
        sleepForCueFrameGap()
        recorder.addCueStart('', keyStr, undefined, textTranslations)
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
