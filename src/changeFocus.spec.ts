import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Locator } from '@playwright/test'
import { autoZoom, setCurrentZoomViewport } from './autoZoom.js'
import {
  buildAncestorScrollPlans,
  changeFocus,
  resolveFixedFocusViewportSize,
  resolveIdealFocusOriginForAxis,
  resolveTargetRectPosition,
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

  it('resolves the target rect position inside the target viewport', () => {
    expect(
      resolveTargetRectPosition({
        containerSize: { width: 1280, height: 720 },
        rect: { x: 0, y: 0, width: 120, height: 40 },
        amount: 0.5,
        centering: 1,
      })
    ).toEqual({ x: 580, y: 340 })

    expect(
      resolveTargetRectPosition({
        containerSize: { width: 1280, height: 720 },
        rect: { x: 300, y: 220, width: 120, height: 40 },
        amount: 0.5,
        centering: 1,
      })
    ).toEqual({ x: 580, y: 340 })
  })

  it('keeps a smaller rect near the edge when centering is 0', () => {
    expect(
      resolveTargetRectPosition({
        containerSize: { width: 1280, height: 720 },
        rect: { x: 20, y: 900, width: 120, height: 40 },
        amount: 0.5,
        centering: 0,
      })
    ).toEqual({ x: 320, y: 180 })
  })

  it('scrolls ancestors past bare visibility only when page and zoom still need it', () => {
    const snapshot = {
      locatorRect: { x: 20, y: 1400, width: 120, height: 40 },
      viewportSize: { width: 1280, height: 720 },
      page: {
        scrollY: 0,
        scrollX: 0,
        scrollHeight: 1000,
        scrollWidth: 1280,
      },
      ancestors: [
        {
          clientHeight: 240,
          clientWidth: 600,
          scrollHeight: 1200,
          scrollWidth: 600,
          scrollTop: 0,
          scrollLeft: 0,
          rect: {
            top: 850,
            left: 40,
            width: 600,
            height: 240,
          },
        },
      ],
    }

    const result = buildAncestorScrollPlans({
      snapshot,
      projectedRectRangeX: { min: 0, max: 1280 },
      projectedRectRangeY: { min: 340, max: 980 },
    })

    expect(result.plans[0]?.targetTop).toBe(420)
    expect(result.projectedRect.y).toBe(980)
  })

  it('keeps optimalOffset at zero when framing is achieved', () => {
    expect(
      resolveZoomTarget({
        locatorRect: { x: 320, y: 160, width: 120, height: 40 },
        viewport: { width: 1280, height: 720 },
        targetViewport: resolveFixedFocusViewportSize(
          { width: 1280, height: 720 },
          0.5
        ),
        targetRectPositionInZoomViewport: resolveTargetRectPosition({
          containerSize: resolveFixedFocusViewportSize(
            { width: 1280, height: 720 },
            0.5
          ),
          rect: { x: 320, y: 160, width: 120, height: 40 },
          amount: 1,
          centering: 1,
        }),
      }).optimalOffset
    ).toEqual({ x: 0, y: 0 })
  })

  it('uses non-zero optimalOffset when bounds prevent the target framing', () => {
    const optimalOffset = resolveZoomTarget({
      locatorRect: { x: 10, y: 10, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      targetViewport: resolveFixedFocusViewportSize(
        { width: 1280, height: 720 },
        0.5
      ),
      targetRectPositionInZoomViewport: resolveTargetRectPosition({
        containerSize: resolveFixedFocusViewportSize(
          { width: 1280, height: 720 },
          0.5
        ),
        rect: { x: 10, y: 10, width: 120, height: 40 },
        amount: 1,
        centering: 1,
      }),
    }).optimalOffset

    expect(optimalOffset.x).not.toBe(0)
    expect(optimalOffset.y).not.toBe(0)
  })

  it('prefers the nearest valid zoom origin instead of snapping to the top-left', () => {
    const target = resolveZoomTarget({
      locatorRect: { x: 20, y: 20, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      targetViewport: resolveFixedFocusViewportSize(
        { width: 1280, height: 720 },
        0.5
      ),
      targetRectPositionInZoomViewport: resolveTargetRectPosition({
        containerSize: resolveFixedFocusViewportSize(
          { width: 1280, height: 720 },
          0.5
        ),
        rect: { x: 20, y: 20, width: 120, height: 40 },
        amount: 1,
        centering: 1,
      }),
    })

    expect(target?.end.pointPx).toEqual({ x: 0, y: 0 })
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

    expect(result.elementRect?.y).toBeCloseTo(340, 0)
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

    expect(result.elementRect?.y).toBeCloseTo(340, 0)
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

    expect(result.elementRect?.y).toBeCloseTo(340, 0)
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

    expect(result.elementRect?.y).toBeLessThan(240)
    expect(
      resolveZoomTarget({
        locatorRect: result.elementRect!,
        viewport: { width: 1280, height: 720 },
        targetViewport: resolveFixedFocusViewportSize(
          { width: 1280, height: 720 },
          0.5
        ),
        targetRectPositionInZoomViewport: resolveTargetRectPosition({
          containerSize: resolveFixedFocusViewportSize(
            { width: 1280, height: 720 },
            0.5
          ),
          rect: result.elementRect!,
          amount: 1,
          centering: 1,
        }),
      }).optimalOffset.y
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

    expect(result.elementRect?.y).toBeCloseTo(100, 0)
    expect(result.scroll).toBeUndefined()
    expect(result.zoom).toBeUndefined()
    expect(result.mouse).toBeUndefined()
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
        setCurrentZoomViewport({
          focusPoint: { x: 100, y: 120 },
          elementRect: { x: 80, y: 100, width: 120, height: 40 },
          end: {
            pointPx: { x: 0, y: 0 },
            size: { widthPx: 1280, heightPx: 720 },
          },
          viewportSize: { width: 1280, height: 720 },
        })
        result = await changeFocus(locator, { amount: 0.5, centering: 1 })
      },
      { amount: 0.5, centering: 1, duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(locator.__scrollToCalls).toHaveLength(0)
    expect(result?.elementRect?.y).toBeCloseTo(120, 0)
    expect(result?.scroll).toBeUndefined()
    expect(result?.zoom).toBeDefined()
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
        setCurrentZoomViewport({
          focusPoint: { x: 867.28125, y: 440.96875 },
          elementRect: {
            x: 719.0625,
            y: 415.46875,
            width: 296.4375,
            height: 51,
          },
          end: {
            pointPx: { x: 387, y: 171 },
            size: { widthPx: 960, heightPx: 540 },
          },
          viewportSize: { width: 1920, height: 1080 },
        })
        result = await changeFocus(locator, { amount: 0.5, centering: 1 })
      },
      { amount: 0.5, centering: 1, duration: 500, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(locator.__scrollToCalls).toHaveLength(0)
    expect(result?.scroll).toBeUndefined()
    expect(result?.zoom?.optimalOffset?.x).toBeCloseTo(0)
    expect(result?.zoom?.optimalOffset?.y).toBe(0)
  })

  it('forces centering to 1 when the current zoom already fills the viewport', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    let result: Awaited<ReturnType<typeof changeFocus>> | undefined

    const promise = autoZoom(
      async () => {
        setCurrentZoomViewport({
          focusPoint: { x: 0, y: 0 },
          elementRect: { x: 0, y: 0, width: 1280, height: 720 },
          end: {
            pointPx: { x: 0, y: 0 },
            size: { widthPx: 1280, heightPx: 720 },
          },
          viewportSize: { width: 1280, height: 720 },
          optimalOffset: { x: 0, y: 0 },
        })
        result = await changeFocus(locator, { amount: 0.5, centering: 0 })
      },
      { amount: 0.5, centering: 0, duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(result?.zoom?.end).toEqual({
      pointPx: { x: 0, y: 360 },
      size: { widthPx: 640, heightPx: 360 },
    })
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
        setCurrentZoomViewport({
          focusPoint: { x: 1610, y: 560 },
          elementRect: { x: 1400, y: 520, width: 420, height: 80 },
          end: {
            pointPx: { x: 960, y: 270 },
            size: { widthPx: 960, heightPx: 540 },
          },
          viewportSize: { width: 1920, height: 1080 },
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
    expect(result?.elementRect?.x).toBeCloseTo(1230, 0)
    expect(result?.zoom?.optimalOffset).toEqual({ x: 0, y: 0 })
  })

  it('scrolls nested containers when ancestor clipping requires it', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 980, width: 120, height: 40 },
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
    expect(result.elementRect?.y).toBeCloseTo(340, 0)
  })

  it('does not scroll nested containers when the locator is already visible', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 760, width: 120, height: 40 },
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
    await promise

    expect(locator.__nestedScrollTops).toHaveLength(0)
    expect(locator.__scrollToCalls.length).toBeGreaterThan(0)
  })

  it('uses the same duration and easing for mouse, scroll, and zoom', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    const mouseMoveInternal = vi.fn().mockResolvedValue(undefined)
    let result: Awaited<ReturnType<typeof changeFocus>> | undefined

    const promise = autoZoom(
      async () => {
        setCurrentZoomViewport({
          focusPoint: { x: 100, y: 120 },
          elementRect: { x: 80, y: 100, width: 120, height: 40 },
          end: {
            pointPx: { x: 0, y: 0 },
            size: { widthPx: 1280, heightPx: 720 },
          },
          viewportSize: { width: 1280, height: 720 },
        })
        result = await changeFocus(
          locator,
          { duration: 300, easing: 'ease-in' },
          {
            page: {},
            mouseMoveInternal,
            startViewportPos: { x: 0, y: 0 },
            targetPosInElement: { x: 60, y: 20 },
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

    expect(result?.mouse?.startMs).toBe(result?.scroll?.startMs)
    expect(result?.mouse?.startMs).toBe(result?.zoom?.startMs)
    expect(result?.mouse?.endMs).toBeGreaterThan(result?.scroll?.endMs ?? 0)
    expect(result?.mouse?.endMs).toBeGreaterThan(result?.zoom?.endMs ?? 0)
    expect(result?.mouse?.easing).toBe('ease-in')
    expect(result?.scroll?.easing).toBe('ease-in')
    expect(result?.zoom?.easing).toBe('ease-in')
  })

  it('uses the same start for scroll and zoom while allowing measured scroll end', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    let result: Awaited<ReturnType<typeof changeFocus>> | undefined

    const promise = autoZoom(
      async () => {
        setCurrentZoomViewport({
          focusPoint: { x: 100, y: 120 },
          elementRect: { x: 80, y: 100, width: 120, height: 40 },
          end: {
            pointPx: { x: 0, y: 0 },
            size: { widthPx: 1280, heightPx: 720 },
          },
          viewportSize: { width: 1280, height: 720 },
        })
        result = await changeFocus(locator, { duration: 300 })
      },
      { duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(result?.scroll?.startMs).toBe(result?.zoom?.startMs)
    expect(result?.scroll?.endMs).toBeLessThanOrEqual(result?.zoom?.endMs ?? 0)
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
