import type {
  Lang,
  BuiltInVoiceKeyForLang,
  ElevenLabsVoiceKey,
  CustomVoiceRef,
  ModelType,
} from './voices.js'

/**
 * Voice configuration types. Kept in a leaf module (depends only on `voices.ts`)
 * so both `cue.ts` and `types.ts` can import them: voice is configured as a
 * render option (`renderOptions.narration`), which lives in `types.ts`, while
 * the narration runtime in `cue.ts` consumes the same shapes.
 *
 * ElevenLabs voices support only the numeric `eleven_multilingual_v2` settings;
 * built-in model voices support expressive/consistent model controls.
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

type BuiltInVoiceName<L extends Lang = Lang> = BuiltInVoiceKeyForLang<L>

/**
 * Default voice shared across all languages. `seed` is not allowed here — use a
 * per-language voice override instead.
 */
export type TopLevelVoiceConfig<L extends Lang = Lang> =
  | ElevenLabsVoiceConfig
  | {
      name: BuiltInVoiceName<L>
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
      name: BuiltInVoiceName<L>
      style?: never
      accent?: never
      /** Speaking rate for consistent synthesis. Valid range: 0.25 to 2. */
      pacing?: number
      /** TTS model type — `modelTypes.expressive` or `modelTypes.consistent`. Defaults to `consistent`. */
      modelType?: Exclude<ModelType, 'expressive'> | undefined
    }

/**
 * Per-language voice override. Can override the default voice name and set a
 * `seed` for TTS generation.
 *
 * The voice name discriminates provider-specific settings: built-in model voices
 * use expressive/consistent controls, ElevenLabs voices use the numeric
 * `eleven_multilingual_v2` controls.
 */
export type LangNarrationOverride<L extends Lang = Lang> =
  | (ElevenLabsVoiceConfig & {
      /**
       * Integer seed included in the audio cache key and forwarded to ElevenLabs.
       * A different seed always forces regeneration.
       */
      seed?: number
    })
  | {
      name: BuiltInVoiceName<L>
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
      name: BuiltInVoiceName<L>
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

/**
 * Union of every language-specific top-level voice config. Unlike
 * `TopLevelVoiceConfig<Lang>`, this does not collapse to the Russian-safe
 * subset; it preserves each language's valid config as a separate branch.
 */
export type AnyTopLevelVoiceConfig = {
  [L in Lang]: TopLevelVoiceConfig<L>
}[Lang]

/**
 * Union of every language-specific per-language narration override.
 *
 * Useful for normalized runtime shapes that store already-resolved per-language
 * voice configs without reapplying the shared-subset narrowing used by public
 * APIs that span multiple languages.
 */
export type AnyLangNarrationOverride = {
  [L in Lang]: LangNarrationOverride<L>
}[Lang]
