import { test as base } from '@playwright/test'
import type {
  TestType,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestDetails,
  TestInfo,
} from '@playwright/test'
import { mkdir, rm } from 'fs/promises'
import { join, relative } from 'path'
import type { RecordOptions, RenderOptions, ScreenCIPage } from './types.js'
import {
  buildOverlays,
  type OverlayController,
  type OverlayInputOrFactory,
} from './asset.js'
import { getDimensions } from './dimensions.js'
import {
  DEFAULT_VIDEO_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_QUALITY,
  DEFAULT_SCREENSHOT_DEVICE_SCALE_FACTOR,
} from './defaults.js'
import { EventRecorder } from './events.js'
import type { ScreenshotInfo } from './events.js'
import { instrumentBrowser, instrumentContext } from './instrument.js'
import { getChromiumLaunchOptions } from './browserLaunchOptions.js'
import { createScreenCIRuntimeContext } from './runtimeContext.js'
import { escapeFileSystemPathSegment } from './fileSystemName.js'
import {
  buildScreenCIContextOptions,
  resolveDeviceScaleFactor,
} from './contextOptions.js'
import { resolveClip } from './clip.js'
import type { ClipTarget, ClipOptions } from './clip.js'
import {
  installAnimationDisabling,
  resolveDisableAnimations,
} from './disableAnimations.js'
import { getMousePosition } from './mouse.js'
import { getRuntimePage, setRuntimeCrop } from './runtimeContext.js'
import { ScreenciError } from './errors.js'
import {
  withActiveRecordingContext,
  resolveEffectiveRecordOptions,
  resolveStudioRecordOptions,
  resolveStudioRenderOptions,
} from './video.js'
import {
  createVideoBuilder,
  SCREENSHOT_FEATURES,
  type MediaBuilder,
} from './builder.js'
import type { NormalizedFeature } from './declare.js'
import {
  buildValuesDeclaration,
  buildValues,
  type Values,
} from './localizeRuntime.js'
import { parseActionOverrides, parseValuesOverrides } from './runtimeMode.js'
import { ActionParamCollector } from './actionParams.js'
import {
  combineRecordOptionsLayers,
  combineRenderOptionsLayers,
} from './optionsDeclare.js'

/**
 * The `crop` fixture argument. Call it inside a `screenshot()` body to clip the
 * implicit end-of-body capture to a locator or pixel region. Replaces the
 * old module-level `crop()` function; the clip is recorded per test.
 */
export type CropFixture = (
  target: ClipTarget,
  options?: ClipOptions
) => Promise<void>

/** File name of the raw page capture written beside `data.json`. */
const SCREENSHOT_FILE_NAME = 'screenshot.png'

type ScreenshotFixtureOptions = {
  /** Config-level record options (`use.recordOptions`), remapped by `defineConfig`. Internal. */
  _screenciConfigRecordOptions: RecordOptions
  /** Config-level render options (`use.renderOptions`). Internal. */
  _screenciConfigRenderOptions: RenderOptions | undefined
  /** Per-still record options declared via `screenshot.recordOptions(...)`. Internal. */
  _screenciRecordOptions: Partial<RecordOptions> | undefined
  /** Per-still render options declared via `screenshot.renderOptions(...)`. Internal. */
  _screenciRenderOptions: Partial<RenderOptions> | undefined
  /** Active language for this pass; see {@link video} for details. Internal. */
  _screenciLanguage: string | undefined
  /** Grouping name written to `metadata.videoName`. Internal. */
  _screenciVideoName: string | undefined
  /** Values-field declaration (`screenshot.values(...)`). Internal. */
  _screenciValues: NormalizedFeature<string> | undefined
  /** Overlay declaration (`screenshot.overlays(...)`). Internal. */
  _screenciOverlays: NormalizedFeature<OverlayInputOrFactory> | undefined
  /**
   * Absolute path of the `.screenci` script that registered this test, captured
   * by the fan-out builder. Asset paths are resolved relative to it, since
   * `testInfo.file` points at the builder module, not the script. Internal.
   */
  _screenciSourceFile: string | undefined
}

type ScreenshotFixtures = {
  clip: CropFixture
  /** The language being captured in this pass; `undefined` outside per-language mode. */
  language: string | undefined
  /**
   * Injected values fields for the active language, keyed by the field names
   * declared in `screenshot.values(...)`. A still is silent, so there is no
   * `narration` fixture.
   */
  values: Values
  /**
   * Overlay controllers for the names declared in `screenshot.overlays(...)`.
   * Empty when none are declared.
   */
  overlays: Record<
    string,
    OverlayController | ((props: unknown) => OverlayController)
  >
}

const _screenshotBase = base.extend<
  ScreenshotFixtureOptions & ScreenshotFixtures
>({
  _screenciConfigRecordOptions: [DEFAULT_VIDEO_OPTIONS, { option: true }],
  _screenciConfigRenderOptions: [undefined, { option: true }],
  _screenciRecordOptions: [undefined, { option: true }],
  _screenciRenderOptions: [undefined, { option: true }],
  _screenciLanguage: [undefined, { option: true }],
  _screenciVideoName: [undefined, { option: true }],
  _screenciValues: [undefined, { option: true }],
  _screenciOverlays: [undefined, { option: true }],
  _screenciSourceFile: [undefined, { option: true }],

  language: async ({ _screenciLanguage }, use) => {
    await use(_screenciLanguage)
  },

  values: async ({ _screenciValues, _screenciLanguage }, use) => {
    await use(
      buildValues(_screenciValues, _screenciLanguage, parseValuesOverrides())
    )
  },

  overlays: async ({ _screenciOverlays, _screenciLanguage }, use) => {
    await use(buildOverlays(_screenciOverlays, _screenciLanguage))
  },

  clip: async ({}, use) => {
    await use(async (target, options) => {
      const page = getRuntimePage()
      if (page === null) {
        throw new ScreenciError(
          'crop() requires an active ScreenCI page. Call it inside a screenshot() body.'
        )
      }
      setRuntimeCrop(await resolveClip(target, page, options))
    })
  },

  browser: async ({ playwright }, use) => {
    const shouldRecord = process.env.SCREENCI_RECORDING === 'true'
    const launchOptions = getChromiumLaunchOptions(shouldRecord)

    const browser = await playwright.chromium.launch(launchOptions)
    instrumentBrowser(browser)
    await use(browser)
    if (browser.isConnected()) {
      await browser.close()
    }
  },

  context: async (
    {
      browser,
      _screenciConfigRecordOptions,
      _screenciRecordOptions,
      _screenciVideoName,
      colorScheme,
      locale,
      timezoneId,
      userAgent,
      geolocation,
      permissions,
      extraHTTPHeaders,
      httpCredentials,
      ignoreHTTPSErrors,
      offline,
      storageState,
      baseURL,
      bypassCSP,
      acceptDownloads,
      javaScriptEnabled,
      hasTouch,
      isMobile,
      deviceScaleFactor,
    },
    use,
    testInfo
  ) => {
    const { base: baseRecordOptions } = resolveStudioRecordOptions(
      combineRecordOptionsLayers(
        _screenciConfigRecordOptions,
        _screenciRecordOptions
      )
    )
    const effectiveRecordOptions = resolveEffectiveRecordOptions(
      baseRecordOptions,
      _screenciVideoName ?? testInfo.title
    )
    const aspectRatio =
      effectiveRecordOptions.aspectRatio ?? DEFAULT_ASPECT_RATIO
    const quality = effectiveRecordOptions.quality ?? DEFAULT_QUALITY
    const dimensions = getDimensions(aspectRatio, quality)
    const shouldRecord = process.env.SCREENCI_RECORDING === 'true'

    // Screenshots honor deviceScaleFactor for higher-DPI stills.
    const context = await browser.newContext(
      buildScreenCIContextOptions({
        dimensions,
        applyLocaleDefault: shouldRecord,
        deviceScaleFactor: resolveDeviceScaleFactor(
          effectiveRecordOptions,
          deviceScaleFactor,
          DEFAULT_SCREENSHOT_DEVICE_SCALE_FACTOR
        ),
        forwarded: {
          colorScheme,
          locale,
          timezoneId,
          userAgent,
          geolocation,
          permissions,
          extraHTTPHeaders,
          httpCredentials,
          ignoreHTTPSErrors,
          offline,
          storageState,
          baseURL,
          bypassCSP,
          acceptDownloads,
          javaScriptEnabled,
          hasTouch,
          isMobile,
        },
      })
    )

    instrumentContext(context)

    try {
      await use(context)
    } finally {
      await context.close()
    }
  },

  page: async (
    {
      context,
      _screenciConfigRecordOptions,
      _screenciConfigRenderOptions,
      _screenciRecordOptions,
      _screenciRenderOptions,
      deviceScaleFactor,
      _screenciLanguage,
      _screenciValues,
      _screenciVideoName,
      _screenciSourceFile,
    },
    use,
    testInfo
  ) => {
    const shouldRecord = process.env.SCREENCI_RECORDING === 'true'
    const { base: baseRecordOptions } = resolveStudioRecordOptions(
      combineRecordOptionsLayers(
        _screenciConfigRecordOptions,
        _screenciRecordOptions
      )
    )
    const { obj: renderOptionsObj } = resolveStudioRenderOptions(
      combineRenderOptionsLayers(
        _screenciConfigRenderOptions,
        _screenciRenderOptions
      )
    )
    const recordOptions = resolveEffectiveRecordOptions(
      baseRecordOptions,
      _screenciVideoName ?? testInfo.title
    )
    const videoName = _screenciVideoName ?? testInfo.title
    // Every capture is web-editable: render/record options are always marked
    // studio so the app knows it may override them.
    const recorder = new EventRecorder(
      renderOptionsObj,
      recordOptions,
      {
        renderOptions: true,
        recordOptions: true,
      },
      // Action-parameter provenance for this capture, with the web editor's
      // per-action overrides (fetched by the CLI, injected via env) applied.
      new ActionParamCollector(parseActionOverrides()?.[videoName] ?? {})
    )
    recorder.setActiveLanguage(_screenciLanguage ?? null)
    // Declared `values` fields (and the active language's seeds) emitted once at
    // recording start so the backend/Studio learn them.
    const valuesDeclaration = buildValuesDeclaration(
      _screenciValues,
      _screenciLanguage
    )
    // Asset paths are authored relative to the user's script. Playwright reports
    // `testInfo.file` as the builder module that registered the test, so prefer
    // the script path captured at the call site.
    const testFilePath = _screenciSourceFile ?? testInfo.file

    if (!shouldRecord) {
      // Preview run (`screenci test`): exercise the body without capturing.
      const page = await context.newPage()
      if (
        resolveDisableAnimations(recordOptions.disableAnimations, 'screenshot')
      ) {
        await installAnimationDisabling(page)
      }
      const runtimeContext = createScreenCIRuntimeContext({
        recorder,
        page,
        testFilePath,
        captureKind: 'screenshot',
      })
      recorder.start()
      await withActiveRecordingContext({
        runtimeContext,
        page,
        recorder,
        unendedOverlays: 'autoEnd',
        valuesDeclaration,
        fn: async () => {
          await use(page)
        },
      })
      await page.close()
      return
    }

    const aspectRatio = recordOptions.aspectRatio ?? DEFAULT_ASPECT_RATIO
    const quality = recordOptions.quality ?? DEFAULT_QUALITY
    const dimensions = getDimensions(aspectRatio, quality)
    const dsf = resolveDeviceScaleFactor(
      recordOptions,
      deviceScaleFactor,
      DEFAULT_SCREENSHOT_DEVICE_SCALE_FACTOR
    )

    const directoryName = escapeFileSystemPathSegment(testInfo.title)
    const screenshotDir = join(process.cwd(), '.screenci', directoryName)

    // Start fresh.
    try {
      await rm(screenshotDir, { recursive: true, force: true })
    } catch {
      // Ignore if it does not exist.
    }
    await mkdir(screenshotDir, { recursive: true })

    const page = await context.newPage()
    if (
      resolveDisableAnimations(recordOptions.disableAnimations, 'screenshot')
    ) {
      await installAnimationDisabling(page)
    }
    const runtimeContext = createScreenCIRuntimeContext({
      recorder,
      page,
      testFilePath,
      recordingDir: screenshotDir,
      captureKind: 'screenshot',
    })

    recorder.start()

    try {
      await withActiveRecordingContext({
        runtimeContext,
        page,
        recorder,
        unendedOverlays: 'autoEnd',
        valuesDeclaration,
        fn: async () => {
          await use(page)
        },
      })

      // The body completed successfully: capture the final page state. Capturing
      // here (not in `finally`) mirrors the video fixture's passed-only upload:
      // a thrown body skips capture and fails the test.
      await page.screenshot({
        path: join(screenshotDir, SCREENSHOT_FILE_NAME),
      })

      const clip = runtimeContext.clip ?? undefined
      // The cursor lands at its final position even for a still (the move is
      // instant). Record it so the renderer can draw the cursor on the still
      // when `renderOptions.screenshot.mouse.show` is set. Absent when the body
      // never moved the cursor, so no cursor is ever shown for such a still.
      const mousePosition = getMousePosition(page)
      const screenshot: ScreenshotInfo = {
        path: SCREENSHOT_FILE_NAME,
        width: Math.round(dimensions.width * dsf),
        height: Math.round(dimensions.height * dsf),
        deviceScaleFactor: dsf,
        ...(mousePosition !== undefined && {
          mousePosition: { x: mousePosition.x, y: mousePosition.y },
        }),
      }

      const configDir = process.env.SCREENCI_CONFIG_DIR ?? process.cwd()
      // The clip (from the `crop` fixture) is a render option, so it goes into
      // renderOptions.screenshot.clip (editable in Studio), not ScreenshotInfo.
      await recorder.writeToFile(
        screenshotDir,
        videoName,
        relative(configDir, testFilePath),
        {
          output: 'screenshot',
          screenshot,
          ...(clip !== undefined && { clip }),
        }
      )
    } finally {
      await page.close()
    }
  },
})

type ScreenshotType = TestType<
  PlaywrightTestArgs &
    PlaywrightTestOptions &
    ScreenshotFixtureOptions &
    ScreenshotFixtures &
    PlaywrightWorkerArgs &
    PlaywrightWorkerOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>

type ScreenshotArgs = Omit<PlaywrightTestArgs, 'page'> & {
  page: ScreenCIPage
} & PlaywrightTestOptions &
  ScreenshotFixtureOptions &
  ScreenshotFixtures &
  PlaywrightWorkerArgs &
  PlaywrightWorkerOptions

type ScreenshotBody = (
  args: ScreenshotArgs,
  testInfo: TestInfo
) => void | Promise<void>

/** Conditional overloads shared by skip / fixme / fail */
type ConditionalOverloads = ((
  condition?: boolean,
  description?: string
) => void) &
  ((condition?: boolean, callback?: () => string) => void)

interface ScreenshotCallSignatures {
  /**
   * Declares a ScreenCI screenshot test.
   *
   * Drives the page like a `video()` test, then captures the final state as a
   * still image. The capture is framed on the configured background with the
   * branded frame, cropped with the `crop` fixture argument, and decorated with
   * overlays at render time. The viewport is derived from
   * `recordOptions.aspectRatio` and `recordOptions.quality`;
   * `recordOptions.deviceScaleFactor` raises the DPI.
   *
   * @example
   * ```ts
   * import { screenshot } from 'screenci'
   *
   * screenshot('Dashboard hero', async ({ page, clip }) => {
   *   await page.goto('https://app.example.com/dashboard')
   *   await clip(page.getByTestId('revenue-card'), { padding: 48 })
   * })
   * ```
   */
  (title: string, body: ScreenshotBody): void

  /**
   * Declares a ScreenCI screenshot test with additional details (tags,
   * annotations, etc.).
   */
  (title: string, details: TestDetails, body: ScreenshotBody): void
}

/**
 * Recursive interface so `.only`, `.skip`, `.fixme`, `.fail`, and `.slow`
 * surface `page: ScreenCIPage` instead of the raw Playwright `page: Page`.
 */
interface Screenshot extends ScreenshotCallSignatures {
  only: Screenshot
  skip: Screenshot & ConditionalOverloads
  fixme: Screenshot & ConditionalOverloads
  fail: Screenshot & ConditionalOverloads
  slow: Screenshot & ((condition?: boolean, description?: string) => void)

  /**
   * Capture one localized screenshot per declared language. By default each
   * language is captured in its own pass with the browser `locale` set from the
   * language, and the body receives the active `language` and `values` fields.
   * Chainable with `.each(...)`.
   */
  /** Declare on-screen values fields (array = blank names, object = code values). */
  values: MediaBuilder<ScreenshotArgs>['values']

  /** Declare overlays (array = blank names, object = code values/factories). */
  overlays: MediaBuilder<ScreenshotArgs>['overlays']

  /**
   * Declare the recorded language set / capture mode. The web app owns the set;
   * pass an array `['en', 'fi']` or an options object to seed it, or call with
   * no argument to leave the set entirely to the web app.
   */
  languages: MediaBuilder<ScreenshotArgs>['languages']

  /**
   * Declare capture options (aspect ratio, quality, deviceScaleFactor, ...). A
   * flat object applies to every language; a language-major object
   * (`{ default, de, ... }`) overrides per language. Values stay editable in
   * the web app.
   */
  recordOptions: MediaBuilder<ScreenshotArgs>['recordOptions']

  /**
   * Declare render options (framing, output, screenshot clip, ...). A flat
   * object applies to every language; a language-major object overrides per
   * language. Values stay editable in the web app.
   */
  renderOptions: MediaBuilder<ScreenshotArgs>['renderOptions']

  /**
   * Produce a separate screenshot per variant (viewport, theme, ...). Each
   * variant has its own identity and history. Chainable with `.languages(...)`.
   */
  each: MediaBuilder<ScreenshotArgs>['each']

  beforeEach(
    inner: (args: ScreenshotArgs, testInfo: TestInfo) => Promise<void> | void
  ): void
  beforeEach(
    title: string,
    inner: (args: ScreenshotArgs, testInfo: TestInfo) => Promise<void> | void
  ): void
  afterEach(
    inner: (args: ScreenshotArgs, testInfo: TestInfo) => Promise<void> | void
  ): void
  afterEach(
    title: string,
    inner: (args: ScreenshotArgs, testInfo: TestInfo) => Promise<void> | void
  ): void

  describe: ScreenshotType['describe']
  beforeAll: ScreenshotType['beforeAll']
  afterAll: ScreenshotType['afterAll']
  use: ScreenshotType['use']
  extend: ScreenshotType['extend']
  step: ScreenshotType['step']
  info: ScreenshotType['info']
  expect: ScreenshotType['expect']
  setTimeout: ScreenshotType['setTimeout']
}

/**
 * ScreenCI screenshot test fixture.
 *
 * Extended Playwright test that captures a branded still image of the final page
 * state. Configure Playwright options (colorScheme, ...) with `screenshot.use()`
 * and capture options with `screenshot.recordOptions(...)`.
 *
 * @example
 * ```ts
 * import { screenshot, createOverlays } from 'screenci'
 *
 * const overlays = createOverlays({
 *   badge: { path: '../assets/new-badge.png', x: 0.72, y: 0.06, width: 0.2 },
 * })
 *
 * screenshot.use({ colorScheme: 'dark' })
 *
 * screenshot.recordOptions({ quality: '1440p', deviceScaleFactor: 2 })(
 *   'Dashboard hero',
 *   async ({ page, clip }) => {
 *     await page.goto('https://app.example.com/dashboard')
 *     await overlays.badge()
 *     await clip(page.getByTestId('revenue-card'), { padding: 0.06 })
 *   }
 * )
 * ```
 */
export const screenshot = _screenshotBase as unknown as Screenshot

// Attach the chainable fan-out builders, mirroring `video`.
const _screenshotRootBuilder = createVideoBuilder<ScreenshotArgs>(
  _screenshotBase as unknown as Parameters<typeof createVideoBuilder>[0],
  SCREENSHOT_FEATURES
)
screenshot.values = _screenshotRootBuilder.values
screenshot.overlays = _screenshotRootBuilder.overlays
screenshot.languages = _screenshotRootBuilder.languages
screenshot.recordOptions = _screenshotRootBuilder.recordOptions
screenshot.renderOptions = _screenshotRootBuilder.renderOptions
screenshot.each = _screenshotRootBuilder.each
