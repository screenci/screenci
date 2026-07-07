import { ScreenciError } from './errors.js'
import { supportedLanguages, type Lang } from './voices.js'

/**
 * The per-feature declaration argument, shared by `video.narration`/`text`/
 * `overlays`/`audio` (and the `screenshot` subset). Every declaration is editable
 * in the ScreenCI web app; the argument *shape* decides whether code supplies
 * values and how they localize:
 *
 * - **Names only** (`['intro', 'cta']`): the names exist in code (so the test body
 *   can reference `narration.intro`), but their content is configured in the web
 *   app.
 * - **Content-major object** (`{ intro: 'Hi' }`): a flat `name -> value` map of
 *   code values, shared across every language. The web app may override them.
 * - **Language-major object** (`{ fr: { intro: 'Salut' }, default: { intro: 'Hi' } }`):
 *   top-level keys are language codes (plus an optional `default`). Each language
 *   maps `name -> value`; `default` supplies the shared fallback for any name a
 *   language omits.
 *
 * Disambiguation (see {@link isLanguageKey}): an object is treated as
 * language-major iff *every* top-level key is a supported language code or the
 * literal `default`. There is deliberately no `languages:` wrapper. As a result a
 * content name may not be a bare language code or `default` (rejected by
 * {@link normalizeFeature}).
 */
export type FeatureArg<V> =
  | readonly string[]
  | ContentMajor<V>
  | LanguageMajor<V>

/** Flat `name -> value`, shared across all languages. */
export type ContentMajor<V> = Record<string, V>

/** `language -> (name -> value)`, with `default` as the shared fallback. */
export type LanguageMajor<V> = {
  default?: Record<string, V>
} & Partial<Record<Lang, Record<string, V>>>

/**
 * The normalized form every feature collapses to. Both object spellings produce a
 * `shared` map (the all-languages / `default` values) plus a `byLang` overrides
 * map; the names-only array form produces `studioNames` only.
 */
export type NormalizedFeature<V> = {
  /** All declared content names, in declaration order (studio names for arrays). */
  names: string[]
  /** Names without code values (array form): content lives in the web app. */
  studioNames: string[]
  /** Names with code values (object forms). Empty for the array form. */
  codeNames: string[]
  /** Shared/default value per code name. */
  shared: Record<string, V>
  /** Per-language overrides: `language -> (name -> value)`. */
  byLang: Partial<Record<string, Record<string, V>>>
  /** Languages contributed by this feature (the keys of `byLang`). */
  languages: string[]
}

const DEFAULT_KEY = 'default'
const LANGUAGE_KEYS = new Set<string>(supportedLanguages)

/** Whether a top-level object key denotes a language (or the `default` fallback). */
export function isLanguageKey(key: string): boolean {
  return key === DEFAULT_KEY || LANGUAGE_KEYS.has(key)
}

/**
 * Normalizes a {@link FeatureArg} into a {@link NormalizedFeature}. Pure; the
 * single source of truth for the array / content-major / language-major split,
 * unit-tested directly.
 *
 * @param feature label used in error messages, e.g. `'narration'`.
 */
export function normalizeFeature<V>(
  feature: string,
  arg: FeatureArg<V>
): NormalizedFeature<V> {
  if (Array.isArray(arg)) {
    // Names only: the content lives in the web app; code just declares the keys.
    const studioNames = [...(arg as readonly string[])]
    assertUniqueNames(feature, studioNames)
    return {
      names: studioNames,
      studioNames,
      codeNames: [],
      shared: {},
      byLang: {},
      languages: [],
    }
  }

  const obj = arg as Record<string, unknown>
  const keys = Object.keys(obj)
  const languageMajor = keys.length > 0 && keys.every(isLanguageKey)

  if (languageMajor) {
    const shared = (obj[DEFAULT_KEY] as Record<string, V> | undefined) ?? {}
    const byLang: Record<string, Record<string, V>> = {}
    for (const key of keys) {
      if (key === DEFAULT_KEY) continue
      byLang[key] = obj[key] as Record<string, V>
    }
    const codeNames = collectNames(shared, byLang)
    return {
      names: codeNames,
      studioNames: [],
      codeNames,
      shared,
      byLang,
      languages: Object.keys(byLang),
    }
  }

  // Content-major: a flat shared map. No key may collide with a language code or
  // `default`, else the disambiguation rule would have read it as language-major.
  for (const key of keys) {
    if (isLanguageKey(key)) {
      throw new ScreenciError(
        `${feature} name "${key}" collides with a language code or "default". ` +
          `Content names cannot be language codes; rename it, or use the ` +
          `language-major form (every key a language) for per-language values.`
      )
    }
  }
  const shared = obj as Record<string, V>
  const codeNames = Object.keys(shared)
  return {
    names: codeNames,
    studioNames: [],
    codeNames,
    shared,
    byLang: {},
    languages: [],
  }
}

/** Shared keys first, then any names that appear only in a per-language override. */
function collectNames<V>(
  shared: Record<string, V>,
  byLang: Record<string, Record<string, V>>
): string[] {
  const names: string[] = [...Object.keys(shared)]
  const seen = new Set(names)
  for (const entries of Object.values(byLang)) {
    for (const name of Object.keys(entries)) {
      if (!seen.has(name)) {
        seen.add(name)
        names.push(name)
      }
    }
  }
  return names
}

function assertUniqueNames(feature: string, names: readonly string[]): void {
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) {
      throw new ScreenciError(`Duplicate ${feature} name "${name}".`)
    }
    seen.add(name)
  }
}
