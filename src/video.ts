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
import { join } from 'path'
import { attachRecorder } from 'playwright-recorder-plus'
import type { Recorder } from 'playwright-recorder-plus'
import { sanitizeVideoName } from './sanitize.js'
import type {
  AspectRatio,
  FPS,
  Quality,
  RecordOptions,
  RenderOptions,
  ScreenCIPage,
} from './types.js'
import type { Page } from '@playwright/test'
export { getDimensions } from './dimensions.js'
import { getDimensions, getViewportCenter } from './dimensions.js'
import {
  setActiveCueRecorder,
  resetCueChain,
  validateCustomVoiceRefs,
} from './cue.js'
import { setActiveHideRecorder } from './hide.js'
import { setActiveAutoZoomRecorder } from './autoZoom.js'
import {
  setActiveAssetRecorder,
  validateRegisteredAssetPaths,
} from './asset.js'
import {
  DEFAULT_VIDEO_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_QUALITY,
  DEFAULT_FPS,
} from './defaults.js'
import { EventRecorder } from './events.js'
import {
  setActiveClickRecorder,
  instrumentBrowser,
  instrumentContext,
} from './instrument.js'
import { logger } from './logger.js'
import { getChromiumLaunchOptions } from './browserLaunchOptions.js'

export const POST_VIDEO_PAUSE = 500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function setupMouseTracking(
  _page: Page,
  _recorder: EventRecorder
): Promise<void> {
  /*
  await page.exposeFunction(
    '__screenci_recordMouseMove',
    (x: number, y: number) => {
      recorder.addMouseMove(x, y)
    }
  )

  await page.addInitScript(() => {
    // Throttle mouse moves to ~60fps (16ms) to keep data.json size manageable
    let lastMouseMove = 0
    document.addEventListener(
      'mousemove',
      (e) => {
        const now = Date.now()
        if (now - lastMouseMove >= 16) {
          lastMouseMove = now
          ;(
            window as Window & {
              __screenci_recordMouseMove?: (x: number, y: number) => void
            }
          ).__screenci_recordMouseMove?.(e.clientX, e.clientY)
        }
      },
      { capture: true }
    )
  })
  */
}

/**
 * Get CRF value (encoding quality) for a given quality preset.
 *
 * Higher resolution presets use a lower CRF (better quality) because the
 * larger file size budget is expected at those resolutions.
 * - `'720p'`   → CRF 21 (medium – balanced size/quality for HD)
 * - `'1080p'`  → CRF 16 (high   – best quality for Full HD)
 * - `'1440p'`  → CRF 16 (high   – best quality for Quad HD)
 * - `'2160p'`  → CRF 16 (high   – best quality for UHD)
 */
function getCrfForQuality(quality: Quality): number {
  switch (quality) {
    case '720p':
      return 21
    case '1080p':
      return 16
    case '1440p':
      return 16
    case '2160p':
      return 16
  }
}

async function startScreencastRecording(
  page: Page,
  outputPath: string,
  fps: FPS,
  quality: Quality,
  aspectRatio: AspectRatio
): Promise<Recorder> {
  const { width, height } = getDimensions(aspectRatio, quality)
  const crf = getCrfForQuality(quality)

  const recorder = await attachRecorder(page, {
    path: outputPath,
    autoStart: false,
    size: { width, height },
    fps,
    jpegQuality: 100,
    ffmpegArgs: [
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      `${crf}`,
      '-pix_fmt',
      'yuv444p',
      '-movflags',
      'frag_keyframe+empty_moov',
    ],
  })

  return recorder
}

type VideoFixtureOptions = {
  recordOptions: RecordOptions
  renderOptions: RenderOptions | undefined
}

const _videoBase = base.extend<VideoFixtureOptions>({
  recordOptions: [DEFAULT_VIDEO_OPTIONS, { option: true }],
  renderOptions: [undefined, { option: true }],

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

  context: async ({ browser, recordOptions }, use) => {
    // Configure browser context
    const aspectRatio = recordOptions.aspectRatio ?? DEFAULT_ASPECT_RATIO
    const quality = recordOptions.quality ?? DEFAULT_QUALITY
    const dimensions = getDimensions(aspectRatio, quality)
    const shouldRecord = process.env.SCREENCI_RECORDING === 'true'

    if (shouldRecord) {
      const context = await browser.newContext({
        locale: 'en-US',
        viewport: dimensions,
      })

      instrumentContext(context)

      try {
        await use(context)
      } finally {
        await context.close()
      }

      return
    }

    const context = await browser.newContext({
      viewport: dimensions,
    })

    instrumentContext(context)

    await use(context)

    await context.close()
  },

  page: async ({ context, recordOptions, renderOptions }, use, testInfo) => {
    // Only record when explicitly enabled (record command)
    const shouldRecord = process.env.SCREENCI_RECORDING === 'true'

    if (!shouldRecord) {
      // Skip recording, just create page
      resetCueChain()
      setActiveCueRecorder(null)
      setActiveClickRecorder(null)
      setActiveHideRecorder(null)
      setActiveAutoZoomRecorder(null)
      setActiveAssetRecorder(null)
      const page = await context.newPage()
      await use(page)
      await page.close()
      return
    }

    // Get video options
    const aspectRatio = recordOptions.aspectRatio ?? DEFAULT_ASPECT_RATIO
    const quality = recordOptions.quality ?? DEFAULT_QUALITY
    const fps = recordOptions.fps ?? DEFAULT_FPS
    const dimensions = getDimensions(aspectRatio, quality)

    // Sanitize video title to create a valid directory name
    const sanitizedVideoName = sanitizeVideoName(testInfo.title)

    // Create directory path: .screenci/[video-name]/
    const videoDir = join(process.cwd(), '.screenci', sanitizedVideoName)

    // Delete old directory if it exists (start fresh)
    try {
      await rm(videoDir, { recursive: true, force: true })
    } catch {
      // Ignore errors if directory doesn't exist
    }

    // Create the directory
    await mkdir(videoDir, { recursive: true })

    // Video output path - always use recording.mp4
    const videoPath = join(videoDir, 'recording.mp4')

    const recorder = new EventRecorder(renderOptions, recordOptions)
    resetCueChain()
    setActiveCueRecorder(recorder)
    setActiveClickRecorder(recorder)
    setActiveHideRecorder(recorder)
    setActiveAutoZoomRecorder(recorder)
    setActiveAssetRecorder(recorder)

    // Create page FIRST to ensure browser window is rendered
    const page = await context.newPage()

    await setupMouseTracking(page, recorder)

    // Navigate to blank page to ensure window is ready and rendered
    await page.goto('about:blank')

    // Wait for browser window to be fully rendered before starting recording
    // This prevents black screen captures
    await page.waitForTimeout(1500)

    await validateCustomVoiceRefs(testInfo.file)
    await validateRegisteredAssetPaths(testInfo.file)

    const screenRecorder = await startScreencastRecording(
      page,
      videoPath,
      fps,
      quality,
      aspectRatio
    )

    const viewportCenter = getViewportCenter(dimensions)
    await (
      page.mouse as typeof page.mouse & {
        _move: (x: number, y: number) => Promise<void>
      }
    )._move(viewportCenter.x, viewportCenter.y)
    await screenRecorder.start()
    // Mark the moment the video recording actually begins after the cursor is positioned.
    recorder.start()

    try {
      await use(page)

      // Do not end video abruptly.
      await sleep(POST_VIDEO_PAUSE)
    } finally {
      const stopResult = await screenRecorder.stop()
      await screenRecorder.finalized
      if (!stopResult.written) {
        logger.warn(
          'Screen recording did not write any frames. Test will continue without recording.'
        )
      }

      await page.close()
      setActiveCueRecorder(null)
      setActiveClickRecorder(null)
      setActiveHideRecorder(null)
      setActiveAutoZoomRecorder(null)
      setActiveAssetRecorder(null)

      // Write recorded events next to the video
      await recorder.writeToFile(videoDir, testInfo.title)
    }
  },
})

type VideoType = TestType<
  PlaywrightTestArgs &
    PlaywrightTestOptions &
    VideoFixtureOptions &
    PlaywrightWorkerArgs &
    PlaywrightWorkerOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>

type VideoArgs = Omit<PlaywrightTestArgs, 'page'> & {
  page: ScreenCIPage
} & PlaywrightTestOptions &
  VideoFixtureOptions &
  PlaywrightWorkerArgs &
  PlaywrightWorkerOptions

type VideoBody = (args: VideoArgs, testInfo: TestInfo) => void | Promise<void>

/** Conditional overloads shared by skip / fixme / fail */
type ConditionalOverloads = ((
  condition?: boolean,
  description?: string
) => void) &
  ((condition?: boolean, callback?: () => string) => void)

interface VideoCallSignatures {
  /**
   * Declares a ScreenCI video recording test.
   *
   * Tests automatically record browser interactions as video. The viewport is
   * configured based on `recordOptions.aspectRatio` and `recordOptions.quality`.
   *
   * @param title - Test title (used as the video filename)
   * @param body - Test body containing page interactions to record
   *
   * @example
   * ```ts
   * import { video } from 'screenci'
   *
   * video('Product demo', async ({ page }) => {
   *   await page.goto('https://example.com')
   *   await page.click('text=Get Started')
   *   // Video recorded at 16:9 1080p, 30fps (defaults)
   * })
   * ```
   *
   * @example
   * Configure video options:
   * ```ts
   * video.use({ recordOptions: { aspectRatio: '16:9', quality: '2160p', fps: 60 } })
   *
   * video('4K demo', async ({ page }) => {
   *   await page.goto('https://example.com')
   * })
   * ```
   */
  (title: string, body: VideoBody): void

  /**
   * Declares a ScreenCI video recording test with additional details.
   *
   * Tests automatically record browser interactions as video. The viewport is
   * configured based on `recordOptions.aspectRatio` and `recordOptions.quality`.
   *
   * @param title - Test title (used as the video filename)
   * @param details - Additional test configuration (tags, annotations, etc.)
   * @param body - Test body containing page interactions to record
   *
   * @example
   * Using tags:
   * ```ts
   * import { video } from 'screenci'
   *
   * video('Checkout flow', {
   *   tag: '@critical',
   * }, async ({ page }) => {
   *   await page.goto('https://example.com/checkout')
   * })
   * ```
   *
   * @example
   * Using annotations:
   * ```ts
   * video('Sign up', {
   *   annotation: { type: 'issue', description: 'https://github.com/...' },
   * }, async ({ page }) => {
   *   await page.goto('https://example.com/signup')
   * })
   * ```
   */
  (title: string, details: TestDetails, body: VideoBody): void
}

/**
 * Recursive interface so `.only`, `.skip`, `.fixme`, `.fail`, and `.slow`
 * all surface `page: ScreenCIPage` instead of the raw Playwright `page: Page`.
 *
 * Properties that don't receive per-test fixture args (`describe`, `beforeAll`,
 * `afterAll`, `use`, `extend`, `step`, `info`, `expect`, `setTimeout`) are
 * forwarded from `VideoType` unchanged.
 */
interface Video extends VideoCallSignatures {
  /** Run only this test. */
  only: Video
  /** Skip this test, with optional conditional overloads. */
  skip: Video & ConditionalOverloads
  /** Mark this test as fixme, with optional conditional overloads. */
  fixme: Video & ConditionalOverloads
  /** Mark this test as expected to fail, with optional conditional overloads. */
  fail: Video & ConditionalOverloads
  /** Mark this test as slow, with optional conditional overload. */
  slow: Video & ((condition?: boolean, description?: string) => void)

  /** Run a hook before each test in the current suite. */
  beforeEach(
    inner: (args: VideoArgs, testInfo: TestInfo) => Promise<void> | void
  ): void
  beforeEach(
    title: string,
    inner: (args: VideoArgs, testInfo: TestInfo) => Promise<void> | void
  ): void
  /** Run a hook after each test in the current suite. */
  afterEach(
    inner: (args: VideoArgs, testInfo: TestInfo) => Promise<void> | void
  ): void
  afterEach(
    title: string,
    inner: (args: VideoArgs, testInfo: TestInfo) => Promise<void> | void
  ): void

  // Pass-through: these don't take per-test fixture args that include `page`.
  describe: VideoType['describe']
  beforeAll: VideoType['beforeAll']
  afterAll: VideoType['afterAll']
  use: VideoType['use']
  extend: VideoType['extend']
  step: VideoType['step']
  info: VideoType['info']
  expect: VideoType['expect']
  setTimeout: VideoType['setTimeout']
}

/**
 * ScreenCI video recording test fixture.
 *
 * Extended Playwright test that automatically records browser interactions as video.
 * Configure recording options globally with `video.use()` or in your config file.
 *
 * @example
 * Basic usage:
 * ```ts
 * import { video, cue } from 'screenci'
 *
 * video('Tutorial', async ({ page }) => {
 *   await page.goto('https://example.com')
 *   cue('User navigates to homepage')
 *
 *   await page.click('text=Sign up')
 *   cue('Clicks sign up button')
 * })
 * ```
 */
export const video = _videoBase as unknown as Video
