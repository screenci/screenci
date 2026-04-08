import type {
  CaptionConfig,
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
    | 'mouseMove'
    | 'mouseShow'
    | 'mouseHide'
    | 'hover'
    | 'selectText'
    | 'dragTo'
  elementRect?: ElementRect
  events: Array<
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

export type CaptionTranslation = {
  text: string
  voice: VoiceKey | RecordingCustomVoiceRef
}

export type CaptionStartEvent = {
  type: 'captionStart'
  timeMs: number
  name: string
  text?: string
  captionConfig?: CaptionConfig
  translations?: Record<string, CaptionTranslation>
}

export type CaptionEndEvent = {
  type: 'captionEnd'
  timeMs: number
  reason?: 'auto' | 'waitEnd'
}

export type VideoCaptionTranslationFile = {
  assetHash: string
  assetPath?: string
  subtitle?: string
}

export type VideoCaptionTranslationTTS = {
  text: string
  voice: VoiceKey | RecordingCustomVoiceRef
}

export type VideoCaptionTranslation =
  | VideoCaptionTranslationFile
  | VideoCaptionTranslationTTS

export type VideoCaptionStartEvent = {
  type: 'videoCaptionStart'
  timeMs: number
  name: string
  assetHash?: string
  assetPath?: string
  subtitle?: string
  translations?: Record<string, VideoCaptionTranslation>
}

export type AssetStartEvent = {
  type: 'assetStart'
  timeMs: number
  name: string
  path: string
  fileHash?: string
  audio: number
  fullScreen: boolean
}

export type HideStartEvent = {
  type: 'hideStart'
  timeMs: number
}

export type HideEndEvent = {
  type: 'hideEnd'
  timeMs: number
}

export type AutoZoomStartEvent = {
  type: 'autoZoomStart'
  timeMs: number
  easing: string
  duration: number
  amount: number
  centering?: { cursor?: number; input?: number; click?: number }
  allowZoomingOut?: boolean
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
  | CaptionStartEvent
  | CaptionEndEvent
  | VideoCaptionStartEvent
  | AssetStartEvent
  | HideStartEvent
  | HideEndEvent
  | AutoZoomStartEvent
  | AutoZoomEndEvent

export type RecordingMetadata = {
  videoName: string
  languages?: string[]
}

export type RecordingData = {
  events: RecordingEvent[]
  renderOptions: ResolvedRenderOptions
  recordOptions?: RecordOptions
  metadata?: RecordingMetadata
}
