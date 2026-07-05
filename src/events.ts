import { existsSync, readFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { invalidOptionError, ScreenciError } from './errors.js'
import type {
  AutoZoomOptions,
  CueConfig,
  Easing,
  RecordOptions,
  RenderOptions,
  ResolvedRenderOptions,
} from './types.js'
import { RENDER_OPTIONS_DEFAULTS } from './types.js'
import type { ScreenshotCropRecord } from './crop.js'
import type { StudioOptionFlags } from './studio.js'
import type { VoiceKey } from './voices.js'
import { DEFAULT_ZOOM_OPTIONS } from './defaults.js'
import { getGitMetadata } from './git.js'
import {
  resolvePerformanceIntervals,
  type PerformanceIntervals,
} from './performance.js'

function assertAutoZoomUnitIntervalOption(
  value: number,
  name: 'amount' | 'centering'
): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidOptionError({
      api: 'autoZoom',
      option: name,
      expectation: 'must be between 0 and 1',
      value,
    })
  }
}

export type VideoStartEvent = {
  type: 'videoStart'
  timeMs: 0
}

export type ElementRect = {
  x: number
  y: number
  width: number
  height: number
}

// ─── Inner event types (nested inside InputEvent.events) ──────────────────────

export type FocusChangeEvent = {
  type: 'focusChange'
  startMs: number
  endMs: number
  x: number
  y: number
  mouse?: {
    startMs: number
    endMs: number
    easing?: Easing
  }
  scroll?: {
    startMs: number
    endMs: number
    easing?: Easing
  }
  zoom?: {
    startMs: number
    endMs: number
    easing?: Easing
    end: {
      pointPx: { x: number; y: number }
      size: { widthPx: number; heightPx: number }
    }
    optimalOffset?: {
      x: number
      y: number
    }
  }
  elementRect?: ElementRect
}

export type MouseMoveEvent = {
  type: 'mouseMove'
  startMs: number
  endMs: number
  x: number
  y: number
  easing?: Easing
  zoomFollow?: boolean
  /** Bounding rect of the element the cursor moved to — used for zoom centering hints. */
  elementRect?: ElementRect
}

export type MouseDownEvent = {
  type: 'mouseDown'
  startMs: number
  endMs: number
  mouseSize?: number
  easing?: Easing
}

export type MouseUpEvent = {
  type: 'mouseUp'
  startMs: number
  endMs: number
  easing?: Easing
}

export type MouseShowEvent = {
  type: 'mouseShow'
  startMs: number
  endMs: number
}

export type MouseHideEvent = {
  type: 'mouseHide'
  startMs: number
  endMs: number
}

export type MouseWaitEvent = {
  type: 'mouseWait'
  startMs: number
  endMs: number
}

// ─── Outer InputEvent ─────────────────────────────────────────────────────────

/**
 * A recorded user input action containing one or more inner mouse events.
 * focusChange/mouseMove, mouseShow, and mouseHide subtypes each contain exactly one inner event.
 * All input events must not overlap in time; recording will throw if they do.
 * Cues are automatically prevented from falling inside any input event's time range.
 */
export type InputEvent = {
  type: 'input'
  subType:
    | 'click'
    | 'pressSequentially'
    | 'tap'
    | 'check'
    | 'uncheck'
    | 'select'
    | 'focusChange'
    | 'mouseMove'
    | 'mouseShow'
    | 'mouseHide'
    | 'mouseDown'
    | 'mouseUp'
    | 'hover'
    | 'selectText'
    | 'dragTo'
  events: Array<
    | FocusChangeEvent
    | MouseMoveEvent
    | MouseDownEvent
    | MouseUpEvent
    | MouseShowEvent
    | MouseHideEvent
    | MouseWaitEvent
  >
}

export type RecordingCustomVoiceRef = {
  /**
   * Absent when the sample was missing locally at record time; recovered from a
   * previous upload (matched by assetPath) before submission. See stripVoicePath.
   */
  assetHash?: string
  /** Present only in recording phase (for CLI upload); stripped from submitted data. */
  assetPath?: string
}

export type CueTranslation = {
  text: string
  voice: VoiceKey | RecordingCustomVoiceRef
  /** TTS model type: `'expressive'` or `'consistent'`. Defaults to `'consistent'`. Choosing `'expressive'` for a language that also has a consistent voice requires the Business tier; a language whose only built-in voice is the expressive model uses it automatically on every plan. */
  modelType?: string
  /** Gemini style prompt, or ElevenLabs `eleven_multilingual_v2` style exaggeration. */
  style?: string | number
  /** Accent description for expressive synthesis. Omitted from the prompt when not set. */
  accent?: string
  /** Pacing description for expressive synthesis, or speaking rate for consistent synthesis. */
  pacing?: string | number
  /** ElevenLabs `eleven_multilingual_v2` stability, from 0 to 1. */
  stability?: number
  /** ElevenLabs `eleven_multilingual_v2` similarity boost, from 0 to 1. */
  similarityBoost?: number
  /** ElevenLabs `eleven_multilingual_v2` speed, from 0.7 to 1.2. */
  speed?: number
  /** Whether ElevenLabs speaker boost is enabled. */
  useSpeakerBoost?: boolean
  /**
   * Integer seed included in the audio cache key. A different seed always forces
   * regeneration. Consistent output is not guaranteed across all voice types.
   */
  seed?: number
  /**
   * Synthesis language/locale for this cue, when it differs from the version
   * language (a per-cue `language` override). Omitted means the cue is spoken in
   * the version language. It is part of the audio cache key.
   */
  language?: string
}

/**
 * Absolute-position anchor passed to a recorder method when a cue or overlay was
 * called with a string position (e.g. `narration.intro('0:05')`,
 * `overlays.tip('56%')`). Exactly one of the two forms is provided: a concrete
 * output position in milliseconds, or a fraction of the final video resolved at
 * render time. See the `untilOutputMs`/`untilPercent` fields on the cue and asset
 * start events.
 */
export type TimelineAnchorInput = { outputMs: number } | { percent: number }

/**
 * Spreads a {@link TimelineAnchorInput} into the flat `untilOutputMs`/
 * `untilPercent` fields stored on cue and asset start events. Returns an empty
 * object when no anchor was given, so spreading it never adds undefined keys.
 */
export function timelineAnchorFields(
  until: TimelineAnchorInput | undefined
): { untilOutputMs?: number } | { untilPercent?: number } {
  if (until === undefined) return {}
  return 'outputMs' in until
    ? { untilOutputMs: until.outputMs }
    : { untilPercent: until.percent }
}

/**
 * A crop rectangle in the SOURCE file's own pixels (top-left origin), applied to
 * a file overlay (image/video), a narration video, or an embedded render
 * dependency before it is placed/scaled. Mirrors Playwright's
 * `page.screenshot({ clip })` shape.
 */
export type OverlayCrop = {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A source-trim point: a late start / early end into a source media file. Exactly
 * one form is provided: a concrete offset in milliseconds (from a `'2s'`/timecode
 * string), or a fraction of the SOURCE duration (`0.5` for `'50%'`) resolved
 * against the probed source length at render time.
 */
export type SourceTrimPoint = { ms: number } | { percent: number }

export type CueStartEvent = {
  type: 'cueStart'
  timeMs: number
  name: string
  /** Cue declared via the Studio-managed (name-only) narration form — text and voice come from Studio. */
  studio?: true
  /**
   * Absolute output position (ms) the cue window should reach (from a string
   * position like `'0:05'`). The renderer holds following content until this
   * point, but never cuts the cue audio (it always plays to completion).
   */
  untilOutputMs?: number
  /**
   * Fraction of the final video the cue window should reach (from a `'56%'`
   * position), resolved against the rendered total. Mutually exclusive with
   * {@link untilOutputMs}.
   */
  untilPercent?: number
  /** Single-language API (backward compat) */
  text?: string
  cueConfig?: CueConfig
  /** Multi-language API — all language translations keyed by language code */
  translations?: Record<string, CueTranslation>
  /**
   * Linear gain applied to this cue's narration audio at mix time (`1` is the
   * natural level, `0` mutes it, values above `1` boost it). It is a render-time
   * mix property, not a generation setting: it is deliberately kept out of the
   * translations so it never changes the audio cache key. Omitted plays at unity.
   */
  volume?: number
}

export type CueEndEvent = {
  type: 'cueEnd'
  timeMs: number
  reason?: 'auto' | 'wait'
}

/**
 * Declares the localized `values` fields used by a recording so the backend (and
 * Studio) learn which fields exist and their code-declared seeds. Value fields
 * render on screen, so unlike narration they cannot be patched at render time:
 * the recorder emits this once at start so Studio can later supply per-language
 * overrides that the CLI injects before a re-record.
 */
export type ValuesDeclareEvent = {
  type: 'valuesDeclare'
  timeMs: number
  /** Every field name (seeded then Studio-managed), in declared order. */
  fields: string[]
  /** Studio-managed field names (name-only form, no code seed). */
  studioFields: string[]
  /**
   * Code-declared seeds keyed by language then field: `{ [lang]: { [field]: value } }`.
   * Mirrors how cue translations embed the language. During a per-language pass
   * only the active language is present. Omitted when there is no seed.
   */
  seed?: Record<string, Record<string, string>>
}

/** File-based video cue translation. assetPath is present only in the local
 *  recording phase (for CLI upload) and is stripped before submitting to the backend. */
/**
 * A file-based video cue translation. During recording it carries the local
 * `assetPath` (with `assetHash` present only when the file was found locally);
 * the path is stripped before submission, leaving just `assetHash`. The
 * recovered-from-a-previous-upload case is the recording-phase shape with no
 * `assetHash` yet (filled in from a previous upload before submission).
 */
/**
 * Source crop/trim shared by a file-based narration video cue translation. `crop`
 * reframes the source before the square tile crop; `sourceStart`/`sourceEnd` trim
 * the played slice of the source.
 */
type VideoCueTranslationMedia = {
  subtitle?: string
  crop?: OverlayCrop
  sourceStart?: SourceTrimPoint
  sourceEnd?: SourceTrimPoint
}
export type VideoCueTranslationFile =
  | ({ assetPath: string; assetHash?: string } & VideoCueTranslationMedia)
  | ({ assetHash: string; assetPath?: string } & VideoCueTranslationMedia)
/** TTS-based video cue translation — generates audio via text-to-speech. */
export type VideoCueTranslationTTS = {
  text: string
  voice: VoiceKey | RecordingCustomVoiceRef
  /** TTS model type: `'expressive'` or `'consistent'`. Defaults to `'consistent'`. Choosing `'expressive'` for a language that also has a consistent voice requires the Business tier; a language whose only built-in voice is the expressive model uses it automatically on every plan. */
  modelType?: string
  /** Gemini style prompt, or ElevenLabs `eleven_multilingual_v2` style exaggeration. */
  style?: string | number
  /** Accent description for expressive synthesis. Omitted from the prompt when not set. */
  accent?: string
  /** Pacing description for expressive synthesis, or speaking rate for consistent synthesis. */
  pacing?: string | number
  stability?: number
  similarityBoost?: number
  speed?: number
  useSpeakerBoost?: boolean
  /**
   * Integer seed included in the audio cache key. A different seed always forces
   * regeneration. Consistent output is not guaranteed across all voice types.
   */
  seed?: number
  /**
   * Synthesis language/locale for this cue, when it differs from the version
   * language (a per-cue `language` override). Part of the audio cache key.
   */
  language?: string
}
export type VideoCueTranslation =
  | VideoCueTranslationFile
  | VideoCueTranslationTTS

export type VideoCueStartEvent = {
  type: 'videoCueStart'
  timeMs: number
  name: string
  /** Cue declared via the Studio-managed (name-only) narration form whose Studio entry is a media file. */
  studio?: true
  /** Single-language API: SHA-256 hash of the pre-recorded asset. */
  assetHash?: string
  /** Single-language API: local file path — present only during recording; stripped from submitted data. */
  assetPath?: string
  /** Optional subtitle text. Words are spread with equal timing at render time. */
  subtitle?: string
  /** Multi-language API — per-language translations keyed by language code. */
  translations?: Record<string, VideoCueTranslation>
  /**
   * Linear gain applied to this cue's narration audio at mix time (`1` is the
   * natural level). A render-time mix property kept out of the translations so it
   * never affects the audio cache key. Omitted plays at unity. See
   * {@link CueStartEvent.volume}.
   */
  volume?: number
  /** See {@link CueStartEvent.untilOutputMs}. */
  untilOutputMs?: number
  /** See {@link CueStartEvent.untilPercent}. */
  untilPercent?: number
}

/**
 * Placement of a visual asset overlay. Coordinates are CSS pixels in the
 * recording viewport (the same space Playwright's `boundingBox()`, `page.mouse`,
 * and `viewportSize()` use), with the asset anchored at its top-left corner. The
 * renderer maps these recording-viewport pixels into the final output frame, so
 * the output size never has to be known when the recording is authored.
 *
 * - `fullScreen` fills the entire output frame.
 * - The positioned variants place the asset against the full output frame
 *   (`relativeTo: 'screen'`) or the composited recording area
 *   (`relativeTo: 'recording'`, the default). Provide exactly one of `width` or
 *   `height`; the other dimension is derived from the asset's intrinsic aspect
 *   ratio, or from `aspectRatio` (width / height) when given.
 */
export type OverlayPlacement =
  | { fullScreen: true }
  | {
      relativeTo: 'screen' | 'recording'
      x: number
      y: number
      width: number
      aspectRatio?: number
    }
  | {
      relativeTo: 'screen' | 'recording'
      x: number
      y: number
      height: number
      aspectRatio?: number
    }

/**
 * Asset format policy is recorded explicitly so renderers never need to infer
 * timing or audio rules from file extensions after the recording phase.
 *
 * `durationMs` is present for blocking overlays (the asset holds a frozen frame
 * for that long). It is omitted when the overlay is driven by `start()`/`end()`,
 * in which case a paired `assetEnd` event defines the visible window.
 */
export type ImageAssetStartEvent = {
  type: 'assetStart'
  timeMs: number
  name: string
  kind: 'image'
  path: string
  fileHash?: string
  durationMs?: number
  fullScreen: boolean
  /** Keep the overlay fixed in screen space during zoom (composited after zoom). */
  pinToScreen?: boolean
  /** Draw the overlay above the mouse cursor, so the cursor passes underneath it. */
  overMouse?: boolean
  placement?: OverlayPlacement
  /** Crop rect in the source image's own pixels, applied before placement/scale. */
  crop?: OverlayCrop
  /**
   * Absolute output position (ms) the overlay should remain visible until (from a
   * string position like `'0:10'`). Resolved into a frozen-frame hold at render
   * time. Mutually exclusive with {@link untilPercent} and {@link durationMs}.
   */
  untilOutputMs?: number
  /**
   * Fraction of the final video the overlay should remain visible until (from a
   * `'56%'` position), resolved against the rendered total at render time.
   */
  untilPercent?: number
}

export type VideoAssetStartEvent = {
  type: 'assetStart'
  timeMs: number
  name: string
  kind: 'video'
  path: string
  fileHash?: string
  audio: number
  fullScreen: boolean
  /** Keep the overlay fixed in screen space during zoom (composited after zoom). */
  pinToScreen?: boolean
  /** Draw the overlay above the mouse cursor, so the cursor passes underneath it. */
  overMouse?: boolean
  placement?: OverlayPlacement
  /** Crop rect in the source video's own pixels, applied before placement/scale. */
  crop?: OverlayCrop
  /** Late start into the source video (a `'2s'`/timecode offset or `'50%'` fraction of source). */
  sourceStart?: SourceTrimPoint
  /** Early end into the source video (a `'2s'`/timecode offset or `'50%'` fraction of source). */
  sourceEnd?: SourceTrimPoint
  /**
   * Playback-rate multiplier for the overlay video (and its audio). `2` plays
   * it twice as fast, `0.5` at half speed. Omitted plays at the natural rate.
   * For a blocking overlay this also shortens/lengthens the frozen window it
   * holds (so later content shifts); a live overlay keeps its window and just
   * plays the source faster/slower inside it.
   */
  speed?: number
  /**
   * Target playback duration (ms) for the overlay video, an alternative to
   * {@link speed}: the effective rate is the source duration divided by this.
   * Takes precedence over `speed` when both are set.
   */
  time?: number
  /** See {@link ImageAssetStartEvent.untilOutputMs}. */
  untilOutputMs?: number
  /** See {@link ImageAssetStartEvent.untilPercent}. */
  untilPercent?: number
}

/**
 * An animated HTML/React overlay captured to a single alpha-preserving video.
 * It behaves like an {@link ImageAssetStartEvent} on the timeline (a blocking
 * call holds a frozen frame for `durationMs`; `start()`/`end()` drives a live
 * window), but the renderer composites it as a video so the animation plays.
 * It never carries audio.
 */
export type AnimationAssetStartEvent = {
  type: 'assetStart'
  timeMs: number
  name: string
  kind: 'animation'
  path: string
  fileHash?: string
  /**
   * Capture length of the animation. Present for both blocking and live
   * (`start()`/`end()`) overlays: a live animated overlay plays out to this
   * length, so the renderer needs it even though a paired assetEnd also bounds
   * the window. (Optional only for forward/backward compatibility with older
   * recordings, which omitted it for live overlays.)
   */
  durationMs?: number
  fullScreen: boolean
  /** Keep the overlay fixed in screen space during zoom (composited after zoom). */
  pinToScreen?: boolean
  /** Draw the overlay above the mouse cursor, so the cursor passes underneath it. */
  overMouse?: boolean
  placement?: OverlayPlacement
  /** See {@link ImageAssetStartEvent.untilOutputMs}. */
  untilOutputMs?: number
  /** See {@link ImageAssetStartEvent.untilPercent}. */
  untilPercent?: number
}

/**
 * Reference to another render (a video or screenshot) embedded as an overlay.
 * The target is named by its project-unique `name` (declared via `selected(name)`
 * in the SDK). The medium and concrete output are resolved by the backend at
 * dispatch time, so the recording never restates them.
 */
export type OverlayDependencyRef = {
  /** Project-unique name of the target video/screenshot to embed. */
  name: string
  /**
   * Pin the embed to a specific language of the target, independent of the
   * surrounding render's language. When set, the backend resolves the target's
   * output strictly for this language and fails the dependent render if the
   * target has no finished render in it (listing the languages it does have),
   * rather than inheriting the dependent's language or falling back to a single
   * available language. Omitted (the default) inherits the surrounding render's
   * language. Only present when a language was pinned.
   */
  language?: string
  /**
   * When `true`, the embedded target's narration subtitles are also served as
   * subtitles of the surrounding video (via its VTT track) for the window the
   * embed plays, but only where the surrounding video has no competing narration
   * of its own. Omitted (the default) embeds the target's audio without carrying
   * its subtitles up. Resolved by the backend, which owns the VTT track; the
   * renderer never sees this field. Only present when enabled.
   */
  inheritSubtitles?: true
}

/**
 * An overlay that embeds another render's output (a "render dependency",
 * declared with `selected(name)`). At record time no local file exists, so this
 * event carries an {@link OverlayDependencyRef} instead of a `path`/`fileHash`.
 * The backend resolves the target's selected (or latest FINISHED) output for the
 * matching language at dispatch time and replaces this with a concrete
 * hash-based {@link ImageAssetStartEvent}/{@link VideoAssetStartEvent}, so the
 * renderer never sees this variant.
 *
 * It behaves like an {@link ImageAssetStartEvent} on the timeline (a blocking
 * call holds a frozen frame for `durationMs`; `start()`/`end()` drives a live
 * window). `durationMs` is omitted when driven by `start()`/`end()`. When the
 * target resolves to a VIDEO, a live window plays the clip out to its natural
 * end (the renderer probes the resolved output's length), so the embedded video
 * is never cut short by an early end().
 */
export type DependencyAssetStartEvent = {
  type: 'assetStart'
  timeMs: number
  name: string
  kind: 'dependency'
  dependency: OverlayDependencyRef
  durationMs?: number
  fullScreen: boolean
  /** Keep the overlay fixed in screen space during zoom (composited after zoom). */
  pinToScreen?: boolean
  /** Draw the overlay above the mouse cursor, so the cursor passes underneath it. */
  overMouse?: boolean
  placement?: OverlayPlacement
  /**
   * Crop rect in the resolved output's own pixels, applied (for both a video and
   * a screenshot dependency) before placement/scale.
   */
  crop?: OverlayCrop
  /**
   * Late start into the embedded VIDEO (rejected by the backend for a screenshot
   * dependency, which has no timeline).
   */
  sourceStart?: SourceTrimPoint
  /** Early end into the embedded VIDEO (video dependencies only). */
  sourceEnd?: SourceTrimPoint
  /** See {@link ImageAssetStartEvent.untilOutputMs}. */
  untilOutputMs?: number
  /** See {@link ImageAssetStartEvent.untilPercent}. */
  untilPercent?: number
}

/**
 * End marker for an asset overlay driven by `start()`/`end()`. The asset is
 * visible from its `assetStart` until this event (a live overlay over the
 * recording, no frozen frame). For an overlay with an intrinsic length (a video
 * or animated clip) whose media outlasts this window, the renderer plays the
 * remainder out over a frozen-frame tail, so end() lets the clip finish rather
 * than cutting it. `reason` mirrors cue ends: `'wait'` for an explicit `end()`,
 * `'auto'` when this one was auto-ended.
 *
 * `name` identifies which overlay this end belongs to. Because overlays may
 * overlap (several live at once, interleaved rather than nested), ends are
 * paired to their starts by name rather than by position. Older recordings
 * predate this field, so it is optional; the renderer falls back to closing
 * the most recently opened overlay when it is absent.
 */
export type AssetEndEvent = {
  type: 'assetEnd'
  timeMs: number
  name?: string
  reason?: 'auto' | 'wait'
}

export type AssetStartEvent =
  | ImageAssetStartEvent
  | VideoAssetStartEvent
  | AnimationAssetStartEvent
  | DependencyAssetStartEvent

/**
 * The resolved markup and render parameters captured during the test for a
 * rendered (HTML/React) or animated overlay whose rasterization is deferred to
 * after the test body succeeds. `css` is already merged with the global default
 * (frozen at call time). These fields fully determine the rasterized bytes, so
 * they double as the in-run de-duplication key (see `overlayInputHash`).
 */
export type DeferredRasterizeRequest =
  | {
      kind: 'image'
      name: string
      html: string
      css: string
      /** Author JS injected as a `<script>` at the end of `<body>` (empty when unused). */
      script: string
      /** Wait for the overlay root to receive content before capture (client-rendered overlays). */
      awaitMount?: boolean
      capturePadding: number
      deviceScaleFactor: number
    }
  | {
      kind: 'animation'
      name: string
      html: string
      css: string
      /** Author JS injected as a `<script>`; advanced by the virtual clock while sampling frames (empty when unused). */
      script: string
      /** Wait for the overlay root to receive content before the first frame (client-rendered overlays). */
      awaitMount?: boolean
      capturePadding: number
      deviceScaleFactor: number
      fps: number
      durationMs: number
    }

/**
 * A recorded `assetStart` whose `path`/`fileHash` are not yet known because its
 * overlay is rasterized after the test. The `event` reference is the same object
 * pushed into the recorder's event list, so patching it in place updates what
 * `writeToFile` serializes.
 */
export type PendingOverlay = {
  event: ImageAssetStartEvent | AnimationAssetStartEvent
  request: DeferredRasterizeRequest
}

/** Payload for {@link IEventRecorder.addPendingAssetStart}. */
export type PendingAssetStart = {
  kind: 'image' | 'animation'
  durationMs?: number
  fullScreen: boolean
  /** Keep the overlay fixed in screen space during zoom (composited after zoom). */
  pinToScreen?: boolean
  /** Draw the overlay above the mouse cursor, so the cursor passes underneath it. */
  overMouse?: boolean
  placement?: OverlayPlacement
  /** See {@link ImageAssetStartEvent.untilOutputMs}. */
  untilOutputMs?: number
  /** See {@link ImageAssetStartEvent.untilPercent}. */
  untilPercent?: number
  request: DeferredRasterizeRequest
}
export type AssetStartPayload =
  | Omit<ImageAssetStartEvent, 'type' | 'timeMs' | 'name'>
  | Omit<VideoAssetStartEvent, 'type' | 'timeMs' | 'name'>
  | Omit<AnimationAssetStartEvent, 'type' | 'timeMs' | 'name'>
  | Omit<DependencyAssetStartEvent, 'type' | 'timeMs' | 'name'>

/**
 * Studio-managed overlay declared via `video.studio({ overlays: [...] })`. The
 * file and display options are configured in Studio, so the recording only marks
 * the timeline point.
 */
export type StudioAssetStartEvent = {
  type: 'assetStart'
  timeMs: number
  name: string
  studio: true
}

/**
 * Start of a background audio track (`createAudio`). Unlike asset overlays this
 * carries no visual: it is mixed under the recording from `timeMs` until its
 * paired {@link AudioEndEvent}, or until the end of the video when no end is
 * recorded (the common background-music case). `volume` is a linear gain (`1`
 * is natural); `repeat` loops the source to fill the span.
 */
/**
 * A per-language override of a background-audio track, used in shared-capture
 * mode. Folded into the top-level fields for the active language before
 * serialization (see {@link filterEventTranslationsToLanguage}).
 */
export type AudioTranslation = {
  path: string
  fileHash?: string
  volume?: number
  repeat?: boolean
  speed?: number
  time?: number
}

export type AudioStartEvent = {
  type: 'audioStart'
  timeMs: number
  name: string
  path: string
  /** SHA-256 of the audio file — present only during recording; used for upload/caching. */
  fileHash?: string
  volume: number
  repeat: boolean
  /** Per-language file overrides (shared-capture mode); folded before render. */
  translations?: Record<string, AudioTranslation>
  /**
   * Playback-rate multiplier for the track. `2` plays it twice as fast, `0.5`
   * at half speed. Omitted plays at the natural rate. The track keeps its
   * output span; only the source is consumed faster/slower (no timeline shift).
   */
  speed?: number
  /**
   * Target playback duration (ms) for the track, an alternative to
   * {@link speed}: the effective rate is the source duration divided by this.
   * Takes precedence over `speed` when both are set.
   */
  time?: number
}

/**
 * End marker for a background audio track. `name` pairs it to its
 * {@link AudioStartEvent}; an audioStart with no matching end plays to the end
 * of the video.
 */
export type AudioEndEvent = {
  type: 'audioEnd'
  timeMs: number
  name?: string
  reason?: 'wait'
}

/**
 * Studio-managed background audio track declared via
 * `video.studio({ audio: [...] })`. The file, volume, and repeat are configured
 * in Studio, so the recording only marks the timeline point (mirrors
 * {@link StudioAssetStartEvent} for overlays).
 */
export type StudioAudioStartEvent = {
  type: 'audioStart'
  timeMs: number
  name: string
  studio: true
}

/** Payload for {@link IEventRecorder.addAudioStart} (timing/name added by the recorder). */
export type AudioStartPayload = Omit<
  AudioStartEvent,
  'type' | 'timeMs' | 'name'
>

export type HideStartEvent = {
  type: 'hideStart'
  timeMs: number
}

export type HideEndEvent = {
  type: 'hideEnd'
  timeMs: number
}

export type SpeedStartEvent = {
  type: 'speedStart'
  timeMs: number
  multiplier: number
}

export type SpeedEndEvent = {
  type: 'speedEnd'
  timeMs: number
}

export type TimeStartEvent = {
  type: 'timeStart'
  timeMs: number
  durationMs: number
}

export type TimeEndEvent = {
  type: 'timeEnd'
  timeMs: number
}

export type AutoZoomStartEvent = {
  type: 'autoZoomStart'
  timeMs: number
  easing: string
  duration: number
  amount: number
  centering?: number
}

export type AutoZoomEndEvent = {
  type: 'autoZoomEnd'
  timeMs: number
  easing: string
  duration: number
}

/**
 * Marks the timeline point where the recording shrinks to a limited size,
 * revealing the styled background around it. `size` is a 0-1 fraction of the
 * full frame (1 = full screen). The transition takes `duration` ms with the
 * given `easing`; when `duration` is 0 or omitted the change is an instant cut.
 * Emitted by `resizeRecording()`.
 */
export type RecordingSizeStartEvent = {
  type: 'recordingSizeStart'
  timeMs: number
  size: number
  /** Transition duration in milliseconds. 0 or omitted = instant cut. */
  duration?: number
  /** Easing function for the transition. */
  easing?: Easing
}

/**
 * Marks the timeline point where the recording returns to full screen
 * (size 1). Emitted by `resetRecordingSize()`.
 */
export type RecordingSizeEndEvent = {
  type: 'recordingSizeEnd'
  timeMs: number
}

/**
 * Hides the narration (camera PIP) from this point on. Emitted by `hideNarration()`.
 */
export type NarrationHideEvent = {
  type: 'narrationHide'
  timeMs: number
}

/**
 * Shows the narration (camera PIP) from this point on. Emitted by `showNarration()`.
 */
export type NarrationShowEvent = {
  type: 'narrationShow'
  timeMs: number
}

export type RecordingEvent =
  | VideoStartEvent
  | InputEvent
  | CueStartEvent
  | CueEndEvent
  | ValuesDeclareEvent
  | VideoCueStartEvent
  | AssetStartEvent
  | AssetEndEvent
  | StudioAssetStartEvent
  | AudioStartEvent
  | StudioAudioStartEvent
  | AudioEndEvent
  | HideStartEvent
  | HideEndEvent
  | SpeedStartEvent
  | SpeedEndEvent
  | TimeStartEvent
  | TimeEndEvent
  | AutoZoomStartEvent
  | AutoZoomEndEvent
  | RecordingSizeStartEvent
  | RecordingSizeEndEvent
  | NarrationHideEvent
  | NarrationShowEvent

export type VoiceLanguageMeta = {
  /** Voice key string: a built-in voice name or an external voice key. */
  name: string
  /**
   * Integer seed included in the audio cache key. A different seed always forces
   * regeneration. Consistent output is not guaranteed across all voice types.
   */
  seed?: number
  /** TTS model type: `'expressive'` or `'consistent'`. Defaults to `'consistent'`. Choosing `'expressive'` for a language that also has a consistent voice requires the Business tier; a language whose only built-in voice is the expressive model uses it automatically on every plan. */
  modelType?: string
  /** Gemini style prompt, or ElevenLabs `eleven_multilingual_v2` style exaggeration. */
  style?: string | number
  /** Accent description for expressive synthesis. Omitted from the prompt when not set. */
  accent?: string
  /** Pacing description for expressive synthesis, or speaking rate for consistent synthesis. */
  pacing?: string | number
  stability?: number
  similarityBoost?: number
  speed?: number
  useSpeakerBoost?: boolean
}

export type RecordingMetadata = {
  videoName: string
  screenciVersion: string
  /** Language codes present in multi-language cues, e.g. `['en', 'de']`. Omitted when no multi-language cues are used. */
  languages?: string[]
  /**
   * Every language this video defines (the full code-defined / web-owned set),
   * independent of the `--languages` render filter. While `languages` is the
   * subset rendered in this recording, `availableLanguages` is the complete set,
   * so the app can tell a code-defined language that simply was not rendered this
   * run apart from one removed from code. Omitted when no language set is declared.
   */
  availableLanguages?: string[]
  sourceFilePath?: string
  /**
   * Which parts of this recording opted into Studio configuration via
   * `video.studio({...})`. `renderOptions`/`recordOptions` are set when those
   * option groups are deferred; `narration` when the recording contains
   * Studio-managed (name-only) narration cues; `assets` for Studio overlays;
   * `audio` for Studio background-audio tracks.
   */
  studio?: {
    renderOptions?: boolean
    recordOptions?: boolean
    narration?: boolean
    assets?: boolean
    audio?: boolean
  }
}

function readScreenciVersion(): string {
  const currentFileDir = dirname(fileURLToPath(import.meta.url))
  const packageJsonPaths = [
    resolve(currentFileDir, '../package.json'),
    resolve(currentFileDir, '../../package.json'),
  ]

  for (const packageJsonPath of packageJsonPaths) {
    if (!existsSync(packageJsonPath)) continue

    try {
      const packageJson = JSON.parse(
        readFileSync(packageJsonPath, 'utf-8')
      ) as {
        version?: unknown
      }
      if (typeof packageJson.version === 'string') {
        return packageJson.version
      }
    } catch {
      // Try the next candidate path.
    }
  }

  return 'unknown'
}

const SCREENCI_VERSION = readScreenciVersion()

/** Crop rect for a screenshot, in CSS pixels of the recording viewport. */
export type ScreenshotCrop = {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Capture details for a screenshot output. The raw page capture is saved beside
 * `data.json` (as `path`) at `width`×`height` device pixels (the viewport scaled
 * by `deviceScaleFactor`). The crop is a render option
 * (`renderOptions.screenshot.crop`), not a capture detail.
 */
export type ScreenshotInfo = {
  path: string
  width: number
  height: number
  deviceScaleFactor: number
  /**
   * Final cursor position when the still was captured, in CSS px of the
   * recording viewport (same coordinate space as a crop). Present only when the
   * body moved the cursor at least once. The renderer draws the cursor here when
   * `renderOptions.screenshot.mouse.show` is set; absent means there is nothing
   * to draw, so the cursor never appears for a still that never touched it.
   */
  mousePosition?: { x: number; y: number }
}

export type RecordingData = {
  events: RecordingEvent[]
  renderOptions: ResolvedRenderOptions
  recordOptions?: RecordOptions
  metadata?: RecordingMetadata
  /**
   * Output kind for this recording. Absent is treated as `'video'` so existing
   * recordings, stored versions, and manifests keep working without migration.
   */
  output?: 'video' | 'screenshot'
  /** Capture details. Present only when `output === 'screenshot'`. */
  screenshot?: ScreenshotInfo
}

/** Extra, output-specific fields written into `data.json`. */
export type WriteRecordingOptions = {
  output?: 'video' | 'screenshot'
  screenshot?: ScreenshotInfo
  /**
   * Crop recorded at capture time (a `crop()` call or `page.screenshot({ crop })`).
   * Merged into `renderOptions.screenshot.crop`, overriding any crop set in
   * config, so it is editable in Studio afterward.
   */
  crop?: ScreenshotCropRecord
}

export interface IEventRecorder {
  start(): void
  /**
   * Restrict this recording to a single language.
   *
   * In per-language recording each pass records exactly one language: the
   * metadata is stamped with `[lang]` and every cue's `translations` is filtered
   * to that language at write time, so the upload produces exactly one language
   * version. Pass `null` (the default) to keep every language, as in shared/fast
   * mode and single-language recordings.
   */
  setActiveLanguage(lang: string | null): void
  /**
   * Records the full set of languages this video defines (the code-defined or
   * web-owned set), independent of which subset was rendered this run. Stamped
   * into `metadata.availableLanguages` so the app knows a code-defined language
   * exists even when a `--languages` filter rendered only some of them.
   */
  setAvailableLanguages(languages: string[]): void
  /**
   * Records an input action. Inner event timestamps are absolute (e.g. Date.now())
   * and are converted to recording-relative milliseconds internally.
   * Throws if the event's time span overlaps with any previously recorded input event.
   */
  addInput(
    subType: InputEvent['subType'],
    elementRect: ElementRect | undefined,
    events: InputEvent['events']
  ): void
  addInput(subType: InputEvent['subType'], events: InputEvent['events']): void
  addCueStart(
    text: string,
    name: string,
    cueConfig?: CueConfig,
    translations?: Record<string, CueTranslation>,
    volume?: number,
    until?: TimelineAnchorInput,
    studio?: boolean
  ): void
  /** Records a studio-mode cue start — text and voice are configured in Studio. */
  addStudioCueStart(name: string, until?: TimelineAnchorInput): void
  /**
   * Declares the localized `values` fields used by this recording (field names,
   * Studio-managed field names, and the active language's seeds) so the backend
   * learns them. See {@link ValuesDeclareEvent}.
   */
  addValuesDeclare(
    fields: string[],
    studioFields: string[],
    seed?: Record<string, Record<string, string>>
  ): void
  addCueEnd(reason?: 'auto' | 'wait'): void
  addVideoCueStart(
    name: string,
    assetPath: string | undefined,
    assetHash: string | undefined,
    subtitle?: string,
    translations?: Record<string, VideoCueTranslation>,
    volume?: number,
    until?: TimelineAnchorInput,
    studio?: boolean
  ): void
  addAssetStart(name: string, asset: AssetStartPayload): void
  /**
   * Records a rendered/animated overlay `assetStart` whose bytes are produced
   * after the test. The event is pushed at the current timeline position with a
   * placeholder `path` and no `fileHash`; the deferred flush rasterizes the
   * captured {@link DeferredRasterizeRequest} and patches the event in place.
   */
  addPendingAssetStart(name: string, pending: PendingAssetStart): void
  /**
   * The overlays awaiting deferred rasterization, in record order. Each entry's
   * `event` is the live object in the recording, so the flush patches it
   * directly. Empty for the no-op recorder and for runs without deferred
   * overlays.
   */
  getPendingOverlays(): readonly PendingOverlay[]
  /**
   * Records the end of a `start()`/`end()`-driven asset overlay. `name`
   * identifies which overlay ended (overlays may overlap), so the renderer can
   * pair this end to its start by name.
   */
  addAssetEnd(name: string | undefined, reason?: 'auto' | 'wait'): void
  /** Records a studio-mode asset start — the file and options are configured in Studio. */
  addStudioAssetStart(name: string): void
  /** Records the start of a background audio track (`createAudio`). */
  addAudioStart(name: string, audio: AudioStartPayload): void
  /** Records a studio-mode audio start — the file, volume, and repeat are configured in Studio. */
  addStudioAudioStart(name: string): void
  /**
   * Records the end of a background audio track. `name` pairs it to its start;
   * an audio track left open plays to the end of the video.
   */
  addAudioEnd(name: string | undefined, reason?: 'wait'): void
  /**
   * Injects a background audio track that starts at `timeMs: 0` (the very
   * beginning of the recording) and plays to the end of the video. Used to
   * attach a captured screen-audio file after the recording is complete.
   *
   * Unlike {@link addAudioStart} this does not read the wall clock; the
   * timestamp is always 0 regardless of when it is called.
   */
  addScreenAudioTrack(audio: AudioStartPayload): void
  addHideStart(): void
  addHideEnd(): void
  /** Resolved cursor/scroll dispatch intervals from `recordOptions.performance`. */
  getPerformanceIntervals(): PerformanceIntervals
  addSpeedStart(multiplier: number): void
  addSpeedEnd(): void
  addTimeStart(durationMs: number): void
  addTimeEnd(): void
  addAutoZoomStart(options?: AutoZoomOptions): void
  addAutoZoomEnd(options?: AutoZoomOptions): void
  addRecordingSizeStart(
    size: number,
    options?: { duration?: number; easing?: Easing }
  ): void
  addRecordingSizeEnd(): void
  addNarrationHide(): void
  addNarrationShow(): void
  /**
   * Registers voice metadata seen during recording.
   * Kept for API compatibility; voice settings are stored per cue event.
   */
  registerVoiceForLang(lang: string, meta: VoiceLanguageMeta): void
  getEvents(): RecordingEvent[]
  writeToFile(
    dir: string,
    videoName: string,
    sourceFilePath?: string,
    options?: WriteRecordingOptions
  ): Promise<void>
}

export const NOOP_EVENT_RECORDER: IEventRecorder = {
  start(): void {},
  setActiveLanguage(): void {},
  setAvailableLanguages(): void {},
  addInput(): void {},
  addCueStart(): void {},
  addStudioCueStart(): void {},
  addValuesDeclare(): void {},
  addCueEnd(): void {},
  addVideoCueStart(): void {},
  addAssetStart(): void {},
  addPendingAssetStart(): void {},
  getPendingOverlays(): readonly PendingOverlay[] {
    return []
  },
  addAssetEnd(): void {},
  addStudioAssetStart(): void {},
  addAudioStart(): void {},
  addStudioAudioStart(): void {},
  addAudioEnd(): void {},
  addScreenAudioTrack(): void {},
  addHideStart(): void {},
  addHideEnd(): void {},
  getPerformanceIntervals(): PerformanceIntervals {
    return resolvePerformanceIntervals(undefined)
  },
  addSpeedStart(): void {},
  addSpeedEnd(): void {},
  addTimeStart(): void {},
  addTimeEnd(): void {},
  addAutoZoomStart(): void {},
  addAutoZoomEnd(): void {},
  addRecordingSizeStart(): void {},
  addRecordingSizeEnd(): void {},
  addNarrationHide(): void {},
  addNarrationShow(): void {},
  registerVoiceForLang(): void {},
  getEvents(): RecordingEvent[] {
    return []
  },
  async writeToFile(): Promise<void> {},
}

/** Max gap (ms) for a direct snap with no audio markers in between. */
const SNAP_DIRECT_MS = 5
/**
 * Extra allowance added when audio markers (cueStart etc.) are found in the
 * gap. Matches the `sleepForAssetFrameGap` duration in asset.ts (2 frames at
 * 24 fps), which runs at assetEnd and shows up as overhead before the next
 * operation.
 */
const SNAP_CUE_COMPENSATION_MS = Math.ceil(2 * (1000 / 24))

export class EventRecorder implements IEventRecorder {
  private readonly events: RecordingEvent[] = []
  private readonly pendingOverlays: PendingOverlay[] = []
  private startTime: number | null = null
  private activeLanguage: string | null = null
  /** Full code-defined / web-owned language set, for metadata.availableLanguages. */
  private availableLanguages: string[] = []
  private readonly recordOptions: RecordOptions | undefined
  private readonly renderOptions: RenderOptions | undefined
  /** Which option groups are deferred to Studio (`video.studio({...})`). */
  private readonly studioOptions: StudioOptionFlags

  constructor(
    renderOptions?: RenderOptions,
    recordOptions?: RecordOptions,
    studioOptions?: StudioOptionFlags
  ) {
    this.recordOptions = recordOptions
    this.renderOptions = renderOptions
    this.studioOptions = studioOptions ?? {
      renderOptions: false,
      recordOptions: false,
    }
  }

  registerVoiceForLang(_lang: string, _meta: VoiceLanguageMeta): void {}

  setActiveLanguage(lang: string | null): void {
    this.activeLanguage = lang
  }

  setAvailableLanguages(languages: string[]): void {
    this.availableLanguages = languages
  }

  /**
   * Returns `timeMs` snapped to the nearest preceding `hideEnd`/`assetEnd`
   * when two opaque transitions are back-to-back. Looks back through audio-only
   * events (cueStart, cueEnd, videoCueStart, audioStart, audioEnd,
   * valuesDeclare) that carry no visual frames. For a direct gap the threshold
   * is a few ms of JS overhead; if audio markers are found in the gap the
   * threshold is extended by {@link SNAP_CUE_COMPENSATION_MS} to cover the
   * frame-gap sleep that ran at the preceding assetEnd.
   *
   * When snapping, any `cueStart`/`videoCueStart` events emitted in the gap
   * are patched to the snapped time so narration starts at the same output
   * position as the visual transition.
   */
  private snapToAdjacentTransition(timeMs: number): number {
    let foundAudioMarker = false
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i]!
      if (event.type === 'hideEnd' || event.type === 'assetEnd') {
        const threshold =
          SNAP_DIRECT_MS + (foundAudioMarker ? SNAP_CUE_COMPENSATION_MS : 0)
        if (timeMs - event.timeMs > threshold) return timeMs
        const snappedTime = event.timeMs
        for (let j = i + 1; j < this.events.length; j++) {
          const e = this.events[j]!
          if (e.type === 'cueStart' || e.type === 'videoCueStart') {
            ;(e as { timeMs: number }).timeMs = snappedTime
          }
        }
        return snappedTime
      }
      if (
        event.type === 'cueStart' ||
        event.type === 'cueEnd' ||
        event.type === 'videoCueStart' ||
        event.type === 'audioStart' ||
        event.type === 'audioEnd' ||
        event.type === 'valuesDeclare'
      ) {
        foundAudioMarker = true
        continue
      }
      break
    }
    return timeMs
  }

  private normalizeCentering(
    options: AutoZoomOptions | undefined
  ): number | undefined {
    if (options?.centering === undefined) return undefined
    assertAutoZoomUnitIntervalOption(options.centering, 'centering')
    return options.centering
  }

  start(): void {
    this.startTime = Date.now()
    this.events.push({ type: 'videoStart', timeMs: 0 })
  }

  private getInnerEventBounds(event: InputEvent['events'][number]): {
    startMs: number
    endMs: number
  } {
    if (event.type === 'focusChange') {
      return {
        startMs: event.startMs,
        endMs: event.endMs,
      }
    }

    return {
      startMs: event.startMs,
      endMs: event.endMs,
    }
  }

  private getInputEventBounds(events: InputEvent['events']): {
    startMs: number
    endMs: number
  } {
    const bounds = events.map((event) => this.getInnerEventBounds(event))
    return {
      startMs: Math.min(...bounds.map((bound) => bound.startMs)),
      endMs: Math.max(...bounds.map((bound) => bound.endMs)),
    }
  }

  private relativizeFocusChangeEvent(
    event: FocusChangeEvent,
    startTime: number
  ): FocusChangeEvent {
    return {
      ...event,
      startMs: event.startMs - startTime,
      endMs: event.endMs - startTime,
      ...(event.mouse !== undefined
        ? {
            mouse: {
              ...event.mouse,
              startMs: event.mouse.startMs - startTime,
              endMs: event.mouse.endMs - startTime,
            },
          }
        : {}),
      ...(event.scroll !== undefined
        ? {
            scroll: {
              ...event.scroll,
              startMs: event.scroll.startMs - startTime,
              endMs: event.scroll.endMs - startTime,
            },
          }
        : {}),
      ...(event.zoom !== undefined
        ? {
            zoom: {
              ...event.zoom,
              startMs: event.zoom.startMs - startTime,
              endMs: event.zoom.endMs - startTime,
            },
          }
        : {}),
    }
  }

  addInput(
    subType: InputEvent['subType'],
    elementRectOrEvents: ElementRect | InputEvent['events'] | undefined,
    maybeEvents?: InputEvent['events']
  ): void {
    if (this.startTime === null) return
    const events = Array.isArray(elementRectOrEvents)
      ? elementRectOrEvents
      : maybeEvents
    if (events === undefined) return
    if (events.length === 0) return
    const st = this.startTime
    const inputBounds = this.getInputEventBounds(events)
    const relStart = inputBounds.startMs - st
    const relEnd = inputBounds.endMs - st

    for (const existing of this.events) {
      if (existing.type === 'input') {
        const existingBounds = this.getInputEventBounds(existing.events)
        const existingStart = existingBounds.startMs
        const existingEnd = existingBounds.endMs
        if (relStart < existingEnd && relEnd > existingStart) {
          throw new Error(
            `Input event '${subType}' [${relStart}ms, ${relEnd}ms] overlaps with existing '${existing.subType}' event [${existingStart}ms, ${existingEnd}ms]`
          )
        }
      } else if (
        existing.type === 'autoZoomStart' ||
        existing.type === 'autoZoomEnd'
      ) {
        if (existing.timeMs > relStart && existing.timeMs < relEnd) {
          throw new Error(
            `Input event '${subType}' [${relStart}ms, ${relEnd}ms] contains ${existing.type} at ${existing.timeMs}ms`
          )
        }
      }
    }

    const relativeEvents = events.map((event) => {
      if (event.type === 'focusChange') {
        return this.relativizeFocusChangeEvent(event, st)
      }

      return {
        ...event,
        startMs: event.startMs - st,
        endMs: event.endMs - st,
      }
    })

    this.events.push({
      type: 'input',
      subType,
      events: relativeEvents,
    } as InputEvent)
  }

  addCueStart(
    text: string,
    name: string,
    cueConfig?: CueConfig,
    translations?: Record<string, CueTranslation>,
    volume?: number,
    until?: TimelineAnchorInput,
    studio?: boolean
  ): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'cueStart',
      timeMs,
      name,
      ...(text.length > 0 && { text }),
      ...(cueConfig !== undefined && { cueConfig }),
      ...(translations !== undefined && { translations }),
      ...(volume !== undefined && { volume }),
      // A seeded studio cue carries its seed translations AND the studio marker, so
      // it renders from the seed yet stays web-editable (a Studio edit overrides it).
      ...(studio === true && { studio: true as const }),
      ...timelineAnchorFields(until),
    })
  }

  addStudioCueStart(name: string, until?: TimelineAnchorInput): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'cueStart',
      timeMs,
      name,
      studio: true,
      ...timelineAnchorFields(until),
    })
  }

  addValuesDeclare(
    fields: string[],
    studioFields: string[],
    seed?: Record<string, Record<string, string>>
  ): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'valuesDeclare',
      timeMs,
      fields,
      studioFields,
      ...(seed !== undefined && { seed }),
    })
  }

  addCueEnd(reason?: 'auto' | 'wait'): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'cueEnd',
      timeMs,
      ...(reason !== undefined && { reason }),
    })
  }

  addVideoCueStart(
    name: string,
    assetPath: string | undefined,
    assetHash: string | undefined,
    subtitle?: string,
    translations?: Record<string, VideoCueTranslation>,
    volume?: number,
    until?: TimelineAnchorInput,
    studio?: boolean
  ): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'videoCueStart',
      timeMs,
      name,
      ...(assetHash !== undefined && { assetHash }),
      ...(assetPath !== undefined && { assetPath }),
      ...(subtitle !== undefined && { subtitle }),
      ...(translations !== undefined && { translations }),
      ...(volume !== undefined && { volume }),
      // Seeded studio media cue: keeps its seed translations and the studio marker.
      ...(studio === true && { studio: true as const }),
      ...timelineAnchorFields(until),
    })
  }

  addAssetStart(name: string, asset: AssetStartPayload): void {
    if (this.startTime === null) return
    const timeMs = this.snapToAdjacentTransition(Date.now() - this.startTime)
    if (asset.kind === 'image') {
      this.events.push({
        type: 'assetStart',
        timeMs,
        name,
        kind: 'image',
        path: asset.path,
        ...(asset.fileHash !== undefined && { fileHash: asset.fileHash }),
        ...(asset.durationMs !== undefined && { durationMs: asset.durationMs }),
        fullScreen: asset.fullScreen,
        ...(asset.placement !== undefined && { placement: asset.placement }),
        ...(asset.crop !== undefined && { crop: asset.crop }),
        ...(asset.untilOutputMs !== undefined && {
          untilOutputMs: asset.untilOutputMs,
        }),
        ...(asset.untilPercent !== undefined && {
          untilPercent: asset.untilPercent,
        }),
      })
      return
    }

    if (asset.kind === 'animation') {
      this.events.push({
        type: 'assetStart',
        timeMs,
        name,
        kind: 'animation',
        path: asset.path,
        ...(asset.fileHash !== undefined && { fileHash: asset.fileHash }),
        ...(asset.durationMs !== undefined && { durationMs: asset.durationMs }),
        fullScreen: asset.fullScreen,
        ...(asset.placement !== undefined && { placement: asset.placement }),
        ...(asset.untilOutputMs !== undefined && {
          untilOutputMs: asset.untilOutputMs,
        }),
        ...(asset.untilPercent !== undefined && {
          untilPercent: asset.untilPercent,
        }),
      })
      return
    }

    if (asset.kind === 'dependency') {
      this.events.push({
        type: 'assetStart',
        timeMs,
        name,
        kind: 'dependency',
        dependency: asset.dependency,
        ...(asset.durationMs !== undefined && { durationMs: asset.durationMs }),
        fullScreen: asset.fullScreen,
        ...(asset.placement !== undefined && { placement: asset.placement }),
        ...(asset.crop !== undefined && { crop: asset.crop }),
        ...(asset.sourceStart !== undefined && {
          sourceStart: asset.sourceStart,
        }),
        ...(asset.sourceEnd !== undefined && { sourceEnd: asset.sourceEnd }),
        ...(asset.untilOutputMs !== undefined && {
          untilOutputMs: asset.untilOutputMs,
        }),
        ...(asset.untilPercent !== undefined && {
          untilPercent: asset.untilPercent,
        }),
      })
      return
    }

    this.events.push({
      type: 'assetStart',
      timeMs,
      name,
      kind: 'video',
      path: asset.path,
      ...(asset.fileHash !== undefined && { fileHash: asset.fileHash }),
      audio: asset.audio,
      fullScreen: asset.fullScreen,
      ...(asset.placement !== undefined && { placement: asset.placement }),
      ...(asset.crop !== undefined && { crop: asset.crop }),
      ...(asset.sourceStart !== undefined && {
        sourceStart: asset.sourceStart,
      }),
      ...(asset.sourceEnd !== undefined && { sourceEnd: asset.sourceEnd }),
      ...(asset.untilOutputMs !== undefined && {
        untilOutputMs: asset.untilOutputMs,
      }),
      ...(asset.untilPercent !== undefined && {
        untilPercent: asset.untilPercent,
      }),
      ...(asset.speed !== undefined && { speed: asset.speed }),
      ...(asset.time !== undefined && { time: asset.time }),
    })
  }

  addPendingAssetStart(name: string, pending: PendingAssetStart): void {
    if (this.startTime === null) return
    const timeMs = this.snapToAdjacentTransition(Date.now() - this.startTime)
    const event: ImageAssetStartEvent | AnimationAssetStartEvent = {
      type: 'assetStart',
      timeMs,
      name,
      kind: pending.kind,
      // Patched by the deferred flush once the overlay is rasterized.
      path: '',
      ...(pending.durationMs !== undefined && {
        durationMs: pending.durationMs,
      }),
      fullScreen: pending.fullScreen,
      ...(pending.placement !== undefined && { placement: pending.placement }),
      ...(pending.untilOutputMs !== undefined && {
        untilOutputMs: pending.untilOutputMs,
      }),
      ...(pending.untilPercent !== undefined && {
        untilPercent: pending.untilPercent,
      }),
    }
    this.events.push(event)
    this.pendingOverlays.push({ event, request: pending.request })
  }

  getPendingOverlays(): readonly PendingOverlay[] {
    return this.pendingOverlays
  }

  addAssetEnd(name: string | undefined, reason?: 'auto' | 'wait'): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'assetEnd',
      timeMs,
      ...(name !== undefined && { name }),
      ...(reason !== undefined && { reason }),
    })
  }

  addStudioAssetStart(name: string): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'assetStart',
      timeMs,
      name,
      studio: true,
    })
  }

  addAudioStart(name: string, audio: AudioStartPayload): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'audioStart',
      timeMs,
      name,
      path: audio.path,
      ...(audio.fileHash !== undefined && { fileHash: audio.fileHash }),
      volume: audio.volume,
      repeat: audio.repeat,
      ...(audio.speed !== undefined && { speed: audio.speed }),
      ...(audio.time !== undefined && { time: audio.time }),
    })
  }

  addStudioAudioStart(name: string): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'audioStart',
      timeMs,
      name,
      studio: true,
    })
  }

  addAudioEnd(name: string | undefined, reason?: 'wait'): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'audioEnd',
      timeMs,
      ...(name !== undefined && { name }),
      ...(reason !== undefined && { reason }),
    })
  }

  addScreenAudioTrack(audio: AudioStartPayload): void {
    this.events.push({
      type: 'audioStart',
      timeMs: 0,
      // Reserved track name: the renderer recognizes `__screen` as the captured
      // screen audio (captureAudio) and re-segments it onto the raw recording
      // timeline (cut/paused by hides, overlays, and cue holds) rather than
      // treating it as createAudio background music. See
      // buildCapturedScreenAudioOverlays in apps/rendering.
      name: '__screen',
      path: audio.path,
      ...(audio.fileHash !== undefined && { fileHash: audio.fileHash }),
      volume: audio.volume,
      repeat: audio.repeat,
      ...(audio.speed !== undefined && { speed: audio.speed }),
      ...(audio.time !== undefined && { time: audio.time }),
    })
  }

  addHideStart(): void {
    if (this.startTime === null) return
    const timeMs = this.snapToAdjacentTransition(Date.now() - this.startTime)
    this.events.push({ type: 'hideStart', timeMs })
  }

  addHideEnd(): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'hideEnd', timeMs })
  }

  getPerformanceIntervals(): PerformanceIntervals {
    return resolvePerformanceIntervals(
      this.recordOptions?.performance,
      this.recordOptions?.fps
    )
  }

  addSpeedStart(multiplier: number): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'speedStart', timeMs, multiplier })
  }

  addSpeedEnd(): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'speedEnd', timeMs })
  }

  addTimeStart(durationMs: number): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'timeStart', timeMs, durationMs })
  }

  addTimeEnd(): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'timeEnd', timeMs })
  }

  addAutoZoomStart(options?: AutoZoomOptions): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    const centering = this.normalizeCentering(options)
    for (const existing of this.events) {
      if (existing.type !== 'input') continue
      const existingBounds = this.getInputEventBounds(existing.events)
      const existingStart = existingBounds.startMs
      const existingEnd = existingBounds.endMs
      if (timeMs > existingStart && timeMs < existingEnd) {
        throw new ScreenciError(
          `autoZoomStart at ${timeMs}ms falls inside input '${existing.subType}' event [${existingStart}ms, ${existingEnd}ms]`
        )
      }
    }
    const resolvedOptions = {
      ...DEFAULT_ZOOM_OPTIONS,
      ...(options ?? {}),
    }
    assertAutoZoomUnitIntervalOption(resolvedOptions.amount, 'amount')
    this.events.push({
      type: 'autoZoomStart',
      timeMs,
      easing: resolvedOptions.easing,
      duration: resolvedOptions.duration,
      amount: resolvedOptions.amount,
      ...(centering !== undefined && {
        centering,
      }),
    })
  }

  addAutoZoomEnd(options?: AutoZoomOptions): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    for (const existing of this.events) {
      if (existing.type !== 'input') continue
      const existingBounds = this.getInputEventBounds(existing.events)
      const existingStart = existingBounds.startMs
      const existingEnd = existingBounds.endMs
      if (timeMs > existingStart && timeMs < existingEnd) {
        throw new ScreenciError(
          `autoZoomEnd at ${timeMs}ms falls inside input '${existing.subType}' event [${existingStart}ms, ${existingEnd}ms]`
        )
      }
    }
    const resolvedOptions = {
      ...DEFAULT_ZOOM_OPTIONS,
      ...(options ?? {}),
    }
    this.events.push({
      type: 'autoZoomEnd',
      timeMs,
      easing: resolvedOptions.easing,
      duration: resolvedOptions.duration,
    })
  }

  addRecordingSizeStart(
    size: number,
    options?: { duration?: number; easing?: Easing }
  ): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'recordingSizeStart',
      timeMs,
      size,
      ...(options?.duration !== undefined && { duration: options.duration }),
      ...(options?.easing !== undefined && { easing: options.easing }),
    })
  }

  addRecordingSizeEnd(): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'recordingSizeEnd', timeMs })
  }

  addNarrationHide(): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'narrationHide', timeMs })
  }

  addNarrationShow(): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'narrationShow', timeMs })
  }

  getEvents(): RecordingEvent[] {
    return [...this.events]
  }

  async writeToFile(
    dir: string,
    videoName: string,
    sourceFilePath?: string,
    options?: WriteRecordingOptions
  ): Promise<void> {
    const filePath = join(dir, 'data.json')

    // Studio mode: render options come from the Studio page. data.json still
    // gets a fully-resolved set (so it always validates and renders), and
    // metadata.studio.renderOptions marks the deferral for the backend.
    const studioRenderOptions = this.studioOptions.renderOptions
    const studioRecordOptions = this.studioOptions.recordOptions

    // Resolve all defaults so data.json always contains a complete set of render
    // options. `this.renderOptions` is undefined for a blank deferral
    // (`renderOptions: studio()`) and the seed for a seeded one
    // (`renderOptions: studio({ ... })`), so a seed renders as the starting point
    // while the Studio flag still marks it web-owned (the web app overrides it).
    const ro = this.renderOptions
    const resolved: ResolvedRenderOptions = {
      recording: {
        size: ro?.recording?.size ?? RENDER_OPTIONS_DEFAULTS.recording.size,
        roundness:
          ro?.recording?.roundness ??
          RENDER_OPTIONS_DEFAULTS.recording.roundness,
        shape: ro?.recording?.shape ?? RENDER_OPTIONS_DEFAULTS.recording.shape,
        dropShadow:
          ro?.recording?.dropShadow ??
          RENDER_OPTIONS_DEFAULTS.recording.dropShadow,
      },
      narration: {
        size: ro?.narration?.size ?? RENDER_OPTIONS_DEFAULTS.narration.size,
        roundness:
          ro?.narration?.roundness ??
          RENDER_OPTIONS_DEFAULTS.narration.roundness,
        shape: ro?.narration?.shape ?? RENDER_OPTIONS_DEFAULTS.narration.shape,
        corner:
          ro?.narration?.corner ?? RENDER_OPTIONS_DEFAULTS.narration.corner,
        padding:
          ro?.narration?.padding ?? RENDER_OPTIONS_DEFAULTS.narration.padding,
        dropShadow: normalizeNarrationDropShadow(
          ro?.narration?.dropShadow,
          RENDER_OPTIONS_DEFAULTS.narration.dropShadow
        ),
      },
      mouse: {
        size: ro?.mouse?.size ?? RENDER_OPTIONS_DEFAULTS.mouse.size,
        style: ro?.mouse?.style ?? RENDER_OPTIONS_DEFAULTS.mouse.style,
        // Custom cursor image is opt-in (no default). Passed through as the raw
        // config path here; the CLI hashes and rewrites it to
        // `{ assetPath, fileHash }` during upload.
        ...(ro?.mouse?.image !== undefined && { image: ro.mouse.image }),
        motionBlur:
          ro?.mouse?.motionBlur ?? RENDER_OPTIONS_DEFAULTS.mouse.motionBlur,
      },
      zoom: {
        motionBlur:
          ro?.zoom?.motionBlur ?? RENDER_OPTIONS_DEFAULTS.zoom.motionBlur,
      },
      output: {
        aspectRatio:
          ro?.output?.aspectRatio ?? RENDER_OPTIONS_DEFAULTS.output.aspectRatio,
        quality: ro?.output?.quality ?? RENDER_OPTIONS_DEFAULTS.output.quality,
        background:
          ro?.output?.background ?? RENDER_OPTIONS_DEFAULTS.output.background,
      },
    }

    // Screenshot render group: pass through any configured fields and merge the
    // record-time crop. The crop is never configurable, so it comes only from a
    // `crop()` call or `page.screenshot({ crop })`. Present only when something
    // is set, so video recordings stay unaffected.
    const cropOverride = options?.crop
    const screenshotGroup = {
      ...(ro?.screenshot?.format !== undefined && {
        format: ro.screenshot.format,
      }),
      ...(ro?.screenshot?.margin !== undefined && {
        margin: ro.screenshot.margin,
      }),
      ...(ro?.screenshot?.aspectRatio !== undefined && {
        aspectRatio: ro.screenshot.aspectRatio,
      }),
      ...(cropOverride !== undefined && { crop: cropOverride }),
    }
    if (Object.keys(screenshotGroup).length > 0) {
      resolved.screenshot = screenshotGroup
    }

    // Per-language recording: each pass records exactly one language. The cue
    // translations are filtered to that language and the metadata is stamped
    // with `[activeLanguage]` so the upload produces a single language version
    // (and the renderer never sees foreign-language translations).
    const activeLanguage = this.activeLanguage
    const serializedEvents =
      activeLanguage !== null
        ? this.events.map((event) =>
            filterEventTranslationsToLanguage(event, activeLanguage)
          )
        : this.events

    const languageSet = new Set<string>()
    for (const event of this.events) {
      if (event.type === 'cueStart') {
        if (event.translations !== undefined) {
          for (const lang of Object.keys(event.translations)) {
            languageSet.add(lang)
          }
        } else if (event.cueConfig?.voice !== undefined) {
          const lang =
            event.cueConfig.voice.includes('.') &&
            !event.cueConfig.voice.startsWith('elevenlabs:')
              ? event.cueConfig.voice.split('.')[0]
              : undefined
          if (lang) languageSet.add(lang)
        }
      }
    }
    const languages =
      activeLanguage !== null
        ? [activeLanguage]
        : languageSet.size > 0
          ? [...languageSet].sort()
          : undefined
    // The full code-defined / web-owned set, regardless of which subset was
    // rendered this run (`--languages`). The app unions this across a video's
    // recordings to know every defined language, so one not rendered this run is
    // not mistaken for one removed from code. Omitted for plain videos that
    // declare no language set (availableLanguages stays empty).
    const availableLanguages =
      this.availableLanguages.length > 0
        ? [...new Set(this.availableLanguages)].sort()
        : undefined

    const git = getGitMetadata()

    const studioNarration = this.events.some(
      (event) => event.type === 'cueStart' && event.studio === true
    )
    const studioAssets = this.events.some(
      (event) =>
        event.type === 'assetStart' &&
        'studio' in event &&
        event.studio === true
    )
    const studioAudio = this.events.some(
      (event) =>
        event.type === 'audioStart' &&
        'studio' in event &&
        event.studio === true
    )
    // Whether the language set is web-owned (`video.languages(studio())`). The
    // web uses this to decide a video may have languages added/rendered from the
    // app (code-defined language sets cannot be changed from the web).
    const studioLanguages = this.studioOptions.languages === true
    const studio: RecordingMetadata['studio'] =
      studioRenderOptions ||
      studioRecordOptions ||
      studioNarration ||
      studioAssets ||
      studioAudio ||
      studioLanguages
        ? {
            ...(studioRenderOptions && { renderOptions: true }),
            ...(studioRecordOptions && { recordOptions: true }),
            ...(studioNarration && { narration: true }),
            ...(studioAssets && { assets: true }),
            ...(studioAudio && { audio: true }),
            ...(studioLanguages && { languages: true }),
          }
        : undefined

    const data: RecordingData = {
      events: serializedEvents,
      renderOptions: resolved,
      ...(this.recordOptions !== undefined && {
        recordOptions: this.recordOptions,
      }),
      ...(options?.output !== undefined && { output: options.output }),
      ...(options?.screenshot !== undefined && {
        screenshot: options.screenshot,
      }),
      metadata: {
        videoName,
        screenciVersion: SCREENCI_VERSION,
        ...(languages !== undefined && { languages }),
        ...(availableLanguages !== undefined && { availableLanguages }),
        ...(sourceFilePath !== undefined && { sourceFilePath }),
        ...(git.commit !== undefined && { commit: git.commit }),
        ...(git.isDirty !== undefined && { isDirty: git.isDirty }),
        ...(studio !== undefined && { studio }),
      },
    }
    await writeFile(filePath, JSON.stringify(data, null, 2))
  }
}

/**
 * Returns a copy of `event` whose `translations` map is narrowed to a single
 * language. Cue events without a translation for that language have their
 * `translations` dropped entirely; every other event is returned unchanged.
 *
 * Pure and exported for testing. Used by per-language recording so each pass
 * writes exactly the active language's narration.
 */
export function filterEventTranslationsToLanguage(
  event: RecordingEvent,
  language: string
): RecordingEvent {
  // Narration cues keep the active language's translation as a single-language
  // map (the renderer reads `translations[language]`).
  if (event.type === 'cueStart' || event.type === 'videoCueStart') {
    if (event.translations === undefined) {
      return event
    }
    const translation = (event.translations as Record<string, unknown>)[
      language
    ]
    if (translation === undefined) {
      const { translations: _dropped, ...rest } = event
      return rest as RecordingEvent
    }
    return {
      ...event,
      translations: { [language]: translation },
    } as RecordingEvent
  }

  // Asset/audio events have no per-language map in the renderer schema: fold the
  // active language's override up into the top-level fields and drop the map, so
  // the renderer only ever sees a single resolved language.
  if (
    (event.type === 'assetStart' || event.type === 'audioStart') &&
    'translations' in event &&
    event.translations !== undefined
  ) {
    const translations = event.translations as Record<
      string,
      Record<string, unknown>
    >
    const { translations: _dropped, ...rest } = event as Record<string, unknown>
    const override = translations[language]
    if (override === undefined) return rest as unknown as RecordingEvent
    const merged: Record<string, unknown> = { ...rest }
    for (const [key, value] of Object.entries(override)) {
      if (value !== undefined) merged[key] = value
    }
    return merged as unknown as RecordingEvent
  }

  return event
}

function normalizeNarrationDropShadow(
  input: number | undefined,
  fallback: number
): number {
  if (typeof input === 'number') {
    return clamp01(input)
  }

  return fallback
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }
  return value
}
