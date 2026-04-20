import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Locator } from '@playwright/test'
import { scrollTo } from './scroll.js'

type MockDoc = {
  defaultView: MockWindow
  documentElement: {
    scrollHeight: number
    scrollWidth: number
    clientHeight: number
    clientWidth: number
  }
  body: {
    scrollHeight: number
    scrollWidth: number
  }
}

type MockWindow = {
  innerHeight: number
  innerWidth: number
  scrollY: number
  scrollX: number
  document: unknown
  scrollTo: (coords: { top?: number; left?: number; behavior?: string }) => void
}

type ScrollCall = {
  top?: number
  left?: number
  behavior?: string
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function makeLocatorMock(options: {
  rect: { x: number; y: number; width: number; height: number }
  viewport: { width: number; height: number }
  scrollSize: { width: number; height: number }
  nested?: {
    x: number
    y: number
    width: number
    height: number
    scrollWidth: number
    scrollHeight: number
  }
}): Locator & { __scrollToCalls: ScrollCall[] } {
  let windowScrollY = 0
  let windowScrollX = 0
  let nestedScrollTop = 0
  let nestedScrollLeft = 0
  const scrollToCalls: ScrollCall[] = []

  const win: MockWindow = {
    get innerHeight() {
      return options.viewport.height
    },
    get innerWidth() {
      return options.viewport.width
    },
    get scrollY() {
      return windowScrollY
    },
    get scrollX() {
      return windowScrollX
    },
    document: undefined,
    scrollTo: ({ top, left, behavior }) => {
      scrollToCalls.push({ top, left, behavior })
      if (top !== undefined) windowScrollY = top
      if (left !== undefined) windowScrollX = left
    },
  }

  const doc: MockDoc = {
    defaultView: win,
    documentElement: {
      scrollHeight: options.scrollSize.height,
      scrollWidth: options.scrollSize.width,
      clientHeight: options.viewport.height,
      clientWidth: options.viewport.width,
    },
    body: {
      scrollHeight: options.scrollSize.height,
      scrollWidth: options.scrollSize.width,
    },
  }

  const nested = options.nested
    ? {
        parentElement: null as unknown as Element,
        ownerDocument: doc,
        clientHeight: options.nested.height,
        clientWidth: options.nested.width,
        scrollHeight: options.nested.scrollHeight,
        scrollWidth: options.nested.scrollWidth,
        get scrollTop() {
          return nestedScrollTop
        },
        set scrollTop(value: number) {
          nestedScrollTop = value
        },
        get scrollLeft() {
          return nestedScrollLeft
        },
        set scrollLeft(value: number) {
          nestedScrollLeft = value
        },
        getBoundingClientRect: () => ({
          x: options.nested!.x - windowScrollX,
          y: options.nested!.y - windowScrollY,
          width: options.nested!.width,
          height: options.nested!.height,
          top: options.nested!.y - windowScrollY,
          left: options.nested!.x - windowScrollX,
          right: options.nested!.x - windowScrollX + options.nested!.width,
          bottom: options.nested!.y - windowScrollY + options.nested!.height,
          toJSON: () => undefined,
        }),
      }
    : null

  const element = {
    parentElement: nested as unknown as Element | null,
    ownerDocument: doc,
    getBoundingClientRect: () => ({
      x: options.rect.x - windowScrollX - nestedScrollLeft,
      y: options.rect.y - windowScrollY - nestedScrollTop,
      width: options.rect.width,
      height: options.rect.height,
      top: options.rect.y - windowScrollY - nestedScrollTop,
      left: options.rect.x - windowScrollX - nestedScrollLeft,
      right:
        options.rect.x - windowScrollX - nestedScrollLeft + options.rect.width,
      bottom:
        options.rect.y - windowScrollY - nestedScrollTop + options.rect.height,
      toJSON: () => undefined,
    }),
  }

  return {
    boundingBox: vi.fn().mockImplementation(async () => {
      const r = (
        element as {
          getBoundingClientRect(): ReturnType<
            typeof element.getBoundingClientRect
          >
        }
      ).getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }),
    evaluate: vi.fn(
      async (fn: (el: typeof element, arg: unknown) => unknown, arg: unknown) =>
        fn(element, arg)
    ),
    __scrollToCalls: scrollToCalls,
  } as unknown as Locator & { __scrollToCalls: ScrollCall[] }
}

describe('scrollTo', () => {
  it('scrolls the page toward the requested viewport height', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    const promise = scrollTo(locator, 120, 'ease-out')
    await vi.runAllTimersAsync()
    const rect = await promise

    expect(rect?.y).toBeCloseTo(120, 0)
  })

  it('animates page scrolling across multiple eased steps', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    const promise = scrollTo(locator, 120, 'ease-in-out')
    await vi.runAllTimersAsync()
    await promise

    expect(locator.__scrollToCalls.length).toBeGreaterThan(1)
    const lastCall = locator.__scrollToCalls[locator.__scrollToCalls.length - 1]
    expect(locator.__scrollToCalls[0]?.top).toBeLessThan(lastCall?.top ?? 0)
  })

  it('uses the provided duration to control scroll step count', async () => {
    const slowLocator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    const fastLocator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    const slowPromise = scrollTo(slowLocator, 120, 'ease-in-out', 600)
    await vi.runAllTimersAsync()
    await slowPromise

    const fastPromise = scrollTo(fastLocator, 120, 'ease-in-out', 100)
    await vi.runAllTimersAsync()
    await fastPromise

    expect(slowLocator.__scrollToCalls.length).toBeGreaterThan(
      fastLocator.__scrollToCalls.length
    )
  })

  it('scrolls nested containers and then the page', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2200 },
      nested: {
        x: 40,
        y: 700,
        width: 600,
        height: 240,
        scrollWidth: 600,
        scrollHeight: 800,
      },
    })

    const promise = scrollTo(locator, 120, 'ease-in-out')
    await vi.runAllTimersAsync()
    const rect = await promise

    expect(rect?.y).toBeGreaterThan(0)
  })
})
