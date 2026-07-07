import { ScreenciError } from './errors.js'
import { isLanguageKey } from './declare.js'
import { EDITABLE, isEditableMarker, type EditableMarker } from './studio.js'
import type { Lang } from './voices.js'
import type { RecordOptions, RenderOptions } from './types.js'

/**
 * Language-major spelling of an options declaration: `default` supplies the
 * all-languages base and each language key overrides it for that language's
 * recording pass. Mirrors the language-major form of `video.narration(...)`.
 */
export type OptionsByLang<T> = {
  default?: Partial<T>
} & Partial<Record<Lang, Partial<T>>>

/**
 * The argument accepted by `video.recordOptions(...)` / `video.renderOptions(...)`
 * (and the `screenshot` counterparts):
 *
 * - **Flat object** (`{ aspectRatio: '16:9' }`): shared across every language.
 * - **Language-major object** (`{ default: {...}, de: {...} }`): top-level keys
 *   are language codes plus an optional `default` base; each language's options
 *   are deep-merged over `default` for that language's pass.
 * - **`editable()` / `editable({...})`**: the whole bag is owned by the ScreenCI
 *   web app; a seed (either spelling) supplies the values it starts from.
 */
export type OptionsArg<T> =
  | Partial<T>
  | OptionsByLang<T>
  | EditableMarker<Partial<T> | OptionsByLang<T>>

/** A normalized options declaration: shared base + per-language overrides. */
export type NormalizedOptions<T> = {
  /** All-languages base (`default` or the flat form), or `null` when none. */
  shared: Partial<T> | null
  /** Per-language overrides: `language -> options patch`. */
  byLang: Partial<Record<string, Partial<T>>>
  /** Languages contributed by this declaration (the keys of `byLang`). */
  languages: string[]
  /** Whether the bag is owned by the web app (`editable()` / `editable({...})`). */
  studio: boolean
}

/**
 * Normalizes an {@link OptionsArg} into a {@link NormalizedOptions}. Pure; the
 * single source of truth for the flat / language-major / editable split.
 *
 * Disambiguation follows `declare.ts`: an object is language-major iff *every*
 * top-level key is a supported language code or the literal `default`. No
 * record/render option group collides with a language code, so a mixed object
 * is always a mistake and is rejected.
 *
 * @param feature label used in error messages, e.g. `'recordOptions'`.
 */
export function normalizeOptionsArg<T>(
  feature: string,
  arg: OptionsArg<T>
): NormalizedOptions<T> {
  if (isEditableMarker(arg)) {
    if (arg.seed === undefined) {
      return { shared: null, byLang: {}, languages: [], studio: true }
    }
    const inner = normalizeOptionsArg<T>(feature, arg.seed as OptionsArg<T>)
    if (inner.studio) {
      throw new ScreenciError(
        `${feature}(editable(editable(...))) is not supported: nest the seed ` +
          `object directly, e.g. ${feature}(editable({ ... })).`
      )
    }
    return { ...inner, studio: true }
  }

  const obj = arg as Record<string, unknown>
  const keys = Object.keys(obj)
  const languageKeys = keys.filter(isLanguageKey)
  const languageMajor = keys.length > 0 && languageKeys.length === keys.length

  if (languageMajor) {
    const shared = (obj['default'] as Partial<T> | undefined) ?? null
    const byLang: Record<string, Partial<T>> = {}
    for (const key of keys) {
      if (key === 'default') continue
      byLang[key] = obj[key] as Partial<T>
    }
    return {
      shared,
      byLang,
      languages: Object.keys(byLang),
      studio: false,
    }
  }

  if (languageKeys.length > 0) {
    throw new ScreenciError(
      `${feature} mixes language keys (${languageKeys.join(', ')}) with option ` +
        `keys. Use the language-major form (every key a language code or ` +
        `"default") for per-language options, e.g. ` +
        `${feature}({ default: { ... }, ${languageKeys[0]}: { ... } }).`
    )
  }

  return {
    shared: obj as Partial<T>,
    byLang: {},
    languages: [],
    studio: false,
  }
}

/**
 * Deep-merge a record-options patch over a base. Record options are a flat bag,
 * so a spread suffices; `undefined` patch values never clobber base values.
 */
export function mergeRecordOptions(
  base: Partial<RecordOptions>,
  patch: Partial<RecordOptions> | undefined
): Partial<RecordOptions> {
  if (patch === undefined) return base
  const merged: Partial<RecordOptions> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      ;(merged as Record<string, unknown>)[key] = value
    }
  }
  return merged
}

/** The top-level {@link RenderOptions} groups, merged one level deep each. */
const RENDER_OPTION_GROUPS = [
  'recording',
  'narration',
  'mouse',
  'zoom',
  'output',
  'screenshot',
] as const

/**
 * Deep-merge a render-options patch over a base, group-wise (one level deep per
 * group: `recording`, `narration`, `mouse`, `zoom`, `output`, `screenshot`), so
 * a per-language patch like `{ narration: { voice } }` refines the base group
 * rather than replacing it.
 */
export function mergeRenderOptions(
  base: Partial<RenderOptions> | undefined,
  patch: Partial<RenderOptions> | undefined
): Partial<RenderOptions> | undefined {
  if (patch === undefined) return base
  if (base === undefined) return patch
  const merged: Partial<RenderOptions> = { ...base }
  for (const group of RENDER_OPTION_GROUPS) {
    const baseGroup = base[group]
    const patchGroup = patch[group]
    if (patchGroup === undefined) continue
    ;(merged as Record<string, unknown>)[group] =
      baseGroup === undefined ? patchGroup : { ...baseGroup, ...patchGroup }
  }
  return merged
}

/** Construct a whole-bag editable marker carrying a merged seed. */
export function editableOptionsMarker<T>(
  seed: Partial<T> | undefined
): EditableMarker<Partial<T>> {
  return {
    [EDITABLE]: true,
    names: [],
    ...(seed !== undefined && { seed }),
  }
}

/**
 * Resolve a normalized record-options declaration for one recording pass:
 * shared base, then the pass language's override, then the `each` variant patch
 * (a variant is a distinct video, so it wins over the language override). When
 * the declaration is web-owned the merged result becomes the editable seed.
 */
export function resolveRecordOptionsForPass(params: {
  decl: NormalizedOptions<RecordOptions> | null
  language: string | null
  variantPatch: Partial<RecordOptions> | null
}): Partial<RecordOptions> | EditableMarker<Partial<RecordOptions>> | null {
  const { decl, language, variantPatch } = params
  if (decl === null) return variantPatch
  const langPatch = language !== null ? decl.byLang[language] : undefined
  let merged: Partial<RecordOptions> | undefined =
    decl.shared !== null || langPatch !== undefined || variantPatch !== null
      ? mergeRecordOptions(
          mergeRecordOptions(decl.shared ?? {}, langPatch),
          variantPatch ?? undefined
        )
      : undefined
  if (decl.studio) return editableOptionsMarker(merged)
  merged ??= {}
  return merged
}

/**
 * Resolve a normalized render-options declaration for one recording pass:
 * shared base deep-merged with the pass language's override. When the
 * declaration is web-owned the merged result becomes the editable seed.
 */
export function resolveRenderOptionsForPass(params: {
  decl: NormalizedOptions<RenderOptions> | null
  language: string | null
}): Partial<RenderOptions> | EditableMarker<Partial<RenderOptions>> | null {
  const { decl, language } = params
  if (decl === null) return null
  const langPatch = language !== null ? decl.byLang[language] : undefined
  const merged = mergeRenderOptions(decl.shared ?? undefined, langPatch)
  if (decl.studio) return editableOptionsMarker(merged)
  return merged ?? {}
}

/**
 * Combine the config-level record options (`use.recordOptions` in
 * `screenci.config`) with the per-video builder declaration for this pass. The
 * builder patch wins; an editable builder declaration keeps its Studio
 * ownership while merging the config layer under its seed.
 */
export function combineRecordOptionsLayers(
  config: RecordOptions,
  patch:
    | Partial<RecordOptions>
    | EditableMarker<Partial<RecordOptions>>
    | undefined
): RecordOptions | EditableMarker<Partial<RecordOptions>> {
  if (patch === undefined) return config
  if (isEditableMarker(patch)) {
    return editableOptionsMarker(mergeRecordOptions(config, patch.seed))
  }
  return mergeRecordOptions(config, patch)
}

/**
 * Combine the config-level render options (`use.renderOptions` in
 * `screenci.config`) with the per-video builder declaration for this pass. The
 * builder patch wins group-wise; an editable builder declaration keeps its
 * Studio ownership while merging the config layer under its seed.
 */
export function combineRenderOptionsLayers(
  config: RenderOptions | undefined,
  patch: RenderOptions | EditableMarker<Partial<RenderOptions>> | undefined
): RenderOptions | EditableMarker<Partial<RenderOptions>> | undefined {
  if (patch === undefined) return config
  if (isEditableMarker(patch)) {
    return editableOptionsMarker(
      mergeRenderOptions(config, patch.seed as Partial<RenderOptions>)
    )
  }
  return mergeRenderOptions(config, patch) ?? {}
}
