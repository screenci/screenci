// Re-export all public types
export type {
  AspectRatio,
  FPS,
  Quality,
  Trace,
  RecordOptions,
  RenderOptions,
  ResolvedRenderOptions,
  ScreenCIConfig,
  ExtendedScreenCIConfig,
  CueConfig,
  AutoZoomOptions,
  Easing,
  PostClickMove,
  ClickBeforeFillOption,
} from './src/types.js'
export { RENDER_OPTIONS_DEFAULTS } from './src/types.js'

// Re-export voices
export {
  voices,
  modelTypes,
  languageRegions,
  isCustomVoiceRef,
} from './src/voices.js'
export type {
  VoiceKey,
  VoiceName,
  VoiceForLang,
  CustomVoiceRef,
  ModelType,
} from './src/voices.js'

// Re-export recording event types
export type {
  RecordingEvent,
  RecordingData,
  ElementRect,
  VideoStartEvent,
  InputEvent,
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
  HideStartEvent,
  HideEndEvent,
  AutoZoomStartEvent,
  AutoZoomEndEvent,
} from './src/events.js'

// Re-export default values
export {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_FPS,
  DEFAULT_QUALITY,
  DEFAULT_TRACE,
  DEFAULT_VIDEO_DIR,
  DEFAULT_VIDEO_OPTIONS,
} from './src/defaults.js'

// Re-export dimension helper
export { getDimensions } from './src/dimensions.js'

// Re-export config function
export { defineConfig } from './src/config.js'

// Re-export video fixture and narration cue
export { video } from './src/video.js'
export type { ScreenCIPage, ScreenCILocator } from './src/types.js'
export { createNarration } from './src/cue.js'
export type {
  CueController,
  Cues,
  TopLevelVoiceConfig,
  LangNarrationOverride,
  CueMapValue,
} from './src/cue.js'
export type {
  CueTranslation,
  VideoCueTranslation,
  VideoCueTranslationFile,
  VoiceLanguageMeta,
} from './src/events.js'
export { hide } from './src/hide.js'
export { autoZoom } from './src/autoZoom.js'
export { createAssets } from './src/asset.js'
export type { AssetController, AssetConfig, Assets } from './src/asset.js'
export type { AssetStartEvent } from './src/events.js'
