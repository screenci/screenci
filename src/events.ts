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
import {
  isStudioRenderOptions,
  type StudioRenderOptionsSentinel,
} from './studio.js'
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
  assetHash: string
  /** Present only in recording phase (for CLI upload); stripped from submitted data. */
  assetPath?: string
}

export type CueTranslation = {
  text: string
  voice: VoiceKey | RecordingCustomVoiceRef
  /** TTS model type — `'expressive'` or `'consistent'`. Defaults to `'consistent'`. `'expressive'` requires the Business tier. */
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
}

export type CueStartEvent = {
  type: 'cueStart'
  timeMs: number
  name: string
  /** Cue declared via `createStudioNarration` — text and voice come from Studio. */
  studio?: true
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

/** File-based video cue translation. assetPath is present only in the local
 *  recording phase (for CLI upload) and is stripped before submitting to the backend. */
export type VideoCueTranslationFile = {
  assetHash: string
  /** Local file path — present only during recording; stripped from submitted data. */
  assetPath?: string
  subtitle?: string
}
/** TTS-based video cue translation — generates audio via text-to-speech. */
export type VideoCueTranslationTTS = {
  text: string
  voice: VoiceKey | RecordingCustomVoiceRef
  /** TTS model type — `'expressive'` or `'consistent'`. Defaults to `'consistent'`. `'expressive'` requires the Business tier. */
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
}
export type VideoCueTranslation =
  | VideoCueTranslationFile
  | VideoCueTranslationTTS

export type VideoCueStartEvent = {
  type: 'videoCueStart'
  timeMs: number
  name: string
  /** Cue declared via `createStudioNarration` whose Studio entry is a media file. */
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
  placement?: OverlayPlacement
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
  placement?: OverlayPlacement
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
  durationMs?: number
  fullScreen: boolean
  placement?: OverlayPlacement
}

/**
 * End marker for an asset overlay driven by `start()`/`end()`. The asset is
 * visible from its `assetStart` until this event (a live overlay over the
 * recording, no frozen frame). `reason` mirrors cue ends: `'wait'` for an
 * explicit `end()`, `'auto'` when this one was auto-ended.
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
      capturePadding: number
      deviceScaleFactor: number
    }
  | {
      kind: 'animation'
      name: string
      html: string
      css: string
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
  placement?: OverlayPlacement
  request: DeferredRasterizeRequest
}
export type AssetStartPayload =
  | Omit<ImageAssetStartEvent, 'type' | 'timeMs' | 'name'>
  | Omit<VideoAssetStartEvent, 'type' | 'timeMs' | 'name'>
  | Omit<AnimationAssetStartEvent, 'type' | 'timeMs' | 'name'>

/**
 * Asset declared via `createStudioOverlays` — the file and display options are
 * configured in Studio, so the recording only marks the timeline point.
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
export type AudioStartEvent = {
  type: 'audioStart'
  timeMs: number
  name: string
  path: string
  /** SHA-256 of the audio file — present only during recording; used for upload/caching. */
  fileHash?: string
  volume: number
  repeat: boolean
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
 * Background audio track declared via `createStudioAudio` — the file, volume,
 * and repeat are configured in Studio, so the recording only marks the timeline
 * point (mirrors {@link StudioAssetStartEvent} for overlays).
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

export type RecordingEvent =
  | VideoStartEvent
  | InputEvent
  | CueStartEvent
  | CueEndEvent
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

export type VoiceLanguageMeta = {
  /** Voice key string: a built-in voice name or an external voice key. */
  name: string
  /**
   * Integer seed included in the audio cache key. A different seed always forces
   * regeneration. Consistent output is not guaranteed across all voice types.
   */
  seed?: number
  /** TTS model type — `'expressive'` or `'consistent'`. Defaults to `'consistent'`. `'expressive'` requires the Business tier. */
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
  sourceFilePath?: string
  /**
   * Which parts of this recording opted into Studio configuration.
   * `renderOptions` is set when `renderOptions: 'studio'` was used; `narration`
   * when the recording contains `createStudioNarration` cues; `assets` when it
   * contains `createStudioOverlays` assets; `audio` when it contains
   * `createStudioAudio` tracks.
   */
  studio?: {
    renderOptions?: boolean
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
    volume?: number
  ): void
  /** Records a studio-mode cue start — text and voice are configured in Studio. */
  addStudioCueStart(name: string): void
  addCueEnd(reason?: 'auto' | 'wait'): void
  addVideoCueStart(
    name: string,
    assetPath: string | undefined,
    assetHash: string | undefined,
    subtitle?: string,
    translations?: Record<string, VideoCueTranslation>,
    volume?: number
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
  addInput(): void {},
  addCueStart(): void {},
  addStudioCueStart(): void {},
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
  registerVoiceForLang(): void {},
  getEvents(): RecordingEvent[] {
    return []
  },
  async writeToFile(): Promise<void> {},
}

export class EventRecorder implements IEventRecorder {
  private readonly events: RecordingEvent[] = []
  private readonly pendingOverlays: PendingOverlay[] = []
  private startTime: number | null = null
  private activeLanguage: string | null = null
  private readonly recordOptions: RecordOptions | undefined
  private readonly renderOptions:
    | RenderOptions
    | StudioRenderOptionsSentinel
    | undefined

  constructor(
    renderOptions?: RenderOptions | StudioRenderOptionsSentinel,
    recordOptions?: RecordOptions
  ) {
    this.recordOptions = recordOptions
    this.renderOptions = renderOptions
  }

  registerVoiceForLang(_lang: string, _meta: VoiceLanguageMeta): void {}

  setActiveLanguage(lang: string | null): void {
    this.activeLanguage = lang
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
    volume?: number
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
    })
  }

  addStudioCueStart(name: string): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'cueStart',
      timeMs,
      name,
      studio: true,
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
    volume?: number
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
    })
  }

  addAssetStart(name: string, asset: AssetStartPayload): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
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
      ...(asset.speed !== undefined && { speed: asset.speed }),
      ...(asset.time !== undefined && { time: asset.time }),
    })
  }

  addPendingAssetStart(name: string, pending: PendingAssetStart): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
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

  addHideStart(): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
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
    // gets fully-resolved defaults (so it always validates and renders), and
    // metadata.studio.renderOptions marks the deferral for the backend.
    const studioRenderOptions = isStudioRenderOptions(this.renderOptions)

    // Resolve all defaults so data.json always contains a complete set of
    // render options.
    const ro = studioRenderOptions ? undefined : this.renderOptions
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
    const studio: RecordingMetadata['studio'] =
      studioRenderOptions || studioNarration || studioAssets || studioAudio
        ? {
            ...(studioRenderOptions && { renderOptions: true }),
            ...(studioNarration && { narration: true }),
            ...(studioAssets && { assets: true }),
            ...(studioAudio && { audio: true }),
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
  if (event.type !== 'cueStart' && event.type !== 'videoCueStart') {
    return event
  }
  if (event.translations === undefined) {
    return event
  }

  const translation = (event.translations as Record<string, unknown>)[language]
  if (translation === undefined) {
    const { translations: _dropped, ...rest } = event
    return rest as RecordingEvent
  }

  return {
    ...event,
    translations: { [language]: translation },
  } as RecordingEvent
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
