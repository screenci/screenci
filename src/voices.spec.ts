import { describe, it, expect } from 'vitest'
import { voices } from './voices.js'
import { isCustomVoiceRef } from './customVoiceRef.js'

describe('voices.elevenlabs', () => {
  it('builds a provider voice key from a voiceId', () => {
    expect(voices.elevenlabs({ voiceId: 'abc123' })).toBe('elevenlabs:abc123')
  })

  it('builds a custom voice ref from a local sample path', () => {
    const ref = voices.elevenlabs({ path: './my-voice.mp3' })
    expect(ref).toEqual({ path: './my-voice.mp3' })
    expect(isCustomVoiceRef(ref)).toBe(true)
  })
})
