import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Locator } from '@playwright/test'
import { autoZoom, setLastZoomLocation } from './autoZoom.js'
import * as autoZoomModule from './autoZoom.js'
import { scroll } from './scroll.js'

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
  getComputedStyle: (
    elt: Element
  ) => Pick<CSSStyleDeclaration, 'overflowX' | 'overflowY'>
  requestAnimationFrame?: (callback: FrameRequestCallback) => number
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
    getComputedStyle: (elt) => {
      if (elt === nested) {
        return { overflowX: 'auto', overflowY: 'auto' }
      }
      return { overflowX: 'visible', overflowY: 'visible' }
    },
    requestAnimationFrame: (callback) => {
      setTimeout(() => callback(Date.now()), 1000 / 60)
      return 1
    },
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
    page: vi.fn().mockReturnValue({
      viewportSize: () => ({
        width: options.viewport.width,
        height: options.viewport.height,
      }),
    }),
    __scrollToCalls: scrollToCalls,
  } as unknown as Locator & { __scrollToCalls: ScrollCall[] }
}

describe('scroll', () => {
  it('scrolls the page to bring the element into the viewport', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    const promise = scroll(locator)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.locatorRect?.y).toBeCloseTo(340, 0)
  })

  it('marks the first autoZoom interaction to scroll before mouse movement', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    let result: Awaited<ReturnType<typeof scroll>> | undefined
    const promise = autoZoom(async () => {
      result = await scroll(locator)
    })

    await vi.runAllTimersAsync()
    await promise

    expect(result?.isFirstAutoZoomInteraction).toBe(true)
    expect(result?.shouldScrollBeforeMouseMove).toBe(true)
  })

  it('uses the zoomed viewport and centering override to scroll less than full center', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    const promise = scroll(locator, {
      amount: 0.5,
      centering: 0.2,
    })

    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.locatorRect?.y).toBeCloseTo(212, 0)
  })

  it('treats centering 1 as centered and centering 0 as barely visible', async () => {
    const centeredLocator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    const minimalLocator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    const centeredPromise = scroll(centeredLocator, {
      amount: 0.5,
      centering: 1,
    })
    const minimalPromise = scroll(minimalLocator, {
      amount: 0.5,
      centering: 0,
    })

    await vi.runAllTimersAsync()
    const centeredResult = await centeredPromise
    const minimalResult = await minimalPromise

    expect(centeredResult.locatorRect?.y).toBeGreaterThan(
      minimalResult.locatorRect?.y ?? 0
    )
  })

  it('does not scroll when centering is 0 and the rect is already visible', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 100, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    const promise = scroll(locator, {
      amount: 0.5,
      centering: 0,
    })

    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.locatorRect?.y).toBeCloseTo(100, 0)
  })

  it('keeps the requested padding when allowZoomingOut expands the visible area', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 1200, height: 600 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2200 },
    })

    const promise = scroll(locator, {
      amount: 0.5,
      centering: 0.25,
    })

    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.locatorRect?.y).toBeCloseTo(32, 0)
  })

  it('keeps later autoZoom interactions scrolling during mouse movement', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    let result: Awaited<ReturnType<typeof scroll>> | undefined
    const promise = autoZoom(async () => {
      setLastZoomLocation({
        x: 100,
        y: 120,
        eventType: 'click',
        elementRect: { x: 80, y: 100, width: 120, height: 40 },
      })
      result = await scroll(locator)
    })

    await vi.runAllTimersAsync()
    await promise

    expect(result?.isFirstAutoZoomInteraction).toBe(false)
    expect(result?.shouldScrollBeforeMouseMove).toBe(false)
  })

  it('animates page scrolling across multiple eased steps', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    const promise = scroll(locator)
    await vi.runAllTimersAsync()
    await promise

    expect(locator.__scrollToCalls.length).toBeGreaterThan(0)
    const lastCall = locator.__scrollToCalls[locator.__scrollToCalls.length - 1]
    expect(locator.__scrollToCalls[0]?.top).toBeLessThanOrEqual(
      lastCall?.top ?? 0
    )
  })

  it('uses the autoZoom duration to control scroll step count', async () => {
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
    const prevLocation = {
      x: 100,
      y: 100,
      eventType: 'click' as const,
      elementRect: { x: 80, y: 80, width: 40, height: 20 },
    }
    const stateSpy = vi.spyOn(autoZoomModule, 'getAutoZoomState')

    stateSpy.mockReturnValue({
      ...autoZoomModule.getAutoZoomState(),
      duration: 600,
    })
    const slowPromise = autoZoom(() => {
      setLastZoomLocation(prevLocation)
      return scroll(slowLocator)
    })
    await vi.runAllTimersAsync()
    await slowPromise

    stateSpy.mockReturnValue({
      ...autoZoomModule.getAutoZoomState(),
      duration: 100,
    })
    const fastPromise = autoZoom(() => {
      setLastZoomLocation(prevLocation)
      return scroll(fastLocator)
    })
    await vi.runAllTimersAsync()
    await fastPromise

    stateSpy.mockRestore()
    expect(slowLocator.__scrollToCalls.length).toBeGreaterThanOrEqual(
      fastLocator.__scrollToCalls.length
    )
  })

  it('moves the mouse alongside scrolling and waits for the slower animation', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    const mouseMoveInternal = vi.fn().mockResolvedValue(undefined)

    const promise = scroll(
      locator,
      { duration: 100 },
      {
        page: {},
        mouseMoveInternal,
        startPos: { x: 0, y: 0 },
        targetPos: { x: 60, y: 20 },
        duration: 1000,
        easing: 'linear',
        context: 'test move',
      }
    )

    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.mouseMoveEvent).toMatchObject({
      x: 80,
      y: 360,
      elementRect: result.locatorRect,
      mouse: {
        startMs: result.scrollStartMs,
      },
    })
    expect(result.scrollEndMs - result.scrollStartMs).toBeGreaterThanOrEqual(
      900
    )
    expect(mouseMoveInternal).toHaveBeenCalled()
  })

  it('moves the mouse even when no scroll is needed', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 100, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    const mouseMoveInternal = vi.fn().mockResolvedValue(undefined)

    const promise = scroll(
      locator,
      {},
      {
        page: {},
        mouseMoveInternal,
        startPos: { x: 0, y: 0 },
        targetPos: { x: 60, y: 20 },
        duration: 100,
        easing: 'linear',
        context: 'test move',
      }
    )

    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.mouseMoveEvent).toBeDefined()
    expect(result.mouseMoveEvent?.mouse?.startMs).toBe(result.scrollStartMs)
    expect(mouseMoveInternal).toHaveBeenCalled()
  })

  it('uses autoZoom options as scroll defaults when options are omitted', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    const stateSpy = vi.spyOn(autoZoomModule, 'getAutoZoomState')
    stateSpy.mockReturnValue({
      insideAutoZoom: true,
      lastZoomLocation: {
        x: 1,
        y: 1,
        eventType: 'click',
        elementRect: { x: 0, y: 0, width: 1, height: 1 },
      },
      easing: 'ease-out',
      duration: 123,
      amount: 0.25,
      centering: 0.75,
    })

    const promise = scroll(locator)
    await vi.runAllTimersAsync()
    await promise

    expect(stateSpy).toHaveBeenCalledOnce()
    expect(locator.__scrollToCalls.length).toBeGreaterThan(0)
    stateSpy.mockRestore()
  })

  it('reuses non-linear easing for evaluated scroll animation', async () => {
    const easeOutLocator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    const linearLocator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    const easeOutPromise = scroll(easeOutLocator, {
      duration: 100,
      easing: 'ease-out',
    })
    const linearPromise = scroll(linearLocator, {
      duration: 100,
      easing: 'linear',
    })

    await vi.runAllTimersAsync()
    await Promise.all([easeOutPromise, linearPromise])

    expect(easeOutLocator.__scrollToCalls[0]?.top).toBeGreaterThan(
      linearLocator.__scrollToCalls[0]?.top ?? 0
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

    const promise = scroll(locator)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.locatorRect?.y).toBeCloseTo(340, 0)
  })

  it('skips non-scrollable wrappers and animates the real scroll container', async () => {
    let windowScrollY = 0
    let nestedScrollTop = 0
    const nestedScrollTops: number[] = []

    const win: MockWindow = {
      innerHeight: 720,
      innerWidth: 1280,
      get scrollY() {
        return windowScrollY
      },
      get scrollX() {
        return 0
      },
      document: undefined,
      getComputedStyle: (elt) => {
        if (elt === scrollShell) {
          return { overflowX: 'auto', overflowY: 'auto' }
        }
        return { overflowX: 'visible', overflowY: 'visible' }
      },
      requestAnimationFrame: (callback) => {
        setTimeout(() => callback(Date.now()), 1000 / 60)
        return 1
      },
      scrollTo: ({ top }) => {
        if (top !== undefined) windowScrollY = top
      },
    }

    const doc: MockDoc = {
      defaultView: win,
      documentElement: {
        scrollHeight: 2200,
        scrollWidth: 1280,
        clientHeight: 720,
        clientWidth: 1280,
      },
      body: { scrollHeight: 2200, scrollWidth: 1280 },
    }

    const scrollShell = {
      parentElement: null as unknown as Element,
      ownerDocument: doc,
      clientHeight: 240,
      clientWidth: 600,
      scrollHeight: 800,
      scrollWidth: 600,
      get scrollTop() {
        return nestedScrollTop
      },
      set scrollTop(value: number) {
        nestedScrollTop = value
        nestedScrollTops.push(value)
      },
      get scrollLeft() {
        return 0
      },
      set scrollLeft(_value: number) {},
      getBoundingClientRect: () => ({
        x: 40,
        y: 700 - windowScrollY,
        width: 600,
        height: 240,
        top: 700 - windowScrollY,
        left: 40,
        right: 640,
        bottom: 940 - windowScrollY,
        toJSON: () => undefined,
      }),
    }

    const wrapper = {
      parentElement: scrollShell as unknown as Element,
      ownerDocument: doc,
      clientHeight: 500,
      clientWidth: 500,
      scrollHeight: 500,
      scrollWidth: 500,
      scrollTop: 0,
      scrollLeft: 0,
      getBoundingClientRect: () => ({
        x: 52,
        y: 740 - windowScrollY,
        width: 500,
        height: 500,
        top: 740 - windowScrollY,
        left: 52,
        right: 552,
        bottom: 1240 - windowScrollY,
        toJSON: () => undefined,
      }),
    }

    const element = {
      parentElement: wrapper as unknown as Element,
      ownerDocument: doc,
      getBoundingClientRect: () => ({
        x: 64,
        y: 1120 - windowScrollY - nestedScrollTop,
        width: 120,
        height: 40,
        top: 1120 - windowScrollY - nestedScrollTop,
        left: 64,
        right: 184,
        bottom: 1160 - windowScrollY - nestedScrollTop,
        toJSON: () => undefined,
      }),
    }

    const locator = {
      boundingBox: vi.fn().mockImplementation(async () => {
        const r = element.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }),
      evaluate: vi.fn(
        async (
          fn: (el: typeof element, arg: unknown) => unknown,
          arg: unknown
        ) => fn(element, arg)
      ),
    } as unknown as Locator

    const promise = scroll(locator)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(nestedScrollTops.length).toBeGreaterThan(0)
    expect(result.locatorRect?.y).toBeCloseTo(340, 0)
  })

  it('animates multiple nested scroll containers together with page scroll', async () => {
    let windowScrollY = 0
    let outerScrollTop = 0
    let innerScrollTop = 0
    const outerScrollTops: number[] = []
    const innerScrollTops: number[] = []

    const win: MockWindow = {
      innerHeight: 720,
      innerWidth: 1280,
      get scrollY() {
        return windowScrollY
      },
      get scrollX() {
        return 0
      },
      document: undefined,
      getComputedStyle: (elt) => {
        if (elt === outer || elt === inner) {
          return { overflowX: 'auto', overflowY: 'auto' }
        }
        return { overflowX: 'visible', overflowY: 'visible' }
      },
      requestAnimationFrame: (callback) => {
        setTimeout(() => callback(Date.now()), 1000 / 60)
        return 1
      },
      scrollTo: ({ top }) => {
        if (top !== undefined) windowScrollY = top
      },
    }

    const doc: MockDoc = {
      defaultView: win,
      documentElement: {
        scrollHeight: 2600,
        scrollWidth: 1280,
        clientHeight: 720,
        clientWidth: 1280,
      },
      body: { scrollHeight: 2600, scrollWidth: 1280 },
    }

    const outer = {
      parentElement: null as unknown as Element,
      ownerDocument: doc,
      clientHeight: 260,
      clientWidth: 640,
      scrollHeight: 920,
      scrollWidth: 640,
      get scrollTop() {
        return outerScrollTop
      },
      set scrollTop(value: number) {
        outerScrollTop = value
        outerScrollTops.push(value)
      },
      get scrollLeft() {
        return 0
      },
      set scrollLeft(_value: number) {},
      getBoundingClientRect: () => ({
        x: 40,
        y: 920 - windowScrollY,
        width: 640,
        height: 260,
        top: 920 - windowScrollY,
        left: 40,
        right: 680,
        bottom: 1180 - windowScrollY,
        toJSON: () => undefined,
      }),
    }

    const inner = {
      parentElement: outer as unknown as Element,
      ownerDocument: doc,
      clientHeight: 180,
      clientWidth: 520,
      scrollHeight: 700,
      scrollWidth: 520,
      get scrollTop() {
        return innerScrollTop
      },
      set scrollTop(value: number) {
        innerScrollTop = value
        innerScrollTops.push(value)
      },
      get scrollLeft() {
        return 0
      },
      set scrollLeft(_value: number) {},
      getBoundingClientRect: () => ({
        x: 60,
        y: 1060 - windowScrollY - outerScrollTop,
        width: 520,
        height: 180,
        top: 1060 - windowScrollY - outerScrollTop,
        left: 60,
        right: 580,
        bottom: 1240 - windowScrollY - outerScrollTop,
        toJSON: () => undefined,
      }),
    }

    const element = {
      parentElement: inner as unknown as Element,
      ownerDocument: doc,
      getBoundingClientRect: () => ({
        x: 84,
        y: 1380 - windowScrollY - outerScrollTop - innerScrollTop,
        width: 120,
        height: 40,
        top: 1380 - windowScrollY - outerScrollTop - innerScrollTop,
        left: 84,
        right: 204,
        bottom: 1420 - windowScrollY - outerScrollTop - innerScrollTop,
        toJSON: () => undefined,
      }),
    }

    const locator = {
      boundingBox: vi.fn().mockImplementation(async () => {
        const r = element.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }),
      evaluate: vi.fn(
        async (
          fn: (el: typeof element, arg: unknown) => unknown,
          arg: unknown
        ) => fn(element, arg)
      ),
    } as unknown as Locator

    const promise = scroll(locator)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(outerScrollTops.length).toBeGreaterThan(0)
    expect(innerScrollTops.length).toBeGreaterThan(0)
    expect(result.locatorRect?.y).toBeCloseTo(340, 0)
  })
})
