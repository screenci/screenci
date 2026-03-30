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
import { spawn, type ChildProcess } from 'child_process'
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
import { getDimensions } from './dimensions.js'
import { isHeadless, startXvfb, type XvfbInstance } from './xvfb.js'
import { setActiveCaptionRecorder, resetCaptionChain } from './caption.js'
import { setActiveHideRecorder } from './hide.js'
import { setActiveAutoZoomRecorder } from './autoZoom.js'
import { setActiveAssetRecorder } from './asset.js'
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

async function setupMouseTracking(
  page: Page,
  recorder: EventRecorder
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
 * Get the path to the system ffmpeg binary
 */
function getSystemFfmpegPath(): string {
  // Use system ffmpeg from standard locations
  return '/usr/bin/ffmpeg'
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

/**
 * Start ffmpeg screen recording
 */
function startScreenRecording(
  outputPath: string,
  fps: FPS,
  quality: Quality,
  aspectRatio: AspectRatio
): { process: ChildProcess; started: Promise<boolean> } {
  const { width, height } = getDimensions(aspectRatio, quality)
  const crf = getCrfForQuality(quality)
  const display = process.env.DISPLAY || ':0'

  const ffmpegArgs = [
    '-f',
    'x11grab',
    '-draw_mouse',
    '0',
    '-video_size',
    `${width}x${height}`,
    '-framerate',
    `${fps}`,
    '-i',
    `${display}+0,0`,
    '-c:v',
    'libx264',
    '-tune',
    'zerolatency',
    '-preset',
    'fast',
    '-crf',
    `${crf}`,
    '-pix_fmt',
    'yuv444p',
    '-movflags',
    'frag_keyframe+empty_moov',
    '-y',
    outputPath,
  ]

  const ffmpegPath = getSystemFfmpegPath()
  const ffmpeg = spawn(ffmpegPath, ffmpegArgs)

  activeFFmpegProcesses.add(ffmpeg)
  ffmpeg.on('close', () => activeFFmpegProcesses.delete(ffmpeg))

  let hasStarted = false
  let hasErrored = false

  const startedPromise = new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      if (!hasStarted && !hasErrored) {
        hasStarted = true
        resolve(true)
      }
    }, 1000)

    ffmpeg.stderr.on('data', (data) => {
      const output = data.toString()

      // ffmpeg outputs info to stderr, check for actual errors
      if (output.includes('frame=') || output.includes('fps=')) {
        if (!hasStarted) {
          hasStarted = true
          clearTimeout(timeout)
          resolve(true)
        }
      } else if (
        output.includes('error') ||
        output.includes('Error') ||
        output.includes('Invalid')
      ) {
        if (!hasErrored) {
          hasErrored = true
          clearTimeout(timeout)
          logger.error('FFmpeg error:', output)
          resolve(false)
        }
      }
    })

    ffmpeg.on('error', (err) => {
      if (!hasErrored) {
        hasErrored = true
        clearTimeout(timeout)
        logger.error('Failed to start FFmpeg:', err)
        resolve(false)
      }
    })

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== null && code !== 0 && code !== 255 && !hasErrored) {
        logger.error(`FFmpeg exited with code ${code}`)
      }
    })
  })

  return { process: ffmpeg, started: startedPromise }
}

/**
 * Stop ffmpeg recording gracefully.
 *
 * SIGTERM tells ffmpeg to flush buffers and write the moov atom before exiting.
 * SIGKILL is a last resort after timeoutMs and will leave the file corrupt.
 */
async function stopScreenRecording(
  ffmpegProcess: ChildProcess,
  timeoutMs = 10000
): Promise<void> {
  // Already exited (e.g. display closed under it) — nothing to signal
  if (ffmpegProcess.exitCode !== null || ffmpegProcess.killed) {
    return
  }

  return new Promise((resolve) => {
    const sigkillTimer = setTimeout(() => {
      logger.warn(
        'FFmpeg did not stop gracefully, forcing SIGKILL (file may be corrupt)'
      )
      ffmpegProcess.kill('SIGKILL')
      resolve()
    }, timeoutMs)

    ffmpegProcess.on('close', () => {
      clearTimeout(sigkillTimer)
      resolve()
    })

    ffmpegProcess.kill('SIGTERM')
  })
}

type VideoFixtureOptions = {
  recordOptions: RecordOptions
  renderOptions: RenderOptions | undefined
  _xvfbSetup: void
}

// Internal state for xvfb management (not exposed to users)
let currentXvfb: XvfbInstance | null = null
let originalDisplay: string | undefined

// Track active ffmpeg processes so they can be killed if the process is
// interrupted before the fixture teardown has a chance to stop them.
const activeFFmpegProcesses = new Set<ChildProcess>()

function killActiveFFmpegProcesses(): void {
  for (const proc of activeFFmpegProcesses) {
    try {
      proc.kill('SIGTERM')
    } catch {}
  }
  activeFFmpegProcesses.clear()
}

// Clean up Xvfb and any active ffmpeg processes when the worker process exits
// so lock/socket files don't persist and block the next run.
process.on('exit', () => {
  killActiveFFmpegProcesses()
  if (currentXvfb) {
    try {
      currentXvfb.process.kill('SIGTERM')
    } catch {}
  }
})

// Forward SIGTERM/SIGINT: kill ffmpeg and Xvfb, then let the process exit.
const handleTermSignal = (signal: NodeJS.Signals) => {
  logger.info(`Worker received ${signal}, killing ffmpeg and Xvfb...`)
  killActiveFFmpegProcesses()
  if (currentXvfb) {
    try {
      currentXvfb.process.kill('SIGTERM')
    } catch {}
  }
  process.exit(0)
}

process.on('SIGTERM', handleTermSignal)
process.on('SIGINT', handleTermSignal)

const _videoBase = base.extend<VideoFixtureOptions>({
  recordOptions: [DEFAULT_VIDEO_OPTIONS, { option: true }],
  renderOptions: [undefined, { option: true }],

  // Internal worker fixture to manage xvfb per test
  _xvfbSetup: [
    async ({ recordOptions }, use: (arg: void) => Promise<void>) => {
      const shouldRecord = process.env.SCREENCI_RECORD === 'true'

      if (shouldRecord && !currentXvfb && isHeadless()) {
        // Start Xvfb once per worker at 3840×3840 — a square large enough to
        // contain any quality/aspect-ratio combination. Per-test sizing is
        // handled by the Playwright viewport override and the FFmpeg capture
        // region. The framebuffer costs ~56 MB of RAM, negligible on any runner.
        logger.info('Starting Xvfb at 3840×3840')
        currentXvfb = await startXvfb(3840, 3840)
        logger.info(`Xvfb started on ${currentXvfb.display}`)

        if (originalDisplay === undefined) {
          originalDisplay = process.env.DISPLAY
        }
        process.env.DISPLAY = currentXvfb.display
      }

      await use()

      // Xvfb stays alive between tests — cleanup happens on process exit.
    },
    { scope: 'test', auto: true },
  ],

  browser: async ({ playwright }, use) => {
    // Launch browser with kiosk mode when recording for fullscreen capture
    // Note: _xvfbSetup runs automatically before this due to auto: true
    const shouldRecord = process.env.SCREENCI_RECORD === 'true'
    const launchOptions = shouldRecord
      ? {
          headless: false,
          args: [
            '--window-position=0,0',
            '--kiosk',
            '--disable-translate',
            '--disable-spell-checking',
            '--disable-notifications', // no permission popups
            '--disable-save-password-bubble', // no "save password?" dialog
            '--disable-infobars', // no "Chrome is being controlled by..." bar
            '--no-first-run', // skip first-run UI
            '--hide-scrollbars', // scrollbars invisible in recordings
          ],
        }
      : undefined

    const browser = await playwright.chromium.launch(launchOptions)
    instrumentBrowser(browser)
    await use(browser)
    await browser.close()
  },

  context: async ({ browser, recordOptions }, use) => {
    // Configure browser context
    const aspectRatio = recordOptions.aspectRatio ?? DEFAULT_ASPECT_RATIO
    const quality = recordOptions.quality ?? DEFAULT_QUALITY
    const dimensions = getDimensions(aspectRatio, quality)

    const context = await browser.newContext({
      viewport: dimensions,
    })

    instrumentContext(context)

    await use(context)

    await context.close()
  },

  page: async ({ context, recordOptions, renderOptions }, use, testInfo) => {
    // Only record when explicitly enabled (record command)
    const shouldRecord = process.env.SCREENCI_RECORD === 'true'

    if (!shouldRecord) {
      // Skip recording, just create page
      resetCaptionChain()
      setActiveCaptionRecorder(null)
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

    logger.info(`Recording video to: ${videoPath}`)
    logger.info(
      `Recording with ${aspectRatio} ${quality} (${dimensions.width}x${dimensions.height}), ${fps}fps`
    )

    const recorder = new EventRecorder(renderOptions, recordOptions)
    resetCaptionChain()
    setActiveCaptionRecorder(recorder)
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

    // Hide browser toolbar via CDP fullscreen. --kiosk alone is not reliable on
    // Xvfb; the CDP call triggers Chromium's internal fullscreen mode which
    // removes all browser UI chrome. No explicit dims here — those conflict with
    // windowState and are not needed (FFmpeg captures from +0,0 at test dims).
    try {
      const cdpSession = await context.newCDPSession(page)
      const { windowId } = await cdpSession.send(
        'Browser.getWindowForTarget',
        {}
      )
      await cdpSession.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'fullscreen' },
      })
      await cdpSession.detach()
    } catch (cdpError) {
      logger.warn('CDP fullscreen failed, toolbar may be visible:', cdpError)
    }

    // Start ffmpeg recording after browser window is ready
    const { process: ffmpegProcess, started } = startScreenRecording(
      videoPath,
      fps,
      quality,
      aspectRatio
    )

    // Wait for ffmpeg to start or fail
    const didStart = await started

    if (didStart) {
      // Mark the moment the video recording actually begins
      recorder.start()
    } else {
      logger.warn(
        'Warning: Screen recording failed to start. Test will continue without recording.'
      )
      logger.warn(
        `Note: Recording at ${dimensions.width}x${dimensions.height} requires a display of at least that size.`
      )
    }

    await use(page)
    await page.close()
    setActiveCaptionRecorder(null)
    setActiveClickRecorder(null)
    setActiveHideRecorder(null)
    setActiveAutoZoomRecorder(null)
    setActiveAssetRecorder(null)

    // Stop ffmpeg recording after test (only if it started)
    if (didStart) {
      logger.info('Stopping recording...')
      await stopScreenRecording(ffmpegProcess)
      logger.info(`Video saved to: ${videoPath}`)

      // Write recorded events next to the video
      await recorder.writeToFile(videoDir, testInfo.title)
      logger.info(`Events saved to: ${join(videoDir, 'data.json')}`)
    } else {
      // Kill the process if it's still running
      if (!ffmpegProcess.killed) {
        ffmpegProcess.kill('SIGKILL')
      }
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
 * import { video, caption } from 'screenci'
 *
 * video('Tutorial', async ({ page }) => {
 *   await page.goto('https://example.com')
 *   caption('User navigates to homepage')
 *
 *   await page.click('text=Sign up')
 *   caption('Clicks sign up button')
 * })
 * ```
 */
export const video = _videoBase as unknown as Video
