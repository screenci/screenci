import type { Locator } from '@playwright/test'
import type { NormalizedFeature } from './declare.js'
import {
  timelineAnchorFields,
  type IEventRecorder,
  type OverlayPlacement,
  type OverlayCrop,
  type SourceTrimPoint,
  type TimelineAnchorInput,
} from './events.js'
import { parseTimelineOffset, type TimelineOffset } from './timelineOffset.js'
import { validateCrop, resolveSourceTrim } from './sourceTrim.js'
import { overlayRect } from './overlayRect.js'
import { captureCallerFile } from './callerFile.js'
import { buildClientOverlayDocument } from './clientOverlay.js'
import { logMissingAsset } from './missingAssetLog.js'
import { access, readFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { resolveRecordingTimingDuration } from './runtimeMode.js'
import {
  DEFAULT_OVERLAY_DEVICE_SCALE_FACTOR,
  DEFAULT_ANIMATION_FPS,
} from './htmlRasterizer.js'
import {
  getScreenCIRuntimeContext,
  getRuntimeAssetRecorder,
  getRuntimePage,
  getRuntimeRecordingDir,
  setRuntimeAssetRecorder,
  resetAssetRuntimeState,
  type ActiveAssetRun,
} from './runtimeContext.js'

export type { OverlayPlacement, OverlayCrop } from './events.js'

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
   * Default visible length, as a relative time string (`'2s'`, `'0:02'`), used
   * when the overlay is shown with a bare call (`await overlays.logo()`) or
   * `.for()` without its own length. Seconds/timecode only (no percentage).
   * Omit when driving with `start()`/`end()`. Image/HTML/React overlays only.
   *
   * For animated overlays (`animate: true`) this is also the capture length: it
   * is required when driving with `start()`/`end()` (the capture length is
   * otherwise unknown).
   */
  duration?: TimelineOffset
  /**
   * Capture the overlay as an animation so its CSS/JS animation plays back in
   * the video (`.html`/`.tsx` page overlays only). The animation is sampled over
   * the resolved duration with a transparent background preserved. The page's own
   * `<script>` / React effects are advanced by a deterministic virtual clock, so
   * `setTimeout`/`requestAnimationFrame`-driven animation is reproducible.
   */
  animate?: boolean
  /** Animation capture frame rate. Only valid with `animate`. Defaults to `30`. */
  fps?: number
  /**
   * Crop a rectangle of the SOURCE file before it is placed/scaled, in the
   * source's own pixels (top-left origin), like Playwright's
   * `page.screenshot({ clip })`. File overlays only (`.svg`/`.png` images and
   * `.mp4` videos); rejected for `.html`/inline `html`/React `element`/`over`.
   */
  crop?: OverlayCrop
  /**
   * Keep the overlay stuck to the screen while the camera zooms: it stays at a
   * fixed position and size in the output frame, unaffected by zoom. Useful for
   * HUD-style elements (a corner logo, a persistent badge). By default (unset)
   * an overlay is "burned" into the scene, so it moves and scales with the
   * recording as the camera zooms and pans.
   */
  pinToScreen?: boolean
  /**
   * Draw this overlay ABOVE the synthetic mouse cursor, so the cursor passes
   * underneath it instead of on top. The cursor stays visible everywhere else in
   * the frame; only where the overlay sits does the overlay cover it. Useful for
   * full-screen intro or outro cards (the cursor disappears behind the card) and
   * for HUD elements like a corner logo the cursor should slide under.
   * Placement-agnostic, so it works for every overlay variant. Overlapping
   * `overMouse` overlays each draw above the cursor. Has no effect on
   * screenshots, whose cursor is hidden by default.
   */
  overMouse?: boolean
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
   * rate. Works like {@link speed} for a recording. It sets how long the (sped)
   * clip plays for, whether driven by a blocking call (`await overlays.clip()`)
   * or a live `start()`/`end()` window, since both play the clip out to its end
   * (see {@link OverlayController}); use it (or {@link time}) to make a clip run
   * shorter. Mutually exclusive with {@link time}. Video overlays only.
   */
  speed?: number
  /**
   * Target playback duration (ms) for a `.mp4` overlay, an alternative to
   * {@link speed}: the clip is sped up or slowed down so its source plays over
   * exactly this long. Works like {@link time} for a recording. Mutually
   * exclusive with {@link speed}. Video overlays only.
   */
  time?: number
  /**
   * Late start into the source video: skip to this point before playing. A time
   * string only: `'2s'`/`'1.5s'`, a `'0:02'`/`'0:02.5'` timecode, or `'50%'` of
   * the source duration. `.mp4` overlays only.
   */
  start?: TimelineOffset
  /**
   * Early end into the source video: stop playing at this point. A time string
   * only (same forms as {@link start}; a percentage is of the source duration).
   * `.mp4` overlays only.
   */
  end?: TimelineOffset
}

/**
 * A full React page overlay: `path` ends in `.tsx`. The module default-exports a
 * React component that screenci bundles (with esbuild, an optional peer
 * dependency) and renders CLIENT-SIDE in the browser during capture, so the full
 * React runtime runs: function components with hooks and effects, class
 * components with lifecycle and state, inline styles, and `className`. With
 * `animate: true` the mounted app is advanced by the deterministic virtual clock
 * that samples each frame, so effect timers / `requestAnimationFrame` / state
 * updates drive the captured frames reproducibly.
 *
 * `props` are passed to the component. They are the ONLY overlay variant that
 * accepts `props`, enforced at the type level by the `.tsx` path suffix.
 */
export type TsxOverlayConfig = OverlayCommon & {
  /** Path to a `.tsx` module that default-exports a React component, resolved relative to the recording file. */
  path: `${string}.tsx`
  /** Serializable props passed to the component (a `.tsx` overlay only). */
  props?: Record<string, unknown>
}

/**
 * A full HTML page overlay: `path` ends in `.html`. The file is loaded as a
 * complete standalone document, so its own `<style>` and `<script>` run (the
 * script is advanced by the virtual clock when `animate: true`). Author the page
 * with a transparent background (`html,body{background:transparent}`) and, for
 * tight sizing, wrap the content in `<div id="screenci-overlay-root">`. No
 * `props` (a full page owns its own content).
 */
export type HtmlPageOverlayConfig = OverlayCommon & {
  /** Path to a full `.html` document, resolved relative to the recording file. */
  path: `${string}.html`
  props?: never
}

/**
 * An image (`.svg`/`.png`) or video (`.mp4`) file overlay. Only this variant
 * accepts the {@link OverlayVideoFields} (`volume`/`speed`/`time`/`start`/`end`),
 * which apply to `.mp4` files and are rejected at recording time for images. No
 * `props`.
 */
export type MediaOverlayConfig = OverlayCommon &
  OverlayVideoFields & {
    /** File path: `.svg`/`.png` (image) or `.mp4` (video). */
    path: string
    props?: never
  }

/**
 * Display options for an overlay. Content always comes from a file `path`; the
 * extension selects the variant: `.tsx` (a client-rendered React page, the only
 * variant accepting `props`), `.html` (a full HTML document), or `.svg`/`.png`/
 * `.mp4` (image/video, the only variant accepting the video-only fields).
 */
export type OverlayConfig =
  | TsxOverlayConfig
  | HtmlPageOverlayConfig
  | MediaOverlayConfig

/**
 * Upper bound for an audio level (linear gain). `4` is +12 dB, plenty of
 * headroom for a boost while guarding against accidental extreme distortion.
 */
export const MAX_AUDIO_LEVEL = 4

/**
 * Placement options accepted by {@link selected}. These are the subset of
 * {@link OverlayCommon} that apply to a render dependency: the embedded output
 * is a finished still or clip, so source-only fields (`over`/`margin`/`animate`/
 * `css`/`capturePadding`) do not apply.
 */
export type DependencyOverlayOptions = Pick<
  OverlayCommon,
  | 'relativeTo'
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'aspectRatio'
  | 'fill'
  | 'duration'
  | 'crop'
  | 'pinToScreen'
  | 'overMouse'
> & {
  /**
   * Late start into the embedded VIDEO (a `'2s'`/timecode/`'50%'` position).
   * Video dependencies only; rejected when the target resolves to a screenshot.
   */
  start?: TimelineOffset
  /** Early end into the embedded VIDEO (video dependencies only). */
  end?: TimelineOffset
  /**
   * Also carry the embedded target's narration subtitles up into the surrounding
   * video. The embed always plays the target's audio; with this on, the target's
   * subtitles are additionally shown as subtitles of the surrounding video (in
   * its VTT track) for the window the embed plays, wherever the surrounding video
   * has no competing narration of its own. Defaults to `false`.
   */
  inheritSubtitles?: boolean
  /**
   * Pin the embed to a specific language of the target (a language code such as
   * `'fi'`), independent of the surrounding render's language. Use this to embed
   * a fixed-language version of the target no matter which language the
   * surrounding video is rendered in. When the target has no finished render in
   * this language, the dependent render FAILS explicitly (the error lists the
   * languages the target does have) rather than falling back to another one.
   * Omit to inherit the surrounding render's language (embedding the target's
   * output for the matching language, or its single language when unambiguous).
   */
  language?: string
}

/** Brand identifying a {@link selected} render-dependency overlay input. */
const DEPENDENCY_INPUT_BRAND = '__screenciSelectedDependency' as const

/**
 * The overlay input produced by {@link selected}. It embeds another render's
 * output (a video or screenshot) as an overlay rather than a local file. The
 * `name` identifies the target render (project-unique); `config` carries
 * placement. The medium and concrete output are resolved by the backend.
 */
export type DependencyOverlayInput = {
  readonly [DEPENDENCY_INPUT_BRAND]: true
  /** Project-unique name of the target video/screenshot to embed. */
  name: string
  /** Placement options for the embedded overlay. */
  config: DependencyOverlayOptions
}

/**
 * Embed another render's output as an overlay (a "render dependency"). Pass the
 * project-unique `name` of a video or screenshot; screenci embeds that target's
 * selected render for the matching language (falling back to its latest finished
 * render before anything is selected). When the target's selection changes, this
 * recording's dependents automatically re-render to embed the new output.
 *
 * No local file is read for a `selected(...)` overlay: the medium and concrete
 * output are looked up by the backend at render time. Screenshots may only embed
 * other screenshots; videos may embed either.
 *
 * The embed plays the target's audio. Pass `{ inheritSubtitles: true }` to also
 * carry the target's narration subtitles up into the surrounding video's subtitle
 * track for the window it plays, wherever the surrounding video has no competing
 * narration of its own (off by default).
 *
 * By default the embed follows the surrounding render's language. Pass
 * `{ language: 'fi' }` to pin a specific language of the target instead: the
 * dependent render then fails explicitly (listing the target's available
 * languages) when the target has no finished render in that language.
 *
 * @example
 * ```ts
 * video.overlays({ intro: selected('Intro Clip') })(
 *   'Full Demo',
 *   async ({ page, overlays }) => {
 *     await overlays.intro()
 *     await page.goto('/dashboard')
 *   }
 * )
 * ```
 *
 * @example
 * ```ts
 * // Always embed the Finnish intro, whatever language the demo renders in.
 * video.overlays({ intro: selected('Intro Clip', { language: 'fi' }) })(
 *   'Full Demo',
 *   async ({ overlays }) => {
 *     await overlays.intro()
 *   }
 * )
 * ```
 */
export function selected(
  name: string,
  options?: DependencyOverlayOptions
): DependencyOverlayInput {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(
      '[screenci] selected(name) requires the non-empty name of a video or screenshot to embed.'
    )
  }
  return {
    [DEPENDENCY_INPUT_BRAND]: true,
    name,
    config: options ?? {},
  }
}

function isDependencyOverlayInput(
  value: unknown
): value is DependencyOverlayInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)[DEPENDENCY_INPUT_BRAND] === true
  )
}

/**
 * A value accepted by {@link createOverlays} for each key:
 *
 * - a `string` file path (`.tsx`/`.html`/`.svg`/`.png`/`.mp4`),
 * - an {@link OverlayConfig} object, or
 * - a {@link selected} render dependency.
 */
export type OverlayInput = string | OverlayConfig | DependencyOverlayInput

/**
 * A factory that builds an {@link OverlayConfig} from caller-supplied props.
 * Use this to make an overlay programmatic: the returned config (its `path`,
 * `props`, and placement) can depend on values only known at runtime, for
 * example a locator's position captured with {@link overlayRect}.
 *
 * @example
 * ```tsx
 * const overlays = createOverlays({
 *   ring: (t: Locator) => ({ path: './ring.html', over: t, margin: 6 }),
 * })
 * await overlays.ring(saveButton).for('1.2s')
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

const warnedMissingOverlayPaths = new Set<string>()

export function resetMissingOverlayWarnings(): void {
  warnedMissingOverlayPaths.clear()
}

/**
 * Checks that an overlay file exists. A missing file is not fatal: the overlay
 * is recovered from a previous upload of this video (matched by name/path) at
 * upload time, so a gitignored overlay file does not have to be committed. The
 * overlay is composited by the renderer, not into the local recording, so a
 * missing file does not change what is captured locally.
 */
async function validateAssetPath(
  assetPath: string,
  testFilePath: string | null
): Promise<void> {
  try {
    await resolveExistingAssetPath(assetPath, testFilePath)
  } catch {
    if (warnedMissingOverlayPaths.has(assetPath)) return
    warnedMissingOverlayPaths.add(assetPath)
    logMissingAsset('overlay', assetPath)
  }
}

/**
 * An overlay controller.
 *
 * Calling it shows the overlay over a frozen frame for a fixed duration
 * (blocking). Use `start()`/`end()` to keep the overlay on screen while the page
 * is driven underneath.
 *
 * For an overlay with an intrinsic length (a `.mp4` video, an embedded video
 * dependency, or an animated HTML/React clip), `end()` lets the clip finish: if
 * the media outlasts the live window, the remainder plays out over a frozen
 * frame before the timeline continues, rather than being cut. To show less of
 * such a clip, trim it (`start`/`end`/`speed`/`time`, or `selected(..., { end })`)
 * rather than ending early. Length-less overlays (image, inline `html`, React)
 * end exactly at `end()`.
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
  /**
   * Hold the overlay for its natural length. Valid only for a source with an
   * intrinsic length (a `.mp4` video, or an embedded video dependency). Image,
   * inline `html`, and React overlays have no natural length: use `.for(...)`,
   * `.until(...)`, or drive them with `start()`/`end()`.
   */
  (): Promise<void>
  /**
   * Hold the overlay for a relative length, e.g. `.for('2s')` or `.for('0:02')`.
   * Seconds and timecodes only; a percentage is rejected (a relative length has
   * nothing to take a percentage of). Not for `.mp4`/animated overlays, whose
   * length is fixed.
   */
  for(duration: TimelineOffset): Promise<void>
  /**
   * Keep the overlay visible until this absolute point in the final video (a
   * `'<n>s'`/timecode position, or a `'<n>%'` fraction). Supported for image,
   * HTML/React (static), and embedded-render overlays; not for `.mp4` or animated
   * overlays, whose length is fixed. Successive `.until(...)` targets must be
   * monotonic (each at or after the previous timeline point).
   */
  until(position: TimelineOffset): Promise<void>
  /** Show the overlay live over the recording (non-blocking); pair with `end()`. */
  start(): Promise<void>
  /**
   * Stop a live overlay. For a length-less overlay (image/HTML/React) it ends
   * immediately. For an overlay with an intrinsic length (video / dependency /
   * animated) whose media has not finished, the clip plays out to its natural
   * end over a frozen frame before the timeline continues; trim the source to
   * show less instead of ending early.
   */
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

function buildOverlayController(
  name: string,
  input: OverlayInputOrFactory
): OverlayController | ((props: unknown) => OverlayController) {
  // A render dependency (selected(...)) embeds another render's output. It is a
  // plain (branded) object, so it is matched before the generic config path,
  // which would otherwise reject it for having no path.
  if (isDependencyOverlayInput(input)) {
    return createDependencyOverlayController(name, input)
  }
  // A factory is the only callable input. Config objects are plain objects, so
  // this branch never captures them. The config (and its validation) is built
  // per call so props can vary placement and content.
  if (typeof input === 'function') {
    return (props: unknown) =>
      buildOverlayFromConfig(name, (input as OverlayConfigFactory)(props))
  }
  if (typeof input === 'string') {
    return buildOverlayFromConfig(name, { path: input })
  }
  return buildOverlayFromConfig(name, input)
}

function buildOverlayFromConfig(
  name: string,
  config: OverlayConfig
): OverlayController {
  if (config.path === undefined) {
    throw new Error(
      `[screenci] Overlay "${name}" must provide a "path" (a .tsx, .html, .svg, .png, or .mp4 file).`
    )
  }
  const path = config.path
  const extension = getAssetExtension(path)
  if (extension === null) {
    throw new Error(
      `[screenci] Overlay "${name}" must use one of: .tsx, .html, .svg, .png, .mp4. Received: ${path}`
    )
  }
  const isRendered = extension === '.tsx' || extension === '.html'
  const tsxConfig = config as TsxOverlayConfig
  // The video-only fields live on MediaOverlayConfig; read them through this
  // accessor since the union member is selected at runtime by the extension.
  const media = config as MediaOverlayConfig

  // `props` are a .tsx-page-only concept (enforced at the type level too).
  if (tsxConfig.props !== undefined && extension !== '.tsx') {
    throw new Error(
      `[screenci] Overlay "${name}" (${path}) cannot use "props": props are only supported for .tsx page overlays.`
    )
  }

  const placementSource = resolvePlacementSource(name, config, { isRendered })
  const fullScreen = config.fill === 'screen'
  const pinToScreen = config.pinToScreen === true
  const overMouse = config.overMouse === true
  const animate = config.animate === true
  // Parse the relative `duration` string into ms once; reused by every branch.
  const configDurationMs = resolveConfigDuration(name, config.duration)
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
  if (animate && !isRendered) {
    throw new Error(
      `[screenci] Overlay "${name}" (${path}) cannot animate: "animate" is only supported for .html and .tsx page overlays.`
    )
  }

  // speed/time/start/end re-time a moving picture, so they only apply to .mp4
  // video overlays.
  if (
    (media.speed !== undefined || media.time !== undefined) &&
    extension !== '.mp4'
  ) {
    throw new Error(
      `[screenci] Overlay "${name}" only supports speed/time on .mp4 video overlays.`
    )
  }
  if (
    (media.start !== undefined || media.end !== undefined) &&
    extension !== '.mp4'
  ) {
    throw new Error(
      `[screenci] Overlay "${name}" (${path}) cannot use "start"/"end": source trim is only supported for .mp4 video overlays.`
    )
  }
  // crop applies to image and video files only (not rendered pages).
  if (media.crop !== undefined && isRendered) {
    throw new Error(
      `[screenci] Overlay "${name}" (${path}) cannot use "crop": crop is only supported for image (.svg/.png) and video (.mp4) file overlays.`
    )
  }

  // .tsx (client-rendered React page) and .html (full document) both rasterize
  // to a transparent PNG (or animated clip). They differ only in how the full
  // document is produced: a .tsx is bundled and mounts its React app into the
  // overlay root (so we wait for it to mount before measuring); a .html file is
  // loaded as-is.
  if (isRendered) {
    registerAssetPath(path)
    const awaitMount = extension === '.tsx'
    const getDocument =
      extension === '.tsx'
        ? (): Promise<string> => {
            const testFilePath = getScreenCIRuntimeContext().testFilePath
            const entryPath =
              testFilePath !== null
                ? resolve(dirname(testFilePath), path)
                : resolve(path)
            return buildClientOverlayDocument(entryPath, tsxConfig.props)
          }
        : (): Promise<string> => readHtmlOverlayFile(path)
    const renderOpts: OverlayRenderOpts = awaitMount ? { awaitMount: true } : {}
    if (animate) {
      return createAnimatedOverlayController(
        name,
        getDocument,
        placementSource,
        fullScreen,
        pinToScreen,
        overMouse,
        config.fps,
        configDurationMs,
        renderOpts
      )
    }
    return createRenderedOverlayController(
      name,
      getDocument,
      placementSource,
      fullScreen,
      pinToScreen,
      overMouse,
      configDurationMs,
      renderOpts
    )
  }

  // Image/video file overlays never use `over` (rejected in
  // resolvePlacementSource), so the source is always a concrete placement.
  const placement =
    placementSource.kind === 'fixed'
      ? placementSource.placement
      : resolveOverlayPlacement(name, config)

  // File-backed image / video overlays.
  if (extension === '.svg' || extension === '.png') {
    if (media.volume !== undefined) {
      throw new Error(
        `[screenci] Overlay "${name}" (${path}) is an image and must not provide volume. Use duration instead.`
      )
    }
    if (media.crop !== undefined) {
      validateCrop(`Overlay "${name}" (${path})`, media.crop)
    }
    registerAssetPath(path)
    return createFileOverlayController(name, {
      kind: 'image',
      path,
      ...(placement !== undefined && { placement }),
      fullScreen,
      ...(pinToScreen && { pinToScreen: true }),
      ...(overMouse && { overMouse: true }),
      ...(configDurationMs !== undefined && { durationMs: configDurationMs }),
      ...(media.crop !== undefined && { crop: media.crop }),
    })
  }

  if (extension === '.mp4') {
    if (config.duration !== undefined) {
      throw new Error(
        `[screenci] Overlay "${name}" (${path}) is a video and must not provide duration. Its natural media duration is used instead.`
      )
    }
    if (
      media.volume !== undefined &&
      (!Number.isFinite(media.volume) ||
        media.volume < 0 ||
        media.volume > MAX_AUDIO_LEVEL)
    ) {
      throw new Error(
        `[screenci] Overlay "${name}" (${path}) must provide a finite volume between 0 and ${MAX_AUDIO_LEVEL} for .mp4 overlays. 1 is the natural level, 0 is silent, and values above 1 boost it.`
      )
    }
    validateSpeedTime(`Overlay "${name}" (${path})`, media.speed, media.time)
    if (media.crop !== undefined) {
      validateCrop(`Overlay "${name}" (${path})`, media.crop)
    }
    const { sourceStart, sourceEnd } = resolveSourceTrim(
      `Overlay "${name}" (${path})`,
      media.start,
      media.end
    )
    registerAssetPath(path)
    return createFileOverlayController(name, {
      kind: 'video',
      path,
      ...(placement !== undefined && { placement }),
      fullScreen,
      ...(pinToScreen && { pinToScreen: true }),
      ...(overMouse && { overMouse: true }),
      ...(media.volume !== undefined && { audio: media.volume }),
      ...(media.speed !== undefined && { speed: media.speed }),
      ...(media.time !== undefined && { time: media.time }),
      ...(media.crop !== undefined && { crop: media.crop }),
      ...(sourceStart !== undefined && { sourceStart }),
      ...(sourceEnd !== undefined && { sourceEnd }),
    })
  }

  throw new Error(
    `[screenci] Overlay "${name}" must use one of: .tsx, .html, .svg, .png, .mp4. Received: ${path}`
  )
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

/**
 * Build overlay controllers for a `video.overlays(...)` declaration. Studio
 * (array) names become Studio-managed controllers; code (object) names resolve
 * their config for the active language (`byLang[language] ?? shared`) and become
 * regular overlay controllers. Per-language mode realizes one language per pass,
 * so the active-language config is the one captured.
 */
export function buildOverlays(
  feature: NormalizedFeature<OverlayInputOrFactory> | null | undefined,
  language: string | undefined
): Record<string, OverlayController | ((props: unknown) => OverlayController)> {
  const result: Record<
    string,
    OverlayController | ((props: unknown) => OverlayController)
  > = {}
  if (!feature) return result
  for (const name of feature.studioNames) {
    result[name] = createStudioAssetController(name)
  }
  for (const name of feature.codeNames) {
    const input =
      (language !== undefined ? feature.byLang[language]?.[name] : undefined) ??
      feature.shared[name]
    if (input === undefined) continue
    result[name] = buildOverlayController(name, input)
  }
  return result
}

type AssetStartMode =
  | { type: 'blocking'; durationMs?: number; until?: TimelineAnchorInput }
  | { type: 'live' }

/**
 * Resolves a string overlay position into the anchor recorded on the asset start.
 * Throws on a non-string value so callers that meant a numeric duration are not
 * silently misrouted into the parser.
 */
function resolveOverlayAnchor(until: TimelineOffset): TimelineAnchorInput {
  if (typeof until !== 'string') {
    throw new Error(
      `overlay positions must be a string such as '0:10' or '56%', got ${typeof until}`
    )
  }
  const parsed = parseTimelineOffset(until)
  return parsed.kind === 'percent'
    ? { percent: parsed.fraction }
    : { outputMs: parsed.ms }
}

/**
 * Resolves a relative length string (`.for('2s')` or a config `duration`) into
 * milliseconds. Seconds and timecodes only: a percentage is rejected because a
 * relative length has nothing to take a percentage of (use `.until('<n>%')` for
 * an absolute position instead).
 */
function resolveRelativeDuration(value: TimelineOffset, label: string): number {
  if (typeof value !== 'string') {
    throw new Error(
      `[screenci] ${label} must be a time string such as '2s' or '0:02', got ${typeof value}.`
    )
  }
  const parsed = parseTimelineOffset(value)
  if (parsed.kind === 'percent') {
    throw new Error(
      `[screenci] ${label} cannot be a percentage ('${value}'); a relative length needs a concrete time like '2s' or '0:02'. Use .until('${value}') for an absolute position.`
    )
  }
  return parsed.ms
}

/** Parses an optional config `duration` (a relative time string) into ms. */
function resolveConfigDuration(
  name: string,
  duration: TimelineOffset | undefined
): number | undefined {
  if (duration === undefined) return undefined
  return resolveRelativeDuration(duration, `Overlay "${name}" duration`)
}

function createActiveAssetRun(
  startedWithExplicitStart: boolean
): ActiveAssetRun {
  let resolve!: () => void
  const finished = new Promise<void>((resolveFn) => {
    resolve = resolveFn
  })
  return {
    finished,
    resolveFinished: resolve,
    startedWithExplicitStart,
  }
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
  options: {
    /**
     * Optional async step run after {@link validate} and before
     * {@link emitStart}, receiving the resolved start mode. Used by animated
     * overlays to rasterize the clip once the capture length (mode duration) is
     * known.
     */
    prepare?: (mode: AssetStartMode) => Promise<void>
  } = {}
): OverlayController {
  const { prepare } = options
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

  // A blocking overlay holds a frozen frame. It never registers a live run and
  // never ends overlays that are already live, so it can run while other overlays
  // stay composited across the frame.
  const runBlocking = async (mode: AssetStartMode): Promise<void> => {
    await validate()
    await prepare?.(mode)
    const recorder = getRuntimeAssetRecorder()
    emitStart(recorder, mode)
  }

  const controller = (async (): Promise<void> => {
    // Bare call: hold for the source's natural length. Length-less overlays
    // (image/html/element) reject this downstream and must use .for()/.until().
    await runBlocking({ type: 'blocking' })
  }) as OverlayController

  controller.for = (duration: TimelineOffset): Promise<void> =>
    runBlocking({
      type: 'blocking',
      durationMs: resolveRelativeDuration(
        duration,
        `Overlay "${name}" .for(duration)`
      ),
    })

  // A string position sets an absolute point to stay visible until (resolved at
  // render time, so a percentage is kept symbolic).
  controller.until = (position: TimelineOffset): Promise<void> =>
    runBlocking({ type: 'blocking', until: resolveOverlayAnchor(position) })

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

/**
 * Builds the controller for a {@link selected} render-dependency overlay. No
 * local file is read: the controller emits an `assetStart` carrying the target's
 * name (an {@link OverlayDependencyRef}); the backend resolves it to a concrete
 * output at render time. Placement is fixed (no `over`), so it is resolved up
 * front. A blocking call needs a duration (from the call or config); a
 * `start()`/`end()` window needs none.
 */
function createDependencyOverlayController(
  name: string,
  input: DependencyOverlayInput
): OverlayController {
  // `over`/`margin` are not in DependencyOverlayOptions, so placement is always
  // fixed here (an embedded render has no live element to size against).
  const placement = resolveOverlayPlacement(name, input.config)
  const fullScreen = input.config.fill === 'screen'
  const pinToScreen = input.config.pinToScreen === true
  const configDurationMs = resolveConfigDuration(name, input.config.duration)
  if (input.config.crop !== undefined) {
    validateCrop(`Dependency overlay "${name}"`, input.config.crop)
  }
  // start/end are valid only when the target resolves to a VIDEO; the backend
  // rejects them for a screenshot dependency (the medium is unknown until then).
  const { sourceStart, sourceEnd } = resolveSourceTrim(
    `Dependency overlay "${name}"`,
    input.config.start,
    input.config.end
  )
  return createAssetControllerCore(
    name,
    () => Promise.resolve(),
    (recorder, mode) => {
      let durationMs: number | undefined
      let until: TimelineAnchorInput | undefined
      if (mode.type === 'blocking') {
        if (mode.until !== undefined) {
          until = mode.until
        } else {
          // No length => natural duration. Valid for a video dependency; the
          // backend rejects a screenshot dependency with no length when it
          // resolves the concrete medium.
          durationMs = mode.durationMs ?? configDurationMs
        }
      }
      recorder.addAssetStart(name, {
        kind: 'dependency',
        dependency: {
          name: input.name,
          ...(input.config.language !== undefined && {
            language: input.config.language,
          }),
          ...(input.config.inheritSubtitles === true && {
            inheritSubtitles: true,
          }),
        },
        ...(durationMs !== undefined && { durationMs }),
        ...timelineAnchorFields(until),
        fullScreen,
        ...(pinToScreen && { pinToScreen: true }),
        ...(input.config.overMouse === true && { overMouse: true }),
        ...(placement !== undefined && { placement }),
        ...(input.config.crop !== undefined && { crop: input.config.crop }),
        ...(sourceStart !== undefined && { sourceStart }),
        ...(sourceEnd !== undefined && { sourceEnd }),
      })
    }
  )
}

/** A file-backed overlay resolved from {@link OverlayConfig} for recording. */
type ResolvedFileOverlay =
  | {
      kind: 'image'
      path: string
      placement?: OverlayPlacement
      fullScreen: boolean
      pinToScreen?: boolean
      overMouse?: boolean
      durationMs?: number
      crop?: OverlayCrop
    }
  | {
      kind: 'video'
      path: string
      placement?: OverlayPlacement
      fullScreen: boolean
      pinToScreen?: boolean
      overMouse?: boolean
      audio?: number
      speed?: number
      time?: number
      crop?: OverlayCrop
      sourceStart?: SourceTrimPoint
      sourceEnd?: SourceTrimPoint
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

/** Capture options shared by rendered (`.html`/`.tsx` page) overlay controllers. */
type OverlayRenderOpts = {
  /** Wait for the overlay root to mount before capture (a `.tsx` client-rendered page). */
  awaitMount?: boolean
}

/**
 * An overlay rendered to a transparent PNG at recording time, from either a full
 * `.html` document or a bundled `.tsx` page. `getDocument` produces the full
 * overlay document to rasterize.
 */
function createRenderedOverlayController(
  name: string,
  getDocument: () => Promise<string>,
  placementSource: PlacementSource,
  fullScreen: boolean,
  pinToScreen: boolean,
  overMouse: boolean,
  durationMs?: number,
  renderOpts: OverlayRenderOpts = {}
): OverlayController {
  // The document and placement are resolved during the test (cheap: a file read
  // or an esbuild bundle, plus a boundingBox read for `over`), but rasterization
  // (a browser screenshot) is deferred to after the test so identical overlays
  // render once. See overlayFlush.ts.
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
      let until: TimelineAnchorInput | undefined
      if (mode.type === 'blocking') {
        if (mode.until !== undefined) {
          until = mode.until
        } else {
          durationMsForEvent = mode.durationMs ?? durationMs
          if (durationMsForEvent === undefined) {
            throw new Error(
              `[screenci] Overlay "${name}" needs a length: use .for('2s'), .until('0:05'), set "duration" in the config, or drive it with .start()/.end().`
            )
          }
          validateDurationMs(name, `overlay "${name}"`, durationMsForEvent)
        }
      }
      recorder.addPendingAssetStart(name, {
        kind: 'image',
        ...(durationMsForEvent !== undefined && {
          durationMs: durationMsForEvent,
        }),
        ...timelineAnchorFields(until),
        fullScreen,
        ...(pinToScreen && { pinToScreen: true }),
        ...(overMouse && { overMouse: true }),
        ...(resolvedPlacement !== undefined && {
          placement: resolvedPlacement,
        }),
        request: {
          kind: 'image',
          name,
          html: resolvedHtml,
          ...(renderOpts.awaitMount === true && { awaitMount: true }),
          deviceScaleFactor: DEFAULT_OVERLAY_DEVICE_SCALE_FACTOR,
        },
      })
    },
    {
      prepare: async () => {
        if (resolvedHtml !== undefined || skipped) return
        // Resolving an overlay needs an active recording page and output dir.
        // Outside recording (e.g. plain test runs) there is nothing to upload,
        // so the controller is a no-op, mirroring the no-op recorder.
        if (getRuntimePage() === null || getRuntimeRecordingDir() === null) {
          skipped = true
          return
        }
        const { placement, sizePx } = await resolvePlacement(placementSource)
        resolvedPlacement = placement
        const document = await getDocument()
        resolvedHtml =
          sizePx !== undefined
            ? injectOverlayRootSize(document, sizePx)
            : document
      },
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
  getDocument: () => Promise<string>,
  placementSource: PlacementSource,
  fullScreen: boolean,
  pinToScreen: boolean,
  overMouse: boolean,
  fps: number | undefined,
  configDurationMs: number | undefined,
  renderOpts: OverlayRenderOpts = {}
): OverlayController {
  let resolved:
    | {
        html: string
        durationMs: number
        placement?: OverlayPlacement
      }
    | undefined
  let skipped = false

  const resolveDurationMs = (mode: AssetStartMode): number => {
    if (mode.type === 'blocking') {
      if (mode.until !== undefined) {
        throw new Error(
          `[screenci] Animated overlay "${name}" cannot use .until('0:10'); its capture length must be fixed. Use .for('2s'), set "duration" in the config, or drive it with .start()/.end() (with "duration" in the config).`
        )
      }
      const durationMs = mode.durationMs ?? configDurationMs
      if (durationMs === undefined) {
        throw new Error(
          `[screenci] Animated overlay "${name}" needs a length: use .for('2s'), set "duration" in the config, or drive it with .start()/.end() (with "duration" in the config).`
        )
      }
      validateDurationMs(name, `overlay "${name}"`, durationMs)
      return durationMs
    }
    if (configDurationMs === undefined) {
      throw new Error(
        `[screenci] Animated overlay "${name}" driven with .start()/.end() needs "duration" in its config (the capture length is otherwise unknown).`
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
        // Always carry the capture length, for blocking and live overlays alike.
        // A live animated overlay plays out to this length (the renderer holds a
        // frozen-frame tail when it is longer than the start()/end() window), so
        // it needs the duration even when an assetEnd also bounds the window.
        durationMs: resolved.durationMs,
        fullScreen,
        ...(pinToScreen && { pinToScreen: true }),
        ...(overMouse && { overMouse: true }),
        ...(resolved.placement !== undefined && {
          placement: resolved.placement,
        }),
        request: {
          kind: 'animation',
          name,
          html: resolved.html,
          ...(renderOpts.awaitMount === true && { awaitMount: true }),
          deviceScaleFactor: DEFAULT_OVERLAY_DEVICE_SCALE_FACTOR,
          fps: fps ?? DEFAULT_ANIMATION_FPS,
          durationMs: resolved.durationMs,
        },
      })
    },
    {
      prepare: async (mode) => {
        // Outside recording there is nothing to upload, so the controller is a
        // no-op, mirroring the no-op recorder and the static rendered controller.
        if (getRuntimePage() === null || getRuntimeRecordingDir() === null) {
          skipped = true
          return
        }
        const durationMs = resolveDurationMs(mode)
        const { placement, sizePx } = await resolvePlacement(placementSource)
        const document = await getDocument()
        resolved = {
          html:
            sizePx !== undefined
              ? injectOverlayRootSize(document, sizePx)
              : document,
          durationMs,
          ...(placement !== undefined && { placement }),
        }
      },
    }
  )
}

function getAssetExtension(
  path: string
): '.tsx' | '.html' | '.svg' | '.png' | '.mp4' | null {
  const dotIndex = path.lastIndexOf('.')
  if (dotIndex === -1) return null
  const extension = path.slice(dotIndex).toLowerCase()
  if (
    extension === '.tsx' ||
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
  config: OverlayCommon
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
  flags: { isRendered: boolean }
): PlacementSource {
  if (config.margin !== undefined && config.over === undefined) {
    throw new Error(
      `[screenci] Overlay "${name}" sets "margin" without "over". "margin" only applies when positioning over a locator.`
    )
  }
  if (config.over === undefined) {
    return { kind: 'fixed', placement: resolveOverlayPlacement(name, config) }
  }

  if (!flags.isRendered) {
    throw new Error(
      `[screenci] Overlay "${name}" can only use "over" with a .html or .tsx page overlay (the overlay is sized to the element's box).`
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
 * Injects a fixed CSS-pixel size for the overlay root into a full overlay
 * document, so the rasterized PNG carries the element's box (used by `over`,
 * which sizes the overlay to a locator). The renderer then lands it exactly on
 * the element's box. The page's content should fill the root
 * (`width:100%;height:100%`). Applied by inserting a `<style>` right after
 * `<head>` (or at the start of the document if there is no head), sizing
 * `#screenci-overlay-root` and falling back to `body`.
 */
function injectOverlayRootSize(
  document: string,
  size: { width: number; height: number }
): string {
  const style =
    `<style>html,body{margin:0}` +
    `#screenci-overlay-root,body{` +
    `width:${size.width}px;height:${size.height}px;box-sizing:border-box}` +
    `</style>`
  const headMatch = /<head[^>]*>/i.exec(document)
  if (headMatch !== null) {
    const at = headMatch.index + headMatch[0].length
    return document.slice(0, at) + style + document.slice(at)
  }
  return style + document
}

function toRecordedFileStart(
  name: string,
  resolved: ResolvedFileOverlay,
  mode: AssetStartMode
): Parameters<IEventRecorder['addAssetStart']>[1] {
  if (resolved.kind === 'image') {
    let durationMs: number | undefined
    let until: TimelineAnchorInput | undefined
    if (mode.type === 'blocking') {
      if (mode.until !== undefined) {
        until = mode.until
      } else {
        durationMs = mode.durationMs ?? resolved.durationMs
        if (durationMs === undefined) {
          throw new Error(
            `[screenci] Overlay "${name}" (${resolved.path}) needs a length: use .for('2s'), .until('0:05'), set "duration" in the config, or drive it with .start()/.end().`
          )
        }
        validateDurationMs(name, resolved.path, durationMs)
      }
    }
    return {
      kind: 'image',
      path: resolved.path,
      ...(durationMs !== undefined && { durationMs }),
      ...timelineAnchorFields(until),
      fullScreen: resolved.fullScreen,
      ...(resolved.pinToScreen && { pinToScreen: true }),
      ...(resolved.overMouse && { overMouse: true }),
      ...(resolved.placement !== undefined && {
        placement: resolved.placement,
      }),
      ...(resolved.crop !== undefined && { crop: resolved.crop }),
    }
  }

  if (mode.type === 'blocking' && mode.until !== undefined) {
    throw new Error(
      `[screenci] Overlay "${name}" (${resolved.path}) is a video and cannot use .until('0:10'); a video overlay plays for its natural length. Drive it with .start()/.end() to control its window.`
    )
  }
  if (mode.type === 'blocking' && mode.durationMs !== undefined) {
    throw new Error(
      `[screenci] Overlay "${name}" (${resolved.path}) is a video and cannot use .for('2s'); a video overlay plays for its natural length. Use a bare call (overlays.${name}()), speed/time to re-time it, or .start()/.end() to control its window.`
    )
  }

  return {
    kind: 'video',
    path: resolved.path,
    audio: resolved.audio ?? 1,
    fullScreen: resolved.fullScreen,
    ...(resolved.pinToScreen && { pinToScreen: true }),
    ...(resolved.overMouse && { overMouse: true }),
    ...(resolved.placement !== undefined && { placement: resolved.placement }),
    ...(resolved.speed !== undefined && { speed: resolved.speed }),
    ...(resolved.time !== undefined && { time: resolved.time }),
    ...(resolved.crop !== undefined && { crop: resolved.crop }),
    ...(resolved.sourceStart !== undefined && {
      sourceStart: resolved.sourceStart,
    }),
    ...(resolved.sourceEnd !== undefined && { sourceEnd: resolved.sourceEnd }),
  }
}
