import type { Lang } from './voices.js'

/**
 * Default browser locale (a BCP 47 tag) for each language used in per-language
 * recording. When a video declares `.languages([...])`, each per-language pass
 * records with its context `locale` set from this map so a self-localizing app
 * renders in the matching language. Languages without an explicit entry fall
 * back to the bare language code (Chromium accepts e.g. `'fi'`).
 *
 * Override per call with `.languages(langs, { locales: { fi: 'fi-FI' } })`.
 */
export const DEFAULT_LANGUAGE_LOCALES: Partial<Record<Lang, string>> = {
  ar: 'ar-SA',
  bn: 'bn-BD',
  nl: 'nl-NL',
  en: 'en-US',
  fr: 'fr-FR',
  de: 'de-DE',
  hi: 'hi-IN',
  id: 'id-ID',
  it: 'it-IT',
  ja: 'ja-JP',
  ko: 'ko-KR',
  mr: 'mr-IN',
  pl: 'pl-PL',
  pt: 'pt-PT',
  ro: 'ro-RO',
  ru: 'ru-RU',
  es: 'es-ES',
  ta: 'ta-IN',
  te: 'te-IN',
  th: 'th-TH',
  tr: 'tr-TR',
  uk: 'uk-UA',
  vi: 'vi-VN',
  cs: 'cs-CZ',
  da: 'da-DK',
  fi: 'fi-FI',
  el: 'el-GR',
  he: 'he-IL',
  hu: 'hu-HU',
  nb: 'nb-NO',
  nn: 'nn-NO',
  sv: 'sv-SE',
  sk: 'sk-SK',
  sl: 'sl-SI',
  hr: 'hr-HR',
  bg: 'bg-BG',
  ca: 'ca-ES',
  cmn: 'zh-CN',
}

/**
 * Resolve the browser locale for a language used in per-language recording.
 *
 * Precedence: an explicit `overrides[lang]`, then {@link DEFAULT_LANGUAGE_LOCALES},
 * then the bare language code as a last resort.
 */
export function resolveLocaleForLanguage(
  lang: Lang,
  overrides?: Partial<Record<Lang, string>>
): string {
  return overrides?.[lang] ?? DEFAULT_LANGUAGE_LOCALES[lang] ?? lang
}
