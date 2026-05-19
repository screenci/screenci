import type { IEventRecorder } from './events.js'
import type {
  VoiceKey,
  VoiceForLang,
  Lang,
  CustomVoiceRef,
  ModelType,
} from './voices.js'
export declare const ONE_FRAME_MS: number
export declare function setSleepFn(fn: (ms: number) => void): void
export declare function setActiveCueRecorder(
  recorder: IEventRecorder | null
): void
export declare function resetCueChain(): void
export declare function resetRegisteredCustomVoiceRefs(): void
export declare function validateCustomVoiceRefs(
  testFilePath: string
): Promise<void>
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
  | {
      text: string
    }
  | {
      media: string
      subtitle?: string
    }
  | {
      path: string
      subtitle?: string
    }
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
  region?: string
}
type LanguageCuesEntry<C extends Record<string, CueMapValue>> =
  LanguageEntryBase & {
    cues: C
  }
type AllCues<
  M extends Partial<
    Record<Lang, LanguageCuesEntry<Record<string, CueMapValue>>>
  >,
> = UnionToIntersection<
  {
    [L in keyof M]: M[L] extends {
      cues: infer C
    }
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
      pacing?: number
      modelType?: Exclude<ModelType, 'expressive'> | undefined
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
  } & {
    cues: AllCues<M>
  }
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
export declare function createNarration<
  M extends Partial<
    Record<Lang, LanguageCuesEntry<Record<string, CueMapValue>>>
  >,
>(input: {
  voice: TopLevelVoiceConfig
  languages: LanguagesMap<M>
}): Cues<AllCues<M>>
export {}
