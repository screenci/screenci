import type {
  IEventRecorder,
  CueTranslation,
  RecordingCustomVoiceRef,
  VideoCueTranslation,
  VideoCueTranslationFile,
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

// One frame at 24fps — ensures at least one rendered frame captures each cue state.
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
let cueStarted = false
const registeredCustomVoiceRefs = new Set<CustomVoiceRef>()
/** Maps local asset path → SHA-256 hash, populated during validateCustomVoiceRefs. */
const videoCueFileHashes = new Map<string, string>()

export function setActiveCueRecorder(recorder: IEventRecorder | null): void {
  activeRecorder = recorder
}

export function resetCueChain(): void {
  cueStarted = false
}

export function resetRegisteredCustomVoiceRefs(): void {
  registeredCustomVoiceRefs.clear()
  videoCueFileHashes.clear()
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

  for (const assetPath of videoCueFileHashes.keys()) {
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
      throw new Error(`Video cue asset file not found: ${assetPath}`)
    }

    videoCueFileHashes.set(
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
 * Auto-ends any currently active cue before starting a new one.
 * Called internally at the start of every narration controller.
 */
function cueAutoEnd(): void {
  if (!cueStarted || activeRecorder === null) return
  activeRecorder.addCueEnd('auto')
  sleepFn(2 * ONE_FRAME_MS)
  cueStarted = false
}

async function doWait(): Promise<void> {
  if (activeRecorder === null || !cueStarted) return
  if (isInsideHide()) throw new Error('Cannot call wait() inside hide()')
  activeRecorder.addCueEnd('wait')
  sleepFn(2 * ONE_FRAME_MS)
  cueStarted = false
}

/**
 * A narration controller. Awaiting it starts the narration segment.
 *
 * @example
 * ```ts
 * await narration.intro
 * await page.goto('/dashboard')
 * await narration.nextStep
 * ```
 */
export type CueController = PromiseLike<void>

type NarrationCueObject =
  | { text: string }
  | { media: string; subtitle?: string }
  | { path: string; subtitle?: string }

/** A single narration cue value in a multi-language map. */
export type CueMapValue = string | NarrationCueObject

export type Cues<T extends Record<string, CueMapValue>> = {
  [K in keyof T]: CueController
} & {
  /**
   * Waits for the current narration segment to finish before the next action.
   *
   * Only needed when an action must happen _after_ narration ends.
   * Consecutive `await narration.x` calls sequence automatically — each
   * one ends the previous before starting.
   *
   * @example
   * ```ts
   * await narration.intro
   * await narration.wait() // wait for intro audio to finish
   * await page.click('#next')  // click happens after intro ends
   * ```
   */
  wait(): Promise<void>
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
 * Per-language narration override. Can override the top-level voice name and
 * optionally set a `seed` for TTS generation.
 *
 * Use `style` for expressive synthesis, or `modelType` for an explicit
 * model choice. `style` and `modelType` are mutually exclusive.
 */
export type LangNarrationOverride =
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
 * Produces a record requiring every key that appears in any language's cues.
 * Uses each language's key set with CueMapValue values before intersecting,
 * so value types don't conflict (e.g. string vs { path, subtitle } for the same key).
 */
type LanguageEntryBase = {
  voice?: LangNarrationOverride
  region?: string
}

type LanguageCuesEntry<C extends Record<string, CueMapValue>> =
  LanguageEntryBase & { cues: C }

type AllCues<
  M extends Partial<
    Record<Lang, LanguageCuesEntry<Record<string, CueMapValue>>>
  >,
> = UnionToIntersection<
  {
    [L in keyof M]: M[L] extends { cues: infer C }
      ? Record<keyof C & string, CueMapValue>
      : never
  }[keyof M]
> &
  Record<string, CueMapValue>

type LangNarrationOverrideForLang<L extends string> =
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
    Record<Lang, LanguageCuesEntry<Record<string, CueMapValue>>>
  >,
> = M & {
  [L in keyof M]: {
    voice?: L extends string ? LangNarrationOverrideForLang<L> : never
    /** BCP-47 region code for TTS synthesis, e.g. `languageRegions.en.US`. */
    region?: string
  } & { cues: AllCues<M> }
}

/**
 * Creates a set of typed narration controllers, one per key in the map.
 *
 * Each controller has `start()` and `end()`.
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
 *   voice: { name: voices.Ava, style: 'Clear and friendly' },
 *   languages: {
 *     en: { cues: { intro: 'Welcome.', next: 'Click here.' } },
 *     fi: {
 *       voice: { name: voices.Nora, style: 'Selkeä opastus', seed: 42 },
 *       cues: { intro: 'Tervetuloa.', next: 'Napsauta tästä.' },
 *     },
 *   },
 * })
 *
 * // Await a narration segment directly to start it:
 * await narration.intro
 * await page.goto('/dashboard')
 *
 * // Consecutive narration segments sequence automatically:
 * await narration.intro
 * await narration.next  // ends intro, then starts next
 *
 * // Wait for audio to finish before an action:
 * await narration.intro
 * await narration.wait()
 * await page.click('#start')
 * ```
 */
export function createNarration<
  M extends Partial<
    Record<Lang, LanguageCuesEntry<Record<string, CueMapValue>>>
  >,
>(input: {
  voice: TopLevelVoiceConfig
  languages: LanguagesMap<M>
}): Cues<AllCues<M>> {
  return buildCuesFromInput(
    input.voice,
    input.languages as Partial<
      Record<Lang, LanguageCuesEntry<Record<string, CueMapValue>>>
    >
  ) as Cues<AllCues<M>>
}

type NormalizedCueMapValue =
  | { type: 'text'; text: string }
  | { type: 'file'; path: string; subtitle?: string }

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
  entry: LanguageCuesEntry<Record<string, CueMapValue>> | undefined
): Record<string, CueMapValue> | undefined {
  if (entry === undefined) return undefined
  return entry.cues
}

function voiceToKeyString(voice: VoiceKey | CustomVoiceRef): string {
  if (isCustomVoiceRef(voice)) return `custom:${voice.path}`
  return voice
}

function buildCuesFromInput(
  topVoice: TopLevelVoiceConfig,
  languages: Partial<
    Record<Lang, LanguageCuesEntry<Record<string, CueMapValue>>>
  >
): Cues<Record<string, CueMapValue>> {
  const langs = Object.keys(languages) as Lang[]
  const firstLang = langs[0]
  if (firstLang === undefined) {
    throw new Error(
      'createNarration requires at least one language in "languages"'
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
  if (!firstEntry) return {} as Cues<Record<string, CueMapValue>>

  const result = {} as Cues<Record<string, CueMapValue>>

  const firstCues = getLanguageCues(firstEntry)
  if (firstCues === undefined) return {} as Cues<Record<string, CueMapValue>>

  for (const key in firstCues) {
    const keyStr = key

    const normalizedByLang = new Map<Lang, NormalizedCueMapValue>()

    // Normalize shorthand values and determine if any language uses a file entry for this key.
    let hasFileEntry = false
    for (const lang of langs) {
      const val = getLanguageCues(languages[lang])?.[keyStr]
      if (val !== undefined) {
        const normalized = normalizeCueMapValue(val)
        normalizedByLang.set(lang, normalized)
        if (normalized.type === 'file') {
          hasFileEntry = true
          videoCueFileHashes.set(normalized.path, '')
        }
      }
    }

    if (hasFileEntry) {
      const fileStartFn = async (): Promise<void> => {
        if (isInsideHide())
          throw new Error('Cannot start narration inside hide()')
        if (activeRecorder === null) return
        cueAutoEnd()
        for (const lang of langs) {
          activeRecorder.registerVoiceForLang(
            lang,
            resolvedVoiceMeta.get(lang)!
          )
        }
        const videoTranslations: Record<string, VideoCueTranslation> = {}
        for (const lang of langs) {
          const val = normalizedByLang.get(lang)
          if (val === undefined) continue
          const voice = resolvedVoices.get(lang)!
          const region = languages[lang]?.region
          const meta = resolvedVoiceMeta.get(lang)
          const modelType = meta?.modelType
          const style = meta?.style
          const accent = meta?.accent
          const pacing = meta?.pacing
          if (val.type === 'text') {
            videoTranslations[lang] = {
              text: val.text,
              voice: toRecordedVoice(voice),
              ...(region !== undefined && { region }),
              ...(modelType !== undefined && { modelType }),
              ...(style !== undefined && { style }),
              ...(accent !== undefined && { accent }),
              ...(pacing !== undefined && { pacing }),
            }
          } else {
            videoTranslations[lang] = entryToVideoTranslation({
              path: val.path,
              ...(val.subtitle !== undefined && { subtitle: val.subtitle }),
            })
          }
        }
        cueStarted = true
        sleepFn(2 * ONE_FRAME_MS)
        activeRecorder.addVideoCueStart(
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
          throw new Error('Cannot start narration inside hide()')
        if (activeRecorder === null) return
        cueAutoEnd()
        for (const lang of langs) {
          activeRecorder.registerVoiceForLang(
            lang,
            resolvedVoiceMeta.get(lang)!
          )
        }
        const textTranslations: Record<string, CueTranslation> = {}
        for (const lang of langs) {
          const val = normalizedByLang.get(lang)
          if (val !== undefined && val.type === 'text') {
            const voice = resolvedVoices.get(lang)!
            const region = languages[lang]?.region
            const meta = resolvedVoiceMeta.get(lang)
            const modelType = meta?.modelType
            const style = meta?.style
            const accent = meta?.accent
            const pacing = meta?.pacing
            textTranslations[lang] = {
              text: val.text,
              voice: toRecordedVoice(voice),
              ...(region !== undefined && { region }),
              ...(modelType !== undefined && { modelType }),
              ...(style !== undefined && { style }),
              ...(accent !== undefined && { accent }),
              ...(pacing !== undefined && { pacing }),
            }
          }
        }
        cueStarted = true
        sleepFn(2 * ONE_FRAME_MS)
        activeRecorder.addCueStart('', keyStr, undefined, textTranslations)
      }
      result[keyStr] = {
        then(resolve, reject) {
          return textStartFn().then(resolve, reject)
        },
      }
    }
  }

  ;(
    result as unknown as {
      wait: () => Promise<void>
    }
  ).wait = doWait
  return result
}

function entryToVideoTranslation(
  entry: string | { path: string; subtitle?: string }
): VideoCueTranslationFile {
  const path = typeof entry === 'string' ? entry : entry.path
  const subtitle = typeof entry === 'string' ? undefined : entry.subtitle
  const assetHash = videoCueFileHashes.get(path)
  if (!assetHash)
    throw new Error(`Video cue asset hash missing for path: ${path}`)
  return {
    assetHash,
    assetPath: path,
    ...(subtitle !== undefined && { subtitle }),
  }
}
