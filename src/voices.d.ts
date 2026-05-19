/**
 * TTS model types for use with `createNarration`.
 *
 * - `expressive`: expressive synthesis with natural-sounding speech.
 * - `consistent`: consistent synthesis with stable pronunciation.
 *
 * @example
 * ```ts
 * createNarration({
 *   voice: { name: voices.Ava, modelType: modelTypes.expressive },
 *   languages: { en: { cues: { intro: 'Hello' } } },
 * })
 * ```
 */
export declare const modelTypes: {
  readonly expressive: 'expressive'
  readonly consistent: 'consistent'
}
export type ModelType = (typeof modelTypes)[keyof typeof modelTypes]
/**
 * BCP-47 language regions for use with `createNarration`.
 *
 * Pass a region as `region` inside a language entry to select the
 * specific locale variant used for speech synthesis.
 *
 * @example
 * ```ts
 * createNarration({
 *   voice: { name: voices.Ava },
 *   languages: {
 *     en: { region: languageRegions.en.US, cues: { intro: 'Hello' } },
 *     fr: { region: languageRegions.fr.FR, cues: { intro: 'Bonjour' } },
 *   },
 * })
 * ```
 */
export declare const languageRegions: {
  readonly ar: {
    readonly SA: 'ar-SA'
    readonly AE: 'ar-AE'
    readonly EG: 'ar-EG'
  }
  readonly az: {
    readonly AZ: 'az-AZ'
  }
  readonly bn: {
    readonly BD: 'bn-BD'
    readonly IN: 'bn-IN'
  }
  readonly bg: {
    readonly BG: 'bg-BG'
  }
  readonly ca: {
    readonly ES: 'ca-ES'
  }
  readonly cs: {
    readonly CZ: 'cs-CZ'
  }
  readonly da: {
    readonly DK: 'da-DK'
  }
  readonly de: {
    readonly DE: 'de-DE'
    readonly AT: 'de-AT'
    readonly CH: 'de-CH'
  }
  readonly el: {
    readonly GR: 'el-GR'
  }
  readonly en: {
    readonly US: 'en-US'
    readonly GB: 'en-GB'
    readonly AU: 'en-AU'
    readonly IN: 'en-IN'
  }
  readonly es: {
    readonly ES: 'es-ES'
    readonly MX: 'es-MX'
    readonly US: 'es-US'
    readonly AR: 'es-AR'
  }
  readonly et: {
    readonly EE: 'et-EE'
  }
  readonly eu: {
    readonly ES: 'eu-ES'
  }
  readonly fa: {
    readonly IR: 'fa-IR'
  }
  readonly fi: {
    readonly FI: 'fi-FI'
  }
  readonly fil: {
    readonly PH: 'fil-PH'
  }
  readonly fr: {
    readonly FR: 'fr-FR'
    readonly CA: 'fr-CA'
    readonly BE: 'fr-BE'
    readonly CH: 'fr-CH'
  }
  readonly gl: {
    readonly ES: 'gl-ES'
  }
  readonly gu: {
    readonly IN: 'gu-IN'
  }
  readonly he: {
    readonly IL: 'he-IL'
  }
  readonly hi: {
    readonly IN: 'hi-IN'
  }
  readonly hr: {
    readonly HR: 'hr-HR'
  }
  readonly hu: {
    readonly HU: 'hu-HU'
  }
  readonly hy: {
    readonly AM: 'hy-AM'
  }
  readonly id: {
    readonly ID: 'id-ID'
  }
  readonly is: {
    readonly IS: 'is-IS'
  }
  readonly it: {
    readonly IT: 'it-IT'
  }
  readonly ja: {
    readonly JP: 'ja-JP'
  }
  readonly ka: {
    readonly GE: 'ka-GE'
  }
  readonly kn: {
    readonly IN: 'kn-IN'
  }
  readonly ko: {
    readonly KR: 'ko-KR'
  }
  readonly lt: {
    readonly LT: 'lt-LT'
  }
  readonly lv: {
    readonly LV: 'lv-LV'
  }
  readonly mk: {
    readonly MK: 'mk-MK'
  }
  readonly ml: {
    readonly IN: 'ml-IN'
  }
  readonly mn: {
    readonly MN: 'mn-MN'
  }
  readonly mr: {
    readonly IN: 'mr-IN'
  }
  readonly ms: {
    readonly MY: 'ms-MY'
  }
  readonly my: {
    readonly MM: 'my-MM'
  }
  readonly nb: {
    readonly NO: 'nb-NO'
  }
  readonly ne: {
    readonly NP: 'ne-NP'
  }
  readonly nl: {
    readonly NL: 'nl-NL'
    readonly BE: 'nl-BE'
  }
  readonly pa: {
    readonly IN: 'pa-IN'
  }
  readonly pl: {
    readonly PL: 'pl-PL'
  }
  readonly pt: {
    readonly BR: 'pt-BR'
    readonly PT: 'pt-PT'
  }
  readonly ro: {
    readonly RO: 'ro-RO'
  }
  readonly ru: {
    readonly RU: 'ru-RU'
  }
  readonly si: {
    readonly LK: 'si-LK'
  }
  readonly sk: {
    readonly SK: 'sk-SK'
  }
  readonly sl: {
    readonly SI: 'sl-SI'
  }
  readonly sq: {
    readonly AL: 'sq-AL'
  }
  readonly sr: {
    readonly RS: 'sr-RS'
  }
  readonly sv: {
    readonly SE: 'sv-SE'
  }
  readonly sw: {
    readonly KE: 'sw-KE'
    readonly TZ: 'sw-TZ'
  }
  readonly ta: {
    readonly IN: 'ta-IN'
    readonly LK: 'ta-LK'
  }
  readonly te: {
    readonly IN: 'te-IN'
  }
  readonly th: {
    readonly TH: 'th-TH'
  }
  readonly tr: {
    readonly TR: 'tr-TR'
  }
  readonly uk: {
    readonly UA: 'uk-UA'
  }
  readonly ur: {
    readonly PK: 'ur-PK'
  }
  readonly vi: {
    readonly VN: 'vi-VN'
  }
  readonly zh: {
    readonly CN: 'zh-CN'
    readonly TW: 'zh-TW'
    readonly HK: 'zh-HK'
  }
}
/**
 * Named voices available for use with `createNarration`.
 *
 * Built-in voices are language-agnostic at the call site:
 *
 * ```ts
 * createNarration({
 *   en: { voice: voices.Aria, cues: { intro: 'Hello' } },
 *   fi: { voice: voices.Aria, cues: { intro: 'Hei' } },
 * })
 * ```
 *
 * ElevenLabs voices are passed explicitly by provider voice id:
 *
 * ```ts
 * createNarration({
 *   en: {
 *     voice: voices.elevenlabs({ voiceId: 'tMvyQtpCVQ0DkixuYm6J' }),
 *     cues: { intro: 'Hello' },
 *   },
 * })
 * ```
 */
export declare const voices: {
  /** Male — Clear — Direct and structured, ideal for straightforward explanations. */
  readonly Adrian: 'Adrian'
  /** Female — Soft — A calm and soothing voice that reassures users and reduces friction. */
  readonly Aria: 'Aria'
  /** Female — Bright — Fresh and optimistic, bringing clarity and positivity. */
  readonly Ava: 'Ava'
  /** Female — Bright — Cheerful and energetic, uplifting the user experience. */
  readonly Clara: 'Clara'
  /** Male — Informative — Clear and educational, focused on delivering useful information. */
  readonly Daniel: 'Daniel'
  /** Female — Smooth — Graceful and composed, maintaining a consistent flow of communication. */
  readonly Elena: 'Elena'
  /** Female — Youthful — Playful and fresh, appealing to a modern and dynamic audience. */
  readonly Emma: 'Emma'
  /** Male — Friendly — Warm and approachable, making interactions feel personal and welcoming. */
  readonly Ethan: 'Ethan'
  /** Male — Easy-going — Casual and relaxed, reducing stress in interactions. */
  readonly Evan: 'Evan'
  /** Female — Gentle — Soft and caring, ideal for sensitive or supportive contexts. */
  readonly Grace: 'Grace'
  /** Male — Knowledgeable — Insightful and reliable, conveying expertise and confidence. */
  readonly Hassan: 'Hassan'
  /** Female — Mature — Experienced and composed, conveying trust and authority. */
  readonly Helena: 'Helena'
  /** Female — Forward — Proactive and confident, driving users toward action. */
  readonly Isabella: 'Isabella'
  /** Male — Smooth — Polished and fluid, ideal for seamless and premium experiences. */
  readonly Julian: 'Julian'
  /** Female — Warm — Kind and empathetic, building trust and comfort. */
  readonly Layla: 'Layla'
  /** Male — Excitable — High-energy and enthusiastic, great for engagement and motivation. */
  readonly Leo: 'Leo'
  /** Female — Breezy — Light and effortless, creating a relaxed and easygoing interaction. */
  readonly Lily: 'Lily'
  /** Male — Firm — Confident and directive, suited for clear guidance and authority. */
  readonly Marcus: 'Marcus'
  /** Male — Upbeat — Energetic and lively, keeping interactions engaging and quick. */
  readonly Max: 'Max'
  /** Female — Easy-going — Relaxed and flexible, reducing pressure during interactions. */
  readonly Maya: 'Maya'
  /** Male — Firm — Grounded and assertive, ensuring clarity and direction. */
  readonly Miles: 'Miles'
  /** Male — Breathy — Soft and intimate, creating a close and attentive feel. */
  readonly Noah: 'Noah'
  /** Female — Firm — Strong and decisive, helping users stay on track. */
  readonly Nora: 'Nora'
  /** Male — Informative — Detailed and explanatory, ideal for complex information delivery. */
  readonly Omar: 'Omar'
  /** Male — Lively — Dynamic and spirited, adding energy to user interactions. */
  readonly Ryan: 'Ryan'
  /** Male — Casual — Relaxed and informal, perfect for conversational experiences. */
  readonly Sam: 'Sam'
  /** Female — Clear — Precise and easy to understand, minimizing confusion. */
  readonly Sophie: 'Sophie'
  /** Male — Even — Balanced and steady, providing a consistent user experience. */
  readonly Thomas: 'Thomas'
  /** Male — Gravelly — A deep, textured voice that conveys strength and seriousness. */
  readonly Victor: 'Victor'
  /** Female — Upbeat — Positive and motivating, encouraging continued interaction. */
  readonly Zoe: 'Zoe'
  readonly elevenlabs: ({ voiceId }: { voiceId: string }) => ElevenLabsVoiceKey
}
export type VoiceName = keyof Omit<typeof voices, 'elevenlabs'>
type ElevenLabsVoiceKey = `elevenlabs:${string}`
/** Union of all valid voice keys, e.g. `'Aria' | 'elevenlabs:abc123'`. */
export type VoiceKey = VoiceName | ElevenLabsVoiceKey
declare const supportedLanguageCodes: readonly [
  'ar',
  'bn',
  'nl',
  'en',
  'fr',
  'de',
  'hi',
  'id',
  'it',
  'ja',
  'ko',
  'mr',
  'pl',
  'pt',
  'ro',
  'ru',
  'es',
  'ta',
  'te',
  'th',
  'tr',
  'uk',
  'vi',
  'af',
  'sq',
  'am',
  'hy',
  'az',
  'eu',
  'be',
  'bg',
  'my',
  'ca',
  'ceb',
  'cmn',
  'hr',
  'cs',
  'da',
  'et',
  'fil',
  'fi',
  'gl',
  'ka',
  'el',
  'gu',
  'ht',
  'he',
  'hu',
  'is',
  'jv',
  'kn',
  'kok',
  'lo',
  'la',
  'lv',
  'lt',
  'lb',
  'mk',
  'mai',
  'mg',
  'ms',
  'ml',
  'mn',
  'ne',
  'nb',
  'nn',
  'or',
  'ps',
  'fa',
  'pa',
  'sr',
  'sd',
  'si',
  'sk',
  'sl',
  'sw',
  'sv',
  'ur',
]
/** Union of supported language codes, e.g. `'en' | 'fi'`. */
export type Lang = (typeof supportedLanguageCodes)[number]
/**
 * Narrows the set of valid voice keys to those allowed for language `L`.
 * Built-in voice names are shared across languages, while ElevenLabs voice ids
 * are language-neutral from the SDK's perspective.
 */
export type VoiceForLang<L extends string> = L extends Lang ? VoiceKey : never
/**
 * A reference to a local audio or video file for ElevenLabs Instant Voice Cloning.
 * Pass as the `voice` in `createNarration` to clone a voice from the file at `path`.
 *
 * @example
 * ```ts
 * createNarration({
 *   en: { voice: { path: './my-voice.mp3' }, cues: { intro: 'Hello.' } },
 * })
 * ```
 */
export type CustomVoiceRef = {
  path: string
}
/** Returns true when the value is a `CustomVoiceRef` object. */
export declare function isCustomVoiceRef(
  value: unknown
): value is CustomVoiceRef
export {}
