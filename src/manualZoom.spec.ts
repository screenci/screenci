import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Locator, Page } from '@playwright/test'
import { EventRecorder, NOOP_EVENT_RECORDER } from './events.js'
import {
  autoZoom,
  getAutoZoomState,
  setActiveAutoZoomRecorder,
  setActiveZoomPage,
  setAutoZoomState,
  setCurrentZoomViewport,
} from './autoZoom.js'
import { DEFAULT_SCROLL_CENTERING } from './defaults.js'
import { resetZoom, zoomTo } from './manualZoom.js'

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
  getComputedStyle: () => Pick<CSSStyleDeclaration, 'overflowX' | 'overflowY'>
  requestAnimationFrame?: (callback: FrameRequestCallback) => number
  scrollTo: (coords: { top?: number; left?: number; behavior?: string }) => void
}

function makeLocatorMock(options: {
  rect: { x: number; y: number; width: number; height: number }
  viewport: { width: number; height: number }
  scrollSize: { width: number; height: number }
}): Locator {
  let windowScrollY = 0
  let windowScrollX = 0

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
    getComputedStyle: () => ({ overflowX: 'visible', overflowY: 'visible' }),
    requestAnimationFrame: (callback) => {
      setTimeout(() => callback(Date.now()), 1000 / 60)
      return 1
    },
    scrollTo: ({ top, left }) => {
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

  const element = {
    parentElement: null,
    ownerDocument: doc,
    getBoundingClientRect: () => ({
      x: options.rect.x - windowScrollX,
      y: options.rect.y - windowScrollY,
      width: options.rect.width,
      height: options.rect.height,
      top: options.rect.y - windowScrollY,
      left: options.rect.x - windowScrollX,
    }),
  }

  return {
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
      mouse: {
        move: vi.fn().mockResolvedValue(undefined),
      },
    }),
  } as unknown as Locator
}

function makePageMock(viewport = { width: 1280, height: 720 }): Page {
  return {
    viewportSize: vi.fn().mockReturnValue(viewport),
    evaluate: vi.fn(),
  } as unknown as Page
}

describe('manual zoom', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setAutoZoomState({
      insideAutoZoom: false,
      mode: 'idle',
      options: {},
      currentZoomViewport: null,
      scrollCentering: DEFAULT_SCROLL_CENTERING,
    })
    setCurrentZoomViewport(null)
    setActiveAutoZoomRecorder(NOOP_EVENT_RECORDER)
    setActiveZoomPage(null)
  })

  afterEach(() => {
    vi.useRealTimers()
    setActiveAutoZoomRecorder(NOOP_EVENT_RECORDER)
    setActiveZoomPage(null)
  })

  it('records zoomTo(locator) as a focusChange event without click events', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    setActiveAutoZoomRecorder(recorder)

    const locator = makeLocatorMock({
      rect: { x: 900, y: 500, width: 80, height: 40 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 1280, height: 720 },
    })

    const promise = zoomTo(locator, {
      amount: 0.5,
      centering: 1,
      duration: 300,
    })
    await vi.runAllTimersAsync()
    await promise

    const events = recorder.getEvents()
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({
      type: 'input',
      subType: 'focusChange',
    })
    expect(events[1]?.type === 'input' ? events[1].events : []).toHaveLength(1)
    expect(
      events[1]?.type === 'input' ? events[1].events[0]?.type : undefined
    ).toBe('focusChange')
  })

  it('computes a stable point target for zoomTo({ x, y })', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    setActiveAutoZoomRecorder(recorder)
    setActiveZoomPage(makePageMock())

    const promise = zoomTo(
      { x: 1200, y: 700 },
      { amount: 0.5, centering: 1, duration: 300 }
    )
    await vi.runAllTimersAsync()
    await promise

    const events = recorder.getEvents()
    const focusChange =
      events[1]?.type === 'input' && events[1].events[0]?.type === 'focusChange'
        ? events[1].events[0]
        : undefined

    expect(focusChange?.zoom?.end.pointPx).toEqual({ x: 640, y: 360 })
    expect(focusChange?.zoom?.optimalOffset).toEqual({ x: 240, y: 160 })
  })

  it('keeps point zoom sizing unchanged when padding is provided', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    setActiveAutoZoomRecorder(recorder)
    setActiveZoomPage(makePageMock())

    const promise = zoomTo(
      { x: 1200, y: 700 },
      { amount: 0.5, padding: 0.8, centering: 1, duration: 300 }
    )
    await vi.runAllTimersAsync()
    await promise

    const events = recorder.getEvents()
    const focusChange =
      events[1]?.type === 'input' && events[1].events[0]?.type === 'focusChange'
        ? events[1].events[0]
        : undefined

    expect(focusChange?.zoom?.end.size).toEqual({
      widthPx: 640,
      heightPx: 360,
    })
  })

  it('uses padded locator framing when it is larger than the requested amount', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    setActiveAutoZoomRecorder(recorder)

    const locator = makeLocatorMock({
      rect: { x: 900, y: 500, width: 1000, height: 100 },
      viewport: { width: 1280, height: 720 },
      scrollSize: { width: 2200, height: 1600 },
    })

    const promise = zoomTo(locator, {
      amount: 0.65,
      padding: 0.2,
      centering: 1,
      duration: 300,
    })
    await vi.runAllTimersAsync()
    await promise

    const events = recorder.getEvents()
    const focusChange =
      events[1]?.type === 'input' && events[1].events[0]?.type === 'focusChange'
        ? events[1].events[0]
        : undefined

    expect(focusChange?.zoom?.end.size).toEqual({
      widthPx: 1200,
      heightPx: 675,
    })
  })

  it('resetZoom returns to the full viewport from an active manual zoom', async () => {
    const recorder = new EventRecorder()
    recorder.start()
    setActiveAutoZoomRecorder(recorder)
    setActiveZoomPage(makePageMock())

    const zoomPromise = zoomTo(
      { x: 1200, y: 700 },
      { amount: 0.5, centering: 1, duration: 300 }
    )
    await vi.runAllTimersAsync()
    await zoomPromise

    const resetPromise = resetZoom({ duration: 200 })
    await vi.runAllTimersAsync()
    await resetPromise

    const events = recorder.getEvents()
    const resetFocusChange =
      events[2]?.type === 'input' && events[2].events[0]?.type === 'focusChange'
        ? events[2].events[0]
        : undefined

    expect(resetFocusChange?.zoom?.end).toEqual({
      pointPx: { x: 0, y: 0 },
      size: { widthPx: 1280, heightPx: 720 },
    })
    expect(getAutoZoomState().mode).toBe('idle')
  })

  it('throws when autoZoom starts while manual zoom is active, and vice versa', async () => {
    setActiveZoomPage(makePageMock())

    const zoomPromise = zoomTo({ x: 800, y: 400 }, { duration: 100 })
    await vi.runAllTimersAsync()
    await zoomPromise

    await expect(autoZoom(() => {})).rejects.toThrow(
      'Cannot call autoZoom() while manual zoom is active'
    )

    const resetPromise = resetZoom()
    await vi.runAllTimersAsync()
    await resetPromise

    await expect(
      autoZoom(async () => {
        await zoomTo({ x: 400, y: 300 })
      })
    ).rejects.toThrow('Cannot call zoomTo() while autoZoom() is active')
  })
})
