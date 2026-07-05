import { describe, it, expectTypeOf } from 'vitest'
import {
  createAudio,
  buildStudioAudioTracks,
  type AudioController,
} from './audio.js'

describe('createAudio type constraints', () => {
  it('accepts a bare file path string', () => {
    createAudio({ theme: './music.mp3' })
  })

  it('accepts a config object with volume and repeat', () => {
    createAudio({
      theme: { path: './music.mp3', volume: 0.3, repeat: true },
    })
  })

  it('maps each key to an AudioController', () => {
    const audio = createAudio({ theme: './music.mp3' })
    expectTypeOf(audio.theme).toEqualTypeOf<AudioController>()
    expectTypeOf(audio.theme.start).toEqualTypeOf<() => Promise<void>>()
    expectTypeOf(audio.theme.end).toEqualTypeOf<() => Promise<void>>()
  })

  it('rejects a non-numeric volume', () => {
    createAudio({
      // @ts-expect-error volume must be a number
      theme: { path: './music.mp3', volume: 'loud' },
    })
  })

  it('rejects an unknown config field', () => {
    createAudio({
      // @ts-expect-error placement is not an audio option
      theme: { path: './music.mp3', x: 0.5 },
    })
  })
})

describe('buildStudioAudioTracks type constraints', () => {
  // Studio-managed audio names are typed to the exact names by the
  // `video.audio(editable([...]))` builder (see index.test-d.ts). The
  // internal helper returns a generic record of AudioController controllers.
  it('returns a record of AudioController controllers', () => {
    const music = buildStudioAudioTracks(['theme', 'sting'])
    expectTypeOf(music).toEqualTypeOf<Record<string, AudioController>>()
    expectTypeOf(music.theme).toEqualTypeOf<AudioController>()
  })
})
