import { describe, expect, it } from 'vitest'
import * as screenci from './index.js'
import * as recordingModule from './src/recording.js'
import * as voicesModule from './src/voices.js'

describe('public api surface', () => {
  it('only exports public runtime api from the root entrypoint', () => {
    expect(Object.keys(screenci).sort()).toEqual([
      'autoZoom',
      'createAssets',
      'createNarration',
      'defineConfig',
      'hide',
      'languageRegions',
      'modelTypes',
      'resetZoom',
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
      'languageRegions',
      'modelTypes',
      'voices',
    ])
  })
})
