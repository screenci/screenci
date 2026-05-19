import type {
  AutoZoomOptions,
  CueConfig,
  Easing,
  RecordOptions,
  RenderOptions,
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
      pointPx: {
        x: number
        y: number
      }
      size: {
        widthPx: number
        heightPx: number
      }
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
  /** BCP-47 region code, e.g. 'en-US'. Overrides the base language for TTS synthesis. */
  region?: string
  /** TTS model type — `'expressive'` or `'consistent'`. Defaults to `'consistent'`. */
  modelType?: string
  /** Speaking style prompt for expressive synthesis. */
  style?: string
  /** Accent description for expressive synthesis. Omitted from the prompt when not set. */
  accent?: string
  /** Pacing description for expressive synthesis, or speaking rate for consistent synthesis. */
  pacing?: string | number
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
  /** Single-language API (backward compat) */
  text?: string
  cueConfig?: CueConfig
  /** Multi-language API — all language translations keyed by language code */
  translations?: Record<string, CueTranslation>
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
  /** BCP-47 region code, e.g. 'en-US'. Overrides the base language for TTS synthesis. */
  region?: string
  /** TTS model type — `'expressive'` or `'consistent'`. Defaults to `'consistent'`. */
  modelType?: string
  /** Speaking style prompt for expressive synthesis. */
  style?: string
  /** Accent description for expressive synthesis. Omitted from the prompt when not set. */
  accent?: string
  /** Pacing description for expressive synthesis, or speaking rate for consistent synthesis. */
  pacing?: string | number
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
  /** Single-language API: SHA-256 hash of the pre-recorded asset. */
  assetHash?: string
  /** Single-language API: local file path — present only during recording; stripped from submitted data. */
  assetPath?: string
  /** Optional subtitle text. Words are spread with equal timing at render time. */
  subtitle?: string
  /** Multi-language API — per-language translations keyed by language code. */
  translations?: Record<string, VideoCueTranslation>
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
  /** BCP-47 region code, e.g. 'en-US'. Overrides the base language for TTS synthesis. */
  region?: string
  /** TTS model type — `'expressive'` or `'consistent'`. Defaults to `'consistent'`. */
  modelType?: string
  /** Speaking style prompt for expressive synthesis. */
  style?: string
  /** Accent description for expressive synthesis. Omitted from the prompt when not set. */
  accent?: string
  /** Pacing description for expressive synthesis, or speaking rate for consistent synthesis. */
  pacing?: string | number
}
export type RecordingMetadata = {
  videoName: string
  screenciVersion: string
  /** Language codes present in multi-language cues, e.g. `['en', 'de']`. Omitted when no multi-language cues are used. */
  languages?: string[]
}
export type RecordingData = {
  events: RecordingEvent[]
  renderOptions: ResolvedRenderOptions
  recordOptions?: RecordOptions
  metadata?: RecordingMetadata
}
export interface IEventRecorder {
  start(): void
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
    translations?: Record<string, CueTranslation>
  ): void
  addCueEnd(reason?: 'auto' | 'wait'): void
  addVideoCueStart(
    name: string,
    assetPath: string | undefined,
    assetHash: string | undefined,
    subtitle?: string,
    translations?: Record<string, VideoCueTranslation>
  ): void
  addAssetStart(
    name: string,
    path: string,
    audio: number,
    fullScreen: boolean
  ): void
  addHideStart(): void
  addHideEnd(): void
  addAutoZoomStart(options?: AutoZoomOptions): void
  addAutoZoomEnd(options?: AutoZoomOptions): void
  /**
   * Registers voice metadata seen during recording.
   * Kept for API compatibility; voice settings are stored per cue event.
   */
  registerVoiceForLang(lang: string, meta: VoiceLanguageMeta): void
  getEvents(): RecordingEvent[]
  writeToFile(dir: string, videoName: string): Promise<void>
}
export declare class EventRecorder implements IEventRecorder {
  private readonly events
  private startTime
  private readonly recordOptions
  private readonly renderOptions
  constructor(renderOptions?: RenderOptions, recordOptions?: RecordOptions)
  registerVoiceForLang(_lang: string, _meta: VoiceLanguageMeta): void
  private normalizeCentering
  start(): void
  private getInnerEventBounds
  private getInputEventBounds
  private relativizeFocusChangeEvent
  addInput(
    subType: InputEvent['subType'],
    elementRectOrEvents: ElementRect | InputEvent['events'] | undefined,
    maybeEvents?: InputEvent['events']
  ): void
  addCueStart(
    text: string,
    name: string,
    cueConfig?: CueConfig,
    translations?: Record<string, CueTranslation>
  ): void
  addCueEnd(reason?: 'auto' | 'wait'): void
  addVideoCueStart(
    name: string,
    assetPath: string | undefined,
    assetHash: string | undefined,
    subtitle?: string,
    translations?: Record<string, VideoCueTranslation>
  ): void
  addAssetStart(
    name: string,
    path: string,
    audio: number,
    fullScreen: boolean
  ): void
  addHideStart(): void
  addHideEnd(): void
  addAutoZoomStart(options?: AutoZoomOptions): void
  addAutoZoomEnd(options?: AutoZoomOptions): void
  getEvents(): RecordingEvent[]
  writeToFile(dir: string, videoName: string): Promise<void>
}
