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
import { attachRecorder } from 'playwright-recorder-plus'
import type { Recorder, StopResult } from 'playwright-recorder-plus'
import type { Page as RecorderPage } from 'playwright-core'
import type {
  AspectRatio,
  FPS,
  Quality,
  RecordOptions,
  RenderOptions,
  ScreenCIPage,
  VideoEncoderPreset,
} from './types.js'
import type { Page } from '@playwright/test'
import type { StudioDeclaration } from './studio.js'
import { studioOptionFlags } from './studio.js'
export { getDimensions } from './dimensions.js'
import { getDimensions, getViewportCenter } from './dimensions.js'
import { resetCueChain } from './cue.js'
import { setActiveCueRecorder } from './cue.js'
import { createVideoBuilder } from './builder.js'
import type { VideoBuilder } from './builder.js'
import type { NormalizedLocalize } from './localize.js'
import {
  buildNarrationMarkers,
  buildTextDeclaration,
  buildTextValues,
  narrationVoiceConfigFromRenderOptions,
  type NarrationMarkers,
  type TextDeclaration,
  type TextValues,
} from './localizeRuntime.js'
import { setActiveHideRecorder } from './hide.js'
import { setActiveAutoZoomRecorder, setActiveZoomPage } from './autoZoom.js'
import {
  setActiveAssetRecorder,
  buildStudioOverlays,
  validateRegisteredAssetPaths,
  type OverlayController,
} from './asset.js'
import { flushPendingOverlays } from './overlayFlush.js'
import {
  setActiveAudioRecorder,
  buildStudioAudioTracks,
  validateRegisteredAudioPaths,
  type AudioController,
} from './audio.js'
import {
  DEFAULT_VIDEO_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_QUALITY,
  DEFAULT_FPS,
  DEFAULT_VIDEO_ENCODER,
} from './defaults.js'
import { EventRecorder } from './events.js'
import {
  bindClickRecorderToPage,
  instrumentBrowser,
  instrumentContext,
  setActiveClickRecorder,
} from './instrument.js'
import { logger } from './logger.js'
import { setMousePosition } from './mouse.js'
import { getChromiumLaunchOptions } from './browserLaunchOptions.js'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
  setActiveScreenCIRuntimeContext,
  setRuntimeAssetRecorder,
  setRuntimeAudioRecorder,
  setRuntimeAutoZoomRecorder,
  setRuntimeClickRecorder,
  setRuntimeCueRecorder,
  setRuntimeHideRecorder,
  setRuntimePage,
} from './runtimeContext.js'
import { escapeFileSystemPathSegment } from './fileSystemName.js'
import {
  resolveRecordingTimingDuration,
  parseTextOverrides,
  parseRecordOptions,
  mergeStudioRecordOptions,
} from './runtimeMode.js'
import { buildScreenCIContextOptions } from './contextOptions.js'
import { bindStillCaptureToPage } from './stillCapture.js'

export const POST_VIDEO_PAUSE = 500

/**
 * The record options actually used for the capture: when record options are
 * deferred to Studio (`video.studio({ recordOptions: true })`), the values
 * fetched before recording (keyed by video name) override the code-declared
 * aspect ratio, quality, and fps. Otherwise the code values are used as-is.
 */
export function resolveEffectiveRecordOptions(
  recordOptions: RecordOptions,
  studio: StudioDeclaration | undefined,
  videoName: string
): RecordOptions {
  if (!studioOptionFlags(studio).recordOptions) return recordOptions
  return mergeStudioRecordOptions(
    recordOptions,
    parseRecordOptions()?.[videoName]
  )
}

type DeferredRecordingStop = {
  recorder: Recorder
}

type WorkerFinalizationQueue = DeferredRecordingStop[]

export async function finalizeDeferredRecordingStops(
  entries: DeferredRecordingStop[]
): Promise<void> {
  await Promise.all(
    entries.map(async ({ recorder }) => {
      const stopResult = await recorder.stop()
      if (!stopResult.written) {
        logger.warn(
          'Screen recording did not write any frames. Test will continue without recording.'
        )
      }
      await recorder.finalized
    })
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, resolveRecordingTimingDuration(ms))
  )
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

export async function positionMouseAtViewportCenter(
  page: Page,
  dimensions: { width: number; height: number }
): Promise<{ x: number; y: number }> {
  const viewportCenter = getViewportCenter(dimensions)
  await (
    page.mouse as typeof page.mouse & {
      _move: (x: number, y: number) => Promise<void>
    }
  )._move(viewportCenter.x, viewportCenter.y)
  setMousePosition(page, viewportCenter)

  return viewportCenter
}

/**
 * Encoder arguments for the screencast's realtime first pass, per preset.
 *
 * We keep the recorder's realtime first pass as the final artifact (the second
 * pass is disabled below via `runSecondPass`), so these are the only encoder
 * settings that reach the saved recording. playwright-recorder-plus has no
 * public option for the first-pass encoder, so `applyFirstPassEncoderArgs`
 * overrides the recorder's internal first-pass args at runtime. Doing it at
 * runtime (rather than patching the dependency on disk) means it works for
 * every install: npm, pnpm and yarn, with no postinstall step.
 *
 * - `'sharp'` is tuned for text-heavy UI: `-tune stillimage` and a low `-crf`
 *   preserve sharp glyph edges, while `-preset veryfast` stays above realtime
 *   so the screencast stream never backpressures (which drops frames and
 *   shortens the timeline).
 * - `'fast'` mirrors the library's original `-preset ultrafast -crf 18` for
 *   resource-constrained CI that cannot keep up with the sharper encode.
 *
 * Both use `yuv420p` so the output stays decodable by the downstream NVDEC
 * CUDA render pipeline (4:4:4 H.264 is not reliably hardware-decodable).
 */
const FIRST_PASS_ARGS_BY_ENCODER: Record<
  VideoEncoderPreset,
  readonly string[]
> = {
  sharp: [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '12',
    '-tune',
    'stillimage',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
  ],
  fast: [
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
  ],
}

/**
 * Resolve the first-pass encoder args for a given preset. Exported for testing.
 */
export function resolveRecordingFirstPassArgs(
  encoder: VideoEncoderPreset = DEFAULT_VIDEO_ENCODER
): readonly string[] {
  return FIRST_PASS_ARGS_BY_ENCODER[encoder]
}

/**
 * Replace the output-encoder tail of a built first-pass ffmpeg arg list.
 *
 * The recorder's first-pass args contain two `-c:v` flags: the first selects
 * the mjpeg input decoder, the last selects the output encoder. We swap
 * everything from that last `-c:v` to the end with `encoderArgs` (which start
 * at their own `-c:v`), leaving the input/rate flags before it untouched.
 *
 * Pure and exported for testing. Throws if no output encoder is present, so a
 * future change to the recorder's internals fails loudly instead of silently
 * recording with the wrong encoder.
 */
export function overrideFirstPassEncoderArgs(
  currentArgs: readonly string[],
  encoderArgs: readonly string[]
): string[] {
  const encoderStart = currentArgs.lastIndexOf('-c:v')
  if (encoderStart === -1) {
    throw new Error(
      'playwright-recorder-plus first-pass args contained no output encoder (-c:v); ' +
        'cannot apply the configured capture encoder. The recorder internals may have changed.'
    )
  }
  return [...currentArgs.slice(0, encoderStart), ...encoderArgs]
}

/** Minimal view of the recorder's internal config that we override in place. */
type RecorderWithFirstPassConfig = {
  config?: { firstPassArgs?: unknown }
}

/**
 * Override the recorder's first-pass encoder in place, before `start()`.
 *
 * `attachRecorder` builds `config.firstPassArgs` eagerly but only spawns the
 * first-pass ffmpeg process on `start()`, so mutating it here (with
 * `autoStart: false`) takes effect for the actual recording.
 */
export function applyFirstPassEncoderArgs(
  recorder: Recorder,
  encoderArgs: readonly string[]
): void {
  const config = (recorder as RecorderWithFirstPassConfig).config
  const current = config?.firstPassArgs
  if (!config || !Array.isArray(current)) {
    throw new Error(
      'playwright-recorder-plus recorder did not expose config.firstPassArgs; ' +
        'cannot apply the configured capture encoder. The recorder internals may have changed.'
    )
  }
  config.firstPassArgs = overrideFirstPassEncoderArgs(
    current as string[],
    encoderArgs
  )
}

async function startScreencastRecording(
  page: Page,
  outputPath: string,
  fps: FPS,
  quality: Quality,
  aspectRatio: AspectRatio,
  encoder: VideoEncoderPreset
): Promise<Recorder> {
  const { width, height } = getDimensions(aspectRatio, quality)

  const recorder = await attachRecorder(page as unknown as RecorderPage, {
    path: outputPath,
    intermediatePath: outputPath,
    autoStart: false,
    size: { width, height },
    fps,
    jpegQuality: 100,
  })

  // Apply the configured capture encoder. The library has no public option for
  // the first-pass encoder, so we override the recorder's internal first-pass
  // args in place (before start(), which autoStart: false guarantees).
  applyFirstPassEncoderArgs(recorder, resolveRecordingFirstPassArgs(encoder))

  // Keep the recorder's realtime first-pass mp4 as the final artifact.
  // This disables the library's background second-pass transcode so shared
  // worker teardown only needs to flush stop() after all tests have paused.
  ;(
    recorder as Recorder & {
      runSecondPass?: (firstPass: StopResult) => Promise<StopResult>
    }
  ).runSecondPass = async (firstPass) => firstPass

  return recorder
}

/**
 * Fails the recording if any overlay was `start()`ed but never `end()`ed.
 * Every live overlay must be paired so the renderer never sees a dangling
 * `assetStart` with no `assetEnd`. Only called on the success path, so it never
 * masks an error thrown by the video function itself.
 */
export function assertAllOverlaysEnded(
  runtimeContext: ReturnType<typeof createScreenCIRuntimeContext>
): void {
  const open = [...runtimeContext.asset.activeRuns.keys()]
  if (open.length === 0) return
  const names = open.map((name) => `"${name}"`).join(', ')
  throw new Error(
    `[screenci] Overlay(s) ${names} were started with .start() but never ended. Call end() for each overlay before the video function returns.`
  )
}

/**
 * Ends any overlays left open with `.start()`, in record order. Used by the
 * screenshot fixture, where a `.start()` with no `.end()` means "keep this
 * overlay visible in the still" rather than being an error (the still has no
 * timeline, so the renderer shows every overlay regardless).
 */
export function autoEndOpenOverlays(
  runtimeContext: ReturnType<typeof createScreenCIRuntimeContext>,
  recorder: EventRecorder
): void {
  for (const [name, run] of runtimeContext.asset.activeRuns) {
    recorder.addAssetEnd(name, 'auto')
    run.resolveFinished()
  }
  runtimeContext.asset.activeRuns.clear()
}

export async function withActiveRecordingContext<T>(params: {
  runtimeContext: ReturnType<typeof createScreenCIRuntimeContext>
  page: Page
  recorder: EventRecorder
  fn: () => Promise<T>
  /**
   * How to handle overlays left open at the end of the body. `'throw'` (video)
   * rejects dangling overlays; `'autoEnd'` (screenshot) ends them so a badge
   * `.start()`ed without `.end()` stays visible in the still.
   */
  unendedOverlays?: 'throw' | 'autoEnd'
  /**
   * Localized `text` field declaration to emit once at recording start so the
   * backend learns which fields exist and their seeds. `null`/omitted when the
   * spec declares no `text`.
   */
  textDeclaration?: TextDeclaration | null
}): Promise<T> {
  const {
    runtimeContext,
    page,
    recorder,
    fn,
    unendedOverlays = 'throw',
    textDeclaration,
  } = params

  setActiveScreenCIRuntimeContext(runtimeContext)

  try {
    return await runWithScreenCIRuntimeContext(runtimeContext, async () => {
      resetCueChain()
      setRuntimeCueRecorder(recorder)
      setRuntimeHideRecorder(recorder)
      setRuntimeAutoZoomRecorder(recorder)
      setRuntimeAssetRecorder(recorder)
      setRuntimeAudioRecorder(recorder)
      setRuntimeClickRecorder(recorder)
      setActiveCueRecorder(recorder)
      setActiveHideRecorder(recorder)
      setActiveAutoZoomRecorder(recorder)
      setActiveZoomPage(page)
      setActiveAssetRecorder(recorder)
      setActiveAudioRecorder(recorder)
      setActiveClickRecorder(recorder)
      bindClickRecorderToPage(page, recorder)
      setRuntimePage(page)

      // Fail fast on missing overlay/audio files before the body runs. Only
      // when actually recording and when testFilePath is known (relative asset
      // paths can only be resolved with an anchor file).
      if (
        runtimeContext.recordingDir !== null &&
        runtimeContext.testFilePath !== null
      ) {
        await validateRegisteredAssetPaths(runtimeContext.testFilePath)
        await validateRegisteredAudioPaths(runtimeContext.testFilePath)
      }

      if (textDeclaration) {
        recorder.addTextDeclare(
          textDeclaration.fields,
          textDeclaration.studioFields,
          textDeclaration.seed
        )
      }

      const result = await fn()
      if (unendedOverlays === 'autoEnd') {
        autoEndOpenOverlays(runtimeContext, recorder)
      } else {
        assertAllOverlaysEnded(runtimeContext)
      }
      // Rasterize deferred overlays now that the test body has succeeded and
      // every overlay's props/timing are known, before the recorder is written
      // to disk. On the failure path fn() throws, so this never runs and no
      // partial assets are produced (matching writeToFile, which only runs on a
      // passing test).
      await flushPendingOverlays(recorder)
      return result
    })
  } finally {
    setActiveScreenCIRuntimeContext(null)
  }
}

type VideoFixtureOptions = {
  recordOptions: RecordOptions
  renderOptions: RenderOptions | undefined
  /**
   * Active language for this recording pass, set by `video.languages(...)` in
   * per-language mode. `undefined` in shared mode and single-language videos.
   * Internal: prefer the `language` fixture in test bodies.
   */
  _screenciLanguage: string | undefined
  /**
   * Grouping name written to `metadata.videoName`, set by the fan-out builders
   * so per-language passes (which use unique test titles) still group into one
   * video. Falls back to the test title. Internal.
   */
  _screenciVideoName: string | undefined
  /**
   * The normalized localize spec for this video, set by `video.localize(...)`.
   * Drives the `narration` and `text` fixtures. Internal.
   */
  _screenciLocalize: NormalizedLocalize | undefined
  /**
   * The studio declaration for this video, set by `video.studio(...)`. Drives
   * the render/record deferral flags and the Studio-managed `narration`, `text`,
   * `overlays`, and `audio` fixtures. Internal.
   */
  _screenciStudio: StudioDeclaration | undefined
  /**
   * Absolute path of the `.screenci` script that registered this test, captured
   * by the fan-out builder. Asset paths are resolved relative to it, since
   * `testInfo.file` points at the builder module, not the script. Internal.
   */
  _screenciSourceFile: string | undefined
}

type VideoRuntimeFixtures = {
  /**
   * The language being recorded in this pass, for per-language navigation
   * (e.g. `page.goto('/' + language)`). `undefined` in shared mode and
   * non-localized videos.
   */
  language: string | undefined
  /**
   * Narration markers keyed by the cue names declared in `video.localize(...)`.
   * Each marker records timing (`()`, `.start()`, `.end()`); the text is owned by
   * the localize spec / Studio and is never exposed here.
   */
  narration: NarrationMarkers
  /**
   * Injected text field values for the active language, keyed by the field names
   * declared in `video.localize(...)`. Use them to fill localized content into
   * the page.
   */
  text: TextValues
  /**
   * Overlay controllers for the Studio-managed overlay names declared in
   * `video.studio({ overlays: [...] })`. Each is callable with `start()`/`end()`;
   * the file and placement come from Studio. Empty when none are declared.
   */
  overlays: Record<string, OverlayController>
  /**
   * Background-audio controllers for the Studio-managed track names declared in
   * `video.studio({ audio: [...] })`. Each is callable with `start()`/`end()`;
   * the file, volume, and repeat come from Studio. Empty when none are declared.
   */
  audio: Record<string, AudioController>
}

const _videoBase = base.extend<
  VideoFixtureOptions & VideoRuntimeFixtures,
  { recordingFinalizationQueue: WorkerFinalizationQueue }
>({
  recordOptions: [DEFAULT_VIDEO_OPTIONS, { option: true }],
  renderOptions: [undefined, { option: true }],
  _screenciLanguage: [undefined, { option: true }],
  _screenciVideoName: [undefined, { option: true }],
  _screenciLocalize: [undefined, { option: true }],
  _screenciStudio: [undefined, { option: true }],
  _screenciSourceFile: [undefined, { option: true }],

  language: async ({ _screenciLanguage }, use) => {
    await use(_screenciLanguage)
  },

  narration: async (
    { _screenciLocalize, _screenciStudio, renderOptions },
    use
  ) => {
    await use(
      buildNarrationMarkers(
        _screenciLocalize,
        narrationVoiceConfigFromRenderOptions(
          renderOptions,
          studioOptionFlags(_screenciStudio).renderOptions
        ),
        _screenciStudio?.narration ?? []
      )
    )
  },

  text: async (
    { _screenciLocalize, _screenciStudio, _screenciLanguage },
    use
  ) => {
    await use(
      buildTextValues(
        _screenciLocalize,
        _screenciLanguage,
        parseTextOverrides(),
        _screenciStudio?.text ?? []
      )
    )
  },

  overlays: async ({ _screenciStudio }, use) => {
    await use(buildStudioOverlays(_screenciStudio?.overlays ?? []))
  },

  audio: async ({ _screenciStudio }, use) => {
    await use(buildStudioAudioTracks(_screenciStudio?.audio ?? []))
  },
  recordingFinalizationQueue: [
    async ({}, use) => {
      const queue: WorkerFinalizationQueue = []
      await use(queue)

      if (process.env.SCREENCI_RECORDING !== 'true' || queue.length === 0) {
        return
      }

      await finalizeDeferredRecordingStops(queue)
    },
    { scope: 'worker' },
  ],

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
      _screenciStudio,
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
    },
    use,
    testInfo
  ) => {
    // Configure browser context. The viewport is derived from recordOptions
    // (with Studio record-option overrides applied when deferred); other
    // Playwright `use` options (colorScheme, locale, storageState, ...) are
    // forwarded so they take effect on the context screenci creates.
    const effectiveRecordOptions = resolveEffectiveRecordOptions(
      recordOptions,
      _screenciStudio,
      _screenciVideoName ?? testInfo.title
    )
    const aspectRatio =
      effectiveRecordOptions.aspectRatio ?? DEFAULT_ASPECT_RATIO
    const quality = effectiveRecordOptions.quality ?? DEFAULT_QUALITY
    const dimensions = getDimensions(aspectRatio, quality)
    const shouldRecord = process.env.SCREENCI_RECORDING === 'true'

    // deviceScaleFactor is intentionally not applied to video: the screencast
    // encoder expects frames at the viewport resolution.
    const context = await browser.newContext(
      buildScreenCIContextOptions({
        dimensions,
        applyLocaleDefault: shouldRecord,
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
      recordingFinalizationQueue,
      _screenciLanguage,
      _screenciLocalize,
      _screenciStudio,
      _screenciVideoName,
      _screenciSourceFile,
    },
    use,
    testInfo
  ) => {
    // Only record when explicitly enabled (record command)
    const shouldRecord = process.env.SCREENCI_RECORDING === 'true'
    // Apply Studio record-option overrides (when deferred) so the capture,
    // serialized recordOptions, and viewport all use the effective values.
    const recordOptions = resolveEffectiveRecordOptions(
      codeRecordOptions,
      _screenciStudio,
      _screenciVideoName ?? testInfo.title
    )
    const recorder = new EventRecorder(
      renderOptions,
      recordOptions,
      studioOptionFlags(_screenciStudio)
    )
    // Declared `text` fields (and the active language's seeds) emitted once at
    // recording start so the backend/Studio learn them.
    const textDeclaration = buildTextDeclaration(
      _screenciLocalize,
      _screenciLanguage,
      _screenciStudio?.text ?? []
    )
    // Asset paths are authored relative to the user's script. Playwright reports
    // `testInfo.file` as the builder module that registered the test, so prefer
    // the script path captured at the call site.
    const testFilePath = _screenciSourceFile ?? testInfo.file
    // In per-language mode each pass records one language; this filters cue
    // translations and stamps metadata so the upload becomes a single language
    // version. `null` (shared / single-language) keeps every language.
    recorder.setActiveLanguage(_screenciLanguage ?? null)

    // Per-language passes use a unique test title (so each gets its own
    // recording directory) but share one `videoName` so they group as language
    // versions of one video. Plain videos fall back to the test title.
    const videoName = _screenciVideoName ?? testInfo.title

    if (!shouldRecord) {
      const page = await context.newPage()
      const runtimeContext = createScreenCIRuntimeContext({
        recorder,
        page,
        testFilePath,
        recordOptions,
        renderOptions,
      })
      bindStillCaptureToPage(page)
      await setupMouseTracking(page, recorder)
      recorder.start()
      await withActiveRecordingContext({
        runtimeContext,
        page,
        recorder,
        textDeclaration,
        fn: async () => {
          await use(page)
        },
      })
      await page.close()
      return
    }

    // Get video options
    const aspectRatio = recordOptions.aspectRatio ?? DEFAULT_ASPECT_RATIO
    const quality = recordOptions.quality ?? DEFAULT_QUALITY
    const fps = recordOptions.fps ?? DEFAULT_FPS
    const encoder = recordOptions.encoder ?? DEFAULT_VIDEO_ENCODER
    const dimensions = getDimensions(aspectRatio, quality)

    const directoryName = escapeFileSystemPathSegment(testInfo.title)

    // Create directory path: .screenci/[video-title]/
    const videoDir = join(process.cwd(), '.screenci', directoryName)

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

    // Create page FIRST to ensure browser window is rendered
    const page = await context.newPage()
    const runtimeContext = createScreenCIRuntimeContext({
      recorder,
      page,
      testFilePath,
      recordingDir: videoDir,
      recordOptions,
      renderOptions,
    })

    await setupMouseTracking(page, recorder)

    // Navigate to blank page to ensure window is ready and rendered
    await page.goto('about:blank')

    // Wait for browser window to be fully rendered before starting recording
    // This prevents black screen captures
    await page.waitForTimeout(resolveRecordingTimingDuration(1500))

    const screenRecorder = await startScreencastRecording(
      page,
      videoPath,
      fps,
      quality,
      aspectRatio,
      encoder
    )

    await positionMouseAtViewportCenter(page, dimensions)
    await screenRecorder.start()
    // Mark the moment the video recording actually begins after the cursor is positioned.
    recorder.start()

    // Wrap `page.screenshot()` only now, AFTER the screen recorder has started.
    // The recorder captures a baseline frame via `page.screenshot()` inside
    // `screenRecorder.start()`; wrapping earlier intercepted that internal call
    // and leaked a spurious `screenshot` still into `.screenci/`. Restored in the
    // `finally` below so the recorder's pause/finalize stays native too.
    const restoreStillCapture = bindStillCaptureToPage(page)

    try {
      await withActiveRecordingContext({
        runtimeContext,
        page,
        recorder,
        textDeclaration,
        fn: async () => {
          await use(page)

          // Do not end video abruptly.
          await sleep(POST_VIDEO_PAUSE)
        },
      })
    } finally {
      restoreStillCapture()
      await screenRecorder.pause()
      recordingFinalizationQueue.push({ recorder: screenRecorder })

      await page.close()

      if (testInfo.status === 'passed') {
        const configDir = process.env.SCREENCI_CONFIG_DIR ?? process.cwd()
        await recorder.writeToFile(
          videoDir,
          videoName,
          relative(configDir, testFilePath)
        )
      }
    }
  },
})

type VideoType = TestType<
  PlaywrightTestArgs &
    PlaywrightTestOptions &
    VideoFixtureOptions &
    VideoRuntimeFixtures &
    PlaywrightWorkerArgs &
    PlaywrightWorkerOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>

type VideoArgs = Omit<PlaywrightTestArgs, 'page'> & {
  page: ScreenCIPage
} & PlaywrightTestOptions &
  VideoFixtureOptions &
  VideoRuntimeFixtures &
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
   *   // Video recorded at 16:9 1080p, 60fps (defaults)
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

  /**
   * Record one localized pass per language. By default each language is recorded
   * in its own pass with the browser `locale` set from the language; the body
   * receives the active `language`, the `narration` markers, and the `text`
   * values. Pass `mode: 'shared'` for a single capture shared across languages.
   *
   * Chainable with `.each(...)`.
   *
   * @example
   * ```ts
   * video.localize({
   *   narration: { en: { intro: 'Welcome.' }, fi: { intro: 'Tervetuloa.' } },
   *   text: { en: { heading: 'Dashboard' }, fi: { heading: 'Hallinta' } },
   * })('Tutorial', async ({ page, language, narration, text }) => {
   *   await page.goto('/' + language)
   *   await page.getByTestId('heading').fill(text.heading ?? '')
   *   await narration.intro()
   * })
   * ```
   */
  localize: VideoBuilder<VideoArgs>['localize']

  /**
   * Defer render/record options and declare Studio-managed narration, text,
   * overlays, and audio, configured in the ScreenCI web app. Chainable with
   * `.localize(...)` / `.each(...)`.
   *
   * @example
   * ```ts
   * video
   *   .studio({ recordOptions: true, narration: ['intro'], overlays: ['logo'] })
   *   .localize({ languages: ['en', 'fi'] })(
   *   'Product demo',
   *   async ({ page, narration, overlays }) => {
   *     await overlays.logo()
   *     await narration.intro()
   *   }
   * )
   * ```
   */
  studio: VideoBuilder<VideoArgs>['studio']

  /**
   * Produce a separate video per variant (viewport, theme, ...). Each variant
   * has its own video identity and history. Chainable with `.languages(...)`.
   *
   * @example
   * ```ts
   * video.each([
   *   { key: 'mobile', recordOptions: { aspectRatio: '9:16' } },
   *   { key: 'desktop', recordOptions: { aspectRatio: '16:9' } },
   * ])('Landing', async ({ page }) => {
   *   await page.goto('/')
   * })
   * ```
   */
  each: VideoBuilder<VideoArgs>['each']

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
 * import { video, voices } from 'screenci'
 *
 * // Voice is a render option; the localized text is declared with localize.
 * video.use({ renderOptions: { narration: { voice: { name: voices.Ava } } } })
 *
 * video.localize({
 *   narration: {
 *     en: {
 *       homepage: 'User navigates to homepage.',
 *       signup: 'Clicks the sign up button.',
 *     },
 *   },
 * })('Tutorial', async ({ page, narration }) => {
 *   await page.goto('https://example.com')
 *   await narration.homepage()
 *
 *   await page.click('text=Sign up')
 *   await narration.signup()
 * })
 * ```
 */
export const video = _videoBase as unknown as Video

// Attach the chainable fan-out builders. They register through the same test
// instance, so per-language / per-variant passes inherit every video fixture.
const _rootBuilder = createVideoBuilder<VideoArgs>(
  _videoBase as unknown as Parameters<typeof createVideoBuilder>[0]
)
video.localize = _rootBuilder.localize
video.studio = _rootBuilder.studio
video.each = _rootBuilder.each
