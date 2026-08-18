// Re-export all public types
export type {
  AspectRatio,
  FPS,
  Quality,
  RecordUploadPolicy,
  RecordOptions,
  RenderOptions,
  // Hidden for release: the screenshots feature is unfinished. Re-enable by
  // uncommenting these exports (and the ones marked below). The removed docs
  // live in docs/removed/ at the repo root.
  // ScreenshotOutputFormat,
  // ScreenshotRenderOptions,
  ScreenCIConfig,
  ExtendedScreenCIConfig,
  AutoZoomOptions,
  Easing,
  VideoEncoderPreset,
} from './src/types.js'
export type {
  NarrationAudioCleanupOption,
  ResolvedNarrationAudioCleanup,
} from './src/narrationAudioCleanup.js'

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
// Hidden for release: the screenshots feature is unfinished. Re-enable by
// uncommenting. Docs moved to docs/removed/screenshots.md at the repo root.
// export { screenshot } from './src/screenshot.js'
export type {
  ClipTarget,
  ClipRegion,
  ClipOptions,
  // Hidden for release together with screenshot() above.
  // ScreenshotClip,
  // ScreenshotClipRecord,
  ResolvedClipPadding,
} from './src/clip.js'
export type {
  ScreenCIPage,
  ScreenCILocator,
  ScreenCILocatorClickOptions,
  ScreenCILocatorPostClickMoveOptions,
  ScreenCILocatorFillOptions,
  ScreenCILocatorPressSequentiallyOptions,
  ScreenCILocatorCheckOptions,
  ScreenCILocatorHoverOptions,
  ScreenCILocatorSelectTextOptions,
  ScreenCILocatorDragToOptions,
  ScreenCILocatorSelectOptionOptions,
} from './src/types.js'
// Narration is declared per-builder with `video.narration(...)`: an array declares
// blank names owned by the web editor, an object carries code values (still
// editable in the web app). It surfaces through the injected `narration` fixture.
export type { NarrationCue, Cues, TopLevelVoiceConfig } from './src/cue.js'
export type { TimelineOffset } from './src/timelineOffset.js'
export type { LangNarrationOverride } from './src/voiceConfig.js'
export type {
  EachVariant,
  MediaBuilder,
  VideoBuilder,
  LocalizeMode,
  LanguagesArg,
  LanguagesConfig,
  RecordingLocalize,
} from './src/builder.js'
export type { FeatureArg } from './src/declare.js'
export type { VoiceConfig, LocalizeNarrationValue } from './src/localize.js'
export {
  resolveLocaleForLanguage,
  DEFAULT_LANGUAGE_LOCALES,
} from './src/locales.js'
export { hide } from './src/hide.js'
export { redact, unredactAll } from './src/redact.js'
export type { RedactOptions, RedactStyle, RedactHandle } from './src/types.js'
export { speed } from './src/speed.js'
export { time } from './src/time.js'
export { autoZoom } from './src/autoZoom.js'
export { zoomTo, resetZoom } from './src/manualZoom.js'
export { hideNarration, showNarration } from './src/narrationVisibility.js'
export {
  // Hidden for release: narration positioning (moveNarration, resizeNarration)
  // and changing the background mid recording (setBackground) are unfinished.
  // Re-enable by uncommenting these and the related types below. Docs moved to
  // docs/removed/overlay-updates.md at the repo root.
  // moveNarration,
  // resizeNarration,
  resizeRecording,
  hideRecording,
  showRecording,
  // setBackground,
} from './src/overlayUpdates.js'
export type {
  OverlayTransitionOptions,
  // Hidden for release together with moveNarration/setBackground above.
  // MoveNarrationOptions,
  // SetBackgroundInput,
} from './src/overlayUpdates.js'
// Hidden for release together with narration positioning above.
// export type {
//   NarrationCorner,
//   NarrationPosition,
//   NarrationFullScreenFit,
// } from './src/types.js'
export type {
  UpdateTransition,
  // Hidden for release together with narration positioning and setBackground.
  // NarrationUpdateEvent,
  RecordingUpdateEvent,
  // BackgroundUpdateEvent,
} from './src/events.js'
// Per-method defaults of every tracked action option, so the backend/editor can
// tell an override that restates the default from a real change.
export { ACTION_PARAM_DEFAULTS } from './src/actionParams.js'
export type {
  ActionMethod,
  ActionParamRecord,
  ActionParamValue,
} from './src/actionParams.js'
export { MAX_AUDIO_LEVEL } from './src/asset.js'
export type {
  OverlayController,
  OverlayConfig,
  OverlayDuration,
  TsxOverlayConfig,
  HtmlPageOverlayConfig,
  MediaOverlayConfig,
  OverlayConfigFactory,
  OverlayInput,
  OverlayInputOrFactory,
  Overlays,
  OverlayControllerFor,
  OverlayPlacement,
  OverlayClip,
  // Hidden for release: the selected() render-dependency feature is
  // unfinished. Docs moved to docs/removed/selected.md at the repo root.
  // DependencyOverlayInput,
  // DependencyOverlayOptions,
} from './src/asset.js'
export { overlayRect } from './src/overlayRect.js'
export type { OverlayRect, OverlayRectOptions } from './src/overlayRect.js'
// Hidden for release: the background audio feature is unfinished. Re-enable by
// uncommenting (the video.audio() builder method is commented out alongside in
// src/builder.ts). Docs moved to docs/removed/audio.md at the repo root.
// export type {
//   AudioController,
//   AudioConfig,
//   AudioInput,
//   AudioTracks,
// } from './src/audio.js'
export type { ZoomTarget, ZoomTargetPoint } from './src/manualZoom.js'
