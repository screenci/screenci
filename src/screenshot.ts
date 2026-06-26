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
import { resolveCrop } from './crop.js'
import type { CropTarget, CropOptions } from './crop.js'
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
  buildTextDeclaration,
  buildTextValues,
  type TextValues,
} from './localizeRuntime.js'
import { parseTextOverrides } from './runtimeMode.js'

/**
 * The `crop` fixture argument. Call it inside a `screenshot()` body to crop the
 * implicit end-of-body capture to a locator or pixel region. Replaces the
 * old module-level `crop()` function; the crop is recorded per test.
 */
export type CropFixture = (
  target: CropTarget,
  options?: CropOptions
) => Promise<void>

/** File name of the raw page capture written beside `data.json`. */
const SCREENSHOT_FILE_NAME = 'screenshot.png'

type ScreenshotFixtureOptions = {
  recordOptions: RecordOptions | 'studio'
  renderOptions: RenderOptions | 'studio' | undefined
  /** Active language for this pass; see {@link video} for details. Internal. */
  _screenciLanguage: string | undefined
  /** Grouping name written to `metadata.videoName`. Internal. */
  _screenciVideoName: string | undefined
  /** Text-field declaration (`screenshot.text(...)`). Internal. */
  _screenciText: NormalizedFeature<string> | undefined
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
  crop: CropFixture
  /** The language being captured in this pass; `undefined` outside per-language mode. */
  language: string | undefined
  /**
   * Injected text field values for the active language, keyed by the field names
   * declared in `screenshot.localize(...)`. A still is silent, so there is no
   * `narration` fixture.
   */
  text: TextValues
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
  recordOptions: [DEFAULT_VIDEO_OPTIONS, { option: true }],
  renderOptions: [undefined, { option: true }],
  _screenciLanguage: [undefined, { option: true }],
  _screenciVideoName: [undefined, { option: true }],
  _screenciText: [undefined, { option: true }],
  _screenciOverlays: [undefined, { option: true }],
  _screenciSourceFile: [undefined, { option: true }],

  language: async ({ _screenciLanguage }, use) => {
    await use(_screenciLanguage)
  },

  text: async ({ _screenciText, _screenciLanguage }, use) => {
    await use(
      buildTextValues(_screenciText, _screenciLanguage, parseTextOverrides())
    )
  },

  overlays: async ({ _screenciOverlays, _screenciLanguage }, use) => {
    await use(buildOverlays(_screenciOverlays, _screenciLanguage))
  },

  crop: async ({}, use) => {
    await use(async (target, options) => {
      const page = getRuntimePage()
      if (page === null) {
        throw new ScreenciError(
          'crop() requires an active ScreenCI page. Call it inside a screenshot() body.'
        )
      }
      setRuntimeCrop(await resolveCrop(target, page, options))
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
      recordOptions,
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
    const { base: baseRecordOptions, studio: studioRecord } =
      resolveStudioRecordOptions(recordOptions)
    const effectiveRecordOptions = resolveEffectiveRecordOptions(
      baseRecordOptions,
      studioRecord,
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
      recordOptions: codeRecordOptions,
      renderOptions,
      deviceScaleFactor,
      _screenciLanguage,
      _screenciText,
      _screenciVideoName,
      _screenciSourceFile,
    },
    use,
    testInfo
  ) => {
    const shouldRecord = process.env.SCREENCI_RECORDING === 'true'
    const { base: baseRecordOptions, studio: studioRecord } =
      resolveStudioRecordOptions(codeRecordOptions)
    const { obj: renderOptionsObj, studio: studioRender } =
      resolveStudioRenderOptions(renderOptions)
    const recordOptions = resolveEffectiveRecordOptions(
      baseRecordOptions,
      studioRecord,
      _screenciVideoName ?? testInfo.title
    )
    const recorder = new EventRecorder(renderOptionsObj, recordOptions, {
      renderOptions: studioRender,
      recordOptions: studioRecord,
    })
    recorder.setActiveLanguage(_screenciLanguage ?? null)
    // Declared `text` fields (and the active language's seeds) emitted once at
    // recording start so the backend/Studio learn them.
    const textDeclaration = buildTextDeclaration(
      _screenciText,
      _screenciLanguage
    )
    const videoName = _screenciVideoName ?? testInfo.title
    // Asset paths are authored relative to the user's script. Playwright reports
    // `testInfo.file` as the builder module that registered the test, so prefer
    // the script path captured at the call site.
    const testFilePath = _screenciSourceFile ?? testInfo.file

    if (!shouldRecord) {
      // Preview run (`screenci test`): exercise the body without capturing.
      const page = await context.newPage()
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
        textDeclaration,
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
        textDeclaration,
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

      const crop = runtimeContext.crop ?? undefined
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
      // The crop (from the `crop` fixture) is a render option, so it goes into
      // renderOptions.screenshot.crop (editable in Studio), not ScreenshotInfo.
      await recorder.writeToFile(
        screenshotDir,
        videoName,
        relative(configDir, testFilePath),
        {
          output: 'screenshot',
          screenshot,
          ...(crop !== undefined && { crop }),
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
   * screenshot('Dashboard hero', async ({ page, crop }) => {
   *   await page.goto('https://app.example.com/dashboard')
   *   await crop(page.getByTestId('revenue-card'), { padding: 48 })
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
   * language, and the body receives the active `language` and `text` values.
   * Chainable with `.each(...)`.
   */
  /** Declare on-screen text fields (array = Studio-owned, object = code values). */
  text: MediaBuilder<ScreenshotArgs>['text']

  /** Declare overlays (array = Studio-owned, object = code values/factories). */
  overlays: MediaBuilder<ScreenshotArgs>['overlays']

  /**
   * Declare the recorded language set / capture mode. Pass `'studio'` to let the
   * web app own the set, an array `['en', 'fi']`, or an options object.
   */
  languages: MediaBuilder<ScreenshotArgs>['languages']

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
 * state. Configure capture options with `screenshot.use()` or in your config.
 *
 * @example
 * ```ts
 * import { screenshot, createOverlays } from 'screenci'
 *
 * const overlays = createOverlays({
 *   badge: { path: '../assets/new-badge.png', x: 0.72, y: 0.06, width: 0.2 },
 * })
 *
 * screenshot.use({
 *   colorScheme: 'dark',
 *   recordOptions: { quality: '1440p', deviceScaleFactor: 2 },
 * })
 *
 * screenshot('Dashboard hero', async ({ page, crop }) => {
 *   await page.goto('https://app.example.com/dashboard')
 *   await overlays.badge()
 *   await crop(page.getByTestId('revenue-card'), { padding: 0.06 })
 * })
 * ```
 */
export const screenshot = _screenshotBase as unknown as Screenshot

// Attach the chainable fan-out builders, mirroring `video`.
const _screenshotRootBuilder = createVideoBuilder<ScreenshotArgs>(
  _screenshotBase as unknown as Parameters<typeof createVideoBuilder>[0],
  SCREENSHOT_FEATURES
)
screenshot.text = _screenshotRootBuilder.text
screenshot.overlays = _screenshotRootBuilder.overlays
screenshot.languages = _screenshotRootBuilder.languages
screenshot.each = _screenshotRootBuilder.each
