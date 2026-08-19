import { describe, expect, it, vi } from 'vitest'
import {
  downloadExportOutputs,
  exportExitCode,
  exportFileName,
  pollExportRenders,
  type ExportInfoResponse,
  type ExportRenderResult,
} from './src/exportRun'

function infoResponse(
  entries: Record<
    string,
    Record<
      string,
      {
        status: 'finished' | 'rendering' | 'failed'
        failureMessage?: string
      }
    >
  >
): ExportInfoResponse {
  return {
    videos: Object.fromEntries(
      Object.entries(entries).map(([videoName, languages]) => [
        videoName,
        {
          videoId: `vid-${videoName}`,
          languages: Object.fromEntries(
            Object.entries(languages).map(([language, latest]) => [
              language,
              {
                latestRecord: {
                  ...latest,
                  ...(latest.status === 'finished' && {
                    download: {
                      video: `https://api/dl/${videoName}/${language}/video`,
                      screenshot: `https://api/dl/${videoName}/${language}/screenshot`,
                    },
                  }),
                },
              },
            ])
          ),
        },
      ])
    ),
  }
}

describe('pollExportRenders', () => {
  it('polls until every language reports a terminal status', async () => {
    const responses = [
      infoResponse({ Login: { en: { status: 'rendering' } } }),
      infoResponse({
        Login: { en: { status: 'finished' }, fi: { status: 'finished' } },
      }),
    ]
    let call = 0
    const sleep = vi.fn(async () => {})
    const results = await pollExportRenders({
      targets: [{ recordId: 'rec_1', videoNames: ['Login'] }],
      intervalMs: 5000,
      maxAttempts: 10,
      deps: {
        fetchInfo: async () => responses[Math.min(call++, 1)]!,
        sleep,
        log: () => {},
      },
    })
    expect(sleep).toHaveBeenCalledWith(5000)
    expect(
      results.map((r) => `${r.videoName}/${r.language}/${r.status}`)
    ).toEqual(['Login/en/finished', 'Login/fi/finished'])
    expect(results[0]?.downloadUrl).toBe('https://api/dl/Login/en/video')
  })

  it('reports failures with their message', async () => {
    const results = await pollExportRenders({
      targets: [{ recordId: 'rec_1', videoNames: ['Login'] }],
      intervalMs: 1,
      maxAttempts: 2,
      deps: {
        fetchInfo: async () =>
          infoResponse({
            Login: {
              en: { status: 'failed', failureMessage: 'Render exploded' },
            },
          }),
        sleep: async () => {},
        log: () => {},
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      status: 'failed',
      failureMessage: 'Render exploded',
    })
  })

  it('restricts the watched languages to the requested filter', async () => {
    const results = await pollExportRenders({
      targets: [{ recordId: 'rec_1', videoNames: ['Login'] }],
      languages: ['fi'],
      intervalMs: 1,
      maxAttempts: 3,
      deps: {
        fetchInfo: async () =>
          infoResponse({
            Login: { en: { status: 'rendering' }, fi: { status: 'finished' } },
          }),
        sleep: async () => {},
        log: () => {},
      },
    })
    expect(results).toEqual([
      expect.objectContaining({ language: 'fi', status: 'finished' }),
    ])
  })

  it('times out a video that never reports a render', async () => {
    const results = await pollExportRenders({
      targets: [{ recordId: 'rec_1', videoNames: ['Login'] }],
      intervalMs: 1,
      maxAttempts: 3,
      deps: {
        fetchInfo: async () => ({ videos: {} }),
        sleep: async () => {},
        log: () => {},
      },
    })
    expect(results).toEqual([
      expect.objectContaining({ videoName: 'Login', status: 'timeout' }),
    ])
  })
})

describe('exportFileName', () => {
  it('sanitizes the title and appends language and extension', () => {
    expect(exportFileName('Login flow', 'en', 'mp4')).toBe(
      `${'Login flow'.replace(/[^a-zA-Z0-9 _-]/g, '')}.en.mp4`.replace(/^/, '')
    )
    // Path separators never leak into the file name.
    expect(exportFileName('a/b', 'en', 'mp4')).not.toContain('/')
  })
})

function finishedResult(
  videoName: string,
  language = 'en'
): ExportRenderResult {
  return {
    videoName,
    language,
    status: 'finished',
    downloadUrl: `https://api/dl/${videoName}/${language}/video`,
    screenshotUrl: `https://api/dl/${videoName}/${language}/screenshot`,
  }
}

describe('downloadExportOutputs', () => {
  it('downloads each finished render into the output directory', async () => {
    const written = new Map<string, Uint8Array>()
    const downloads = await downloadExportOutputs({
      results: [finishedResult('Login'), finishedResult('Signup')],
      outDir: '/exports',
      deps: {
        fetchFn: async () => ({
          ok: true,
          status: 200,
          arrayBuffer: async () => new TextEncoder().encode('bytes').buffer,
        }),
        mkdir: async () => {},
        writeFile: async (path, data) => {
          written.set(path, data)
        },
      },
    })
    expect(downloads.map((d) => d.filePath)).toEqual([
      expect.stringContaining('Login.en.mp4'),
      expect.stringContaining('Signup.en.mp4'),
    ])
    expect(written.size).toBe(2)
  })

  it('falls back to the screenshot URL when the video URL 404s', async () => {
    const downloads = await downloadExportOutputs({
      results: [finishedResult('Shot')],
      outDir: '/exports',
      deps: {
        fetchFn: async (url) =>
          url.endsWith('/video')
            ? {
                ok: false,
                status: 404,
                arrayBuffer: async () => new ArrayBuffer(0),
              }
            : {
                ok: true,
                status: 200,
                arrayBuffer: async () => new ArrayBuffer(1),
              },
        mkdir: async () => {},
        writeFile: async () => {},
      },
    })
    expect(downloads[0]?.filePath).toContain('Shot.en.png')
  })

  it('reports a failed download without throwing', async () => {
    const downloads = await downloadExportOutputs({
      results: [finishedResult('Login')],
      outDir: '/exports',
      deps: {
        fetchFn: async () => ({
          ok: false,
          status: 500,
          arrayBuffer: async () => new ArrayBuffer(0),
        }),
        mkdir: async () => {},
        writeFile: async () => {},
      },
    })
    expect(downloads[0]).toMatchObject({ filePath: null })
    expect(downloads[0]?.error).toContain('500')
  })
})

describe('exportExitCode', () => {
  it('is 0 only when everything finished and downloaded', () => {
    const results = [finishedResult('Login')]
    expect(
      exportExitCode(results, [
        { videoName: 'Login', language: 'en', filePath: '/e/Login.en.mp4' },
      ])
    ).toBe(0)
  })

  it('is 1 on failure, timeout, empty results, or a failed download', () => {
    expect(exportExitCode([], [])).toBe(1)
    expect(
      exportExitCode([{ ...finishedResult('Login'), status: 'failed' }], [])
    ).toBe(1)
    expect(
      exportExitCode(
        [finishedResult('Login')],
        [{ videoName: 'Login', language: 'en', filePath: null }]
      )
    ).toBe(1)
  })
})
