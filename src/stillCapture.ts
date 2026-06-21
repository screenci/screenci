import { mkdir as fsMkdir, rm as fsRm } from 'fs/promises'
import { join, relative } from 'path'
import type { Page } from '@playwright/test'
import { getDimensions } from './dimensions.js'
import { escapeFileSystemPathSegment } from './fileSystemName.js'
import { EventRecorder } from './events.js'
import type { IEventRecorder, ScreenshotInfo } from './events.js'
import { resolveCrop } from './crop.js'
import type { CropTarget, ScreenshotCropRecord } from './crop.js'
import { getScreenCIRuntimeContext } from './runtimeContext.js'
import {
  DEFAULT_VIDEO_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_QUALITY,
} from './defaults.js'
import type { RecordOptions, RenderOptions } from './types.js'
import type { StudioRenderOptionsSentinel } from './studio.js'

/** File name of the raw page capture written beside a still's `data.json`. */
const SCREENSHOT_FILE_NAME = 'screenshot.png'

/**
 * The screenci-specific options added to `page.screenshot()` inside a `video()`.
 * Everything else is forwarded to Playwright's native screenshot.
 */
export type StillScreenshotOptions = {
  /**
   * Names the still recording produced from this capture. The recording's title
   * is `"<video title> - <name>"`. Defaults to the `path` basename, then an
   * auto-indexed `screenshot`, `screenshot 2`, ...
   */
  name?: string
  /** Crop the still to a locator or pixel region (applied by the compositor). */
  crop?: CropTarget
}

type PlaywrightScreenshotOptions = NonNullable<
  Parameters<Page['screenshot']>[0]
>
type WrappedScreenshotOptions = PlaywrightScreenshotOptions &
  StillScreenshotOptions

/**
 * Resolve the still's name: explicit `name`, else the `path` basename (without
 * extension), else an auto-indexed fallback that stays unique within `used`.
 * Pure and exported for testing.
 */
export function resolveStillName(
  name: string | undefined,
  path: string | undefined,
  used: Set<string>
): string {
  let base = name?.trim() || undefined
  if (base === undefined && typeof path === 'string') {
    base =
      path
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]+$/, '') || undefined
  }
  if (base === undefined) {
    base = 'screenshot'
  }

  let candidate = base
  let n = 2
  while (used.has(candidate)) {
    candidate = `${base} ${n}`
    n++
  }
  used.add(candidate)
  return candidate
}

/** Injectable side effects, so the writer can be unit tested without real I/O. */
export type StillCaptureDeps = {
  /** Captures the page to `pngPath` and returns the raw bytes. */
  capture: (pngPath: string) => Promise<Buffer>
  fs?: {
    rm: (path: string) => Promise<void>
    mkdir: (path: string) => Promise<void>
  }
  makeRecorder?: (
    renderOptions: RenderOptions | StudioRenderOptionsSentinel | undefined,
    recordOptions: RecordOptions | undefined
  ) => IEventRecorder
}

/**
 * Write a standalone screenshot recording (its own `.screenci/<title>/` dir with
 * `output: 'screenshot'`). Discovered and uploaded by the CLI exactly like a
 * `screenshot()` fixture capture, so no rendering/backend changes are needed.
 * Returns the captured bytes so the wrapped `page.screenshot()` can return them.
 */
export async function writeStillRecording(params: {
  name: string
  screenciDir: string
  dimensions: { width: number; height: number }
  deviceScaleFactor: number
  crop?: ScreenshotCropRecord
  testFilePath: string | null
  configDir: string
  recordOptions: RecordOptions | undefined
  renderOptions: RenderOptions | StudioRenderOptionsSentinel | undefined
  deps: StillCaptureDeps
}): Promise<Buffer> {
  const {
    name,
    screenciDir,
    dimensions,
    deviceScaleFactor,
    crop,
    testFilePath,
    configDir,
    recordOptions,
    renderOptions,
    deps,
  } = params

  const rm =
    deps.fs?.rm ??
    ((path: string) => fsRm(path, { recursive: true, force: true }))
  const mkdir =
    deps.fs?.mkdir ??
    ((path: string) => fsMkdir(path, { recursive: true }).then(() => undefined))
  const makeRecorder =
    deps.makeRecorder ?? ((ro, rec) => new EventRecorder(ro, rec))

  // The still is named exactly by `name`; its directory and recording title both
  // use it directly (like a standalone screenshot() test's title).
  const dir = join(screenciDir, escapeFileSystemPathSegment(name))

  await rm(dir)
  await mkdir(dir)

  const buffer = await deps.capture(join(dir, SCREENSHOT_FILE_NAME))

  const screenshot: ScreenshotInfo = {
    path: SCREENSHOT_FILE_NAME,
    width: Math.round(dimensions.width * deviceScaleFactor),
    height: Math.round(dimensions.height * deviceScaleFactor),
    deviceScaleFactor,
  }

  const recorder = makeRecorder(renderOptions, recordOptions)
  recorder.start()
  // The crop is a render option (renderOptions.screenshot.crop), passed through
  // writeToFile rather than stored on ScreenshotInfo.
  await recorder.writeToFile(
    dir,
    name,
    testFilePath !== null ? relative(configDir, testFilePath) : undefined,
    { output: 'screenshot', screenshot, ...(crop !== undefined && { crop }) }
  )

  return buffer
}

/**
 * Wrap `page.screenshot()` so that, while recording a `video()`, each call also
 * writes a branded still as a separate screenshot recording, then returns the
 * native Buffer. Outside recording it strips the screenci-specific keys and
 * delegates straight to Playwright.
 *
 * Bound only to the `video()` fixture's page (never the `screenshot()` fixture's),
 * so the screenshot fixture's own implicit capture and the overlay rasterizer
 * keep the native behavior.
 */
export function bindStillCaptureToPage(page: Page): void {
  const original = page.screenshot.bind(page)
  const usedNames = new Set<string>()

  const wrapped = async (
    options?: WrappedScreenshotOptions
  ): Promise<Buffer> => {
    const { name, crop: cropTarget, ...playwrightOptions } = options ?? {}

    if (process.env.SCREENCI_RECORDING !== 'true') {
      return original(playwrightOptions)
    }

    const ctx = getScreenCIRuntimeContext()
    const recordOptions = ctx.recordOptions ?? DEFAULT_VIDEO_OPTIONS
    const aspectRatio = recordOptions.aspectRatio ?? DEFAULT_ASPECT_RATIO
    const quality = recordOptions.quality ?? DEFAULT_QUALITY
    const dimensions = getDimensions(aspectRatio, quality)

    const resolvedName = resolveStillName(
      name,
      typeof playwrightOptions.path === 'string'
        ? playwrightOptions.path
        : undefined,
      usedNames
    )

    let crop: ScreenshotCropRecord | undefined
    if (cropTarget !== undefined && ctx.page !== null) {
      crop = await resolveCrop(cropTarget, ctx.page)
    }

    const configDir = process.env.SCREENCI_CONFIG_DIR ?? process.cwd()

    return writeStillRecording({
      name: resolvedName,
      screenciDir: join(process.cwd(), '.screenci'),
      dimensions,
      // The video context never applies deviceScaleFactor (video.ts), so a still
      // captured mid-recording is at the viewport resolution (DSF 1).
      deviceScaleFactor: 1,
      ...(crop !== undefined && { crop }),
      testFilePath: ctx.testFilePath,
      configDir,
      recordOptions,
      renderOptions: ctx.renderOptions,
      deps: {
        capture: (pngPath) => original({ ...playwrightOptions, path: pngPath }),
      },
    })
  }

  ;(page as unknown as { screenshot: typeof wrapped }).screenshot = wrapped
}
