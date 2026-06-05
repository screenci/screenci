import { describe, it } from 'vitest'
import { createAssets } from './asset.js'

describe('createAssets type constraints', () => {
  it('accepts svg assets with durationMs', () => {
    createAssets({
      badge: { path: './badge.svg', durationMs: 1200, fullScreen: false },
    })
  })

  it('accepts png assets with durationMs', () => {
    createAssets({
      badge: { path: './badge.png', durationMs: 1200, fullScreen: false },
    })
  })

  it('accepts mp4 assets with audio', () => {
    createAssets({
      intro: { path: './intro.mp4', audio: 0, fullScreen: true },
    })
  })

  it('accepts mp4 assets without audio', () => {
    createAssets({
      intro: { path: './intro.mp4', fullScreen: true },
    })
  })

  it('rejects svg assets with audio', () => {
    createAssets({
      // @ts-expect-error image assets do not accept audio
      badge: { path: './badge.svg', audio: 0, fullScreen: false },
    })
  })

  it('rejects mp4 assets with durationMs', () => {
    createAssets({
      // @ts-expect-error mp4 assets use natural duration
      intro: { path: './intro.mp4', durationMs: 1200, fullScreen: true },
    })
  })

  it('rejects unsupported extensions', () => {
    createAssets({
      // @ts-expect-error jpg assets are not supported
      photo: { path: './photo.jpg', durationMs: 1200, fullScreen: false },
    })

    createAssets({
      // @ts-expect-error webp assets are not supported
      photo: { path: './photo.webp', durationMs: 1200, fullScreen: false },
    })
  })
})
