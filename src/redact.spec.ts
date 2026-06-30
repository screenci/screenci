import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Locator, Page } from '@playwright/test'
import {
  DEFAULT_REDACT_RADIUS,
  DEFAULT_REDACT_SHADOW,
  ensureRedactControllerInstalled,
  redact,
  resolveRedactStyle,
  unredactAll,
} from './redact.js'
import {
  getRuntimeRedactState,
  resetRedactRuntimeState,
  setRuntimePage,
} from './runtimeContext.js'

type FakePage = {
  addInitScript: ReturnType<typeof vi.fn>
  evaluate: ReturnType<typeof vi.fn>
}

type FakeLocator = {
  page: () => FakePage
  first: () => { waitFor: ReturnType<typeof vi.fn> }
  evaluateAll: ReturnType<typeof vi.fn>
}

function makeFakePage(): FakePage {
  return {
    addInitScript: vi.fn(async () => {}),
    evaluate: vi.fn(async () => {}),
  }
}

function makeFakeLocator(page: FakePage): FakeLocator {
  return {
    page: () => page,
    first: () => ({ waitFor: vi.fn(async () => {}) }),
    evaluateAll: vi.fn(async () => {}),
  }
}

beforeEach(() => {
  resetRedactRuntimeState()
})

afterEach(() => {
  resetRedactRuntimeState()
  setRuntimePage(null)
})

describe('resolveRedactStyle', () => {
  it('defaults to an auto-colored panel (no fixed color)', () => {
    expect(resolveRedactStyle()).toEqual({
      color: null,
      radiusPx: DEFAULT_REDACT_RADIUS,
      shadow: DEFAULT_REDACT_SHADOW,
      css: null,
    })
  })

  it('uses a fixed color when one is given', () => {
    expect(
      resolveRedactStyle({ style: { color: '#111', radius: 24 } })
    ).toEqual({
      color: '#111',
      radiusPx: 24,
      shadow: DEFAULT_REDACT_SHADOW,
      css: null,
    })
  })

  it('disables the shadow when shadow is false', () => {
    expect(resolveRedactStyle({ style: { shadow: false } }).shadow).toBeNull()
  })

  it('passes through custom css', () => {
    expect(resolveRedactStyle({ style: { css: 'background: red' } }).css).toBe(
      'background: red'
    )
  })
})

describe('ensureRedactControllerInstalled', () => {
  it('installs the init script once and always covers the current document', async () => {
    const page = makeFakePage()
    await ensureRedactControllerInstalled(page as unknown as Page)
    await ensureRedactControllerInstalled(page as unknown as Page)
    expect(page.addInitScript).toHaveBeenCalledTimes(1)
    // The current-document evaluate runs every call (it is idempotent in-page).
    expect(page.evaluate).toHaveBeenCalledTimes(2)
    expect(getRuntimeRedactState().controllerInstalled).toBe(true)
  })
})

describe('redact (persistent)', () => {
  it('installs the controller, registers the mask, and tracks it', async () => {
    const page = makeFakePage()
    const locator = makeFakeLocator(page)

    const handle = await redact(locator as unknown as Locator)

    expect(page.addInitScript).toHaveBeenCalledTimes(1)
    expect(locator.evaluateAll).toHaveBeenCalledTimes(1)
    expect(getRuntimeRedactState().activeMasks.size).toBe(1)

    await handle.unredact()
    expect(getRuntimeRedactState().activeMasks.size).toBe(0)
    expect(page.evaluate).toHaveBeenCalled()
  })

  it('passes the resolved style to the page', async () => {
    const page = makeFakePage()
    const locator = makeFakeLocator(page)

    await redact(locator as unknown as Locator, {
      style: { color: 'black' },
    })

    const arg = locator.evaluateAll.mock.calls[0][1] as {
      id: string
      style: { color: string | null }
    }
    expect(arg.style.color).toBe('black')
    expect(typeof arg.id).toBe('string')
  })
})

describe('redact (scoped)', () => {
  it('removes the mask after the callback resolves', async () => {
    const page = makeFakePage()
    const locator = makeFakeLocator(page)
    const order: string[] = []

    await redact(locator as unknown as Locator, async () => {
      order.push('body')
      expect(getRuntimeRedactState().activeMasks.size).toBe(1)
    })

    expect(order).toEqual(['body'])
    expect(getRuntimeRedactState().activeMasks.size).toBe(0)
  })

  it('removes the mask even when the callback throws', async () => {
    const page = makeFakePage()
    const locator = makeFakeLocator(page)

    await expect(
      redact(locator as unknown as Locator, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    expect(getRuntimeRedactState().activeMasks.size).toBe(0)
  })
})

describe('unredactAll', () => {
  it('clears tracked masks and clears them in the page', async () => {
    const page = makeFakePage()
    const locator = makeFakeLocator(page)
    await redact(locator as unknown as Locator)
    expect(getRuntimeRedactState().activeMasks.size).toBe(1)

    setRuntimePage(page as unknown as Page)
    await unredactAll()

    expect(getRuntimeRedactState().activeMasks.size).toBe(0)
    expect(page.evaluate).toHaveBeenCalled()
  })
})
