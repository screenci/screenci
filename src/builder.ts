import { fileURLToPath } from 'node:url'
import type { TestDetails, TestInfo } from '@playwright/test'
import type { RecordOptions } from './types.js'
import type { NarrationCue } from './cue.js'
import type { NarrationMarkers, TextValues } from './localizeRuntime.js'
import { resolveLocaleForLanguage } from './locales.js'
import { parseRequestedLanguages } from './runtimeMode.js'
import { logger } from './logger.js'
import {
  normalizeLocalizeSpec,
  type LocalizeSpec,
  type LocalizeNarrationValue,
  type NormalizedLocalize,
} from './localize.js'

/**
 * One variant in a generic `video.each(...)` fan-out. Each variant produces a
 * separate video (its own identity and stored history), differing only in its
 * recording options and/or forwarded Playwright `use` options (e.g. a viewport
 * via `recordOptions.aspectRatio`, or a theme via `use.colorScheme`).
 */
export type EachVariant = {
  /** Stable label appended to the video name, e.g. `'mobile'` or `'dark'`. */
  key: string
  /** Recording options for this variant (merged over the video's defaults). */
  recordOptions?: Partial<RecordOptions>
  /** Forwarded Playwright `use` options for this variant, e.g. `{ colorScheme: 'dark' }`. */
  use?: Record<string, unknown>
}

/** A single Playwright test to register, fully resolved from the fan-out specs. */
export type Registration = {
  /** Label for the wrapping `describe` block (scopes per-test `use` options). */
  describeTitle: string
  /** Unique Playwright test title (drives the per-pass `.screenci/<dir>`). */
  leafTitle: string
  /** Grouping key written to `metadata.videoName`; shared across a video's languages. */
  videoName: string
  /** Active language for this pass, or `null` in shared / no-localize mode. */
  language: string | null
  /** Browser locale for this pass, or `null` to leave the default. */
  locale: string | null
  /** Recording options patch for this pass, or `null` for none. */
  recordOptions: Partial<RecordOptions> | null
  /** Forwarded Playwright `use` options for this pass, or `null` for none. */
  use: Record<string, unknown> | null
  /** The normalized localize spec for this video, or `null` when not localized. */
  localize: NormalizedLocalize | null
}

function variantVideoName(
  baseTitle: string,
  variant: EachVariant | null
): string {
  return variant === null ? baseTitle : `${baseTitle} ${variant.key}`
}

/**
 * Expand the localize / each fan-out specs into the concrete list of Playwright
 * tests to register. Pure and exported for testing.
 *
 * - With no `localize`, each variant yields a single language-agnostic test.
 * - In `'shared'` mode, each variant yields one test that carries every language
 *   (narration is overdubbed at render); the `--languages` filter does not split
 *   a shared recording.
 * - In `'per-language'` mode, each variant yields one test per language,
 *   intersected with the `--languages` filter when present. A variant whose
 *   languages are entirely filtered out yields nothing. The browser locale is set
 *   per language unless `browserLocale` is `false`.
 */
export function expandRegistrations(params: {
  baseTitle: string
  localize: NormalizedLocalize | null
  eachVariants: EachVariant[] | null
  requestedLanguages: string[] | null
}): Registration[] {
  const { baseTitle, localize, eachVariants, requestedLanguages } = params
  const variants: (EachVariant | null)[] = eachVariants ?? [null]
  const registrations: Registration[] = []

  for (const variant of variants) {
    const videoName = variantVideoName(baseTitle, variant)
    const recordOptions = variant?.recordOptions ?? null
    const use = variant?.use ?? null
    const variantLabel = variant === null ? '' : `${variant.key} `

    if (localize === null) {
      registrations.push({
        describeTitle: variant?.key ?? baseTitle,
        leafTitle: videoName,
        videoName,
        language: null,
        locale: null,
        recordOptions,
        use,
        localize: null,
      })
      continue
    }

    if (localize.mode === 'shared') {
      registrations.push({
        describeTitle: `${variantLabel}shared`.trim(),
        leafTitle: videoName,
        videoName,
        language: null,
        locale: null,
        recordOptions,
        use,
        localize,
      })
      continue
    }

    const languages =
      requestedLanguages === null
        ? localize.languages
        : localize.languages.filter((lang) => requestedLanguages.includes(lang))

    for (const lang of languages) {
      registrations.push({
        describeTitle: `${variantLabel}${lang}`,
        leafTitle: `${videoName} [${lang}]`,
        videoName,
        language: lang,
        locale: localize.browserLocale
          ? resolveLocaleForLanguage(lang, localize.locales)
          : null,
        recordOptions,
        use,
        localize,
      })
    }
  }

  return registrations
}

/** Internal option keys the page/context fixtures read off a registered test. */
const SCREENCI_LANGUAGE_OPTION = '_screenciLanguage'
const SCREENCI_VIDEO_NAME_OPTION = '_screenciVideoName'
const SCREENCI_LOCALIZE_OPTION = '_screenciLocalize'
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
 * builder. Playwright attributes `testInfo.file` to this module (the test is
 * registered here, not in the user's file), so asset paths authored relative to
 * the script would otherwise resolve against this package. We walk the call
 * stack and return the first frame outside this module, which is the script.
 * Returns `null` if no such frame is found (fixtures then fall back to
 * `testInfo.file`).
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
    [SCREENCI_LOCALIZE_OPTION]: reg.localize ?? undefined,
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
 * Union of every inner key across all languages of a seeded map `M` (e.g. the
 * cue names of `{ en: { intro, save }, fi: { intro, save } }`). Uses each
 * language's key set before intersecting, so each language must cover the union
 * (the identical-keys guarantee, enforced via {@link EnforceIdenticalKeys}).
 */
type SeededKeys<M> = [M] extends [object]
  ? Extract<
      keyof UnionToIntersection<
        {
          [L in keyof M]-?: NonNullable<M[L]> extends Record<string, unknown>
            ? Record<keyof NonNullable<M[L]> & string, unknown>
            : never
        }[keyof M]
      >,
      string
    >
  : never

/** Studio-managed names from a `studio.{narration,text}` list. */
type StudioNamesOf<N> = N extends readonly string[] ? N[number] : never

/** Cue names: seeded `narration` keys union the `studio.narration` names. */
type CueNamesOf<S> =
  | (S extends { narration: infer M } ? SeededKeys<M> : never)
  | (S extends { studio: { narration: infer N } } ? StudioNamesOf<N> : never)

/** Field names: seeded `text` keys union the `studio.text` names. */
type FieldNamesOf<S> =
  | (S extends { text: infer T } ? SeededKeys<T> : never)
  | (S extends { studio: { text: infer N } } ? StudioNamesOf<N> : never)

/**
 * Constrains a seeded map so every language declares the same key set: each
 * language is required to provide every key that appears in any language. A
 * missing key fails to compile; an unrelated extra key is not part of the union,
 * so it is rejected as excess.
 */
type EnforceIdenticalKeys<M, Value> = {
  [L in keyof M]: Record<SeededKeys<M>, Value>
}

/**
 * Refines a localize spec so its `narration`/`text` maps have identical keys
 * across languages. Intersected with the inferred spec `S` at the `.localize`
 * call site so a dropped per-language key is a compile error.
 */
type ValidateLocalizeSpec<S> = (S extends { narration: infer M }
  ? { narration: EnforceIdenticalKeys<M, LocalizeNarrationValue> }
  : object) &
  (S extends { text: infer T }
    ? { text: EnforceIdenticalKeys<T, string> }
    : object)

type NarrationOverrideFor<S> = [CueNamesOf<S>] extends [never]
  ? NarrationMarkers
  : Record<CueNamesOf<S>, NarrationCue>

type TextOverrideFor<S> = [FieldNamesOf<S>] extends [never]
  ? TextValues
  : Record<FieldNamesOf<S>, string | undefined>

/**
 * The fixture arg overrides a `localize(spec)` contributes: `narration` typed to
 * the spec's cue names (only when the medium has narration) and `text` typed to
 * its field names. Keys absent from `Args` (e.g. `narration` on a screenshot)
 * are not added.
 */
type LocalizeOverrides<Args, S> = ('narration' extends keyof Args
  ? { narration: NarrationOverrideFor<S> }
  : object) &
  ('text' extends keyof Args ? { text: TextOverrideFor<S> } : object)

type MergeArgs<Args, O> = Omit<Args, keyof O> & O

type BodyFn<Args> = (args: Args, testInfo: TestInfo) => void | Promise<void>

/**
 * A chainable fan-out builder. Callable to register the test(s), and exposes
 * `.localize()` / `.each()` to refine the fan-out before the terminal call. `O`
 * accumulates the typed fixture overrides from `.localize(...)` so the body sees
 * `narration`/`text` typed to the spec's names.
 */
type BuilderTerminal<Args, O> = {
  (title: string, body: BodyFn<MergeArgs<Args, O>>): void
  (title: string, details: TestDetails, body: BodyFn<MergeArgs<Args, O>>): void
}

export interface VideoBuilder<Args, O = object> extends BuilderTerminal<
  Args,
  O
> {
  /** Record one localized pass per language (or one shared capture). */
  localize<const S extends LocalizeSpec>(
    spec: S & ValidateLocalizeSpec<S>
  ): VideoBuilder<Args, O & LocalizeOverrides<Args, S>>
  /** Produce a separate video per variant (viewport, theme, ...). */
  each(variants: EachVariant[]): VideoBuilder<Args, O>
  /** Register the localized test(s) with `test.only`. */
  only: BuilderTerminal<Args, O>
  /** Register the localized test(s) with `test.skip`. */
  skip: BuilderTerminal<Args, O>
  /** Register the localized test(s) with `test.fixme`. */
  fixme: BuilderTerminal<Args, O>
  /** Register the localized test(s) with `test.fail`. */
  fail: BuilderTerminal<Args, O>
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

type BuilderState = {
  localize: NormalizedLocalize | null
  eachVariants: EachVariant[] | null
}

/**
 * Create a fan-out builder bound to a registrar test instance. `video.localize`
 * and `video.each` are the `localize`/`each` methods of a root builder created
 * with this factory. `Args` is the medium's fixture arg type (video/screenshot).
 */
export function createVideoBuilder<Args>(
  test: RegistrarTest,
  state: BuilderState = { localize: null, eachVariants: null }
): VideoBuilder<Args> {
  const runTerminal = (
    modifier: TestModifier | undefined,
    title: string,
    detailsOrBody: TestDetails | BodyFn<Args>,
    maybeBody?: BodyFn<Args>
  ): void => {
    const hasDetails = typeof detailsOrBody !== 'function'
    const details = hasDetails ? (detailsOrBody as TestDetails) : undefined
    const body = (hasDetails ? maybeBody : detailsOrBody) as unknown

    // Captured here, at the user's call site, so the script's path survives
    // even though Playwright records the test as declared in this module.
    const sourceFile = captureSourceFile()

    const registrations = expandRegistrations({
      baseTitle: title,
      localize: state.localize,
      eachVariants: state.eachVariants,
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
    )) as VideoBuilder<Args>

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
      )) as VideoBuilder<Args>[typeof modifier]
  }

  callable.localize = ((spec: LocalizeSpec) =>
    createVideoBuilder<Args>(test, {
      ...state,
      localize: normalizeLocalizeSpec(spec),
    })) as VideoBuilder<Args>['localize']

  callable.each = (variants) =>
    createVideoBuilder<Args>(test, {
      ...state,
      eachVariants: normalizeVariants(variants),
    })

  return callable
}
