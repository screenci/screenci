export { RENDER_OPTIONS_DEFAULTS } from './types.js'

export type {
  AspectRatio,
  FPS,
  Quality,
  RecordOptions,
  RenderOptions,
  ResolvedRenderOptions,
  ResolvedScreenshotRenderOptions,
  ScreenshotOutputFormat,
} from './types.js'

export type { ScreenshotClipRecord, ResolvedClipPadding } from './clip.js'

export { parseKeyCombo, isSingleKeyCombo } from './keyCombo.js'

export type {
  RecordingData,
  RecordingEvent,
  ElementRect,
  VideoStartEvent,
  InputEvent,
  KeyPressEvent,
  FocusChangeEvent,
  MouseMoveEvent,
  MouseDownEvent,
  MouseUpEvent,
  MouseShowEvent,
  MouseHideEvent,
  MouseWaitEvent,
  CueStartEvent,
  CueEndEvent,
  VideoCueStartEvent,
  ImageAssetStartEvent,
  VideoAssetStartEvent,
  StudioAssetStartEvent,
  StudioAudioStartEvent,
  HideStartEvent,
  HideEndEvent,
  SpeedStartEvent,
  SpeedEndEvent,
  TimeStartEvent,
  TimeEndEvent,
  AutoZoomStartEvent,
  AutoZoomEndEvent,
  AssetStartEvent,
  AssetEndEvent,
  OverlayPlacement,
  CueTranslation,
  VideoCueTranslation,
  VideoCueTranslationFile,
  VoiceLanguageMeta,
  RecordingMetadata,
  ScreenshotClip,
  ScreenshotInfo,
} from './events.js'
