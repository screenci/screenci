import type {
  IEventRecorder,
  CaptionTranslation,
  RecordingCustomVoiceRef,
  VideoCaptionTranslation,
  VideoCaptionTranslationFile,
  VoiceLanguageMeta,
} from './events.js'
import type {
  VoiceKey,
  VoiceForLang,
  Lang,
  CustomVoiceRef,
  ModelType,
} from './voices.js'
import { isCustomVoiceRef } from './voices.js'
import { isInsideHide } from './hide.js'
import { access, readFile } from 'fs/promises'
import { createHash } from 'crypto'
import { dirname, resolve } from 'path'

// One frame at 24fps — ensures at least one rendered frame captures each caption state.
export const ONE_FRAME_MS = 1000 / 24

// Blocking sleep — spin until the elapsed time has passed
let sleepFn = (ms: number): void => {
  const end = performance.now() + ms
  while (performance.now() < end) {
    /* spin */
  }
}

export function setSleepFn(fn: (ms: number) => void): void {
  sleepFn = fn
}

let activeRecorder: IEventRecorder | null = null
let captionStarted = false
const registeredCustomVoiceRefs = new Set<CustomVoiceRef>()
/** Maps local asset path → SHA-256 hash, populated during validateCustomVoiceRefs. */
const videoCaptionFileHashes = new Map<string, string>()

export function setActiveCaptionRecorder(
  recorder: IEventRecorder | null
): void {
  activeRecorder = recorder
}

export function resetCaptionChain(): void {
  captionStarted = false
}

export function resetRegisteredCustomVoiceRefs(): void {
  registeredCustomVoiceRefs.clear()
  videoCaptionFileHashes.clear()
}

export async function validateCustomVoiceRefs(
  testFilePath: string
): Promise<void> {
  const testDir = dirname(testFilePath)

  for (const ref of registeredCustomVoiceRefs) {
    const candidates = [ref.path, resolve(testDir, ref.path)]
    let fileBuffer: Buffer | null = null

    for (const candidate of candidates) {
      try {
        await access(candidate)
        fileBuffer = await readFile(candidate)
        break
      } catch {
        // try next candidate
      }
    }

    if (fileBuffer === null) {
      throw new Error(`Custom voice file not found: ${ref.path}`)
    }

    ;(ref as CustomVoiceRef & { assetHash: string }).assetHash = createHash(
      'sha256'
    )
      .update(fileBuffer)
      .digest('hex')
  }

  for (const assetPath of videoCaptionFileHashes.keys()) {
    const candidates = [assetPath, resolve(testDir, assetPath)]
    let fileBuffer: Buffer | null = null

    for (const candidate of candidates) {
      try {
        fileBuffer = await readFile(candidate)
        break
      } catch {
        // try next candidate
      }
    }

    if (fileBuffer === null) {
      throw new Error(`Video caption asset file not found: ${assetPath}`)
    }

    videoCaptionFileHashes.set(
      assetPath,
      createHash('sha256').update(fileBuffer).digest('hex')
    )
  }
}

function toRecordedVoice(
  voice: VoiceKey | CustomVoiceRef
): VoiceKey | RecordingCustomVoiceRef {
  if (!isCustomVoiceRef(voice)) return voice
  if (
    !('assetHash' in voice) ||
    typeof (voice as CustomVoiceRef & { assetHash?: string }).assetHash !==
      'string'
  ) {
    throw new Error(`Custom voice assetHash missing for path: ${voice.path}`)
  }
  return {
    assetHash: (voice as CustomVoiceRef & { assetHash: string }).assetHash,
    assetPath: voice.path,
  }
}

/**
 * Auto-ends any currently active caption before starting a new one.
 * Called internally at the start of every voiceOver controller.
 */
function captionAutoEnd(): void {
  if (!captionStarted || activeRecorder === null) return
  activeRecorder.addCaptionEnd('auto')
  sleepFn(2 * ONE_FRAME_MS)
  captionStarted = false
}

async function doWaitEnd(): Promise<void> {
  if (activeRecorder === null || !captionStarted) return
  if (isInsideHide()) throw new Error('Cannot call waitEnd inside hide()')
  activeRecorder.addCaptionEnd('waitEnd')
  sleepFn(2 * ONE_FRAME_MS)
  captionStarted = false
}

/**
 * A voiceOver controller. Awaiting it starts the voiceover.
 *
 * @example
 * ```ts
 * await voiceOvers.intro
 * await page.goto('/dashboard')
 * await voiceOvers.nextStep
 * ```
 */
export type CaptionController = PromiseLike<void>

/** A single caption value in a multi-language map: either TTS text or a file-based entry. */
export type CaptionMapValue = string | { path: string; subtitle?: string }

export type Captions<T extends Record<string, CaptionMapValue>> = {
  [K in keyof T]: CaptionController
} & {
  /**
   * Waits for the current voiceOver to finish before the next action.
   *
   * Only needed when an action must happen _after_ a voiceOver ends.
   * Consecutive `await voiceOvers.x` calls sequence automatically — each
   * one ends the previous before starting.
   *
   * @example
   * ```ts
   * await voiceOvers.intro
   * await voiceOvers.waitEnd() // wait for intro audio to finish
   * await page.click('#next')  // click happens after intro ends
   * ```
   */
  waitEnd(): Promise<void>
}

export type VideoCaptionEntry = string | { path: string; subtitle?: string }

export type VideoCaptions<T extends Record<string, VideoCaptionEntry>> = {
  [K in keyof T]: CaptionController
} & {
  /**
   * Waits for the current voiceOver to finish before the next action.
   * @see {@link Captions.waitEnd}
   */
  waitEnd(): Promise<void>
}

/**
 * Top-level voice configuration shared across all languages.
 * `seed` is not allowed here — use per-language `voice` overrides instead.
 *
 * Use `style` for expressive synthesis, or `modelType` for an explicit
 * model choice. `style` and `modelType` are mutually exclusive.
 */
export type TopLevelVoiceConfig =
  | {
      name: VoiceKey | CustomVoiceRef
      /** Speaking style prompt for expressive synthesis. Implies `expressive` model type. */
      style: string
      /** Can be omitted when `style` is set — `expressive` is implied. */
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
      pacing?: never
      /** TTS model type — `modelTypes.expressive` or `modelTypes.consistent`. Defaults to `consistent`. */
      modelType?: ModelType
    }

/**
 * Per-language voice override. Can override the top-level voice name and
 * optionally set a `seed` for TTS generation.
 *
 * Use `style` for expressive synthesis, or `modelType` for an explicit
 * model choice. `style` and `modelType` are mutually exclusive.
 */
export type LangVoiceOverride =
  | {
      name: VoiceKey | CustomVoiceRef
      /**
       * Integer seed included in the audio cache key. A different seed always forces
       * regeneration. Consistent output is not guaranteed across all voice types.
       */
      seed?: number
      /** Speaking style prompt for expressive synthesis. Implies `expressive` model type. */
      style: string
      /** Can be omitted when `style` is set — `expressive` is implied. */
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
      pacing?: never
      /** TTS model type — `modelTypes.expressive` or `modelTypes.consistent`. Defaults to `consistent`. */
      modelType?: ModelType
    }

/** Converts a union type to an intersection: `A | B` → `A & B` */
type UnionToIntersection<U> = (
  U extends unknown ? (x: U) => void : never
) extends (x: infer I) => void
  ? I
  : never

/**
 * Produces a record requiring every key that appears in any language's captions.
 * Uses each language's key set with CaptionMapValue values before intersecting,
 * so value types don't conflict (e.g. string vs { path, subtitle } for the same key).
 */
type AllCaptions<
  M extends Partial<
    Record<Lang, { captions: Record<string, CaptionMapValue> }>
  >,
> = UnionToIntersection<
  {
    [L in keyof M]: M[L] extends { captions: infer C }
      ? Record<keyof C & string, CaptionMapValue>
      : never
  }[keyof M]
> &
  Record<string, CaptionMapValue>

type LangVoiceOverrideForLang<L extends string> =
  | {
      name: (L extends Lang ? VoiceForLang<L> : VoiceKey) | CustomVoiceRef
      seed?: number
      style: string
      modelType?: 'expressive'
      accent?: string
      pacing?: string
    }
  | {
      name: (L extends Lang ? VoiceForLang<L> : VoiceKey) | CustomVoiceRef
      seed?: number
      style?: never
      accent?: never
      pacing?: never
      modelType?: ModelType
    }

type LanguagesMap<
  M extends Partial<
    Record<Lang, { captions: Record<string, CaptionMapValue> }>
  >,
> = M & {
  [L in keyof M]: {
    voice?: L extends string ? LangVoiceOverrideForLang<L> : never
    /** BCP-47 region code for TTS synthesis, e.g. `languageRegions.en.US`. */
    region?: string
    captions: AllCaptions<M>
  }
}

/**
 * Creates a set of typed voiceover controllers, one per key in the map.
 *
 * Each controller has `start()` and `end()`.
 * At render time screenci generates a voiceover, and syncs the audio to the
 * recording. You write text; the voice is handled for you.
 *
 * The top-level `voice` applies to all languages. Override it per-language via
 * the `voice` field inside each language entry. Only language-level overrides
 * may set `seed`.
 *
 * TypeScript enforces that every language has the same caption keys.
 * Forget a translation key → compile error.
 *
 * @example
 * ```ts
 * const voiceOvers = createVoiceOvers({
 *   voice: { name: voices.Ava, style: 'Clear and friendly' },
 *   languages: {
 *     en: { captions: { intro: 'Welcome.', next: 'Click here.' } },
 *     fi: {
 *       voice: { name: voices.Nora, style: 'Selkeä opastus', seed: 42 },
 *       captions: { intro: 'Tervetuloa.', next: 'Napsauta tästä.' },
 *     },
 *   },
 * })
 *
 * // Await a voiceOver directly to start it:
 * await voiceOvers.intro
 * await page.goto('/dashboard')
 *
 * // Consecutive voiceOvers sequence automatically:
 * await voiceOvers.intro
 * await voiceOvers.next  // ends intro, then starts next
 *
 * // Wait for audio to finish before an action:
 * await voiceOvers.intro
 * await voiceOvers.waitEnd()
 * await page.click('#start')
 * ```
 */
export function createVoiceOvers<
  M extends Partial<
    Record<
      Lang,
      {
        voice?: LangVoiceOverride
        region?: string
        captions: Record<string, CaptionMapValue>
      }
    >
  >,
>(input: {
  voice: TopLevelVoiceConfig
  languages: LanguagesMap<M>
}): Captions<AllCaptions<M>> {
  return buildCaptionsFromInput(
    input.voice,
    input.languages as Partial<
      Record<
        Lang,
        {
          voice?: LangVoiceOverride
          region?: string
          captions: Record<string, CaptionMapValue>
        }
      >
    >
  ) as Captions<AllCaptions<M>>
}

function voiceToKeyString(voice: VoiceKey | CustomVoiceRef): string {
  if (isCustomVoiceRef(voice)) return `custom:${voice.path}`
  return voice
}

function buildCaptionsFromInput(
  topVoice: TopLevelVoiceConfig,
  languages: Partial<
    Record<
      Lang,
      {
        voice?: LangVoiceOverride
        region?: string
        captions: Record<string, CaptionMapValue>
      }
    >
  >
): Captions<Record<string, CaptionMapValue>> {
  const langs = Object.keys(languages) as Lang[]
  const firstLang = langs[0]
  if (firstLang === undefined) {
    throw new Error(
      'createVoiceOvers requires at least one language in "languages"'
    )
  }

  // Resolve effective voice and metadata per language
  const resolvedVoices = new Map<string, VoiceKey | CustomVoiceRef>()
  const resolvedVoiceMeta = new Map<string, VoiceLanguageMeta>()

  for (const lang of langs) {
    const entry = languages[lang]
    const langOverride = entry?.voice
    const effectiveVoiceName = langOverride?.name ?? topVoice.name
    const effectiveSeed = langOverride?.seed
    const effectiveRegion = entry?.region
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
          ? (topVoice as { pacing?: string }).pacing
          : undefined
    const effectiveModelType = effectiveStyle
      ? 'expressive'
      : (langOverride?.modelType ?? topVoice.modelType)

    if (isCustomVoiceRef(effectiveVoiceName)) {
      registeredCustomVoiceRefs.add(effectiveVoiceName)
    }

    resolvedVoices.set(lang, effectiveVoiceName)
    resolvedVoiceMeta.set(lang, {
      name: voiceToKeyString(effectiveVoiceName),
      ...(effectiveSeed !== undefined && { seed: effectiveSeed }),
      ...(effectiveRegion !== undefined && { region: effectiveRegion }),
      ...(effectiveModelType !== undefined && {
        modelType: effectiveModelType,
      }),
      ...(effectiveStyle !== undefined && { style: effectiveStyle }),
      ...(effectiveAccent !== undefined && { accent: effectiveAccent }),
      ...(effectivePacing !== undefined && { pacing: effectivePacing }),
    })
  }

  const firstEntry = languages[firstLang]
  if (!firstEntry) return {} as Captions<Record<string, CaptionMapValue>>

  const result = {} as Captions<Record<string, CaptionMapValue>>

  for (const key in firstEntry.captions) {
    const keyStr = key

    // Determine if any language uses a file-based value for this key.
    let hasFileEntry = false
    for (const lang of langs) {
      const val = languages[lang]?.captions[keyStr]
      if (val !== undefined && typeof val !== 'string') {
        hasFileEntry = true
        videoCaptionFileHashes.set(val.path, '')
      }
    }

    if (hasFileEntry) {
      const fileStartFn = async (): Promise<void> => {
        if (isInsideHide())
          throw new Error('Cannot start a voiceOver inside hide()')
        if (activeRecorder === null) return
        captionAutoEnd()
        for (const lang of langs) {
          activeRecorder.registerVoiceForLang(
            lang,
            resolvedVoiceMeta.get(lang)!
          )
        }
        const videoTranslations: Record<string, VideoCaptionTranslation> = {}
        for (const lang of langs) {
          const val = languages[lang]?.captions[keyStr]
          if (val === undefined) continue
          const voice = resolvedVoices.get(lang)!
          const region = languages[lang]?.region
          const meta = resolvedVoiceMeta.get(lang)
          const modelType = meta?.modelType
          const style = meta?.style
          const accent = meta?.accent
          const pacing = meta?.pacing
          if (typeof val === 'string') {
            videoTranslations[lang] = {
              text: val,
              voice: toRecordedVoice(voice),
              ...(region !== undefined && { region }),
              ...(modelType !== undefined && { modelType }),
              ...(style !== undefined && { style }),
              ...(accent !== undefined && { accent }),
              ...(pacing !== undefined && { pacing }),
            }
          } else {
            videoTranslations[lang] = entryToVideoTranslation(val)
          }
        }
        captionStarted = true
        sleepFn(2 * ONE_FRAME_MS)
        activeRecorder.addVideoCaptionStart(
          keyStr,
          undefined,
          undefined,
          undefined,
          videoTranslations
        )
      }
      result[keyStr] = {
        then(resolve, reject) {
          return fileStartFn().then(resolve, reject)
        },
      }
    } else {
      const textStartFn = async (): Promise<void> => {
        if (isInsideHide())
          throw new Error('Cannot start a voiceOver inside hide()')
        if (activeRecorder === null) return
        captionAutoEnd()
        for (const lang of langs) {
          activeRecorder.registerVoiceForLang(
            lang,
            resolvedVoiceMeta.get(lang)!
          )
        }
        const textTranslations: Record<string, CaptionTranslation> = {}
        for (const lang of langs) {
          const val = languages[lang]?.captions[keyStr]
          if (val !== undefined && typeof val === 'string') {
            const voice = resolvedVoices.get(lang)!
            const region = languages[lang]?.region
            const meta = resolvedVoiceMeta.get(lang)
            const modelType = meta?.modelType
            const style = meta?.style
            const accent = meta?.accent
            const pacing = meta?.pacing
            textTranslations[lang] = {
              text: val,
              voice: toRecordedVoice(voice),
              ...(region !== undefined && { region }),
              ...(modelType !== undefined && { modelType }),
              ...(style !== undefined && { style }),
              ...(accent !== undefined && { accent }),
              ...(pacing !== undefined && { pacing }),
            }
          }
        }
        captionStarted = true
        sleepFn(2 * ONE_FRAME_MS)
        activeRecorder.addCaptionStart('', keyStr, undefined, textTranslations)
      }
      result[keyStr] = {
        then(resolve, reject) {
          return textStartFn().then(resolve, reject)
        },
      }
    }
  }

  ;(result as unknown as { waitEnd: () => Promise<void> }).waitEnd = doWaitEnd
  return result
}

type MultiLangVideoCaptionMap<
  L extends Lang,
  T extends Record<string, VideoCaptionEntry>,
> = {
  [K in L]: { captions: T }
}

type RequireAllSameVideoKeys<
  M extends Partial<
    Record<Lang, { captions: Record<string, VideoCaptionEntry> }>
  >,
> = {
  [L in keyof M]: {
    captions: UnionToIntersection<
      M[keyof M] extends { captions: infer C } ? C : never
    >
  }
}

function entryToVideoTranslation(
  entry: VideoCaptionEntry
): VideoCaptionTranslationFile {
  const path = typeof entry === 'string' ? entry : entry.path
  const subtitle = typeof entry === 'string' ? undefined : entry.subtitle
  const assetHash = videoCaptionFileHashes.get(path)
  if (!assetHash)
    throw new Error(`Video caption asset hash missing for path: ${path}`)
  return {
    assetHash,
    assetPath: path,
    ...(subtitle !== undefined && { subtitle }),
  }
}

/**
 * Creates caption controllers backed by pre-recorded asset files instead of
 * TTS-generated audio. Each entry maps a name to either an asset path string
 * or an object with `assetPath` and an optional `subtitle` text.
 *
 * At render time the asset file is used directly as the voiceover audio.
 * If `subtitle` is provided, words are spread with equal timing across the
 * audio duration (no word-level TTS data available).
 *
 * Same constraints as `createVoiceOvers`: cannot overlap with other captions,
 * and cannot fall inside input events.
 *
 * Two overloads:
 *
 * **1. Single-language:**
 * ```ts
 * const captions = createVideoCaptions({
 *   intro: '/assets/intro.mp3',
 *   demo: { assetPath: '/assets/demo.mp3', subtitle: 'Watch the demo.' },
 * })
 * ```
 *
 * **2. Multi-language (type-safe):**
 * TypeScript enforces that every language has the same caption keys.
 * ```ts
 * const captions = createVideoCaptions({
 *   en: { captions: { intro: '/assets/en/intro.mp3' } },
 *   fi: { captions: { intro: '/assets/fi/intro.mp3' } },
 * })
 * ```
 */
export function createVideoCaptions<
  T extends Record<string, VideoCaptionEntry>,
>(captionsMap: T): VideoCaptions<T>
export function createVideoCaptions<
  L extends Lang,
  T extends Record<string, VideoCaptionEntry>,
>(
  languagesMap: {
    [K in L]: { captions: T }
  } & RequireAllSameVideoKeys<{
    [K in L]: { captions: Record<string, VideoCaptionEntry> }
  }>
): VideoCaptions<T & Record<string, VideoCaptionEntry>>
export function createVideoCaptions<
  L extends Lang,
  T extends Record<string, VideoCaptionEntry>,
>(firstArg: T | MultiLangVideoCaptionMap<L, T>): VideoCaptions<T> {
  // Distinguish single-language vs multi-language by checking if any value has a `captions` key
  const firstValue = Object.values(firstArg)[0]
  if (
    firstValue !== undefined &&
    typeof firstValue === 'object' &&
    !Array.isArray(firstValue) &&
    'captions' in firstValue &&
    typeof (firstValue as Record<string, unknown>).captions === 'object'
  ) {
    return buildMultiLangVideoCaptions(
      firstArg as MultiLangVideoCaptionMap<L, T>
    )
  }
  return buildSingleLangVideoCaptions(firstArg as T)
}

function buildSingleLangVideoCaptions<
  T extends Record<string, VideoCaptionEntry>,
>(captionsMap: T): VideoCaptions<T> {
  const result = {} as VideoCaptions<T>

  for (const key in captionsMap) {
    const entry = captionsMap[key]
    if (entry === undefined) continue
    const assetPath = typeof entry === 'string' ? entry : entry.path
    const subtitle = typeof entry === 'string' ? undefined : entry.subtitle
    videoCaptionFileHashes.set(assetPath, '')

    const startFn = async (): Promise<void> => {
      if (isInsideHide())
        throw new Error('Cannot start a voiceOver inside hide()')
      if (activeRecorder === null) return
      captionAutoEnd()
      const assetHash = videoCaptionFileHashes.get(assetPath)
      if (!assetHash)
        throw new Error(
          `Video caption asset hash missing for path: ${assetPath}`
        )
      captionStarted = true
      sleepFn(2 * ONE_FRAME_MS)
      activeRecorder.addVideoCaptionStart(key, assetPath, assetHash, subtitle)
    }
    ;(result as unknown as Record<string, CaptionController>)[key] = {
      then(resolve, reject) {
        return startFn().then(resolve, reject)
      },
    }
  }

  ;(result as unknown as { waitEnd: () => Promise<void> }).waitEnd = doWaitEnd
  return result
}

function buildMultiLangVideoCaptions<
  L extends Lang,
  T extends Record<string, VideoCaptionEntry>,
>(languagesMap: MultiLangVideoCaptionMap<L, T>): VideoCaptions<T> {
  const langs = Object.keys(languagesMap) as L[]
  const firstLang = langs[0]
  if (firstLang === undefined) {
    const empty = {} as VideoCaptions<T>
    ;(empty as unknown as { waitEnd: () => Promise<void> }).waitEnd = doWaitEnd
    return empty
  }

  const result = {} as VideoCaptions<T>

  for (const key in languagesMap[firstLang].captions) {
    const keyStr = key as string

    const translations: Record<string, VideoCaptionTranslation> = {}
    for (const lang of langs) {
      const entry = languagesMap[lang].captions[keyStr]
      if (entry !== undefined) {
        const assetPath = typeof entry === 'string' ? entry : entry.path
        videoCaptionFileHashes.set(assetPath, '')
        translations[lang] = entryToVideoTranslation(entry)
      }
    }

    const startFn = async (): Promise<void> => {
      if (isInsideHide())
        throw new Error('Cannot start a voiceOver inside hide()')
      if (activeRecorder === null) return
      captionAutoEnd()
      captionStarted = true
      sleepFn(2 * ONE_FRAME_MS)
      activeRecorder.addVideoCaptionStart(
        keyStr,
        undefined,
        undefined,
        undefined,
        translations
      )
    }
    ;(result as unknown as Record<string, CaptionController>)[key] = {
      then(resolve, reject) {
        return startFn().then(resolve, reject)
      },
    }
  }

  ;(result as unknown as { waitEnd: () => Promise<void> }).waitEnd = doWaitEnd
  return result
}
