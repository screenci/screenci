import type {
  IEventRecorder,
  CaptionTranslation,
  RecordingCustomVoiceRef,
  VideoCaptionTranslation,
  VideoCaptionTranslationFile,
} from './events.js'
import type { VoiceKey, VoiceForLang, Lang, CustomVoiceRef } from './voices.js'
import { isCustomVoiceRef } from './voices.js'
import { isInsideHide } from './hide.js'
import { access, readFile } from 'fs/promises'
import { createHash } from 'crypto'
import { dirname, resolve } from 'path'

// One frame at 24fps — ensures at least one rendered frame captures each caption state.
export const ONE_FRAME_MS = 1000 / 24

/** A percentage string, e.g. `'50%'` or `'100%'`. */
export type Percentage = `${number}%`

function parsePercentage(percent: Percentage): number {
  const value = parseFloat(percent)
  if (!isFinite(value) || value < 0 || value > 100) {
    throw new Error(
      `Invalid percentage: "${percent}". Must be a finite number between 0 and 100 followed by %.`
    )
  }
  return value
}

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
const registeredVideoCaptionAssetPaths = new Set<string>()

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
  registeredVideoCaptionAssetPaths.clear()
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

    ;(ref as CustomVoiceRef & { id: string }).id = createHash('sha256')
      .update(fileBuffer)
      .digest('hex')
  }

  for (const assetPath of registeredVideoCaptionAssetPaths) {
    const candidates = [assetPath, resolve(testDir, assetPath)]
    let exists = false

    for (const candidate of candidates) {
      try {
        await access(candidate)
        exists = true
        break
      } catch {
        // try next candidate
      }
    }

    if (!exists) {
      throw new Error(`Video caption asset file not found: ${assetPath}`)
    }
  }
}

function toRecordedVoice(
  voice: VoiceKey | CustomVoiceRef
): VoiceKey | RecordingCustomVoiceRef {
  if (!isCustomVoiceRef(voice)) return voice
  if (
    !('id' in voice) ||
    typeof (voice as CustomVoiceRef & { id?: string }).id !== 'string'
  ) {
    throw new Error(`Custom voice id missing for path: ${voice.path}`)
  }
  return {
    id: (voice as CustomVoiceRef & { id: string }).id,
    path: voice.path,
  }
}

function captionWaitEnd(): void {
  if (activeRecorder === null) return
  if (isInsideHide())
    throw new Error('Cannot call caption.waitEnd inside hide()')
  if (!captionStarted) throw new Error('No caption has been started')
  activeRecorder.addCaptionEnd()
  sleepFn(2 * ONE_FRAME_MS)
}

function captionWaitUntil(percent: Percentage): void {
  if (activeRecorder === null) return
  if (isInsideHide())
    throw new Error('Cannot call caption.waitUntil inside hide()')
  if (!captionStarted) throw new Error('No caption has been started')
  const percentage = parsePercentage(percent)
  activeRecorder.addCaptionUntil(percentage)
  sleepFn(2 * ONE_FRAME_MS)
}

export interface CaptionController {
  /**
   * Begins voiceover audio and shows the caption overlay.
   *
   * @example
   * ```ts
   * await captions.intro.start()
   * await page.goto('/dashboard')
   * await captions.intro.end()
   * ```
   */
  start(): Promise<void>
  /**
   * Pauses execution until the voiceover audio reaches the given playback position.
   *
   * Use this to time a page interaction to a specific moment in the narration —
   * for example, clicking a button right as the voiceover mentions it.
   *
   * @param progress - Playback position as a percentage string, e.g. `'50%'`.
   *
   * @example
   * ```ts
   * await captions.intro.start()
   * await captions.intro.waitUntil('70%')  // wait until 70% of audio has played
   * await page.locator('#cta').click()     // then click
   * await captions.intro.end()
   * ```
   */
  waitUntil(progress: string): Promise<void>
  /**
   * Hides the caption overlay and stops voiceover playback.
   * Always call this after every `start()`.
   */
  end(): Promise<void>
}

/** A single caption value in a multi-language map: either TTS text or a file-based entry. */
export type CaptionMapValue = string | { path: string; subtitle?: string }

export type Captions<T extends Record<string, CaptionMapValue>> = {
  [K in keyof T]: CaptionController
}

export type VideoCaptionEntry = string | { path: string; subtitle?: string }

export type VideoCaptions<T extends Record<string, VideoCaptionEntry>> = {
  [K in keyof T]: CaptionController
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

type MultiLangMap<L extends Lang, T extends Record<string, CaptionMapValue>> = {
  [K in L]: {
    voice: VoiceForLang<K> | CustomVoiceRef
    captions: T
  }
}

/**
 * Creates a set of typed caption controllers, one per key in the map.
 *
 * Each controller has `start()`, `waitUntil(percent)`, and `end()`.
 * At render time screenci sends the caption text to ElevenLabs, generates
 * a voiceover, and syncs the audio to the recording. You write text; the
 * voice is handled for you.
 *
 * TypeScript enforces that every language has the same caption keys.
 * Forget a translation key → compile error.
 *
 * @example
 * ```ts
 * const captions = createCaptions({
 *   en: { voice: voices.en.Jude, captions: { intro: 'Welcome.' } },
 *   fi: { voice: voices.fi.Martti, captions: { intro: 'Tervetuloa.' } },
 * })
 * ```
 */
export function createCaptions<
  M extends Partial<
    Record<
      Lang,
      {
        voice: VoiceKey | CustomVoiceRef
        captions: Record<string, CaptionMapValue>
      }
    >
  >,
>(
  languagesMap: M & {
    [L in keyof M]: {
      voice: VoiceForLang<L & string> | CustomVoiceRef
      captions: AllCaptions<M>
    }
  }
): Captions<AllCaptions<M>> {
  return buildMultiLangCaptions(
    languagesMap as unknown as MultiLangMap<
      Lang,
      Record<string, CaptionMapValue>
    >
  ) as Captions<AllCaptions<M>>
}

function buildMultiLangCaptions<
  L extends Lang,
  T extends Record<string, CaptionMapValue>,
>(languagesMap: MultiLangMap<L, T>): Captions<T> {
  const langs = Object.keys(languagesMap) as L[]
  const firstLang = langs[0]
  if (firstLang === undefined) return {} as Captions<T>

  for (const lang of langs) {
    const voice = languagesMap[lang].voice
    if (isCustomVoiceRef(voice)) {
      registeredCustomVoiceRefs.add(voice)
    }
  }

  const result = {} as Captions<T>

  for (const key in languagesMap[firstLang].captions) {
    const keyStr = key as string

    // Determine if any language uses a file-based value for this key.
    // If so, use videoCaptionStart with mixed translations (file or TTS per lang).
    // Otherwise use captionStart with text translations (existing behaviour).
    const hasFileEntry = langs.some((lang) => {
      const val = languagesMap[lang].captions[keyStr]
      return val !== undefined && typeof val !== 'string'
    })

    if (hasFileEntry) {
      const videoTranslations: Record<string, VideoCaptionTranslation> = {}
      for (const lang of langs) {
        const val = languagesMap[lang].captions[keyStr]
        if (val === undefined) continue
        if (typeof val === 'string') {
          videoTranslations[lang] = {
            text: val,
            voice: toRecordedVoice(languagesMap[lang].voice),
          }
        } else {
          const fileTrans: VideoCaptionTranslationFile = {
            assetPath: val.path,
            ...(val.subtitle !== undefined && { subtitle: val.subtitle }),
          }
          registeredVideoCaptionAssetPaths.add(val.path)
          videoTranslations[lang] = fileTrans
        }
      }
      result[key as keyof T] = {
        async start() {
          if (activeRecorder === null) return
          if (isInsideHide())
            throw new Error('Cannot call caption.start inside hide()')
          captionStarted = true
          sleepFn(2 * ONE_FRAME_MS)
          activeRecorder.addVideoCaptionStart(
            keyStr,
            undefined,
            undefined,
            videoTranslations
          )
        },
        async waitUntil(progress: string) {
          captionWaitUntil(progress as Percentage)
        },
        async end() {
          captionWaitEnd()
        },
      }
    } else {
      const textTranslations: Record<string, CaptionTranslation> = {}
      for (const lang of langs) {
        const val = languagesMap[lang].captions[keyStr]
        if (val !== undefined && typeof val === 'string') {
          textTranslations[lang] = {
            text: val,
            voice: toRecordedVoice(languagesMap[lang].voice),
          }
        }
      }
      result[key as keyof T] = {
        async start() {
          if (activeRecorder === null) return
          if (isInsideHide())
            throw new Error('Cannot call caption.start inside hide()')
          captionStarted = true
          sleepFn(2 * ONE_FRAME_MS)
          activeRecorder.addCaptionStart(
            '',
            keyStr,
            undefined,
            textTranslations
          )
        },
        async waitUntil(progress: string) {
          captionWaitUntil(progress as Percentage)
        },
        async end() {
          captionWaitEnd()
        },
      }
    }
  }

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
): VideoCaptionTranslation {
  if (typeof entry === 'string') return { assetPath: entry }
  return {
    assetPath: entry.path,
    ...(entry.subtitle !== undefined && { subtitle: entry.subtitle }),
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
 * Same constraints as `createCaptions`: cannot overlap with other captions,
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
    registeredVideoCaptionAssetPaths.add(assetPath)

    result[key] = {
      async start() {
        if (activeRecorder === null) return
        if (isInsideHide())
          throw new Error('Cannot call videoCaption.start inside hide()')
        captionStarted = true
        sleepFn(2 * ONE_FRAME_MS)
        activeRecorder.addVideoCaptionStart(key, assetPath, subtitle)
      },
      async waitUntil(progress: string) {
        captionWaitUntil(progress as Percentage)
      },
      async end() {
        captionWaitEnd()
      },
    }
  }

  return result
}

function buildMultiLangVideoCaptions<
  L extends Lang,
  T extends Record<string, VideoCaptionEntry>,
>(languagesMap: MultiLangVideoCaptionMap<L, T>): VideoCaptions<T> {
  const langs = Object.keys(languagesMap) as L[]
  const firstLang = langs[0]
  if (firstLang === undefined) return {} as VideoCaptions<T>

  const result = {} as VideoCaptions<T>

  for (const key in languagesMap[firstLang].captions) {
    const keyStr = key as string

    const translations: Record<string, VideoCaptionTranslation> = {}
    for (const lang of langs) {
      const entry = languagesMap[lang].captions[keyStr]
      if (entry !== undefined) {
        const assetPath = typeof entry === 'string' ? entry : entry.path
        registeredVideoCaptionAssetPaths.add(assetPath)
        translations[lang] = entryToVideoTranslation(entry)
      }
    }

    result[key as keyof T] = {
      async start() {
        if (activeRecorder === null) return
        if (isInsideHide())
          throw new Error('Cannot call videoCaption.start inside hide()')
        captionStarted = true
        sleepFn(2 * ONE_FRAME_MS)
        activeRecorder.addVideoCaptionStart(
          keyStr,
          undefined,
          undefined,
          translations
        )
      },
      async waitUntil(progress: string) {
        captionWaitUntil(progress as Percentage)
      },
      async end() {
        captionWaitEnd()
      },
    }
  }

  return result
}
