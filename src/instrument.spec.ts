import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Locator, Page, FrameLocator } from '@playwright/test'
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

beforeEach(() => {
  setActiveClickRecorder(NOOP_EVENT_RECORDER)
  setActiveAutoZoomRecorder(NOOP_EVENT_RECORDER)
  setCurrentZoomViewport(null)
  vi.useFakeTimers()
})

afterEach(() => {
  setActiveClickRecorder(NOOP_EVENT_RECORDER)
  setActiveAutoZoomRecorder(NOOP_EVENT_RECORDER)
  setCurrentZoomViewport(null)
  vi.useRealTimers()
})

describe('instrumentPage', () => {
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
    expect(move!.endMs - move!.startMs).toBeGreaterThan(0)
    expect(originalMove.mock.calls.length).toBeGreaterThan(1)
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

  it('omits post-click mouseWait when click postClickPause is zero', async () => {
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
          click(options?: { postClickPause?: number }): Promise<void>
        }
      ).click({ postClickPause: 0 }),
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

    expect(getMousePosition(page)).toEqual({ x: 108, y: 208 })
  })

  it('defaults locator clicks to the element center when no position is provided', async () => {
    const page = makePageMock()
    await instrumentPage(page)

    const bb = { x: 100, y: 200, width: 80, height: 40 }
    const locator = makeLocatorMock(bb, page)
    instrumentLocator(locator)

    await Promise.all([locator.click(), vi.runAllTimersAsync()])

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
    expect(
      focusChange?.mouse?.endMs - focusChange?.mouse?.startMs
    ).toBeGreaterThanOrEqual(DEFAULT_CLICK_MOUSE_MOVE_DURATION * 0.9)
    expect(
      focusChange?.mouse?.endMs - focusChange?.mouse?.startMs
    ).toBeLessThanOrEqual(DEFAULT_CLICK_MOUSE_MOVE_DURATION)
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
    expect(
      focusChange?.mouse?.endMs - focusChange?.mouse?.startMs
    ).toBeGreaterThanOrEqual(DEFAULT_CLICK_MOUSE_MOVE_DURATION * 0.9)
    expect(
      focusChange?.mouse?.endMs - focusChange?.mouse?.startMs
    ).toBeLessThanOrEqual(DEFAULT_CLICK_MOUSE_MOVE_DURATION)
  })

  it('records fill clicks at the element center by default', async () => {
    const page = makePageMock()
    await instrumentPage(page)

    const bb = { x: 100, y: 200, width: 80, height: 40 }
    const locator = makeLocatorMock(bb, page)
    instrumentLocator(locator)

    await Promise.all([
      (
        locator as unknown as {
          fill(
            value: string,
            options?: { click?: { postClickPause?: number } }
          ): Promise<void>
        }
      ).fill('Acme Corporation', { click: { postClickPause: 0 } }),
      vi.runAllTimersAsync(),
    ])

    expect(getMousePosition(page)).toEqual({ x: 140, y: 220 })
  })

  it('uses a reduced default pre-click pause before fill typing', async () => {
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
        locator.fill as (
          value: string,
          options?: { duration?: number; click?: { postClickPause?: number } }
        ) => Promise<void>
      )('Acme Corporation', { duration: 100, click: { postClickPause: 0 } }),
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

    expect(down.startMs - focusChange.mouse.endMs).toBe(1050)
  })

  it('uses the shorter default post-click pause before fill typing', async () => {
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
        locator.fill as (
          value: string,
          options?: { duration?: number; click?: { beforeClickPause?: number } }
        ) => Promise<void>
      )('Acme Corporation', { duration: 100, click: { beforeClickPause: 0 } }),
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

    expect(wait.startMs - up.endMs).toBe(0)
    expect(wait.endMs - wait.startMs).toBe(100)
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
      { duration: 300, postZoomDelay: 0 }
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
      { duration: 0, postZoomDelay: 0 }
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
      (
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
      }),
      vi.runAllTimersAsync(),
    ])

    expect(recordedInputEvents).toHaveLength(1)
    const fill = recordedInputEvents[0]!
    const focusChange = fill.events.find(
      (event): event is FocusChangeEvent => event.type === 'focusChange'
    )

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

    const locator = makeLocatorMock(
      { x: 100, y: 200, width: 80, height: 40 },
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

    expect(down.startMs - focusChange.mouse.endMs).toBe(1050)
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

        await (
          locator.check as (options?: { click?: unknown }) => Promise<void>
        )({ click: {} })
        await (
          locator.uncheck as (options?: { click?: unknown }) => Promise<void>
        )({ click: {} })
        await (
          locator.selectOption as (
            values: string,
            options?: { click?: unknown; position?: { x: number; y: number } }
          ) => Promise<string[]>
        )('one', { click: {}, position: { x: 1, y: 1 } })
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
