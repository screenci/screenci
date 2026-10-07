import { describe, expect, it, vi } from 'vitest'
import {
  createPreviewThumbnailDeps,
  extractPreviewThumbnail,
  parseFfmpegDurationSeconds,
  PREVIEW_THUMBNAIL_FILE_NAME,
  uploadPreviewThumbnail,
} from './previewThumbnail.js'

describe('parseFfmpegDurationSeconds', () => {
  it('parses the Duration line', () => {
    expect(
      parseFfmpegDurationSeconds('  Duration: 00:01:02.50, start: 0.000000')
    ).toBe(62.5)
  })

  it('returns null without a Duration line', () => {
    expect(parseFfmpegDurationSeconds('nope')).toBeNull()
  })
})

describe('extractPreviewThumbnail', () => {
  const out = `/tmp/x/${PREVIEW_THUMBNAIL_FILE_NAME}`
  const seekOf = (args: string[]) => args[args.indexOf('-ss') + 1]

  it('takes the frame at 10% of the duration', async () => {
    const runFfmpeg = vi
      .fn()
      .mockResolvedValueOnce('Duration: 00:00:20.00,')
      .mockResolvedValue('')
    const result = await extractPreviewThumbnail('/tmp/x', {
      runFfmpeg,
      hasOutput: async () => true,
    })
    expect(result).toBe(out)
    expect(runFfmpeg).toHaveBeenCalledTimes(2)
    expect(seekOf(runFfmpeg.mock.calls[1]![0])).toBe('2.000')
  })

  it('falls back to the first frame when the seek yields nothing', async () => {
    const runFfmpeg = vi
      .fn()
      .mockResolvedValueOnce('Duration: 00:00:00.04,')
      .mockResolvedValue('')
    const hasOutput = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const result = await extractPreviewThumbnail('/tmp/x', {
      runFfmpeg,
      hasOutput,
    })
    expect(result).toBe(out)
    expect(seekOf(runFfmpeg.mock.calls[2]![0])).toBe('0.000')
  })

  it('uses the first frame when the duration is unknown', async () => {
    const runFfmpeg = vi.fn().mockResolvedValue('')
    await extractPreviewThumbnail('/tmp/x', {
      runFfmpeg,
      hasOutput: async () => true,
    })
    expect(runFfmpeg).toHaveBeenCalledTimes(2)
    expect(seekOf(runFfmpeg.mock.calls[1]![0])).toBe('0.000')
  })

  it('never throws', async () => {
    const result = await extractPreviewThumbnail('/tmp/x', {
      runFfmpeg: () => Promise.reject(new Error('no ffmpeg')),
      hasOutput: async () => false,
    })
    expect(result).toBeNull()
  })
})

describe('uploadPreviewThumbnail', () => {
  const params = {
    apiUrl: 'https://api.test',
    recordingId: 'rec1',
    recordingDir: '/tmp/x',
    credential: { header: 'x-key', value: 'secret' },
  }

  it('PUTs the jpeg to the preview-thumbnail route', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }))
    const ok = await uploadPreviewThumbnail(params, {
      readFile: async () => Buffer.from([1, 2, 3]),
      fetch: fetchFn,
    })
    expect(ok).toBe(true)
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://api.test/cli/upload/rec1/preview-thumbnail')
    expect(init.method).toBe('PUT')
    expect(init.headers['Content-Type']).toBe('image/jpeg')
    expect(init.headers['x-key']).toBe('secret')
  })

  it('returns false without a thumbnail file', async () => {
    const fetchFn = vi.fn()
    const ok = await uploadPreviewThumbnail(params, {
      readFile: () => Promise.reject(new Error('ENOENT')),
      fetch: fetchFn,
    })
    expect(ok).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('is non-fatal when the upload fails', async () => {
    const ok = await uploadPreviewThumbnail(params, {
      readFile: async () => Buffer.from([1]),
      fetch: () => Promise.reject(new Error('network')),
    })
    expect(ok).toBe(false)
  })
})

describe('createPreviewThumbnailDeps', () => {
  it('rejects runFfmpeg with the resolver error instead of spawning', async () => {
    const deps = createPreviewThumbnailDeps(() => {
      throw new Error('ffmpeg binary missing')
    })
    await expect(deps.runFfmpeg(['-i', 'x'])).rejects.toThrow(
      'ffmpeg binary missing'
    )
  })
})
