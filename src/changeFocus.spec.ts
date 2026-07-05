import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Locator } from '@playwright/test'
import {
  autoZoom,
  getCurrentZoomViewport,
  setAutoZoomState,
  setCurrentZoomViewport,
} from './autoZoom.js'
import {
  buildAncestorScrollPlans,
  changeFocus,
  combineFocusPlan,
  resolveFixedFocusViewportSize,
  resolveIdealFocusOriginForAxis,
  resolveLocatorFocusViewport,
  resolvePointFocusZoom,
  resolveScrollAndZoomTimingPlan,
  resolveTargetRectPosition,
} from './changeFocus.js'
import { DEFAULT_SCROLL_CENTERING } from './defaults.js'
import { logger } from './logger.js'
import { setMousePosition, setOriginalMouseMove } from './mouse.js'
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
  ) => Pick<CSSStyleDeclaration, 'overflowX' | 'overflowY' | 'position'>
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
  setAutoZoomState({
    insideAutoZoom: false,
    mode: 'idle',
    options: {},
    currentZoomViewport: null,
    scrollCentering: DEFAULT_SCROLL_CENTERING,
  })
  vi.restoreAllMocks()
})

function makeLocatorMock(options: {
  rect: { x: number; y: number; width: number; height: number }
  viewport: { width: number; height: number }
  scrollSize: { width: number; height: number }
  fixed?: boolean
  fixedAncestor?: boolean
  nested?: {
    x: number
    y: number
    width: number
    height: number
    scrollWidth: number
    scrollHeight: number
  }
  /** Simulated per-frame cost of applying a scroll step (ms), e.g. a laggy CI. */
  evaluateDelayMs?: number
}): Locator & {
  __scrollToCalls: ScrollCall[]
  __nestedScrollTops: number[]
  __requestAnimationFrameCalls: number
} {
  let windowScrollY = 0
  let windowScrollX = 0
  let nestedScrollTop = 0
  let nestedScrollLeft = 0
  let requestAnimationFrameCalls = 0
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
      if (elt === element) {
        return {
          overflowX: 'visible',
          overflowY: 'visible',
          position: options.fixed ? 'fixed' : 'static',
        }
      }
      if (elt === nested) {
        return {
          overflowX: 'auto',
          overflowY: 'auto',
          position: 'static',
        }
      }
      if (elt === fixedAncestor) {
        return {
          overflowX: 'visible',
          overflowY: 'visible',
          position: 'fixed',
        }
      }
      return {
        overflowX: 'visible',
        overflowY: 'visible',
        position: 'static',
      }
    },
    requestAnimationFrame: (callback) => {
      requestAnimationFrameCalls += 1
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

  const fixedAncestor = options.fixedAncestor
    ? ({
        parentElement: null,
        ownerDocument: doc,
        getBoundingClientRect: () => ({
          x: 0,
          y: 0,
          width: options.viewport.width,
          height: options.viewport.height,
          top: 0,
          left: 0,
        }),
      } as unknown as Element)
    : null

  const nested = options.nested
    ? {
        parentElement: fixedAncestor,
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
    : (fixedAncestor as unknown as Element | null)

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
      ) => {
        // Simulate a slow per-frame cost for scroll-step applies (which carry an
        // `easedT`), to exercise time-based frame dropping.
        if (
          options.evaluateDelayMs &&
          arg !== null &&
          typeof arg === 'object' &&
          'easedT' in arg
        ) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, options.evaluateDelayMs)
          )
        }
        return fn(element, arg)
      }
    ),
    page: vi.fn().mockReturnValue({
      viewportSize: () => ({
        width: options.viewport.width,
        height: options.viewport.height,
      }),
      mouse: {
        move: vi.fn().mockResolvedValue(undefined),
      },
    }),
    __scrollToCalls: scrollToCalls,
    __nestedScrollTops: nestedScrollTops,
    get __requestAnimationFrameCalls() {
      return requestAnimationFrameCalls
    },
  } as unknown as Locator & {
    __scrollToCalls: ScrollCall[]
    __nestedScrollTops: number[]
    __requestAnimationFrameCalls: number
  }
}

describe('changeFocus helpers', () => {
  it('uses a fixed viewport * amount focus viewport', () => {
    expect(
      resolveFixedFocusViewportSize({ width: 1280, height: 720 }, 0.5)
    ).toEqual({ width: 640, height: 360 })
  })

  it('keeps the requested amount viewport when it is larger than padding fit', () => {
    expect(
      resolveLocatorFocusViewport({
        viewport: { width: 1280, height: 720 },
        rect: { x: 0, y: 0, width: 120, height: 40 },
        amount: 0.65,
        padding: 0.2,
      })
    ).toEqual({ width: 832, height: 468 })
  })

  it('uses uniform padded locator sizing when it is larger than the requested amount', () => {
    expect(
      resolveLocatorFocusViewport({
        viewport: { width: 1280, height: 720 },
        rect: { x: 0, y: 0, width: 1000, height: 100 },
        amount: 0.65,
        padding: 0.2,
      })
    ).toEqual({ width: 1200, height: 675 })
  })

  it('uses uniform padded locator sizing when height is the limiting side', () => {
    const result = resolveLocatorFocusViewport({
      viewport: { width: 1280, height: 720 },
      rect: { x: 0, y: 0, width: 100, height: 580 },
      amount: 0.2,
      padding: 0.2,
    })

    expect(result.width).toBeCloseTo(1237.3333333333335)
    expect(result.height).toBe(696)
  })

  it('clamps padded locator sizing to the full viewport', () => {
    expect(
      resolveLocatorFocusViewport({
        viewport: { width: 1280, height: 720 },
        rect: { x: 0, y: 0, width: 2000, height: 1000 },
        amount: 0.65,
        padding: 0.2,
      })
    ).toEqual({ width: 1280, height: 720 })
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

  it('delays scroll and zoom until the cursor reaches the configured side threshold', () => {
    expect(
      resolveScrollAndZoomTimingPlan({
        viewportSize: { width: 1280, height: 720 },
        target: { x: 1160, y: 300 },
        startViewportPos: { x: -200, y: 300 },
        duration: 1000,
        easing: 'linear',
        cursorTriggerEdgeThreshold: 0.25,
        cursorTriggerMaxProgress: 1,
      })
    ).toEqual({ startDelay: 864.406779661017, duration: 135.59322033898297 })
  })

  it('starts scroll and zoom immediately when the cursor is already close enough offscreen', () => {
    expect(
      resolveScrollAndZoomTimingPlan({
        viewportSize: { width: 1280, height: 720 },
        target: { x: 1160, y: 300 },
        startViewportPos: { x: 1400, y: 300 },
        duration: 1000,
        easing: 'linear',
        cursorTriggerEdgeThreshold: 0.25,
        cursorTriggerMaxProgress: 1,
      })
    ).toEqual({ startDelay: 0, duration: 1000 })
  })

  it('starts scroll and zoom no later than the configured mouse progress fallback', () => {
    expect(
      resolveScrollAndZoomTimingPlan({
        viewportSize: { width: 1280, height: 720 },
        target: { x: 1160, y: 300 },
        startViewportPos: { x: -200, y: 300 },
        duration: 1000,
        easing: 'linear',
        cursorTriggerEdgeThreshold: 0.25,
        cursorTriggerMaxProgress: 0.5,
      })
    ).toEqual({ startDelay: 500, duration: 500 })
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
    const target = resolveZoomTarget({
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
    })

    expect(target).toBeDefined()
    expect(target?.optimalOffset).toEqual({ x: 0, y: 0 })
  })

  it('uses non-zero optimalOffset when bounds prevent the target framing', () => {
    const target = resolveZoomTarget({
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
    })

    expect(target).toBeDefined()
    expect(target?.optimalOffset.x).not.toBe(0)
    expect(target?.optimalOffset.y).not.toBe(0)
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

  it('uses the far band edge when centering is 0', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2200 },
    })

    const promise = changeFocus(locator, { amount: 0.5, centering: 0 })
    await vi.runAllTimersAsync()
    const result = await promise

    // centering 0 makes the comfort band the full slack range [0, 680], so an
    // off-screen-below target is minimally revealed at the far edge.
    expect(result.elementRect?.y).toBeCloseTo(680, 0)
  })

  it('uses the far edge of a halfway-inset band when centering is 0.5', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2200 },
    })

    const promise = changeFocus(locator, { amount: 0.5, centering: 0.5 })
    await vi.runAllTimersAsync()
    const result = await promise

    // centering 0.5 creates the comfort band [170, 510], so an
    // off-screen-below target is minimally revealed at the far edge.
    expect(result.elementRect?.y).toBeCloseTo(510, 0)
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
    const target = resolveZoomTarget({
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
    })

    expect(target).toBeDefined()
    expect(target?.optimalOffset.y).toBeGreaterThanOrEqual(0)
  })

  it('zooms out for large locators when padding fit exceeds the requested amount', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 1000, height: 100 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    let result: Awaited<ReturnType<typeof changeFocus>> | undefined

    const promise = autoZoom(
      async () => {
        result = await changeFocus(locator, {
          amount: 0.65,
          padding: 0.2,
          duration: 300,
        })
      },
      { amount: 0.65, padding: 0.2, duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(result?.zoom?.end.size).toEqual({ widthPx: 1200, heightPx: 675 })
  })

  it('falls back to full-screen framing when padded locator sizing exceeds the viewport', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 2000, height: 1000 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 2200, height: 2400 },
    })
    let result: Awaited<ReturnType<typeof changeFocus>> | undefined

    const promise = autoZoom(
      async () => {
        result = await changeFocus(locator, {
          amount: 0.65,
          padding: 0.2,
          duration: 300,
        })
      },
      { amount: 0.65, padding: 0.2, duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(result?.zoom).toBeUndefined()
  })

  it('warns when locator-based zoom cannot fully frame an oversized locator', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 2000, height: 1000 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 2200, height: 2400 },
    })

    const promise = autoZoom(
      async () => {
        await changeFocus(locator, {
          amount: 0.65,
          padding: 0.2,
          duration: 300,
        })
      },
      { amount: 0.65, padding: 0.2, duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(warnSpy).toHaveBeenCalledWith(
      '[screenci] Locator is larger than the viewport; using full-viewport framing and centering as much as possible.'
    )
  })

  it('leaves an already-comfortable target where it is (direction-aware band)', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 100, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    // Default framing (no explicit centering) is now a direction-aware minimal
    // reveal into a comfort band. For a 40px-tall rect in a 720 viewport the
    // slack is 720 - 40 = 680, so with the default scroll-centering 0.2 the band
    // is [680 * 0.1, 680 * 0.9] = [68, 612]. A target whose top is at 100 is
    // already inside that band, so it is not scrolled at all.
    const promise = changeFocus(locator, { amount: 0.5 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.elementRect?.y).toBeCloseTo(100, 0)
    expect(result.zoom).toBeUndefined()
    expect(result.mouse).toBeUndefined()
  })

  it('reveals an off-screen-below target near the bottom of the band', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    // A target below the fold (top at 900, off-screen in a 720 viewport) is
    // scrolled up just enough to rest at the band's far edge (bandMax = 612),
    // near the bottom it entered from, instead of being pulled all the way to
    // the fixed default position (68).
    const promise = changeFocus(locator, { amount: 0.5 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.elementRect?.y).toBeCloseTo(612, 0)
    expect(result.zoom).toBeUndefined()
  })

  it('reveals an off-screen-above target near the top of the band', () => {
    // A target currently above the fold (viewport y = -200) with the page
    // scrolled down 400px (so there is room to scroll back up). The band clamp
    // is clamp(-200, 68, 612) = 68, so the target is revealed at the band's near
    // edge (bandMin = 68), near the top it entered from.
    const plan = combineFocusPlan({
      snapshot: {
        locatorRect: { x: 20, y: -200, width: 120, height: 40 },
        isFixedPosition: false,
        viewportSize: { width: 1280, height: 720 },
        page: {
          scrollY: 400,
          scrollX: 0,
          scrollHeight: 2000,
          scrollWidth: 1280,
        },
        ancestors: [],
      },
      targetViewport: { width: 1280, height: 720 },
      centering: DEFAULT_SCROLL_CENTERING,
      currentZoomEnd: {
        pointPx: { x: 0, y: 0 },
        size: { widthPx: 1280, heightPx: 720 },
      },
    })

    expect(plan.finalLocatorRect.y).toBeCloseTo(68, 0)
  })

  it('nudges a target jammed near the top edge down to the band edge', () => {
    // A target at viewport y=30 (above bandMin 68) with the page scrolled down so
    // it can be nudged down. clamp(30, 68, 612) = 68.
    const plan = combineFocusPlan({
      snapshot: {
        locatorRect: { x: 20, y: 30, width: 120, height: 40 },
        isFixedPosition: false,
        viewportSize: { width: 1280, height: 720 },
        page: {
          scrollY: 400,
          scrollX: 0,
          scrollHeight: 2000,
          scrollWidth: 1280,
        },
        ancestors: [],
      },
      targetViewport: { width: 1280, height: 720 },
      centering: DEFAULT_SCROLL_CENTERING,
      currentZoomEnd: {
        pointPx: { x: 0, y: 0 },
        size: { widthPx: 1280, heightPx: 720 },
      },
    })

    expect(plan.finalLocatorRect.y).toBeCloseTo(68, 0)
  })

  it('nudges a target jammed near the bottom edge up to the band edge', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 650, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    // A target at y=650 is below bandMax (612), so it is nudged up to 612.
    const promise = changeFocus(locator, { amount: 0.5 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.elementRect?.y).toBeCloseTo(612, 0)
  })

  it('reveals at the nearest edge when scrollCentering is 0 (pure minimal reveal)', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2200 },
    })

    // scrollCentering 0 makes the band the full slack [0, 680], so an off-screen
    // below target rests exactly at the far edge (bandMax = 680).
    setAutoZoomState({
      insideAutoZoom: false,
      mode: 'idle',
      options: {},
      currentZoomViewport: null,
      scrollCentering: 0,
    })

    const promise = changeFocus(locator, { amount: 0.5 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.elementRect?.y).toBeCloseTo(680, 0)
    expect(result.zoom).toBeUndefined()
  })

  it('always centers a target when scrollCentering is 1 (band collapses)', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2200 },
    })

    // scrollCentering 1 collapses the band to the single centered position
    // (bandMin === bandMax === 680 / 2 = 340), so every target is centered.
    setAutoZoomState({
      insideAutoZoom: false,
      mode: 'idle',
      options: {},
      currentZoomViewport: null,
      scrollCentering: 1,
    })

    const promise = changeFocus(locator, { amount: 0.5 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.elementRect?.y).toBeCloseTo(340, 0)
    expect(result.zoom).toBeUndefined()
  })

  it('uses explicit centering as the direction-aware band inset', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2200 },
    })

    // An explicit centering (here 0.2) controls the band inset. An
    // off-screen-below target still settles at the far edge of that band, so it
    // lands near the bottom it entered from instead of snapping to the fixed
    // position near the top.
    const promise = changeFocus(locator, { amount: 0.5, centering: 0.2 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.elementRect?.y).toBeCloseTo(612, 0)
    expect(result.zoom).toBeUndefined()
  })

  it('honors a configured scrollCentering for plain no-zoom interactions', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 980, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2200 },
    })

    // The scroll-centering default is configurable (via recordOptions and stored
    // on the runtime AutoZoomState). With scrollCentering 0 the comfort band is
    // the full slack [0, 680], so an off-screen-below target (top at 980) is
    // revealed at the band's far edge (bandMax = 680), a pure minimal reveal.
    setAutoZoomState({
      insideAutoZoom: false,
      mode: 'idle',
      options: {},
      currentZoomViewport: null,
      scrollCentering: 0,
    })

    const promise = changeFocus(locator)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.elementRect?.y).toBeCloseTo(680, 0)
    expect(result.zoom).toBeUndefined()
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
        setMousePosition(locator.page(), { x: 0, y: 0 })
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
      { amount: 0.5, centering: 1, duration: 1000, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(locator.__scrollToCalls).toHaveLength(0)
    expect(result?.scroll).toBeUndefined()
    expect(result?.zoom?.optimalOffset?.x).toBeCloseTo(0)
    expect(result?.zoom?.optimalOffset?.y).toBe(0)
  })

  it('uses the direction-aware autoZoom band default (0.6) when no centering is requested', async () => {
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
        // No explicit centering: autoZoom framing uses the direction-aware band
        // at DEFAULT_AUTO_ZOOM_CENTERING (0.6), not dead center.
        result = await changeFocus(locator, { amount: 0.5 })
      },
      { amount: 0.5, duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(result?.zoom?.end).toEqual({
      pointPx: { x: 0, y: 360 },
      size: { widthPx: 640, heightPx: 360 },
    })
    // The 640x360 zoom viewport sits at the bottom (y 360..720). Within it the
    // band slack is 360 - 40 = 320 and centering 0.6 gives bandMax = 320 * 0.7 =
    // 224, so the off-screen-below target rests at 360 + 224 = 584, slightly
    // toward the bottom rather than dead center (which would be 520).
    expect(result?.elementRect?.y).toBeCloseTo(584, 0)
  })

  it('respects an explicit centering even when the current zoom fills the viewport', async () => {
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
        // Explicit centering is honored (and run through the band): centering 0
        // makes the band the full slack, so the target rests at the far edge.
        result = await changeFocus(locator, { amount: 0.5, centering: 0 })
      },
      { amount: 0.5, centering: 0, duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(result?.zoom?.end).toEqual({
      pointPx: { x: 20, y: 360 },
      size: { widthPx: 640, heightPx: 360 },
    })
    // centering 0 → band is the full slack [0, 320] in the zoom viewport, so the
    // off-screen-below target rests at the far edge: 360 + 320 = 680.
    expect(result?.elementRect?.y).toBeCloseTo(680, 0)
  })

  it('zoomTo keeps its default centering of 1 (band collapses to center)', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    // A standalone zoom (allowStandaloneZoom = true, e.g. zoomTo) defaults to
    // centering 1, which collapses the band to the centered position. The
    // 640x360 zoom viewport sits at the bottom (y 360..720) and the target is
    // centered within it: 360 + (360 - 40) / 2 = 520.
    const promise = changeFocus(
      locator,
      { amount: 0.5, duration: 300, postZoomDelay: 0 },
      undefined,
      true
    )
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.elementRect?.y).toBeCloseTo(520, 0)
    expect(result.zoom?.end).toEqual({
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
      { amount: 0.5, centering: 1, duration: 1000, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(locator.__scrollToCalls.length).toBeGreaterThan(0)
    const finalScrollCall = locator.__scrollToCalls.at(-1)
    expect(finalScrollCall?.left).toBeCloseTo(170, 0)
    expect(result?.elementRect?.x).toBeCloseTo(1230, 0)
    expect(result?.zoom?.optimalOffset).toEqual({ x: 0, y: 0 })
  })

  it('drives the scroll from Node and drops frames when each frame is slow (CI)', async () => {
    const locator = makeLocatorMock({
      rect: { x: 1400, y: 520, width: 420, height: 80 },
      viewport: { width: 1920, height: 1080 },
      scrollSize: { width: 2600, height: 4000 },
      // A laggy CI machine: each applied scroll frame costs 250ms.
      evaluateDelayMs: 250,
    })

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
        await changeFocus(locator, { amount: 0.5, centering: 1 })
      },
      { amount: 0.5, centering: 1, duration: 1000, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    // The scroll never uses the page's requestAnimationFrame (which the browser
    // freezes while recording); it is paced from Node instead.
    expect(locator.__requestAnimationFrameCalls).toBe(0)
    // Time-based progress drops frames instead of stretching: a 1000ms scroll
    // at 250ms/frame finishes in a handful of frames, not the ~60 a 60fps run
    // would emit.
    expect(locator.__scrollToCalls.length).toBeGreaterThan(0)
    expect(locator.__scrollToCalls.length).toBeLessThanOrEqual(10)
    // The final scroll position is still reached exactly.
    expect(locator.__scrollToCalls.at(-1)?.left).toBeCloseTo(170, 0)
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
    // Plain interaction (no zoom): the direction-aware band works through nested
    // scroll containers too. The off-screen-below target (top at 980) is revealed
    // at the band's far edge (bandMax = 612) after the nested container and page
    // both scroll, resting near the bottom rather than being pulled to the top.
    expect(result.elementRect?.y).toBeCloseTo(612, 0)
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

  it('uses the slower default duration for automatic scrolling', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 980, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2200 },
    })

    const promise = changeFocus(locator)
    await vi.runAllTimersAsync()
    const result = await promise

    expect((result.scroll?.endMs ?? 0) - (result.scroll?.startMs ?? 0)).toBe(
      600
    )
  })

  it('uses explicit mouse move duration and easing for mouse, scroll, and zoom', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    const mouseMoveInternal = vi.fn().mockResolvedValue(undefined)
    setOriginalMouseMove(locator.page(), mouseMoveInternal)
    let result: Awaited<ReturnType<typeof changeFocus>> | undefined

    const promise = autoZoom(
      async () => {
        setMousePosition(locator.page(), { x: 0, y: 0 })
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
            targetPosInElement: { x: 60, y: 20 },
            duration: 100,
            easing: 'linear',
          }
        )
      },
      { duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(result?.mouse?.startMs).toBe(result?.scroll?.startMs)
    expect(result?.mouse?.startMs).toBe(result?.zoom?.startMs)
    expect(result?.mouse?.endMs).toBe(result?.scroll?.endMs)
    expect(result?.mouse?.endMs).toBe(result?.zoom?.endMs)
    expect(result?.mouse?.easing).toBe('linear')
    expect(result?.scroll?.easing).toBe('linear')
    expect(result?.zoom?.easing).toBe('linear')
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

  it('delays scroll and zoom until the cursor reaches the configured threshold', async () => {
    const locator = makeLocatorMock({
      rect: { x: 1100, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    const mouseMoveInternal = vi.fn().mockResolvedValue(undefined)
    setOriginalMouseMove(locator.page(), mouseMoveInternal)
    let result: Awaited<ReturnType<typeof changeFocus>> | undefined

    const promise = autoZoom(
      async () => {
        setMousePosition(locator.page(), { x: -200, y: 300 })
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
          { duration: 1000, easing: 'linear' },
          {
            targetPosInElement: { x: 60, y: 20 },
            duration: 100,
            easing: 'linear',
          }
        )
      },
      { duration: 1000, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(result?.mouse?.startMs).toBeGreaterThanOrEqual(0)
    expect(
      (result?.scroll?.endMs ?? 0) - (result?.scroll?.startMs ?? 0)
    ).toBeGreaterThanOrEqual(16)
    expect(
      (result?.zoom?.endMs ?? 0) - (result?.zoom?.startMs ?? 0)
    ).toBeGreaterThanOrEqual(16)
    expect(result?.scroll?.startMs).toBeLessThan(
      result?.mouse?.endMs ?? Infinity
    )
    expect(result?.zoom?.startMs).toBeLessThan(result?.mouse?.endMs ?? Infinity)
  })

  it('defaults mouse start position to the snapshot viewport center before 0,0', async () => {
    const locator = makeLocatorMock({
      rect: { x: 1100, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })
    const mouseMoveInternal = vi.fn().mockResolvedValue(undefined)
    setOriginalMouseMove(locator.page(), mouseMoveInternal)
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
          { duration: 1000, easing: 'linear' },
          {
            targetPosInElement: { x: 60, y: 20 },
            duration: 100,
            easing: 'linear',
          }
        )
      },
      { duration: 1000, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await promise

    expect(
      (result?.scroll?.endMs ?? 0) - (result?.scroll?.startMs ?? 0)
    ).toBeGreaterThan(0)
  })

  it('does not emit zoom or persist zoom viewport outside autoZoom', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2000 },
    })

    const promise = changeFocus(locator, { duration: 100 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.zoom).toBeUndefined()
    expect(getCurrentZoomViewport()).toBeNull()
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

  it('applies per-frame scroll progress, ending fully eased', async () => {
    const locator = makeLocatorMock({
      rect: { x: 20, y: 900, width: 120, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 2200 },
    })

    const promise = changeFocus(locator, { duration: 100 })
    await vi.runAllTimersAsync()
    await promise

    const evaluateMock = vi.mocked(locator.evaluate)
    const lastScrollArgs = evaluateMock.mock.calls.at(-1)?.[1] as
      | { easedT?: number; positionEpsilonPx?: number }
      | undefined

    // The scroll is applied frame by frame; the final frame is fully eased.
    expect(lastScrollArgs?.easedT).toBeCloseTo(1, 5)
    expect(lastScrollArgs?.positionEpsilonPx).toBeGreaterThan(0)
  })

  it('does not try to scroll fixed-position targets', async () => {
    const locator = makeLocatorMock({
      rect: { x: 970, y: 452, width: 294, height: 212 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 3200 },
      fixed: true,
    })

    const promise = changeFocus(
      locator,
      {
        duration: 100,
        easing: 'ease-in-out',
        amount: 0.45,
        centering: 1,
      },
      undefined,
      true
    )
    await vi.runAllTimersAsync()
    const result = await promise

    expect(locator.__scrollToCalls).toHaveLength(0)
    expect(locator.__nestedScrollTops).toHaveLength(0)
    expect(result.scroll).toBeUndefined()
  })

  it('does not auto-scroll while manual zoom remains active', async () => {
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

    setAutoZoomState({
      insideAutoZoom: false,
      mode: 'manual',
      options: { amount: 0.5, padding: 0.2 },
      currentZoomViewport: {
        focusPoint: { x: 640, y: 360 },
        elementRect: { x: 200, y: 200, width: 120, height: 40 },
        end: {
          pointPx: { x: 320, y: 180 },
          size: { widthPx: 640, heightPx: 360 },
        },
        viewportSize: { width: 1280, height: 720 },
      },
      scrollCentering: DEFAULT_SCROLL_CENTERING,
    })

    const promise = changeFocus(locator)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(locator.__scrollToCalls).toHaveLength(0)
    expect(locator.__nestedScrollTops).toHaveLength(0)
    expect(result.scroll).toBeUndefined()
    expect(result.zoom).toBeUndefined()
    expect(result.elementRect).toEqual({
      x: 20,
      y: 980,
      width: 120,
      height: 40,
    })
  })
})

describe('resolvePointFocusZoom', () => {
  const viewportSize = { width: 1000, height: 800 }
  const fullEnd = {
    pointPx: { x: 0, y: 0 },
    size: { widthPx: viewportSize.width, heightPx: viewportSize.height },
  }

  it('frames a point at the given amount, centered when centering is 1', () => {
    const result = resolvePointFocusZoom({
      point: { x: 500, y: 400 },
      viewportSize,
      amount: 0.5,
      centering: 1,
      currentZoomEnd: fullEnd,
    })

    // amount 0.5 of a 1000x800 viewport => a 500x400 zoom window.
    expect(result.targetViewport).toEqual({ width: 500, height: 400 })
    expect(result.zoomTarget).toBeDefined()
    expect(result.end.size).toEqual({ widthPx: 500, heightPx: 400 })
    // A centered point sits in the middle: origin = point - half the window.
    expect(result.end.pointPx).toEqual({ x: 250, y: 200 })
  })

  it('pans to follow a point that moves within an already-zoomed viewport', () => {
    const current = {
      pointPx: { x: 250, y: 200 },
      size: { widthPx: 500, heightPx: 400 },
    }
    const result = resolvePointFocusZoom({
      point: { x: 800, y: 600 },
      viewportSize,
      amount: 0.5,
      centering: 1,
      currentZoomEnd: current,
    })

    // Keeps the same zoom size but pans toward the new point, clamped so the
    // window stays inside the viewport (max origin is viewport - window).
    expect(result.end.size).toEqual({ widthPx: 500, heightPx: 400 })
    expect(result.end.pointPx).toEqual({ x: 500, y: 400 })
  })

  it('clamps the framing so the zoom window never leaves the viewport', () => {
    const result = resolvePointFocusZoom({
      point: { x: 990, y: 790 },
      viewportSize,
      amount: 0.5,
      centering: 1,
      currentZoomEnd: fullEnd,
    })

    // A centered window at the corner would overflow; it is clamped to the
    // bottom-right, and optimalOffset records how far the ideal was shifted.
    expect(result.end.pointPx).toEqual({ x: 500, y: 400 })
    expect(result.optimalOffset.x).not.toBe(0)
    expect(result.optimalOffset.y).not.toBe(0)
  })
})
