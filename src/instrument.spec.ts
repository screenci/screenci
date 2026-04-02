import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Locator, Page, FrameLocator } from '@playwright/test'
import type { IEventRecorder, ElementRect, InputEvent } from './events.js'
import {
  setActiveClickRecorder,
  instrumentLocator,
  instrumentPage,
} from './instrument.js'
import { setActiveAutoZoomRecorder, setLastZoomLocation } from './autoZoom.js'

type DOMClickData = { x: number; y: number; targetRect: ElementRect }

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
    addCaptionStart: vi.fn(),
    addCaptionEnd: vi.fn(),
    addHideStart: vi.fn(),
    addHideEnd: vi.fn(),
    addAutoZoomStart: vi.fn(),
    addAutoZoomEnd: vi.fn(),
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
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
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
    evaluate: vi.fn().mockResolvedValue(undefined),
    boundingBox: vi.fn().mockResolvedValue(bb),
    waitFor: vi.fn().mockResolvedValue(undefined),
    all: vi.fn().mockResolvedValue([]),
    page: vi.fn().mockReturnValue(pageMock),
    contentFrame: vi
      .fn()
      .mockImplementation(() => makeFrameLocatorMock(pageMock)),
    frameLocator: vi
      .fn()
      .mockImplementation(() => makeFrameLocatorMock(pageMock)),
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

beforeEach(() => {
  setActiveClickRecorder(null)
  setActiveAutoZoomRecorder(null)
  setLastZoomLocation(null)
  vi.useFakeTimers()
})

afterEach(() => {
  setActiveClickRecorder(null)
  setActiveAutoZoomRecorder(null)
  setLastZoomLocation(null)
  vi.useRealTimers()
})

describe('instrumentLocator', () => {
  it('records a single click InputEvent with inner mouseMove, mouseDown, mouseUp', async () => {
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
    expect(click.events.some((e) => e.type === 'mouseMove')).toBe(true)
    expect(click.events.some((e) => e.type === 'mouseDown')).toBe(true)
    expect(click.events.some((e) => e.type === 'mouseUp')).toBe(true)
  })

  it('records a hover InputEvent with inner mouseMove and mouseWait', async () => {
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
    expect(hover.events.some((e) => e.type === 'mouseMove')).toBe(true)
    expect(hover.events.some((e) => e.type === 'mouseWait')).toBe(true)
  })

  it('records a selectText InputEvent with mouseMove and 3 down+up pairs', async () => {
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
    expect(ev.events.some((e) => e.type === 'mouseMove')).toBe(true)
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
    const moves = ev.events.filter((e) => e.type === 'mouseMove')
    expect(moves).toHaveLength(2) // move to source + drag to target
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

    await locator.fill('hi', { hideMouse: true })

    expect(recordedInputEvents).toHaveLength(1)
    const pressSeq = recordedInputEvents[0]!
    expect(pressSeq.subType).toBe('pressSequentially')
    expect(pressSeq.events.some((e) => e.type === 'mouseHide')).toBe(true)
  })
})
