/**
 * Named voices available for use with `createCaptions`.
 *
 * Voices are grouped by language. Only voices belonging to a language may be
 * used with captions written in that language — the TypeScript types enforce
 * this when using the multi-language overload of `createCaptions`.
 *
 * The actual provider voice IDs are intentionally kept out of this package
 * and are only known to the rendering infrastructure.
 *
 * Example:
 * ```ts
 * import { voices } from 'screenci'
 *
 * createCaptions({
 *   en: { voice: voices.en.Ava, captions: { intro: 'Hello' } },
 *   fi: { voice: voices.fi.Selma, captions: { intro: 'Hei' } },
 * })
 * ```
 */
export const voices = {
  fi: {
    Martti: 'fi.Martti' as const,
    Selma: 'fi.Selma' as const,
    Noora: 'fi.Noora' as const,
  },
  en: {
    Jude: 'en.Jude' as const,
    Ava: 'en.Ava' as const,
    Andrew: 'en.Andrew' as const,
    Adam: 'en.Adam' as const,
    Alloy: 'en.Alloy' as const,
    Aria: 'en.Aria' as const,
    Bree: 'en.Bree' as const,
    Brian: 'en.Brian' as const,
    Davis: 'en.Davis' as const,
    Emma: 'en.Emma' as const,
    Emma2: 'en.Emma2' as const,
    Jane: 'en.Jane' as const,
  },
} as const

type Voices = typeof voices

/**
 * Union of all valid voice keys, e.g. `'fi.Martti' | 'en.Ava'`.
 */
export type VoiceKey = {
  [L in keyof Voices]: Voices[L][keyof Voices[L]]
}[keyof Voices]

/**
 * Narrows the set of valid voice keys to those belonging to language `L`.
 *
 * - `VoiceForLang<'fi'>` → `'fi.Martti' | 'fi.Selma' | 'fi.Noora'`
 * - `VoiceForLang<'en'>` → `'en.Jude' | 'en.Ava' | ...`
 * - `VoiceForLang<'de'>` → `never` (no German voices defined)
 */
export type VoiceForLang<L extends string> = L extends keyof Voices
  ? Voices[L][keyof Voices[L]]
  : never

/** Union of supported language codes, e.g. `'en' | 'fi'`. */
export type Lang = keyof Voices
