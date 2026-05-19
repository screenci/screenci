import { test as base } from '@playwright/test'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { attachRecorder } from 'playwright-recorder-plus'
import { sanitizeVideoName } from './sanitize.js'
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
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
async function setupMouseTracking(page, recorder) {
  void page
  void recorder
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
function getCrfForQuality(quality) {
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
  page,
  outputPath,
  fps,
  quality,
  aspectRatio
) {
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
const _videoBase = base.extend({
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
    await page.mouse._move(viewportCenter.x, viewportCenter.y)
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
export const video = _videoBase
