import type { Locator } from '@playwright/test'
import type { NormalizedFeature } from './declare.js'
import {
  timelineAnchorFields,
  type IEventRecorder,
  type OverlayPlacement,
  type OverlayClip,
  type SourceTrimPoint,
  type TimelineAnchorInput,
} from './events.js'
import { parseTimelineOffset, type TimelineOffset } from './timelineOffset.js'
import { validateClip, resolveSourceTrim } from './sourceTrim.js'
import { overlayRect } from './overlayRect.js'
import { captureCallerFile } from './callerFile.js'
import {
  buildClientOverlayDocument,
  buildOverlayHostDocument,
  type ClientOverlayEntry,
  type OverlayFramework,
} from './clientOverlay.js'
import {
  buildElementOverlayDocument,
  isReactElement,
  type ReactElementLike,
} from './elementOverlay.js'
import { logMissingAsset } from './missingAssetLog.js'
import { access, readFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { performRecordedSleep } from './recordedSleep.js'
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

export type { OverlayPlacement, OverlayClip } from './events.js'

/** A relative overlay length, in milliseconds. */
export type OverlayDuration = number

/**
 * Fill the whole frame instead of positioning the overlay. `'recording'`
 * fills the recording area; `'screen'` fills the entire output frame,
 * including any padding around the recording. Mutually exclusive with the
 * box fields (`x`/`y`/`width`/`height`) and with `over`.
 */
export type OverlayFillPlacement = {
  /** Which frame the overlay fills: the recording area or the whole output. */
  fill: 'recording' | 'screen'
  over?: never
  margin?: never
  relativeTo?: never
  x?: never
  y?: never
  width?: never
  height?: never
  aspectRatio?: never
}

/**
 * Position the overlay over a live element, captured at recording time from
 * the locator's bounding box. The overlay is sized to that box (plus
 * {@link OverlayOverPlacement.margin}) and fills it, so it frames the element
 * exactly (placement is always recording-relative). HTML files, inline
 * `html`, and React elements only; your content should fill its box (for
 * example `width:100%;height:100%`). Mutually exclusive with `fill` and the
 * box fields.
 */
export type OverlayOverPlacement = {
  /** The live element the overlay is positioned and sized over. */
  over: Locator
  /**
   * Extra space (CSS px) added around the {@link over} element on every side,
   * so the overlay surrounds it rather than sitting exactly on its edges.
   */
  margin?: number
  fill?: never
  relativeTo?: never
  x?: never
  y?: never
  width?: never
  height?: never
  aspectRatio?: never
}

/**
 * Explicit box placement, flat (not nested), in CSS pixels of the recording
 * viewport (the same space as Playwright's `boundingBox()`, `page.mouse`, and
 * `viewportSize()`), each field defaulting independently:
 * `relativeTo: 'recording'`, `x: 0`, `y: 0`. Provide exactly one of
 * `width`/`height` (the other follows the source aspect, or `aspectRatio`).
 */
export type OverlayBoxPlacement = {
  /** Reference box for placement coordinates. Defaults to `'recording'`. */
  relativeTo?: 'screen' | 'recording'
  /** Left edge in CSS px of the recording viewport. Defaults to `0`. */
  x?: number
  /** Top edge in CSS px of the recording viewport. Defaults to `0`. */
  y?: number
  /**
   * Aspect ratio (`width / height`) used to derive the unset axis from the one
   * you provide, instead of the source's intrinsic aspect. Optional.
   */
  aspectRatio?: number
  fill?: never
  over?: never
  margin?: never
} & (
  | {
      /** Width in CSS px. Provide instead of `height` (exactly one). */
      width: number
      height?: never
    }
  | {
      /** Height in CSS px. Provide instead of `width` (exactly one). */
      height: number
      width?: never
    }
)

/**
 * Where an overlay goes, required on every config object: fill a frame
 * (`fill`), track a live element (`over`), or an explicit box
 * (`x`/`y` + `width`|`height`). Exactly one variant must be used; the
 * variants' fields cannot be mixed.
 */
export type OverlayPlacementInput =
  | OverlayFillPlacement
  | OverlayOverPlacement
  | OverlayBoxPlacement

/**
 * Capture and timing fields shared by every overlay variant, independent of
 * placement.
 */
type OverlayCaptureCommon = {
  /**
   * Default visible length in milliseconds, used when the overlay is shown with a bare call
   * (`await overlays.logo()`) or `.for()` without its own length.
   * Omit when driving with `start()`/`end()`. Image/HTML/React overlays only.
   *
   * For animated overlays (`animate: true`) this is also the capture length: it
   * is required when driving with `start()`/`end()` (the capture length is
   * otherwise unknown).
   */
  duration?: OverlayDuration
  /**
   * Fade the overlay in over this many milliseconds when it appears.
   * Omitted = instant.
   */
  fadeIn?: number
  /**
   * Fade the overlay out over this many milliseconds when it disappears.
   * Omitted = instant.
   */
  fadeOut?: number
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
   * Clip a rectangle of the SOURCE file before it is placed/scaled, in the
   * source's own pixels (top-left origin), like Playwright's
   * `page.screenshot({ clip })`. File overlays only (`.svg`/`.png` images and
   * `.mp4` videos); rejected for `.html`/inline `html`/React `element`/`over`.
   */
  clip?: OverlayClip
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

/**
 * Placement and capture fields shared by every overlay variant. Placement is
 * mandatory: every config picks exactly one {@link OverlayPlacementInput}
 * variant (`fill`, `over`, or an explicit box with `width`/`height`).
 */
type OverlayCommon = OverlayCaptureCommon & OverlayPlacementInput

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
   * Late start into the source video: skip to this point before playing.
   * Numbers are ms; strings can be a `'0:02'`/`'0:02.5'` timecode or `'50%'` of
   * the source duration. `.mp4` overlays only.
   */
  start?: TimelineOffset
  /**
   * Early end into the source video: stop playing at this point. Same forms as
   * {@link start}; a percentage is of the source duration. `.mp4` overlays only.
   */
  end?: TimelineOffset
}

/**
 * The inline content keys an overlay config can use instead of a file `path`.
 * Every variant marks the keys it does not use as `never`, so a config can draw
 * its content from exactly one source (enforced at the type level and again at
 * recording time).
 */
type NoInlineContent = {
  element?: never
  jsx?: never
  solidJsx?: never
  html?: never
}

/**
 * A full React page overlay: `path` ends in `.tsx`. The module default-exports
 * a React component that screenci bundles (with Vite, an optional peer
 * dependency) and renders CLIENT-SIDE in the browser during capture, so the
 * full React runtime runs: function components with hooks and effects, class
 * components with lifecycle and state, inline styles, and `className`. With
 * `animate: true` the mounted app is advanced by the deterministic virtual clock
 * that samples each frame, so effect timers / `requestAnimationFrame` / state
 * updates drive the captured frames reproducibly.
 *
 * `props` are passed to the component; they must be JSON-serializable.
 */
export type TsxOverlayConfig = OverlayCommon &
  NoInlineContent & {
    /** Path to a `.tsx` module that default-exports a React component, resolved relative to the recording file. */
    path: `${string}.tsx`
    /** Serializable props passed to the component. */
    props?: Record<string, unknown>
  }

/**
 * A Solid page overlay: `path` ends in `.solid.tsx`. Works exactly like a
 * `.tsx` React overlay, but the module default-exports a Solid component and
 * is compiled with Solid's JSX transform (requires the optional peer
 * dependencies `solid-js` and `vite-plugin-solid`). The extension is the only
 * discriminator between React and Solid JSX files.
 */
export type SolidOverlayConfig = OverlayCommon &
  NoInlineContent & {
    /** Path to a `.solid.tsx` module that default-exports a Solid component, resolved relative to the recording file. */
    path: `${string}.solid.tsx`
    /** Serializable props passed to the component. */
    props?: Record<string, unknown>
  }

/**
 * A Vue single-file-component overlay: `path` ends in `.vue`. The component is
 * bundled with Vite and mounted client-side (`createApp(Component, props)`), so
 * the full Vue runtime runs, including its `<style>` block (requires the
 * optional peer dependencies `vue` and `@vitejs/plugin-vue`).
 */
export type VueOverlayConfig = OverlayCommon &
  NoInlineContent & {
    /** Path to a `.vue` single-file component, resolved relative to the recording file. */
    path: `${string}.vue`
    /** Serializable props passed to the component (declare them with `defineProps`). */
    props?: Record<string, unknown>
  }

/**
 * A Svelte component overlay: `path` ends in `.svelte`. The component is
 * bundled with Vite and mounted client-side (Svelte 5 `mount`), so the full
 * Svelte runtime runs, including its `<style>` block (requires the optional
 * peer dependencies `svelte` (v5+) and `@sveltejs/vite-plugin-svelte`).
 */
export type SvelteOverlayConfig = OverlayCommon &
  NoInlineContent & {
    /** Path to a `.svelte` component, resolved relative to the recording file. */
    path: `${string}.svelte`
    /** Serializable props passed to the component (declare them with `$props()`). */
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
export type HtmlPageOverlayConfig = OverlayCommon &
  NoInlineContent & {
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
  OverlayVideoFields &
  NoInlineContent & {
    /** File path: `.svg`/`.png` (image) or `.mp4` (video). */
    path: string
    props?: never
  }

/**
 * An inline React element overlay: the value of a JSX expression written
 * directly in the recording file (`element: <Badge label="New" />`). The
 * element is rendered in-process to static markup, so props are baked into the
 * JSX and any test-scope value can be closed over directly; there is no
 * separate `props` field. No client JS runs, so hooks and effects do not fire;
 * CSS animations still play under the virtual clock with `animate: true`.
 */
export type ElementOverlayConfig = OverlayCommon & {
  /** A React element rendered to static markup in-process. */
  element: ReactElementLike
  path?: never
  jsx?: never
  solidJsx?: never
  html?: never
  props?: never
}

/**
 * An inline React module overlay: `jsx` is the source code of a module that
 * default-exports a React component, written as a string in the recording
 * file. It is bundled with Vite and mounted client-side exactly like a `.tsx`
 * file overlay, so the full React runtime runs (hooks, effects,
 * `requestAnimationFrame`). The source is compiled in isolation for the
 * browser: it CANNOT close over test-scope variables; pass data through the
 * serializable `props` instead. Imports resolve relative to the recording
 * file's directory.
 */
export type JsxOverlayConfig = OverlayCommon & {
  /** Source of a module default-exporting a React component. */
  jsx: string
  /** Serializable props passed to the component. */
  props?: Record<string, unknown>
  path?: never
  element?: never
  solidJsx?: never
  html?: never
}

/**
 * An inline Solid module overlay: like {@link JsxOverlayConfig}, but the source
 * default-exports a Solid component and is compiled with Solid's JSX transform
 * (requires the optional peer dependencies `solid-js` and `vite-plugin-solid`).
 */
export type SolidJsxOverlayConfig = OverlayCommon & {
  /** Source of a module default-exporting a Solid component. */
  solidJsx: string
  /** Serializable props passed to the component. */
  props?: Record<string, unknown>
  path?: never
  element?: never
  jsx?: never
  html?: never
}

/**
 * An inline HTML fragment overlay: `html` is markup placed directly inside the
 * transparent host document's overlay root. Include a `<style>` tag in the
 * fragment for styling; scripts are not executed (use a `.html` file overlay
 * for a page that owns its own scripts).
 */
export type InlineHtmlOverlayConfig = OverlayCommon & {
  /** An HTML fragment placed inside the overlay root. */
  html: string
  path?: never
  element?: never
  jsx?: never
  solidJsx?: never
  props?: never
}

/**
 * Display options for an overlay. Content comes from exactly one source: a
 * file `path` (extension selects the variant: `.tsx` React / `.solid.tsx`
 * Solid / `.vue` / `.svelte` / `.html` / `.svg` / `.png` / `.mp4`), an inline
 * React `element`, inline `jsx`/`solidJsx` module source, or an inline `html`
 * fragment. Only the `.mp4` media variant accepts the video-only fields.
 */
export type OverlayConfig =
  | TsxOverlayConfig
  | SolidOverlayConfig
  | VueOverlayConfig
  | SvelteOverlayConfig
  | HtmlPageOverlayConfig
  | MediaOverlayConfig
  | ElementOverlayConfig
  | JsxOverlayConfig
  | SolidJsxOverlayConfig
  | InlineHtmlOverlayConfig

/**
 * Upper bound for an audio level (linear gain). `4` is +12 dB, plenty of
 * headroom for a boost while guarding against accidental extreme distortion.
 */
export const MAX_AUDIO_LEVEL = 4

/**
 * Placement options accepted by {@link selected}. Placement is mandatory
 * (`fill`, or an explicit box with `width`/`height`); `over`/`margin` do not
 * apply since the embedded output is a finished still or clip with no live
 * element to size against, and neither do the other source-only fields
 * (`animate`/`css`/`capturePadding`).
 */
export type DependencyOverlayOptions = (
  | OverlayFillPlacement
  | OverlayBoxPlacement
) &
  Pick<
    OverlayCaptureCommon,
    'duration' | 'clip' | 'pinToScreen' | 'overMouse' | 'fadeIn' | 'fadeOut'
  > & {
    /**
     * Late start into the embedded VIDEO (ms number/timecode/`'50%'` position).
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
 * Placement is mandatory: pass `fill` or an explicit box (`x`/`y` +
 * `width`|`height`) in the options.
 *
 * @example
 * ```ts
 * video.overlays({ intro: selected('Intro Clip', { fill: 'recording' }) })(
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
 * video.overlays({
 *   intro: selected('Intro Clip', { fill: 'recording', language: 'fi' }),
 * })('Full Demo', async ({ overlays }) => {
 *   await overlays.intro()
 * })
 * ```
 */
export function selected(
  name: string,
  options: DependencyOverlayOptions
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
 * - a `string` file path (`.tsx`/`.solid.tsx`/`.vue`/`.svelte`/`.html`/`.svg`/`.png`/`.mp4`),
 * - a React element (`<Badge label="New" />`, shorthand for `{ element }`),
 * - an {@link OverlayConfig} object, or
 * - a {@link selected} render dependency.
 */
export type OverlayInput =
  | string
  | ReactElementLike
  | OverlayConfig
  | DependencyOverlayInput

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
 * await overlays.ring(saveButton).for(1200)
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
  performRecordedSleep(
    getRuntimeAssetRecorder(),
    2 * ONE_FRAME_MS,
    'frameGap',
    (ms) => sleepFn(ms)
  )
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
   * Hold the overlay for a relative length in milliseconds, e.g. `.for(2000)`.
   * A percentage is rejected (a relative length has nothing to take a percentage
   * of). Not for `.mp4`/animated overlays, whose length is fixed.
   */
  for(duration: OverlayDuration): Promise<void>
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
 * (`.svg`/`.png`), HTML, and React overlays need a `duration` (in the config
 * or passed to `.for(...)`) unless driven with `start()`/`end()`; `.mp4`
 * overlays use their natural duration and default `audio` to `1` (natural level).
 *
 * A config object must choose a placement: `fill` ('recording' or 'screen'),
 * `over` (a locator the overlay tracks), or an explicit box with `width` or
 * `height` (coordinates are CSS px of the recording viewport). The bare
 * shorthands (a path string or a React element) fill the recording area.
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
 *   await overlays.logo.for(1200)
 * })
 * ```
 *
 * A value can also be an {@link OverlayConfigFactory} `(props) => OverlayConfig`,
 * making the overlay programmatic. Calling `overlays.name(props)` builds and
 * returns a controller you then drive with `.for(...)`, `start()`, or
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
  // Bare shorthands (a path string or a React element) have nowhere to carry
  // placement, so they mean "fill the recording area".
  if (typeof input === 'string') {
    return buildOverlayFromConfig(name, { path: input, fill: 'recording' })
  }
  // A bare React element (`badge: <Badge />`) is shorthand for `{ element }`.
  // Matched before the config branch: an element is a plain object too, but
  // carries the React `$$typeof` brand.
  if (isReactElement(input)) {
    return buildOverlayFromConfig(name, { element: input, fill: 'recording' })
  }
  return buildOverlayFromConfig(name, input)
}

/**
 * The resolved content source of an overlay config: which variant it is, plus
 * the fields that variant needs downstream. `label` names the overlay content
 * in error messages (the file path, or the inline kind).
 */
type OverlayContent =
  | {
      kind: 'bundled-file'
      path: string
      framework: OverlayFramework
      label: string
    }
  | { kind: 'html-file'; path: string; label: string }
  | {
      kind: 'media-file'
      path: string
      extension: '.svg' | '.png' | '.mp4'
      label: string
    }
  | { kind: 'element'; element: ReactElementLike; label: string }
  | {
      kind: 'inline-source'
      code: string
      framework: OverlayFramework
      label: string
    }
  | { kind: 'inline-html'; html: string; label: string }

const CONTENT_SOURCE_HINT =
  'exactly one content source: a file "path" (.tsx, .solid.tsx, .vue, .svelte, .html, .svg, .png, or .mp4), a React "element", inline "jsx"/"solidJsx" module source, or an inline "html" fragment'

/** Resolves which content variant a config uses, rejecting zero or several sources. */
function resolveOverlayContent(
  name: string,
  config: OverlayConfig
): OverlayContent {
  const sources = [
    config.path,
    config.element,
    config.jsx,
    config.solidJsx,
    config.html,
  ].filter((value) => value !== undefined)
  if (sources.length === 0) {
    throw new Error(
      `[screenci] Overlay "${name}" must provide ${CONTENT_SOURCE_HINT}.`
    )
  }
  if (sources.length > 1) {
    throw new Error(
      `[screenci] Overlay "${name}" must provide ${CONTENT_SOURCE_HINT}; several were given.`
    )
  }
  if (config.element !== undefined) {
    if (!isReactElement(config.element)) {
      throw new Error(
        `[screenci] Overlay "${name}" has an "element" that is not a React element. Pass the value of a JSX expression, for example element: <Badge />.`
      )
    }
    return { kind: 'element', element: config.element, label: 'element' }
  }
  if (config.jsx !== undefined) {
    return {
      kind: 'inline-source',
      code: config.jsx,
      framework: 'react',
      label: 'inline jsx',
    }
  }
  if (config.solidJsx !== undefined) {
    return {
      kind: 'inline-source',
      code: config.solidJsx,
      framework: 'solid',
      label: 'inline solidJsx',
    }
  }
  if (config.html !== undefined) {
    return { kind: 'inline-html', html: config.html, label: 'inline html' }
  }
  const path = config.path as string
  const extension = getAssetExtension(path)
  if (extension === null) {
    throw new Error(
      `[screenci] Overlay "${name}" must use one of: .tsx, .solid.tsx, .vue, .svelte, .html, .svg, .png, .mp4. Received: ${path}`
    )
  }
  switch (extension) {
    case '.solid.tsx':
      return { kind: 'bundled-file', path, framework: 'solid', label: path }
    case '.tsx':
      return { kind: 'bundled-file', path, framework: 'react', label: path }
    case '.vue':
      return { kind: 'bundled-file', path, framework: 'vue', label: path }
    case '.svelte':
      return { kind: 'bundled-file', path, framework: 'svelte', label: path }
    case '.html':
      return { kind: 'html-file', path, label: path }
    case '.svg':
    case '.png':
    case '.mp4':
      return { kind: 'media-file', path, extension, label: path }
  }
}

function buildOverlayFromConfig(
  name: string,
  config: OverlayConfig
): OverlayController {
  const content = resolveOverlayContent(name, config)
  const label = content.label
  // Every content variant except a media file rasterizes a rendered page.
  const isRendered = content.kind !== 'media-file'
  const props = (config as TsxOverlayConfig).props
  // The video-only fields live on MediaOverlayConfig; read them through this
  // accessor since the union member is selected at runtime by the content.
  const media = config as MediaOverlayConfig

  // `props` are a bundled-component concept (enforced at the type level too):
  // the component is compiled for the browser, so data crosses over as
  // serialized props.
  const acceptsProps =
    content.kind === 'bundled-file' || content.kind === 'inline-source'
  if (props !== undefined && !acceptsProps) {
    if (content.kind === 'element') {
      throw new Error(
        `[screenci] Overlay "${name}" (element) cannot use "props": an element renders in-process, so bake props into the JSX (element: <Badge label={value} />) and close over any test-scope values directly.`
      )
    }
    throw new Error(
      `[screenci] Overlay "${name}" (${label}) cannot use "props": props are only supported for bundled component overlays (.tsx, .solid.tsx, .vue, .svelte files, or inline jsx/solidJsx source).`
    )
  }

  const placementSource = resolvePlacementSource(name, config, { isRendered })
  const fullScreen = config.fill === 'screen'
  const pinToScreen = config.pinToScreen === true
  const overMouse = config.overMouse === true
  const fadeInMs = validateFadeMs(name, 'fadeIn', config.fadeIn)
  const fadeOutMs = validateFadeMs(name, 'fadeOut', config.fadeOut)
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
      `[screenci] Overlay "${name}" (${label}) cannot animate: "animate" is only supported for rendered page overlays (.html, .tsx, .solid.tsx, .vue, .svelte, element, jsx/solidJsx, or inline html).`
    )
  }

  const isVideoFile =
    content.kind === 'media-file' && content.extension === '.mp4'
  // speed/time/start/end re-time a moving picture, so they only apply to .mp4
  // video overlays.
  if ((media.speed !== undefined || media.time !== undefined) && !isVideoFile) {
    throw new Error(
      `[screenci] Overlay "${name}" only supports speed/time on .mp4 video overlays.`
    )
  }
  if ((media.start !== undefined || media.end !== undefined) && !isVideoFile) {
    throw new Error(
      `[screenci] Overlay "${name}" (${label}) cannot use "start"/"end": source trim is only supported for .mp4 video overlays.`
    )
  }
  // clip applies to image and video files only (not rendered pages).
  if (media.clip !== undefined && isRendered) {
    throw new Error(
      `[screenci] Overlay "${name}" (${label}) cannot use "clip": clip is only supported for image (.svg/.png) and video (.mp4) file overlays.`
    )
  }

  // Every rendered variant rasterizes to a transparent PNG (or animated clip).
  // They differ only in how the full document is produced: a bundled component
  // (file or inline source) is compiled and mounts its app into the overlay
  // root (so we wait for it to mount before measuring); an element is rendered
  // to static markup in-process; a .html file is loaded as-is; an inline html
  // fragment is wrapped in the host document.
  if (isRendered) {
    if (content.kind === 'bundled-file' || content.kind === 'html-file') {
      registerAssetPath(content.path)
    }
    const awaitMount =
      content.kind === 'bundled-file' || content.kind === 'inline-source'
    const getDocument = buildRenderedOverlayGetDocument(content, props)
    const renderOpts: OverlayRenderOpts = awaitMount ? { awaitMount: true } : {}
    if (animate) {
      return createAnimatedOverlayController(
        name,
        getDocument,
        placementSource,
        fullScreen,
        pinToScreen,
        overMouse,
        {
          ...(fadeInMs !== undefined && { fadeInMs }),
          ...(fadeOutMs !== undefined && { fadeOutMs }),
        },
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
      renderOpts,
      {
        ...(fadeInMs !== undefined && { fadeInMs }),
        ...(fadeOutMs !== undefined && { fadeOutMs }),
      }
    )
  }

  // Only the media-file kind reaches here: every rendered kind returned above.
  const path = content.path
  const extension = content.extension

  // Image/video file overlays never use `over` (rejected in
  // resolvePlacementSource), so the source is always a concrete placement.
  if (placementSource.kind !== 'fixed') {
    throw new Error(
      `[screenci] Overlay "${name}" (${label}) cannot use "over": file overlays have a fixed placement.`
    )
  }
  const placement = placementSource.placement

  // File-backed image / video overlays.
  if (extension === '.svg' || extension === '.png') {
    if (media.volume !== undefined) {
      throw new Error(
        `[screenci] Overlay "${name}" (${path}) is an image and must not provide volume. Use duration instead.`
      )
    }
    if (media.clip !== undefined) {
      validateClip(`Overlay "${name}" (${path})`, media.clip)
    }
    registerAssetPath(path)
    return createFileOverlayController(name, {
      kind: 'image',
      path,
      ...(placement !== undefined && { placement }),
      fullScreen,
      ...(pinToScreen && { pinToScreen: true }),
      ...(overMouse && { overMouse: true }),
      ...(fadeInMs !== undefined && { fadeInMs }),
      ...(fadeOutMs !== undefined && { fadeOutMs }),
      ...(configDurationMs !== undefined && { durationMs: configDurationMs }),
      ...(media.clip !== undefined && { clip: media.clip }),
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
    if (media.clip !== undefined) {
      validateClip(`Overlay "${name}" (${path})`, media.clip)
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
      ...(fadeInMs !== undefined && { fadeInMs }),
      ...(fadeOutMs !== undefined && { fadeOutMs }),
      ...(media.volume !== undefined && { audio: media.volume }),
      ...(media.speed !== undefined && { speed: media.speed }),
      ...(media.time !== undefined && { time: media.time }),
      ...(media.clip !== undefined && { clip: media.clip }),
      ...(sourceStart !== undefined && { sourceStart }),
      ...(sourceEnd !== undefined && { sourceEnd }),
    })
  }

  throw new Error(
    `[screenci] Overlay "${name}" must use one of: .tsx, .html, .svg, .png, .mp4. Received: ${path}`
  )
}

/**
 * Builds the document producer for a rendered overlay variant. Bundled
 * components and inline source resolve against the active test file at capture
 * time (not declaration time), matching how `.html` file overlays resolve.
 */
function buildRenderedOverlayGetDocument(
  content: Exclude<OverlayContent, { kind: 'media-file' }>,
  props: Record<string, unknown> | undefined
): () => Promise<string> {
  switch (content.kind) {
    case 'bundled-file':
      return (): Promise<string> => {
        const testFilePath = getScreenCIRuntimeContext().testFilePath
        const entryPath =
          testFilePath !== null
            ? resolve(dirname(testFilePath), content.path)
            : resolve(content.path)
        const entry: ClientOverlayEntry = {
          kind: 'file',
          path: entryPath,
          framework: content.framework,
        }
        return buildClientOverlayDocument(entry, props)
      }
    case 'inline-source':
      return (): Promise<string> => {
        const testFilePath = getScreenCIRuntimeContext().testFilePath
        const resolveDir =
          testFilePath !== null ? dirname(testFilePath) : resolve('.')
        const entry: ClientOverlayEntry = {
          kind: 'source',
          code: content.code,
          resolveDir,
          framework: content.framework,
        }
        return buildClientOverlayDocument(entry, props)
      }
    case 'html-file':
      return (): Promise<string> => readHtmlOverlayFile(content.path)
    case 'element':
      return (): Promise<string> => buildElementOverlayDocument(content.element)
    case 'inline-html':
      return (): Promise<string> =>
        Promise.resolve(buildOverlayHostDocument({ rootContent: content.html }))
  }
}

async function readHtmlOverlayFile(path: string): Promise<string> {
  const testFilePath = getScreenCIRuntimeContext().testFilePath
  const resolved = await resolveExistingAssetPath(path, testFilePath)
  return readFile(resolved, 'utf-8')
}

/**
 * Builds overlay controllers for Studio-managed overlays declared via
 * `video.overlays([...])`. Their file (`.svg`, `.png`, or `.mp4`),
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
 * Resolves an overlay timeline position into the anchor recorded on the asset start.
 */
function resolveOverlayAnchor(until: TimelineOffset): TimelineAnchorInput {
  const parsed = parseTimelineOffset(until)
  return parsed.kind === 'percent'
    ? { percent: parsed.fraction }
    : { outputMs: parsed.ms }
}

function resolveRelativeDuration(
  value: OverlayDuration,
  label: string
): number {
  if (!isFiniteNonNegative(value)) {
    throw new Error(
      `[screenci] ${label} must be a finite number of milliseconds greater than or equal to 0. Received: ${String(value)}.`
    )
  }
  return value
}

/** Validates an optional config `duration` (milliseconds). */
function resolveConfigDuration(
  name: string,
  duration: OverlayDuration | undefined
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

  controller.for = (duration: OverlayDuration): Promise<void> =>
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
  const dependencyVariant = classifyPlacementVariant(name, input.config)
  if (dependencyVariant === 'over') {
    throw new Error(
      `[screenci] Overlay "${name}" cannot use "over" with selected(...): an embedded render has no live element to size against.`
    )
  }
  const placement = resolveOverlayPlacement(
    name,
    input.config,
    dependencyVariant
  )
  const fullScreen = input.config.fill === 'screen'
  const pinToScreen = input.config.pinToScreen === true
  const configDurationMs = resolveConfigDuration(name, input.config.duration)
  if (input.config.clip !== undefined) {
    validateClip(`Dependency overlay "${name}"`, input.config.clip)
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
        ...(validateFadeMs(input.name, 'fadeIn', input.config.fadeIn) !==
          undefined && { fadeInMs: input.config.fadeIn }),
        ...(validateFadeMs(input.name, 'fadeOut', input.config.fadeOut) !==
          undefined && { fadeOutMs: input.config.fadeOut }),
        ...(placement !== undefined && { placement }),
        ...(input.config.clip !== undefined && { clip: input.config.clip }),
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
      fadeInMs?: number
      fadeOutMs?: number
      durationMs?: number
      clip?: OverlayClip
    }
  | {
      kind: 'video'
      path: string
      placement?: OverlayPlacement
      fullScreen: boolean
      pinToScreen?: boolean
      overMouse?: boolean
      fadeInMs?: number
      fadeOutMs?: number
      audio?: number
      speed?: number
      time?: number
      clip?: OverlayClip
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
  renderOpts: OverlayRenderOpts = {},
  fade: { fadeInMs?: number; fadeOutMs?: number } = {}
): OverlayController {
  // The document and placement are resolved during the test (cheap: a file read
  // or a component bundle, plus a boundingBox read for `over`), but rasterization
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
              `[screenci] Overlay "${name}" needs a length: use .for(2000), .until('0:05'), set "duration" in the config, or drive it with .start()/.end().`
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
        ...(fade.fadeInMs !== undefined && { fadeInMs: fade.fadeInMs }),
        ...(fade.fadeOutMs !== undefined && { fadeOutMs: fade.fadeOutMs }),
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
 * config `duration`; `start()`/`end()` requires a config `duration` (the
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
  fade: { fadeInMs?: number; fadeOutMs?: number },
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
          `[screenci] Animated overlay "${name}" cannot use .until('0:10'); its capture length must be fixed. Use .for(2000), set "duration" in the config, or drive it with .start()/.end() (with "duration" in the config).`
        )
      }
      const durationMs = mode.durationMs ?? configDurationMs
      if (durationMs === undefined) {
        throw new Error(
          `[screenci] Animated overlay "${name}" needs a length: use .for(2000), set "duration" in the config, or drive it with .start()/.end() (with "duration" in the config).`
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
    (recorder) => {
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
        ...(fade.fadeInMs !== undefined && { fadeInMs: fade.fadeInMs }),
        ...(fade.fadeOutMs !== undefined && { fadeOutMs: fade.fadeOutMs }),
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
):
  | '.tsx'
  | '.solid.tsx'
  | '.vue'
  | '.svelte'
  | '.html'
  | '.svg'
  | '.png'
  | '.mp4'
  | null {
  // The compound Solid extension is matched first: a `.solid.tsx` path also
  // ends in `.tsx`, and the longer suffix decides the JSX transform.
  if (path.toLowerCase().endsWith('.solid.tsx')) return '.solid.tsx'
  const dotIndex = path.lastIndexOf('.')
  if (dotIndex === -1) return null
  const extension = path.slice(dotIndex).toLowerCase()
  if (
    extension === '.tsx' ||
    extension === '.vue' ||
    extension === '.svelte' ||
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
 * The placement variant a config uses: `fill` a frame, track a live element
 * (`over`), or an explicit box. Exactly one; classified (and cross-variant
 * mixes rejected) by {@link classifyPlacementVariant}.
 */
type PlacementVariantKind = 'fill' | 'over' | 'box'

/**
 * Classifies which {@link OverlayPlacementInput} variant a config uses,
 * rejecting configs that mix variants or provide none. The union already
 * enforces this at the type level; this re-checks it for plain-JS callers and
 * for configs built at runtime.
 */
function classifyPlacementVariant(
  name: string,
  config: PlacementFieldBag
): PlacementVariantKind {
  const hasBoxField =
    config.x !== undefined ||
    config.y !== undefined ||
    config.width !== undefined ||
    config.height !== undefined ||
    config.relativeTo !== undefined ||
    config.aspectRatio !== undefined
  if (config.over !== undefined) {
    if (config.fill !== undefined) {
      throw new Error(
        `[screenci] Overlay "${name}" cannot set both "over" and "fill".`
      )
    }
    if (hasBoxField) {
      throw new Error(
        `[screenci] Overlay "${name}" cannot combine "over" with x/y/width/height/relativeTo. The placement comes from the locator's box.`
      )
    }
    return 'over'
  }
  if (config.margin !== undefined) {
    throw new Error(
      `[screenci] Overlay "${name}" sets "margin" without "over". "margin" only applies when positioning over a locator.`
    )
  }
  if (config.fill !== undefined) {
    if (hasBoxField) {
      throw new Error(
        `[screenci] Overlay "${name}" cannot combine "fill" with x/y/width/height/relativeTo. "fill" places the overlay over the whole frame.`
      )
    }
    return 'fill'
  }
  if (config.width === undefined && config.height === undefined) {
    throw new Error(
      `[screenci] Overlay "${name}" must choose a placement: set "fill" ('recording' or 'screen'), "over" (a locator), or an explicit box with "width" or "height" (in CSS px).`
    )
  }
  return 'box'
}

/**
 * The flat placement fields as read off a config at runtime, without the
 * union's `never` constraints (a plain-JS caller can pass anything).
 */
type PlacementFieldBag = {
  fill?: 'recording' | 'screen'
  over?: Locator
  margin?: number
  relativeTo?: 'screen' | 'recording'
  x?: number
  y?: number
  width?: number
  height?: number
  aspectRatio?: number
}

/**
 * Resolves an {@link OverlayConfig}'s flat placement fields into the event-shape
 * {@link OverlayPlacement}. Coordinates are CSS pixels in the recording viewport,
 * with the defaults `relativeTo: 'recording'`, `x: 0`, `y: 0`. For
 * `fill: 'recording'` it returns `undefined`: the overlay fills the recording
 * area, which the renderer resolves since the recording size is known there.
 * Only the `fill` and `box` variants resolve here; an `over` placement is
 * deferred to recording time (see {@link resolvePlacementSource}).
 */
function resolveOverlayPlacement(
  name: string,
  config: PlacementFieldBag,
  variant: Exclude<PlacementVariantKind, 'over'>
): OverlayPlacement | undefined {
  switch (variant) {
    case 'fill':
      // 'recording' fills the recording area (resolved by the renderer, which
      // knows its size); 'screen' fills the whole output frame.
      return config.fill === 'screen' ? { fullScreen: true } : undefined
    case 'box':
      break
    default:
      variant satisfies never
      throw new Error(
        `[screenci] Overlay "${name}" has an unknown placement variant.`
      )
  }
  if (config.width !== undefined && config.height !== undefined) {
    throw new Error(
      `[screenci] Overlay "${name}" must set only one of width or height (the other is derived from the aspect ratio).`
    )
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
  const variant = classifyPlacementVariant(name, config)
  switch (variant) {
    case 'fill':
    case 'box':
      return {
        kind: 'fixed',
        placement: resolveOverlayPlacement(name, config, variant),
      }
    case 'over':
      break
    default:
      variant satisfies never
      throw new Error(
        `[screenci] Overlay "${name}" has an unknown placement variant.`
      )
  }
  if (!flags.isRendered) {
    throw new Error(
      `[screenci] Overlay "${name}" can only use "over" with a rendered page overlay (.html, .tsx, .solid.tsx, .vue, .svelte, element, jsx/solidJsx, or inline html): the overlay is sized to the element's box.`
    )
  }
  const margin = config.margin ?? 0
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error(
      `[screenci] Overlay "${name}" must provide a finite "margin" greater than or equal to 0. Received: ${String(config.margin)}`
    )
  }
  return { kind: 'over', over: config.over!, margin }
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
      // Locator provenance: editors treat the box as pinned to the element and
      // only let the margin change.
      overLocked: true,
      marginPx: source.margin,
      elementRect: rect.element,
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

/**
 * Validates an overlay fade length (ms): a finite integer >= 0. Returns the
 * value, or undefined when unset (or 0, which means instant).
 */
function validateFadeMs(
  name: string,
  option: 'fadeIn' | 'fadeOut',
  value: number | undefined
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `[screenci] Overlay "${name}" option "${option}" must be an integer >= 0 (milliseconds); received ${value}.`
    )
  }
  return value === 0 ? undefined : value
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
            `[screenci] Overlay "${name}" (${resolved.path}) needs a length: use .for(2000), .until('0:05'), set "duration" in the config, or drive it with .start()/.end().`
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
      ...(resolved.fadeInMs !== undefined && { fadeInMs: resolved.fadeInMs }),
      ...(resolved.fadeOutMs !== undefined && {
        fadeOutMs: resolved.fadeOutMs,
      }),
      ...(resolved.clip !== undefined && { clip: resolved.clip }),
    }
  }

  if (mode.type === 'blocking' && mode.until !== undefined) {
    throw new Error(
      `[screenci] Overlay "${name}" (${resolved.path}) is a video and cannot use .until('0:10'); a video overlay plays for its natural length. Drive it with .start()/.end() to control its window.`
    )
  }
  if (mode.type === 'blocking' && mode.durationMs !== undefined) {
    throw new Error(
      `[screenci] Overlay "${name}" (${resolved.path}) is a video and cannot use .for(2000); a video overlay plays for its natural length. Use a bare call (overlays.${name}()), speed/time to re-time it, or .start()/.end() to control its window.`
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
    ...(resolved.fadeInMs !== undefined && { fadeInMs: resolved.fadeInMs }),
    ...(resolved.fadeOutMs !== undefined && { fadeOutMs: resolved.fadeOutMs }),
    ...(resolved.speed !== undefined && { speed: resolved.speed }),
    ...(resolved.time !== undefined && { time: resolved.time }),
    ...(resolved.clip !== undefined && { clip: resolved.clip }),
    ...(resolved.sourceStart !== undefined && {
      sourceStart: resolved.sourceStart,
    }),
    ...(resolved.sourceEnd !== undefined && { sourceEnd: resolved.sourceEnd }),
  }
}
