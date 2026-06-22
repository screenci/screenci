import { supportedLanguages, type Lang } from './voices.js'
import type { CueMapValue } from './cue.js'

/**
 * How a localized video/screenshot is recorded.
 *
 * - `'per-language'` (default): one capture pass per language, with the browser
 *   locale set from the language (unless `browserLocale` is `false`) and the
 *   `language` fixture defined.
 * - `'shared'`: a single capture shared across languages; narration is overdubbed
 *   per language at render. No per-language locale; `language` fixture is undefined.
 */
export type LocalizeMode = 'per-language' | 'shared'

/** A narration cue value: plain text, or the richer object form. */
export type LocalizeNarrationValue = CueMapValue

/** Seeded narration: language -> (cue name -> value). */
export type SeededNarration = Partial<
  Record<Lang, Record<string, LocalizeNarrationValue>>
>

/** Seeded text: language -> (field name -> string). */
export type SeededText = Partial<Record<Lang, Record<string, string>>>

/**
 * The localization spec passed to `video.localize(...)` / `screenshot.localize(...)`.
 *
 * `narration` and `text` each accept either a seeded per-language map, or a bare
 * list of names (the Studio-managed form, where the content is owned by Studio).
 * Languages are inferred from the union of the seeded map keys; with name-only
 * forms, pass `languages` explicitly.
 */
export type LocalizeSpec = {
  /** Explicit language set. Required when both narration and text are name-only. */
  languages?: readonly string[]
  /** Spoken narration (video only): seeded map or a list of cue names. */
  narration?: SeededNarration | readonly string[]
  /** Injected text fields: seeded map or a list of field names. */
  text?: SeededText | readonly string[]
  /** Per-language browser-locale overrides (e.g. `{ en: 'en-GB' }`). */
  locales?: Partial<Record<Lang, string>>
  /** Recording mode. Defaults to `'per-language'`. */
  mode?: LocalizeMode
  /** Set the browser locale per language pass. Defaults to `true`. */
  browserLocale?: boolean
}

export type NormalizedNarration =
  | { kind: 'seeded'; cueNames: string[]; seed: SeededNarration }
  | { kind: 'studio'; cueNames: string[] }
  | null

export type NormalizedText =
  | { kind: 'seeded'; fieldNames: string[]; seed: SeededText }
  | { kind: 'studio'; fieldNames: string[] }
  | null

export type NormalizedLocalize = {
  languages: string[]
  mode: LocalizeMode
  browserLocale: boolean
  locales?: Partial<Record<Lang, string>>
  narration: NormalizedNarration
  text: NormalizedText
}

const SUPPORTED_LANGUAGE_SET = new Set<string>(supportedLanguages)

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function assertUniqueNames(label: string, names: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const name of names) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`localize(): ${label} names must be non-empty strings.`)
    }
    if (seen.has(name)) {
      throw new Error(`localize(): duplicate ${label} name "${name}".`)
    }
    seen.add(name)
  }
  return [...names]
}

/** Union of a seeded map's inner keys across all languages, in first-seen order. */
function collectSeededNames(
  seed: Record<string, Record<string, unknown>>
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const perLang of Object.values(seed)) {
    for (const name of Object.keys(perLang)) {
      if (seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

function normalizeNarration(
  input: LocalizeSpec['narration']
): NormalizedNarration {
  if (input === undefined) return null
  if (Array.isArray(input)) {
    return { kind: 'studio', cueNames: assertUniqueNames('narration', input) }
  }
  const seed = input as SeededNarration
  const cueNames = collectSeededNames(
    seed as Record<string, Record<string, unknown>>
  )
  if (cueNames.length === 0) {
    throw new Error('localize(): narration must declare at least one cue.')
  }
  return { kind: 'seeded', cueNames, seed }
}

function normalizeText(input: LocalizeSpec['text']): NormalizedText {
  if (input === undefined) return null
  if (Array.isArray(input)) {
    return { kind: 'studio', fieldNames: assertUniqueNames('text', input) }
  }
  const seed = input as SeededText
  const fieldNames = collectSeededNames(
    seed as Record<string, Record<string, unknown>>
  )
  if (fieldNames.length === 0) {
    throw new Error('localize(): text must declare at least one field.')
  }
  return { kind: 'seeded', fieldNames, seed }
}

function assertCoversLanguages(
  label: string,
  seedLanguages: readonly string[],
  languages: readonly string[]
): void {
  const present = new Set(seedLanguages)
  const missing = languages.filter((lang) => !present.has(lang))
  const extra = seedLanguages.filter((lang) => !languages.includes(lang))
  if (missing.length === 0 && extra.length === 0) return
  const parts: string[] = []
  if (missing.length > 0) parts.push(`missing ${missing.join(', ')}`)
  if (extra.length > 0) parts.push(`unexpected ${extra.join(', ')}`)
  throw new Error(
    `localize(): ${label} languages must match the declared languages (${languages.join(
      ', '
    )}): ${parts.join('; ')}.`
  )
}

/**
 * Normalize and validate a localize spec: resolve narration/text into seeded or
 * studio forms, infer the language set from the union of seeded keys (or take it
 * from `languages`), and validate that every seeded map covers exactly that set.
 * Pure and exported for testing.
 */
export function normalizeLocalizeSpec(spec: LocalizeSpec): NormalizedLocalize {
  const narration = normalizeNarration(spec.narration)
  const text = normalizeText(spec.text)

  const seededLanguages: string[] = []
  const seenLang = new Set<string>()
  for (const part of [narration, text]) {
    if (part?.kind === 'seeded') {
      for (const lang of Object.keys(part.seed)) {
        if (seenLang.has(lang)) continue
        seenLang.add(lang)
        seededLanguages.push(lang)
      }
    }
  }

  let languages: string[]
  if (spec.languages !== undefined && spec.languages.length > 0) {
    languages = dedupe(spec.languages)
  } else if (seededLanguages.length > 0) {
    languages = seededLanguages
  } else {
    throw new Error(
      'localize(): no languages. Pass `languages: [...]`, or seed narration/text with per-language values.'
    )
  }

  for (const lang of languages) {
    if (!SUPPORTED_LANGUAGE_SET.has(lang)) {
      throw new Error(
        `localize(): unsupported language "${lang}". Use a supported code such as "en" or "fi".`
      )
    }
  }

  if (narration?.kind === 'seeded') {
    assertCoversLanguages('narration', Object.keys(narration.seed), languages)
  }
  if (text?.kind === 'seeded') {
    assertCoversLanguages('text', Object.keys(text.seed), languages)
  }

  return {
    languages,
    mode: spec.mode ?? 'per-language',
    browserLocale: spec.browserLocale ?? true,
    ...(spec.locales !== undefined && { locales: spec.locales }),
    narration,
    text,
  }
}
