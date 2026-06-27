// Re-export all public types
export type {
  AspectRatio,
  FPS,
  Quality,
  RecordUploadPolicy,
  RecordOptions,
  RenderOptions,
  ScreenshotOutputFormat,
  ScreenshotRenderOptions,
  ScreenCIConfig,
  ExtendedScreenCIConfig,
  AutoZoomOptions,
  Easing,
  VideoEncoderPreset,
} from './src/types.js'

// Re-export voices
export { voices, modelTypes } from './src/voices.js'
export type {
  VoiceKey,
  ModelVoiceKey,
  ElevenLabsVoiceKey,
  CustomVoiceRef,
  ModelType,
} from './src/voices.js'

// Re-export config function
export { defineConfig } from './src/config.js'

// Re-export video fixture and narration cue
export { video } from './src/video.js'
export { screenshot } from './src/screenshot.js'
export type {
  CropTarget,
  CropRegion,
  CropOptions,
  ScreenshotCrop,
  ScreenshotCropRecord,
  ResolvedCropPadding,
} from './src/crop.js'
export type { ScreenCIPage, ScreenCILocator } from './src/types.js'
// Narration is declared per-builder with `video.narration(...)`: an array of
// names is Studio-owned, an object carries code values. It surfaces through the
// injected `narration` fixture.
export type { NarrationCue, Cues, TopLevelVoiceConfig } from './src/cue.js'
export type { LangNarrationOverride } from './src/voiceConfig.js'
export type {
  EachVariant,
  MediaBuilder,
  VideoBuilder,
  LocalizeMode,
  LanguagesArg,
  RecordingLocalize,
} from './src/builder.js'
export type { FeatureArg } from './src/declare.js'
export type { VoiceConfig, LocalizeNarrationValue } from './src/localize.js'
export {
  resolveLocaleForLanguage,
  DEFAULT_LANGUAGE_LOCALES,
} from './src/locales.js'
export { hide } from './src/hide.js'
export { speed } from './src/speed.js'
export { time } from './src/time.js'
export { autoZoom } from './src/autoZoom.js'
export { zoomTo, resetZoom } from './src/manualZoom.js'
export {
  resizeRecording,
  resetRecordingSize,
  type ResizeRecordingOptions,
} from './src/recordingSize.js'
export { hideNarration, showNarration } from './src/narrationVisibility.js'
export { setOverlayCss, MAX_AUDIO_LEVEL, selected } from './src/asset.js'
export type {
  OverlayController,
  OverlayConfig,
  OverlayConfigFactory,
  OverlayInput,
  OverlayInputOrFactory,
  Overlays,
  OverlayControllerFor,
  ReactElementLike,
  OverlayPlacement,
  DependencyOverlayInput,
  DependencyOverlayOptions,
} from './src/asset.js'
export { overlayRect } from './src/overlayRect.js'
export type { OverlayRect, OverlayRectOptions } from './src/overlayRect.js'
export type {
  AudioController,
  AudioConfig,
  AudioInput,
  AudioTracks,
} from './src/audio.js'
export type { ZoomTarget, ZoomTargetPoint } from './src/manualZoom.js'
