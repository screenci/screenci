import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Locator } from '@playwright/test'
import { autoZoom, setLastZoomLocation } from './autoZoom.js'
import {
  changeFocus,
  resolveFixedFocusViewportSize,
  resolveIdealFocusOriginForAxis,
} from './changeFocus.js'
import { resolveZoomTarget } from './zoom.js'

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
}): Locator & {
  __scrollToCalls: ScrollCall[]
  __nestedScrollTops: number[]
} {
  let windowScrollY = 0
  let windowScrollX = 0
  let nestedScrollTop = 0
  let nestedScrollLeft = 0
  const scrollToCalls: ScrollCall[] = []
  const nestedScrollTops: number[] = []

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
          nestedScrollTops.push(value)
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
    }),
  }

  return {
    boundingBox: vi.fn().mockImplementation(async () => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }),
    evaluate: vi.fn(
      async (
        fn: (el: typeof element, arg?: unknown) => unknown,
        arg?: unknown
      ) => fn(element, arg)
    ),
    page: vi.fn().mockReturnValue({
      viewportSize: () => ({
        width: options.viewport.width,
        height: options.viewport.height,
      }),
    }),
    __scrollToCalls: scrollToCalls,
    __nestedScrollTops: nestedScrollTops,
  } as unknown as Locator & {
    __scrollToCalls: ScrollCall[]
    __nestedScrollTops: number[]
  }
}

describe('changeFocus helpers', () => {
  it('uses a fixed viewport * amount focus viewport', () => {
    expect(
      resolveFixedFocusViewportSize({ width: 1280, height: 720 }, 0.5)
    ).toEqual({ width: 640, height: 360 })
  })

  it('resolves centering 1, 0, and 0.5 placements for smaller rects', () => {
    expect(
      resolveIdealFocusOriginForAxis({
        rectStart: 900,
        rectSize: 40,
        focusSize: 360,
        centering: 1,
      })
    ).toBe(740)
    expect(
      resolveIdealFocusOriginForAxis({
        rectStart: 900,
        rectSize: 40,
        focusSize: 360,
        centering: 0,
      })
    ).toBe(900)
    expect(
      resolveIdealFocusOriginForAxis({
        rectStart: 900,
        rectSize: 40,
        focusSize: 360,
        centering: 0.5,
      })
    ).toBe(820)
  })

  it('centers oversized rects on overflowed axes', () => {
    expect(
      resolveIdealFocusOriginForAxis({
        rectStart: 900,
        rectSize: 600,
        focusSize: 360,
        centering: 0,
      })
    ).toBe(1020)
  })

  it('keeps optimalOffset at zero when framing is achieved', () => {
    expect(
      resolveZoomTarget(
        { x: 320, y: 160, width: 120, height: 40 },
        { width: 1280, height: 720 },
        { amount: 0.5, centering: 1 }
      ).optimalOffset
    ).toEqual({ x: 0, y: 0 })
  })

  it('uses non-zero optimalOffset when bounds prevent the target framing', () => {
    const optimalOffset = resolveZoomTarget(
      { x: 10, y: 10, width: 120, height: 40 },
      { width: 1280, height: 720 },
      { amount: 0.5, centering: 1 }
    ).optimalOffset

    expect(optimalOffset.x).not.toBe(0)
    expect(optimalOffset.y).not.toBe(0)
  })
})

describe('changeFocus', () => {
  it('centers when centering is 1 and achievable', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    const promise = changeFocus(locator, { amount: 0.5, centering: 1 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.locatorRect?.y).toBeCloseTo(340, 0)
  })

  it('uses start-edge placement when centering is 0 and achievable', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2200 },
    })

    const promise = changeFocus(locator, { amount: 0.5, centering: 0 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.locatorRect?.y).toBeCloseTo(180, 0)
  })

  it('uses halfway placement when centering is 0.5 and achievable', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2200 },
    })

    const promise = changeFocus(locator, { amount: 0.5, centering: 0.5 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.locatorRect?.y).toBeCloseTo(260, 0)
  })

  it('clamps oversized rect framing when centered placement is impossible', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 1200, height: 600 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 1400 },
    })

    const promise = changeFocus(locator, { amount: 0.5, centering: 1 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.locatorRect?.y).toBeLessThan(240)
    expect(
      resolveZoomTarget(
        result.locatorRect!,
        { width: 1280, height: 720 },
        {
          amount: 0.5,
          centering: 1,
        }
      ).optimalOffset.y
    ).toBeGreaterThanOrEqual(0)
  })

  it('does not scroll just to improve framing when the requested framing is already met', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 100, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    const promise = changeFocus(locator, { amount: 0.5, centering: 0 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.locatorRect?.y).toBeCloseTo(100, 0)
    expect(result.focusChange).toBeUndefined()
  })

  it('does not page scroll when zoom alone can achieve centered framing', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 120, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    let result: Awaited<ReturnType<typeof changeFocus>> | undefined

    const promise = autoZoom(
      async () => {
        setLastZoomLocation({
          x: 100,
          y: 120,
          eventType: 'click',
          elementRect: { x: 80, y: 100, width: 120, height: 40 },
        })
        result = await changeFocus(locator, { amount: 0.5, centering: 1 })
      },
      { amount: 0.5, centering: 1, duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(locator.__scrollToCalls).toHaveLength(0)
    expect(result?.locatorRect?.y).toBeCloseTo(120, 0)
    expect(result?.focusChange?.scroll).toBeUndefined()
    expect(result?.focusChange?.zoom).toBeDefined()
  })

  it('does not scroll for subpixel optimalOffset when zoom can absorb the framing', async () => {
    const locator = makeLocatorMock({
      rect: { x: 378, y: 514.5, width: 637.5, height: 51 },
      viewport: { width: 1920, height: 1080 },
      scrollSize: { width: 1920, height: 4000 },
    })
    let result: Awaited<ReturnType<typeof changeFocus>> | undefined

    const promise = autoZoom(
      async () => {
        setLastZoomLocation({
          x: 867.28125,
          y: 440.96875,
          eventType: 'click',
          elementRect: {
            x: 719.0625,
            y: 415.46875,
            width: 296.4375,
            height: 51,
          },
        })
        result = await changeFocus(locator, { amount: 0.5, centering: 1 })
      },
      { amount: 0.5, centering: 1, duration: 500, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(locator.__scrollToCalls).toHaveLength(0)
    expect(result?.focusChange?.scroll).toBeUndefined()
    expect(result?.focusChange?.zoom?.optimalOffset).toEqual({ x: -0.25, y: 0 })
  })

  it('scrolls only by the residual amount zoom cannot absorb', async () => {
    const locator = makeLocatorMock({
      rect: { x: 1400, y: 520, width: 420, height: 80 },
      viewport: { width: 1920, height: 1080 },
      scrollSize: { width: 2600, height: 4000 },
    })
    let result: Awaited<ReturnType<typeof changeFocus>> | undefined

    const promise = autoZoom(
      async () => {
        setLastZoomLocation({
          x: 1610,
          y: 560,
          eventType: 'click',
          elementRect: { x: 1400, y: 520, width: 420, height: 80 },
        })
        result = await changeFocus(locator, { amount: 0.5, centering: 1 })
      },
      { amount: 0.5, centering: 1, duration: 500, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(locator.__scrollToCalls.length).toBeGreaterThan(0)
    const finalScrollCall = locator.__scrollToCalls.at(-1)
    expect(finalScrollCall?.left).toBeCloseTo(170, 0)
    expect(result?.locatorRect?.x).toBeCloseTo(1230, 0)
    expect(result?.focusChange?.zoom?.optimalOffset).toEqual({ x: 0, y: 0 })
  })

  it('scrolls nested containers when ancestor clipping requires it', async () => {
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

    const promise = changeFocus(locator)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(locator.__nestedScrollTops.length).toBeGreaterThan(0)
    expect(locator.__scrollToCalls.length).toBeGreaterThan(0)
    expect(result.locatorRect?.y).toBeCloseTo(340, 0)
  })

  it('starts mouse movement at the same focus start as scroll and zoom', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    const mouseMoveInternal = vi.fn().mockResolvedValue(undefined)
    let result: Awaited<ReturnType<typeof changeFocus>> | undefined

    const promise = autoZoom(
      async () => {
        setLastZoomLocation({
          x: 100,
          y: 120,
          eventType: 'click',
          elementRect: { x: 80, y: 100, width: 120, height: 40 },
        })
        result = await changeFocus(
          locator,
          { duration: 300 },
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
      },
      { duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(result?.focusChange?.mouse?.startMs).toBe(
      result?.focusChange?.scroll?.startMs
    )
    expect(result?.focusChange?.mouse?.startMs).toBe(
      result?.focusChange?.zoom?.startMs
    )
  })

  it('uses the exact same start and end for scroll and zoom', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    let result: Awaited<ReturnType<typeof changeFocus>> | undefined

    const promise = autoZoom(
      async () => {
        setLastZoomLocation({
          x: 100,
          y: 120,
          eventType: 'click',
          elementRect: { x: 80, y: 100, width: 120, height: 40 },
        })
        result = await changeFocus(locator, { duration: 300 })
      },
      { duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(result?.focusChange?.scroll).toMatchObject({
      startMs: result?.focusChange?.zoom?.startMs,
      endMs: result?.focusChange?.zoom?.endMs,
    })
  })

  it('applies pre and post delays even when no focus change is needed', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 100, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    let resolved = false
    const promise = autoZoom(
      async () => {
        await changeFocus(locator, { preZoomDelay: 200, postZoomDelay: 300 })
        resolved = true
      },
      { duration: 0, preZoomDelay: 200, postZoomDelay: 300, amount: 1 }
    )

    await vi.advanceTimersByTimeAsync(499)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await vi.runAllTimersAsync()
    await promise

    expect(resolved).toBe(true)
  })

  it('uses a single window scrollTo path for page scrolling', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2200 },
    })

    const promise = changeFocus(locator, { duration: 100 })
    await vi.runAllTimersAsync()
    await promise

    expect(locator.__scrollToCalls.length).toBeGreaterThan(0)
    expect(
      locator.__scrollToCalls.every((call) => call.behavior === 'auto')
    ).toBe(true)
  })
})
