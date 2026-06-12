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
  assetHash: string
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
  text?: string
  cueConfig?: CueConfig
  translations?: Record<string, CueTranslation>
}

export type CueEndEvent = {
  type: 'cueEnd'
  timeMs: number
  reason?: 'auto' | 'wait'
}

export type VideoCueTranslationFile = {
  assetHash: string
  assetPath?: string
  subtitle?: string
}

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
  assetHash?: string
  assetPath?: string
  subtitle?: string
  translations?: Record<string, VideoCueTranslation>
}

export type ImageAssetStartEvent = {
  type: 'assetStart'
  timeMs: number
  name: string
  kind: 'image'
  path: string
  fileHash?: string
  durationMs: number
  fullScreen: boolean
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
}

export type AssetStartEvent = ImageAssetStartEvent | VideoAssetStartEvent

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
}

export type RecordingData = {
  events: RecordingEvent[]
  renderOptions: ResolvedRenderOptions
  recordOptions?: RecordOptions
  metadata?: RecordingMetadata
}
