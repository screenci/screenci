import type { ContentMajor, LanguageMajor } from './declare.js'

/**
 * The editable axes deferred to the ScreenCI web app, read by the recorder to
 * stamp `metadata.studio`. `renderOptions`/`recordOptions` come from the
 * matching editable sentinel; `languages` is set when the recording's language
 * set is web-owned (`video.languages(editable())`).
 */
export type EditableOptionFlags = {
  renderOptions: boolean
  recordOptions: boolean
  /** Whether the language set is owned by the web app (`video.languages(editable())`). */
  languages?: boolean
}

/** Brand marking a value produced by {@link editable}. */
export const EDITABLE: unique symbol = Symbol.for('screenci.studio')

/**
 * An app-editable declaration produced by {@link editable}: the content (or,
 * for `languages`, the set) is owned by the ScreenCI web app. `names` lists
 * the declared keys (cue / overlay / audio names, or language codes); `seed`,
 * when present, supplies initial values the web app starts from but may
 * override.
 *
 * `S` carries the seed shape so the consuming feature method validates seed
 * values against its own value type (e.g. narration seeds are checked as
 * narration cues). A blank declaration (`editable([...])`) has `seed`
 * undefined.
 */
export type EditableMarker<S = unknown> = {
  readonly [EDITABLE]: true
  readonly names: readonly string[]
  readonly seed?: S
}

/** A blank app-editable declaration: names only, no seed. */
export type EditableNames = EditableMarker<undefined> & {
  readonly seed?: undefined
  /** Phantom guard: keeps the keyless form ({@link EditablePending}) out of feature args. */
  readonly languagesOnly?: never
}

/** A seeded editable declaration: the web app starts from `seed` but may override it. */
export type EditableSeeded<S> = EditableMarker<S> & {
  readonly seed: S
  readonly languagesOnly?: never
}

/**
 * The keyless form, `editable()`: the web app owns the entire set. Only
 * `video.languages(editable())` accepts it (a content feature has no keys to
 * defer, so its keyless form is rejected by {@link FeatureArg}). The
 * `languagesOnly` brand is what makes it unassignable to {@link EditableNames}.
 */
export type EditablePending = EditableMarker<undefined> & {
  readonly names: readonly []
  readonly seed?: undefined
  readonly languagesOnly: true
}

/** Whether a value was produced by {@link editable}. */
export function isEditableMarker(value: unknown): value is EditableMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[EDITABLE] === true
  )
}

/**
 * Declare something app-editable: its content is configured in the ScreenCI web
 * app, and code only declares that it exists. Three forms:
 *
 * - `editable(['intro', 'cta'])`: blank names. The keys exist in code (so the
 *   test body can reference `narration.intro`), but the web app owns their
 *   content.
 * - `editable({ intro: 'Welcome' })`: seeded. The web app starts from these
 *   values but owns them: once edited in the web editor, the edited value wins
 *   (a seed never clobbers an existing edit).
 * - `editable()`: keyless. Only `video.languages(editable())` accepts it: the
 *   web app owns the entire language set. Content features have keys to
 *   declare, so their keyless form does not type-check.
 *
 * For `video.languages`, the names are language codes: `editable(['en', 'fi'])`
 * seeds the initial set (web-owned, but starts with those languages).
 */
export function editable(): EditablePending
export function editable<const N extends readonly string[]>(
  names: N
): EditableNames & { readonly names: N }
export function editable<
  const S extends ContentMajor<unknown> | LanguageMajor<unknown>,
>(
  seed: S
): EditableSeeded<S> & { readonly names: readonly (keyof S & string)[] }
export function editable(
  arg?: readonly string[] | Record<string, unknown>
): EditableMarker {
  if (arg === undefined) return { [EDITABLE]: true, names: [] }
  if (Array.isArray(arg)) return { [EDITABLE]: true, names: [...arg] }
  return {
    [EDITABLE]: true,
    names: Object.keys(arg),
    seed: arg as ContentMajor<unknown>,
  }
}
