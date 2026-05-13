import type { Locator } from '@playwright/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLICK_DURATION_MS,
  assertDurationOrSpeed,
  getMousePosition,
  getOriginalMouseClick,
  getOriginalMouseDown,
  getOriginalMouseHide,
  getOriginalMouseMove,
  getOriginalMouseShow,
  getOriginalMouseUp,
  isMouseVisible,
  performMouseClickAction,
  performMouseDown,
  performMouseHide,
  performMouseMove,
  performMouseShow,
  performMouseUp,
  resolveMouseMoveDuration,
  setOriginalLocatorCheck,
  setOriginalLocatorClick,
  setOriginalMouseClick,
  setOriginalMouseDown,
  setOriginalMouseHide,
  setMousePosition,
  setMouseVisible,
  setOriginalMouseShow,
  setOriginalMouseMove,
  setOriginalMouseUp,
} from './mouse.js'

describe('mouse helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('validates duration and speed options', () => {
    expect(() => assertDurationOrSpeed(100, 200, 'test move')).toThrow(
      'accepts either duration or speed'
    )
    expect(() => assertDurationOrSpeed(-1, undefined, 'test move')).toThrow(
      'duration must be a finite number >= 0'
    )
    expect(() => assertDurationOrSpeed(undefined, 0, 'test move')).toThrow(
      'speed must be a finite number > 0'
    )
    expect(() =>
      assertDurationOrSpeed(100, undefined, 'test move')
    ).not.toThrow()
  })

  it('resolves move duration from tracked distance', () => {
    const page = {}
    setMousePosition(page, { x: 0, y: 0 })

    expect(
      resolveMouseMoveDuration(page, 300, 400, {
        duration: undefined,
        speed: 500,
        defaultDuration: 0,
        context: 'test move',
      })
    ).toBe(1000)
  })

  it('resolves move duration from default speed when no timing is provided', () => {
    const page = {}
    setMousePosition(page, { x: 0, y: 0 })

    expect(
      resolveMouseMoveDuration(page, 300, 400, {
        duration: undefined,
        speed: undefined,
        defaultDuration: undefined,
        defaultSpeed: 1000,
        context: 'test move',
      })
    ).toBe(500)
  })

  it('keeps explicit zero-duration moves instant when default speed is set', () => {
    const page = {}
    setMousePosition(page, { x: 0, y: 0 })

    expect(
      resolveMouseMoveDuration(page, 300, 400, {
        duration: 0,
        speed: undefined,
        defaultDuration: undefined,
        defaultSpeed: 1000,
        context: 'test move',
      })
    ).toBe(0)
  })

  it('performs mouse movement and updates tracked position', async () => {
    const page = {}
    const mouseMoveInternal = vi.fn().mockResolvedValue(undefined)
    setOriginalMouseMove(page, mouseMoveInternal)
    const promise = performMouseMove({
      page,
      targetX: 30,
      targetY: 40,
      duration: 100,
      easing: 'linear',
    })

    await vi.runAllTimersAsync()
    const result = await promise
    expect(mouseMoveInternal).toHaveBeenCalled()
    expect(getMousePosition(page)).toEqual({ x: 30, y: 40 })
    expect(result.startMs).toBeTypeOf('number')
    expect(result.endMs).toBeTypeOf('number')
    expect(result.endMs).toBeGreaterThanOrEqual(result.startMs)
  })

  it('performs instant mouse movement', async () => {
    const page = {}
    const mouseMoveInternal = vi.fn().mockResolvedValue(undefined)
    setOriginalMouseMove(page, mouseMoveInternal)
    const promise = performMouseMove({
      page,
      targetX: 120,
      targetY: 90,
      duration: 0,
      easing: 'ease-out',
    })

    const result = await promise
    expect(mouseMoveInternal).toHaveBeenCalledWith(120, 90)
    expect(getMousePosition(page)).toEqual({ x: 120, y: 90 })
    expect(result.startMs).toBeTypeOf('number')
    expect(result.endMs).toBeTypeOf('number')
    expect(result.endMs).toBeGreaterThanOrEqual(result.startMs)
  })

  it('clicks the real mouse and returns press events', async () => {
    const page = {}
    const locator = {
      page: vi.fn().mockReturnValue(page),
      boundingBox: vi
        .fn()
        .mockResolvedValue({ x: 10, y: 20, width: 30, height: 40 }),
    } as unknown as Locator
    const mouseClickInternal = vi.fn().mockImplementation(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
    })
    setOriginalLocatorClick(
      locator,
      mouseClickInternal as unknown as (options?: {
        button?: 'left' | 'right' | 'middle'
        clickCount?: number
        delay?: number
        position?: { x: number; y: number }
        trial?: boolean
      }) => Promise<void>
    )

    const promise = performMouseClickAction({
      locator,
      doClick: mouseClickInternal,
      supportsTrial: false,
      targetX: 12,
      targetY: 34,
      clickOptions: { clickCount: 2, delay: 20 },
    })

    await vi.runAllTimersAsync()
    const result = await promise
    const [down, up] = result.events

    expect(mouseClickInternal).toHaveBeenCalledWith({
      clickCount: 2,
      delay: 20,
    })
    expect(result.elementRect).toEqual({ x: 10, y: 20, width: 30, height: 40 })
    expect(down.type).toBe('mouseDown')
    expect(up.type).toBe('mouseUp')
    expect(down.startMs).toBeLessThanOrEqual(down.endMs)
    expect(up.startMs).toBeLessThanOrEqual(up.endMs)
    expect(up.startMs).toBe(down.endMs)
    expect(down.endMs - down.startMs).toBeGreaterThan(0)
    expect(up.endMs - up.startMs).toBeGreaterThan(0)
    expect(up.endMs - down.startMs).toBe(CLICK_DURATION_MS + 50)
    expect(getMousePosition(page)).toEqual({ x: 12, y: 34 })
  })

  it('reads locator bounds before the real click', async () => {
    const page = {}
    const calls: string[] = []
    const locator = {
      page: vi.fn().mockReturnValue(page),
      boundingBox: vi.fn().mockImplementation(async () => {
        calls.push('boundingBox')
        return { x: 10, y: 20, width: 30, height: 40 }
      }),
    } as unknown as Locator
    const mouseClickInternal = vi.fn().mockImplementation(async () => {
      calls.push('click')
    })

    const promise = performMouseClickAction({
      locator,
      doClick: mouseClickInternal,
      supportsTrial: false,
      targetX: 12,
      targetY: 34,
    })

    await vi.runAllTimersAsync()
    await promise

    expect(calls).toEqual(['boundingBox', 'click'])
  })

  it('supports tripleBefore click mode', async () => {
    const page = {}
    const locator = {
      page: vi.fn().mockReturnValue(page),
      boundingBox: vi
        .fn()
        .mockResolvedValue({ x: 10, y: 20, width: 30, height: 40 }),
    } as unknown as Locator
    const mouseClickInternal = vi.fn().mockResolvedValue(undefined)
    setOriginalLocatorClick(
      locator,
      mouseClickInternal as unknown as (options?: {
        button?: 'left' | 'right' | 'middle'
        clickCount?: number
        delay?: number
        position?: { x: number; y: number }
        trial?: boolean
      }) => Promise<void>
    )

    const promise = performMouseClickAction({
      locator,
      doClick: mouseClickInternal,
      supportsTrial: false,
      targetX: 12,
      targetY: 34,
      mode: 'tripleBefore',
    })

    await vi.runAllTimersAsync()
    const result = await promise
    const downs = result.events.filter((e) => e.type === 'mouseDown')
    const ups = result.events.filter((e) => e.type === 'mouseUp')

    expect(downs).toHaveLength(3)
    expect(ups).toHaveLength(3)
  })

  it('supports singleBefore click mode', async () => {
    const page = {}
    const locator = {
      page: vi.fn().mockReturnValue(page),
      boundingBox: vi
        .fn()
        .mockResolvedValue({ x: 10, y: 20, width: 30, height: 40 }),
    } as unknown as Locator
    const mouseClickInternal = vi.fn().mockResolvedValue(undefined)
    setOriginalLocatorClick(
      locator,
      mouseClickInternal as unknown as (options?: {
        button?: 'left' | 'right' | 'middle'
        clickCount?: number
        delay?: number
        position?: { x: number; y: number }
        trial?: boolean
      }) => Promise<void>
    )

    const promise = performMouseClickAction({
      locator,
      doClick: mouseClickInternal,
      supportsTrial: false,
      targetX: 12,
      targetY: 34,
      mode: 'singleBefore',
    })

    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.events.filter((e) => e.type === 'mouseDown')).toHaveLength(1)
    expect(result.events.filter((e) => e.type === 'mouseUp')).toHaveLength(1)
  })

  it('waits for clickability before the rendered click timing starts', async () => {
    const page = {}
    const locator = {
      page: vi.fn().mockReturnValue(page),
      boundingBox: vi
        .fn()
        .mockResolvedValue({ x: 10, y: 20, width: 30, height: 40 }),
    } as unknown as Locator
    const calls: string[] = []
    const doClick = vi
      .fn()
      .mockImplementation(async (options?: { trial?: boolean }) => {
        calls.push(options?.trial ? 'trialClickInternal' : 'mouseClickInternal')
      })
    setOriginalLocatorCheck(
      locator,
      doClick as unknown as (options?: {
        button?: 'left' | 'right' | 'middle'
        clickCount?: number
        delay?: number
        position?: { x: number; y: number }
        trial?: boolean
      }) => Promise<void>
    )

    const promise = performMouseClickAction({
      locator,
      doClick,
      supportsTrial: true,
      targetX: 12,
      targetY: 34,
    })

    await vi.runAllTimersAsync()
    await promise

    expect(doClick).toHaveBeenCalledTimes(2)
    expect(calls).toEqual(['trialClickInternal', 'mouseClickInternal'])
  })

  it('stores mouse state through accessors', () => {
    const page = {}
    const originalMove = vi.fn().mockResolvedValue(undefined)
    const originalClick = vi.fn().mockResolvedValue(undefined)
    const originalDown = vi.fn().mockResolvedValue(undefined)
    const originalUp = vi.fn().mockResolvedValue(undefined)
    const originalShow = vi.fn()
    const originalHide = vi.fn()

    expect(getMousePosition(page)).toBeUndefined()
    expect(isMouseVisible(page)).toBe(true)
    expect(getOriginalMouseMove(page, originalMove)).toBe(originalMove)
    expect(getOriginalMouseClick(page, originalClick)).toBe(originalClick)
    expect(getOriginalMouseDown(page, originalDown)).toBe(originalDown)
    expect(getOriginalMouseUp(page, originalUp)).toBe(originalUp)
    expect(getOriginalMouseShow(page, originalShow)).toBe(originalShow)
    expect(getOriginalMouseHide(page, originalHide)).toBe(originalHide)

    setMousePosition(page, { x: 1, y: 2 })
    setMouseVisible(page, false)
    setOriginalMouseMove(page, originalMove)
    setOriginalMouseClick(page, originalClick)
    setOriginalMouseDown(page, originalDown)
    setOriginalMouseUp(page, originalUp)
    setOriginalMouseShow(page, originalShow)
    setOriginalMouseHide(page, originalHide)

    expect(getMousePosition(page)).toEqual({ x: 1, y: 2 })
    expect(isMouseVisible(page)).toBe(false)
    expect(
      getOriginalMouseMove(page, vi.fn().mockResolvedValue(undefined))
    ).toBe(originalMove)
    expect(
      getOriginalMouseClick(page, vi.fn().mockResolvedValue(undefined))
    ).toBe(originalClick)
    expect(
      getOriginalMouseDown(page, vi.fn().mockResolvedValue(undefined))
    ).toBe(originalDown)
    expect(getOriginalMouseUp(page, vi.fn().mockResolvedValue(undefined))).toBe(
      originalUp
    )
    expect(getOriginalMouseShow(page, vi.fn())).toBe(originalShow)
    expect(getOriginalMouseHide(page, vi.fn())).toBe(originalHide)
  })

  it('routes mouse down/up/show/hide through helpers', async () => {
    const page = {}
    const mouseDownInternal = vi.fn().mockResolvedValue(undefined)
    const mouseUpInternal = vi.fn().mockResolvedValue(undefined)
    const mouseShowInternal = vi.fn()
    const mouseHideInternal = vi.fn()

    await performMouseDown({
      mouseDownInternal,
      downOptions: { clickCount: 2 },
    })
    await performMouseUp({
      mouseUpInternal,
      upOptions: { button: 'right' },
    })
    performMouseHide({ page, mouseHideInternal })
    performMouseShow({ page, mouseShowInternal })

    expect(mouseDownInternal).toHaveBeenCalledWith({ clickCount: 2 })
    expect(mouseUpInternal).toHaveBeenCalledWith({ button: 'right' })
    expect(mouseHideInternal).toHaveBeenCalled()
    expect(mouseShowInternal).toHaveBeenCalled()
    expect(isMouseVisible(page)).toBe(true)
  })
})
