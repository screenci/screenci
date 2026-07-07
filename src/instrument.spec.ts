import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  Locator,
  Page,
  FrameLocator,
  Request,
  Route,
} from '@playwright/test'
import type {
  IEventRecorder,
  ElementRect,
  InputEvent,
  FocusChangeEvent,
  MouseMoveEvent,
} from './events.js'
import { NOOP_EVENT_RECORDER } from './events.js'
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
import { DEFAULT_CLICK_MOUSE_MOVE_DURATION } from './defaults.js'
import { hide } from './hide.js'
import { CLICK_DURATION_MS, getMousePosition } from './mouse.js'
import { SCREENCI_DISABLE_RECORDING_TIMINGS_ENV } from './runtimeMode.js'
import { logger } from './logger.js'

type DOMClickData = { x: number; y: number; targetRect: ElementRect }
type ScrollLogicalPosition = 'start' | 'center' | 'end' | 'nearest'

const DEFAULT_POST_TYPING_SETTLE_PAUSE_MS = CLICK_DURATION_MS / 2

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
    addStudioCueStart: vi.fn(),
    addCueEnd: vi.fn(),
    addHideStart: vi.fn(),
    addHideEnd: vi.fn(),
    addSpeedStart: vi.fn(),
    addSpeedEnd: vi.fn(),
    addTimeStart: vi.fn(),
    addTimeEnd: vi.fn(),
    addStudioAssetStart: vi.fn(),
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
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    route: vi.fn().mockResolvedValue(undefined),
    unroute: vi.fn().mockResolvedValue(undefined),
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

function makeRequestMock(params: {
  url: string
  resourceType: string
}): Request {
  return {
    url: vi.fn(() => params.url),
    resourceType: vi.fn(() => params.resourceType),
  } as unknown as Request
}

function makeRouteMock(): { route: Route; fulfill: ReturnType<typeof vi.fn> } {
  const fulfill = vi.fn().mockResolvedValue(undefined)
  return {
    route: {
      fulfill,
    } as unknown as Route,
    fulfill,
  }
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
    activeElement: null as unknown,
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
    tagName: 'INPUT',
    parentElement: null,
    ownerDocument: doc,
    focus: vi.fn(() => {
      doc.activeElement = element
    }),
    select: vi.fn(),
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
  ;(mock as unknown as { _element: typeof element })._element = element
  ;(mock as unknown as { _doc: typeof doc })._doc = doc
  return mock as unknown as Locator
}

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  setActiveClickRecorder(NOOP_EVENT_RECORDER)
  setActiveAutoZoomRecorder(NOOP_EVENT_RECORDER)
  setCurrentZoomViewport(null)
  vi.useFakeTimers()
})

afterEach(() => {
  process.env = originalEnv
  setActiveClickRecorder(NOOP_EVENT_RECORDER)
  setActiveAutoZoomRecorder(NOOP_EVENT_RECORDER)
  setCurrentZoomViewport(null)
  vi.useRealTimers()
})

describe('instrumentPage', () => {
  it('collapses page.waitForTimeout during plain screenci test runs', async () => {
    process.env.SCREENCI_DISABLE_RECORDING_TIMINGS = 'true'
    const page = makePageMock()
    const originalWaitForTimeout = page.waitForTimeout as ReturnType<
      typeof vi.fn
    >

    await instrumentPage(page)
    await page.waitForTimeout(750)

    expect(originalWaitForTimeout).toHaveBeenCalledWith(0)
  })

  it('keeps page.waitForTimeout duration during mock-record runs', async () => {
    process.env.SCREENCI_DISABLE_RECORDING_TIMINGS = 'true'
    process.env.SCREENCI_MOCK_RECORD = 'true'
    const page = makePageMock()
    const originalWaitForTimeout = page.waitForTimeout as ReturnType<
      typeof vi.fn
    >

    await instrumentPage(page)
    await page.waitForTimeout(750)

    expect(originalWaitForTimeout).toHaveBeenCalledWith(750)
  })

  it('fails fast when a route mock fulfills a module request with JSON', async () => {
    const page = makePageMock()
    const originalRoute = page.route as ReturnType<typeof vi.fn>
    const handler = vi.fn(async (route: Route) => {
      await route.fulfill({ json: { recipes: [] } })
    })

    await instrumentPage(page)
    await page.route('**/api/recipes', handler)

    const wrappedHandler = originalRoute.mock.calls[0]![1] as (
      route: Route,
      request: Request
    ) => Promise<void>
    const request = makeRequestMock({
      url: 'http://localhost:5173/src/pages/recipes/RecipeList.tsx',
      resourceType: 'script',
    })
    const { route, fulfill } = makeRouteMock()

    await expect(wrappedHandler(route, request)).rejects.toThrow(
      /fulfilled a script request/
    )
    expect(fulfill).not.toHaveBeenCalled()
  })

  it('allows route mocks to fulfill fetch requests with JSON', async () => {
    const page = makePageMock()
    const originalRoute = page.route as ReturnType<typeof vi.fn>
    const handler = vi.fn(async (route: Route) => {
      await route.fulfill({ json: { recipes: [] } })
    })

    await instrumentPage(page)
    await page.route('http://localhost:5173/api/recipes', handler)

    const wrappedHandler = originalRoute.mock.calls[0]![1] as (
      route: Route,
      request: Request
    ) => Promise<void>
    const request = makeRequestMock({
      url: 'http://localhost:5173/api/recipes',
      resourceType: 'fetch',
    })
    const { route, fulfill } = makeRouteMock()

    await expect(wrappedHandler(route, request)).resolves.toBeUndefined()
    expect(fulfill).toHaveBeenCalledWith({ json: { recipes: [] } })
  })

  it('removes the wrapped route handler when unroute receives the original handler', async () => {
    const page = makePageMock()
    const originalRoute = page.route as ReturnType<typeof vi.fn>
    const originalUnroute = page.unroute as ReturnType<typeof vi.fn>
    const handler = vi.fn()

    await instrumentPage(page)
    await page.route('**/api/recipes', handler)
    await page.unroute('**/api/recipes', handler)

    const wrappedHandler = originalRoute.mock.calls[0]![1]
    expect(wrappedHandler).not.toBe(handler)
    expect(originalUnroute).toHaveBeenCalledWith(
      '**/api/recipes',
      wrappedHandler
    )
  })

  it('records bare page.mouse.move with default duration', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    const originalMove = page.mouse.move as ReturnType<typeof vi.fn>
    await instrumentPage(page)

    const movePromise = page.mouse.move(300, 400)
    await vi.runAllTimersAsync()
    await movePromise

    expect(recordedInputEvents).toHaveLength(1)
    const moveInput = recordedInputEvents[0]!
    const move = moveInput.events[0] as FocusChangeEvent | undefined

    expect(moveInput.subType).toBe('focusChange')
    expect(move).toBeDefined()
    expect(move).toMatchObject({
      type: 'focusChange',
      x: 300,
      y: 400,
      mouse: expect.objectContaining({ easing: 'ease-in-out' }),
    })
    // A bare move animates by default: it spans a non-zero duration and is
    // dispatched in multiple interpolated steps rather than a single jump.
    expect(move!.endMs).toBeGreaterThan(move!.startMs)
    expect(originalMove.mock.calls.length).toBeGreaterThan(1)
  })

  it('does not attach a zoom to a bare cursor move outside autoZoom', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const movePromise = page.mouse.move(300, 400)
    await vi.runAllTimersAsync()
    await movePromise

    const move = recordedInputEvents[0]!.events[0] as FocusChangeEvent
    expect(move.zoom).toBeUndefined()
  })

  it('follows the cursor with a zoom while inside autoZoom', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)
    setActiveAutoZoomRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const run = autoZoom(async () => {
      await page.mouse.move(300, 400)
    })
    await vi.runAllTimersAsync()
    await run

    const focusChanges = recordedInputEvents
      .filter((event) => event.subType === 'focusChange')
      .map((event) => event.events[0] as FocusChangeEvent)

    const move = focusChanges.find(
      (event) => event.x === 300 && event.y === 400
    )
    expect(move).toBeDefined()
    // The camera zoomed IN to frame the cursor: its zoom window is smaller than
    // the 1280x720 viewport instead of leaving the camera where it was.
    expect(move!.zoom).toBeDefined()
    expect(move!.zoom!.end.size.widthPx).toBeGreaterThan(0)
    expect(move!.zoom!.end.size.widthPx).toBeLessThan(1280)

    // The move established a zoom viewport, so the block zooms back out to the
    // full viewport when it ends. That zoom-out only fires when a current zoom
    // viewport exists, confirming the move updated it.
    const zoomOut = focusChanges.find(
      (event) => event.zoom?.end.size.widthPx === 1280
    )
    expect(zoomOut).toBeDefined()
  })

  it('records page.mouse.down as a mouseDown InputEvent and dispatches the real press', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    const originalDown = page.mouse.down as ReturnType<typeof vi.fn>
    await instrumentPage(page)

    await Promise.all([page.mouse.down(), vi.runAllTimersAsync()])

    expect(recordedInputEvents).toHaveLength(1)
    const input = recordedInputEvents[0]!
    expect(input.subType).toBe('mouseDown')
    expect(input.events).toHaveLength(1)
    const down = input.events[0]!
    expect(down.type).toBe('mouseDown')
    expect(down.endMs - down.startMs).toBe(CLICK_DURATION_MS / 2)
    expect(originalDown).toHaveBeenCalledTimes(1)
  })

  it('records page.mouse.up as a mouseUp InputEvent and dispatches the real release', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    const originalUp = page.mouse.up as ReturnType<typeof vi.fn>
    await instrumentPage(page)

    await Promise.all([page.mouse.up(), vi.runAllTimersAsync()])

    expect(recordedInputEvents).toHaveLength(1)
    const input = recordedInputEvents[0]!
    expect(input.subType).toBe('mouseUp')
    expect(input.events).toHaveLength(1)
    expect(input.events[0]!.type).toBe('mouseUp')
    expect(originalUp).toHaveBeenCalledTimes(1)
  })

  it('fake page.mouse.down records the same event but dispatches no real press', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    const originalDown = page.mouse.down as ReturnType<typeof vi.fn>
    await instrumentPage(page)

    await Promise.all([page.mouse.down({ fake: true }), vi.runAllTimersAsync()])

    expect(recordedInputEvents).toHaveLength(1)
    const input = recordedInputEvents[0]!
    expect(input.subType).toBe('mouseDown')
    expect(input.events[0]!.type).toBe('mouseDown')
    expect(input.events[0]!.endMs - input.events[0]!.startMs).toBe(
      CLICK_DURATION_MS / 2
    )
    expect(originalDown).not.toHaveBeenCalled()
  })

  it('honors the duration option on page.mouse.down', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    await Promise.all([
      page.mouse.down({ duration: 500 }),
      vi.runAllTimersAsync(),
    ])

    const down = recordedInputEvents[0]!.events[0]!
    expect(down.endMs - down.startMs).toBe(500)
  })

  it('records page.mouse.click as a click InputEvent (focusChange + press) and lands the cursor', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    const originalClick = page.mouse.click as ReturnType<typeof vi.fn>
    await instrumentPage(page)

    await Promise.all([page.mouse.click(300, 400), vi.runAllTimersAsync()])

    expect(recordedInputEvents).toHaveLength(1)
    const click = recordedInputEvents[0]!
    expect(click.subType).toBe('click')
    expect(click.events.some((e) => e.type === 'focusChange')).toBe(true)
    expect(click.events.filter((e) => e.type === 'mouseDown')).toHaveLength(1)
    expect(click.events.filter((e) => e.type === 'mouseUp')).toHaveLength(1)
    expect(originalClick).toHaveBeenCalledTimes(1)
    expect(getMousePosition(page)).toEqual({ x: 300, y: 400 })
  })

  it('fake page.mouse.click records the same events but dispatches no real click', async () => {
    const { recorder, recordedInputEvents: real } = makeRecorder()
    setActiveClickRecorder(recorder)
    const realPage = makePageMock()
    const realClick = realPage.mouse.click as ReturnType<typeof vi.fn>
    await instrumentPage(realPage)
    await Promise.all([realPage.mouse.click(300, 400), vi.runAllTimersAsync()])

    const { recorder: fakeRecorder, recordedInputEvents: faked } =
      makeRecorder()
    setActiveClickRecorder(fakeRecorder)
    const fakePage = makePageMock()
    const fakeClick = fakePage.mouse.click as ReturnType<typeof vi.fn>
    await instrumentPage(fakePage)
    await Promise.all([
      fakePage.mouse.click(300, 400, { fake: true }),
      vi.runAllTimersAsync(),
    ])

    expect(fakeClick).not.toHaveBeenCalled()
    expect(realClick).toHaveBeenCalledTimes(1)
    // The recorded shape is identical whether or not the real click fired.
    expect(faked[0]!.subType).toBe(real[0]!.subType)
    expect(faked[0]!.events.map((e) => e.type)).toEqual(
      real[0]!.events.map((e) => e.type)
    )
  })

  it('records page.mouse.dblclick as two presses and dispatches a real double click', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    // The mock has no `dblclick`, so the instrumented method falls back to two
    // real clicks via the captured original click.
    const originalClick = page.mouse.click as ReturnType<typeof vi.fn>
    await instrumentPage(page)

    await Promise.all([page.mouse.dblclick(300, 400), vi.runAllTimersAsync()])

    expect(recordedInputEvents).toHaveLength(1)
    const dbl = recordedInputEvents[0]!
    expect(dbl.subType).toBe('click')
    expect(dbl.events.filter((e) => e.type === 'mouseDown')).toHaveLength(2)
    expect(dbl.events.filter((e) => e.type === 'mouseUp')).toHaveLength(2)
    expect(originalClick).toHaveBeenCalledTimes(2)
  })

  it('records nothing inside hide() but still dispatches the real press', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    const originalDown = page.mouse.down as ReturnType<typeof vi.fn>
    await instrumentPage(page)

    await Promise.all([
      hide(async () => {
        await page.mouse.down()
      }),
      vi.runAllTimersAsync(),
    ])

    expect(recordedInputEvents).toHaveLength(0)
    expect(originalDown).toHaveBeenCalledTimes(1)
  })

  it('a fake press inside hide() is a complete no-op', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    const originalDown = page.mouse.down as ReturnType<typeof vi.fn>
    await instrumentPage(page)

    await Promise.all([
      hide(async () => {
        await page.mouse.down({ fake: true })
      }),
      vi.runAllTimersAsync(),
    ])

    expect(recordedInputEvents).toHaveLength(0)
    expect(originalDown).not.toHaveBeenCalled()
  })

  it('auto-shows a hidden cursor before a press', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    page.mouse.hide()
    await Promise.all([page.mouse.down(), vi.runAllTimersAsync()])

    expect(recordedInputEvents.map((e) => e.subType)).toEqual([
      'mouseHide',
      'mouseShow',
      'mouseDown',
    ])
  })
})

describe('instrumentLocator', () => {
  it('records a single click InputEvent with inner focusChange, mouseDown, mouseUp, and mouseWait', async () => {
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
    expect(click.events.some((e) => e.type === 'mouseWait')).toBe(true)
  })

  it('omits the pre-press mouseWait when move.delayAfter is zero', async () => {
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
          click(options?: { move?: { delayAfter?: number } }): Promise<void>
        }
      ).click({ move: { delayAfter: 0 } }),
      vi.runAllTimersAsync(),
    ])

    expect(recordedInputEvents).toHaveLength(1)
    const click = recordedInputEvents[0]!
    expect(click.events.some((e) => e.type === 'mouseWait')).toBe(false)
  })

  it('defaults locator clicks to noWaitAfter true', async () => {
    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    const originalClick = locator.click as ReturnType<typeof vi.fn>
    instrumentLocator(locator)

    await Promise.all([locator.click(), vi.runAllTimersAsync()])

    expect(originalClick).toHaveBeenCalledWith(
      expect.objectContaining({ noWaitAfter: true })
    )
  })

  it('preserves explicit noWaitAfter false for locator clicks', async () => {
    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    const originalClick = locator.click as ReturnType<typeof vi.fn>
    instrumentLocator(locator)

    await Promise.all([
      locator.click({ noWaitAfter: false }),
      vi.runAllTimersAsync(),
    ])

    expect(originalClick).toHaveBeenCalledWith(
      expect.objectContaining({ noWaitAfter: false })
    )
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

    // Plain interaction with the direction-aware comfort band: a 40px rect at
    // y=200 is already inside the band (68..612 for a 720 viewport), so it is
    // not scrolled and a click at position {8, 8} lands at (108, 208).
    expect(getMousePosition(page)).toEqual({ x: 108, y: 208 })
  })

  it('defaults locator clicks to the element center when no position is provided', async () => {
    const page = makePageMock()
    await instrumentPage(page)

    const bb = { x: 100, y: 200, width: 80, height: 40 }
    const locator = makeLocatorMock(bb, page)
    instrumentLocator(locator)

    await Promise.all([locator.click(), vi.runAllTimersAsync()])

    // The click lands at the element center. An 80x40 rect at y=200 is already
    // inside the comfort band (68..612), so it is not scrolled and its center
    // stays at (140, 220).
    expect(getMousePosition(page)).toEqual({ x: 140, y: 220 })
  })

  it('defaults selectOption clicks to the element center when no position is provided', async () => {
    const page = makePageMock()
    await instrumentPage(page)

    const bb = { x: 100, y: 200, width: 80, height: 40 }
    const locator = makeLocatorMock(bb, page)
    instrumentLocator(locator)

    await Promise.all([
      (
        locator as unknown as {
          selectOption(values: string): Promise<string[]>
        }
      ).selectOption('one'),
      vi.runAllTimersAsync(),
    ])

    // Already inside the comfort band (68..612): no scroll, center stays at 220.
    expect(getMousePosition(page)).toEqual({ x: 140, y: 220 })
  })

  it('uses the fixed default click move duration for selectOption', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    instrumentLocator(locator)

    await Promise.all([
      (
        locator as unknown as {
          selectOption(values: string): Promise<string[]>
        }
      ).selectOption('one'),
      vi.runAllTimersAsync(),
    ])

    const select = recordedInputEvents[0]!
    const focusChange = select.events.find(
      (event): event is FocusChangeEvent => event.type === 'focusChange'
    )

    expect(focusChange?.mouse).toMatchObject({
      startMs: expect.any(Number),
      endMs: expect.any(Number),
    })
    expect(focusChange?.mouse?.endMs - focusChange?.mouse?.startMs).toBe(
      DEFAULT_CLICK_MOUSE_MOVE_DURATION
    )
  })

  it('defaults selectOption to noWaitAfter true', async () => {
    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    const originalSelectOption = locator.selectOption as ReturnType<
      typeof vi.fn
    >
    instrumentLocator(locator)

    await Promise.all([locator.selectOption('one'), vi.runAllTimersAsync()])

    expect(originalSelectOption).toHaveBeenCalledWith(
      'one',
      expect.objectContaining({ noWaitAfter: true })
    )
  })

  it('uses the fixed default click move duration', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    instrumentLocator(locator)

    await Promise.all([locator.click(), vi.runAllTimersAsync()])

    const click = recordedInputEvents[0]!
    const focusChange = click.events.find(
      (event): event is FocusChangeEvent => event.type === 'focusChange'
    )

    expect(focusChange?.mouse).toMatchObject({
      startMs: expect.any(Number),
      endMs: expect.any(Number),
    })
    expect(focusChange?.mouse?.endMs - focusChange?.mouse?.startMs).toBe(
      DEFAULT_CLICK_MOUSE_MOVE_DURATION
    )
  })

  it('records fill clicks at the element center by default', async () => {
    const page = makePageMock()
    await instrumentPage(page)

    const bb = { x: 100, y: 200, width: 80, height: 40 }
    const locator = makeLocatorMock(bb, page)
    instrumentLocator(locator)

    await Promise.all([
      locator.fill('Acme Corporation', { postClickPause: 0 }),
      vi.runAllTimersAsync(),
    ])

    // Already inside the comfort band (68..612): no scroll, center stays at 220.
    expect(getMousePosition(page)).toEqual({ x: 140, y: 220 })
  })

  it('uses a reduced default pre-click pause before fill typing', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    // Place the element already at its gentle-centering resting position (a 40px
    // rect rests with its top at 0.2 * (720 - 40) / 2 = 68) so no scroll is
    // introduced and the pre-click pause is measured cleanly.
    const locator = makeLocatorMock(
      { x: 100, y: 68, width: 80, height: 40 },
      page
    )
    instrumentLocator(locator)

    await Promise.all([
      locator.fill('Acme Corporation', { duration: 100, postClickPause: 0 }),
      vi.runAllTimersAsync(),
    ])

    const fill = recordedInputEvents[0]!
    const focusChange = fill.events.find(
      (event): event is FocusChangeEvent => event.type === 'focusChange'
    )
    const down = fill.events.find((event) => event.type === 'mouseDown')

    expect(focusChange?.mouse).toBeDefined()
    expect(down?.type).toBe('mouseDown')
    if (!focusChange?.mouse || down?.type !== 'mouseDown') {
      throw new Error('Expected focusChange mouse timings and mouseDown event')
    }

    expect(down.startMs - focusChange.mouse.endMs).toBe(250)
  })

  it('uses a shorter default move.delayAfter before fill typing', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    instrumentLocator(locator)

    await Promise.all([
      locator.fill('Acme Corporation', {
        duration: 100,
        move: { delayAfter: 100 },
      }),
      vi.runAllTimersAsync(),
    ])

    const fill = recordedInputEvents[0]!
    const down = fill.events.find((event) => event.type === 'mouseDown')
    const up = fill.events.find((event) => event.type === 'mouseUp')
    const wait = fill.events.find((event) => event.type === 'mouseWait')

    expect(down?.type).toBe('mouseDown')
    expect(up?.type).toBe('mouseUp')
    expect(wait?.type).toBe('mouseWait')
    if (
      down?.type !== 'mouseDown' ||
      up?.type !== 'mouseUp' ||
      wait?.type !== 'mouseWait'
    ) {
      throw new Error('Expected mouseDown, mouseUp, and mouseWait events')
    }

    expect(down.startMs - wait.endMs).toBe(0)
    expect(wait.endMs - wait.startMs).toBe(100)
  })

  it('records a trailing post-typing settle pause for fill in recording mode', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    instrumentLocator(locator)

    await Promise.all([
      locator.fill('Acme', { duration: 100, beforeClickPause: 0 }),
      vi.runAllTimersAsync(),
    ])

    const fill = recordedInputEvents[0]!
    const waits = fill.events.filter((event) => event.type === 'mouseWait')
    const trailingWait = waits.at(-1)

    expect(fill.subType).toBe('pressSequentially')
    expect(waits).toHaveLength(2)
    expect(trailingWait?.type).toBe('mouseWait')
    if (trailingWait?.type !== 'mouseWait') {
      throw new Error('Expected a trailing mouseWait event')
    }

    expect(trailingWait.endMs - trailingWait.startMs).toBe(
      DEFAULT_POST_TYPING_SETTLE_PAUSE_MS
    )
  })

  it('skips the default pre-typing click animation for fill when the input is already focused', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    ;(
      locator as unknown as {
        _doc: { activeElement: unknown }
        _element: unknown
      }
    )._doc.activeElement = (
      locator as unknown as { _element: unknown }
    )._element
    instrumentLocator(locator)

    await Promise.all([
      (
        locator.fill as (
          value: string,
          options?: { duration?: number }
        ) => Promise<void>
      )('Acme Corporation', { duration: 100 }),
      vi.runAllTimersAsync(),
    ])

    const fill = recordedInputEvents[0]!
    expect(fill.events.some((event) => event.type === 'mouseDown')).toBe(false)
    expect(fill.events.some((event) => event.type === 'mouseUp')).toBe(false)
    const waits = fill.events.filter((event) => event.type === 'mouseWait')
    expect(waits).toHaveLength(1)
    expect(waits[0]!.endMs - waits[0]!.startMs).toBe(
      DEFAULT_POST_TYPING_SETTLE_PAUSE_MS
    )
  })

  it('skips the default pre-typing click animation for pressSequentially when the input is already focused', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    ;(
      locator as unknown as {
        _doc: { activeElement: unknown }
        _element: unknown
      }
    )._doc.activeElement = (
      locator as unknown as { _element: unknown }
    )._element
    instrumentLocator(locator)

    await Promise.all([
      locator.pressSequentially('Acme', { delay: 10 }),
      vi.runAllTimersAsync(),
    ])

    const pressSequentially = recordedInputEvents[0]!
    expect(
      pressSequentially.events.some((event) => event.type === 'mouseDown')
    ).toBe(false)
    expect(
      pressSequentially.events.some((event) => event.type === 'mouseUp')
    ).toBe(false)
    const waits = pressSequentially.events.filter(
      (event) => event.type === 'mouseWait'
    )
    expect(waits).toHaveLength(1)
    expect(waits[0]!.endMs - waits[0]!.startMs).toBe(
      DEFAULT_POST_TYPING_SETTLE_PAUSE_MS
    )
  })

  it('keeps custom fill move.delayAfter as a pre-typing wait and still appends the settle pause', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    instrumentLocator(locator)

    await Promise.all([
      locator.fill('Acme', {
        duration: 100,
        move: { delayAfter: 240 },
      }),
      vi.runAllTimersAsync(),
    ])

    const fill = recordedInputEvents[0]!
    const waits = fill.events.filter((event) => event.type === 'mouseWait')
    const down = fill.events.find((event) => event.type === 'mouseDown')
    const up = fill.events.find((event) => event.type === 'mouseUp')

    expect(waits).toHaveLength(2)
    expect(down?.type).toBe('mouseDown')
    expect(up?.type).toBe('mouseUp')
    if (down?.type !== 'mouseDown' || up?.type !== 'mouseUp') {
      throw new Error('Expected mouseDown and mouseUp events')
    }

    expect(down.startMs - waits[0]!.endMs).toBe(0)
    expect(waits[0]!.endMs - waits[0]!.startMs).toBe(240)
    expect(waits[1]!.endMs - waits[1]!.startMs).toBe(
      DEFAULT_POST_TYPING_SETTLE_PAUSE_MS
    )
  })

  it('records a trailing post-typing settle pause for pressSequentially in recording mode', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    instrumentLocator(locator)

    await Promise.all([
      locator.pressSequentially('Acme', {
        delay: 10,
        beforeClickPause: 0,
      }),
      vi.runAllTimersAsync(),
    ])

    const pressSequentially = recordedInputEvents[0]!
    const waits = pressSequentially.events.filter(
      (event) => event.type === 'mouseWait'
    )
    const trailingWait = waits.at(-1)

    expect(pressSequentially.subType).toBe('pressSequentially')
    expect(waits).toHaveLength(2)
    expect(trailingWait?.type).toBe('mouseWait')
    if (trailingWait?.type !== 'mouseWait') {
      throw new Error('Expected a trailing mouseWait event')
    }

    expect(trailingWait.endMs - trailingWait.startMs).toBe(
      DEFAULT_POST_TYPING_SETTLE_PAUSE_MS
    )
  })

  it('does not add a real post-typing delay outside recording mode', async () => {
    process.env[SCREENCI_DISABLE_RECORDING_TIMINGS_ENV] = 'true'
    vi.useRealTimers()

    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const fillLocator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    ;(
      fillLocator as unknown as {
        _doc: { activeElement: unknown }
        _element: unknown
      }
    )._doc.activeElement = (
      fillLocator as unknown as { _element: unknown }
    )._element
    instrumentLocator(fillLocator)

    const pressLocator = makeLocatorMock(
      { x: 100, y: 260, width: 80, height: 40 },
      page
    )
    ;(
      pressLocator as unknown as {
        _doc: { activeElement: unknown }
        _element: unknown
      }
    )._doc.activeElement = (
      pressLocator as unknown as { _element: unknown }
    )._element
    instrumentLocator(pressLocator)

    const fillStartMs = Date.now()
    await (
      fillLocator.fill as (
        value: string,
        options?: { duration?: number }
      ) => Promise<void>
    )('Acme', { duration: 100 })
    const fillDurationMs = Date.now() - fillStartMs

    const pressStartMs = Date.now()
    await pressLocator.pressSequentially('Acme', { delay: 10 })
    const pressDurationMs = Date.now() - pressStartMs

    expect(recordedInputEvents).toHaveLength(2)
    expect(fillDurationMs).toBeLessThan(DEFAULT_POST_TYPING_SETTLE_PAUSE_MS / 2)
    expect(pressDurationMs).toBeLessThan(
      DEFAULT_POST_TYPING_SETTLE_PAUSE_MS / 2
    )
    expect(
      recordedInputEvents.every(
        (event) =>
          event.events.filter((inner) => inner.type === 'mouseWait').length ===
          0
      )
    ).toBe(true)
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
      { duration: 300, delayAfter: 0 }
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

  it('does not add zoom to click focus changes outside autoZoom', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 900, width: 80, height: 40 },
      page
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

    expect(move).toMatchObject({ type: 'focusChange' })
    expect(move?.type === 'focusChange' ? move.zoom : undefined).toBeUndefined()
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
      { duration: 300, delayAfter: 0 }
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

  it('records click timing for check by default inside autoZoom', async () => {
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
      { duration: 300, delayAfter: 0 }
    )

    await vi.runAllTimersAsync()
    expect(checkMock).toHaveBeenCalledTimes(2)
    expect(checkMock).toHaveBeenCalledWith({
      noWaitAfter: true,
      position: { x: 40, y: 20 },
      trial: true,
    })
    expect(checkMock).toHaveBeenCalledWith({
      noWaitAfter: true,
      position: { x: 40, y: 20 },
    })

    await p

    expect(recordedInputEvents).toHaveLength(1)
    const check = recordedInputEvents[0]!
    expect(check.subType).toBe('check')
    expect(check.events.some((e) => e.type === 'focusChange')).toBe(true)
    expect(check.events.some((e) => e.type === 'mouseDown')).toBe(true)
    expect(check.events.some((e) => e.type === 'mouseUp')).toBe(true)
    expect(check.events.some((e) => e.type === 'mouseWait')).toBe(true)
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
      { duration: 0, delayAfter: 0 }
    )

    await vi.runAllTimersAsync()
    await p

    expect(keyboardType).toHaveBeenCalledOnce()

    expect(recordedInputEvents).toHaveLength(1)
    const fill = recordedInputEvents[0]!
    expect(fill.subType).toBe('pressSequentially')
    expect(fill.events.some((e) => e.type === 'mouseDown')).toBe(true)
    expect(fill.events.some((e) => e.type === 'mouseUp')).toBe(true)
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
        await locator.fill('hi', {
          duration: 100,
          moveDuration: 0,
          beforeClickPause: 0,
          postClickPause: 0,
        })
      },
      { duration: 300, delayAfter: 0 }
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

  it('records fill-with-click focusChange at the element center by default', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    instrumentLocator(locator)

    await Promise.all([
      locator.fill('hi', {
        duration: 100,
        moveDuration: 0,
        beforeClickPause: 0,
        postClickPause: 0,
      }),
      vi.runAllTimersAsync(),
    ])

    expect(recordedInputEvents).toHaveLength(1)
    const fill = recordedInputEvents[0]!
    const focusChange = fill.events.find(
      (event): event is FocusChangeEvent => event.type === 'focusChange'
    )

    // Already inside the comfort band (68..612): no scroll, center stays at 220.
    expect(focusChange).toMatchObject({ x: 140, y: 220 })
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
      locator.check({
        moveDuration: 0,
        beforeClickPause: 0,
        postClickPause: 0,
      }),
      vi.runAllTimersAsync(),
    ])

    expect(recordedInputEvents).toHaveLength(1)
    const check = recordedInputEvents[0]!
    expect(check.subType).toBe('check')
    expect(checkMock).toHaveBeenCalledWith({
      noWaitAfter: true,
      position: { x: 9, y: 9 },
      trial: true,
    })
    expect(checkMock).toHaveBeenCalledWith({
      noWaitAfter: true,
      position: { x: 9, y: 9 },
    })

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

  it('records click timing for check by default', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 18, height: 18 },
      page
    )
    instrumentLocator(locator)

    await Promise.all([locator.check(), vi.runAllTimersAsync()])

    // An 18px rect at y=200 is already inside the comfort band (68..613), so it
    // is not scrolled and its center stays at (109, 209).
    expect(getMousePosition(page)).toEqual({ x: 109, y: 209 })
    const check = recordedInputEvents[0]!
    expect(check.events.some((e) => e.type === 'mouseDown')).toBe(true)
    expect(check.events.some((e) => e.type === 'mouseUp')).toBe(true)
  })

  it('records click timing for uncheck by default', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 18, height: 18 },
      page
    )
    instrumentLocator(locator)

    await Promise.all([locator.uncheck(), vi.runAllTimersAsync()])

    // Already inside the comfort band (68..613): no scroll, center stays at 209.
    expect(getMousePosition(page)).toEqual({ x: 109, y: 209 })
    const uncheck = recordedInputEvents[0]!
    expect(uncheck.events.some((e) => e.type === 'mouseDown')).toBe(true)
    expect(uncheck.events.some((e) => e.type === 'mouseUp')).toBe(true)
  })

  it('uses a reduced default pre-click pause before selectText', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    // Place the element already at its gentle-centering resting position (a 40px
    // rect rests with its top at 0.2 * (720 - 40) / 2 = 68) so no scroll is
    // introduced and the pre-click pause is measured cleanly.
    const locator = makeLocatorMock(
      { x: 100, y: 68, width: 80, height: 40 },
      page
    )
    instrumentLocator(locator)

    await Promise.all([
      locator.selectText({ selectDuration: 60 }),
      vi.runAllTimersAsync(),
    ])

    const selectText = recordedInputEvents[0]!
    const focusChange = selectText.events.find(
      (event): event is FocusChangeEvent => event.type === 'focusChange'
    )
    const down = selectText.events.find((event) => event.type === 'mouseDown')

    expect(focusChange?.mouse).toBeDefined()
    expect(down?.type).toBe('mouseDown')
    if (!focusChange?.mouse || down?.type !== 'mouseDown') {
      throw new Error('Expected focusChange mouse timings and mouseDown event')
    }

    expect(down.startMs - focusChange.mouse.endMs).toBe(250)
  })

  it('records click timing for tap by default', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    instrumentLocator(locator)

    await Promise.all([locator.tap(), vi.runAllTimersAsync()])

    // Already inside the comfort band (68..612): no scroll, center stays at 220.
    expect(getMousePosition(page)).toEqual({ x: 140, y: 220 })
    const tap = recordedInputEvents[0]!
    expect(tap.events.some((e) => e.type === 'mouseDown')).toBe(true)
    expect(tap.events.some((e) => e.type === 'mouseUp')).toBe(true)
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

  it('records a dragTo InputEvent with mouseMove, mouseDown, mouseUp', async () => {
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
    expect(moves).toHaveLength(1)
    expect(moves[0]?.elementRect).toEqual(targetBb)
    expect(ev.events.some((e) => e.type === 'mouseDown')).toBe(true)
    expect(ev.events.some((e) => e.type === 'mouseUp')).toBe(true)
  })

  it('uses the post-focus target bounding box for dragTo movement', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const sourceBb = { x: 50, y: 100, width: 60, height: 30 }
    const staleTargetBb = { x: 300, y: 800, width: 60, height: 30 }
    const freshTargetBb = { x: 300, y: 200, width: 60, height: 30 }
    const sourceLocator = makeLocatorMock(sourceBb, page)
    const targetLocator = makeLocatorMock(staleTargetBb, page)
    vi.mocked(targetLocator.boundingBox)
      .mockResolvedValueOnce(staleTargetBb)
      .mockResolvedValueOnce(freshTargetBb)
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

    const ev = recordedInputEvents[0]!
    const moves = ev.events.filter(
      (e): e is MouseMoveEvent => e.type === 'mouseMove'
    )
    expect(moves[0]?.y).toBe(freshTargetBb.y + freshTargetBb.height / 2)
    expect(moves[0]?.elementRect).toEqual(freshTargetBb)
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

  it('records mouseHide for consecutive fills on different inputs', async () => {
    const { recorder, recordedInputEvents } = makeRecorder()
    setActiveClickRecorder(recorder)

    const page = makePageMock()
    await instrumentPage(page)

    const firstLocator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
      page
    )
    const secondLocator = makeLocatorMock(
      { x: 100, y: 280, width: 80, height: 40 },
      page
    )
    instrumentLocator(firstLocator)
    instrumentLocator(secondLocator)

    await Promise.all([
      (async () => {
        await (
          firstLocator.fill as (
            v: string,
            opts: { hideMouse: boolean }
          ) => Promise<void>
        )('Alex', { hideMouse: true })
        await (
          secondLocator.fill as (
            v: string,
            opts: { hideMouse: boolean }
          ) => Promise<void>
        )('Taylor', { hideMouse: true })
      })(),
      vi.runAllTimersAsync(),
    ])

    expect(recordedInputEvents).toHaveLength(2)
    for (const event of recordedInputEvents) {
      expect(event.subType).toBe('pressSequentially')
      expect(
        event.events.some((innerEvent) => innerEvent.type === 'mouseHide')
      ).toBe(true)
    }
  })

  describe('slow interaction warning', () => {
    it('does not warn when actionability is fast', async () => {
      const { recorder } = makeRecorder()
      setActiveClickRecorder(recorder)
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

      const page = makePageMock()
      await instrumentPage(page)
      const bb = { x: 10, y: 20, width: 100, height: 30 }
      const locator = makeLocatorMock(bb, page)
      instrumentLocator(locator)

      await Promise.all([
        locator.click({ moveDuration: 10 }),
        vi.runAllTimersAsync(),
      ])

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Slow UI response')
      )
      warnSpy.mockRestore()
    })

    it('warns when the element is slow to become actionable, without touching the recording', async () => {
      const { recorder } = makeRecorder()
      setActiveClickRecorder(recorder)
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

      const page = makePageMock()
      await instrumentPage(page)
      const bb = { x: 10, y: 20, width: 100, height: 30 }
      const locator = makeLocatorMock(bb, page)
      // The actionability trial takes 3s (slow CI); the real click is instant.
      const clickMock = locator.click as ReturnType<typeof vi.fn>
      clickMock.mockImplementation(async (options?: { trial?: boolean }) => {
        if (options?.trial) {
          await new Promise((resolve) => setTimeout(resolve, 3000))
        }
      })
      instrumentLocator(locator)

      await Promise.all([
        locator.click({ moveDuration: 10 }),
        vi.runAllTimersAsync(),
      ])

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Slow UI response')
      )
      // The recording is not altered: the wait is neither hidden nor compressed.
      expect(recorder.addHideStart).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })
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

    await Promise.all([
      hide(async () => {
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

        await locator.check()
        await locator.uncheck()
        await locator.selectOption('one', { position: { x: 1, y: 1 } })
      }),
      vi.runAllTimersAsync(),
    ])

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
