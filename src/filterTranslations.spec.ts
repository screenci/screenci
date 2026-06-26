import { describe, it, expect } from 'vitest'
import {
  filterEventTranslationsToLanguage,
  type RecordingEvent,
} from './events.js'

const ev = (e: unknown): RecordingEvent => e as RecordingEvent

describe('filterEventTranslationsToLanguage', () => {
  it('folds an asset translation into the top-level fields and drops the map', () => {
    const result = filterEventTranslationsToLanguage(
      ev({
        type: 'assetStart',
        timeMs: 100,
        name: 'logo',
        kind: 'image',
        path: './logo.png',
        fileHash: 'shared-hash',
        fullScreen: false,
        translations: {
          fi: { path: './logo.fi.png', fileHash: 'fi-hash' },
          en: { path: './logo.en.png', fileHash: 'en-hash' },
        },
      }),
      'fi'
    )
    expect(result).toEqual({
      type: 'assetStart',
      timeMs: 100,
      name: 'logo',
      kind: 'image',
      path: './logo.fi.png',
      fileHash: 'fi-hash',
      fullScreen: false,
    })
    expect('translations' in result).toBe(false)
  })

  it('keeps the shared top-level fields when the language has no override', () => {
    const result = filterEventTranslationsToLanguage(
      ev({
        type: 'audioStart',
        timeMs: 0,
        name: 'theme',
        path: './theme.mp3',
        volume: 1,
        repeat: false,
        translations: { fi: { path: './theme.fi.mp3' } },
      }),
      'de'
    )
    expect(result).toEqual({
      type: 'audioStart',
      timeMs: 0,
      name: 'theme',
      path: './theme.mp3',
      volume: 1,
      repeat: false,
    })
  })

  it('folds an audio translation, overriding only defined fields', () => {
    const result = filterEventTranslationsToLanguage(
      ev({
        type: 'audioStart',
        timeMs: 0,
        name: 'theme',
        path: './theme.mp3',
        volume: 1,
        repeat: false,
        translations: { fi: { path: './theme.fi.mp3', volume: 0.5 } },
      }),
      'fi'
    )
    expect(result).toMatchObject({
      path: './theme.fi.mp3',
      volume: 0.5,
      repeat: false,
    })
  })

  it('still narrows narration cue translations to a single-language map', () => {
    const result = filterEventTranslationsToLanguage(
      ev({
        type: 'cueStart',
        timeMs: 0,
        name: 'intro',
        translations: {
          fi: { text: 'Moi', voice: 'Sophie' },
          en: { text: 'Hi', voice: 'Sophie' },
        },
      }),
      'fi'
    )
    expect((result as { translations: unknown }).translations).toEqual({
      fi: { text: 'Moi', voice: 'Sophie' },
    })
  })

  it('returns events without translations unchanged', () => {
    const asset = ev({
      type: 'assetStart',
      timeMs: 0,
      name: 'logo',
      kind: 'image',
      path: './logo.png',
      fullScreen: false,
    })
    expect(filterEventTranslationsToLanguage(asset, 'fi')).toBe(asset)
  })
})
