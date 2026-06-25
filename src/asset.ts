import type { Locator } from '@playwright/test'
import type { IEventRecorder, OverlayPlacement } from './events.js'
import { overlayRect } from './overlayRect.js'
import { captureCallerFile } from './callerFile.js'
import { access, readFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { resolveRecordingTimingDuration } from './runtimeMode.js'
import {
  resolveOverlayCss,
  DEFAULT_OVERLAY_DEVICE_SCALE_FACTOR,
  DEFAULT_ANIMATION_FPS,
} from './htmlRasterizer.js'

export { setOverlayCss } from './htmlRasterizer.js'
import {
  getScreenCIRuntimeContext,
  getRuntimeAssetRecorder,
  getRuntimePage,
  getRuntimeRecordingDir,
  setRuntimeAssetRecorder,
  resetAssetRuntimeState,
  type ActiveAssetRun,
} from './runtimeContext.js'

export type { OverlayPlacement } from './events.js'

/**
 * Minimal structural stand-in for a React element. Defined here so the core SDK
 * never has to depend on `@types/react`: any JSX element is assignable to this,
 * while a plain {@link OverlayConfig} object is not (it has no `type`/`props`).
 * React itself is detected structurally at runtime and rendered lazily, so it
 * stays an optional peer dependency.
 */
export type ReactElementLike = {
  type: unknown
  props: unknown
  key?: string | null
}

/**
 * Placement and capture fields shared by every overlay variant. Placement is
 * flat (not nested) and uses CSS pixels in the recording viewport (the same
 * space as Playwright's `boundingBox()`, `page.mouse`, and `viewportSize()`),
 * each defaulting independently: `relativeTo: 'recording'`, `x: 0`, `y: 0`.
 * Provide exactly one of `width`/`height` (the other follows the source aspect,
 * or `aspectRatio`). When no placement field is set, the overlay fills the
 * recording area.
 */
type OverlayCommon = {
  /** Reference box for placement coordinates. Defaults to `'recording'`. */
  relativeTo?: 'screen' | 'recording'
  /** Left edge in CSS px of the recording viewport. Defaults to `0`. */
  x?: number
  /** Top edge in CSS px of the recording viewport. Defaults to `0`. */
  y?: number
  /** Width in CSS px. Provide instead of `height` (exactly one). */
  width?: number
  /** Height in CSS px. Provide instead of `width` (exactly one). */
  height?: number
  /**
   * Aspect ratio (`width / height`) used to derive the unset axis from the one
   * you provide, instead of the source's intrinsic aspect. Optional.
   */
  aspectRatio?: number
  /**
   * Fill the whole frame instead of positioning the overlay. `'recording'`
   * fills the recording area (the same as omitting every placement field);
   * `'screen'` fills the entire output frame, including any padding around the
   * recording. Overrides `x`/`y`/`width`/`height`.
   */
  fill?: 'recording' | 'screen'
  /**
   * Position the overlay over a live element, captured at recording time from
   * the locator's bounding box. The overlay is sized to that box (plus
   * {@link margin}) and fills it, so it frames the element exactly. Overrides
   * `x`/`y`/`width`/`height`/`relativeTo`/`fill` (placement is always
   * recording-relative). HTML files, inline `html`, and React elements only;
   * your content should fill its box (for example `width:100%;height:100%`).
   */
  over?: Locator
  /**
   * Extra space (CSS px) added around the {@link over} element on every side,
   * so the overlay surrounds it rather than sitting exactly on its edges. Only
   * valid together with `over`.
   */
  margin?: number
  /**
   * Visible length for the blocking call form (`await overlays.logo(1200)`).
   * Omit when driving with `start()`/`end()`. Image/HTML/React overlays only.
   *
   * For animated overlays (`animate: true`) this is also the capture length: it
   * is required when driving with `start()`/`end()` (the capture length is
   * otherwise unknown).
   */
  durationMs?: number
  /**
   * Capture the overlay as an animation so its CSS/JS animation plays back in
   * the video (HTML files and React elements only). The animation is sampled
   * over the resolved duration with a transparent background preserved.
   */
  animate?: boolean
  /** Animation capture frame rate. Only valid with `animate`. Defaults to `30`. */
  fps?: number
  /**
   * Extra CSS injected into the overlay document so it can be styled with
   * `className` (for example a compiled Tailwind stylesheet). Merged on top of
   * any global CSS set via `setOverlayCss`. HTML files and React elements only.
   */
  css?: string
  /**
   * Transparent padding (CSS px) added around the overlay content. Lets an
   * animation move, scale, or rotate beyond its box without being clipped (an
   * automatic "stage"), at the cost of the placement sizing the padded box.
   * HTML files and React elements only.
   */
  capturePadding?: number
}

/** Fields that only apply to a `.mp4` video overlay (a file `path`). */
type OverlayVideoFields = {
  /**
   * Soundtrack level for `.mp4` overlays as a linear gain. `1` (the default)
   * plays the source at its natural level, `0` mutes it, and values above `1`
   * boost it (e.g. `2` is twice the natural level). Capped at
   * {@link MAX_AUDIO_LEVEL}.
   */
  volume?: number
  /**
   * Playback-rate multiplier for `.mp4` overlays. `2` plays the clip (and its
   * audio) twice as fast, `0.5` at half speed; `1` (the default) is the natural
   * rate. Works like {@link speed} for a recording. For a blocking overlay
   * (`await overlays.clip()`) this also shortens or lengthens the window it
   * holds, so later content shifts; a live overlay (`start()`/`end()`) keeps
   * its window and just plays the source faster/slower inside it. Mutually
   * exclusive with {@link time}. Video overlays only.
   */
  speed?: number
  /**
   * Target playback duration (ms) for a `.mp4` overlay, an alternative to
   * {@link speed}: the clip is sped up or slowed down so its source plays over
   * exactly this long. Works like {@link time} for a recording. Mutually
   * exclusive with {@link speed}. Video overlays only.
   */
  time?: number
}

/**
 * An overlay drawn from a file `path`: `.svg`/`.png` (image), `.mp4` (video),
 * or `.html` (rendered). Only this variant accepts the {@link OverlayVideoFields}
 * (`volume`/`speed`/`time`), which apply to `.mp4` files; they are rejected at
 * recording time for image and HTML files.
 */
export type FileOverlayConfig = OverlayCommon &
  OverlayVideoFields & {
    /** File path: `.html` (rendered), `.svg`/`.png` (image), or `.mp4` (video). */
    path: string
    element?: never
    html?: never
  }

/**
 * An overlay rendered from a React `element` to a transparent PNG (or animated
 * clip). Use this for overlays built in JSX. Video-only fields
 * (`volume`/`speed`/`time`) do not apply.
 */
export type ElementOverlayConfig = OverlayCommon & {
  /** A React element, rendered to a transparent PNG. */
  element: ReactElementLike
  path?: never
  html?: never
  volume?: never
  speed?: never
  time?: never
}

/**
 * An overlay rendered from an inline `html` fragment to a transparent PNG (or
 * animated clip). Use this when you want plain HTML without a React dependency
 * or a separate `.html` file. The markup must be a single-rooted fragment (for
 * example `'<div class="badge">New</div>'`), never a full document: it must
 * contain exactly one top-level element, and `<!doctype>`, `<html>`, `<head>`,
 * and `<body>` tags are rejected because screenci wraps the markup in its own
 * document. Video-only fields (`volume`/`speed`/`time`) do not apply.
 */
export type HtmlOverlayConfig = OverlayCommon & {
  /** An inline HTML fragment (single root element), rendered to a PNG. */
  html: string
  path?: never
  element?: never
  volume?: never
  speed?: never
  time?: never
}

/**
 * Display options for an overlay. An overlay draws its content from exactly one
 * source, which selects the variant: a file {@link FileOverlayConfig.path}, a
 * React {@link ElementOverlayConfig.element}, or an inline
 * {@link HtmlOverlayConfig.html} fragment. The `path` variant additionally
 * accepts the video-only `volume`/`speed`/`time` fields (for `.mp4` files); the
 * others reject them at compile time.
 */
export type OverlayConfig =
  | FileOverlayConfig
  | ElementOverlayConfig
  | HtmlOverlayConfig

/**
 * Upper bound for an audio level (linear gain). `4` is +12 dB, plenty of
 * headroom for a boost while guarding against accidental extreme distortion.
 */
export const MAX_AUDIO_LEVEL = 4

/**
 * A value accepted by {@link createOverlays} for each key:
 *
 * - a `string` file path (`.html`/`.svg`/`.png`/`.mp4`),
 * - a React element, or
 * - an {@link OverlayConfig} object.
 */
export type OverlayInput = string | ReactElementLike | OverlayConfig

/**
 * A factory that builds an {@link OverlayConfig} from caller-supplied props.
 * Use this to make an overlay programmatic: the returned config (its content and
 * its placement) can depend on values only known at runtime, for example a
 * locator's position captured with {@link overlayRect}. Both the `element`/`html`
 * content and the placement may vary per call.
 *
 * @example
 * ```tsx
 * const overlays = createOverlays({
 *   note: (p: { text: string }) => ({ html: `<div class="note">${p.text}</div>` }),
 * })
 * await overlays.note({ text: 'Saved' })(1200)
 * ```
 */
export type OverlayConfigFactory<P = unknown> = (props: P) => OverlayConfig

/**
 * A value accepted by {@link createOverlays}: a static input or a config
 * factory. The factory arm uses a `never` parameter so a factory with any
 * concrete props type is assignable (function parameters are contravariant);
 * {@link OverlayControllerFor} then recovers the real props type per key.
 */
export type OverlayInputOrFactory =
  | OverlayInput
  | ((props: never) => OverlayConfig)

/**
 * Overlay file paths registered by {@link createOverlays}, each attributed to
 * the `.screenci` script that declared it (or `null` when the caller could not
 * be determined). Attribution lets {@link validateRegisteredAssetPaths} check
 * only the assets a given recording's script declared, so unrelated assets
 * registered by other test files sharing the worker are not validated against
 * the wrong test file.
 */
const registeredAssets: Array<{ ownerFile: string | null; path: string }> = []

function registerAssetPath(path: string): void {
  const ownerFile = captureCallerFile(import.meta.url)
  if (
    registeredAssets.some(
      (entry) => entry.path === path && entry.ownerFile === ownerFile
    )
  ) {
    return
  }
  registeredAssets.push({ ownerFile, path })
}

// One frame at 24fps — ensures at least one rendered frame captures each asset
// state when an overlay is started and ended back-to-back.
const ONE_FRAME_MS = 1000 / 24

// Blocking sleep — spin until the elapsed time has passed. Injectable for tests.
let sleepFn = (ms: number): void => {
  const end = performance.now() + ms
  while (performance.now() < end) {
    /* spin */
  }
}

export function setAssetSleepFn(fn: (ms: number) => void): void {
  sleepFn = fn
}

function sleepForAssetFrameGap(): void {
  const durationMs = resolveRecordingTimingDuration(2 * ONE_FRAME_MS)
  if (durationMs <= 0) return
  sleepFn(durationMs)
}

export function setActiveAssetRecorder(recorder: IEventRecorder | null): void {
  setRuntimeAssetRecorder(recorder)
  resetAssetRuntimeState()
}

export function resetRegisteredAssetPaths(): void {
  registeredAssets.length = 0
}

export function resetAssetChain(): void {
  resetAssetRuntimeState()
}

/**
 * Validates the overlay files declared by the `.screenci` script at
 * {@link testFilePath} (plus any unattributed registrations), resolving each
 * as-is and relative to that file. Throws "Asset file not found" on the first
 * missing file. Wired into the record flow so a missing overlay fails fast
 * before the test body runs, rather than only when the overlay is first shown.
 *
 * Assets attributed to a different test file are skipped: another script sharing
 * the worker may legitimately reference a file that does not resolve here.
 */
export async function validateRegisteredAssetPaths(
  testFilePath: string | null
): Promise<void> {
  for (const { ownerFile, path } of registeredAssets) {
    if (ownerFile !== null && ownerFile !== testFilePath) continue
    await validateAssetPath(path, testFilePath)
  }
}

/**
 * Resolves an overlay file path to an existing absolute path, trying it as-is
 * and relative to the test file. Throws when no candidate exists.
 */
async function resolveExistingAssetPath(
  assetPath: string,
  testFilePath: string | null
): Promise<string> {
  const candidates = [assetPath]
  if (testFilePath !== null) {
    candidates.push(resolve(dirname(testFilePath), assetPath))
  }

  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Asset file not found: ${assetPath}`)
}

async function validateAssetPath(
  assetPath: string,
  testFilePath: string | null
): Promise<void> {
  await resolveExistingAssetPath(assetPath, testFilePath)
}

/**
 * An overlay controller.
 *
 * Calling it shows the overlay over a frozen frame for a fixed duration
 * (blocking). Use `start()`/`end()` to keep the overlay on screen while the page
 * is driven underneath.
 *
 * Overlays may overlap: several can be live at once (interleaved, not just
 * nested), and a blocking overlay can run while others stay live. Each overlay
 * you `start()` must be `end()`ed before the video function returns, and the
 * same overlay cannot be started twice without ending it in between.
 *
 * @example
 * ```ts
 * // Blocking: hold the overlay for 1.2s, then continue.
 * await overlays.logo(1200)
 *
 * // Live: keep the overlay up while interacting with the page.
 * await overlays.badge.start()
 * await page.click('#next')
 * await overlays.badge.end()
 *
 * // Overlapping: two overlays live at the same time, ended independently.
 * await overlays.badge.start()
 * await overlays.logo.start()
 * await page.click('#next')
 * await overlays.badge.end()
 * await overlays.logo.end()
 * ```
 */
export type OverlayController = {
  (durationMs?: number): Promise<void>
  start(): Promise<void>
  end(): Promise<void>
}

/**
 * The controller type for one {@link createOverlays} value: a static input
 * (string/element/config) yields a plain {@link OverlayController}; a config
 * factory yields a `(props) => OverlayController` so props are passed at the
 * call site. A static input is never callable, so it never matches the factory
 * arm: existing static maps keep exactly today's controller type.
 */
export type OverlayControllerFor<V> = V extends (
  props: infer P
) => OverlayConfig
  ? (props: P) => OverlayController
  : OverlayController

/** Typed overlay controllers keyed by the names passed to {@link createOverlays}. */
export type Overlays<T extends Record<string, OverlayInputOrFactory>> = {
  [K in keyof T]: OverlayControllerFor<T[K]>
}

/**
 * Creates a set of typed overlay controllers, one per key in the map. Each value
 * is a file path string, a React element, or an {@link OverlayConfig} object.
 * A config can draw its content from exactly one source: a file `path`, a React
 * `element`, or an inline `html` fragment.
 *
 * Calling a controller shows the overlay in the recording timeline. Image
 * (`.svg`/`.png`), HTML, and React overlays need a `durationMs` (in the config
 * or passed to the blocking call) unless driven with `start()`/`end()`; `.mp4`
 * overlays use their natural duration and default `audio` to `1` (natural level).
 *
 * Placement defaults to the full recording area (`relativeTo: 'recording'`);
 * override any field independently. Coordinates are CSS px of the recording
 * viewport.
 *
 * @example
 * ```tsx
 * const overlays = createOverlays({
 *   hint:  'callout.html',                       // HTML file
 *   badge: <Badge label="New" />,                // React element
 *   note:  { html: '<div class="note">Tip</div>', x: 1340, y: 110, width: 380 },
 *   logo:  { path: 'logo.png', x: 96, y: 96, width: 240 },
 *   intro: { path: 'intro.mp4', fill: 'screen' },
 * })
 *
 * video('Product demo', async ({ page }) => {
 *   await overlays.intro()
 *   await page.goto('/dashboard')
 *   await overlays.logo(1200)
 * })
 * ```
 *
 * A value can also be an {@link OverlayConfigFactory} `(props) => OverlayConfig`,
 * making the overlay programmatic. Calling `overlays.name(props)` builds and
 * returns a controller you then drive with `(durationMs)`, `start()`, or
 * `end()`. The factory runs (and its config is validated) on each call, so
 * content and placement can depend on runtime values.
 */
export function createOverlays<
  const T extends Record<string, OverlayInputOrFactory>,
>(overlays: T): Overlays<T> {
  const result = {} as Record<string, unknown>
  for (const name in overlays) {
    result[name] = buildOverlayController(name, overlays[name]!)
  }
  return result as Overlays<T>
}

function isReactElementLike(value: unknown): value is ReactElementLike {
  if (typeof value !== 'object' || value === null) return false
  // A real React element carries a symbol `$$typeof`.
  if (typeof (value as { $$typeof?: unknown }).$$typeof === 'symbol')
    return true
  // Playwright transpiles JSX in `.screenci.tsx` files with its own automatic
  // runtime, which produces `{ __pw_type: 'jsx', ... }` nodes instead.
  return (value as { __pw_type?: unknown }).__pw_type === 'jsx'
}

function buildOverlayController(
  name: string,
  input: OverlayInputOrFactory
): OverlayController | ((props: unknown) => OverlayController) {
  // A factory is the only callable input. React elements and config objects are
  // plain objects, so this branch never captures them. The config (and its
  // validation) is built per call so props can vary placement and content.
  if (typeof input === 'function') {
    return (props: unknown) =>
      buildOverlayFromConfig(name, (input as OverlayConfigFactory)(props))
  }
  if (typeof input === 'string') {
    return buildOverlayFromConfig(name, { path: input })
  }
  if (isReactElementLike(input)) {
    return buildOverlayFromConfig(name, { element: input })
  }
  return buildOverlayFromConfig(name, input)
}

function buildOverlayFromConfig(
  name: string,
  config: OverlayConfig
): OverlayController {
  const hasPath = config.path !== undefined
  const hasElement = config.element !== undefined
  const hasHtml = config.html !== undefined
  const sourceCount = Number(hasPath) + Number(hasElement) + Number(hasHtml)
  if (sourceCount > 1) {
    throw new Error(
      `[screenci] Overlay "${name}" must provide only one of "path", "element", or "html".`
    )
  }
  if (sourceCount === 0) {
    throw new Error(
      `[screenci] Overlay "${name}" must provide a "path", an "element", or inline "html".`
    )
  }
  if (hasHtml) {
    validateInlineHtmlFragment(name, config.html!)
  }

  const placementSource = resolvePlacementSource(name, config, {
    hasElement,
    hasHtml,
    hasPath,
  })
  const fullScreen = config.fill === 'screen'
  const animate = config.animate === true
  if (config.fps !== undefined && !animate) {
    throw new Error(
      `[screenci] Overlay "${name}" sets "fps" without "animate: true". "fps" only applies to animated overlays.`
    )
  }
  if (animate && config.fps !== undefined) {
    if (!Number.isFinite(config.fps) || config.fps <= 0) {
      throw new Error(
        `[screenci] Overlay "${name}" must provide a finite "fps" greater than 0. Received: ${String(config.fps)}`
      )
    }
  }
  if (
    config.capturePadding !== undefined &&
    (!Number.isFinite(config.capturePadding) || config.capturePadding < 0)
  ) {
    throw new Error(
      `[screenci] Overlay "${name}" must provide a finite "capturePadding" greater than or equal to 0. Received: ${String(config.capturePadding)}`
    )
  }
  const renderOpts: OverlayRenderOpts = {
    ...(config.css !== undefined && { css: config.css }),
    ...(config.capturePadding !== undefined && {
      capturePadding: config.capturePadding,
    }),
  }

  // speed/time re-time a moving picture, so they only apply to .mp4 video
  // overlays. Images, HTML, React, and animated overlays have no source rate.
  if (
    (config.speed !== undefined || config.time !== undefined) &&
    (hasElement || hasHtml || getAssetExtension(config.path ?? '') !== '.mp4')
  ) {
    throw new Error(
      `[screenci] Overlay "${name}" only supports speed/time on .mp4 video overlays.`
    )
  }

  // React element or inline HTML fragment: rendered to markup lazily at
  // recording time. Both follow the identical placement/animate/css/padding
  // path; only how the markup is produced differs.
  if (hasElement || hasHtml) {
    const getMarkup = hasElement
      ? (): Promise<string> => renderElementToMarkup(name, config.element!)
      : (): Promise<string> => Promise.resolve(config.html!)
    if (animate) {
      return createAnimatedOverlayController(
        name,
        getMarkup,
        placementSource,
        fullScreen,
        config.fps,
        config.durationMs,
        renderOpts
      )
    }
    return createRenderedOverlayController(
      name,
      getMarkup,
      placementSource,
      fullScreen,
      config.durationMs,
      renderOpts
    )
  }

  const path = config.path!
  const extension = getAssetExtension(path)
  // Image/video file overlays never use `over` (rejected in
  // resolvePlacementSource), so the source is always a concrete placement for
  // them. The `.html` file branch supports `over`, so it keeps the source.
  const placement =
    placementSource.kind === 'fixed'
      ? placementSource.placement
      : resolveOverlayPlacement(name, config)

  if (animate && extension !== '.html') {
    throw new Error(
      `[screenci] Overlay "${name}" (${path}) cannot animate: "animate" is only supported for HTML files and React elements.`
    )
  }
  if (
    (config.css !== undefined || config.capturePadding !== undefined) &&
    extension !== '.html'
  ) {
    throw new Error(
      `[screenci] Overlay "${name}" (${path}) cannot use "css" or "capturePadding": they are only supported for HTML files and React elements.`
    )
  }

  // HTML file: read + rasterize to a transparent PNG (or an animated clip).
  if (extension === '.html') {
    registerAssetPath(path)
    const getMarkup = (): Promise<string> => readHtmlOverlayFile(path)
    if (animate) {
      return createAnimatedOverlayController(
        name,
        getMarkup,
        placementSource,
        fullScreen,
        config.fps,
        config.durationMs,
        renderOpts
      )
    }
    return createRenderedOverlayController(
      name,
      getMarkup,
      placementSource,
      fullScreen,
      config.durationMs,
      renderOpts
    )
  }

  // File-backed image / video overlays.
  if (extension === '.svg' || extension === '.png') {
    if (config.volume !== undefined) {
      throw new Error(
        `[screenci] Overlay "${name}" (${path}) is an image and must not provide volume. Use durationMs instead.`
      )
    }
    if (config.durationMs !== undefined) {
      validateDurationMs(name, path, config.durationMs)
    }
    registerAssetPath(path)
    return createFileOverlayController(name, {
      kind: 'image',
      path,
      ...(placement !== undefined && { placement }),
      fullScreen,
      ...(config.durationMs !== undefined && { durationMs: config.durationMs }),
    })
  }

  if (extension === '.mp4') {
    if (config.durationMs !== undefined) {
      throw new Error(
        `[screenci] Overlay "${name}" (${path}) is a video and must not provide durationMs. Its natural media duration is used instead.`
      )
    }
    if (
      config.volume !== undefined &&
      (!Number.isFinite(config.volume) ||
        config.volume < 0 ||
        config.volume > MAX_AUDIO_LEVEL)
    ) {
      throw new Error(
        `[screenci] Overlay "${name}" (${path}) must provide a finite volume between 0 and ${MAX_AUDIO_LEVEL} for .mp4 overlays. 1 is the natural level, 0 is silent, and values above 1 boost it.`
      )
    }
    validateSpeedTime(`Overlay "${name}" (${path})`, config.speed, config.time)
    registerAssetPath(path)
    return createFileOverlayController(name, {
      kind: 'video',
      path,
      ...(placement !== undefined && { placement }),
      fullScreen,
      ...(config.volume !== undefined && { audio: config.volume }),
      ...(config.speed !== undefined && { speed: config.speed }),
      ...(config.time !== undefined && { time: config.time }),
    })
  }

  throw new Error(
    `[screenci] Overlay "${name}" must use one of: .html, .svg, .png, .mp4. Received: ${path}`
  )
}

/**
 * Validates an inline `html` overlay fragment. It must be non-empty and must
 * not contain document-level tags (`<!doctype>`, `<html>`, `<head>`, `<body>`):
 * screenci wraps the markup in its own document before rasterizing, so a full
 * document here would nest documents and break the capture. Mirrors the
 * fragment contract of a React `element`.
 */
function validateInlineHtmlFragment(name: string, html: string): void {
  if (html.trim().length === 0) {
    throw new Error(
      `[screenci] Overlay "${name}" inline "html" must not be empty.`
    )
  }
  const lower = html.toLowerCase()
  const forbidden: Array<{ token: string; label: string }> = [
    { token: '<!doctype', label: '<!doctype>' },
    { token: '<html', label: '<html>' },
    { token: '<head', label: '<head>' },
    { token: '<body', label: '<body>' },
  ]
  for (const { token, label } of forbidden) {
    if (lower.includes(token)) {
      throw new Error(
        `[screenci] Overlay "${name}" inline "html" must be a fragment, not a full HTML document. Remove the ${label} tag; screenci wraps the markup in a document for you.`
      )
    }
  }
  validateSingleRootElement(name, html)
}

/**
 * HTML void elements: they never have a closing tag, so they do not open a
 * nesting level when counting top-level nodes.
 */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/**
 * Ensures an inline `html` fragment has exactly one top-level (root) element and
 * no loose top-level text, so it wraps cleanly into screenci's overlay document
 * and sizes predictably. Multiple siblings (for example `<div/><div/>`) or stray
 * text outside the root are rejected. The markup inside the root may be anything,
 * including `<script>`/`<style>`, which are left to the overlay renderer.
 *
 * This is a lightweight tag scanner, not a full HTML parser: it tracks nesting
 * depth across opening, closing, void, and self-closing tags (skipping comments
 * and quoted attribute values) which covers ordinary fragment markup.
 */
function validateSingleRootElement(name: string, html: string): void {
  const fail = (): never => {
    throw new Error(
      `[screenci] Overlay "${name}" inline "html" must contain a single root element (for example '<div class="badge">New</div>'). Wrap multiple top-level nodes in one container.`
    )
  }
  // Drop comments so they never count as top-level content.
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '')
  const tagRe =
    /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  let depth = 0
  let rootElements = 0
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = tagRe.exec(stripped)) !== null) {
    const before = stripped.slice(lastIndex, match.index)
    if (depth === 0 && before.trim().length > 0) fail()
    lastIndex = match.index + match[0]!.length
    const isClosing = match[1] === '/'
    const tagName = match[2]!.toLowerCase()
    const selfClosing = match[4] === '/'
    if (isClosing) {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth === 0) rootElements += 1
    if (!selfClosing && !VOID_ELEMENTS.has(tagName)) depth += 1
  }
  if (stripped.slice(lastIndex).trim().length > 0 && depth === 0) fail()
  if (rootElements !== 1) fail()
}

async function renderElementToMarkup(
  name: string,
  element: ReactElementLike
): Promise<string> {
  let reactDomServer: { renderToStaticMarkup: (e: unknown) => string }
  let react: typeof import('react')
  try {
    reactDomServer = (await import('react-dom/server')) as unknown as {
      renderToStaticMarkup: (e: unknown) => string
    }
    react = (await import('react')) as unknown as typeof import('react')
  } catch {
    throw new Error(
      `[screenci] Overlay "${name}" is a React element, which requires "react" and "react-dom" to be installed. Run: npm i react react-dom (plus @types/react @types/react-dom for TypeScript). Re-run "screenci init" and answer yes to React overlay support to scaffold this.`
    )
  }
  // Playwright's JSX runtime produces `__pw_type` nodes rather than real React
  // elements; convert them (invoking function components, whose bodies are also
  // pw-jsx) before handing the tree to react-dom.
  const renderable = isPwJsxNode(element)
    ? pwJsxToReactNode(element, react)
    : element
  return reactDomServer.renderToStaticMarkup(renderable)
}

type PwJsxNode = {
  __pw_type: 'jsx'
  type: unknown
  props?: Record<string, unknown> & { children?: unknown }
  key?: unknown
}

function isPwJsxNode(value: unknown): value is PwJsxNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __pw_type?: unknown }).__pw_type === 'jsx'
  )
}

function isPwFragment(type: unknown): boolean {
  return (
    typeof type === 'object' &&
    type !== null &&
    (type as { __pw_jsx_fragment?: unknown }).__pw_jsx_fragment === true
  )
}

function pwChildrenToArray(children: unknown): unknown[] {
  if (children === undefined || children === null) return []
  return Array.isArray(children) ? children : [children]
}

/**
 * Converts a Playwright JSX node tree into real React nodes. Function components
 * are invoked (their bodies are pw-jsx too) and their output converted, so the
 * result is a host-element/primitive tree that react-dom can render statically.
 */
function pwJsxToReactNode(
  node: unknown,
  react: typeof import('react')
): unknown {
  const createElement = react.createElement as (
    type: unknown,
    props?: unknown,
    ...children: unknown[]
  ) => unknown

  if (Array.isArray(node)) {
    return node.map((child) => pwJsxToReactNode(child, react))
  }
  if (!isPwJsxNode(node)) return node

  const { type, props } = node
  if (isPwFragment(type)) {
    const kids = pwChildrenToArray(props?.children).map((c) =>
      pwJsxToReactNode(c, react)
    )
    return createElement(react.Fragment, null, ...kids)
  }
  if (typeof type === 'function') {
    return pwJsxToReactNode(
      (type as (props: unknown) => unknown)(props ?? {}),
      react
    )
  }
  const { children, ...rest } = props ?? {}
  const kids = pwChildrenToArray(children).map((c) =>
    pwJsxToReactNode(c, react)
  )
  return createElement(type, rest, ...kids)
}

async function readHtmlOverlayFile(path: string): Promise<string> {
  const testFilePath = getScreenCIRuntimeContext().testFilePath
  const resolved = await resolveExistingAssetPath(path, testFilePath)
  return readFile(resolved, 'utf-8')
}

/**
 * Builds overlay controllers for Studio-managed overlays declared via
 * `video.studio({ overlays: [...] })`. Their file (`.svg`, `.png`, or `.mp4`),
 * placement, image duration, and video audio level are configured on the
 * ScreenCI Studio page instead of in code. Each name becomes a callable overlay
 * controller with the same timeline behavior as a {@link createOverlays}
 * controller, including `start()`/`end()`.
 *
 * Internal: the `overlays` fixture exposes these to the test body.
 */
export function buildStudioOverlays(
  names: readonly string[]
): Record<string, OverlayController> {
  const result: Record<string, OverlayController> = {}
  for (const name of names) {
    result[name] = createStudioAssetController(name)
  }
  return result
}

type AssetStartMode =
  | { type: 'blocking'; durationMs?: number }
  | { type: 'live' }

function createActiveAssetRun(
  startedWithExplicitStart: boolean
): ActiveAssetRun {
  let resolve!: () => void
  const finished = new Promise<void>((resolveFn) => {
    resolve = resolveFn
  })
  return { finished, resolveFinished: resolve, startedWithExplicitStart }
}

/**
 * Ends a single live overlay identified by name, emitting its `assetEnd`,
 * holding a frame, and clearing it from the active map. Overlays may overlap,
 * so ending one never touches the others.
 */
function endLiveAsset(name: string, reason: 'auto' | 'wait'): void {
  const context = getScreenCIRuntimeContext()
  const run = context.asset.activeRuns.get(name)
  if (run === undefined) return
  getRuntimeAssetRecorder().addAssetEnd(name, reason)
  sleepForAssetFrameGap()
  context.asset.activeRuns.delete(name)
  run.resolveFinished()
}

function createAssetControllerCore(
  name: string,
  validate: () => Promise<void>,
  emitStart: (recorder: IEventRecorder, mode: AssetStartMode) => void,
  /**
   * Optional async step run after {@link validate} and before {@link emitStart},
   * receiving the resolved start mode. Used by animated overlays to rasterize
   * the clip once the capture length (mode duration) is known.
   */
  prepare?: (mode: AssetStartMode) => Promise<void>
): OverlayController {
  const start = async (startedWithExplicitStart = true): Promise<void> => {
    await validate()
    await prepare?.({ type: 'live' })
    const recorder = getRuntimeAssetRecorder()
    const context = getScreenCIRuntimeContext()
    if (context.asset.activeRuns.has(name)) {
      throw new Error(
        `[screenci] Overlay "${name}" is already started. Call end() for it before starting it again.`
      )
    }
    const run = createActiveAssetRun(startedWithExplicitStart)
    context.asset.activeRuns.set(name, run)
    emitStart(recorder, { type: 'live' })
  }

  const end = async (): Promise<void> => {
    const context = getScreenCIRuntimeContext()
    const run = context.asset.activeRuns.get(name)
    if (run === undefined) {
      throw new Error(
        `Cannot call end() for overlay "${name}" because it is not a started overlay`
      )
    }
    endLiveAsset(name, 'wait')
    await run.finished
  }

  const controller = (async (durationMs?: number): Promise<void> => {
    // A blocking overlay holds a frozen frame for a fixed duration. It never
    // registers a live run and never ends overlays that are already live, so it
    // can run while other overlays stay composited across the frozen frame.
    const mode: AssetStartMode = {
      type: 'blocking',
      ...(durationMs !== undefined && { durationMs }),
    }
    await validate()
    await prepare?.(mode)
    const recorder = getRuntimeAssetRecorder()
    emitStart(recorder, mode)
  }) as OverlayController

  controller.start = () => start(true)
  controller.end = end
  return controller
}

function createStudioAssetController(name: string): OverlayController {
  return createAssetControllerCore(
    name,
    () => Promise.resolve(),
    (recorder) => recorder.addStudioAssetStart(name)
  )
}

/** A file-backed overlay resolved from {@link OverlayConfig} for recording. */
type ResolvedFileOverlay =
  | {
      kind: 'image'
      path: string
      placement?: OverlayPlacement
      fullScreen: boolean
      durationMs?: number
    }
  | {
      kind: 'video'
      path: string
      placement?: OverlayPlacement
      fullScreen: boolean
      audio?: number
      speed?: number
      time?: number
    }

function createFileOverlayController(
  name: string,
  resolved: ResolvedFileOverlay
): OverlayController {
  return createAssetControllerCore(
    name,
    async () => {
      const testFilePath = getScreenCIRuntimeContext().testFilePath
      if (testFilePath !== null) {
        await validateAssetPath(resolved.path, testFilePath)
      }
    },
    (recorder, mode) => {
      recorder.addAssetStart(name, toRecordedFileStart(name, resolved, mode))
    }
  )
}

/** Styling/capture options shared by rendered (HTML/React) overlay controllers. */
type OverlayRenderOpts = {
  css?: string
  capturePadding?: number
}

/**
 * An overlay rendered to a transparent PNG at recording time, from either an
 * HTML file or a React element. `getMarkup` produces the HTML to rasterize.
 */
function createRenderedOverlayController(
  name: string,
  getMarkup: () => Promise<string>,
  placementSource: PlacementSource,
  fullScreen: boolean,
  durationMs?: number,
  renderOpts: OverlayRenderOpts = {}
): OverlayController {
  // The markup and placement are resolved during the test (cheap:
  // renderToStaticMarkup / a string, plus a boundingBox read for `over`), but
  // rasterization (a browser screenshot) is deferred to after the test so
  // identical overlays render once. See overlayFlush.ts.
  let resolvedHtml: string | undefined
  let resolvedPlacement: OverlayPlacement | undefined
  let skipped = false

  return createAssetControllerCore(
    name,
    () => Promise.resolve(),
    (recorder, mode) => {
      // `resolvedHtml` is set only once the overlay has resolved, so it is the
      // "is resolved" signal. `resolvedPlacement` may legitimately stay
      // undefined (a fill-the-recording overlay emits no placement).
      if (skipped || resolvedHtml === undefined) return
      let durationMsForEvent: number | undefined
      if (mode.type === 'blocking') {
        durationMsForEvent = mode.durationMs ?? durationMs
        if (durationMsForEvent === undefined) {
          throw new Error(
            `[screenci] Overlay "${name}" needs a duration: pass one to the call (overlays.${name}(1000)), set durationMs in the config, or drive it with .start()/.end().`
          )
        }
        validateDurationMs(name, `overlay "${name}"`, durationMsForEvent)
      }
      recorder.addPendingAssetStart(name, {
        kind: 'image',
        ...(durationMsForEvent !== undefined && {
          durationMs: durationMsForEvent,
        }),
        fullScreen,
        ...(resolvedPlacement !== undefined && {
          placement: resolvedPlacement,
        }),
        request: {
          kind: 'image',
          name,
          html: resolvedHtml,
          css: resolveOverlayCss(renderOpts.css),
          capturePadding: renderOpts.capturePadding ?? 0,
          deviceScaleFactor: DEFAULT_OVERLAY_DEVICE_SCALE_FACTOR,
        },
      })
    },
    async () => {
      if (resolvedHtml !== undefined || skipped) return
      // Resolving an overlay needs an active recording page and output dir.
      // Outside recording (e.g. plain test runs) there is nothing to upload, so
      // the controller is a no-op, mirroring the no-op recorder.
      if (getRuntimePage() === null || getRuntimeRecordingDir() === null) {
        skipped = true
        return
      }
      const { placement, sizePx } = await resolvePlacement(placementSource)
      resolvedPlacement = placement
      const markup = await getMarkup()
      resolvedHtml =
        sizePx !== undefined ? sizeWrapMarkup(markup, sizePx) : markup
    }
  )
}

/**
 * An animated overlay rendered to a transparent clip, from either an HTML file
 * or a React element. The capture length is resolved from the call argument or
 * config `durationMs`; `start()`/`end()` requires a config `durationMs` (the
 * capture length is otherwise unknown).
 *
 * Markup and duration are captured during the test; the clip itself is encoded
 * after the test (see overlayFlush.ts). Because no rasterization happens during
 * the recording, the old "hide block" that cut capture wall-clock from the
 * timeline is no longer needed.
 */
function createAnimatedOverlayController(
  name: string,
  getMarkup: () => Promise<string>,
  placementSource: PlacementSource,
  fullScreen: boolean,
  fps: number | undefined,
  configDurationMs: number | undefined,
  renderOpts: OverlayRenderOpts = {}
): OverlayController {
  let resolved:
    | { html: string; durationMs: number; placement?: OverlayPlacement }
    | undefined
  let skipped = false

  const resolveDurationMs = (mode: AssetStartMode): number => {
    if (mode.type === 'blocking') {
      const durationMs = mode.durationMs ?? configDurationMs
      if (durationMs === undefined) {
        throw new Error(
          `[screenci] Animated overlay "${name}" needs a duration: pass one to the call (overlays.${name}(1000)), set durationMs in the config, or drive it with .start()/.end() (with durationMs in the config).`
        )
      }
      validateDurationMs(name, `overlay "${name}"`, durationMs)
      return durationMs
    }
    if (configDurationMs === undefined) {
      throw new Error(
        `[screenci] Animated overlay "${name}" driven with .start()/.end() needs durationMs in its config (the capture length is otherwise unknown).`
      )
    }
    validateDurationMs(name, `overlay "${name}"`, configDurationMs)
    return configDurationMs
  }

  return createAssetControllerCore(
    name,
    () => Promise.resolve(),
    (recorder, mode) => {
      if (skipped || resolved === undefined) return
      recorder.addPendingAssetStart(name, {
        kind: 'animation',
        ...(mode.type === 'blocking' && { durationMs: resolved.durationMs }),
        fullScreen,
        ...(resolved.placement !== undefined && {
          placement: resolved.placement,
        }),
        request: {
          kind: 'animation',
          name,
          html: resolved.html,
          css: resolveOverlayCss(renderOpts.css),
          capturePadding: renderOpts.capturePadding ?? 0,
          deviceScaleFactor: DEFAULT_OVERLAY_DEVICE_SCALE_FACTOR,
          fps: fps ?? DEFAULT_ANIMATION_FPS,
          durationMs: resolved.durationMs,
        },
      })
    },
    async (mode) => {
      // Outside recording there is nothing to upload, so the controller is a
      // no-op, mirroring the no-op recorder and the static rendered controller.
      if (getRuntimePage() === null || getRuntimeRecordingDir() === null) {
        skipped = true
        return
      }
      const durationMs = resolveDurationMs(mode)
      const { placement, sizePx } = await resolvePlacement(placementSource)
      const markup = await getMarkup()
      resolved = {
        html: sizePx !== undefined ? sizeWrapMarkup(markup, sizePx) : markup,
        durationMs,
        ...(placement !== undefined && { placement }),
      }
    }
  )
}

function getAssetExtension(
  path: string
): '.html' | '.svg' | '.png' | '.mp4' | null {
  const dotIndex = path.lastIndexOf('.')
  if (dotIndex === -1) return null
  const extension = path.slice(dotIndex).toLowerCase()
  if (
    extension === '.html' ||
    extension === '.svg' ||
    extension === '.png' ||
    extension === '.mp4'
  ) {
    return extension
  }
  return null
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validateDurationMs(
  name: string,
  path: string,
  durationMs: number
): void {
  if (!isFiniteNonNegative(durationMs)) {
    throw new Error(
      `[screenci] Overlay "${name}" (${path}) must provide a finite durationMs greater than or equal to 0.`
    )
  }
}

/**
 * Upper bound for a playback-speed multiplier. `16` is already an extreme rate;
 * the cap guards against accidental runaway values producing degenerate output.
 */
export const MAX_SPEED = 16

/**
 * Validates a `speed`/`time` pair shared by `.mp4` overlays and audio tracks.
 * `speed` must be a finite multiplier in `(0, MAX_SPEED]`; `time` must be a
 * finite duration greater than 0 (ms). They are mutually exclusive.
 */
export function validateSpeedTime(
  label: string,
  speed: number | undefined,
  time: number | undefined
): void {
  if (speed !== undefined && time !== undefined) {
    throw new Error(
      `[screenci] ${label} must set only one of speed or time, not both.`
    )
  }
  if (
    speed !== undefined &&
    (!Number.isFinite(speed) || speed <= 0 || speed > MAX_SPEED)
  ) {
    throw new Error(
      `[screenci] ${label} must provide a finite speed greater than 0 and at most ${MAX_SPEED}. 2 plays twice as fast, 0.5 at half speed.`
    )
  }
  if (time !== undefined && (!Number.isFinite(time) || time <= 0)) {
    throw new Error(
      `[screenci] ${label} must provide a finite time (ms) greater than 0.`
    )
  }
}

function validatePlacement(name: string, placement: OverlayPlacement): void {
  if ('fullScreen' in placement) {
    if (placement.fullScreen !== true) {
      throw new Error(
        `[screenci] Overlay "${name}" fullScreen must be true when set.`
      )
    }
    return
  }

  const relativeTo = (placement as { relativeTo?: unknown }).relativeTo
  if (relativeTo !== 'screen' && relativeTo !== 'recording') {
    throw new Error(
      `[screenci] Overlay "${name}" relativeTo must be 'screen' or 'recording'.`
    )
  }

  const hasWidth = 'width' in placement && placement.width !== undefined
  const sizeLabel = hasWidth ? 'width' : 'height'
  const sizeValue = hasWidth
    ? (placement as { width: number }).width
    : (placement as { height: number }).height
  for (const [label, value] of [
    ['x', placement.x],
    ['y', placement.y],
  ] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(
        `[screenci] Overlay "${name}" ${label} must be a non-negative number of CSS pixels. Received: ${String(value)}`
      )
    }
  }
  if (
    typeof sizeValue !== 'number' ||
    !Number.isFinite(sizeValue) ||
    sizeValue <= 0
  ) {
    throw new Error(
      `[screenci] Overlay "${name}" ${sizeLabel} must be a positive number of CSS pixels. Received: ${String(sizeValue)}`
    )
  }
  const aspectRatio = (placement as { aspectRatio?: unknown }).aspectRatio
  if (
    aspectRatio !== undefined &&
    (typeof aspectRatio !== 'number' ||
      !Number.isFinite(aspectRatio) ||
      aspectRatio <= 0)
  ) {
    throw new Error(
      `[screenci] Overlay "${name}" aspectRatio must be a positive number (width / height). Received: ${String(aspectRatio)}`
    )
  }
}

/**
 * Resolves an {@link OverlayConfig}'s flat placement fields into the event-shape
 * {@link OverlayPlacement}. Coordinates are CSS pixels in the recording viewport,
 * with the defaults `relativeTo: 'recording'`, `x: 0`, `y: 0`. When neither
 * `width` nor `height` is given (and no other placement field is set), it returns
 * `undefined`: the overlay fills the recording area, which the renderer resolves
 * since the recording size is known there.
 */
function resolveOverlayPlacement(
  name: string,
  config: OverlayConfig
): OverlayPlacement | undefined {
  if (config.fill === 'screen') {
    return { fullScreen: true }
  }
  if (config.fill === 'recording') {
    // Fill the recording area (resolved by the renderer, which knows its size).
    return undefined
  }
  if (config.width !== undefined && config.height !== undefined) {
    throw new Error(
      `[screenci] Overlay "${name}" must set only one of width or height (the other is derived from the aspect ratio).`
    )
  }
  const hasSize = config.width !== undefined || config.height !== undefined
  if (!hasSize) {
    const positioned =
      config.x !== undefined ||
      config.y !== undefined ||
      config.relativeTo !== undefined ||
      config.aspectRatio !== undefined
    if (positioned) {
      throw new Error(
        `[screenci] Overlay "${name}" must set "width" or "height" (in CSS px) when positioning it. Omit all placement fields to fill the recording area, or set "fill".`
      )
    }
    // Fill the recording area (resolved by the renderer, which knows its size).
    return undefined
  }
  const relativeTo = config.relativeTo ?? 'recording'
  const x = config.x ?? 0
  const y = config.y ?? 0
  const aspectRatio = config.aspectRatio
  const placement: OverlayPlacement =
    config.height !== undefined
      ? {
          relativeTo,
          x,
          y,
          height: config.height,
          ...(aspectRatio !== undefined && { aspectRatio }),
        }
      : {
          relativeTo,
          x,
          y,
          width: config.width!,
          ...(aspectRatio !== undefined && { aspectRatio }),
        }
  validatePlacement(name, placement)
  return placement
}

/**
 * Where a rendered/animated overlay's placement comes from: a fixed config
 * placement resolved up front, or an {@link OverlayConfig.over} locator resolved
 * at recording time from its bounding box.
 */
type PlacementSource =
  | { kind: 'fixed'; placement: OverlayPlacement | undefined }
  | { kind: 'over'; over: Locator; margin: number }

/**
 * Chooses the placement source for an overlay. With {@link OverlayConfig.over}
 * the placement is deferred to recording time (the element box is unknown until
 * the page runs); otherwise it is resolved from the flat config fields now.
 */
function resolvePlacementSource(
  name: string,
  config: OverlayConfig,
  flags: { hasElement: boolean; hasHtml: boolean; hasPath: boolean }
): PlacementSource {
  if (config.margin !== undefined && config.over === undefined) {
    throw new Error(
      `[screenci] Overlay "${name}" sets "margin" without "over". "margin" only applies when positioning over a locator.`
    )
  }
  if (config.over === undefined) {
    return { kind: 'fixed', placement: resolveOverlayPlacement(name, config) }
  }

  const isRendered =
    flags.hasElement ||
    flags.hasHtml ||
    (flags.hasPath && getAssetExtension(config.path ?? '') === '.html')
  if (!isRendered) {
    throw new Error(
      `[screenci] Overlay "${name}" can only use "over" with a React element, inline "html", or an .html file (the overlay is sized to the element's box).`
    )
  }
  if (config.fill !== undefined) {
    throw new Error(
      `[screenci] Overlay "${name}" cannot set both "over" and "fill".`
    )
  }
  if (
    config.x !== undefined ||
    config.y !== undefined ||
    config.width !== undefined ||
    config.height !== undefined ||
    config.relativeTo !== undefined
  ) {
    throw new Error(
      `[screenci] Overlay "${name}" cannot combine "over" with x/y/width/height/relativeTo. The placement comes from the locator's box.`
    )
  }
  const margin = config.margin ?? 0
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error(
      `[screenci] Overlay "${name}" must provide a finite "margin" greater than or equal to 0. Received: ${String(config.margin)}`
    )
  }
  return { kind: 'over', over: config.over, margin }
}

/**
 * Resolves a {@link PlacementSource} to a concrete placement at recording time.
 * For an `over` source it reads the locator's box (plus margin) via
 * {@link overlayRect} and returns the element's pixel size so the markup can be
 * sized to match, making the rasterized overlay frame the element exactly.
 */
async function resolvePlacement(source: PlacementSource): Promise<{
  placement: OverlayPlacement | undefined
  sizePx?: { width: number; height: number }
}> {
  if (source.kind === 'fixed') {
    return { placement: source.placement }
  }
  const rect = await overlayRect(source.over, { margin: source.margin })
  return {
    placement: {
      relativeTo: rect.relativeTo,
      x: rect.x,
      y: rect.y,
      width: rect.width ?? rect.pixels.width,
    },
    sizePx: { width: rect.pixels.width, height: rect.pixels.height },
  }
}

/**
 * Wraps overlay markup in a box of the given CSS pixel size so the rasterized
 * PNG carries the element's aspect ratio. The renderer then derives the overlay
 * height from that aspect, landing it exactly on the element's box. The wrapped
 * content should fill the box (for example `width:100%;height:100%`).
 */
function sizeWrapMarkup(
  html: string,
  size: { width: number; height: number }
): string {
  return `<div style="width:${size.width}px;height:${size.height}px;box-sizing:border-box">${html}</div>`
}

function toRecordedFileStart(
  name: string,
  resolved: ResolvedFileOverlay,
  mode: AssetStartMode
): Parameters<IEventRecorder['addAssetStart']>[1] {
  if (resolved.kind === 'image') {
    let durationMs: number | undefined
    if (mode.type === 'blocking') {
      durationMs = mode.durationMs ?? resolved.durationMs
      if (durationMs === undefined) {
        throw new Error(
          `[screenci] Overlay "${name}" (${resolved.path}) needs a duration: pass one to the call (overlays.${name}(1000)), set durationMs in the config, or drive it with .start()/.end().`
        )
      }
      validateDurationMs(name, resolved.path, durationMs)
    }
    return {
      kind: 'image',
      path: resolved.path,
      ...(durationMs !== undefined && { durationMs }),
      fullScreen: resolved.fullScreen,
      ...(resolved.placement !== undefined && {
        placement: resolved.placement,
      }),
    }
  }

  return {
    kind: 'video',
    path: resolved.path,
    audio: resolved.audio ?? 1,
    fullScreen: resolved.fullScreen,
    ...(resolved.placement !== undefined && { placement: resolved.placement }),
    ...(resolved.speed !== undefined && { speed: resolved.speed }),
    ...(resolved.time !== undefined && { time: resolved.time }),
  }
}
