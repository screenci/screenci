import { describe, expect, it, vi } from 'vitest'
import { notifyPreviewRecordingStarted } from './previewStarted.js'
import { secretCredential } from './anonSession.js'

const NOTICE = {
  apiUrl: 'https://api.example',
  credential: secretCredential('secret-1'),
  projectName: 'Demo',
}

describe('notifyPreviewRecordingStarted', () => {
  it('POSTs the project and video names with the credential header', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'))
    await notifyPreviewRecordingStarted(
      NOTICE,
      ['Login', 'Checkout'],
      fetchImpl as unknown as typeof fetch
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://api.example/cli/preview-recording-started')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-ScreenCI-Secret']).toBe(
      'secret-1'
    )
    expect(JSON.parse(init.body as string)).toEqual({
      projectName: 'Demo',
      videoNames: ['Login', 'Checkout'],
    })
  })

  it('does nothing for an empty video list', async () => {
    const fetchImpl = vi.fn()
    await notifyPreviewRecordingStarted(
      NOTICE,
      [],
      fetchImpl as unknown as typeof fetch
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('swallows network failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline')
    })
    await expect(
      notifyPreviewRecordingStarted(
        NOTICE,
        ['Login'],
        fetchImpl as unknown as typeof fetch
      )
    ).resolves.toBeUndefined()
  })
})
