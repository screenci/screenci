import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Locator, Page, FrameLocator } from '@playwright/test'
import type {
  IEventRecorder,
  ElementRect,
  InputEvent,
  FocusChangeEvent,
  MouseMoveEvent,
} from './events.js'
import {
  setActiveClickRecorder,
  instrumentLocator,
  instrumentPage,
} from './instrument.js'
import {
  autoZoom,
  setActiveAutoZoomRecorder,
  setCurrentZoomViewport,
} from './autoZoom.js'
import { hide } from './hide.js'
import { CLICK_DURATION_MS, getMousePosition } from './mouse.js'

type DOMClickData = { x: number; y: number; targetRect: ElementRect }
type ScrollLogicalPosition = 'start' | 'center' | 'end' | 'nearest'

type PageMock = Page & {
  _locatorMock: Locator
  _triggerPopup: (popup: Page) => void
  _triggerDomClick: (data: DOMClickData) => void
}

function makeRecorder() {
  const recordedInputEvents: Array<InputEvent> = []
  const recorder: IEventRecorder = {
    start: vi.fn(),
    addInput: vi.fn(
      (
        subType: InputEvent['subType'],
        elementRect: ElementRect | undefined,
        events: InputEvent['events']
      ) => {
        recordedInputEvents.push({
          type: 'input',
          subType,
          ...(elementRect !== undefined && { elementRect }),
          events,
        } as InputEvent)
      }
    ),
    addCueStart: vi.fn(),
    addCueEnd: vi.fn(),
    addHideStart: vi.fn(),
    addHideEnd: vi.fn(),
    addAutoZoomStart: vi.fn(),
    addAutoZoomEnd: vi.fn(),
    addVideoCueStart: vi.fn(),
    addAssetStart: vi.fn(),
    registerVoiceForLang: vi.fn(),
    getEvents: vi.fn(() => []),
    writeToFile: vi.fn(),
  }
  return { recorder, recordedInputEvents }
}

function makeFrameLocatorMock(pageMock?: PageMock): FrameLocator {
  const locatorReturnMethods: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = [
    'locator',
    'getByAltText',
    'getByLabel',
    'getByPlaceholder',
    'getByRole',
    'getByTestId',
    'getByText',
    'getByTitle',
    'owner',
  ]
  for (const method of methods) {
    locatorReturnMethods[method] = vi
      .fn()
      .mockImplementation(() =>
        makeLocatorMock({ x: 0, y: 0, width: 10, height: 10 }, pageMock)
      )
  }
  const selfReturnMethods: Record<string, ReturnType<typeof vi.fn>> = {}
  const selfMethods = ['frameLocator', 'first', 'last', 'nth']
  for (const method of selfMethods) {
    selfReturnMethods[method] = vi
      .fn()
      .mockImplementation(() => makeFrameLocatorMock(pageMock))
  }
  return {
    ...locatorReturnMethods,
    ...selfReturnMethods,
  } as unknown as FrameLocator
}

function makePageMock(): PageMock {
  let screenciOnClick: ((data: DOMClickData) => void) | null = null
  const popupListeners: Array<(page: Page) => void> = []

  const locatorHolder: { mock: Locator } = { mock: null as unknown as Locator }
  const pageMockHolder: { mock: PageMock } = {
    mock: null as unknown as PageMock,
  }

  const getByMethods: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = [
    'getByAltText',
    'getByLabel',
    'getByPlaceholder',
    'getByRole',
    'getByTestId',
    'getByText',
    'getByTitle',
  ]
  for (const method of methods) {
    getByMethods[method] = vi.fn().mockImplementation(() => locatorHolder.mock)
  }

  const mock = {
    click: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockImplementation(() => locatorHolder.mock),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    mouse: {
      move: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
    },
    keyboard: {
      type: vi.fn().mockResolvedValue(undefined),
    },
    on: vi.fn((event: string, cb: (page: Page) => void) => {
      if (event === 'popup') popupListeners.push(cb)
    }),
    exposeFunction: vi.fn((_name: string, cb: (data: DOMClickData) => void) => {
      screenciOnClick = cb
      return Promise.resolve()
    }),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    frameLocator: vi
      .fn()
      .mockImplementation(() => makeFrameLocatorMock(pageMockHolder.mock)),
    _locatorMock: null as unknown as Locator,
    _triggerPopup: (popup: Page) => {
      for (const cb of popupListeners) cb(popup)
    },
    _triggerDomClick: (data: DOMClickData) => {
      screenciOnClick?.(data)
    },
    ...getByMethods,
  }

  const pageMock = mock as unknown as PageMock
  pageMockHolder.mock = pageMock
  const locatorMock = makeLocatorMock(
    { x: 100, y: 200, width: 80, height: 40 },
    pageMock
  )
  locatorHolder.mock = locatorMock
  mock._locatorMock = locatorMock

  return pageMock
}

function makeLocatorMock(
  bb: { x: number; y: number; width: number; height: number } | null = {
    x: 100,
    y: 200,
    width: 80,
    height: 40,
  },
  pageMock?: PageMock
): Locator {
  const locatorMethods: Record<string, ReturnType<typeof vi.fn>> = {}
  const returnMethods = [
    'locator',
    'getByAltText',
    'getByLabel',
    'getByPlaceholder',
    'getByRole',
    'getByTestId',
    'getByText',
    'getByTitle',
  ]
  for (const method of returnMethods) {
    locatorMethods[method] = vi.fn().mockImplementation(() => makeLocatorMock())
  }
  const locatorOnlyMethods: Record<string, ReturnType<typeof vi.fn>> = {}
  const syncMethods = [
    'and',
    'describe',
    'filter',
    'first',
    'last',
    'nth',
    'or',
  ]
  for (const method of syncMethods) {
    locatorOnlyMethods[method] = vi
      .fn()
      .mockImplementation(() => makeLocatorMock())
  }
  const scrollIntoViewCalls: ScrollLogicalPosition[] = []
  let scrollY = 0
  let scrollX = 0
  const viewport = pageMock?.viewportSize() ?? { width: 1280, height: 720 }
  const win = {
    get innerHeight() {
      return viewport.height
    },
    get innerWidth() {
      return viewport.width
    },
    get scrollY() {
      return scrollY
    },
    get scrollX() {
      return scrollX
    },
    document: undefined,
    getComputedStyle: () =>
      ({ overflowX: 'visible', overflowY: 'visible' }) as CSSStyleDeclaration,
    scrollTo: ({ top, left }: { top?: number; left?: number }) => {
      if (top !== undefined) scrollY = top
      if (left !== undefined) scrollX = left
    },
  }
  const doc = {
    defaultView: win,
    documentElement: {
      clientHeight: viewport.height,
      clientWidth: viewport.width,
      scrollHeight: 4000,
      scrollWidth: 4000,
    },
    body: {
      scrollHeight: 4000,
      scrollWidth: 4000,
    },
  }
  const element = {
    parentElement: null,
    ownerDocument: doc,
    getBoundingClientRect: () => {
      if (!bb) {
        return {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          toJSON: () => undefined,
        }
      }
      return {
        x: bb.x - scrollX,
        y: bb.y - scrollY,
        width: bb.width,
        height: bb.height,
        top: bb.y - scrollY,
        left: bb.x - scrollX,
        right: bb.x - scrollX + bb.width,
        bottom: bb.y - scrollY + bb.height,
        toJSON: () => undefined,
      }
    },
  }
  const mock = {
    click: vi.fn(),
    fill: vi.fn().mockResolvedValue(undefined),
    pressSequentially: vi.fn().mockResolvedValue(undefined),
    tap: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue(undefined),
    uncheck: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue([]),
    hover: vi.fn().mockResolvedValue(undefined),
    selectText: vi.fn().mockResolvedValue(undefined),
    dragTo: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation(async (fn: unknown, arg: unknown) => {
      const opts = arg as { block?: ScrollLogicalPosition } | undefined
      scrollIntoViewCalls.push(opts?.block ?? 'center')
      if (typeof fn === 'function') {
        try {
          return (fn as (el: typeof element, arg: unknown) => unknown)(
            element,
            arg
          )
        } catch (error) {
          if (
            error instanceof ReferenceError &&
            (error.message.includes('HTMLInputElement') ||
              error.message.includes('HTMLTextAreaElement') ||
              error.message.includes('HTMLElement'))
          ) {
            return undefined
          }
          throw error
        }
      }
      return undefined
    }),
    boundingBox: vi.fn().mockResolvedValue(bb),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue(undefined),
    all: vi.fn().mockResolvedValue([]),
    page: vi.fn().mockReturnValue(pageMock),
    contentFrame: vi
      .fn()
      .mockImplementation(() => makeFrameLocatorMock(pageMock)),
    frameLocator: vi
      .fn()
      .mockImplementation(() => makeFrameLocatorMock(pageMock)),
    _scrollIntoViewCalls: scrollIntoViewCalls,
    ...locatorMethods,
    ...locatorOnlyMethods,
  }
  mock.click.mockImplementation(async () => {
    if (pageMock) {
      const currentBb = await mock.boundingBox()
      const targetRect: ElementRect = currentBb
        ? {
            x: currentBb.x,
            y: currentBb.y,
            width: currentBb.width,
            height: currentBb.height,
          }
        : { x: 0, y: 0, width: 0, height: 0 }
      const x = currentBb ? currentBb.x + currentBb.width / 2 : 0
      const y = currentBb ? currentBb.y + currentBb.height / 2 : 0
      pageMock._triggerDomClick({ x, y, targetRect })
    }
  })
  return mock as unknown as Locator
}

function makeScrollLocatorMock(options: {
  rect: { x: number; y: number; width: number; height: number }
  viewport: { width: number; height: number }
  scrollSize: { width: number; height: number }
}) {
  const scrollCalls: Array<{ top: number; left: number }> = []
  let scrollY = 0
  let scrollX = 0

  const win = {
    get innerHeight() {
      return options.viewport.height
    },
    get innerWidth() {
      return options.viewport.width
    },
    get scrollY() {
      return scrollY
    },
    get scrollX() {
      return scrollX
    },
    document: undefined,
    scrollTo: vi.fn((coords: { top?: number; left?: number }) => {
      if (coords.top !== undefined) scrollY = coords.top
      if (coords.left !== undefined) scrollX = coords.left
      scrollCalls.push({ top: scrollY, left: scrollX })
    }),
  }

  const element = {
    ownerDocument: {
      defaultView: win,
      documentElement: {
        clientHeight: options.viewport.height,
        clientWidth: options.viewport.width,
        scrollHeight: options.scrollSize.height,
        scrollWidth: options.scrollSize.width,
      },
      body: {
        scrollHeight: options.scrollSize.height,
        scrollWidth: options.scrollSize.width,
      },
    },
    getBoundingClientRect: () => ({
      x: options.rect.x - scrollX,
      y: options.rect.y - scrollY,
      top: options.rect.y - scrollY,
      left: options.rect.x - scrollX,
      width: options.rect.width,
      height: options.rect.height,
      right: options.rect.x - scrollX + options.rect.width,
      bottom: options.rect.y - scrollY + options.rect.height,
      toJSON: () => undefined,
    }),
    scrollIntoView: vi.fn(),
  }

  const locator = {
    evaluate: vi.fn(
      async (fn: (el: typeof element, arg: unknown) => unknown, arg: unknown) =>
        fn(element, arg)
    ),
  }

  return {
    locator: locator as unknown as Locator,
    scrollCalls,
    win,
  }
}

function makeNestedScrollLocatorMock() {
  const scrollCalls: Array<{ target: string; top: number; left: number }> = []
  let windowScrollY = 0
  let windowScrollX = 0
  let outerScrollTop = 0
  let outerScrollLeft = 0
  let innerScrollTop = 0
  let innerScrollLeft = 0

  const autoStyle = {
    overflowY: 'auto',
    overflowX: 'auto',
  } as CSSStyleDeclaration
  const visibleStyle = {
    overflowY: 'visible',
    overflowX: 'visible',
  } as CSSStyleDeclaration

  const win = {
    get innerHeight() {
      return 720
    },
    get innerWidth() {
      return 1280
    },
    get scrollY() {
      return windowScrollY
    },
    get scrollX() {
      return windowScrollX
    },
    document: undefined,
    getComputedStyle: (node: unknown) =>
      node === outer || node === inner ? autoStyle : visibleStyle,
    scrollTo: vi.fn((coords: { top?: number; left?: number }) => {
      if (coords.top !== undefined) windowScrollY = coords.top
      if (coords.left !== undefined) windowScrollX = coords.left
      scrollCalls.push({
        target: 'window',
        top: windowScrollY,
        left: windowScrollX,
      })
    }),
  }

  const doc = {
    defaultView: win,
    documentElement: {
      clientHeight: 720,
      clientWidth: 1280,
      scrollHeight: 2600,
      scrollWidth: 1280,
    },
    body: {
      scrollHeight: 2600,
      scrollWidth: 1280,
    },
  }

  const outer = {
    parentElement: null,
    ownerDocument: doc,
    clientHeight: 240,
    clientWidth: 600,
    scrollHeight: 560,
    scrollWidth: 600,
    get scrollTop() {
      return outerScrollTop
    },
    set scrollTop(value: number) {
      outerScrollTop = value
      scrollCalls.push({
        target: 'outer',
        top: outerScrollTop,
        left: outerScrollLeft,
      })
    },
    get scrollLeft() {
      return outerScrollLeft
    },
    set scrollLeft(value: number) {
      outerScrollLeft = value
    },
    getBoundingClientRect: () => ({
      top: 900 - windowScrollY,
      left: 40 - windowScrollX,
      width: 600,
      height: 240,
      x: 40 - windowScrollX,
      y: 900 - windowScrollY,
      right: 640 - windowScrollX,
      bottom: 1140 - windowScrollY,
      toJSON: () => undefined,
    }),
  }

  const inner = {
    parentElement: outer as unknown as Element,
    ownerDocument: doc,
    clientHeight: 160,
    clientWidth: 500,
    scrollHeight: 420,
    scrollWidth: 500,
    get scrollTop() {
      return innerScrollTop
    },
    set scrollTop(value: number) {
      innerScrollTop = value
      scrollCalls.push({
        target: 'inner',
        top: innerScrollTop,
        left: innerScrollLeft,
      })
    },
    get scrollLeft() {
      return innerScrollLeft
    },
    set scrollLeft(value: number) {
      innerScrollLeft = value
    },
    getBoundingClientRect: () => ({
      top: 900 - windowScrollY - outerScrollTop + 180,
      left: 40 - windowScrollX - outerScrollLeft + 12,
      width: 500,
      height: 160,
      x: 52 - windowScrollX - outerScrollLeft,
      y: 1080 - windowScrollY - outerScrollTop,
      right: 552 - windowScrollX - outerScrollLeft,
      bottom: 1240 - windowScrollY - outerScrollTop,
      toJSON: () => undefined,
    }),
  }

  const target = {
    parentElement: inner as unknown as Element,
    ownerDocument: doc,
    getBoundingClientRect: () => ({
      top: 900 - windowScrollY - outerScrollTop - innerScrollTop + 180 + 220,
      left: 40 - windowScrollX - outerScrollLeft - innerScrollLeft + 24,
      width: 120,
      height: 40,
      x: 64 - windowScrollX - outerScrollLeft - innerScrollLeft,
      y: 1120 - windowScrollY - outerScrollTop - innerScrollTop,
      right: 184 - windowScrollX - outerScrollLeft - innerScrollLeft,
      bottom: 1160 - windowScrollY - outerScrollTop - innerScrollTop,
      toJSON: () => undefined,
    }),
  }

  const locator = {
    evaluate: vi.fn(
      async (fn: (el: typeof target, arg: unknown) => unknown, arg: unknown) =>
        fn(target, arg)
    ),
  }

  return {
    locator: locator as unknown as Locator,
    state: {
      get windowScrollY() {
        return windowScrollY
      },
      get outerScrollTop() {
        return outerScrollTop
      },
      get innerScrollTop() {
        return innerScrollTop
      },
      scrollCalls,
    },
  }
}

beforeEach(() => {
  setActiveClickRecorder(null)
  setActiveAutoZoomRecorder(null)
  setCurrentZoomViewport(null)
  vi.useFakeTimers()
})

afterEach(() => {
  setActiveClickRecorder(null)
  setActiveAutoZoomRecorder(null)
  setCurrentZoomViewport(null)
  vi.useRealTimers()
})

describe('instrumentLocator', () => {
  it('records a single click InputEvent with inner focusChange, mouseDown, mouseUp', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const bb = { x: 100, y: 200, width: 80, height: 40 }
    const locator = makeLocatorMock(bb, page)
    instrumentLocator(locator)
    await Promise.all([locator.click(), vi.runAllTimersAsync()])

    expect(recordedInputEvents).toHaveLength(1)
    const click = recordedInputEvents[0]!
    expect(click.subType).toBe('click')
    expect(click.events.some((e) => e.type === 'focusChange')).toBe(true)
    expect(click.events.some((e) => e.type === 'mouseDown')).toBe(true)
    expect(click.events.some((e) => e.type === 'mouseUp')).toBe(true)
  })

  it('prefers actual DOM click coordinates and rect for recorded clicks', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const bb = { x: 100, y: 200, width: 80, height: 40 }
    const locator = makeLocatorMock(bb, page)
    ;(locator.click as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        page._triggerDomClick({
          x: 118,
          y: 214,
          targetRect: { x: 110, y: 206, width: 80, height: 40 },
        })
      }
    )

    instrumentLocator(locator)
    await Promise.all([
      (
        locator as unknown as {
          click(options?: {
            moveDuration?: number
            position?: { x: number; y: number }
          }): Promise<void>
        }
      ).click({ moveDuration: 100, position: { x: 8, y: 8 } }),
      vi.runAllTimersAsync(),
    ])

    const click = recordedInputEvents[0]!
    const move = click.events.find(
      (event): event is FocusChangeEvent | MouseMoveEvent =>
        event.type === 'focusChange' || event.type === 'mouseMove'
    )

    expect(click.elementRect).toBeUndefined()
    expect(move).toBeDefined()
  })

  it('tracks locator position clicks in viewport coordinates', async () => {
    const page = makePageMock()
    await instrumentPage(page)

    const bb = { x: 100, y: 200, width: 80, height: 40 }
    const locator = makeLocatorMock(bb, page)
    instrumentLocator(locator)

    await Promise.all([
      (
        locator as unknown as {
          click(options?: {
            position?: { x: number; y: number }
          }): Promise<void>
        }
      ).click({ position: { x: 8, y: 8 } }),
      vi.runAllTimersAsync(),
    ])

    expect(getMousePosition(page)).toEqual({ x: 108, y: 208 })
  })

  it('snaps the real mouse after scroll while keeping the recorded move duration', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 900, width: 80, height: 40 },
      page
    )
    const originalEvaluate = (
      locator.evaluate as ReturnType<typeof vi.fn>
    ).getMockImplementation()!
    ;(locator.evaluate as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: unknown, arg: unknown) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 600))
        return originalEvaluate(fn, arg)
      }
    )

    instrumentLocator(locator)
    await Promise.all([
      (
        locator as unknown as {
          click(options?: { moveDuration?: number }): Promise<void>
        }
      ).click({ moveDuration: 1000 }),
      vi.runAllTimersAsync(),
    ])

    const click = recordedInputEvents[0]!
    const move = click.events.find(
      (event): event is FocusChangeEvent | MouseMoveEvent =>
        event.type === 'focusChange' || event.type === 'mouseMove'
    )

    expect(move).toMatchObject({
      type: 'focusChange',
      scroll: expect.objectContaining({
        startMs: expect.any(Number),
        endMs: expect.any(Number),
      }),
    })
  })

  it('starts the first autoZoom click move after scroll completes', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 900, width: 80, height: 40 },
      page
    )
    const originalEvaluate = (
      locator.evaluate as ReturnType<typeof vi.fn>
    ).getMockImplementation()!
    ;(locator.evaluate as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: unknown, arg: unknown) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 600))
        return originalEvaluate(fn, arg)
      }
    )

    instrumentLocator(locator)
    const p = autoZoom(
      async () => {
        await (
          locator as unknown as {
            click(options?: { moveDuration?: number }): Promise<void>
          }
        ).click({ moveDuration: 1000 })
      },
      { duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await p

    const click = recordedInputEvents[0]!
    const move = click.events.find(
      (event): event is FocusChangeEvent | MouseMoveEvent =>
        event.type === 'focusChange' || event.type === 'mouseMove'
    )

    expect(move).toMatchObject({
      type: 'focusChange',
      zoom: expect.objectContaining({
        startMs: expect.any(Number),
        endMs: expect.any(Number),
      }),
    })
  })

  it('keeps later autoZoom click moves overlapping the scroll timing', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 900, width: 80, height: 40 },
      page
    )
    const originalEvaluate = (
      locator.evaluate as ReturnType<typeof vi.fn>
    ).getMockImplementation()!
    ;(locator.evaluate as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: unknown, arg: unknown) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 600))
        return originalEvaluate(fn, arg)
      }
    )

    instrumentLocator(locator)
    const p = autoZoom(
      async () => {
        setCurrentZoomViewport({
          focusPoint: { x: 120, y: 140 },
          elementRect: { x: 100, y: 120, width: 80, height: 40 },
          end: {
            pointPx: { x: 10, y: 20 },
            size: { widthPx: 640, heightPx: 360 },
          },
          viewportSize: { width: 1280, height: 720 },
        })
        await (
          locator as unknown as {
            click(options?: { moveDuration?: number }): Promise<void>
          }
        ).click({ moveDuration: 1000 })
      },
      { duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await p

    const click = recordedInputEvents[0]!
    const move = click.events.find(
      (event): event is FocusChangeEvent | MouseMoveEvent =>
        event.type === 'focusChange' || event.type === 'mouseMove'
    )

    expect(move).toMatchObject({
      type: 'focusChange',
      zoom: expect.objectContaining({
        startMs: expect.any(Number),
        endMs: expect.any(Number),
      }),
    })
  })

  it('records click timing for check without click inside autoZoom', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const bb = { x: 100, y: 200, width: 80, height: 40 }
    const locator = makeLocatorMock(bb, page)
    const checkMock = locator.check as ReturnType<typeof vi.fn>
    instrumentLocator(locator)

    const p = autoZoom(
      async () => {
        await locator.check()
      },
      { duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    expect(checkMock).toHaveBeenCalledTimes(2)

    await p

    expect(recordedInputEvents).toHaveLength(1)
    const check = recordedInputEvents[0]!
    expect(check.subType).toBe('check')
    expect(check.events.some((e) => e.type === 'mouseDown')).toBe(true)
    expect(check.events.some((e) => e.type === 'mouseUp')).toBe(true)
  })

  it('does not synthesize mouse presses for fill without click inside autoZoom', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const bb = { x: 100, y: 200, width: 80, height: 40 }
    const locator = makeLocatorMock(bb, page)
    instrumentLocator(locator)

    const keyboardType = (
      page as unknown as { keyboard: { type: ReturnType<typeof vi.fn> } }
    ).keyboard.type

    const p = autoZoom(
      async () => {
        await (
          locator.fill as (
            value: string,
            options?: { duration?: number }
          ) => Promise<void>
        )('hi', { duration: 100 })
      },
      { duration: 0, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await p

    expect(keyboardType).toHaveBeenCalledOnce()

    expect(recordedInputEvents).toHaveLength(1)
    const fill = recordedInputEvents[0]!
    expect(fill.subType).toBe('pressSequentially')
    expect(fill.events.some((e) => e.type === 'mouseDown')).toBe(false)
    expect(fill.events.some((e) => e.type === 'mouseUp')).toBe(false)
  })

  it('records fill-with-click through the shared scroll-first click path before typing', async () => {
    const { recorder } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    instrumentLocator(locator)

    const keyboardType = (
      page as unknown as { keyboard: { type: ReturnType<typeof vi.fn> } }
    ).keyboard.type

    const p = autoZoom(
      async () => {
        await (
          locator.fill as (
            value: string,
            options?: {
              duration?: number
              click?: {
                moveDuration?: number
                beforeClickPause?: number
                postClickPause?: number
              }
            }
          ) => Promise<void>
        )('hi', {
          duration: 100,
          click: { moveDuration: 0, beforeClickPause: 0, postClickPause: 0 },
        })
      },
      { duration: 300, postZoomDelay: 0 }
    )

    await vi.runAllTimersAsync()
    await p

    expect(keyboardType).toHaveBeenCalledOnce()
    expect(recorder.addInput).toHaveBeenCalledWith(
      'pressSequentially',
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ type: 'mouseDown' }),
        expect.objectContaining({ type: 'mouseUp' }),
      ])
    )
  })

  it('records fixed click timing for check-with-click after scrolling', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 1200, width: 18, height: 18 },
      page
    )
    const checkMock = locator.check as ReturnType<typeof vi.fn>
    instrumentLocator(locator)

    await Promise.all([
      (
        locator.check as (options?: {
          click?: {
            moveDuration?: number
            beforeClickPause?: number
            postClickPause?: number
          }
        }) => Promise<void>
      )({
        click: { moveDuration: 0, beforeClickPause: 0, postClickPause: 0 },
      }),
      vi.runAllTimersAsync(),
    ])

    expect(recordedInputEvents).toHaveLength(1)
    const check = recordedInputEvents[0]!
    expect(check.subType).toBe('check')
    expect(checkMock).toHaveBeenCalledWith({
      position: { x: 9, y: 9 },
      trial: true,
    })
    expect(checkMock).toHaveBeenCalledWith({ position: { x: 9, y: 9 } })

    const down = check.events.find((e) => e.type === 'mouseDown')
    const up = check.events.find((e) => e.type === 'mouseUp')
    expect(down).toBeDefined()
    expect(up).toBeDefined()
    if (down?.type !== 'mouseDown' || up?.type !== 'mouseUp') {
      throw new Error('Expected mouseDown and mouseUp events')
    }

    expect(down.endMs - down.startMs).toBe(CLICK_DURATION_MS / 2)
    expect(up.endMs - up.startMs).toBe(CLICK_DURATION_MS / 2)
    expect(up.endMs - down.startMs).toBe(CLICK_DURATION_MS)
  })

  it('records a hover InputEvent with inner focusChange and mouseWait', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const bb = { x: 100, y: 200, width: 80, height: 40 }
    const locator = makeLocatorMock(bb, page)
    instrumentLocator(locator)
    await Promise.all([
      (
        locator as unknown as {
          hover(opts?: {
            moveDuration?: number
            hoverDuration?: number
          }): Promise<void>
        }
      ).hover({ moveDuration: 100, hoverDuration: 50 }),
      vi.runAllTimersAsync(),
    ])

    expect(recordedInputEvents).toHaveLength(1)
    const hover = recordedInputEvents[0]!
    expect(hover.subType).toBe('hover')
    expect(hover.events.some((e) => e.type === 'focusChange')).toBe(true)
    expect(hover.events.some((e) => e.type === 'mouseWait')).toBe(true)
  })

  it('records a selectText InputEvent with focusChange and 3 down+up pairs', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const bb = { x: 100, y: 200, width: 80, height: 40 }
    const locator = makeLocatorMock(bb, page)
    instrumentLocator(locator)
    await Promise.all([
      (
        locator as unknown as {
          selectText(opts?: {
            moveDuration?: number
            selectDuration?: number
          }): Promise<void>
        }
      ).selectText({ moveDuration: 100, selectDuration: 60 }),
      vi.runAllTimersAsync(),
    ])

    expect(recordedInputEvents).toHaveLength(1)
    const ev = recordedInputEvents[0]!
    expect(ev.subType).toBe('selectText')
    expect(ev.events.some((e) => e.type === 'focusChange')).toBe(true)
    const downs = ev.events.filter((e) => e.type === 'mouseDown')
    const ups = ev.events.filter((e) => e.type === 'mouseUp')
    expect(downs).toHaveLength(3)
    expect(ups).toHaveLength(3)
  })

  it('records a dragTo InputEvent with mouseMove, mouseDown, mouseMove, mouseUp', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const sourceBb = { x: 50, y: 100, width: 60, height: 30 }
    const targetBb = { x: 300, y: 200, width: 60, height: 30 }
    const sourceLocator = makeLocatorMock(sourceBb, page)
    const targetLocator = makeLocatorMock(targetBb, page)
    instrumentLocator(sourceLocator)
    await Promise.all([
      (
        sourceLocator as unknown as {
          dragTo(
            target: typeof targetLocator,
            opts?: { moveDuration?: number; dragDuration?: number }
          ): Promise<void>
        }
      ).dragTo(targetLocator, { moveDuration: 100, dragDuration: 100 }),
      vi.runAllTimersAsync(),
    ])

    expect(recordedInputEvents).toHaveLength(1)
    const ev = recordedInputEvents[0]!
    expect(ev.subType).toBe('dragTo')
    const moves = ev.events.filter(
      (e): e is MouseMoveEvent => e.type === 'mouseMove'
    )
    expect(moves).toHaveLength(2)
    expect(moves[1]?.elementRect).toEqual(targetBb)
    expect(ev.events.some((e) => e.type === 'mouseDown')).toBe(true)
    expect(ev.events.some((e) => e.type === 'mouseUp')).toBe(true)
  })

  it('instruments fill to record a pressSequentially InputEvent with inner mouseHide when hideMouse: true', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(undefined, page)
    instrumentLocator(locator)

    await Promise.all([
      // hideMouse is a screenci extension; cast past Playwright's native fill type
      (
        locator.fill as (
          v: string,
          opts: { hideMouse: boolean }
        ) => Promise<void>
      )('hi', { hideMouse: true }),
      vi.runAllTimersAsync(),
    ])

    expect(recordedInputEvents).toHaveLength(1)
    const pressSeq = recordedInputEvents[0]!
    expect(pressSeq.subType).toBe('pressSequentially')
    expect(pressSeq.events.some((e) => e.type === 'mouseHide')).toBe(true)
  })

  it('uses original interactions and skips recording inside hide()', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const locator = makeLocatorMock()
    const originalClick = locator.click
    const originalFill = locator.fill
    const originalPressSequentially = locator.pressSequentially
    const originalCheck = locator.check
    const originalUncheck = locator.uncheck
    const originalSelectOption = locator.selectOption

    instrumentLocator(locator)

    await hide(async () => {
      await (
        locator.click as (options?: {
          moveDuration?: number
          moveSpeed?: number
          beforeClickPause?: number
          moveEasing?: string
          postClickPause?: number
        }) => Promise<void>
      )({ moveDuration: 10 })

      await (
        locator.fill as (
          value: string,
          options?: { duration?: number; hideMouse?: boolean }
        ) => Promise<void>
      )('value', { duration: 300, hideMouse: true })

      await locator.pressSequentially('value', {
        delay: 10,
        hideMouse: true,
      } as unknown as Parameters<Locator['pressSequentially']>[1])

      await (locator.check as (options?: { click?: unknown }) => Promise<void>)(
        { click: {} }
      )
      await (
        locator.uncheck as (options?: { click?: unknown }) => Promise<void>
      )({ click: {} })
      await (
        locator.selectOption as (
          values: string,
          options?: { click?: unknown; position?: { x: number; y: number } }
        ) => Promise<string[]>
      )('one', { click: {}, position: { x: 1, y: 1 } })
    })

    expect(recordedInputEvents).toHaveLength(0)
    expect(recorder.addInput).not.toHaveBeenCalled()

    expect(originalClick).toHaveBeenCalledTimes(1)
    expect(originalFill).toHaveBeenCalledTimes(1)
    expect(originalPressSequentially).toHaveBeenCalledTimes(1)
    expect(originalCheck).toHaveBeenCalledTimes(1)
    expect(originalUncheck).toHaveBeenCalledTimes(1)
    expect(originalSelectOption).toHaveBeenCalledTimes(1)
  })
})
