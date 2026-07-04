import { describe, it, expect, vi } from 'vitest'
import type { Page } from '@playwright/test'
import {
  DISABLE_ANIMATIONS_CSS,
  installAnimationDisabling,
  resolveDisableAnimations,
} from './disableAnimations.js'

describe('resolveDisableAnimations', () => {
  it('defaults to true for screenshots', () => {
    expect(resolveDisableAnimations(undefined, 'screenshot')).toBe(true)
  })

  it('defaults to false for video', () => {
    expect(resolveDisableAnimations(undefined, 'video')).toBe(false)
  })

  it('honors an explicit false override for screenshots', () => {
    expect(resolveDisableAnimations(false, 'screenshot')).toBe(false)
  })

  it('honors an explicit true override for video', () => {
    expect(resolveDisableAnimations(true, 'video')).toBe(true)
  })
})

describe('installAnimationDisabling', () => {
  it('registers an init script carrying the disabling CSS', async () => {
    const addInitScript = vi.fn().mockResolvedValue(undefined)
    const page = { addInitScript } as unknown as Page

    await installAnimationDisabling(page)

    expect(addInitScript).toHaveBeenCalledTimes(1)
    const [, arg] = addInitScript.mock.calls[0]
    expect(arg).toBe(DISABLE_ANIMATIONS_CSS)
  })

  it('injects a <style> tag when the registered script runs', async () => {
    let registered: ((css: string) => void) | undefined
    const addInitScript = vi
      .fn()
      .mockImplementation((fn: (css: string) => void) => {
        registered = fn
        return Promise.resolve(undefined)
      })
    const page = { addInitScript } as unknown as Page

    await installAnimationDisabling(page)

    // Simulate the browser running the init script against a fresh document.
    const appended: HTMLStyleElement[] = []
    const fakeDocument = {
      head: {
        appendChild: (node: HTMLStyleElement) => appended.push(node),
      },
      createElement: () => {
        const attrs: Record<string, string> = {}
        return {
          setAttribute: (name: string, value: string) => {
            attrs[name] = value
          },
          getAttribute: (name: string) => attrs[name],
          set textContent(value: string) {
            ;(this as { _text?: string })._text = value
          },
          get textContent() {
            return (this as { _text?: string })._text ?? ''
          },
        } as unknown as HTMLStyleElement
      },
    }
    vi.stubGlobal('document', fakeDocument)
    try {
      registered?.(DISABLE_ANIMATIONS_CSS)
    } finally {
      vi.unstubAllGlobals()
    }

    expect(appended).toHaveLength(1)
    expect(appended[0].getAttribute('data-screenci-disable-animations')).toBe(
      ''
    )
    expect(appended[0].textContent).toBe(DISABLE_ANIMATIONS_CSS)
  })
})
