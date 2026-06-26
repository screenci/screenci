import { supportedLanguages, type Lang } from './voices.js'
import type { LangNarrationOverride } from './voiceConfig.js'

/**
 * A voice configuration used inside a `localize` spec. Allows a `seed` (it can
 * sit on a per-language or per-cue voice), discriminated by voice name like the
 * narration voice overrides.
 */
export type VoiceConfig = LangNarrationOverride

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

/**
 * A narration cue value in a seeded map.
 *
 * - `string`: the spoken line.
 * - `{ cue, voice?, language?, volume? }`: the spoken line with a per-cue voice
 *   override, a per-cue synthesis `language` (the locale the text is spoken in,
 *   default the version language), and/or render-time mix volume. The spoken text
 *   key is `cue` (not `text`) so it never collides with the injected `text` fields.
 * - `{ media | path, subtitle?, volume? }`: a pre-recorded audio file.
 */
export type LocalizeNarrationValue =
  | string
  | { cue: string; voice?: VoiceConfig; language?: Lang; volume?: number }
  | { media: string; subtitle?: string; volume?: number; language?: never }
  | { path: string; subtitle?: string; volume?: number; language?: never }

/** Seeded narration: language -> (cue name -> value). */
export type NarrationByLang = Partial<
  Record<Lang, Record<string, LocalizeNarrationValue>>
>

/** Seeded text: language -> (field name -> string). */
export type TextByLang = Partial<Record<Lang, Record<string, string>>>

/**
 * The `voice` field: a per-language map of voice overrides. Languages omitted
 * from the map fall back to the config/global default voice set via `use`
 * (`renderOptions.narration.voice`). There is deliberately no single
 * config-for-all-languages form here: the all-languages default belongs in
 * `use`, so the localize `voice` only carries per-language overrides.
 */
export type LocalizeVoiceSpec = Partial<Record<Lang, VoiceConfig>>

/**
 * The localization spec passed to `video.localize(...)` / `screenshot.localize(...)`.
 *
 * `narration` and `text` are seeded per-language maps (keys must be identical
 * across languages, enforced by TypeScript). Studio-managed cue/field names are
 * declared separately via `video.studio({...})`. `voice` co-locates per-language
 * narration voice overrides with the content; the all-languages default comes
 * from `use`.
 */
export type LocalizeSpec = {
  /** Per-language narration voice overrides. The all-languages default comes from `use`. */
  voice?: LocalizeVoiceSpec
  /**
   * Explicit language set. Required when there are no seeded maps (e.g. every
   * cue/field is Studio-managed via `video.studio({...})`).
   */
  languages?: readonly string[]
  /** Spoken narration (video only): seeded per-language map. */
  narration?: NarrationByLang
  /** Injected text fields: seeded per-language map. */
  text?: TextByLang
  /** Per-language browser-locale overrides (e.g. `{ en: 'en-GB' }`). */
  locales?: Partial<Record<Lang, string>>
  /** Recording mode. Defaults to `'per-language'`. */
  mode?: LocalizeMode
  /** Set the browser locale per language pass. Defaults to `true`. */
  browserLocale?: boolean
}

/** A normalized narration cue value (text with optional per-cue voice, or media). */
export type NormalizedCueValue =
  | {
      kind: 'text'
      text: string
      voice?: VoiceConfig
      language?: Lang
      volume?: number
    }
  | { kind: 'media'; path: string; subtitle?: string; volume?: number }

export type NormalizedNarration = {
  /** Every cue name: seeded then Studio, in declared order. */
  cueNames: string[]
  /** Studio-managed cue names. */
  studioNames: string[]
  /** Seeded cue names (declared in the per-language maps). */
  seededNames: string[]
  /** Seeded values: language -> (cue name -> normalized value). */
  seedByLang: Partial<Record<Lang, Record<string, NormalizedCueValue>>>
} | null

export type NormalizedText = {
  /** Every field name: seeded then Studio, in declared order. */
  fieldNames: string[]
  /** Studio-managed field names. */
  studioNames: string[]
  /** Seeded field names. */
  seededNames: string[]
  /** Seeded values: language -> (field name -> string). */
  seedByLang: Partial<Record<Lang, Record<string, string>>>
} | null

export type NormalizedLocalize = {
  languages: string[]
  mode: LocalizeMode
  browserLocale: boolean
  locales?: Partial<Record<Lang, string>>
  narration: NormalizedNarration
  text: NormalizedText
  /** Per-language localize `voice` overrides (absent language = use config default). */
  voiceByLang: Partial<Record<Lang, VoiceConfig>>
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

/** Union of a seeded map's inner keys across all languages, in first-seen order. */
function collectSeededNames(
  seed: Partial<Record<string, Record<string, unknown>>>
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const perLang of Object.values(seed)) {
    if (perLang === undefined) continue
    for (const name of Object.keys(perLang)) {
      if (seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

export function normalizeCueValue(
  name: string,
  value: LocalizeNarrationValue
): NormalizedCueValue {
  if (typeof value === 'string') {
    return { kind: 'text', text: value }
  }
  if ('cue' in value) {
    return {
      kind: 'text',
      text: value.cue,
      ...(value.voice !== undefined && { voice: value.voice }),
      ...(value.language !== undefined && { language: value.language }),
      ...(value.volume !== undefined && { volume: value.volume }),
    }
  }
  if (!('media' in value) && !('path' in value)) {
    throw new Error(
      `localize(): narration cue "${name}" must be a string, a { cue } object, or a { media | path } object.`
    )
  }
  const path = 'media' in value ? value.media : value.path
  return {
    kind: 'media',
    path,
    ...(value.subtitle !== undefined && { subtitle: value.subtitle }),
    ...(value.volume !== undefined && { volume: value.volume }),
  }
}

/** Languages a seeded map provides values for, in first-seen order. */
function seedLanguages(
  seed: Partial<Record<string, unknown>> | undefined
): string[] {
  if (seed === undefined) return []
  return Object.keys(seed)
}

/**
 * Every declared language must seed exactly the seeded names (identical keys
 * across languages). Backstops the TypeScript guarantee at runtime.
 */
function assertIdenticalSeededKeys(
  label: string,
  seed: Partial<Record<string, Record<string, unknown>>>,
  seededNames: readonly string[],
  languages: readonly string[]
): void {
  if (seededNames.length === 0) return
  const expected = new Set(seededNames)
  for (const lang of languages) {
    const perLang = seed[lang]
    const keys = perLang ? Object.keys(perLang) : []
    const present = new Set(keys)
    const missing = seededNames.filter((name) => !present.has(name))
    const extra = keys.filter((name) => !expected.has(name))
    if (missing.length === 0 && extra.length === 0) continue
    const parts: string[] = []
    if (missing.length > 0) parts.push(`missing ${missing.join(', ')}`)
    if (extra.length > 0) parts.push(`unexpected ${extra.join(', ')}`)
    throw new Error(
      `localize(): ${label} for "${lang}" must declare the same keys as every other language (${seededNames.join(
        ', '
      )}): ${parts.join('; ')}.`
    )
  }
}

function normalizeNarration(input: NarrationByLang | undefined): {
  normalized: NormalizedNarration
  seedLangs: string[]
} {
  const hasSeed = input !== undefined && Object.keys(input).length > 0
  if (!hasSeed) {
    return { normalized: null, seedLangs: [] }
  }

  const seedByLang: Partial<Record<Lang, Record<string, NormalizedCueValue>>> =
    {}
  const seededNames = collectSeededNames(
    input as Partial<Record<string, Record<string, unknown>>>
  )

  for (const [lang, cues] of Object.entries(input)) {
    if (cues === undefined) continue
    const normalizedCues: Record<string, NormalizedCueValue> = {}
    for (const [name, value] of Object.entries(cues)) {
      normalizedCues[name] = normalizeCueValue(name, value)
    }
    seedByLang[lang as Lang] = normalizedCues
  }

  return {
    normalized: {
      cueNames: seededNames,
      studioNames: [],
      seededNames,
      seedByLang,
    },
    seedLangs: seedLanguages(input),
  }
}

function normalizeText(input: TextByLang | undefined): {
  normalized: NormalizedText
  seedLangs: string[]
} {
  const hasSeed = input !== undefined && Object.keys(input).length > 0
  if (!hasSeed) {
    return { normalized: null, seedLangs: [] }
  }

  const seedByLang: Partial<Record<Lang, Record<string, string>>> = {}
  const seededNames = collectSeededNames(
    input as Partial<Record<string, Record<string, unknown>>>
  )

  for (const [lang, fields] of Object.entries(input)) {
    if (fields === undefined) continue
    seedByLang[lang as Lang] = { ...fields }
  }

  return {
    normalized: {
      fieldNames: seededNames,
      studioNames: [],
      seededNames,
      seedByLang,
    },
    seedLangs: seedLanguages(input),
  }
}

function normalizeVoice(
  voice: LocalizeVoiceSpec | undefined,
  languages: readonly string[]
): Partial<Record<Lang, VoiceConfig>> {
  if (voice === undefined) return {}
  // Per-language overrides only. Languages omitted from the map fall back to the
  // config/global default voice set via `use`, so the map may be partial; it may
  // not name a language outside the declared set (catches typos).
  const extra = Object.keys(voice).filter((lang) => !languages.includes(lang))
  if (extra.length > 0) {
    throw new Error(
      `localize(): voice map names language(s) ${extra.join(
        ', '
      )} that are not part of this localization (${languages.join(', ')}).`
    )
  }
  const out: Partial<Record<Lang, VoiceConfig>> = {}
  for (const [lang, config] of Object.entries(voice)) {
    if (config !== undefined) out[lang as Lang] = config
  }
  return out
}

/**
 * Normalize and validate a localize spec: resolve narration/text into seeded
 * values + Studio name lists, infer the language set (union of seeded keys and
 * the explicit `languages`), and validate disjointness, identical seeded keys,
 * and voice coverage. Pure and exported for testing.
 */
export function normalizeLocalizeSpec(spec: LocalizeSpec): NormalizedLocalize {
  const { normalized: narration, seedLangs: narrationLangs } =
    normalizeNarration(spec.narration)
  const { normalized: text, seedLangs: textLangs } = normalizeText(spec.text)

  const hasExplicitLanguages =
    spec.languages !== undefined && spec.languages.length > 0

  if (narration === null && text === null && !hasExplicitLanguages) {
    throw new Error(
      'localize(): nothing to localize. Provide narration and/or text (seeded maps), or pass `languages: [...]` when every cue/field is Studio-managed via video.studio({...}).'
    )
  }

  const seededLanguages = dedupe([...narrationLangs, ...textLangs])

  let languages: string[]
  if (hasExplicitLanguages) {
    languages = dedupe([...spec.languages!, ...seededLanguages])
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

  if (narration !== null) {
    assertIdenticalSeededKeys(
      'narration',
      narration.seedByLang as Partial<Record<string, Record<string, unknown>>>,
      narration.seededNames,
      languages
    )
  }
  if (text !== null) {
    assertIdenticalSeededKeys(
      'text',
      text.seedByLang as Partial<Record<string, Record<string, unknown>>>,
      text.seededNames,
      languages
    )
  }

  const voiceByLang = normalizeVoice(spec.voice, languages)

  return {
    languages,
    mode: spec.mode ?? 'per-language',
    browserLocale: spec.browserLocale ?? true,
    ...(spec.locales !== undefined && { locales: spec.locales }),
    narration,
    text,
    voiceByLang,
  }
}
