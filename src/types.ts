import type {
  PlaywrightTestConfig,
  Project,
  Page,
  Locator,
  Mouse,
  Keyboard,
} from '@playwright/test'
import type { PerformanceOption } from './performance.js'
import type { ClipRegion, ClipTarget, ScreenshotClipRecord } from './clip.js'
import type { AnyTopLevelVoiceConfig } from './voiceConfig.js'
import type {
  NarrationAudioCleanupOption,
  ResolvedNarrationAudioCleanup,
} from './narrationAudioCleanup.js'

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
/**
 * Output image format for a screenshot. `'png'` is lossless (the default).
 * `'jpeg'` produces smaller files; `quality` (1-100, default 90) is the JPEG
 * compression quality. This is distinct from {@link Quality}, which is the
 * resolution preset. Videos ignore this.
 */
export type ScreenshotOutputFormat = 'png' | { type: 'jpeg'; quality?: number }

/**
 * Screenshot-only render options that can be set in config or edited in Studio.
 *
 * Resolution comes from the captured clip scaled by the capture device pixel
 * density (not a preset). There is no `frame` toggle: the configured background
 * (and the frame shadow and rounded corners) appear only when there is canvas
 * area around the shot for them to fill, which is created by `margin` and/or an
 * explicit `aspectRatio`. With neither, the output is the bare clip.
 *
 * The clip itself is never set here: it is recorded only from a `crop()` call or
 * `page.screenshot({ clip })` (see {@link ResolvedScreenshotRenderOptions}).
 */
export type ScreenshotRenderOptions = {
  /** Output image format. Defaults to `'png'`. */
  format?: ScreenshotOutputFormat
  /**
   * Margin between the framed shot and the canvas edge, in CSS pixels. A value
   * greater than 0 creates a background gutter around the shot (and gives the
   * frame shadow and rounded corners room to render). Defaults to `0` (the
   * canvas hugs the shot, no background visible).
   */
  margin?: number
  /**
   * Output canvas aspect ratio. `'auto'` (the default) hugs the (cropped) shot
   * plus any `margin`, with no letterbox bars. An explicit ratio centers the
   * framed shot in that canvas and fills the surround with the background.
   */
  aspectRatio?: AspectRatio | 'auto'
  /** Cursor options for the still (the cursor is hidden by default). */
  mouse?: ScreenshotMouseOptions
}

/**
 * Cursor options for a screenshot. The cursor is drawn at its final recorded
 * position using the same assets and colour as the video cursor: its colour
 * comes from `renderOptions.mouse.style` and its size from
 * `renderOptions.mouse.size`. Only `show` is screenshot-specific.
 */
export type ScreenshotMouseOptions = {
  /**
   * Draw the cursor on the still at its final recorded position. Defaults to
   * `false` (no cursor), so polished product stills stay clean. Has no effect
   * when the body never moved the cursor (there is no position to draw).
   */
  show?: boolean
}

/**
 * {@link ScreenshotRenderOptions} as serialized for a recorded still. Adds the
 * `clip`, which is never set in config: it is seeded only by a `clip()` call or
 * `page.screenshot({ clip })`. In Studio, a locator clip's box is locked while
 * its padding stays editable, and a region clip is a fully editable rectangle
 * (see {@link ScreenshotClipRecord}).
 */
export type ResolvedScreenshotRenderOptions = ScreenshotRenderOptions & {
  /** Clip applied by the renderer (CSS pixels of the recording viewport). */
  clip?: ScreenshotClipRecord
}

export type RenderOptions = {
  recording?: {
    /** 0-1 fraction of the output frame: 0 causes warning, 1=one side touches background edge. */
    size?: number
    /** 0-1 fraction: 0=sharp corners, 1=shorter side is half circle. */
    roundness?: number
    /** Shadow strength from 0 (none) to 1 (default shadow). */
    dropShadow?: number
    /**
     * Crop of the recorded video, in CSS pixels of the recording viewport
     * (top-left origin), following Playwright's `clip` shape. The recording is
     * always captured at the full configured resolution; the clip is applied at
     * render time, so it can be changed and re-rendered without re-recording.
     * Only the clipped region appears in the output, and the recording tile
     * takes the clip's aspect ratio.
     */
    clip?: ClipRegion
  }
  narration?: {
    /** 0-1 fraction of the output frame: 1=mask size equals shorter side of output. */
    size?: number
    /**
     * Narration size when the recording is smaller than the full frame.
     * When set, the narration bubble scales down and tightens into its corner
     * with the recording size. Omit to keep a fixed size.
     * 0-1: same units as `size`.
     */
    sizeZoomed?: number
    /** 0-1 fraction: 0=square, 1=circle. */
    roundness?: number
    /**
     * Narration shadow strength (0-1).
     * - 0 disables shadow
     * - 1 maps to maximum shadow
     */
    dropShadow?: number
    corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    /** 0-1 fraction of the output frame: 0=nothing, 1=length of shorter side of the frame. */
    padding?: number
    /**
     * Global default narration voice, used as the config-level default in the
     * voice cascade. The per-language and per-cue voice live in the `localize`
     * spec (`voice` and per-cue `{ cue, voice }`); this is only the fallback when
     * neither is set.
     */
    voice?: AnyTopLevelVoiceConfig
    /**
     * Cleanup for narration audio you recorded yourself (media-file cues):
     * background noise reduction and loudness normalization. Off by default.
     *
     * - `true` enables the full chain with defaults
     * - object form enables only the listed sub-features:
     *   `{ denoise: true | { strength: 0..1 }, normalize: true | { level: LUFS } }`
     *
     * Does not affect generated narration, background audio tracks, or
     * captured screen audio.
     */
    audio?: NarrationAudioCleanupOption
  }
  mouse?: {
    /** 0-1: 0=missing, 1=height of video */
    size?: number
    /** Cursor colour. Defaults to `'white'`. Ignored when `image` is set. */
    style?: 'white' | 'black'
    /**
     * Path to a custom cursor image, relative to the config directory. When set,
     * it replaces the built-in `style` cursor in both video and screenshot
     * output. The image is uploaded alongside the recording like any other
     * asset.
     *
     * PNG is recommended (the video pipeline may lack an SVG decoder). The
     * image's top-left corner is the pointer hotspot, matching the built-in
     * cursors, and it is scaled by `size` (aspect ratio preserved).
     */
    image?: string
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
  /** Keyboard shortcut overlays recorded from `page.keyboard.press`. */
  shortcuts?: {
    /**
     * Show modifier-combo shortcuts (e.g. `Shift+A`) as keycap overlays.
     * Defaults to `true`.
     */
    show?: boolean
    /**
     * Show single-key presses (e.g. `'A'`) as keycap overlays. Defaults to
     * `false`.
     */
    showSingle?: boolean
    /** Keycap appearance. Defaults to `'dark'`. */
    theme?: 'light' | 'dark'
    /**
     * Per-shortcut visibility overrides from the web editor timeline, keyed by
     * the recorded event id. Wins over the per-call `show` option and the
     * global toggles.
     */
    overrides?: Record<string, { show: boolean }>
  }
  output?: {
    /**
     * Aspect ratio of the rendered video output.
     *
     * Combined with `quality`, this determines the final pixel dimensions.
     * See {@link AspectRatio} for the full dimension table. Screenshots use
     * {@link ScreenshotRenderOptions.aspectRatio} instead (which also allows
     * `'auto'`).
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
     * See {@link Quality} for available presets. Screenshots ignore this: their
     * resolution comes from the captured clip (or the full output frame) scaled
     * by the capture device pixel density.
     *
     * Defaults to `'1080p'` when not specified.
     *
     * @example '1080p'
     */
    quality?: Quality
    background?:
      | { assetPath: string; fileHash?: string }
      | { backgroundCss: string }
  }
  /** Screenshot-only render options (format, margin, aspectRatio). */
  screenshot?: ScreenshotRenderOptions
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
    dropShadow: 1,
  },
  narration: {
    size: 0.3,
    roundness: 0.2,
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
  shortcuts: {
    show: true,
    showSingle: false,
    theme: 'dark' as 'light' | 'dark',
  },
  output: {
    aspectRatio: '16:9' as AspectRatio,
    quality: '1080p' as Quality,
    background: {
      backgroundCss: 'linear-gradient(135deg, #6366f1 0%, #ec4899 100%)',
    } as { assetPath: string; fileHash?: string } | { backgroundCss: string },
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
    dropShadow: number
    /** Render-time crop of the recording (CSS px of the recording viewport). */
    clip?: ClipRegion
  }
  narration: {
    size: number
    sizeZoomed?: number
    roundness: number
    dropShadow: number
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    padding: number
    /**
     * Resolved audio cleanup for self-recorded narration cues. Present only
     * when the user opted in via {@link RenderOptions.narration}.
     */
    audio?: ResolvedNarrationAudioCleanup
  }
  mouse: {
    size: number
    style: 'white' | 'black'
    /**
     * Custom cursor image. On disk (pre-upload) this is the raw config path; the
     * CLI rewrites it to `{ assetPath, fileHash }` after upload so the renderer
     * can resolve it by content hash. Absent when no custom cursor is set.
     */
    image?: string | { assetPath: string; fileHash: string }
    motionBlur: number
  }
  zoom: {
    motionBlur: number
  }
  shortcuts: {
    show: boolean
    showSingle: boolean
    theme: 'light' | 'dark'
    overrides?: Record<string, { show: boolean }>
  }
  output: {
    aspectRatio: AspectRatio
    quality: Quality
    background:
      | { assetPath: string; fileHash?: string }
      | { backgroundCss: string }
  }
  /**
   * Screenshot-only render options. Present only when at least one field was set
   * (in config) or a clip was recorded. Renderers read screenshot framing
   * (format, margin, aspectRatio, clip) exclusively from here.
   */
  screenshot?: ResolvedScreenshotRenderOptions
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

  /**
   * Device scale factor (DPR) used when capturing.
   *
   * Screenshots multiply the viewport by this for a higher-DPI still: `2`
   * doubles the pixel density. This is the easy way to ask for a sharper
   * screenshot. It does not apply to video recording (the screencast stays at
   * the viewport resolution).
   *
   * @default 2 for screenshots, ignored for video
   */
  deviceScaleFactor?: number

  /**
   * Capture system audio alongside the screen recording and mix it into the
   * output video.
   *
   * Set to `true` to capture at unity gain, or pass `{ gain }` for a custom
   * linear gain:
   * - `true`: capture at unity gain (natural level).
   * - `{ gain: 0.5 }`: capture at half volume.
   * - `{ gain: 2 }`: boost to twice the natural level.
   *
   * Audio is captured via ffmpeg from the platform default audio input and
   * mixed into the rendered video. While capture is enabled the browser plays
   * the page audio out loud on the host so the recorder can tap it. Each OS
   * requires a one-time loopback source setup to capture system audio rather
   * than the microphone. See the per-OS guide:
   * https://screenci.com/docs/guides/screen-audio
   *
   * @default false
   */
  captureAudio?: boolean | { gain: number }

  /**
   * CSS selectors whose matching elements are masked from the very first frame,
   * before any page script runs. Use this for elements that are always secret
   * (API keys, account numbers) so there is no window where they could be
   * captured in the clear.
   *
   * The mask is applied client side in the live DOM, so the obscured pixels
   * never enter `recording.mp4` and are never uploaded. For masking that starts
   * at a specific moment, use the `redact()` helper instead.
   *
   * @example ['.api-key', '[data-sensitive]']
   */
  redact?: string[]

  /**
   * Vertical framing bias (0–1) used when a plain interaction (a `click()`,
   * `fill()`, `scrollIntoViewIfNeeded()`, etc. that is not zooming) scrolls its
   * target into view.
   *
   * `0` reveals the target just inside the top edge, `1` places it dead center,
   * and the default `0.2` frames it gently toward the upper third so
   * already-visible elements are not yanked to the center on every click.
   *
   * This only affects plain scroll reveals. Zooming (`zoomTo`/`autoZoom`) keeps
   * its tight centering, and an explicit per-call `centering` (via
   * `autoZoomOptions` or `scrollIntoViewIfNeeded({ centering })`) always wins.
   *
   * @default 0.2
   */
  scrollCentering?: number

  /**
   * Neutralize CSS animations and transitions while the page is driven, so
   * every interaction lands on its element's end state instead of waiting for an
   * animation to settle.
   *
   * When unset this defaults to `true` for screenshots and `false` for video. A
   * still has no timeline, so animating the UI only slows the interactions that
   * drive the page into position (each Playwright action waits for its target to
   * stop moving). Video is left animated because motion is usually the point.
   *
   * Override it to opt back in or out: set `false` on a screenshot that needs a
   * mid-animation state, or `true` on a video to strip animations.
   *
   * @default true for screenshots, false for video
   */
  disableAnimations?: boolean

  /**
   * Project-wide default cursor path shape. Every automatic move (the approach
   * before a `click()`, `fill()`, etc.) and every `page.mouse` move adopts this
   * unless the call passes its own `move.curve`. See {@link CursorCurve}.
   *
   * @default 'none'
   * @example 'natural'
   */
  cursorCurve?: CursorCurve

  /**
   * Project-wide default bow amount for the `'natural'`/`'arc'` cursor-curve
   * presets, as a fraction of the segment length. Overridden per call by
   * `move.curviness`. See {@link CursorMoveOptions.curviness}.
   *
   * @example 0.18
   */
  cursorCurviness?: number
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

/** Every valid {@link Easing} name, for runtime validation. */
export const EASING_NAMES: readonly Easing[] = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'ease-in-strong',
  'ease-out-strong',
  'ease-in-out-strong',
]

/** Anchor corner for the narration (camera PIP) overlay. */
export type NarrationCorner =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

/**
 * Narration overlay position: one of the four corners, centered in the
 * output, or filling the whole frame (uncropped source aspect).
 */
export type NarrationPosition = NarrationCorner | 'center' | 'full-screen'

/**
 * How full-screen narration fits the output frame: 'contain' letterboxes
 * with black bars, 'cover' fills the frame with slight cropping.
 */
export type NarrationFullScreenFit = 'contain' | 'cover'

export type AutoZoomOptions = {
  /**
   * Stable identity slug for the web editor (e.g. `autoZoom2`). Stamped
   * automatically by `screenci sync`; not a zoom setting and never marks the
   * block as code-locked.
   */
  editId?: string
  easing?: Easing
  /** Duration in milliseconds for zoom-in transitions. */
  duration?: number
  /** Duration in milliseconds for zoom-out transitions. Defaults to `duration` if not set. */
  zoomOutDuration?: number
  /** 0–1: fraction of output dimensions visible in the zoomed viewport (default 0.72) */
  amount?: number
  /** 0–1: extra locator framing applied as a uniform scale multiplier (default 0.2 = 20% larger box). */
  padding?: number
  /** 0–1: visibility bias inside the zoomed viewport; 0 = barely fit, 1 = centered. */
  centering?: number
  /** Delay in milliseconds before the internally triggered zoom-out. */
  delay?: number
  /** Delay in milliseconds to hold the full view after the zoom-out animation completes. */
  delayAfter?: number
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
      duration?: number
      speed?: never
    }
  | {
      duration?: never
      speed?: number
    }

/**
 * The two middle handles of a cubic bezier cursor path, in a normalized,
 * CSS-`cubic-bezier` analog frame: the straight line from the move's start to
 * its end is the x-axis, so `x1`/`x2` are the fraction (0..1) *along* that line
 * and `y1`/`y2` are the perpendicular deflection in the **same unit** (a
 * fraction of the segment length). Positive `y` bends to the left of travel
 * (upward for a left-to-right move); negative flips it. The frame is isotropic
 * and resolution-independent.
 *
 * @example [0.33, 0.4, 0.66, -0.2] // an S-curve
 * @example [0.33, 0, 0.66, 0]      // a straight line
 */
export type CurveTuple = [number, number, number, number]

/**
 * How a cursor move curves on its way to the target.
 *
 * - `'none'`: straight line (the historical behavior).
 * - `'natural'`: a gentle, human-looking arc. Its bow direction alternates
 *   deterministically so consecutive moves vary yet always re-render identically.
 * - `'arc'`: a stronger, deliberate single bow.
 * - {@link CurveTuple}: an explicit normalized cubic bezier.
 */
export type CursorCurve = 'none' | 'natural' | 'arc' | CurveTuple

export type CursorMoveOptions = CursorMoveTimingOption & {
  /** Easing function for the cursor move animation (default: 'ease-in-out'). */
  easing?: Easing
  /**
   * Shape of the cursor path to the target (default: `'none'`, a straight line;
   * or the project-wide `recordOptions.cursorCurve` when set). See
   * {@link CursorCurve}.
   */
  curve?: CursorCurve
  /**
   * Bow amount for the `'natural'`/`'arc'` presets, as a fraction of the segment
   * length. A signed value fixes the bend direction (positive = left of travel /
   * upward for a left-to-right move); when omitted the preset picks a sensible
   * default and, for `'natural'`, a deterministic alternating direction. Ignored
   * when `curve` is an explicit {@link CurveTuple}.
   */
  curviness?: number
  /** Delay after cursor arrival before the primary action starts, in ms. */
  delayAfter?: number
}

/**
 * Records a cursor press/move for the video without dispatching a real browser
 * event. Shared by the `page.mouse` press methods.
 */
export type FakeMouseOption = {
  /**
   * When `true`, screenci records the cursor gesture for the video but does not
   * dispatch a real browser mouse event, so the page is never actually touched.
   * The recorded data is identical to a non-fake call, so the rendered video
   * looks the same.
   */
  fake?: boolean
}

/** Press (down/up) animation timing for the `page.mouse` press methods. */
export type ScreenCIMousePressTiming = {
  /** Duration of the press squish animation in ms (default: 100). */
  duration?: number
  /** Easing function for the press animation (default: 'ease-in-out'). */
  easing?: Easing
}

export type ScreenCIMouseDownUpOptions = Pick<
  NonNullable<Parameters<Mouse['down']>[0]>,
  'button' | 'clickCount'
> &
  ScreenCIMousePressTiming &
  FakeMouseOption

export type ScreenCIMouseClickOptions = NonNullable<
  Parameters<Mouse['click']>[2]
> & { move?: CursorMoveOptions } & ScreenCIMousePressTiming &
  FakeMouseOption

/** Shared cursor-animation options available on all locator actions. */
type CursorActionMoveOptions = {
  move?: CursorMoveOptions
  /**
   * Stable identity slug for the web editor (e.g. `click1`). Stamped
   * automatically by `screenci sync`; identity only, never affects the
   * action's behavior.
   */
  editId?: string
}

export type ScreenCILocatorClickOptions = Omit<
  NonNullable<Parameters<Locator['click']>[0]>,
  'steps'
> &
  CursorActionMoveOptions & {
    autoZoomOptions?: AutoZoomOptions
  }

export type ScreenCILocatorPostClickMoveOptions = MouseMoveTimingOption & {
  direction?: 'up' | 'down' | 'left' | 'right'
  duration?: number
  easing?: Easing
  padding?: number
}

/**
 * How a redacted region is drawn over the page. The mask is an opaque panel
 * applied client side in the live DOM, so the obscured pixels never enter the
 * recording and are never uploaded, and it cannot leak under any renderer.
 *
 * By default the panel is filled with a color sampled from the surface beneath
 * it, so it blends in as a clean block. Set `color` for a fixed fill, or `css`
 * to fully style the panel.
 */
export type RedactStyle = {
  /**
   * Opaque fill color, e.g. '#fff3d6'. Omit to sample a color from the
   * surface underneath the element.
   */
  color?: string
  /** Corner radius of the mask in px (default 12). */
  radius?: number
  /** CSS box-shadow for the mask, or `false` to disable it. */
  shadow?: string | false
  /**
   * Extra CSS applied to the mask panel for full custom styling, e.g.
   * `'background: repeating-linear-gradient(45deg,#222 0 6px,#333 6px 12px)'`.
   * Applied last, so it overrides the defaults. Keep the panel opaque, or the
   * content underneath may show through.
   */
  css?: string
}

/** Options for {@link redact} and the per-action `redact` switch. */
export type RedactOptions = {
  style?: RedactStyle
}

/** Handle returned by a persistent {@link redact} call. */
export type RedactHandle = {
  /** Remove this mask, revealing the element again. */
  unredact(): Promise<void>
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
  /**
   * Mask the typed value in the recording so the secret never enters
   * `recording.mp4`. The mask is applied before the first character is typed,
   * so the value is never captured in the clear. Pass `true` for the default
   * mask, or `RedactOptions` to customize it.
   */
  redact?: boolean | RedactOptions
  click?: false | ScreenCILocatorClickOptions
  postClickMove?: ScreenCILocatorPostClickMoveOptions
  autoZoomOptions?: AutoZoomOptions
}

export type ScreenCILocatorPressSequentiallyOptions = Omit<
  NonNullable<Parameters<Locator['pressSequentially']>[1]>,
  'delay'
> &
  CursorActionMoveOptions & {
    /**
     * When `true`, forces the pre-type click animation even if the target input
     * is already focused. By default the click is skipped when already focused.
     */
    forceClick?: boolean
    noWaitAfter?: boolean
    delay?: number
    /**
     * Total typing time in milliseconds. Editable in the web app. Unlike `fill`,
     * the default scales with the text length (about 60ms per character), so
     * longer text types for longer. The per-keystroke `delay` is derived from
     * this divided by the character count; an explicit `delay` (with no
     * `duration`) is instead read as the per-character cadence.
     */
    duration?: number
    position?: { x: number; y: number }
    /** Hide the cursor while typing; shown again on the next mouse move. */
    hideMouse?: boolean
    /**
     * Mask the typed value in the recording so the secret never enters
     * `recording.mp4`. Applied before the first character is typed. Pass `true`
     * for the default mask, or `RedactOptions` to customize it.
     */
    redact?: boolean | RedactOptions
    autoZoomOptions?: AutoZoomOptions
  }

export type ScreenCILocatorCheckOptions = NonNullable<
  Parameters<Locator['check']>[0]
> &
  CursorActionMoveOptions & {
    noWaitAfter?: boolean
    position?: { x: number; y: number }
    autoZoomOptions?: AutoZoomOptions
  }

export type ScreenCILocatorHoverOptions = Omit<
  NonNullable<Parameters<Locator['hover']>[0]>,
  'steps'
> &
  CursorActionMoveOptions & {
    /** How long to hold the hover in ms (default: 1000). */
    duration?: number
    position?: { x: number; y: number }
  }

export type ScreenCILocatorSelectTextOptions = Omit<
  NonNullable<Parameters<Locator['selectText']>[0]>,
  'steps'
> &
  CursorActionMoveOptions & {
    /**
     * Total duration of the triple-click animation in ms (default: 600).
     * Divided equally across the 3 click cycles.
     */
    duration?: number
  }

export type ScreenCILocatorDragToOptions = Omit<
  NonNullable<Parameters<Locator['dragTo']>[1]>,
  'steps'
> &
  CursorActionMoveOptions &
  MouseMoveTimingOption & {
    easing?: Easing
    /**
     * Minimum number of intermediate cursor dispatches spread across the drag,
     * so the browser sees a dense enough stream of moves to track the gesture
     * (a slider thumb, drag-and-drop hit testing). Defaults to
     * `DEFAULT_DRAG_STEPS`. Increase it for a longer or more sensitive drag.
     */
    dragSteps?: number
    sourcePosition?: { x: number; y: number }
    targetPosition?: { x: number; y: number }
  }

export type ScreenCILocatorSelectOptionOptions = NonNullable<
  Parameters<Locator['selectOption']>[1]
> &
  CursorActionMoveOptions & {
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

type ScreenCIMouse = Omit<
  Mouse,
  'move' | 'down' | 'up' | 'click' | 'dblclick'
> & {
  /**
   * Moves the mouse cursor to the given position.
   *
   * @param options.steps - Ignored; use `duration` and `easing` instead.
   * @param options.duration - Duration of the animated move in milliseconds.
   *   When provided and greater than 0, the cursor is animated with easing.
   * @param options.speed - Cursor speed in pixels per second.
   * @param options.easing - Easing function for the cursor animation (default: 'ease-in-out').
   * @param options.curve - Cursor path shape (default: `'none'`, or the project
   *   `recordOptions.cursorCurve`). See {@link CursorCurve}.
   * @param options.curviness - Bow amount for the `'natural'`/`'arc'` presets.
   */
  move(
    x: number,
    y: number,
    options?: {
      steps?: number
      easing?: Easing
      curve?: CursorCurve
      curviness?: number
    } & MouseMoveTimingOption
  ): Promise<void>
  /**
   * Presses the mouse button down at the current cursor position, animating the
   * cursor into its pressed state in the recorded video.
   *
   * With `fake: true`, the press is only recorded for the video: no real browser
   * mouse event is dispatched. Pair with `up()` to release.
   *
   * @param options.duration - Duration of the press animation in ms (default: 100).
   * @param options.easing - Easing function for the press animation (default: 'ease-in-out').
   * @param options.fake - Record the press without dispatching a real event.
   */
  down(options?: ScreenCIMouseDownUpOptions): Promise<void>
  /**
   * Releases the mouse button at the current cursor position, animating the
   * cursor back to its resting state in the recorded video.
   *
   * With `fake: true`, the release is only recorded for the video: no real
   * browser mouse event is dispatched.
   *
   * @param options.duration - Duration of the release animation in ms (default: 100).
   * @param options.easing - Easing function for the release animation (default: 'ease-in-out').
   * @param options.fake - Record the release without dispatching a real event.
   */
  up(options?: ScreenCIMouseDownUpOptions): Promise<void>
  /**
   * Moves the cursor to `(x, y)` and performs an animated click there.
   *
   * With `fake: true`, the click is only recorded for the video: the cursor
   * animates and presses, but no real browser mouse event is dispatched, so the
   * page is not actually clicked.
   *
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 900).
   * @param options.moveSpeed - Cursor speed in pixels/s (mutually exclusive with `moveDuration`).
   * @param options.moveEasing - Easing function for the cursor move animation (default: 'ease-in-out').
   * @param options.duration - Duration of the press animation in ms (default: 100).
   * @param options.easing - Easing function for the press animation (default: 'ease-in-out').
   * @param options.fake - Record the click without dispatching a real event.
   */
  click(
    x: number,
    y: number,
    options?: ScreenCIMouseClickOptions
  ): Promise<void>
  /**
   * Moves the cursor to `(x, y)` and performs an animated double click there
   * (two press animations).
   *
   * With `fake: true`, the double click is only recorded for the video: no real
   * browser mouse event is dispatched.
   *
   * @param options.moveDuration - Duration of the cursor move animation in ms (default: 900).
   * @param options.moveSpeed - Cursor speed in pixels/s (mutually exclusive with `moveDuration`).
   * @param options.moveEasing - Easing function for the cursor move animation (default: 'ease-in-out').
   * @param options.duration - Duration of each press animation in ms (default: 100).
   * @param options.easing - Easing function for the press animations (default: 'ease-in-out').
   * @param options.fake - Record the double click without dispatching a real event.
   */
  dblclick(
    x: number,
    y: number,
    options?: ScreenCIMouseClickOptions
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

/** Options for {@link ScreenCIKeyboard.press}. */
export type ScreenCIKeyboardPressOptions = NonNullable<
  Parameters<Keyboard['press']>[1]
> & {
  /**
   * Visibility override for the keyboard shortcut overlay in the rendered
   * video. `true` shows the keycaps even when the shortcut kind is disabled
   * globally (e.g. a single key with `shortcuts.showSingle` off); `false`
   * always hides them. Omit to follow `renderOptions.shortcuts`.
   */
  show?: boolean
}

export type ScreenCIKeyboard = Omit<Keyboard, 'press'> & {
  /**
   * Presses a key or key combo (e.g. `'A'`, `'Shift+A'`, `'ControlOrMeta+K'`).
   *
   * The press is recorded as an animated keycap overlay shown at the bottom of
   * the rendered video, subject to `renderOptions.shortcuts` and the `show`
   * option.
   */
  press(key: string, options?: ScreenCIKeyboardPressOptions): Promise<void>
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
  | 'press'
  | LocatorReturnMethodNames
  | 'all'
  | 'page'
> & {
  /**
   * Presses a key or key combo (e.g. `'Enter'`, `'Shift+A'`) on the element.
   *
   * The press is recorded as an animated keycap overlay shown at the bottom of
   * the rendered video, subject to `renderOptions.shortcuts` and the `show`
   * option.
   */
  press(
    key: string,
    options?: Parameters<Locator['press']>[1] & { show?: boolean }
  ): Promise<void>
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
   * @param options.duration - Total time in milliseconds to spend typing.
   *   Unlike `fill`, the default scales with the text length (about 60ms per
   *   character), so longer text types for longer. The per-keystroke delay is
   *   derived from this value divided by the number of characters.
   * @param options.delay - Time between keystrokes in milliseconds. Read as the
   *   per-character cadence when `duration` is not given (total = delay times
   *   the character count).
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
      CursorActionMoveOptions & {
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
   * @param options.dragSteps - Minimum intermediate cursor dispatches spread across the drag, so the browser tracks the gesture (default: 24). Raise it for a longer or more sensitive drag.
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

/**
 * Options for {@link ScreenCIPage.screenshot}: Playwright's native screenshot
 * options plus the screenci-specific `name`/`crop`. Inside a `video()`, calling
 * `page.screenshot()` also writes a branded still as a separate screenshot
 * recording; these keys are stripped before delegating to Playwright.
 */
export type ScreenCIScreenshotOptions = Omit<
  NonNullable<Parameters<Page['screenshot']>[0]>,
  'clip'
> & {
  /** Names the still recording: "<video title> - <name>". */
  name?: string
  /** Crop the still to a locator or a pixel region (CSS px of the viewport). */
  clip?: ClipTarget
}

export type ScreenCIPage = Omit<
  Page,
  | 'click'
  | 'mouse'
  | 'keyboard'
  | 'screenshot'
  | 'waitForTimeout'
  | LocatorReturnMethodNames
> & {
  mouse: ScreenCIMouse
  keyboard: ScreenCIKeyboard
  /**
   * Waits in the recording timeline. Plain `screenci test` collapses this to
   * 0ms so authoring runs stay fast; `screenci record` and
   * `screenci test --mock-record` keep the requested duration.
   *
   * Use Playwright locator/action waits for application readiness instead of
   * relying on this as a real polling delay.
   */
  waitForTimeout(timeout?: number): Promise<void>
  /**
   * Captures a screenshot. Inside a `video()` recording this also writes a
   * branded still as a separate screenshot recording named "<video title> -
   * <name>", then returns the captured bytes as usual.
   */
  screenshot(
    options?: ScreenCIScreenshotOptions
  ): ReturnType<Page['screenshot']>
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
      CursorActionMoveOptions & {
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
   * Directory that will be searched recursively for `*.screenci.*` files.
   *
   * Matches files like `example.screenci.ts`, `demo.screenci.js`, etc.
   *
   * Defaults to `'./recordings'`.
   */
  recordingDir?: string
  /**
   * Enables system audio capture for the whole run. When `true`, the recording
   * browser is launched in audio mode (unmuted, new headless) so that videos
   * setting `recordOptions.captureAudio` actually capture sound.
   *
   * This is a launch-time switch, decided once per worker before any individual
   * video's options are known, so it must live here at config root rather than
   * in a video's `video.use()`. A video that sets `captureAudio` while this is
   * `false` throws at record time with a link to the setup docs.
   *
   * @default false
   */
  enableCaptureAudio?: boolean
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
