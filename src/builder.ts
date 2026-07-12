import { fileURLToPath } from 'node:url'
import type { TestDetails, TestInfo } from '@playwright/test'
import type { RecordOptions, RenderOptions } from './types.js'
import type { NarrationCue } from './cue.js'
import type {
  OverlayController,
  OverlayControllerFor,
  OverlayInputOrFactory,
} from './asset.js'
import type { AudioController, AudioInput } from './audio.js'
import { resolveLocaleForLanguage } from './locales.js'
import { parseRequestedLanguages } from './runtimeMode.js'
import { logger } from './logger.js'
import type { LocalizeNarrationValue, VoiceConfig } from './localize.js'
import type { Lang } from './voices.js'
import {
  normalizeFeature,
  type FeatureArg,
  type NormalizedFeature,
} from './declare.js'
import {
  normalizeOptionsArg,
  resolveRecordOptionsForPass,
  resolveRenderOptionsForPass,
  type NormalizedOptions,
  type OptionsArg,
} from './optionsDeclare.js'
import { ScreenciError } from './errors.js'

/**
 * One variant in a generic `video.each(...)` fan-out. Each variant produces a
 * separate video (its own identity and stored history), differing only in its
 * recording options and/or forwarded Playwright `use` options.
 */
export type EachVariant = {
  /** Stable label appended to the video name, e.g. `'mobile'` or `'dark'`. */
  key: string
  /** Recording options for this variant (merged over the video's defaults). */
  recordOptions?: Partial<RecordOptions>
  /** Forwarded Playwright `use` options for this variant, e.g. `{ colorScheme: 'dark' }`. */
  use?: Record<string, unknown>
}

/** Capture strategy across languages. */
export type LocalizeMode = 'shared' | 'per-language'

/**
 * Recording-level localization config, declared via `video.languages(...)`. It
 * drives the registration-time fan-out (one Playwright test per language), so it
 * lives on a builder method rather than in `recordOptions` (a run-time option).
 *
 * Code is the single source of truth: the recorded set is the union of the code
 * seed (`video.languages(['en', 'fi'])`) and the per-feature language keys, then
 * restricted by the `--languages` filter. Adding a language in the web editor
 * codegens it into this `video.languages([...])` block, so it is code again by
 * the next record.
 */
export type RecordingLocalize = {
  /** Explicit code seed from `video.languages(['en', ...])`, if any. */
  languages?: readonly Lang[]
  mode?: LocalizeMode
  locales?: Partial<Record<Lang, string>>
  browserLocale?: boolean
}

/**
 * The capture config for `video.languages(...)`. `languages` may be omitted to
 * infer the set from the per-feature keys (e.g. `narration({ en, fi })`), the
 * usual pairing with `mode: 'shared'`.
 */
export type LanguagesConfig = {
  languages?: readonly Lang[]
  mode?: LocalizeMode
  locales?: Partial<Record<Lang, string>>
  browserLocale?: boolean
}

/**
 * The argument accepted by `video.languages(...)`:
 *
 * - omitted: nothing seeded (the set is inferred from per-feature keys, else the
 *   implicit `['en']` default).
 * - `['en', 'fi']`: the explicit code set.
 * - `{ languages, mode, ... }`: the explicit config.
 */
export type LanguagesArg = readonly Lang[] | LanguagesConfig | undefined

function normalizeLanguagesArg(arg: LanguagesArg): RecordingLocalize {
  const cfg: LanguagesConfig = Array.isArray(arg)
    ? { languages: arg as readonly Lang[] }
    : ((arg as LanguagesConfig | undefined) ?? {})
  return {
    ...(cfg.languages !== undefined &&
      cfg.languages.length > 0 && { languages: cfg.languages }),
    ...(cfg.mode !== undefined && { mode: cfg.mode }),
    ...(cfg.locales !== undefined && { locales: cfg.locales }),
    ...(cfg.browserLocale !== undefined && {
      browserLocale: cfg.browserLocale,
    }),
  }
}

/** A single Playwright test to register, fully resolved from the fan-out specs. */
export type Registration = {
  /** Label for the wrapping `describe` block (scopes per-test `use` options). */
  describeTitle: string
  /** Unique Playwright test title (drives the per-pass `.screenci/<dir>`). */
  leafTitle: string
  /** Grouping key written to `metadata.videoName`; shared across a video's languages. */
  videoName: string
  /** Active language for this pass, or `null` in shared / single-language mode. */
  language: string | null
  /** Browser locale for this pass, or `null` to leave the default. */
  locale: string | null
  /**
   * Record options for this pass (declaration base + this language's override
   * + the `each` variant patch, pre-merged), or `null` for none.
   */
  recordOptions: Partial<RecordOptions> | null
  /**
   * Render options for this pass (declaration base + this language's override,
   * pre-merged), or `null` for none.
   */
  renderOptions: Partial<RenderOptions> | null
  /** Forwarded Playwright `use` options for this pass, or `null` for none. */
  use: Record<string, unknown> | null
  /** Per-feature declarations carried into the fixtures. */
  narration: NormalizedFeature<LocalizeNarrationValue> | null
  values: NormalizedFeature<string> | null
  overlays: NormalizedFeature<OverlayInputOrFactory> | null
  audio: NormalizedFeature<AudioInput> | null
  /** Resolved recording-level localize config (languages/mode/locales). */
  recordingLocalize: ResolvedRecordingLocalize
}

/** The recording-level localize config after registration-time resolution. */
export type ResolvedRecordingLocalize = {
  /** Every language this video records (the resolved set). */
  languages: string[]
  /**
   * Every language this video *defines* (the full code-defined / web-owned set),
   * independent of the `--languages` render filter. `languages` is the subset
   * actually rendered this run; `availableLanguages` is the complete set so the
   * app knows which languages exist even when only some were rendered. A render
   * restricted to `--languages fr` still reports `de`, `en`, ... here, so the app
   * does not treat them as removed-from-code.
   */
  availableLanguages: string[]
  mode: LocalizeMode
  browserLocale: boolean
  locales?: Partial<Record<Lang, string>>
  /**
   * Whether the languages were explicitly defined (via `video.languages(...)` or
   * per-feature keys) rather than the implicit `['en']` default. A plain video
   * with no language info stays language-agnostic (no `[lang]` tag).
   */
  explicit: boolean
}

function variantVideoName(
  baseTitle: string,
  variant: EachVariant | null
): string {
  return variant === null ? baseTitle : `${baseTitle} ${variant.key}`
}

/** Languages contributed by the per-feature declarations (union of `byLang`). */
function featureLanguages(state: BuilderState): string[] {
  const set = new Set<string>()
  for (const feature of [
    state.narration,
    state.values,
    state.overlays,
    state.audio,
  ]) {
    for (const lang of feature?.languages ?? []) set.add(lang)
  }
  for (const decl of [state.recordOptions, state.renderOptions]) {
    for (const lang of decl?.languages ?? []) set.add(lang)
  }
  return [...set]
}

/**
 * Resolve the recorded language set at registration time. The set defined in
 * code is the union of the explicit `video.languages(['en', ...])` seed and the
 * per-feature language keys (e.g. `narration({ fr })` -> French); when neither
 * contributes anything the set is the implicit `['en']` default (a plain video,
 * language-agnostic). The `--languages` filter (`requestedLanguages`) then
 * restricts the defined set to what was asked for.
 */
export function resolveRecordingLocalize(
  state: BuilderState,
  requestedLanguages: string[] | null
): ResolvedRecordingLocalize {
  const rl = state.recordingLocalize
  const mode: LocalizeMode = rl?.mode ?? 'per-language'
  const browserLocale = rl?.browserLocale ?? true
  const localesPatch = rl?.locales !== undefined ? { locales: rl.locales } : {}

  // The set defined in code: the explicit `video.languages([...])` seed unioned
  // with the per-feature language keys. Empty => the implicit `['en']` default.
  const defined = [
    ...new Set([...(rl?.languages ?? []), ...featureLanguages(state)]),
  ]
  const availableLanguages = defined.length > 0 ? defined : ['en']
  const explicit = defined.length > 0

  const languages =
    requestedLanguages === null
      ? availableLanguages
      : availableLanguages.filter((lang) => requestedLanguages.includes(lang))
  return {
    languages,
    // The full defined set, regardless of the `--languages` render filter. The
    // app reads this so a code-defined language that simply was not rendered this
    // run is not mistaken for one removed from code.
    availableLanguages,
    mode,
    browserLocale,
    ...localesPatch,
    explicit,
  }
}

/**
 * Warn about per-feature values declared for a language outside the recorded set
 * (e.g. `narration({ fr })` while the set is `[fi]`): the value is ignored.
 */
function warnUnusedLanguages(
  state: BuilderState,
  resolved: ResolvedRecordingLocalize
): void {
  const active = new Set(resolved.languages)
  const source = 'video.languages()'
  const langList = resolved.languages.join(', ') || '(none)'
  const features: [string, NormalizedFeature<unknown> | null][] = [
    ['Narration', state.narration],
    ['Values', state.values],
    ['Overlay', state.overlays],
    ['Audio', state.audio],
  ]
  for (const [label, feature] of features) {
    if (feature === null) continue
    for (const [lang, entries] of Object.entries(feature.byLang)) {
      if (active.has(lang) || entries === undefined) continue
      for (const name of Object.keys(entries)) {
        logger.warn(
          `[screenci] ${label} ${name} (${lang}) is not used at all currently, ` +
            `reason: only languages [${langList}] defined in ${source}. ` +
            `See https://screenci.com/docs/localization`
        )
      }
    }
  }
  const optionDecls: [string, NormalizedOptions<unknown> | null][] = [
    ['Record options', state.recordOptions],
    ['Render options', state.renderOptions],
  ]
  for (const [label, decl] of optionDecls) {
    if (decl === null) continue
    for (const lang of Object.keys(decl.byLang)) {
      if (active.has(lang)) continue
      logger.warn(
        `[screenci] ${label} for language ${lang} are not used at all currently, ` +
          `reason: only languages [${langList}] defined in ${source}. ` +
          `See https://screenci.com/docs/localization`
      )
    }
  }
}

/**
 * Expand the fan-out specs into the concrete list of Playwright tests to
 * register. Pure and exported for testing.
 *
 * - A single resolved language (default, or one inferred/declared) yields one
 *   language-agnostic test (`language: null`).
 * - `'shared'` mode yields one test carrying every language (overdubbed at
 *   render); the `--languages` filter does not split a shared recording.
 * - `'per-language'` mode yields one test per resolved language.
 */
export function expandRegistrations(params: {
  baseTitle: string
  state: BuilderState
  requestedLanguages: string[] | null
}): Registration[] {
  const { baseTitle, state } = params
  const variants: (EachVariant | null)[] = state.eachVariants ?? [null]
  const registrations: Registration[] = []

  for (const variant of variants) {
    const videoName = variantVideoName(baseTitle, variant)
    const variantPatch = variant?.recordOptions ?? null
    const use = variant?.use ?? null
    const variantLabel = variant === null ? '' : `${variant.key} `
    const resolved = resolveRecordingLocalize(state, params.requestedLanguages)
    warnUnusedLanguages(state, resolved)

    // Per-language options require a per-language capture: a shared recording
    // is captured once and overdubbed, so a per-language viewport or render
    // bag is a contradiction. Fail loudly rather than silently ignoring it.
    if (resolved.mode === 'shared') {
      for (const [label, decl] of [
        ['recordOptions', state.recordOptions],
        ['renderOptions', state.renderOptions],
      ] as const) {
        if (decl !== null && Object.keys(decl.byLang).length > 0) {
          throw new ScreenciError(
            `${label}({ <language>: ... }) requires mode: 'per-language': a ` +
              `shared recording is captured once, so per-language options ` +
              `cannot apply. Remove the per-language keys or drop mode: 'shared'.`
          )
        }
      }
    }

    const optionsForPass = (language: string | null) => ({
      recordOptions: resolveRecordOptionsForPass({
        decl: state.recordOptions,
        language,
        variantPatch,
      }),
      renderOptions: resolveRenderOptionsForPass({
        decl: state.renderOptions,
        language,
      }),
    })

    // Explicitly-declared languages all filtered out (`--languages`): register
    // nothing for this variant.
    if (resolved.explicit && resolved.languages.length === 0) {
      continue
    }

    const base = {
      videoName,
      use,
      narration: state.narration,
      values: state.values,
      overlays: state.overlays,
      audio: state.audio,
      recordingLocalize: resolved,
    }

    // Shared mode or a single language-agnostic pass: one registration that
    // carries every (or the single) language without splitting.
    const singlePass =
      resolved.mode === 'shared' || resolved.languages.length <= 1

    if (singlePass) {
      // A single explicitly-declared language is tagged `[lang]`; the implicit
      // `['en']` default (a plain video) stays language-agnostic (no `[en]` tag).
      const onlyLang =
        resolved.explicit &&
        resolved.mode === 'per-language' &&
        resolved.languages.length === 1
          ? resolved.languages[0]!
          : null
      // Locale: an explicitly tagged single language uses its locale; the implicit
      // default records one round pinned to en-US (the `['en']` default) while
      // staying language-agnostic. Shared passes leave the locale unset.
      const localeLang =
        onlyLang ??
        (!resolved.explicit && resolved.languages.length === 1
          ? resolved.languages[0]!
          : null)
      const describeTitle = onlyLang
        ? `${variantLabel}${onlyLang}`.trim()
        : resolved.mode === 'shared'
          ? `${variantLabel}shared`.trim()
          : (variant?.key ?? baseTitle)
      registrations.push({
        ...base,
        ...optionsForPass(onlyLang),
        describeTitle,
        leafTitle: onlyLang ? `${videoName} [${onlyLang}]` : videoName,
        language: onlyLang,
        locale:
          localeLang && resolved.browserLocale
            ? resolveLocaleForLanguage(localeLang, resolved.locales)
            : null,
      })
      continue
    }

    for (const lang of resolved.languages) {
      registrations.push({
        ...base,
        ...optionsForPass(lang),
        describeTitle: `${variantLabel}${lang}`,
        leafTitle: `${videoName} [${lang}]`,
        language: lang,
        locale: resolved.browserLocale
          ? resolveLocaleForLanguage(lang, resolved.locales)
          : null,
      })
    }
  }

  return registrations
}

/** Internal option keys the page/context fixtures read off a registered test. */
const SCREENCI_LANGUAGE_OPTION = '_screenciLanguage'
const SCREENCI_VIDEO_NAME_OPTION = '_screenciVideoName'
const SCREENCI_NARRATION_OPTION = '_screenciNarration'
const SCREENCI_VALUES_OPTION = '_screenciValues'
const SCREENCI_OVERLAYS_OPTION = '_screenciOverlays'
const SCREENCI_AUDIO_OPTION = '_screenciAudio'
const SCREENCI_RECORDING_LOCALIZE_OPTION = '_screenciRecordingLocalize'
const SCREENCI_SOURCE_FILE_OPTION = '_screenciSourceFile'
const SCREENCI_RECORD_OPTIONS_OPTION = '_screenciRecordOptions'
const SCREENCI_RENDER_OPTIONS_OPTION = '_screenciRenderOptions'

/** Absolute path of this module, used to skip our own frames when capturing. */
const BUILDER_MODULE_PATH = fileURLToPath(import.meta.url)

/** Normalize a V8 call-site filename (which may be a `file://` URL) to a path. */
function callSiteFile(frame: NodeJS.CallSite): string | null {
  const fileName = frame.getFileName()
  if (!fileName) return null
  return fileName.startsWith('file://') ? fileURLToPath(fileName) : fileName
}

/**
 * Capture the source file of the user's `.screenci` script that called the
 * builder. Playwright attributes `testInfo.file` to this module, so asset paths
 * authored relative to the script would otherwise resolve against this package.
 * We walk the call stack and return the first frame outside this module.
 */
function captureSourceFile(): string | null {
  const originalPrepare = Error.prepareStackTrace
  const originalLimit = Error.stackTraceLimit
  try {
    Error.stackTraceLimit = 50
    Error.prepareStackTrace = (_error, stack) => stack
    const stack = new Error().stack as unknown as NodeJS.CallSite[]
    if (!Array.isArray(stack)) return null
    for (const frame of stack) {
      const file = callSiteFile(frame)
      if (file !== null && file !== BUILDER_MODULE_PATH) {
        return file
      }
    }
    return null
  } finally {
    Error.prepareStackTrace = originalPrepare
    Error.stackTraceLimit = originalLimit
  }
}

/** Test-registration modifier mirroring Playwright's `test.only`/`skip`/etc. */
type TestModifier = 'only' | 'skip' | 'fixme' | 'fail'

type TestCall = {
  (title: string, body: unknown): void
  (title: string, details: TestDetails, body: unknown): void
}

/** Minimal view of the test API the builder needs to register tests. */
type RegistrarTest = TestCall & {
  describe: (title: string, fn: () => void) => void
  use: (options: Record<string, unknown>) => void
  only: TestCall
  skip: TestCall
  fixme: TestCall
  fail: TestCall
}

function registerOne(
  test: RegistrarTest,
  reg: Registration,
  details: TestDetails | undefined,
  body: unknown,
  modifier: TestModifier | undefined,
  sourceFile: string | null
): void {
  const useOptions: Record<string, unknown> = {
    ...(reg.use ?? {}),
    ...(reg.recordOptions !== null
      ? { [SCREENCI_RECORD_OPTIONS_OPTION]: reg.recordOptions }
      : {}),
    ...(reg.renderOptions !== null
      ? { [SCREENCI_RENDER_OPTIONS_OPTION]: reg.renderOptions }
      : {}),
    ...(reg.locale !== null ? { locale: reg.locale } : {}),
    [SCREENCI_LANGUAGE_OPTION]: reg.language ?? undefined,
    [SCREENCI_VIDEO_NAME_OPTION]: reg.videoName,
    [SCREENCI_NARRATION_OPTION]: reg.narration ?? undefined,
    [SCREENCI_VALUES_OPTION]: reg.values ?? undefined,
    [SCREENCI_OVERLAYS_OPTION]: reg.overlays ?? undefined,
    [SCREENCI_AUDIO_OPTION]: reg.audio ?? undefined,
    [SCREENCI_RECORDING_LOCALIZE_OPTION]: reg.recordingLocalize,
    [SCREENCI_SOURCE_FILE_OPTION]: sourceFile ?? undefined,
  }

  const register: TestCall = modifier ? test[modifier] : test

  test.describe(reg.describeTitle, () => {
    test.use(useOptions)
    if (details !== undefined) {
      register(reg.leafTitle, details, body)
    } else {
      register(reg.leafTitle, body)
    }
  })
}

/** Converts a union type to an intersection: `A | B` -> `A & B`. */
type UnionToIntersection<U> = (
  U extends unknown ? (x: U) => void : never
) extends (x: infer I) => void
  ? I
  : never

/**
 * The content names declared by a {@link FeatureArg}. For a names-only array the
 * element literals; for objects, the union of content-major top-level keys (those
 * that are not language codes or `default`) and the language-major inner keys.
 */
type LangKey = Lang | 'default'

type LangMajorNamesOf<A> = NonNullable<
  {
    [K in keyof A & LangKey]: A[K] extends Record<string, unknown>
      ? Extract<keyof A[K], string>
      : never
  }[keyof A & LangKey]
>

export type FeatureNamesOf<A> = A extends readonly string[]
  ? A[number]
  : A extends object
    ? Extract<Exclude<keyof A, LangKey>, string> | LangMajorNamesOf<A>
    : never

/**
 * Builds a feature's fixture controller map so each declared name is a *real*
 * property mapped homomorphically from the object that declared it, rather than
 * a synthesized `Record<Union, V>` entry.
 *
 * Why this matters: `Record<FeatureNamesOf<A>, V>` collapses the names into a
 * string-literal union and then re-synthesizes fresh properties, which severs
 * the link back to the literal that declared each name. An editor then has no
 * source location to jump to, so control-clicking `narration.intro` cannot land
 * on the `intro:` line. A homomorphic map (`[K in keyof Src]`) keeps each
 * property's declaration symbol, which is exactly what "Go to Definition"
 * follows. The `-readonly`/`-?` modifiers drop the modifiers that `const`
 * inference adds to the source literal, so the resolved value type stays
 * identical to the old `Record` form (only navigability is gained).
 *
 * The names-only array form has no declaring object in code (its content lives in
 * the web app), so it keeps the plain `Record` mapping and is not navigable.
 */
type ContentMajorControllers<A, V> = {
  -readonly [K in keyof A as K extends LangKey
    ? never
    : Extract<K, string>]-?: V
}

type LangMajorControllers<A, V> = UnionToIntersection<
  {
    [L in Extract<keyof A, LangKey>]: A[L] extends Record<string, unknown>
      ? { -readonly [K in keyof A[L] as Extract<K, string>]-?: V }
      : never
  }[Extract<keyof A, LangKey>]
>

type FeatureControllers<A, V> = A extends readonly string[]
  ? Record<A[number], V>
  : [Extract<Exclude<keyof A, LangKey>, string>] extends [never]
    ? LangMajorControllers<A, V>
    : ContentMajorControllers<A, V>

/**
 * Overlays mirror {@link FeatureControllers} but resolve each name's controller
 * type from its declared input (`OverlayControllerFor<A[K]>`), so the precise
 * controller variant is preserved alongside navigability. Language-major and
 * Studio names fall back to the broad {@link OverlayController}, matching the
 * prior behavior.
 */
type OverlayContentMajorControllers<A> = {
  -readonly [K in keyof A as K extends LangKey
    ? never
    : Extract<K, string>]-?: OverlayControllerFor<A[K]>
}

type OverlayLangMajorControllers<A> = UnionToIntersection<
  {
    [L in Extract<keyof A, LangKey>]: A[L] extends Record<string, unknown>
      ? {
          -readonly [K in keyof A[L] as Extract<K, string>]-?: OverlayController
        }
      : never
  }[Extract<keyof A, LangKey>]
>

type OverlayControllers<A> = A extends readonly string[]
  ? Record<A[number], OverlayController>
  : [Extract<Exclude<keyof A, LangKey>, string>] extends [never]
    ? OverlayLangMajorControllers<A>
    : OverlayContentMajorControllers<A>

type NarrationOverrideFor<Args, A> = 'narration' extends keyof Args
  ? [FeatureNamesOf<A>] extends [never]
    ? object
    : { narration: FeatureControllers<A, NarrationCue> }
  : object

type ValuesOverrideFor<Args, A> = 'values' extends keyof Args
  ? [FeatureNamesOf<A>] extends [never]
    ? object
    : { values: FeatureControllers<A, string> }
  : object

type OverlayOverrideFor<Args, A> = 'overlays' extends keyof Args
  ? [FeatureNamesOf<A>] extends [never]
    ? object
    : { overlays: OverlayControllers<A> }
  : object

type AudioOverrideFor<Args, A> = 'audio' extends keyof Args
  ? [FeatureNamesOf<A>] extends [never]
    ? object
    : { audio: FeatureControllers<A, AudioController> }
  : object

type MergeArgs<Args, O> = {
  [K in keyof Args | keyof O]: K extends keyof O
    ? O[K]
    : K extends keyof Args
      ? Args[K]
      : never
}

type BodyFn<Args> = (args: Args, testInfo: TestInfo) => void | Promise<void>

/**
 * A chainable fan-out builder. Callable to register the test(s), and exposes the
 * per-feature declaration methods plus `.languages()` / `.each()` to refine the
 * fan-out. `O` accumulates the typed fixture overrides so the body sees
 * `narration`/`values`/`overlays`/`audio` typed to the declared names.
 */
type BuilderTerminal<Args, O> = {
  (title: string, body: BodyFn<MergeArgs<Args, O>>): void
  (title: string, details: TestDetails, body: BodyFn<MergeArgs<Args, O>>): void
}

/** The fixture keys a medium supports (videos: all; screenshots: values+overlays). */
export type FeatureKey = 'narration' | 'values' | 'overlays' | 'audio'

export interface MediaBuilder<Args, O = object> extends BuilderTerminal<
  Args,
  O
> {
  /** Declare narration cues: blank names (array) or code values (object). */
  narration<const A extends FeatureArg<LocalizeNarrationValue>>(
    arg: A
  ): MediaBuilder<Args, O & NarrationOverrideFor<Args, A>>
  // Hidden for release: the on-screen values feature is unfinished, so the
  // builder method is removed from the public type surface. The runtime
  // implementation stays. Re-enable by uncommenting. Docs moved to
  // docs/removed/values.md at the repo root.
  // /** Declare on-screen values fields. */
  // values<const A extends FeatureArg<string>>(
  //   arg: A
  // ): MediaBuilder<Args, O & ValuesOverrideFor<Args, A>>
  /** Declare overlays. */
  overlays<const A extends FeatureArg<OverlayInputOrFactory>>(
    arg: A
  ): MediaBuilder<Args, O & OverlayOverrideFor<Args, A>>
  // Hidden for release: the background audio feature is unfinished, so the
  // builder method is removed from the public type surface. The runtime
  // implementation stays. Re-enable by uncommenting. Docs moved to
  // docs/removed/audio.md at the repo root.
  // /** Declare background-audio tracks. */
  // audio<const A extends FeatureArg<AudioInput>>(
  //   arg: A
  // ): MediaBuilder<Args, O & AudioOverrideFor<Args, A>>
  /** Declare the recorded language set / capture mode. */
  languages(arg?: LanguagesArg): MediaBuilder<Args, O>
  /**
   * Declare capture options (aspect ratio, quality, fps, ...): a flat object
   * shared across languages, or a language-major object (`{ default, de, ... }`)
   * with per-language overrides. The values stay editable in the web app.
   */
  recordOptions(arg: OptionsArg<RecordOptions>): MediaBuilder<Args, O>
  /**
   * Declare render options (framing, narration voice, output, ...): a flat
   * object shared across languages, or a language-major object with
   * per-language overrides. The values stay editable in the web app.
   */
  renderOptions(arg: OptionsArg<RenderOptions>): MediaBuilder<Args, O>
  /** Produce a separate video per variant (viewport, theme, ...). */
  each(variants: EachVariant[]): MediaBuilder<Args, O>
  only: BuilderTerminal<Args, O>
  skip: BuilderTerminal<Args, O>
  fixme: BuilderTerminal<Args, O>
  fail: BuilderTerminal<Args, O>
}

/** Backwards-compatible alias used by the video/screenshot entry points. */
export type VideoBuilder<Args, O = object> = MediaBuilder<Args, O>

/**
 * The builder methods hidden from the public MediaBuilder type for release
 * (values and audio are unfinished features). The runtime implementation keeps
 * attaching them so existing recorded scripts keep working; internal wiring
 * types them through this interface. Delete this and uncomment the MediaBuilder
 * methods to re-enable.
 */
export interface HiddenFeatureMethods<Args, O = object> {
  values<const A extends FeatureArg<string>>(
    arg: A
  ): MediaBuilder<Args, O & ValuesOverrideFor<Args, A>>
  audio<const A extends FeatureArg<AudioInput>>(
    arg: A
  ): MediaBuilder<Args, O & AudioOverrideFor<Args, A>>
}

function normalizeVariants(variants: EachVariant[]): EachVariant[] {
  if (variants.length === 0) {
    throw new Error(
      'video.each() requires at least one variant, e.g. .each([{ key: "mobile" }]).'
    )
  }
  const seen = new Set<string>()
  for (const variant of variants) {
    if (seen.has(variant.key)) {
      throw new Error(
        `Duplicate video.each() variant key "${variant.key}". Variant keys must be unique.`
      )
    }
    seen.add(variant.key)
  }
  return variants
}

export type BuilderState = {
  narration: NormalizedFeature<LocalizeNarrationValue> | null
  values: NormalizedFeature<string> | null
  overlays: NormalizedFeature<OverlayInputOrFactory> | null
  audio: NormalizedFeature<AudioInput> | null
  recordOptions: NormalizedOptions<RecordOptions> | null
  renderOptions: NormalizedOptions<RenderOptions> | null
  recordingLocalize: RecordingLocalize | null
  eachVariants: EachVariant[] | null
  /** Fixtures this medium supports; declaring an unsupported one throws. */
  features: ReadonlySet<FeatureKey>
}

const EMPTY_STATE = (features: ReadonlySet<FeatureKey>): BuilderState => ({
  narration: null,
  values: null,
  overlays: null,
  audio: null,
  recordOptions: null,
  renderOptions: null,
  recordingLocalize: null,
  eachVariants: null,
  features,
})

/** The full set of feature fixtures for videos. */
export const VIDEO_FEATURES: ReadonlySet<FeatureKey> = new Set([
  'narration',
  'values',
  'overlays',
  'audio',
])
/** Stills are silent: only values + overlays. */
export const SCREENSHOT_FEATURES: ReadonlySet<FeatureKey> = new Set([
  'values',
  'overlays',
])

/**
 * Create a fan-out builder bound to a registrar test instance. `Args` is the
 * medium's fixture arg type (video/screenshot); `features` selects which
 * per-feature methods are valid for the medium.
 */
export function createVideoBuilder<Args>(
  test: RegistrarTest,
  features: ReadonlySet<FeatureKey> = VIDEO_FEATURES,
  state: BuilderState = EMPTY_STATE(features)
): MediaBuilder<Args> {
  const runTerminal = (
    modifier: TestModifier | undefined,
    title: string,
    detailsOrBody: TestDetails | BodyFn<Args>,
    maybeBody?: BodyFn<Args>
  ): void => {
    const hasDetails = typeof detailsOrBody !== 'function'
    const details = hasDetails ? (detailsOrBody as TestDetails) : undefined
    const body = (hasDetails ? maybeBody : detailsOrBody) as unknown

    const sourceFile = captureSourceFile()

    const registrations = expandRegistrations({
      baseTitle: title,
      state,
      requestedLanguages: parseRequestedLanguages(),
    })

    if (registrations.length === 0) {
      logger.warn(
        `[screenci] "${title}" was skipped: none of its declared languages match the --languages filter.`
      )
      return
    }

    for (const reg of registrations) {
      registerOne(test, reg, details, body, modifier, sourceFile)
    }
  }

  const callable = ((
    title: string,
    detailsOrBody: TestDetails | BodyFn<Args>,
    maybeBody?: BodyFn<Args>
  ): void =>
    runTerminal(
      undefined,
      title,
      detailsOrBody,
      maybeBody
    )) as MediaBuilder<Args>

  for (const modifier of ['only', 'skip', 'fixme', 'fail'] as const) {
    callable[modifier] = ((
      title: string,
      detailsOrBody: TestDetails | BodyFn<Args>,
      maybeBody?: BodyFn<Args>
    ): void =>
      runTerminal(
        modifier,
        title,
        detailsOrBody,
        maybeBody
      )) as MediaBuilder<Args>[typeof modifier]
  }

  const withFeature = (
    key: FeatureKey,
    arg: FeatureArg<unknown>
  ): MediaBuilder<Args> => {
    if (!features.has(key)) {
      throw new Error(
        `[screenci] ${key}() is not available for this medium (a screenshot is silent: only values and overlays apply).`
      )
    }
    return createVideoBuilder<Args>(test, features, {
      ...state,
      [key]: normalizeFeature(key, arg),
    })
  }

  callable.narration = ((arg: FeatureArg<LocalizeNarrationValue>) =>
    withFeature('narration', arg)) as MediaBuilder<Args>['narration']
  callable.overlays = ((arg: FeatureArg<OverlayInputOrFactory>) =>
    withFeature('overlays', arg)) as MediaBuilder<Args>['overlays']
  // values() and audio() are hidden from the public type for release but stay
  // attached at runtime (see HiddenFeatureMethods).
  const hiddenCallable = callable as unknown as HiddenFeatureMethods<Args>
  hiddenCallable.values = ((arg: FeatureArg<string>) =>
    withFeature('values', arg)) as HiddenFeatureMethods<Args>['values']
  hiddenCallable.audio = ((arg: FeatureArg<AudioInput>) =>
    withFeature('audio', arg)) as HiddenFeatureMethods<Args>['audio']

  callable.recordOptions = ((arg: OptionsArg<RecordOptions>) =>
    createVideoBuilder<Args>(test, features, {
      ...state,
      recordOptions: normalizeOptionsArg('recordOptions', arg),
    })) as MediaBuilder<Args>['recordOptions']
  callable.renderOptions = ((arg: OptionsArg<RenderOptions>) =>
    createVideoBuilder<Args>(test, features, {
      ...state,
      renderOptions: normalizeOptionsArg('renderOptions', arg),
    })) as MediaBuilder<Args>['renderOptions']

  callable.languages = ((arg?: LanguagesArg) =>
    createVideoBuilder<Args>(test, features, {
      ...state,
      recordingLocalize: normalizeLanguagesArg(arg),
    })) as MediaBuilder<Args>['languages']

  callable.each = (variants) =>
    createVideoBuilder<Args>(test, features, {
      ...state,
      eachVariants: normalizeVariants(variants),
    })

  return callable
}

export type { VoiceConfig }
