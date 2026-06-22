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
// `createNarration` / `createStudioNarration` are no longer part of the public
// API. Declare narration with `video.localize({ narration, voice })` instead;
// the voice is co-located in the localize spec. The functions remain internal,
// powering the localize narration markers.
export type { NarrationCue, Cues, TopLevelVoiceConfig } from './src/cue.js'
export type { LangNarrationOverride } from './src/voiceConfig.js'
export type { EachVariant, VideoBuilder } from './src/builder.js'
export type {
  LocalizeSpec,
  LocalizeMode,
  LocalizeVoiceSpec,
  LocalizeStudioSpec,
  NarrationByLang,
  TextByLang,
  VoiceConfig,
  LocalizeNarrationValue,
} from './src/localize.js'
export {
  resolveLocaleForLanguage,
  DEFAULT_LANGUAGE_LOCALES,
} from './src/locales.js'
export { isStudioRenderOptions } from './src/studio.js'
export type { StudioRenderOptionsSentinel } from './src/studio.js'
export { hide } from './src/hide.js'
export { speed } from './src/speed.js'
export { time } from './src/time.js'
export { autoZoom } from './src/autoZoom.js'
export { zoomTo, resetZoom } from './src/manualZoom.js'
export {
  createOverlays,
  createStudioOverlays,
  setOverlayCss,
  MAX_AUDIO_LEVEL,
} from './src/asset.js'
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
} from './src/asset.js'
export { overlayRect } from './src/overlayRect.js'
export type { OverlayRect, OverlayRectOptions } from './src/overlayRect.js'
export { createAudio, createStudioAudio } from './src/audio.js'
export type {
  AudioController,
  AudioConfig,
  AudioInput,
  AudioTracks,
} from './src/audio.js'
export type { ZoomTarget, ZoomTargetPoint } from './src/manualZoom.js'
