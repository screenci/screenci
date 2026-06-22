import type { TestDetails } from '@playwright/test'
import type { Lang } from './voices.js'
import type { RecordOptions } from './types.js'
import { resolveLocaleForLanguage } from './locales.js'
import { parseRequestedLanguages } from './runtimeMode.js'
import { logger } from './logger.js'

/**
 * How a video's declared languages are recorded.
 *
 * - `'per-language'` (default): one capture pass per language, with the browser
 *   `locale` set from the language so a self-localizing app renders in that
 *   language. Each pass becomes its own language version. The body receives the
 *   active `language` so it can navigate per language.
 * - `'shared'`: a single capture shared across every language, with narration
 *   overdubbed per language at render time (the original behavior). The body's
 *   `language` fixture is `undefined`.
 */
export type LanguageMode = 'per-language' | 'shared'

export type LanguagesOptions = {
  /** Recording mode. Defaults to `'per-language'`. */
  mode?: LanguageMode
  /**
   * Override the browser locale used for one or more languages. Defaults come
   * from the built-in language to locale map; anything not listed falls back to
   * the bare language code.
   */
  locales?: Partial<Record<Lang, string>>
}

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

export type LanguageSpec = {
  languages: string[]
  mode: LanguageMode
  locales?: Partial<Record<Lang, string>>
}

/** A single Playwright test to register, fully resolved from the fan-out specs. */
export type Registration = {
  /** Label for the wrapping `describe` block (scopes per-test `use` options). */
  describeTitle: string
  /** Unique Playwright test title (drives the per-pass `.screenci/<dir>`). */
  leafTitle: string
  /** Grouping key written to `metadata.videoName`; shared across a video's languages. */
  videoName: string
  /** Active language for this pass, or `null` in shared / no-language mode. */
  language: string | null
  /** Browser locale for this pass, or `null` to leave the default. */
  locale: string | null
  /** Recording options patch for this pass, or `null` for none. */
  recordOptions: Partial<RecordOptions> | null
  /** Forwarded Playwright `use` options for this pass, or `null` for none. */
  use: Record<string, unknown> | null
  /** The video's full declared language set (for narration validation); `[]` when none. */
  declaredLanguages: string[]
}

function variantVideoName(
  baseTitle: string,
  variant: EachVariant | null
): string {
  return variant === null ? baseTitle : `${baseTitle} ${variant.key}`
}

/**
 * Expand the language / each fan-out specs into the concrete list of Playwright
 * tests to register. Pure and exported for testing.
 *
 * - With no `languageSpec`, each variant yields a single language-agnostic test.
 * - In `'shared'` mode, each variant yields one test that carries every language
 *   (narration is overdubbed at render); the `--languages` filter does not split
 *   a shared recording.
 * - In `'per-language'` mode, each variant yields one test per declared language,
 *   intersected with the `--languages` filter when present. A variant whose
 *   declared languages are entirely filtered out yields nothing.
 */
export function expandRegistrations(params: {
  baseTitle: string
  languageSpec: LanguageSpec | null
  eachVariants: EachVariant[] | null
  requestedLanguages: string[] | null
}): Registration[] {
  const { baseTitle, languageSpec, eachVariants, requestedLanguages } = params
  const variants: (EachVariant | null)[] = eachVariants ?? [null]
  const registrations: Registration[] = []

  for (const variant of variants) {
    const videoName = variantVideoName(baseTitle, variant)
    const recordOptions = variant?.recordOptions ?? null
    const use = variant?.use ?? null
    const variantLabel = variant === null ? '' : `${variant.key} `

    if (languageSpec === null) {
      registrations.push({
        describeTitle: variant?.key ?? baseTitle,
        leafTitle: videoName,
        videoName,
        language: null,
        locale: null,
        recordOptions,
        use,
        declaredLanguages: [],
      })
      continue
    }

    if (languageSpec.mode === 'shared') {
      registrations.push({
        describeTitle: `${variantLabel}shared`.trim(),
        leafTitle: videoName,
        videoName,
        language: null,
        locale: null,
        recordOptions,
        use,
        declaredLanguages: languageSpec.languages,
      })
      continue
    }

    const languages =
      requestedLanguages === null
        ? languageSpec.languages
        : languageSpec.languages.filter((lang) =>
            requestedLanguages.includes(lang)
          )

    for (const lang of languages) {
      registrations.push({
        describeTitle: `${variantLabel}${lang}`,
        leafTitle: `${videoName} [${lang}]`,
        videoName,
        language: lang,
        locale: resolveLocaleForLanguage(lang as Lang, languageSpec.locales),
        recordOptions,
        use,
        declaredLanguages: languageSpec.languages,
      })
    }
  }

  return registrations
}

/** Internal option keys the page/context fixtures read off a registered test. */
const SCREENCI_LANGUAGE_OPTION = '_screenciLanguage'
const SCREENCI_VIDEO_NAME_OPTION = '_screenciVideoName'
const SCREENCI_LANGUAGES_OPTION = '_screenciLanguages'

/** Minimal view of the test API the builder needs to register tests. */
type RegistrarTest = {
  (title: string, body: unknown): void
  (title: string, details: TestDetails, body: unknown): void
  describe: (title: string, fn: () => void) => void
  use: (options: Record<string, unknown>) => void
}

function registerOne(
  test: RegistrarTest,
  reg: Registration,
  details: TestDetails | undefined,
  body: unknown
): void {
  const useOptions: Record<string, unknown> = {
    ...(reg.use ?? {}),
    ...(reg.recordOptions !== null ? { recordOptions: reg.recordOptions } : {}),
    ...(reg.locale !== null ? { locale: reg.locale } : {}),
    [SCREENCI_LANGUAGE_OPTION]: reg.language ?? undefined,
    [SCREENCI_VIDEO_NAME_OPTION]: reg.videoName,
    [SCREENCI_LANGUAGES_OPTION]: reg.declaredLanguages,
  }

  test.describe(reg.describeTitle, () => {
    test.use(useOptions)
    if (details !== undefined) {
      test(reg.leafTitle, details, body)
    } else {
      test(reg.leafTitle, body)
    }
  })
}

/**
 * A chainable fan-out builder. Callable to register the test(s), and exposes
 * `.languages()` / `.each()` to refine the fan-out before the terminal call.
 */
export interface VideoBuilder<Body> {
  (title: string, body: Body): void
  (title: string, details: TestDetails, body: Body): void
  /** Record one language version per declared language (or one shared capture). */
  languages(languages: string[], options?: LanguagesOptions): VideoBuilder<Body>
  /** Produce a separate video per variant (viewport, theme, ...). */
  each(variants: EachVariant[], options?: undefined): VideoBuilder<Body>
}

function normalizeLanguageSpec(
  languages: string[],
  options: LanguagesOptions | undefined
): LanguageSpec {
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const lang of languages) {
    if (seen.has(lang)) continue
    seen.add(lang)
    deduped.push(lang)
  }
  if (deduped.length === 0) {
    throw new Error(
      'video.languages() requires at least one language, e.g. .languages(["en", "fi"]).'
    )
  }
  return {
    languages: deduped,
    mode: options?.mode ?? 'per-language',
    ...(options?.locales !== undefined && { locales: options.locales }),
  }
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
  languageSpec: LanguageSpec | null
  eachVariants: EachVariant[] | null
}

/**
 * Create a fan-out builder bound to a registrar test instance. `video.languages`
 * and `video.each` are the `languages`/`each` methods of a root builder created
 * with this factory.
 */
export function createVideoBuilder<Body>(
  test: RegistrarTest,
  state: BuilderState = { languageSpec: null, eachVariants: null }
): VideoBuilder<Body> {
  const callable = ((
    title: string,
    detailsOrBody: TestDetails | Body,
    maybeBody?: Body
  ): void => {
    const hasDetails = typeof detailsOrBody !== 'function'
    const details = hasDetails ? (detailsOrBody as TestDetails) : undefined
    const body = (hasDetails ? maybeBody : detailsOrBody) as unknown

    const registrations = expandRegistrations({
      baseTitle: title,
      languageSpec: state.languageSpec,
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
      registerOne(test, reg, details, body)
    }
  }) as VideoBuilder<Body>

  callable.languages = (languages, options) =>
    createVideoBuilder<Body>(test, {
      ...state,
      languageSpec: normalizeLanguageSpec(languages, options),
    })

  callable.each = (variants) =>
    createVideoBuilder<Body>(test, {
      ...state,
      eachVariants: normalizeVariants(variants),
    })

  return callable
}
