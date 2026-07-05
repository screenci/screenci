import { describe, expect, it } from 'vitest'
import * as screenci from './index.js'
import * as initModule from './src/init.js'
import * as recordingModule from './src/recording.js'
import * as voicesModule from './src/voices.js'

describe('public api surface', () => {
  it('only exports public runtime api from the root entrypoint', () => {
    expect(Object.keys(screenci).sort()).toEqual([
      'DEFAULT_LANGUAGE_LOCALES',
      'MAX_AUDIO_LEVEL',
      'autoZoom',
      'defineConfig',
      'hide',
      'hideNarration',
      'modelTypes',
      'overlayRect',
      'redact',
      'resetRecordingSize',
      'resetZoom',
      'resizeRecording',
      'resolveLocaleForLanguage',
      'screenshot',
      'selected',
      'showNarration',
      'speed',
      'studio',
      'time',
      'unredactAll',
      'video',
      'voices',
      'zoomTo',
    ])
  })

  it('only exports runtime recording helpers from the recording entrypoint', () => {
    expect(Object.keys(recordingModule).sort()).toEqual([
      'RENDER_OPTIONS_DEFAULTS',
    ])
  })

  it('only exports public runtime voice helpers from the voices entrypoint', () => {
    expect(Object.keys(voicesModule).sort()).toEqual([
      'modelTypes',
      'supportedLanguages',
      'voices',
    ])
  })

  it('only exports the supported init helpers from the init entrypoint', () => {
    expect(Object.keys(initModule).sort()).toEqual([
      'detectPackageManagerFromLockfile',
      'detectPackageManagerFromPackageJson',
      'detectPnpmWorkspace',
      'determinePackageManager',
      'generateConfig',
      'generateExampleScreenshot',
      'generateExampleVideo',
      'generateGitignore',
      'generateIslandReadme',
      'generateIslandTsconfig',
      'generateReactExampleScreenshot',
      'generateRingOverlayHtml',
      'generateRingOverlayTsx',
      'initToggleOptionsFromCommander',
      'parsePackageManager',
      'parsePnpmVersionSupport',
      'parseYarnVersionSupport',
      'registerInitToggleOptions',
      'resolveBundledLogoPath',
      'runCreateScreenciCli',
      'runInit',
      'setUpInitSecret',
      'toIslandPackageName',
    ])
  })
})
