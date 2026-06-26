import { fileURLToPath } from 'node:url'
import type { TestDetails, TestInfo } from '@playwright/test'
import type { RecordOptions } from './types.js'
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
 * `languages` may be `'studio'`, meaning the set is owned by the ScreenCI web app
 * and injected at record time through the same channel as `--languages`. When the
 * web has selected none yet, the set is empty and the render stays pending (the
 * recording still runs so its declared schema reaches the backend to be filled).
 */
export type RecordingLocalize = {
  languages: readonly Lang[] | 'studio'
  mode?: LocalizeMode
  locales?: Partial<Record<Lang, string>>
  browserLocale?: boolean
}

/** The argument accepted by `video.languages(...)`. */
export type LanguagesArg = 'studio' | readonly Lang[] | RecordingLocalize

function normalizeLanguagesArg(arg: LanguagesArg): RecordingLocalize {
  if (arg === 'studio') return { languages: 'studio' }
  if (Array.isArray(arg)) return { languages: arg as readonly Lang[] }
  return arg as RecordingLocalize
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
  /** Recording options patch for this pass, or `null` for none. */
  recordOptions: Partial<RecordOptions> | null
  /** Forwarded Playwright `use` options for this pass, or `null` for none. */
  use: Record<string, unknown> | null
  /** Per-feature declarations carried into the fixtures. */
  narration: NormalizedFeature<LocalizeNarrationValue> | null
  text: NormalizedFeature<string> | null
  overlays: NormalizedFeature<OverlayInputOrFactory> | null
  audio: NormalizedFeature<AudioInput> | null
  /** Resolved recording-level localize config (languages/mode/locales). */
  recordingLocalize: ResolvedRecordingLocalize
}

/** The recording-level localize config after registration-time resolution. */
export type ResolvedRecordingLocalize = {
  /** Every language this video records (the resolved set). */
  languages: string[]
  mode: LocalizeMode
  browserLocale: boolean
  locales?: Partial<Record<Lang, string>>
  /** Whether the set is owned by the web app (`video.languages('studio')`). */
  studioOwned: boolean
  /** Studio-owned set with nothing selected yet: record for metadata, do not render. */
  pending: boolean
  /**
   * Whether the languages were explicitly declared (via `video.languages(...)`,
   * `'studio'`, or per-feature keys) rather than the implicit `['en']` default. A
   * plain video with no language info stays language-agnostic (no `[lang]` tag).
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
    state.text,
    state.overlays,
    state.audio,
  ]) {
    for (const lang of feature?.languages ?? []) set.add(lang)
  }
  return [...set]
}

/**
 * Resolve the recorded language set at registration time. Priority:
 * 1. `video.languages('studio')` -> the web-owned set, injected via the
 *    `--languages` channel (`requestedLanguages`); empty => pending.
 * 2. explicit `video.languages([...])`.
 * 3. union of per-feature language keys (e.g. `narration({ fr })` -> French).
 * 4. default `['en']`.
 * The `requestedLanguages` filter (CLI / studio injection) intersects 2-4.
 */
export function resolveRecordingLocalize(
  state: BuilderState,
  requestedLanguages: string[] | null
): ResolvedRecordingLocalize {
  const rl = state.recordingLocalize
  const mode: LocalizeMode = rl?.mode ?? 'per-language'
  const browserLocale = rl?.browserLocale ?? true
  const localesPatch = rl?.locales !== undefined ? { locales: rl.locales } : {}

  if (rl?.languages === 'studio') {
    const languages = requestedLanguages ?? []
    return {
      languages,
      mode,
      browserLocale,
      ...localesPatch,
      studioOwned: true,
      pending: languages.length === 0,
      explicit: true,
    }
  }

  let declared: string[]
  let explicit: boolean
  if (rl !== null && rl !== undefined && Array.isArray(rl.languages)) {
    declared = [...rl.languages]
    explicit = true
  } else {
    const inferred = featureLanguages(state)
    if (inferred.length > 0) {
      declared = inferred
      explicit = true
    } else {
      declared = ['en']
      explicit = false
    }
  }
  const languages =
    requestedLanguages === null
      ? declared
      : declared.filter((lang) => requestedLanguages.includes(lang))
  return {
    languages,
    mode,
    browserLocale,
    ...localesPatch,
    studioOwned: false,
    pending: false,
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
  const source = resolved.studioOwned ? 'web' : 'video.languages()'
  const langList = resolved.languages.join(', ') || '(none)'
  const features: [string, NormalizedFeature<unknown> | null][] = [
    ['Narration', state.narration],
    ['Text', state.text],
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
 * - A studio-owned set with nothing selected yet yields one pending test that
 *   records (so its schema reaches the backend) but renders nothing.
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
    const recordOptions = variant?.recordOptions ?? null
    const use = variant?.use ?? null
    const variantLabel = variant === null ? '' : `${variant.key} `
    const resolved = resolveRecordingLocalize(state, params.requestedLanguages)
    warnUnusedLanguages(state, resolved)

    // Explicitly-declared languages all filtered out (`--languages`) and not a
    // pending studio set: register nothing for this variant.
    if (
      resolved.explicit &&
      !resolved.studioOwned &&
      resolved.languages.length === 0
    ) {
      continue
    }

    const base = {
      videoName,
      recordOptions,
      use,
      narration: state.narration,
      text: state.text,
      overlays: state.overlays,
      audio: state.audio,
      recordingLocalize: resolved,
    }

    // Pending studio set, shared mode, or a single language-agnostic pass: one
    // registration that carries every (or no) language without splitting.
    const singlePass =
      resolved.pending ||
      resolved.mode === 'shared' ||
      resolved.languages.length <= 1

    if (singlePass) {
      // A single explicitly-declared language is tagged `[lang]`; the implicit
      // `['en']` default (a plain video) stays language-agnostic.
      const onlyLang =
        resolved.explicit &&
        resolved.mode === 'per-language' &&
        resolved.languages.length === 1
          ? resolved.languages[0]!
          : null
      const describeTitle = onlyLang
        ? `${variantLabel}${onlyLang}`.trim()
        : resolved.mode === 'shared' || resolved.pending
          ? `${variantLabel}shared`.trim()
          : (variant?.key ?? baseTitle)
      registrations.push({
        ...base,
        describeTitle,
        leafTitle: onlyLang ? `${videoName} [${onlyLang}]` : videoName,
        language: onlyLang,
        locale:
          onlyLang && resolved.browserLocale
            ? resolveLocaleForLanguage(onlyLang, resolved.locales)
            : null,
      })
      continue
    }

    for (const lang of resolved.languages) {
      registrations.push({
        ...base,
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
const SCREENCI_TEXT_OPTION = '_screenciText'
const SCREENCI_OVERLAYS_OPTION = '_screenciOverlays'
const SCREENCI_AUDIO_OPTION = '_screenciAudio'
const SCREENCI_RECORDING_LOCALIZE_OPTION = '_screenciRecordingLocalize'
const SCREENCI_SOURCE_FILE_OPTION = '_screenciSourceFile'

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
    ...(reg.recordOptions !== null ? { recordOptions: reg.recordOptions } : {}),
    ...(reg.locale !== null ? { locale: reg.locale } : {}),
    [SCREENCI_LANGUAGE_OPTION]: reg.language ?? undefined,
    [SCREENCI_VIDEO_NAME_OPTION]: reg.videoName,
    [SCREENCI_NARRATION_OPTION]: reg.narration ?? undefined,
    [SCREENCI_TEXT_OPTION]: reg.text ?? undefined,
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
 * The content names declared by a {@link FeatureArg}. Array elements for the
 * studio form; for objects, the union of content-major top-level keys (those that
 * are not language codes or `default`) and the language-major inner keys.
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

/** The overlay controller type for a single declared name. */
type OverlayControllerForName<A, K extends string> = A extends readonly string[]
  ? OverlayController
  : K extends keyof A
    ? OverlayControllerFor<A[K]>
    : OverlayController

type NarrationOverrideFor<Args, A> = 'narration' extends keyof Args
  ? [FeatureNamesOf<A>] extends [never]
    ? object
    : { narration: Record<FeatureNamesOf<A>, NarrationCue> }
  : object

type TextOverrideFor<Args, A> = 'text' extends keyof Args
  ? [FeatureNamesOf<A>] extends [never]
    ? object
    : { text: Record<FeatureNamesOf<A>, string> }
  : object

type OverlayOverrideFor<Args, A> = 'overlays' extends keyof Args
  ? [FeatureNamesOf<A>] extends [never]
    ? object
    : {
        overlays: {
          [K in FeatureNamesOf<A>]: OverlayControllerForName<A, K>
        }
      }
  : object

type AudioOverrideFor<Args, A> = 'audio' extends keyof Args
  ? [FeatureNamesOf<A>] extends [never]
    ? object
    : { audio: Record<FeatureNamesOf<A>, AudioController> }
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
 * `narration`/`text`/`overlays`/`audio` typed to the declared names.
 */
type BuilderTerminal<Args, O> = {
  (title: string, body: BodyFn<MergeArgs<Args, O>>): void
  (title: string, details: TestDetails, body: BodyFn<MergeArgs<Args, O>>): void
}

/** The fixture keys a medium supports (videos: all; screenshots: text+overlays). */
export type FeatureKey = 'narration' | 'text' | 'overlays' | 'audio'

export interface MediaBuilder<Args, O = object> extends BuilderTerminal<
  Args,
  O
> {
  /** Declare narration cues: Studio-owned (array) or code values (object). */
  narration<const A extends FeatureArg<LocalizeNarrationValue>>(
    arg: A
  ): MediaBuilder<Args, O & NarrationOverrideFor<Args, A>>
  /** Declare on-screen text fields. */
  text<const A extends FeatureArg<string>>(
    arg: A
  ): MediaBuilder<Args, O & TextOverrideFor<Args, A>>
  /** Declare overlays. */
  overlays<const A extends FeatureArg<OverlayInputOrFactory>>(
    arg: A
  ): MediaBuilder<Args, O & OverlayOverrideFor<Args, A>>
  /** Declare background-audio tracks. */
  audio<const A extends FeatureArg<AudioInput>>(
    arg: A
  ): MediaBuilder<Args, O & AudioOverrideFor<Args, A>>
  /** Declare the recorded language set / capture mode. */
  languages(arg: LanguagesArg): MediaBuilder<Args, O>
  /** Produce a separate video per variant (viewport, theme, ...). */
  each(variants: EachVariant[]): MediaBuilder<Args, O>
  only: BuilderTerminal<Args, O>
  skip: BuilderTerminal<Args, O>
  fixme: BuilderTerminal<Args, O>
  fail: BuilderTerminal<Args, O>
}

/** Backwards-compatible alias used by the video/screenshot entry points. */
export type VideoBuilder<Args, O = object> = MediaBuilder<Args, O>

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
  text: NormalizedFeature<string> | null
  overlays: NormalizedFeature<OverlayInputOrFactory> | null
  audio: NormalizedFeature<AudioInput> | null
  recordingLocalize: RecordingLocalize | null
  eachVariants: EachVariant[] | null
  /** Fixtures this medium supports; declaring an unsupported one throws. */
  features: ReadonlySet<FeatureKey>
}

const EMPTY_STATE = (features: ReadonlySet<FeatureKey>): BuilderState => ({
  narration: null,
  text: null,
  overlays: null,
  audio: null,
  recordingLocalize: null,
  eachVariants: null,
  features,
})

/** The full set of feature fixtures for videos. */
export const VIDEO_FEATURES: ReadonlySet<FeatureKey> = new Set([
  'narration',
  'text',
  'overlays',
  'audio',
])
/** Stills are silent: only text + overlays. */
export const SCREENSHOT_FEATURES: ReadonlySet<FeatureKey> = new Set([
  'text',
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
        `[screenci] ${key}() is not available for this medium (a screenshot is silent: only text and overlays apply).`
      )
    }
    return createVideoBuilder<Args>(test, features, {
      ...state,
      [key]: normalizeFeature(key, arg),
    })
  }

  callable.narration = ((arg: FeatureArg<LocalizeNarrationValue>) =>
    withFeature('narration', arg)) as MediaBuilder<Args>['narration']
  callable.text = ((arg: FeatureArg<string>) =>
    withFeature('text', arg)) as MediaBuilder<Args>['text']
  callable.overlays = ((arg: FeatureArg<OverlayInputOrFactory>) =>
    withFeature('overlays', arg)) as MediaBuilder<Args>['overlays']
  callable.audio = ((arg: FeatureArg<AudioInput>) =>
    withFeature('audio', arg)) as MediaBuilder<Args>['audio']

  callable.languages = ((arg: LanguagesArg) =>
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
