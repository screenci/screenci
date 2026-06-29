import { describe, it, expect, vi } from 'vitest'
import {
  maybeExtractVoiceSampleAudio,
  MAX_VOICE_SAMPLE_BYTES,
} from './voiceSampleAudio.js'

function stubDeps(outputBytes: number) {
  return {
    runFfmpeg: vi.fn().mockResolvedValue(undefined),
    makeTempDir: vi.fn().mockResolvedValue('/tmp/screenci-voice-test'),
    readOutput: vi.fn().mockResolvedValue(Buffer.alloc(outputBytes, 1)),
    removeDir: vi.fn().mockResolvedValue(undefined),
  }
}

describe('maybeExtractVoiceSampleAudio', () => {
  it('passes through an audio file within the size limit (no ffmpeg)', async () => {
    const deps = stubDeps(0)
    const result = await maybeExtractVoiceSampleAudio(
      '/abs/sample.mp3',
      1_000_000,
      deps
    )
    expect(result).toBeNull()
    expect(deps.runFfmpeg).not.toHaveBeenCalled()
  })

  it('extracts MP3 audio from a video container', async () => {
    const deps = stubDeps(400_000)
    const result = await maybeExtractVoiceSampleAudio(
      '/abs/pitch.mov',
      21_000_000,
      deps
    )
    expect(result).toEqual({
      buffer: expect.any(Buffer),
      contentType: 'audio/mpeg',
      extension: '.mp3',
    })
    expect(result?.buffer.byteLength).toBe(400_000)
    const args = deps.runFfmpeg.mock.calls[0][0] as string[]
    expect(args).toContain('/abs/pitch.mov')
    expect(args).toContain('-vn')
    expect(args[args.length - 1]).toMatch(/\.mp3$/)
    expect(deps.removeDir).toHaveBeenCalledWith('/tmp/screenci-voice-test')
  })

  it('uses reproducible ffmpeg flags so the upload hash is stable', async () => {
    const deps = stubDeps(400_000)
    await maybeExtractVoiceSampleAudio('/abs/pitch.mov', 21_000_000, deps)
    const args = deps.runFfmpeg.mock.calls[0][0] as string[]
    // -bitexact (no version string) + stripped metadata keep the bytes stable.
    expect(args).toContain('-bitexact')
    expect(args.join(' ')).toContain('-map_metadata -1')
  })

  it('transcodes an oversized audio file even when not a video', async () => {
    const deps = stubDeps(500_000)
    const result = await maybeExtractVoiceSampleAudio(
      '/abs/long.wav',
      MAX_VOICE_SAMPLE_BYTES + 1,
      deps
    )
    expect(result?.contentType).toBe('audio/mpeg')
    expect(deps.runFfmpeg).toHaveBeenCalledOnce()
  })

  it('is case-insensitive on the video extension', async () => {
    const deps = stubDeps(400_000)
    await maybeExtractVoiceSampleAudio('/abs/CLIP.MOV', 1_000, deps)
    expect(deps.runFfmpeg).toHaveBeenCalledOnce()
  })

  it('throws when the extracted audio is still over the limit', async () => {
    const deps = stubDeps(MAX_VOICE_SAMPLE_BYTES + 1)
    await expect(
      maybeExtractVoiceSampleAudio('/abs/huge.mov', 999_000_000, deps)
    ).rejects.toThrow(/still too large after extraction/)
    expect(deps.removeDir).toHaveBeenCalled()
  })
})
