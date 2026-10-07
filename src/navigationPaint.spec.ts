import { describe, expect, it, vi } from 'vitest'
import {
  NETWORK_IDLE_TIMEOUT_MS,
  waitForNavigationPaint,
  type PaintWaitPage,
} from './navigationPaint.js'

function fakePage(overrides: Partial<PaintWaitPage> = {}): PaintWaitPage & {
  evaluate: ReturnType<typeof vi.fn>
  waitForLoadState: ReturnType<typeof vi.fn>
} {
  return {
    evaluate: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    ...overrides,
  } as never
}

describe('waitForNavigationPaint', () => {
  it('waits for the in-page paint script, then network idle with a cap', async () => {
    const order: string[] = []
    const page = fakePage({
      evaluate: vi.fn(async () => {
        order.push('paint')
      }),
      waitForLoadState: vi.fn(async (state: string) => {
        order.push(state)
      }),
    })
    await waitForNavigationPaint(page, { waitForNetworkIdle: true })
    expect(order).toEqual(['paint', 'networkidle'])
    expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle', {
      timeout: NETWORK_IDLE_TIMEOUT_MS,
    })
  })

  it('proceeds when network idle never arrives', async () => {
    const page = fakePage({
      waitForLoadState: vi.fn(async () => {
        throw new Error('Timeout 2000ms exceeded')
      }),
    })
    await expect(
      waitForNavigationPaint(page, { waitForNetworkIdle: true })
    ).resolves.toBeUndefined()
  })

  it('proceeds when the paint script throws (detached frame)', async () => {
    const page = fakePage({
      evaluate: vi.fn(async () => {
        throw new Error('Execution context was destroyed')
      }),
    })
    await expect(
      waitForNavigationPaint(page, { waitForNetworkIdle: true })
    ).resolves.toBeUndefined()
    expect(page.waitForLoadState).toHaveBeenCalled()
  })

  it('gives up on the paint signal after the paint timeout', async () => {
    vi.useFakeTimers()
    try {
      const page = fakePage({
        evaluate: vi.fn(() => new Promise<void>(() => {})),
      })
      const done = waitForNavigationPaint(page, {
        paintTimeoutMs: 100,
        waitForNetworkIdle: true,
      })
      await vi.advanceTimersByTimeAsync(99)
      expect(page.waitForLoadState).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await done
      expect(page.waitForLoadState).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
  it('waits only for paint by default (visible navigations)', async () => {
    const page = fakePage()
    await waitForNavigationPaint(page)
    expect(page.evaluate).toHaveBeenCalledTimes(1)
    expect(page.waitForLoadState).not.toHaveBeenCalled()
  })
})
