import type {
  CueConfig,
  Easing,
  RecordOptions,
  ResolvedRenderOptions,
} from './types.js'
import type { VoiceKey } from './voices.js'

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

/** Legacy alias for older recordings. New recordings should use focusChange. */
export type MouseMoveEvent = {
  type: 'mouseMove'
  startMs: number
  endMs: number
  duration: number
  x: number
  y: number
  easing?: Easing
  zoomFollow?: boolean
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
  assetHash?: string
  assetPath?: string
}

export type CueTranslation = {
  text: string
  voice: VoiceKey | RecordingCustomVoiceRef
  modelType?: string
  style?: string | number
  accent?: string
  pacing?: string | number
  stability?: number
  similarityBoost?: number
  speed?: number
  useSpeakerBoost?: boolean
  seed?: number
}

export type CueStartEvent = {
  type: 'cueStart'
  timeMs: number
  name: string
  /** Cue declared via the Studio-managed (name-only) narration form — text and voice come from Studio. */
  studio?: true
  text?: string
  cueConfig?: CueConfig
  translations?: Record<string, CueTranslation>
  /**
   * Linear gain applied to this cue's narration audio at mix time (`1` is the
   * natural level). A render-time mix property kept out of the translations so it
   * never affects the audio cache key. Omitted plays at unity.
   */
  volume?: number
}

export type CueEndEvent = {
  type: 'cueEnd'
  timeMs: number
  reason?: 'auto' | 'wait'
}

// During recording this carries the local assetPath (assetHash present only when
// the file was found locally); the path is stripped before submission, leaving
// just assetHash.
export type VideoCueTranslationFile =
  | { assetPath: string; assetHash?: string; subtitle?: string }
  | { assetHash: string; assetPath?: string; subtitle?: string }

export type VideoCueTranslationTTS = {
  text: string
  voice: VoiceKey | RecordingCustomVoiceRef
  modelType?: string
  style?: string | number
  accent?: string
  pacing?: string | number
  stability?: number
  similarityBoost?: number
  speed?: number
  useSpeakerBoost?: boolean
  seed?: number
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
  assetHash?: string
  assetPath?: string
  subtitle?: string
  translations?: Record<string, VideoCueTranslation>
  /**
   * Linear gain applied to this cue's narration audio at mix time (`1` is the
   * natural level). A render-time mix property kept out of the translations so it
   * never affects the audio cache key. Omitted plays at unity.
   */
  volume?: number
}

/**
 * A per-language override of an overlay's file/options, used in shared-capture
 * mode where one recording carries every language. The recorder folds the active
 * language's translation into the top-level fields before serialization (see
 * `filterEventTranslationsToLanguage`), so the renderer only ever sees a single
 * resolved language.
 */
export type AssetTranslation = {
  path: string
  fileHash?: string
  durationMs?: number
  audio?: number
  fullScreen?: boolean
  speed?: number
  time?: number
}

export type ImageAssetStartEvent = {
  type: 'assetStart'
  timeMs: number
  name: string
  kind: 'image'
  path: string
  fileHash?: string
  durationMs?: number
  fullScreen: boolean
  /** Per-language file overrides (shared-capture mode); folded before render. */
  translations?: Record<string, AssetTranslation>
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
  /**
   * Playback-rate multiplier for the overlay video (and its audio). `2` plays
   * it twice as fast; omitted plays at the natural rate. A blocking overlay's
   * frozen window scales with it; a live overlay keeps its window.
   */
  speed?: number
  /** Target playback duration (ms); an alternative to {@link speed}. */
  time?: number
  /** Per-language file overrides (shared-capture mode); folded before render. */
  translations?: Record<string, AssetTranslation>
}

export type AssetStartEvent = ImageAssetStartEvent | VideoAssetStartEvent

/**
 * Studio-managed overlay declared via `video.overlays(editable([...]))`. The
 * file and display options are configured in Studio, so the recording only marks
 * the timeline point.
 */
export type StudioAssetStartEvent = {
  type: 'assetStart'
  timeMs: number
  name: string
  studio: true
}

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
  | StudioAssetStartEvent
  | HideStartEvent
  | HideEndEvent
  | SpeedStartEvent
  | SpeedEndEvent
  | TimeStartEvent
  | TimeEndEvent
  | AutoZoomStartEvent
  | AutoZoomEndEvent

export type RecordingMetadata = {
  videoName: string
  screenciVersion: string
  languages?: string[]
  sourceFilePath?: string
  /** First 8 chars of the git commit the recording was made at, if available. */
  commit?: string
  /** Whether the repo had uncommitted changes (always false in CI). */
  isDirty?: boolean
  /** Which parts of this recording opted into Studio configuration. */
  studio?: {
    renderOptions?: boolean
    narration?: boolean
    assets?: boolean
    /** Web-owned language set (`video.languages(editable())`): the app may add and
     *  render languages for this video. Absent for code-defined language sets. */
    languages?: boolean
  }
}

export type RecordingData = {
  events: RecordingEvent[]
  renderOptions: ResolvedRenderOptions
  recordOptions?: RecordOptions
  metadata?: RecordingMetadata
}
