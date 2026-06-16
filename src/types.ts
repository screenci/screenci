import type {
  PlaywrightTestConfig,
  Project,
  Page,
  Locator,
  Mouse,
} from '@playwright/test'
import type { StudioRenderOptionsSentinel } from './studio.js'
import type { PerformanceOption } from './performance.js'

/**
 * Aspect ratio for recording and output.
 *
 * The aspect ratio determines the shape of the video. Combined with `quality`
 * it produces the final pixel dimensions:
 *
 * | Aspect Ratio | 720p      | 1080p      | 1440p      | 2160p      |
 * |--------------|-----------|------------|------------|------------|
 * | 16:9         | 1280×720  | 1920×1080  | 2560×1440  | 3840×2160  |
 * | 9:16         | 720×1280  | 1080×1920  | 1440×2560  | 2160×3840  |
 * | 1:1          | 720×720   | 1080×1080  | 1440×1440  | 2160×2160  |
 * | 4:3          | 960×720   | 1440×1080  | 1920×1440  | 2880×2160  |
 * | 3:4          | 720×960   | 1080×1440  | 1440×1920  | 2160×2880  |
 * | 5:4          | 900×720   | 1350×1080  | 1800×1440  | 2700×2160  |
 * | 4:5          | 720×900   | 1080×1350  | 1440×1800  | 2160×2700  |
 *
 * The base size (shorter side) is determined by `quality`.
 * Landscape ratios (W>H) set height to the base; portrait ratios (H>W) set
 * width to the base.
 */
export type AspectRatio =
  | '16:9'
  | '9:16'
  | '1:1'
  | '4:3'
  | '3:4'
  | '5:4'
  | '4:5'

/**
 * Resolution quality preset – determines the shorter-side pixel count and,
 * by extension, the overall output sharpness and file size.
 *
 * - `'720p'`   – 720 px short side (HD)
 * - `'1080p'`  – 1080 px short side (Full HD)
 * - `'1440p'`  – 1440 px short side (Quad HD)
 * - `'2160p'`  – 2160 px short side (Ultra HD / 4K)
 *
 * The final pixel dimensions depend on both `quality` and `aspectRatio`.
 * See {@link AspectRatio} for the full dimension table.
 */
export type Quality = '720p' | '1080p' | '1440p' | '2160p'

/**
 * Frames per second for video recording.
 *
 * Higher FPS results in smoother videos but larger file sizes:
 * - `24` - Cinematic look, smaller files
 * - `30` - Standard video, balanced quality and size
 * - `60` - Smooth motion, best for fast interactions
 *
 * @remarks Chrome caps recording at 60 FPS: https://stackoverflow.com/a/63972999
 */
export type FPS = 24 | 30 | 60

/**
 * Upload policy for `screenci record`.
 *
 * - `'passed-only'` uploads completed recordings even if other videos failed.
 * - `'all-or-nothing'` skips all uploads when any video fails.
 *
 * @default 'passed-only'
 */
export type RecordUploadPolicy = 'passed-only' | 'all-or-nothing'

/**
 * Rendering options passed as-is to `data.json`.
 * Mirrors the `renderOptions` shape consumed by the rendering pipeline.
 */
export type RenderOptions = {
  recording?: {
    /** 0-1: 0 causes warning, 1=one side touches background edge */
    size?: number
    /** 0-1: 0=sharp corners, 1=shorter side is half circle */
    roundness?: number
    shape?: 'rounded'
    /** CSS drop-shadow filter */
    dropShadow?: string
  }
  narration?: {
    /** 0-1: 1=mask size equals shorter side of output */
    size?: number
    /** 0-1: 0=square, 1=circle */
    roundness?: number
    shape?: 'rounded'
    /**
     * Narration shadow strength (0-1).
     * - 0 disables shadow
     * - 1 maps to maximum shadow
     */
    dropShadow?: number
    corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    /** 0-1: 0=nothing, 1=length of shorter side of the frame */
    padding?: number
  }
  mouse?: {
    /** 0-1: 0=missing, 1=height of video */
    size?: number
    /** Cursor colour. Defaults to `'white'`. */
    style?: 'white' | 'black'
    /**
     * Cursor motion blur, 0-1. Defaults to `0.5`; `0` disables it. The value is
     * the shutter open time as a fraction of one output frame interval, so a
     * fast-moving cursor smears along its path. Slow or static frames cost
     * nothing.
     */
    motionBlur?: number
  }
  zoom?: {
    /**
     * Camera (pan/zoom) motion blur, 0-1. Defaults to `0.5`; `0` disables it.
     * Same shutter semantics as `mouse.motionBlur`, applied to the camera
     * viewport so fast pans and zooms smear. Independent of the cursor blur.
     */
    motionBlur?: number
  }
  output?: {
    /**
     * Aspect ratio of the rendered output video.
     *
     * Combined with `quality`, this determines the final pixel dimensions.
     * See {@link AspectRatio} for the full dimension table.
     *
     * Defaults to `'16:9'` when not specified.
     *
     * @example '16:9'
     */
    aspectRatio?: AspectRatio
    /**
     * Resolution quality of the rendered output video.
     *
     * Combined with `aspectRatio`, this determines the final pixel dimensions.
     * See {@link Quality} for available presets.
     *
     * Defaults to `'1080p'` when not specified.
     *
     * @example '1080p'
     */
    quality?: Quality
    background?: { assetPath: string } | { backgroundCss: string }
  }
}

/**
 * Default values applied to every field of {@link RenderOptions} that has a
 * default. Used by {@link EventRecorder} when writing `data.json` so that the
 * file always contains a fully-resolved set of render options.
 */
export const RENDER_OPTIONS_DEFAULTS = {
  recording: {
    size: 1.0,
    roundness: 0,
    shape: 'rounded' as const,
    dropShadow: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))',
  },
  narration: {
    size: 0.3,
    roundness: 0,
    shape: 'rounded' as const,
    corner: 'bottom-right' as const,
    padding: 0.04,
    dropShadow: 1,
  },
  mouse: {
    size: 0.05,
    style: 'white' as 'white' | 'black',
    motionBlur: 0.5,
  },
  zoom: {
    motionBlur: 0.5,
  },
  output: {
    aspectRatio: '16:9' as AspectRatio,
    quality: '1080p' as Quality,
    background: {
      backgroundCss:
        'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    } as { assetPath: string } | { backgroundCss: string },
  },
}

/**
 * {@link RenderOptions} after all defaults have been resolved.
 * Every field that has a default in {@link RENDER_OPTIONS_DEFAULTS} is
 * guaranteed to be present. This is the shape written to `data.json`.
 */
export type ResolvedRenderOptions = {
  recording: {
    size: number
    roundness: number
    shape: 'rounded'
    dropShadow: string
  }
  narration: {
    size: number
    roundness: number
    shape: 'rounded'
    dropShadow: number
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    padding: number
  }
  mouse: {
    size: number
    style: 'white' | 'black'
    motionBlur: number
  }
  zoom: {
    motionBlur: number
  }
  output: {
    aspectRatio: AspectRatio
    quality: Quality
    background: { assetPath: string } | { backgroundCss: string }
  }
}

/**
 * Configuration options for video recording.
 *
 * Example:
 * ```ts
 * const options: RecordOptions = {
 *   aspectRatio: '16:9',
 *   quality: '1080p',
 *   fps: 60,
 * }
 * ```
 */
export type RecordOptions = {
  /**
   * Aspect ratio used when capturing the screen.
   *
   * Together with `quality` this determines the browser viewport and
   * ffmpeg input dimensions.
   * See {@link AspectRatio} for all supported ratios and their pixel sizes.
   *
   * @default '16:9'
   */
  aspectRatio?: AspectRatio

  /**
   * Resolution quality preset used when capturing the screen.
   *
   * Together with `aspectRatio` this determines the browser viewport and
   * ffmpeg input dimensions.
   * See {@link Quality} for the full dimension table.
   *
   * @default '1080p'
   */
  quality?: Quality

  /**
   * Frames per second for video recording.
   *
   * @default 60
   */
  fps?: FPS

  /**
   * Tunes how many output frames screenci skips between cursor and scroll
   * dispatches while recording. Dispatching less often keeps interactions
   * responsive on busy pages / slow CI (each dispatch queues behind the page's
   * own work).
   *
   * Pass an object of frame-skip counts to tune each stream independently
   * (`0` = every frame).
   *
   * By default the cursor skips 5 frames (it is re-drawn at render time, so this
   * is free) and the scroll skips none (it is real footage, so it stays smooth).
   * Intervals are derived from the recording `fps`.
   *
   * @example { mouseFrameSkip: 5, scrollFrameSkip: 0 }
   */
  performance?: PerformanceOption

  /**
   * Encoder used for the realtime screen capture.
   *
   * - `'sharp'`  - tuned for text-heavy UI (low CRF + still-image tune) so
   *   glyph edges stay crisp. Uses a little more CPU; on most machines it
   *   still encodes comfortably above realtime.
   * - `'fast'`   - the lightest possible encode (ultrafast preset). Use this on
   *   resource-constrained CI where `'sharp'` cannot keep up with the capture
   *   stream (falling behind drops frames and shortens the recording).
   *
   * Defaults to `'fast'` as the safe baseline. The `init`-scaffolded config sets
   * `process.env.CI ? 'fast' : 'sharp'` so new projects get crisp text locally.
   *
   * @default 'fast'
   */
  encoder?: VideoEncoderPreset
}

/**
 * Encoder preset for the realtime screen capture. See {@link RecordOptions.encoder}.
 */
export type VideoEncoderPreset = 'sharp' | 'fast'

export type Easing =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'ease-in-strong'
  | 'ease-out-strong'
  | 'ease-in-out-strong'

export type AutoZoomOptions = {
  easing?: Easing
  duration?: number
  /** 0–1: fraction of output dimensions visible in the zoomed viewport (default 0.65) */
  amount?: number
  /** 0–1: extra locator framing applied as a uniform scale multiplier (default 0.2 = 20% larger box). */
  padding?: number
  /** 0–1: visibility bias inside the zoomed viewport; 0 = barely fit, 1 = centered. */
  centering?: number
  /** Delay in milliseconds to hold the zoomed-in state after the zoom-in animation completes. */
  preZoomDelay?: number
  /** Delay in milliseconds to hold the full view after the zoom-out animation completes. */
  postZoomDelay?: number
}

export type MouseMoveTimingOption =
  | {
      duration?: number
      speed?: never
    }
  | {
      duration?: never
      speed?: number
    }

export type CursorMoveTimingOption =
  | {
      moveDuration?: number
      moveSpeed?: never
    }
  | {
      moveDuration?: never
      moveSpeed?: number
    }

export type CursorDragTimingOption =
  | {
      dragDuration?: number
      dragSpeed?: never
    }
  | {
      dragDuration?: never
      dragSpeed?: number
    }

/** Shared cursor-animation options available on all locator actions. */
type CursorMoveOptions = CursorMoveTimingOption & {
  /** Easing function for the cursor move animation (default: 'ease-in-out'). */
  moveEasing?: Easing
  /** Pause between cursor arrival and the action in ms (default: 50). */
  beforeClickPause?: number
  /** Pause after the action completes in ms. */
  postClickPause?: number
}

export type ScreenCILocatorClickOptions = Omit<
  NonNullable<Parameters<Locator['click']>[0]>,
  'steps'
> &
  CursorMoveOptions & {
    autoZoomOptions?: AutoZoomOptions
  }

export type ScreenCILocatorPostClickMoveOptions = CursorMoveTimingOption & {
  direction?: 'up' | 'down' | 'left' | 'right'
  duration?: number
  easing?: Easing
  padding?: number
}

export type ScreenCILocatorFillOptions = ScreenCILocatorClickOptions & {
  /**
   * When `true`, forces the pre-type click animation even if the target input
   * is already focused. By default the click is skipped when already focused.
   */
  forceClick?: boolean
  noWaitAfter?: boolean
  /** Total time in milliseconds to spend typing (default: 1000). */
  duration?: number
  timeout?: number
  position?: { x: number; y: number }
  /** Hide the cursor while typing; shown again on the next mouse move. */
  hideMouse?: boolean
  click?: false | ScreenCILocatorClickOptions
  postClickMove?: ScreenCILocatorPostClickMoveOptions
  autoZoomOptions?: AutoZoomOptions
}

export type ScreenCILocatorPressSequentiallyOptions = Omit<
  NonNullable<Parameters<Locator['pressSequentially']>[1]>,
  'delay'
> &
  CursorMoveOptions & {
    /**
     * When `true`, forces the pre-type click animation even if the target input
     * is already focused. By default the click is skipped when already focused.
     */
    forceClick?: boolean
    noWaitAfter?: boolean
    delay?: number
    position?: { x: number; y: number }
    /** Hide the cursor while typing; shown again on the next mouse move. */
    hideMouse?: boolean
    autoZoomOptions?: AutoZoomOptions
  }

export type ScreenCILocatorCheckOptions = NonNullable<
  Parameters<Locator['check']>[0]
> &
  CursorMoveOptions & {
    noWaitAfter?: boolean
    position?: { x: number; y: number }
    autoZoomOptions?: AutoZoomOptions
  }

export type ScreenCILocatorHoverOptions = Omit<
  NonNullable<Parameters<Locator['hover']>[0]>,
  'steps'
> &
  CursorMoveTimingOption & {
    /** Easing function for the cursor move animation (default: 'ease-in-out'). */
    moveEasing?: Easing
    /** How long to hold the hover in ms (default: 1000). */
    hoverDuration?: number
    position?: { x: number; y: number }
  }

export type ScreenCILocatorSelectTextOptions = Omit<
  NonNullable<Parameters<Locator['selectText']>[0]>,
  'steps'
> &
  CursorMoveTimingOption & {
    /** Easing function for the cursor move animation (default: 'ease-in-out'). */
    moveEasing?: Easing
    beforeClickPause?: number
    /**
     * Total duration of the triple-click animation in ms (default: 600).
     * Divided equally across the 3 click cycles.
     */
    selectDuration?: number
  }

export type ScreenCILocatorDragToOptions = Omit<
  NonNullable<Parameters<Locator['dragTo']>[1]>,
  'steps'
> &
  CursorMoveTimingOption &
  CursorDragTimingOption & {
    moveEasing?: Easing
    preDragPause?: number
    dragEasing?: Easing
    sourcePosition?: { x: number; y: number }
    targetPosition?: { x: number; y: number }
  }

export type ScreenCILocatorSelectOptionOptions = NonNullable<
  Parameters<Locator['selectOption']>[1]
> &
  CursorMoveOptions & {
    noWaitAfter?: boolean
    position?: { x: number; y: number }
    autoZoomOptions?: AutoZoomOptions
  }

type LocatorReturnMethodNames =
  | 'locator'
  | 'getByAltText'
  | 'getByLabel'
  | 'getByPlaceholder'
  | 'getByRole'
  | 'getByTestId'
  | 'getByText'
  | 'getByTitle'
  | 'and'
  | 'describe'
  | 'filter'
  | 'first'
  | 'last'
  | 'nth'
  | 'or'

type ScreenCIMouse = Omit<Mouse, 'move'> & {
  /**
   * Moves the mouse cursor to the given position.
   *
   * @param options.steps - Ignored; use `duration` and `easing` instead.
   * @param options.duration - Duration of the animated move in milliseconds.
   *   When provided and greater than 0, the cursor is animated with easing.
   * @param options.speed - Cursor speed in pixels per second.
   * @param options.easing - Easing function for the cursor animation (default: 'ease-in-out').
   */
  move(
    x: number,
    y: number,
    options?: { steps?: number; easing?: Easing } & MouseMoveTimingOption
  ): Promise<void>
  /**
   * Shows the mouse cursor in the recorded video.
   *
   * The cursor is visible by default. Use this to restore visibility after calling `.hide()`.
   */
  show(): void
  /**
   * Hides the mouse cursor in the recorded video.
   *
   * Revert this by calling `.show()`.
   */
  hide(): void
}

export type ScreenCILocator = Omit<
  Locator,
  | 'click'
  | 'fill'
  | 'check'
  | 'uncheck'
  | 'setChecked'
  | 'tap'
  | 'selectOption'
  | 'selectText'
  | 'dragTo'
  | LocatorReturnMethodNames
  | 'all'
  | 'page'
> & {
  /**
   * Clicks the element with an animated cursor move.
   *
   * ScreenCI defaults `noWaitAfter` to `true` for this action so the rendered
   * click can complete before navigation waits. Pass `noWaitAfter: false` to
   * keep Playwright's default waiting behavior.
   *
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 900).
   * @param options.moveSpeed - Cursor speed in pixels/s (mutually exclusive with `moveDuration`).
   * @param options.moveEasing - Easing function for the cursor move animation (default: 'ease-in-out').
   * @param options.beforeClickPause - Pause between cursor arrival and click in ms (default: 50).
   * @param options.postClickPause - Pause after the click completes in ms.
   */
  click(options?: ScreenCILocatorClickOptions): Promise<void>
  /**
   * Types `value` character-by-character using `pressSequentially`.
   *
   * ScreenCI animates a cursor move and click before typing unless the target
   * input is already focused (in which case the click is skipped). Pass
   * `forceClick: true` to always animate the click.
   *
   * @param value - The text to type into the element.
   * @param options.duration - Total time in milliseconds to spend typing
   *   (default: 1000). The per-keystroke delay is derived from this value
   *   divided by the number of characters. Has no effect on empty strings.
   * @param options.timeout - Maximum time in milliseconds to wait for the
   *   element to be actionable.
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 900).
   * @param options.moveSpeed - Cursor speed in pixels/s (mutually exclusive with `moveDuration`).
   * @param options.moveEasing - Easing function for the cursor move animation (default: 'ease-in-out').
   * @param options.beforeClickPause - Pause between cursor arrival and click in ms (default: 50).
   * @param options.postClickPause - Pause after the click in ms.
   * @param options.forceClick - When `true`, forces the pre-type click even if already focused.
   * @param options.noWaitAfter - When `false`, keeps Playwright's default navigation-wait behavior.
   * @param options.position - Point relative to the element's top-left corner to click before filling.
   * @param options.hideMouse - When `true`, the mouse cursor is hidden while typing.
   */
  fill(value: string, options?: ScreenCILocatorFillOptions): Promise<void>
  /**
   * Presses keys one by one as if on a physical keyboard.
   *
   * ScreenCI animates a cursor move and click before typing unless the target
   * input is already focused (in which case the click is skipped). Pass
   * `forceClick: true` to always animate the click.
   *
   * @param text - The text to type.
   * @param options.delay - Time between keystrokes in milliseconds.
   * @param options.timeout - Maximum time in milliseconds to wait for the
   *   element to be actionable.
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 900).
   * @param options.moveSpeed - Cursor speed in pixels/s (mutually exclusive with `moveDuration`).
   * @param options.moveEasing - Easing function for the cursor move animation (default: 'ease-in-out').
   * @param options.beforeClickPause - Pause between cursor arrival and click in ms (default: 50).
   * @param options.postClickPause - Pause after the click in ms.
   * @param options.forceClick - When `true`, forces the pre-type click even if already focused.
   * @param options.noWaitAfter - When `false`, keeps Playwright's default navigation-wait behavior.
   * @param options.position - Point relative to the element's top-left corner to click before typing.
   * @param options.hideMouse - When `true`, the mouse cursor is hidden while typing.
   */
  pressSequentially(
    text: string,
    options?: ScreenCILocatorPressSequentiallyOptions
  ): Promise<void>
  /**
   * Checks the checkbox or radio button with an animated cursor move.
   *
   * ScreenCI defaults `noWaitAfter` to `true` for the underlying click.
   * Pass `noWaitAfter: false` to keep Playwright's default waiting behavior.
   *
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 900).
   * @param options.moveSpeed - Cursor speed in pixels/s (mutually exclusive with `moveDuration`).
   * @param options.moveEasing - Easing function for the cursor move animation (default: 'ease-in-out').
   * @param options.beforeClickPause - Pause between cursor arrival and click in ms (default: 50).
   * @param options.postClickPause - Pause after the click in ms.
   * @param options.position - Point relative to the element's top-left corner to click.
   */
  check(options?: ScreenCILocatorCheckOptions): Promise<void>
  /**
   * Unchecks the checkbox with an animated cursor move.
   *
   * ScreenCI defaults `noWaitAfter` to `true` for the underlying click.
   * Pass `noWaitAfter: false` to keep Playwright's default waiting behavior.
   *
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 900).
   * @param options.moveSpeed - Cursor speed in pixels/s (mutually exclusive with `moveDuration`).
   * @param options.moveEasing - Easing function for the cursor move animation (default: 'ease-in-out').
   * @param options.beforeClickPause - Pause between cursor arrival and click in ms (default: 50).
   * @param options.postClickPause - Pause after the click in ms.
   * @param options.position - Point relative to the element's top-left corner to click.
   */
  uncheck(options?: ScreenCILocatorCheckOptions): Promise<void>
  /**
   * Sets the checked state of a checkbox or radio element with an animated cursor move.
   * Delegates to `check()` or `uncheck()` based on `checked`.
   * ScreenCI defaults `noWaitAfter` to `true` for the underlying click.
   * Pass `noWaitAfter: false` to keep Playwright's default waiting behavior.
   *
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 900).
   * @param options.moveSpeed - Cursor speed in pixels/s (mutually exclusive with `moveDuration`).
   * @param options.moveEasing - Easing function for the cursor move animation (default: 'ease-in-out').
   * @param options.beforeClickPause - Pause between cursor arrival and click in ms (default: 50).
   * @param options.postClickPause - Pause after the click in ms.
   * @param options.position - Point relative to the element's top-left corner to click.
   */
  setChecked(
    checked: boolean,
    options?: ScreenCILocatorCheckOptions
  ): Promise<void>
  /**
   * Taps the element (touch event) with an animated cursor move.
   *
   * ScreenCI defaults `noWaitAfter` to `true` for this action so the rendered
   * tap is not delayed by later navigation waits. Pass `noWaitAfter: false`
   * to keep Playwright's default waiting behavior.
   *
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 900).
   * @param options.moveSpeed - Cursor speed in pixels/s (mutually exclusive with `moveDuration`).
   * @param options.moveEasing - Easing function for the cursor move animation (default: 'ease-in-out').
   * @param options.beforeClickPause - Pause between cursor arrival and tap in ms (default: 50).
   * @param options.postClickPause - Pause after the tap in ms.
   */
  tap(
    options?: Omit<NonNullable<Parameters<Locator['tap']>[0]>, 'steps'> &
      CursorMoveOptions & {
        noWaitAfter?: boolean
        autoZoomOptions?: AutoZoomOptions
      }
  ): Promise<void>
  /**
   * Hovers over the element with an animated cursor move.
   *
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 900).
   * @param options.moveSpeed - Cursor speed in pixels/s (mutually exclusive with `moveDuration`).
   * @param options.moveEasing - Easing function for the cursor move animation (default: 'ease-in-out').
   * @param options.hoverDuration - How long to hold the hover in ms (default: 1000).
   * @param options.position - Point relative to the element's top-left corner to hover over.
   */
  hover(options?: ScreenCILocatorHoverOptions): Promise<void>
  /**
   * Selects all text content of the element with an animated cursor move and
   * triple-click animation.
   *
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 900).
   * @param options.moveSpeed - Cursor speed in pixels/s (mutually exclusive with `moveDuration`).
   * @param options.moveEasing - Easing function for the cursor move animation (default: 'ease-in-out').
   * @param options.beforeClickPause - Pause between cursor arrival and the triple-click in ms (default: 50).
   * @param options.selectDuration - Total duration of the triple-click animation in ms (default: 600).
   */
  selectText(options?: ScreenCILocatorSelectTextOptions): Promise<void>
  /**
   * Drags the element to the target locator with animated cursor movement.
   *
   * The animation consists of:
   * 1. Cursor moves to the source element (`moveDuration`, `moveEasing`).
   * 2. A brief pause (`preDragPause`) then a mouseDown.
   * 3. Cursor drags from source to target (`dragDuration`, `dragEasing`).
   * 4. A mouseUp at the target.
   *
   * @param target - The locator of the drop target element.
   * @param options.moveDuration - Duration of cursor move to source in ms (default: 900).
   * @param options.moveEasing - Easing for the cursor move (default: 'ease-in-out').
   * @param options.preDragPause - Pause after arriving at source before mouseDown in ms (default: 100).
   * @param options.dragDuration - Duration of the drag animation in ms (default: 1000).
   * @param options.dragEasing - Easing for the drag animation (default: 'ease-in-out').
   * @param options.sourcePosition - Point relative to source element's top-left for the drag start.
   * @param options.targetPosition - Point relative to target element's top-left for the drop.
   */
  dragTo(target: Locator, options?: ScreenCILocatorDragToOptions): Promise<void>
  /**
   * Selects an option in a `<select>` element with an animated cursor move.
   *
   * Note: the native dropdown UI is not rendered. ScreenCI animates the
   * cursor to the select element, clicks it, and then selects the option
   * programmatically, but no dropdown will appear on screen.
   * ScreenCI defaults `noWaitAfter` to `true` for the underlying action.
   * Pass `noWaitAfter: false` to keep Playwright's default waiting behavior.
   *
   * @param values - The option(s) to select (value, label, index, or element).
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 900).
   * @param options.moveSpeed - Cursor speed in pixels/s (mutually exclusive with `moveDuration`).
   * @param options.moveEasing - Easing function for the cursor move animation (default: 'ease-in-out').
   * @param options.beforeClickPause - Pause between cursor arrival and click in ms (default: 50).
   * @param options.postClickPause - Pause after the click in ms.
   * @param options.position - Point relative to the element's top-left corner to click before selecting.
   */
  selectOption(
    values: Parameters<Locator['selectOption']>[0],
    options?: ScreenCILocatorSelectOptionOptions
  ): Promise<string[]>
  page(): ScreenCIPage
  locator(...args: Parameters<Locator['locator']>): ScreenCILocator
  getByAltText(...args: Parameters<Locator['getByAltText']>): ScreenCILocator
  getByLabel(...args: Parameters<Locator['getByLabel']>): ScreenCILocator
  getByPlaceholder(
    ...args: Parameters<Locator['getByPlaceholder']>
  ): ScreenCILocator
  getByRole(...args: Parameters<Locator['getByRole']>): ScreenCILocator
  getByTestId(...args: Parameters<Locator['getByTestId']>): ScreenCILocator
  getByText(...args: Parameters<Locator['getByText']>): ScreenCILocator
  getByTitle(...args: Parameters<Locator['getByTitle']>): ScreenCILocator
  and(...args: Parameters<Locator['and']>): ScreenCILocator
  describe(...args: Parameters<Locator['describe']>): ScreenCILocator
  filter(...args: Parameters<Locator['filter']>): ScreenCILocator
  first(): ScreenCILocator
  last(): ScreenCILocator
  nth(...args: Parameters<Locator['nth']>): ScreenCILocator
  or(...args: Parameters<Locator['or']>): ScreenCILocator
  all(): Promise<ScreenCILocator[]>
}

export type ScreenCIPage = Omit<
  Page,
  'click' | 'mouse' | LocatorReturnMethodNames
> & {
  mouse: ScreenCIMouse
  /**
   * Clicks an element matched by `selector` with an animated cursor move.
   *
   * ScreenCI defaults `noWaitAfter` to `true` for this action so the rendered
   * click can complete before navigation waits. Pass `noWaitAfter: false` to
   * keep Playwright's default waiting behavior.
   *
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 900).
   * @param options.moveSpeed - Cursor speed in pixels/s (mutually exclusive with `moveDuration`).
   * @param options.moveEasing - Easing function for the cursor move animation (default: 'ease-in-out').
   * @param options.beforeClickPause - Pause between cursor arrival and click in ms (default: 50).
   * @param options.postClickPause - Pause after the click in ms.
   */
  click(
    selector: string,
    options?: Parameters<Page['click']>[1] &
      CursorMoveOptions & {
        autoZoomOptions?: AutoZoomOptions
      }
  ): Promise<void>
  locator(...args: Parameters<Page['locator']>): ScreenCILocator
  getByAltText(...args: Parameters<Page['getByAltText']>): ScreenCILocator
  getByLabel(...args: Parameters<Page['getByLabel']>): ScreenCILocator
  getByPlaceholder(
    ...args: Parameters<Page['getByPlaceholder']>
  ): ScreenCILocator
  getByRole(...args: Parameters<Page['getByRole']>): ScreenCILocator
  getByTestId(...args: Parameters<Page['getByTestId']>): ScreenCILocator
  getByText(...args: Parameters<Page['getByText']>): ScreenCILocator
  getByTitle(...args: Parameters<Page['getByTitle']>): ScreenCILocator
}

import type { ElevenLabsVoiceKey, ModelVoiceKey } from './voices.js'

export type CueConfig =
  | {
      voice: ElevenLabsVoiceKey
      speed?: number
      stability?: number
      similarityBoost?: number
      style?: number
      useSpeakerBoost?: boolean
    }
  | {
      voice: ModelVoiceKey
      speed?: never
      stability?: never
      similarityBoost?: never
      style?: never
      useSpeakerBoost?: never
    }

export type ScreenCIConfig = Omit<
  PlaywrightTestConfig,
  'retries' | 'testDir' | 'testMatch' | 'use' | 'projects'
> & {
  /**
   * Name of the project. Used to identify the project in screenci.com.
   */
  projectName: string
  /**
   * Path to a .env file to load before uploading.
   * Relative to the screenci.config.ts file.
   * Use this to load SCREENCI_SECRET and other env vars.
   * @example '.env'
   */
  envFile?: string
  /**
   * Directory that will be searched recursively for `*.video.*` files.
   *
   * Matches files like `example.video.ts`, `demo.video.js`, etc.
   *
   * Defaults to `'./videos'`.
   */
  videoDir?: string
  /**
   * Options that only affect the `screenci record` command.
   */
  record?: {
    /**
     * Controls whether recordings are uploaded after partial Playwright failures.
     *
     * @default 'passed-only'
     */
    upload?: RecordUploadPolicy
  }
  /**
   * Options that only affect the `screenci test` command.
   */
  test?: {
    /**
     * Keeps recording-style timings enabled during `screenci test`.
     * Equivalent to passing `--mock-record` on the CLI.
     *
     * @default false
     */
    mockRecord?: boolean
  }
  /**
   * Starts and reuses a development server through Playwright before running videos.
   *
   * This is useful for generated ScreenCI projects that should record against the
   * app in the parent project directory.
   */
  webServer?: PlaywrightTestConfig['webServer']
  use?: Omit<NonNullable<PlaywrightTestConfig['use']>, 'trace'> & {
    recordOptions?: RecordOptions
    /** Render options, or `STUDIO_RENDER_OPTIONS` to configure them in Studio (Business tier). */
    renderOptions?: RenderOptions | StudioRenderOptionsSentinel
    /**
     * Timeout in milliseconds for individual actions like `click()`, `fill()`, etc.
     *
     * Separate from the overall test timeout. Defaults to 30 seconds so actions
     * don't inherit the long test timeout.
     *
     * @default 30000
     */
    actionTimeout?: number
    /**
     * Timeout in milliseconds for page navigations like `goto()`, `waitForNavigation()`, etc.
     *
     * Separate from the overall test timeout. Defaults to 30 seconds.
     *
     * @default 30000
     */
    navigationTimeout?: number
    /**
     * When to record traces during test execution.
     * Uses Playwright's native `trace` option type.
     *
     * @default 'retain-on-failure'
     */
    trace?: NonNullable<NonNullable<PlaywrightTestConfig['use']>['trace']>
  }
  projects?: (Omit<Project, 'use'> & {
    use?: Omit<NonNullable<Project['use']>, 'trace'> & {
      recordOptions?: RecordOptions
      /** Render options, or `STUDIO_RENDER_OPTIONS` to configure them in Studio (Business tier). */
      renderOptions?: RenderOptions | StudioRenderOptionsSentinel
      /**
       * When to record traces during test execution.
       * Uses Playwright's native `trace` option type.
       *
       * @default 'retain-on-failure'
       */
      trace?: NonNullable<NonNullable<PlaywrightTestConfig['use']>['trace']>
    }
  })[]
}

export type ExtendedScreenCIConfig = Omit<ScreenCIConfig, 'record' | 'test'> &
  Pick<PlaywrightTestConfig, 'retries' | 'testDir' | 'testMatch'> & {
    record: {
      upload: RecordUploadPolicy
    }
    test: {
      mockRecord: boolean
    }
  }
