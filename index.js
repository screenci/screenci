export { RENDER_OPTIONS_DEFAULTS } from './src/types.js'
// Re-export voices
export {
  voices,
  modelTypes,
  languageRegions,
  isCustomVoiceRef,
} from './src/voices.js'
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
export { createNarration } from './src/cue.js'
export { hide } from './src/hide.js'
export { autoZoom } from './src/autoZoom.js'
export { createAssets } from './src/asset.js'
