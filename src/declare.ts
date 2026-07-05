import { ScreenciError } from './errors.js'
import {
  isEditableMarker,
  type EditableNames,
  type EditableSeeded,
} from './studio.js'
import { supportedLanguages, type Lang } from './voices.js'

/**
 * The per-feature declaration argument, shared by `video.narration`/`text`/
 * `overlays`/`audio` (and the `screenshot` subset). The argument *shape* decides
 * ownership and localization:
 *
 * - **Editor-owned** (`editable(['intro', 'cta'])`): the names are owned by the
 *   ScreenCI web app. Their content is configured there; code only declares that
 *   they exist. `editable({ intro: 'Hi' })` additionally seeds initial values the
 *   web app starts from but may override.
 * - **Content-major object** (`{ intro: 'Hi' }`): a flat `name -> value` map of
 *   code-defined values, shared across every language.
 * - **Language-major object** (`{ fr: { intro: 'Salut' }, default: { intro: 'Hi' } }`):
 *   top-level keys are language codes (plus an optional `default`). Each language
 *   maps `name -> value`; `default` supplies the shared fallback for any name a
 *   language omits.
 *
 * A bare array (`['intro']`) is no longer accepted: wrap it with `editable([...])`.
 *
 * Disambiguation (see {@link isLanguageKey}): an object is treated as
 * language-major iff *every* top-level key is a supported language code or the
 * literal `default`. There is deliberately no `languages:` wrapper. As a result a
 * content name may not be a bare language code or `default` (rejected by
 * {@link normalizeFeature}).
 */
export type FeatureArg<V> =
  | EditableNames
  | EditableSeeded<ContentMajor<V> | LanguageMajor<V>>
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
 * map; the editable name form produces `studioNames` only.
 */
export type NormalizedFeature<V> = {
  /** All declared content names, in declaration order (studio names for arrays). */
  names: string[]
  /** Studio/web-owned names (array form). Empty for object forms. */
  studioNames: string[]
  /** Code-defined names (object forms). Empty for the array form. */
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
  if (isEditableMarker(arg)) {
    if (arg.seed === undefined && arg.names.length === 0) {
      throw new ScreenciError(
        `${feature}(editable()) needs names: editable() with no keys is only valid ` +
          `for video.languages(editable()). Pass editable(['name', ...]) to declare ` +
          `${feature} names, or editable({ name: value }) to also seed them.`
      )
    }
    if (arg.seed === undefined) {
      const studioNames = [...arg.names]
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
    // Seeded: normalize the seed object exactly like a code-owned declaration,
    // then re-tag every resolved name as editor-owned. The shared/byLang values
    // are the web app's starting point; a seed never clobbers a Studio edit.
    const inner = normalizeFeature<V>(feature, arg.seed as FeatureArg<V>)
    return { ...inner, studioNames: inner.names, codeNames: [] }
  }

  if (Array.isArray(arg)) {
    throw new ScreenciError(
      `${feature}([...]) bare arrays are no longer editor-owned. Wrap the names ` +
        `with editable([...]) to defer them to the web app, e.g. ` +
        `video.${feature}(editable(${JSON.stringify(arg)})).`
    )
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
