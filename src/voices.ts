/**
 * Named voices available for use with `createCaptions`.
 *
 * Built-in voices are language-agnostic at the call site:
 *
 * ```ts
 * createCaptions({
 *   en: { voice: voices.Aria, captions: { intro: 'Hello' } },
 *   fi: { voice: voices.Aria, captions: { intro: 'Hei' } },
 * })
 * ```
 *
 * ElevenLabs voices are passed explicitly by provider voice id:
 *
 * ```ts
 * createCaptions({
 *   en: {
 *     voice: voices.elevenlabs({ voiceId: 'tMvyQtpCVQ0DkixuYm6J' }),
 *     captions: { intro: 'Hello' },
 *   },
 * })
 * ```
 */
export const voices = {
  /** Male — Clear — Direct and structured, ideal for straightforward explanations. */
  Adrian: 'Adrian',

  /** Female — Soft — A calm and soothing voice that reassures users and reduces friction. */
  Aria: 'Aria',

  /** Female — Bright — Fresh and optimistic, bringing clarity and positivity. */
  Ava: 'Ava',

  /** Female — Bright — Cheerful and energetic, uplifting the user experience. */
  Clara: 'Clara',

  /** Male — Informative — Clear and educational, focused on delivering useful information. */
  Daniel: 'Daniel',

  /** Female — Smooth — Graceful and composed, maintaining a consistent flow of communication. */
  Elena: 'Elena',

  /** Female — Youthful — Playful and fresh, appealing to a modern and dynamic audience. */
  Emma: 'Emma',

  /** Male — Friendly — Warm and approachable, making interactions feel personal and welcoming. */
  Ethan: 'Ethan',

  /** Male — Easy-going — Casual and relaxed, reducing stress in interactions. */
  Evan: 'Evan',

  /** Female — Gentle — Soft and caring, ideal for sensitive or supportive contexts. */
  Grace: 'Grace',

  /** Male — Knowledgeable — Insightful and reliable, conveying expertise and confidence. */
  Hassan: 'Hassan',

  /** Female — Mature — Experienced and composed, conveying trust and authority. */
  Helena: 'Helena',

  /** Female — Forward — Proactive and confident, driving users toward action. */
  Isabella: 'Isabella',

  /** Male — Smooth — Polished and fluid, ideal for seamless and premium experiences. */
  Julian: 'Julian',

  /** Female — Warm — Kind and empathetic, building trust and comfort. */
  Layla: 'Layla',

  /** Male — Excitable — High-energy and enthusiastic, great for engagement and motivation. */
  Leo: 'Leo',

  /** Female — Breezy — Light and effortless, creating a relaxed and easygoing interaction. */
  Lily: 'Lily',

  /** Male — Firm — Confident and directive, suited for clear guidance and authority. */
  Marcus: 'Marcus',

  /** Male — Upbeat — Energetic and lively, keeping interactions engaging and quick. */
  Max: 'Max',

  /** Female — Easy-going — Relaxed and flexible, reducing pressure during interactions. */
  Maya: 'Maya',

  /** Male — Firm — Grounded and assertive, ensuring clarity and direction. */
  Miles: 'Miles',

  /** Male — Breathy — Soft and intimate, creating a close and attentive feel. */
  Noah: 'Noah',

  /** Female — Firm — Strong and decisive, helping users stay on track. */
  Nora: 'Nora',

  /** Male — Informative — Detailed and explanatory, ideal for complex information delivery. */
  Omar: 'Omar',

  /** Male — Lively — Dynamic and spirited, adding energy to user interactions. */
  Ryan: 'Ryan',

  /** Male — Casual — Relaxed and informal, perfect for conversational experiences. */
  Sam: 'Sam',

  /** Female — Clear — Precise and easy to understand, minimizing confusion. */
  Sophie: 'Sophie',

  /** Male — Even — Balanced and steady, providing a consistent user experience. */
  Thomas: 'Thomas',

  /** Male — Gravelly — A deep, textured voice that conveys strength and seriousness. */
  Victor: 'Victor',

  /** Female — Upbeat — Positive and motivating, encouraging continued interaction. */
  Zoe: 'Zoe',

  elevenlabs: ({ voiceId }: { voiceId: string }) =>
    `elevenlabs:${voiceId}` as ElevenLabsVoiceKey,
} as const

export type VoiceName = keyof Omit<typeof voices, 'elevenlabs'>
type ElevenLabsVoiceKey = `elevenlabs:${string}`

/** Union of all valid voice keys, e.g. `'Aria' | 'elevenlabs:abc123'`. */
export type VoiceKey = VoiceName | ElevenLabsVoiceKey

const supportedLanguageCodes = [
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
] as const

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
 * Pass as the `voice` in `createCaptions` to clone a voice from the file at `path`.
 *
 * @example
 * ```ts
 * createCaptions({
 *   en: { voice: { path: './my-voice.mp3' }, captions: { intro: 'Hello.' } },
 * })
 * ```
 */
export type CustomVoiceRef = { path: string }

/** Returns true when the value is a `CustomVoiceRef` object. */
export function isCustomVoiceRef(value: unknown): value is CustomVoiceRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof (value as Record<string, unknown>).path === 'string'
  )
}
