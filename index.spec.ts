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
      'createAudio',
      'createOverlays',
      'defineConfig',
      'hide',
      'modelTypes',
      'overlayRect',
      'resetZoom',
      'resolveLocaleForLanguage',
      'screenshot',
      'setOverlayCss',
      'speed',
      'time',
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
      'createInitLinkSession',
      'detectPackageManagerFromLockfile',
      'detectPackageManagerFromPackageJson',
      'detectPnpmWorkspace',
      'determinePackageManager',
      'generateConfig',
      'generateExampleVideo',
      'generateIslandReadme',
      'generateIslandTsconfig',
      'generateReactExampleVideo',
      'parsePackageManager',
      'parsePnpmVersionSupport',
      'parseYarnVersionSupport',
      'runCreateScreenciCli',
      'runInit',
      'toIslandPackageName',
    ])
  })
})
