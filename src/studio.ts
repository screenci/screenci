import type { ContentMajor, LanguageMajor } from './declare.js'

/**
 * The studio axes deferred to the ScreenCI web app, read by the recorder to
 * stamp `metadata.studio`. `renderOptions`/`recordOptions` come from the
 * matching `'studio'` sentinel; `languages` is set when the recording's
 * language set is web-owned (`video.languages(studio())`).
 */
export type StudioOptionFlags = {
  renderOptions: boolean
  recordOptions: boolean
  /** Whether the language set is owned by the web app (`video.languages(studio())`). */
  languages?: boolean
}

/** Brand marking a value produced by {@link studio}. */
export const STUDIO: unique symbol = Symbol.for('screenci.studio')

/**
 * A Studio-owned declaration produced by {@link studio}: the content (or, for
 * `languages`, the set) is owned by the ScreenCI web app. `names` lists the
 * declared keys (cue / overlay / audio names, or language codes); `seed`, when
 * present, supplies initial values the web app starts from but may override.
 *
 * `S` carries the seed shape so the consuming feature method validates seed
 * values against its own value type (e.g. narration seeds are checked as
 * narration cues). A blank declaration (`studio([...])`) has `seed` undefined.
 */
export type StudioMarker<S = unknown> = {
  readonly [STUDIO]: true
  readonly names: readonly string[]
  readonly seed?: S
}

/** A blank Studio declaration: names only, no seed. */
export type StudioNames = StudioMarker<undefined> & {
  readonly seed?: undefined
  /** Phantom guard: keeps the keyless form ({@link StudioPending}) out of feature args. */
  readonly languagesOnly?: never
}

/** A seeded Studio declaration: the web app starts from `seed` but may override it. */
export type StudioSeeded<S> = StudioMarker<S> & {
  readonly seed: S
  readonly languagesOnly?: never
}

/**
 * The keyless form, `studio()`: the web app owns the entire set. Only
 * `video.languages(studio())` accepts it (a content feature has no keys to
 * defer, so its keyless form is rejected by {@link FeatureArg}). The
 * `languagesOnly` brand is what makes it unassignable to {@link StudioNames}.
 */
export type StudioPending = StudioMarker<undefined> & {
  readonly names: readonly []
  readonly seed?: undefined
  readonly languagesOnly: true
}

/** Whether a value was produced by {@link studio}. */
export function isStudioMarker(value: unknown): value is StudioMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[STUDIO] === true
  )
}

/**
 * Declare something Studio-owned: its content is configured in the ScreenCI web
 * app, and code only declares that it exists. Three forms:
 *
 * - `studio(['intro', 'cta'])`: blank names. The keys exist in code (so the test
 *   body can reference `narration.intro`), but the web app owns their content.
 * - `studio({ intro: 'Welcome' })`: seeded. The web app starts from these values
 *   but owns them: once edited in Studio, the Studio value wins (a seed never
 *   clobbers an existing Studio edit).
 * - `studio()`: keyless. Only `video.languages(studio())` accepts it: the web app
 *   owns the entire language set. Content features have keys to declare, so their
 *   keyless form does not type-check.
 *
 * For `video.languages`, the names are language codes: `studio(['en', 'fi'])`
 * seeds the initial set (web-owned, but starts with those languages).
 */
export function studio(): StudioPending
export function studio<const N extends readonly string[]>(
  names: N
): StudioNames & { readonly names: N }
export function studio<
  const S extends ContentMajor<unknown> | LanguageMajor<unknown>,
>(seed: S): StudioSeeded<S> & { readonly names: readonly (keyof S & string)[] }
export function studio(
  arg?: readonly string[] | Record<string, unknown>
): StudioMarker {
  if (arg === undefined) return { [STUDIO]: true, names: [] }
  if (Array.isArray(arg)) return { [STUDIO]: true, names: [...arg] }
  return {
    [STUDIO]: true,
    names: Object.keys(arg),
    seed: arg as ContentMajor<unknown>,
  }
}
