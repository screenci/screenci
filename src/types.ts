import type {
  PlaywrightTestConfig,
  Project,
  Page,
  Locator,
  Mouse,
} from '@playwright/test'

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
 * Trace recording mode for test execution.
 *
 * Traces capture detailed information about test execution including screenshots,
 * DOM snapshots, and network activity.
 *
 * Available options (subset of Playwright's trace options):
 * - `'on'` - Record traces for all tests
 * - `'off'` - Do not record traces
 * - `'retain-on-failure'` - Record traces only for failed tests (default)
 *
 * @default 'retain-on-failure'
 */
export type Trace = 'on' | 'off' | 'retain-on-failure'

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
  cursor?: {
    /** 0-1: 0=missing, 1=height of video */
    size?: number
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
  cursor: {
    size: 0.05,
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
  cursor: {
    size: number
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
   * Together with `quality` this determines the xvfb display size,
   * browser viewport, and ffmpeg input dimensions.
   * See {@link AspectRatio} for all supported ratios and their pixel sizes.
   *
   * @default '16:9'
   */
  aspectRatio?: AspectRatio

  /**
   * Resolution quality preset used when capturing the screen.
   *
   * Together with `aspectRatio` this determines the xvfb display size,
   * browser viewport, and ffmpeg input dimensions.
   * See {@link Quality} for the full dimension table.
   *
   * @default '1080p'
   */
  quality?: Quality

  /**
   * Frames per second for video recording.
   *
   * @default 30
   */
  fps?: FPS
}

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
  /** 0–1: fraction of output dimensions visible in the zoomed viewport (default 0.5) */
  amount?: number
  /** 0–1: visibility bias inside the zoomed viewport; 0 = barely fit, 1 = centered. */
  centering?: number
  /** When false, the camera never zooms out beyond the initial amount to fit
   *  large element rects. Defaults to true. */
  allowZoomingOut?: boolean
  /** Delay in milliseconds to hold the zoomed-in state after the zoom-in
   *  animation completes, and to hold the full view after the zoom-out
   *  animation completes. Defaults to 500. */
  postZoomInOutDelay?: number
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

export type RequiredMouseMoveTimingOption =
  | {
      duration: number
      speed?: never
    }
  | {
      duration?: never
      speed: number
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

/**
 * Options for an automatic click that precedes a `fill`, `pressSequentially`,
 * `check`, `uncheck`, `setChecked`, or `selectOption`.
 *
 * When passed as `click` to these methods, the locator is clicked first (with
 * animated cursor movement), then the action begins immediately. No extra
 * zoom-pan sleep is inserted — the cursor-move animation covers it.
 *
 * To control where on the element the cursor moves, pass `position` at the
 * top level of the method's options (not inside `click`).
 */
export type ClickBeforeFillOption = CursorMoveTimingOption & {
  beforeClickPause?: number
  moveEasing?: Easing
  postClickPause?: number
  postClickMove?: PostClickMove
}

/**
 * Camera pan to perform after a click completes.
 *
 * Direction-based: the camera shifts by the element's bounding-box size
 * (in output pixels) plus optional `padding` (output pixels, applied to each
 * side) in the given direction.
 *
 * Pixel-based: the camera shifts by explicit `x` / `y` output-pixel offsets
 * (negative values pan in the opposite direction).
 */
export type PostClickMove =
  | (RequiredMouseMoveTimingOption & {
      easing?: Easing
      /** Output pixels added to each side of the element rect before computing the shift. */
      padding?: number
      direction: 'up' | 'down' | 'left' | 'right'
    })
  | (RequiredMouseMoveTimingOption & {
      easing?: Easing
      /** Horizontal camera shift in output pixels (negative = left). */
      x: number
      /** Vertical camera shift in output pixels (negative = up). */
      y: number
    })

export type ScreenCILocatorClickOptions = Omit<
  NonNullable<Parameters<Locator['click']>[0]>,
  'steps'
> &
  CursorMoveTimingOption & {
    beforeClickPause?: number
    moveEasing?: Easing
    postClickPause?: number
    postClickMove?: PostClickMove
    autoZoomOptions?: AutoZoomOptions
  }

export type ScreenCILocatorFillOptions = {
  duration?: number
  timeout?: number
  click?: ClickBeforeFillOption
  position?: { x: number; y: number }
  hideMouse?: boolean
  autoZoomOptions?: AutoZoomOptions
}

export type ScreenCILocatorPressSequentiallyOptions = Omit<
  NonNullable<Parameters<Locator['pressSequentially']>[1]>,
  'delay'
> & {
  delay?: number
  click?: ClickBeforeFillOption
  position?: { x: number; y: number }
  hideMouse?: boolean
  autoZoomOptions?: AutoZoomOptions
}

export type ScreenCILocatorCheckOptions = NonNullable<
  Parameters<Locator['check']>[0]
> & {
  position?: { x: number; y: number }
  click?: ClickBeforeFillOption
  autoZoomOptions?: AutoZoomOptions
}

export type ScreenCILocatorHoverOptions = Omit<
  NonNullable<Parameters<Locator['hover']>[0]>,
  'steps'
> &
  CursorMoveTimingOption & {
    easing?: Easing
    hoverDuration?: number
    position?: { x: number; y: number }
  }

export type ScreenCILocatorSelectTextOptions = Omit<
  NonNullable<Parameters<Locator['selectText']>[0]>,
  'steps'
> &
  CursorMoveTimingOption & {
    easing?: Easing
    beforeClickPause?: number
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
> & {
  click?: ClickBeforeFillOption
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
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 1000).
   * @param options.beforeClickPause - Pause between cursor arrival and click in ms.
   * @param options.moveEasing - Easing function for the cursor move animation.
   * @param options.postClickPause - Pause after the click completes in ms.
   * @param options.postClickMove - When provided, animates the cursor away from
   *   the element after the click (e.g. to simulate the cursor moving off a button).
   */
  click(options?: ScreenCILocatorClickOptions): Promise<void>
  /**
   * Types `value` character-by-character using `pressSequentially`.
   *
   * @param value - The text to type into the element.
   * @param options.duration - Total time in milliseconds to spend typing
   *   (default: 1000). The per-keystroke delay is derived from this value
   *   divided by the number of characters. Has no effect on empty strings.
   * @param options.timeout - Maximum time in milliseconds to wait for the
   *   element to be actionable.
   * @param options.click - When provided, clicks the element before typing
   *   (animated cursor move + click). No extra zoom-pan sleep is inserted.
   * @param options.position - Point relative to the element's top-left corner
   *   to click before filling. Only used when `click` is also provided.
   *   Defaults to the element center.
   * @param options.hideMouse - When `true`, the mouse cursor is hidden while
   *   typing and shown again on the next mouse move. Defaults to `false`.
   */
  fill(value: string, options?: ScreenCILocatorFillOptions): Promise<void>
  /**
   * Presses keys one by one as if on a physical keyboard.
   *
   * @param text - The text to type.
   * @param options.delay - Time between keystrokes in milliseconds.
   * @param options.timeout - Maximum time in milliseconds to wait for the
   *   element to be actionable.
   * @param options.click - When provided, clicks the element before typing
   *   (animated cursor move + click). No extra zoom-pan sleep is inserted.
   * @param options.position - Point relative to the element's top-left corner
   *   to click before typing. Only used when `click` is also provided.
   *   Defaults to the element center.
   * @param options.hideMouse - When `true`, the mouse cursor is hidden while
   *   typing and shown again on the next mouse move. Defaults to `false`.
   */
  pressSequentially(
    text: string,
    options?: ScreenCILocatorPressSequentiallyOptions
  ): Promise<void>
  /**
   * Checks the checkbox or radio button.
   *
   * @param options.position - Point relative to the element's top-left corner
   *   to click. Defaults to the element center.
   * @param options.click - When provided, animates the cursor to the element
   *   before checking it. The click timing data is embedded in the recorded event.
   */
  check(options?: ScreenCILocatorCheckOptions): Promise<void>
  /**
   * Unchecks the checkbox.
   *
   * @param options.position - Point relative to the element's top-left corner
   *   to click. Defaults to the element center.
   * @param options.click - When provided, animates the cursor to the element
   *   before unchecking it. The click timing data is embedded in the recorded event.
   */
  uncheck(options?: ScreenCILocatorCheckOptions): Promise<void>
  /**
   * Sets the checked state of a checkbox or radio element.
   * Delegates to the instrumented `check()` or `uncheck()` based on `checked`.
   *
   * @param options.position - Point relative to the element's top-left corner
   *   to click. Defaults to the element center.
   * @param options.click - When provided, animates the cursor to the element
   *   before acting. The click timing data is embedded in the recorded event.
   */
  setChecked(
    checked: boolean,
    options?: ScreenCILocatorCheckOptions
  ): Promise<void>
  /**
   * Taps the element (touch event).
   *
   * @param options.click - When provided, animates the cursor to the element
   *   before tapping it. The click timing data is embedded in the recorded event.
   */
  tap(
    options?: Parameters<Locator['tap']>[0] & {
      click?: ClickBeforeFillOption
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<void>
  /**
   * Hovers over the element with an animated cursor move.
   *
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 1000).
   * @param options.easing - Easing function for the cursor move animation.
   * @param options.hoverDuration - How long to hold the hover in ms (default: 1000).
   * @param options.position - Point relative to the element's top-left corner to hover over.
   *   Defaults to the element center.
   */
  hover(options?: ScreenCILocatorHoverOptions): Promise<void>
  /**
   * Selects all text content of the element with an animated cursor move and
   * triple-click animation.
   *
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 1000).
   * @param options.easing - Easing function for the cursor move animation.
   * @param options.beforeClickPause - Pause between cursor arrival and the triple-click in ms.
   * @param options.selectDuration - Total duration of the triple-click animation in ms (default: 600).
   *   Divided into 6 equal segments: 3 mouseDown + 3 mouseUp phases.
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
   * @param options.moveDuration - Duration of cursor move to source in ms (default: 1000).
   * @param options.moveEasing - Easing for the cursor move (default: 'ease-in-out').
   * @param options.preDragPause - Pause after arriving at source before mouseDown in ms (default: 100).
   * @param options.dragDuration - Duration of the drag animation in ms (default: 1000).
   * @param options.dragEasing - Easing for the drag animation (default: 'ease-in-out').
   * @param options.sourcePosition - Point relative to source element's top-left for the drag start.
   * @param options.targetPosition - Point relative to target element's top-left for the drop.
   */
  dragTo(target: Locator, options?: ScreenCILocatorDragToOptions): Promise<void>
  /**
   * Selects an option in a `<select>` element.
   *
   * Note: the native dropdown UI is not rendered — the option is selected
   * programmatically. If `options.click` is provided, the cursor is animated
   * to the select element before the selection is applied, but no dropdown
   * will appear on screen.
   *
   * @param values - The option(s) to select (value, label, index, or element).
   * @param options.click - When provided, animates the cursor to the select
   *   element. The click timing data is embedded in the recorded event.
   * @param options.position - Point relative to the element's top-left corner
   *   to click before selecting. Only used when `click` is also provided.
   *   Defaults to the element center.
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
  click(
    selector: string,
    options?: Parameters<Page['click']>[1] &
      CursorMoveTimingOption & {
        beforeClickPause?: number
        moveEasing?: Easing
        postClickMove?: PostClickMove
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

import type { VoiceKey } from './voices.js'

export type CueConfig = {
  voice: VoiceKey
  speed?: number
  stability?: number
  style?: number
}

export type ScreenCIConfig = Omit<
  PlaywrightTestConfig,
  | 'fullyParallel'
  | 'workers'
  | 'retries'
  | 'testDir'
  | 'testMatch'
  | 'use'
  | 'projects'
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
  use?: Omit<PlaywrightTestConfig['use'], 'trace'> & {
    recordOptions?: RecordOptions
    renderOptions?: RenderOptions
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
     *
     * @default 'retain-on-failure'
     */
    trace?: Trace
    /**
     * Whether to send recorded traces to screenci.com for viewing and analysis.
     *
     * When `true`, traces are uploaded and can be viewed on screenci.com.
     * When `false`, traces are kept locally only.
     *
     * @default true
     */
    sendTraces?: boolean
  }
  projects?: (Omit<Project, 'use'> & {
    use?: Omit<Project['use'], 'trace'> & {
      recordOptions?: RecordOptions
      renderOptions?: RenderOptions
      /**
       * When to record traces during test execution.
       *
       * @default 'retain-on-failure'
       */
      trace?: Trace
      /**
       * Whether to send recorded traces to screenci.com for viewing and analysis.
       *
       * When `true`, traces are uploaded and can be viewed on screenci.com.
       * When `false`, traces are kept locally only.
       *
       * @default true
       */
      sendTraces?: boolean
    }
  })[]
}

export type ExtendedScreenCIConfig = ScreenCIConfig &
  Pick<
    PlaywrightTestConfig,
    'fullyParallel' | 'workers' | 'retries' | 'testDir' | 'testMatch'
  >
