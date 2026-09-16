import { describe, expect, it, vi } from 'vitest'
import { anonCredential, secretCredential } from './anonSession.js'
import { notifyPrPreviewComplete, parsePullRequestUrl } from './prPreview.js'

describe('parsePullRequestUrl', () => {
  it('parses the html URL GitHub Actions exposes', () => {
    expect(
      parsePullRequestUrl('https://github.com/screenci/screenci/pull/42')
    ).toEqual({
      owner: 'screenci',
      repo: 'screenci',
      number: 42,
      url: 'https://github.com/screenci/screenci/pull/42',
    })
  })

  it('canonicalizes trailing paths, queries, and www', () => {
    expect(
      parsePullRequestUrl(
        ' https://www.github.com/acme/app/pull/7/files?diff=split#top '
      )?.url
    ).toBe('https://github.com/acme/app/pull/7')
  })

  it('rejects anything that is not a GitHub pull request', () => {
    expect(parsePullRequestUrl('https://github.com/acme/app')).toBeNull()
    expect(
      parsePullRequestUrl('https://github.com/acme/app/issues/7')
    ).toBeNull()
    expect(parsePullRequestUrl('https://gitlab.com/acme/app/pull/7')).toBeNull()
    expect(parsePullRequestUrl('https://github.com/acme/app/pull/0')).toBeNull()
    expect(parsePullRequestUrl('https://github.com/acme/app/pull/x')).toBeNull()
    expect(parsePullRequestUrl('not a url')).toBeNull()
    expect(parsePullRequestUrl('ftp://github.com/acme/app/pull/7')).toBeNull()
  })
})

describe('notifyPrPreviewComplete', () => {
  const logger = { info: vi.fn(), warn: vi.fn() }

  it('posts the pull request, record id, and failure flag with the secret', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }))
    const ok = await notifyPrPreviewComplete(
      {
        apiUrl: 'https://api.example.com',
        credential: secretCredential('sk'),
        projectName: 'demo',
        prUrl: 'https://github.com/acme/app/pull/7',
        recordId: 'rec-1',
        recordingFailed: false,
        verbose: false,
      },
      { fetchFn: fetchFn as unknown as typeof fetch, logger }
    )
    expect(ok).toBe(true)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://api.example.com/cli/pr-preview/complete')
    expect(JSON.parse(String(init.body))).toEqual({
      projectName: 'demo',
      prUrl: 'https://github.com/acme/app/pull/7',
      recordId: 'rec-1',
      recordingFailed: false,
    })
    expect((init.headers as Record<string, string>)['X-ScreenCI-Secret']).toBe(
      'sk'
    )
  })

  it('omits the record id when nothing was uploaded', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }))
    await notifyPrPreviewComplete(
      {
        apiUrl: 'https://api.example.com',
        credential: secretCredential('sk'),
        projectName: 'demo',
        prUrl: 'https://github.com/acme/app/pull/7',
        recordId: null,
        recordingFailed: true,
        verbose: false,
      },
      { fetchFn: fetchFn as unknown as typeof fetch, logger }
    )
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      projectName: 'demo',
      prUrl: 'https://github.com/acme/app/pull/7',
      recordingFailed: true,
    })
  })

  it('warns and returns false on a non-2xx answer or a network error', async () => {
    const warn = vi.fn()
    const failing = vi.fn(async () => new Response('nope', { status: 400 }))
    expect(
      await notifyPrPreviewComplete(
        {
          apiUrl: 'https://api.example.com',
          credential: secretCredential('sk'),
          projectName: 'demo',
          prUrl: 'https://github.com/acme/app/pull/7',
          recordId: 'rec-1',
          recordingFailed: false,
          verbose: false,
        },
        {
          fetchFn: failing as unknown as typeof fetch,
          logger: { info: vi.fn(), warn },
        }
      )
    ).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('400'))

    const throwing = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(
      await notifyPrPreviewComplete(
        {
          apiUrl: 'https://api.example.com',
          credential: secretCredential('sk'),
          projectName: 'demo',
          prUrl: 'https://github.com/acme/app/pull/7',
          recordId: 'rec-1',
          recordingFailed: false,
          verbose: false,
        },
        {
          fetchFn: throwing as unknown as typeof fetch,
          logger: { info: vi.fn(), warn },
        }
      )
    ).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('offline'))
  })

  it('skips the report without a project secret', async () => {
    const fetchFn = vi.fn()
    const warn = vi.fn()
    expect(
      await notifyPrPreviewComplete(
        {
          apiUrl: 'https://api.example.com',
          credential: anonCredential('anon'),
          projectName: 'demo',
          prUrl: 'https://github.com/acme/app/pull/7',
          recordId: 'rec-1',
          recordingFailed: false,
          verbose: false,
        },
        {
          fetchFn: fetchFn as unknown as typeof fetch,
          logger: { info: vi.fn(), warn },
        }
      )
    ).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('SCREENCI_SECRET')
    )
  })
})
