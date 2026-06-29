import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import { getRuntimePage, getRuntimeRecordingDir } from './runtimeContext.js'

const ffmpegPath = ffmpegStatic as unknown as string | null

const OVERLAY_ROOT_ID = 'screenci-overlay-root'

/**
 * Name of the cross-run overlay cache directory, kept as a sibling of the
 * per-recording directories under `.screenci`. Rendered overlays are keyed by
 * their deterministic input hash here so unchanged overlays are served byte for
 * byte from a previous run (skipping both the browser render and a fresh,
 * non-deterministic encode that would otherwise change the upload hash and force
 * a re-upload every run). The CLI's recording-directory wipe must preserve this
 * directory, so the name is shared from here.
 */
export const OVERLAY_CACHE_DIR_NAME = '.overlay-cache'

// Render overlays at 2x pixel density so the PNG carries more detail than the
// on-screen overlay size. The renderer then downscales it to the placement box,
// which keeps text and edges crisp. 2x keeps overlays sharp at typical sizes
// while roughly quartering the byte cost of the previous 4x density. Overlay
// content is bounded by the off-screen page viewport, so the screenshot stays
// well under GPU texture limits.
export const DEFAULT_OVERLAY_DEVICE_SCALE_FACTOR = 2

// Bump when anything that affects rasterized output changes (the HTML wrapper,
// screenshot options, default density) so stale cache entries are invalidated.
const RASTERIZE_CACHE_VERSION = 2

export type HtmlRasterizeResult = {
  /** Absolute path to the written PNG. */
  path: string
  /** SHA-256 of the PNG bytes, used for upload de-duplication. */
  fileHash: string
  /** Intrinsic rendered width in pixels. */
  width: number
  /** Intrinsic rendered height in pixels. */
  height: number
}

export type HtmlRasterizeRequest = {
  html: string
  /** Device scale factor for crisp output. Defaults to {@link DEFAULT_OVERLAY_DEVICE_SCALE_FACTOR}. */
  deviceScaleFactor?: number
  /** Extra CSS injected into the overlay document `<head>` (already merged with the global default). */
  css?: string
  /** Transparent padding (CSS px) added around the overlay content so animations can move beyond it without clipping. */
  capturePadding?: number
}

/**
 * Produces transparent PNG bytes plus the rendered content size. Injectable so
 * tests can avoid launching a real browser.
 */
export type HtmlRasterizer = (
  request: HtmlRasterizeRequest
) => Promise<{ buffer: Buffer; width: number; height: number }>

let rasterizer: HtmlRasterizer = playwrightHtmlRasterizer
// Cache only the real (browser) rasterizer. Injected rasterizers are used by
// tests, where caching across a shared tmp dir would leak between cases.
let cacheEnabled = true

export function setHtmlRasterizer(fn: HtmlRasterizer): void {
  rasterizer = fn
  cacheEnabled = false
}

/** Test hook: re-enable caching after injecting a (counting) rasterizer. */
export function setOverlayCacheEnabled(enabled: boolean): void {
  cacheEnabled = enabled
}

// CSS injected into every overlay document, on top of the minimal reset. Set it
// once (e.g. to your compiled Tailwind stylesheet) so overlays can be styled
// with `className`. Per-overlay `css` is merged on top of this.
let defaultOverlayCss = ''

/**
 * Sets CSS injected into every HTML/React overlay document. Pass a compiled
 * stylesheet (for example Tailwind's output) so overlays can use `className`.
 * Per-overlay `css` is appended after this.
 */
export function setOverlayCss(css: string): void {
  defaultOverlayCss = css
}

/** Merges the global default overlay CSS with a per-overlay override. */
export function resolveOverlayCss(css?: string): string {
  return [defaultOverlayCss, css]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join('\n')
}

/**
 * The fully resolved inputs that determine a rasterized overlay's bytes. `css`
 * is the already-merged stylesheet (see {@link resolveOverlayCss}). Used both
 * for the cross-run disk cache key and for in-run de-duplication of identical
 * deferred overlays, so both paths key off the exact same string.
 */
export type OverlayRasterizeKeyInput =
  | {
      kind: 'image'
      deviceScaleFactor: number
      capturePadding: number
      css: string
      html: string
    }
  | {
      kind: 'animation'
      deviceScaleFactor: number
      capturePadding: number
      fps: number
      durationMs: number
      css: string
      html: string
    }

/**
 * Content hash that uniquely identifies a rasterized overlay's output. The
 * single source of truth for both the on-disk cache key and the in-run dedupe
 * key, so the two can never drift apart.
 */
export function overlayInputHash(input: OverlayRasterizeKeyInput): string {
  const body =
    input.kind === 'image'
      ? `${RASTERIZE_CACHE_VERSION} ${input.deviceScaleFactor} ${input.capturePadding} ${input.css} ${input.html}`
      : `${RASTERIZE_CACHE_VERSION} anim ${input.deviceScaleFactor} ${input.capturePadding} ${input.fps} ${input.durationMs} ${input.css} ${input.html}`
  return createHash('sha256').update(body).digest('hex')
}

function wrapOverlayHtml(
  html: string,
  options: { css?: string; capturePadding?: number } = {}
): string {
  const { css, capturePadding } = options
  // capturePadding is transparent padding on the root, so the captured box (the
  // element/clip bounding box) grows by it on every side. Animations can then
  // translate/scale/rotate within that margin without being clipped, replacing
  // the manual "stage" wrapper.
  const padding =
    capturePadding !== undefined && capturePadding > 0
      ? `;padding:${capturePadding}px`
      : ''
  const userStyle =
    css !== undefined && css.length > 0 ? `<style>${css}</style>` : ''
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;background:transparent}' +
    `#${OVERLAY_ROOT_ID}{display:inline-block${padding}}` +
    `</style>${userStyle}</head><body><div id="${OVERLAY_ROOT_ID}">${html}</div></body></html>`
  )
}

async function playwrightHtmlRasterizer(
  request: HtmlRasterizeRequest
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const page = getRuntimePage()
  if (page === null) {
    throw new Error(
      '[screenci] Cannot rasterize an HTML overlay without an active recording page.'
    )
  }
  const browser = page.context().browser()
  if (browser === null) {
    throw new Error(
      '[screenci] Cannot rasterize an HTML overlay: the browser is not available.'
    )
  }

  // A dedicated context with no video recording so the overlay render never
  // leaks into the recording page or its captured video.
  const overlayContext = await browser.newContext({
    deviceScaleFactor:
      request.deviceScaleFactor ?? DEFAULT_OVERLAY_DEVICE_SCALE_FACTOR,
  })
  try {
    const overlayPage = await overlayContext.newPage()
    await overlayPage.setContent(
      wrapOverlayHtml(request.html, {
        ...(request.css !== undefined && { css: request.css }),
        ...(request.capturePadding !== undefined && {
          capturePadding: request.capturePadding,
        }),
      }),
      { waitUntil: 'load' }
    )
    const root = overlayPage.locator(`#${OVERLAY_ROOT_ID}`)
    const box = await root.boundingBox()
    const buffer = await root.screenshot({ omitBackground: true, type: 'png' })
    return {
      buffer,
      width: box ? Math.round(box.width) : 0,
      height: box ? Math.round(box.height) : 0,
    }
  } finally {
    await overlayContext.close().catch(() => {})
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

type RasterizeOutput = { buffer: Buffer; width: number; height: number }

/**
 * Renders the overlay, reusing a cached PNG when the same input (markup +
 * density) was already rendered in a previous run. The per-recording directory
 * is wiped each run, so the cache lives one level up (`.screenci/.overlay-cache`)
 * and survives across runs. Rendering an overlay launches a browser context, so
 * skipping unchanged ones speeds up the author loop noticeably.
 */
async function renderOverlay(
  recordingDir: string,
  deviceScaleFactor: number,
  html: string,
  css: string,
  capturePadding: number
): Promise<RasterizeOutput> {
  const request: HtmlRasterizeRequest = {
    html,
    deviceScaleFactor,
    ...(css.length > 0 && { css }),
    ...(capturePadding > 0 && { capturePadding }),
  }
  if (!cacheEnabled) {
    return rasterizer(request)
  }

  const inputHash = overlayInputHash({
    kind: 'image',
    deviceScaleFactor,
    capturePadding,
    css,
    html,
  })
  const cacheDir = join(dirname(recordingDir), OVERLAY_CACHE_DIR_NAME)
  const pngPath = join(cacheDir, `${inputHash}.png`)
  const metaPath = join(cacheDir, `${inputHash}.json`)

  if (existsSync(pngPath) && existsSync(metaPath)) {
    const { width, height } = JSON.parse(readFileSync(metaPath, 'utf-8')) as {
      width: number
      height: number
    }
    return { buffer: readFileSync(pngPath), width, height }
  }

  const result = await rasterizer(request)
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(pngPath, result.buffer)
  writeFileSync(
    metaPath,
    JSON.stringify({ width: result.width, height: result.height })
  )
  return result
}

/**
 * Rasterizes overlay HTML to a transparent PNG written into the per-recording
 * directory so the upload step picks it up alongside the recording. Returns the
 * path, content hash, and intrinsic pixel size. Unchanged overlays are served
 * from a cross-run cache instead of re-rendering.
 */
export async function rasterizeHtmlOverlay(opts: {
  name: string
  html: string
  deviceScaleFactor?: number
  css?: string
  capturePadding?: number
  /**
   * When `true`, `css` is already merged with the global default (see
   * {@link resolveOverlayCss}) and is used verbatim. The deferred flush passes
   * the frozen, resolved CSS this way so it is not prefixed with the default a
   * second time.
   */
  cssResolved?: boolean
}): Promise<HtmlRasterizeResult> {
  const recordingDir = getRuntimeRecordingDir()
  if (recordingDir === null) {
    throw new Error(
      '[screenci] Cannot write a generated overlay: no active recording directory.'
    )
  }
  const deviceScaleFactor =
    opts.deviceScaleFactor ?? DEFAULT_OVERLAY_DEVICE_SCALE_FACTOR
  const css =
    opts.cssResolved === true ? (opts.css ?? '') : resolveOverlayCss(opts.css)
  const { buffer, width, height } = await renderOverlay(
    recordingDir,
    deviceScaleFactor,
    opts.html,
    css,
    opts.capturePadding ?? 0
  )
  const fileHash = createHash('sha256').update(buffer).digest('hex')
  const dir = join(recordingDir, 'generated')
  mkdirSync(dir, { recursive: true })
  const path = join(
    dir,
    `${sanitizeName(opts.name)}-${fileHash.slice(0, 16)}.png`
  )
  writeFileSync(path, buffer)
  return { path, fileHash, width, height }
}

// ─── Animated overlays ────────────────────────────────────────────────────────

export const DEFAULT_ANIMATION_FPS = 30

/**
 * Number of frames captured for an animation of `durationMs` at `fps`. At least
 * one frame so a zero-length capture still produces a valid clip. Pure so the
 * sampling math can be unit-tested without a browser.
 */
export function framesForDuration(durationMs: number, fps: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error(
      `[screenci] Animated overlay durationMs must be a finite number >= 0. Received: ${String(durationMs)}`
    )
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(
      `[screenci] Animated overlay fps must be a finite number > 0. Received: ${String(fps)}`
    )
  }
  return Math.max(1, Math.round(durationMs / (1000 / fps)))
}

export type AnimatedHtmlRasterizeResult = {
  /** Absolute path to the written .mp4 (two video streams: color + alpha matte). */
  path: string
  /** SHA-256 of the file bytes, used for upload de-duplication. */
  fileHash: string
  /** Intrinsic rendered width in CSS pixels. */
  width: number
  /** Intrinsic rendered height in CSS pixels. */
  height: number
  /** Capture length in milliseconds. */
  durationMs: number
}

export type AnimatedHtmlRasterizeRequest = {
  html: string
  /** Capture length in milliseconds. */
  durationMs: number
  /** Capture frame rate. */
  fps: number
  /** Device scale factor for crisp output. Defaults to {@link DEFAULT_OVERLAY_DEVICE_SCALE_FACTOR}. */
  deviceScaleFactor?: number
  /** Extra CSS injected into the overlay document `<head>` (already merged with the global default). */
  css?: string
  /** Transparent padding (CSS px) added around the overlay content so the animation can move beyond it without clipping. */
  capturePadding?: number
}

/**
 * Produces the encoded overlay clip bytes plus the rendered content size.
 * Injectable so tests can avoid launching a real browser / running ffmpeg.
 */
export type AnimatedHtmlRasterizer = (
  request: AnimatedHtmlRasterizeRequest
) => Promise<{ buffer: Buffer; width: number; height: number }>

let animatedRasterizer: AnimatedHtmlRasterizer =
  playwrightAnimatedHtmlRasterizer

export function setAnimatedHtmlRasterizer(fn: AnimatedHtmlRasterizer): void {
  animatedRasterizer = fn
  cacheEnabled = false
}

// Single ffmpeg graph that turns the RGBA PNG sequence into one MP4 carrying two
// NVDEC-decodable H.264 streams: stream 0 is the opaque color, stream 1 is the
// alpha matte (its luma IS the alpha plane). Dimensions are padded to even so
// yuv420p is valid. The matte is converted full-range then tagged tv (a
// metadata-only label) so the renderer's CUDA graph never range-converts it and
// the alpha reaches full opacity — the same recipe NarrationRenderer uses for
// its shape mask (a limited-range matte caps opacity at ~92%).
const ANIMATION_FILTER_COMPLEX =
  '[0:v]pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:color=black@0,split=2[a][b];' +
  '[a]format=yuv420p[col];' +
  '[b]alphaextract,scale=in_range=full:out_range=full,format=yuv420p,setparams=range=tv[alp]'

async function captureAnimationFrames(
  request: AnimatedHtmlRasterizeRequest
): Promise<{ frames: Buffer[]; width: number; height: number }> {
  const page = getRuntimePage()
  if (page === null) {
    throw new Error(
      '[screenci] Cannot rasterize an animated overlay without an active recording page.'
    )
  }
  const browser = page.context().browser()
  if (browser === null) {
    throw new Error(
      '[screenci] Cannot rasterize an animated overlay: the browser is not available.'
    )
  }

  const overlayContext = await browser.newContext({
    deviceScaleFactor:
      request.deviceScaleFactor ?? DEFAULT_OVERLAY_DEVICE_SCALE_FACTOR,
  })
  try {
    const overlayPage = await overlayContext.newPage()
    // Install a virtual clock at t=0 before loading so the animation starts from
    // its first frame; advancing the clock deterministically samples each frame.
    await overlayPage.clock.install({ time: 0 })
    await overlayPage.setContent(
      wrapOverlayHtml(request.html, {
        ...(request.css !== undefined && { css: request.css }),
        ...(request.capturePadding !== undefined && {
          capturePadding: request.capturePadding,
        }),
      }),
      { waitUntil: 'load' }
    )
    const root = overlayPage.locator(`#${OVERLAY_ROOT_ID}`)
    const box = await root.boundingBox()
    // Capture a fixed clip (the initial layout box) for every frame so the
    // encoded stream has constant dimensions. Animate transform/opacity rather
    // than layout size to stay within the box.
    const clip =
      box !== null
        ? { x: box.x, y: box.y, width: box.width, height: box.height }
        : undefined

    const frames: Buffer[] = []
    const frameCount = framesForDuration(request.durationMs, request.fps)
    let elapsed = 0
    for (let i = 0; i < frameCount; i++) {
      frames.push(
        await overlayPage.screenshot({
          omitBackground: true,
          type: 'png',
          ...(clip !== undefined && { clip }),
        })
      )
      // Advance to the next exact frame timestamp (integer ms, no drift).
      const next = Math.round(((i + 1) * 1000) / request.fps)
      await overlayPage.clock.runFor(next - elapsed)
      elapsed = next
    }

    return {
      frames,
      width: box ? Math.round(box.width) : 0,
      height: box ? Math.round(box.height) : 0,
    }
  } finally {
    await overlayContext.close().catch(() => {})
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ffmpegPath === null) {
      reject(
        new Error(
          '[screenci] ffmpeg binary not found; cannot encode an animated overlay.'
        )
      )
      return
    }
    const child = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `[screenci] ffmpeg exited with code ${String(code)} while encoding an animated overlay.\n${stderr.slice(-2000)}`
        )
      )
    })
  })
}

async function encodeAnimationFrames(
  frames: Buffer[],
  fps: number
): Promise<Buffer> {
  const tmp = await mkdtemp(join(tmpdir(), 'screenci-anim-'))
  try {
    await Promise.all(
      frames.map((buffer, i) =>
        writeFile(
          join(tmp, `frame_${String(i + 1).padStart(5, '0')}.png`),
          buffer
        )
      )
    )
    const outPath = join(tmp, 'overlay.mp4')
    await runFfmpeg([
      '-y',
      '-framerate',
      String(fps),
      '-i',
      join(tmp, 'frame_%05d.png'),
      '-filter_complex',
      ANIMATION_FILTER_COMPLEX,
      '-map',
      '[col]',
      '-map',
      '[alp]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'veryfast',
      '-movflags',
      '+faststart',
      outPath,
    ])
    return await readFile(outPath)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

async function playwrightAnimatedHtmlRasterizer(
  request: AnimatedHtmlRasterizeRequest
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { frames, width, height } = await captureAnimationFrames(request)
  const buffer = await encodeAnimationFrames(frames, request.fps)
  return { buffer, width, height }
}

/**
 * Renders an animated overlay, reusing a cached clip when the same input
 * (markup + density + fps + duration) was already rendered in a previous run.
 * Mirrors {@link renderOverlay} but caches the encoded .mp4.
 */
async function renderAnimatedOverlay(
  recordingDir: string,
  request: AnimatedHtmlRasterizeRequest
): Promise<{ buffer: Buffer; width: number; height: number }> {
  if (!cacheEnabled) {
    return animatedRasterizer(request)
  }

  const deviceScaleFactor =
    request.deviceScaleFactor ?? DEFAULT_OVERLAY_DEVICE_SCALE_FACTOR
  const inputHash = overlayInputHash({
    kind: 'animation',
    deviceScaleFactor,
    capturePadding: request.capturePadding ?? 0,
    fps: request.fps,
    durationMs: request.durationMs,
    css: request.css ?? '',
    html: request.html,
  })
  const cacheDir = join(dirname(recordingDir), OVERLAY_CACHE_DIR_NAME)
  const clipPath = join(cacheDir, `${inputHash}.mp4`)
  const metaPath = join(cacheDir, `${inputHash}.anim.json`)

  if (existsSync(clipPath) && existsSync(metaPath)) {
    const { width, height } = JSON.parse(readFileSync(metaPath, 'utf-8')) as {
      width: number
      height: number
    }
    return { buffer: readFileSync(clipPath), width, height }
  }

  const result = await animatedRasterizer(request)
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(clipPath, result.buffer)
  writeFileSync(
    metaPath,
    JSON.stringify({ width: result.width, height: result.height })
  )
  return result
}

/**
 * Rasterizes an animated HTML/React overlay to a transparent clip (a single
 * .mp4 with a color stream and an alpha-matte stream) written into the
 * per-recording directory for upload. Returns the path, content hash, intrinsic
 * size, and capture duration. Unchanged overlays are served from the cross-run
 * cache instead of re-rendering.
 */
export async function rasterizeAnimatedHtmlOverlay(opts: {
  name: string
  html: string
  durationMs: number
  fps?: number
  deviceScaleFactor?: number
  css?: string
  capturePadding?: number
  /**
   * When `true`, `css` is already merged with the global default (see
   * {@link resolveOverlayCss}) and is used verbatim. The deferred flush passes
   * the frozen, resolved CSS this way so it is not prefixed with the default a
   * second time.
   */
  cssResolved?: boolean
}): Promise<AnimatedHtmlRasterizeResult> {
  const recordingDir = getRuntimeRecordingDir()
  if (recordingDir === null) {
    throw new Error(
      '[screenci] Cannot write a generated overlay: no active recording directory.'
    )
  }
  const fps = opts.fps ?? DEFAULT_ANIMATION_FPS
  const deviceScaleFactor =
    opts.deviceScaleFactor ?? DEFAULT_OVERLAY_DEVICE_SCALE_FACTOR
  // Validate sampling parameters up front (also exercised by the real capture).
  framesForDuration(opts.durationMs, fps)
  const css =
    opts.cssResolved === true ? (opts.css ?? '') : resolveOverlayCss(opts.css)

  const { buffer, width, height } = await renderAnimatedOverlay(recordingDir, {
    html: opts.html,
    durationMs: opts.durationMs,
    fps,
    deviceScaleFactor,
    ...(css.length > 0 && { css }),
    ...(opts.capturePadding !== undefined && {
      capturePadding: opts.capturePadding,
    }),
  })
  const fileHash = createHash('sha256').update(buffer).digest('hex')
  const dir = join(recordingDir, 'generated')
  mkdirSync(dir, { recursive: true })
  const path = join(
    dir,
    `${sanitizeName(opts.name)}-${fileHash.slice(0, 16)}.mp4`
  )
  writeFileSync(path, buffer)
  return { path, fileHash, width, height, durationMs: opts.durationMs }
}
