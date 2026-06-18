import type { IEventRecorder, OverlayPlacement } from './events.js'
import { access, readFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { logger } from './logger.js'
import { resolveRecordingTimingDuration } from './runtimeMode.js'
import { rasterizeHtmlOverlay } from './htmlRasterizer.js'
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
 * each defaults independently: `relativeTo: 'screen'`, `x: 0`, `y: 0`, and
 * `width: 1` when neither `width` nor `height` is given.
 */
export type OverlayConfig = {
  /** File path: `.html` (rendered), `.svg`/`.png` (image), or `.mp4` (video). */
  path?: string
  /** A React element, rendered to a transparent PNG. Mutually exclusive with `path`. */
  element?: ReactElementLike
  /** Reference box for placement coordinates. Defaults to `'screen'`. */
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
   */
  durationMs?: number
  /** Soundtrack volume 0..1 for `.mp4` overlays. Defaults to `1`. */
  audio?: number
}

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
 * is driven underneath. Only one overlay is visible at a time: starting a new
 * overlay auto-ends the previous one.
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
 *
 * Calling a controller shows the overlay in the recording timeline. Image
 * (`.svg`/`.png`), HTML, and React overlays need a `durationMs` (in the config
 * or passed to the blocking call) unless driven with `start()`/`end()`; `.mp4`
 * overlays use their natural duration and default `audio` to `1`.
 *
 * Placement defaults to the full screen (`relativeTo: 'screen', x: 0, y: 0,
 * width: 1`); override any field independently.
 *
 * @example
 * ```tsx
 * const overlays = createOverlays({
 *   hint:  'callout.html',                       // HTML file
 *   badge: <Badge label="New" />,                // React element
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
  if (hasPath && hasElement) {
    throw new Error(
      `[screenci] Overlay "${name}" must provide only one of "path" or "element".`
    )
  }
  if (!hasPath && !hasElement) {
    throw new Error(
      `[screenci] Overlay "${name}" must provide a "path" or an "element".`
    )
  }

  const placement = resolveOverlayPlacement(name, config)
  const fullScreen = config.fullScreen ?? false

  // React element: rendered to markup lazily at recording time.
  if (hasElement) {
    const element = config.element!
    return createRenderedOverlayController(
      name,
      () => renderElementToMarkup(name, element),
      placement,
      fullScreen,
      config.durationMs
    )
  }

  const path = config.path!
  const extension = getAssetExtension(path)

  // HTML file: read + rasterize to a transparent PNG.
  if (extension === '.html') {
    registeredAssetPaths.add(path)
    return createRenderedOverlayController(
      name,
      () => readHtmlOverlayFile(path),
      placement,
      fullScreen,
      config.durationMs
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
      (!Number.isFinite(config.audio) || config.audio < 0 || config.audio > 1)
    ) {
      throw new Error(
        `[screenci] Overlay "${name}" (${path}) must provide a finite audio value between 0 and 1 for .mp4 overlays. Use audio: 0 for silent playback.`
      )
    }
    registeredAssetPaths.add(path)
    return createFileOverlayController(name, {
      kind: 'video',
      path,
      placement,
      fullScreen,
      ...(config.audio !== undefined && { audio: config.audio }),
    })
  }

  throw new Error(
    `[screenci] Overlay "${name}" must use one of: .html, .svg, .png, .mp4. Received: ${path}`
  )
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

/** Auto-ends any currently active overlay before a new one starts. */
function assetAutoEnd(nextAssetName: string): void {
  const context = getScreenCIRuntimeContext()
  const run = context.asset.activeAssetRun
  if (run === null) return
  if (run.startedWithExplicitStart && context.asset.activeAssetName !== null) {
    logger.warn(
      `[screenci] Overlay "${context.asset.activeAssetName}" was started with .start() and auto-ended when overlay "${nextAssetName}" started. Call .end() explicitly before starting the next overlay.`
    )
  }
  getRuntimeAssetRecorder().addAssetEnd('auto')
  sleepForAssetFrameGap()
  run.resolveFinished()
  context.asset.activeAssetName = null
  context.asset.activeAssetRun = null
}

function endActiveAsset(): void {
  const context = getScreenCIRuntimeContext()
  const run = context.asset.activeAssetRun
  if (run === null) return
  getRuntimeAssetRecorder().addAssetEnd('wait')
  sleepForAssetFrameGap()
  run.resolveFinished()
  if (context.asset.activeAssetRun === run) {
    context.asset.activeAssetName = null
    context.asset.activeAssetRun = null
  }
}

function createAssetControllerCore(
  name: string,
  validate: () => Promise<void>,
  emitStart: (recorder: IEventRecorder, mode: AssetStartMode) => void
): OverlayController {
  const start = async (startedWithExplicitStart = true): Promise<void> => {
    await validate()
    const recorder = getRuntimeAssetRecorder()
    const context = getScreenCIRuntimeContext()
    assetAutoEnd(name)
    const run = createActiveAssetRun(startedWithExplicitStart)
    context.asset.activeAssetName = name
    context.asset.activeAssetRun = run
    emitStart(recorder, { type: 'live' })
  }

  const end = async (): Promise<void> => {
    const context = getScreenCIRuntimeContext()
    if (
      context.asset.activeAssetName !== name ||
      context.asset.activeAssetRun === null
    ) {
      throw new Error(
        `Cannot call end() for overlay "${name}" because it is not the active started overlay`
      )
    }
    const run = context.asset.activeAssetRun
    endActiveAsset()
    await run.finished
  }

  const controller = (async (durationMs?: number): Promise<void> => {
    await validate()
    assetAutoEnd(name)
    const recorder = getRuntimeAssetRecorder()
    emitStart(recorder, {
      type: 'blocking',
      ...(durationMs !== undefined && { durationMs }),
    })
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

/**
 * An overlay rendered to a transparent PNG at recording time, from either an
 * HTML file or a React element. `getMarkup` produces the HTML to rasterize.
 */
function createRenderedOverlayController(
  name: string,
  getMarkup: () => Promise<string>,
  placement: OverlayPlacement,
  fullScreen: boolean,
  durationMs?: number
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
      const result = await rasterizeHtmlOverlay({ name, html })
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
 * {@link OverlayPlacement}, applying the defaults `relativeTo: 'screen'`,
 * `x: 0`, `y: 0`, and `width: 1` (when neither width nor height is given).
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
  const relativeTo = config.relativeTo ?? 'screen'
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
  }
}
