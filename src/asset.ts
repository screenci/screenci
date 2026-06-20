import type { IEventRecorder, OverlayPlacement } from './events.js'
import { access, readFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { resolveRecordingTimingDuration } from './runtimeMode.js'
import {
  rasterizeHtmlOverlay,
  rasterizeAnimatedHtmlOverlay,
} from './htmlRasterizer.js'

export { setOverlayCss } from './htmlRasterizer.js'
import { isInsideHide, isInsideTime } from './timelineBlock.js'
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
 * Display options for an overlay. Placement fields are flat (not nested) and
 * each defaults independently: `relativeTo: 'recording'`, `x: 0`, `y: 0`, and
 * `width: 1` when neither `width` nor `height` is given. The default box fills
 * the recording area, whose final size is chosen later in the studio.
 */
export type OverlayConfig = {
  /** File path: `.html` (rendered), `.svg`/`.png` (image), or `.mp4` (video). */
  path?: string
  /**
   * A React element, rendered to a transparent PNG. Use this for overlays built
   * in JSX. Provide exactly one source: `path`, `element`, or `html`.
   */
  element?: ReactElementLike
  /**
   * An inline HTML fragment, rendered to a transparent PNG. Use this when you
   * want plain HTML without a React dependency or a separate `.html` file. It
   * must be a fragment (for example `'<div class="badge">New</div>'`), never a
   * full document: `<!doctype>`, `<html>`, `<head>`, and `<body>` tags are
   * rejected because screenci wraps the markup in its own document. Provide
   * exactly one source: `path`, `element`, or `html`.
   */
  html?: string
  /** Reference box for placement coordinates. Defaults to `'recording'`. */
  relativeTo?: 'screen' | 'recording'
  /** Left edge as a 0..1 fraction of the reference box. Defaults to `0`. */
  x?: number
  /** Top edge as a 0..1 fraction of the reference box. Defaults to `0`. */
  y?: number
  /** Width as a 0..1 fraction. Defaults to `1` when `height` is not set. */
  width?: number
  /** Height as a 0..1 fraction. Provide instead of `width` (exactly one). */
  height?: number
  /** Fill the whole output frame. Overrides x/y/width/height. */
  fullScreen?: boolean
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
  /**
   * Soundtrack level for `.mp4` overlays as a linear gain. `1` (the default)
   * plays the source at its natural level, `0` mutes it, and values above `1`
   * boost it (e.g. `2` is twice the natural level). Capped at
   * {@link MAX_AUDIO_LEVEL}.
   */
  audio?: number
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

const registeredAssetPaths = new Set<string>()

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
  registeredAssetPaths.clear()
}

export function resetAssetChain(): void {
  resetAssetRuntimeState()
}

export async function validateRegisteredAssetPaths(
  testFilePath: string
): Promise<void> {
  for (const assetPath of registeredAssetPaths) {
    await validateAssetPath(assetPath, testFilePath)
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

/** Typed overlay controllers keyed by the names passed to {@link createOverlays}. */
export type Overlays<T extends Record<string, OverlayInput>> = {
  [K in keyof T]: OverlayController
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
 * Placement defaults to the full recording area (`relativeTo: 'recording',
 * x: 0, y: 0, width: 1`); override any field independently.
 *
 * @example
 * ```tsx
 * const overlays = createOverlays({
 *   hint:  'callout.html',                       // HTML file
 *   badge: <Badge label="New" />,                // React element
 *   note:  { html: '<div class="note">Tip</div>', x: 0.7, y: 0.1, width: 0.2 },
 *   logo:  { path: 'logo.png', x: 0.05, y: 0.05, width: 0.2 },
 *   intro: { path: 'intro.mp4', fullScreen: true },
 * })
 *
 * video('Product demo', async ({ page }) => {
 *   await overlays.intro()
 *   await page.goto('/dashboard')
 *   await overlays.logo(1200)
 * })
 * ```
 */
export function createOverlays<const T extends Record<string, OverlayInput>>(
  overlays: T
): Overlays<T> {
  const result = {} as Overlays<T>
  for (const name in overlays) {
    result[name] = buildOverlayController(name, overlays[name]!)
  }
  return result
}

function isReactElementLike(value: unknown): value is ReactElementLike {
  if (typeof value !== 'object' || value === null) return false
  // A real React element carries a symbol `$$typeof`.
  if (typeof (value as { $$typeof?: unknown }).$$typeof === 'symbol')
    return true
  // Playwright transpiles JSX in `.video.tsx` files with its own automatic
  // runtime, which produces `{ __pw_type: 'jsx', ... }` nodes instead.
  return (value as { __pw_type?: unknown }).__pw_type === 'jsx'
}

function buildOverlayController(
  name: string,
  input: OverlayInput
): OverlayController {
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

  const placement = resolveOverlayPlacement(name, config)
  const fullScreen = config.fullScreen ?? false
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
        placement,
        fullScreen,
        config.fps,
        config.durationMs,
        renderOpts
      )
    }
    return createRenderedOverlayController(
      name,
      getMarkup,
      placement,
      fullScreen,
      config.durationMs,
      renderOpts
    )
  }

  const path = config.path!
  const extension = getAssetExtension(path)

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
    registeredAssetPaths.add(path)
    const getMarkup = (): Promise<string> => readHtmlOverlayFile(path)
    if (animate) {
      return createAnimatedOverlayController(
        name,
        getMarkup,
        placement,
        fullScreen,
        config.fps,
        config.durationMs,
        renderOpts
      )
    }
    return createRenderedOverlayController(
      name,
      getMarkup,
      placement,
      fullScreen,
      config.durationMs,
      renderOpts
    )
  }

  // File-backed image / video overlays.
  if (extension === '.svg' || extension === '.png') {
    if (config.audio !== undefined) {
      throw new Error(
        `[screenci] Overlay "${name}" (${path}) is an image and must not provide audio. Use durationMs instead.`
      )
    }
    if (config.durationMs !== undefined) {
      validateDurationMs(name, path, config.durationMs)
    }
    registeredAssetPaths.add(path)
    return createFileOverlayController(name, {
      kind: 'image',
      path,
      placement,
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
      config.audio !== undefined &&
      (!Number.isFinite(config.audio) ||
        config.audio < 0 ||
        config.audio > MAX_AUDIO_LEVEL)
    ) {
      throw new Error(
        `[screenci] Overlay "${name}" (${path}) must provide a finite audio value between 0 and ${MAX_AUDIO_LEVEL} for .mp4 overlays. 1 is the natural level, 0 is silent, and values above 1 boost it.`
      )
    }
    validateSpeedTime(`Overlay "${name}" (${path})`, config.speed, config.time)
    registeredAssetPaths.add(path)
    return createFileOverlayController(name, {
      kind: 'video',
      path,
      placement,
      fullScreen,
      ...(config.audio !== undefined && { audio: config.audio }),
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
 * Creates typed overlay controllers whose files and display options are
 * configured on the ScreenCI Studio page instead of in code. Business tier
 * only.
 *
 * Each key becomes a callable overlay controller with the same timeline
 * behavior as {@link createOverlays} controllers, including `start()`/`end()`.
 * The file (`.svg`, `.png`, or `.mp4`), placement, image duration, and video
 * audio level all come from Studio.
 *
 * On the first upload of a studio-mode video, rendering is held until the
 * video is configured in Studio (the CLI prints a direct link). Later uploads
 * reuse the saved Studio configuration automatically.
 *
 * @example
 * ```ts
 * const overlays = createStudioOverlays('intro', 'logo')
 *
 * video('Product demo', async ({ page }) => {
 *   await overlays.intro()
 *   await page.goto('/dashboard')
 *   await overlays.logo()
 * })
 * ```
 */
export function createStudioOverlays<
  const K extends readonly [string, ...string[]],
>(...keys: K): Record<K[number], OverlayController> {
  const seen = new Set<string>()
  for (const key of keys) {
    if (seen.has(key)) {
      throw new Error(
        `Duplicate overlay key "${key}" passed to createStudioOverlays. Overlay keys must be unique.`
      )
    }
    seen.add(key)
  }

  const result = {} as Record<K[number], OverlayController>
  for (const key of keys) {
    result[key as K[number]] = createStudioAssetController(key)
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
      placement: OverlayPlacement
      fullScreen: boolean
      durationMs?: number
    }
  | {
      kind: 'video'
      path: string
      placement: OverlayPlacement
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
  placement: OverlayPlacement,
  fullScreen: boolean,
  durationMs?: number,
  renderOpts: OverlayRenderOpts = {}
): OverlayController {
  let generated: { path: string; fileHash: string } | undefined
  let skipped = false

  return createAssetControllerCore(
    name,
    async () => {
      if (generated !== undefined || skipped) return
      // Generating an overlay needs an active recording page and output dir.
      // Outside recording (e.g. plain test runs) there is nothing to upload, so
      // the controller is a no-op, mirroring the no-op recorder.
      if (getRuntimePage() === null || getRuntimeRecordingDir() === null) {
        skipped = true
        return
      }
      const html = await getMarkup()
      const result = await rasterizeHtmlOverlay({
        name,
        html,
        ...(renderOpts.css !== undefined && { css: renderOpts.css }),
        ...(renderOpts.capturePadding !== undefined && {
          capturePadding: renderOpts.capturePadding,
        }),
      })
      generated = { path: result.path, fileHash: result.fileHash }
    },
    (recorder, mode) => {
      if (generated === undefined) return
      recorder.addAssetStart(
        name,
        toRecordedRenderedStart(
          name,
          {
            placement,
            fullScreen,
            ...(durationMs !== undefined && { durationMs }),
          },
          generated,
          mode
        )
      )
    }
  )
}

/**
 * An animated overlay rendered to a transparent clip at recording time, from
 * either an HTML file or a React element. The capture length is resolved from
 * the call argument or config `durationMs`; `start()`/`end()` requires a config
 * `durationMs` (the capture length is otherwise unknown).
 */
function createAnimatedOverlayController(
  name: string,
  getMarkup: () => Promise<string>,
  placement: OverlayPlacement,
  fullScreen: boolean,
  fps: number | undefined,
  configDurationMs: number | undefined,
  renderOpts: OverlayRenderOpts = {}
): OverlayController {
  let generated:
    | { path: string; fileHash: string; durationMs: number }
    | undefined

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
      if (generated === undefined) return
      recorder.addAssetStart(name, {
        kind: 'animation',
        path: generated.path,
        fileHash: generated.fileHash,
        ...(mode.type === 'blocking' && { durationMs: generated.durationMs }),
        fullScreen,
        placement,
      })
    },
    async (mode) => {
      // Outside recording there is nothing to upload, so the controller is a
      // no-op, mirroring the no-op recorder and the static rendered controller.
      if (getRuntimePage() === null || getRuntimeRecordingDir() === null) {
        return
      }
      const durationMs = resolveDurationMs(mode)
      const html = await getMarkup()
      const rasterize = async (): Promise<void> => {
        const result = await rasterizeAnimatedHtmlOverlay({
          name,
          html,
          durationMs,
          ...(fps !== undefined && { fps }),
          ...(renderOpts.css !== undefined && { css: renderOpts.css }),
          ...(renderOpts.capturePadding !== undefined && {
            capturePadding: renderOpts.capturePadding,
          }),
        })
        generated = {
          path: result.path,
          fileHash: result.fileHash,
          durationMs,
        }
      }
      // Capturing the animation (screenshotting each frame + encoding) takes
      // real wall-clock that would otherwise be baked into the recording as a
      // long frozen pause before the overlay appears. Cut that time from the
      // output by wrapping the capture in a hide block. On a cache hit this is
      // ~instant, so the cut is a negligible sliver. Skip the wrapping when
      // already inside a hide()/time() block (a hide cannot nest, and the
      // surrounding block already governs that time).
      if (isInsideHide() || isInsideTime()) {
        await rasterize()
        return
      }
      const recorder = getRuntimeAssetRecorder()
      recorder.addHideStart()
      try {
        await rasterize()
      } finally {
        recorder.addHideEnd()
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
  const entries: Array<[string, unknown]> = [
    ['x', placement.x],
    ['y', placement.y],
    hasWidth
      ? ['width', (placement as { width: number }).width]
      : ['height', (placement as { height: number }).height],
  ]
  for (const [label, value] of entries) {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    ) {
      throw new Error(
        `[screenci] Overlay "${name}" ${label} must be a number between 0 and 1 (normalized fraction). Received: ${String(value)}`
      )
    }
  }
}

/**
 * Resolves an {@link OverlayConfig}'s flat placement fields into the event-shape
 * {@link OverlayPlacement}, applying the defaults `relativeTo: 'recording'`,
 * `x: 0`, `y: 0`, and `width: 1` (when neither width nor height is given). The
 * default box therefore fills the recording area.
 */
function resolveOverlayPlacement(
  name: string,
  config: OverlayConfig
): OverlayPlacement {
  if (config.fullScreen === true) {
    return { fullScreen: true }
  }
  if (config.width !== undefined && config.height !== undefined) {
    throw new Error(
      `[screenci] Overlay "${name}" must set only one of width or height (the other is derived from the aspect ratio).`
    )
  }
  const relativeTo = config.relativeTo ?? 'recording'
  const x = config.x ?? 0
  const y = config.y ?? 0
  const placement: OverlayPlacement =
    config.height !== undefined
      ? { relativeTo, x, y, height: config.height }
      : { relativeTo, x, y, width: config.width ?? 1 }
  validatePlacement(name, placement)
  return placement
}

type ResolvedRenderedOverlay = {
  placement: OverlayPlacement
  fullScreen: boolean
  durationMs?: number
}

function toRecordedRenderedStart(
  name: string,
  resolved: ResolvedRenderedOverlay,
  generated: { path: string; fileHash: string },
  mode: AssetStartMode
): Parameters<IEventRecorder['addAssetStart']>[1] {
  let durationMs: number | undefined
  if (mode.type === 'blocking') {
    durationMs = mode.durationMs ?? resolved.durationMs
    if (durationMs === undefined) {
      throw new Error(
        `[screenci] Overlay "${name}" needs a duration: pass one to the call (overlays.${name}(1000)), set durationMs in the config, or drive it with .start()/.end().`
      )
    }
    validateDurationMs(name, `overlay "${name}"`, durationMs)
  }
  return {
    kind: 'image',
    path: generated.path,
    fileHash: generated.fileHash,
    ...(durationMs !== undefined && { durationMs }),
    fullScreen: resolved.fullScreen,
    placement: resolved.placement,
  }
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
      placement: resolved.placement,
    }
  }

  return {
    kind: 'video',
    path: resolved.path,
    audio: resolved.audio ?? 1,
    fullScreen: resolved.fullScreen,
    placement: resolved.placement,
    ...(resolved.speed !== undefined && { speed: resolved.speed }),
    ...(resolved.time !== undefined && { time: resolved.time }),
  }
}
