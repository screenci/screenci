import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  autoZoom,
  setActiveAutoZoomRecorder,
  getAutoZoomState,
  setCurrentZoomViewport,
} from './autoZoom.js'
import { EventRecorder, NOOP_EVENT_RECORDER } from './events.js'
import type { IEventRecorder } from './events.js'
import type { Easing } from './types.js'

function makeRecorder(): IEventRecorder {
  return {
    start: vi.fn(),
    addInput: vi.fn(),
    addCueStart: vi.fn(),
    addStudioCueStart: vi.fn(),
    addCueEnd: vi.fn(),
    addVideoCueStart: vi.fn(),
    addAssetStart: vi.fn(),
    addHideStart: vi.fn(),
    addHideEnd: vi.fn(),
    addAutoZoomStart: vi.fn(),
    addAutoZoomEnd: vi.fn(),
    registerVoiceForLang: vi.fn(),
    getEvents: vi.fn(() => []),
    writeToFile: vi.fn(),
  }
}

describe('autoZoom', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    setActiveAutoZoomRecorder(NOOP_EVENT_RECORDER)
    setCurrentZoomViewport(null)
    vi.useRealTimers()
  })

  describe('with configured recorder', () => {
    let recorder: IEventRecorder

    beforeEach(() => {
      recorder = makeRecorder()
      setActiveAutoZoomRecorder(recorder)
    })

    it('adds autoZoomStart before executing the callback', async () => {
      const order: string[] = []
      vi.mocked(recorder.addAutoZoomStart).mockImplementation(() => {
        order.push('autoZoomStart')
      })

      const p = autoZoom(() => {
        order.push('callback')
      })
      await vi.runAllTimersAsync()
      await p

      expect(order[0]).toBe('autoZoomStart')
      expect(order[1]).toBe('callback')
    })

    it('adds autoZoomEnd after executing the callback', async () => {
      const order: string[] = []
      vi.mocked(recorder.addAutoZoomEnd).mockImplementation(() => {
        order.push('autoZoomEnd')
      })

      const p = autoZoom(() => {
        order.push('callback')
      })
      await vi.runAllTimersAsync()
      await p

      expect(order[0]).toBe('callback')
      expect(order[1]).toBe('autoZoomEnd')
    })

    it('awaits async callbacks', async () => {
      const order: string[] = []

      const p = autoZoom(async () => {
        await Promise.resolve()
        order.push('async-callback')
      })
      await vi.runAllTimersAsync()
      await p

      expect(order).toEqual(['async-callback'])
      expect(recorder.addAutoZoomEnd).toHaveBeenCalledOnce()
    })

    it('calls addAutoZoomStart and addAutoZoomEnd once each', async () => {
      const p = autoZoom(() => {})
      await vi.runAllTimersAsync()
      await p
      expect(recorder.addAutoZoomStart).toHaveBeenCalledOnce()
      expect(recorder.addAutoZoomEnd).toHaveBeenCalledOnce()
    })

    it('passes no options when called without options', async () => {
      const p = autoZoom(() => {})
      await vi.runAllTimersAsync()
      await p
      expect(recorder.addAutoZoomStart).toHaveBeenCalledWith(undefined)
      expect(recorder.addAutoZoomEnd).toHaveBeenCalledWith(undefined)
    })

    it('passes options to addAutoZoomStart and addAutoZoomEnd', async () => {
      const p = autoZoom(() => {}, {
        easing: 'ease-in-out',
        duration: 400,
        amount: 0.6,
      })
      await vi.runAllTimersAsync()
      await p
      expect(recorder.addAutoZoomStart).toHaveBeenCalledWith({
        easing: 'ease-in-out',
        duration: 400,
        amount: 0.6,
      })
      expect(recorder.addAutoZoomEnd).toHaveBeenCalledWith({
        easing: 'ease-in-out',
        duration: 400,
        amount: 0.6,
      })
    })

    it('passes only easing option when duration and amount are omitted', async () => {
      const p = autoZoom(() => {}, { easing: 'linear' })
      await vi.runAllTimersAsync()
      await p
      expect(recorder.addAutoZoomStart).toHaveBeenCalledWith({
        easing: 'linear',
      })
      expect(recorder.addAutoZoomEnd).toHaveBeenCalledWith({ easing: 'linear' })
    })

    it('passes centering to addAutoZoomStart', async () => {
      const p = autoZoom(() => {}, { centering: 0.2 })
      await vi.runAllTimersAsync()
      await p
      expect(recorder.addAutoZoomStart).toHaveBeenCalledWith(
        expect.objectContaining({ centering: 0.2 })
      )
    })
  })

  describe('with the default no-op recorder', () => {
    it('still executes the callback', async () => {
      setActiveAutoZoomRecorder(NOOP_EVENT_RECORDER)
      const called = vi.fn()
      const p = autoZoom(called)
      await vi.runAllTimersAsync()
      await p
      expect(called).toHaveBeenCalledOnce()
    })
  })

  describe('zoom context state', () => {
    it('exposes zoom duration during fn execution', async () => {
      let durationDuringFn: number | null = null
      const p = autoZoom(
        () => {
          durationDuringFn = getAutoZoomState().options.duration ?? null
        },
        { duration: 400 }
      )
      await vi.runAllTimersAsync()
      await p
      expect(durationDuringFn).toBe(400)
    })

    it('defaults zoom duration when no option given', async () => {
      let durationDuringFn: number | null = null
      const p = autoZoom(() => {
        durationDuringFn = getAutoZoomState().options.duration ?? null
      })
      await vi.runAllTimersAsync()
      await p
      expect(durationDuringFn).toBe(750)
    })

    it('exposes zoom easing during fn execution', async () => {
      let easingDuringFn: Easing | null = null
      const p = autoZoom(
        () => {
          easingDuringFn =
            (getAutoZoomState().options.easing as Easing | undefined) ?? null
        },
        { easing: 'ease-in-out-strong' }
      )
      await vi.runAllTimersAsync()
      await p
      expect(easingDuringFn).toBe('ease-in-out-strong')
    })

    it('defaults zoom easing when no option given', async () => {
      let easingDuringFn: Easing | null = null
      const p = autoZoom(() => {
        easingDuringFn =
          (getAutoZoomState().options.easing as Easing | undefined) ?? null
      })
      await vi.runAllTimersAsync()
      await p
      expect(easingDuringFn).toBe('ease-out')
    })

    it('defaults zoom amount when no option given', async () => {
      let amountDuringFn: number | null = null
      const p = autoZoom(() => {
        amountDuringFn = getAutoZoomState().options.amount ?? null
      })
      await vi.runAllTimersAsync()
      await p
      expect(amountDuringFn).toBe(0.72)
    })

    it('defaults post zoom delay when no option given', async () => {
      let postZoomDelayDuringFn: number | null = null
      const p = autoZoom(() => {
        postZoomDelayDuringFn = getAutoZoomState().options.postZoomDelay ?? null
      })
      await vi.runAllTimersAsync()
      await p
      expect(postZoomDelayDuringFn).toBe(200)
    })

    it('zoom duration is absent after fn completes', async () => {
      const p = autoZoom(() => {}, { duration: 300 })
      await vi.runAllTimersAsync()
      await p
      expect(getAutoZoomState().options.duration).toBeUndefined()
    })

    it('zoom easing is absent after fn completes', async () => {
      const p = autoZoom(() => {}, { easing: 'linear' })
      await vi.runAllTimersAsync()
      await p
      expect(getAutoZoomState().options.easing).toBeUndefined()
    })
  })

  describe('nested autoZoom', () => {
    it('throws when autoZoom() is called inside another autoZoom()', async () => {
      await expect(
        autoZoom(async () => {
          await autoZoom(async () => {})
        })
      ).rejects.toThrow('Cannot nest autoZoom() calls')
    })

    it('resets insideAutoZoom state after the outer autoZoom throws', async () => {
      // First call: nested autoZoom causes throw, outer autoZoom exits
      await expect(
        autoZoom(async () => {
          await autoZoom(async () => {})
        })
      ).rejects.toThrow('Cannot nest autoZoom() calls')

      // Should be able to call autoZoom again without error
      const called = vi.fn()
      const p = autoZoom(called)
      await vi.runAllTimersAsync()
      await p
      expect(called).toHaveBeenCalledOnce()
    })
  })

  describe('delay behaviour', () => {
    let recorder: IEventRecorder

    beforeEach(() => {
      recorder = makeRecorder()
      setActiveAutoZoomRecorder(recorder)
    })

    it('does not delay the callback for preZoomDelay and still waits postZoomDelay after addAutoZoomEnd', async () => {
      const order: string[] = []
      vi.mocked(recorder.addAutoZoomEnd).mockImplementation(() => {
        order.push('addAutoZoomEnd')
      })

      const p = autoZoom(
        () => {
          order.push('callback')
        },
        { preZoomDelay: 500, postZoomDelay: 250 }
      )

      await Promise.resolve()
      expect(order).toEqual(['callback', 'addAutoZoomEnd'])

      await vi.advanceTimersByTimeAsync(250)
      await p

      expect(order).toEqual(['callback', 'addAutoZoomEnd'])
    })

    it('does not wait for duration before addAutoZoomEnd', async () => {
      const endTimes: number[] = []
      vi.mocked(recorder.addAutoZoomEnd).mockImplementation(() => {
        endTimes.push(Date.now())
      })

      const startTime = Date.now()
      const p = autoZoom(() => {}, { duration: 300, postZoomDelay: 0 })
      await Promise.resolve()
      await p

      expect(endTimes).toHaveLength(1)
      expect(endTimes[0]).toBe(startTime)
    })

    it('keeps the callback running before postZoomDelay elapses', async () => {
      const order: string[] = []
      vi.mocked(recorder.addAutoZoomEnd).mockImplementation(() => {
        order.push('addAutoZoomEnd')
      })

      const p = autoZoom(
        async () => {
          order.push('callback-start')
          await vi.advanceTimersByTimeAsync(900)
          order.push('callback-end')
        },
        { preZoomDelay: 300, postZoomDelay: 0 }
      )

      await Promise.resolve()
      expect(order).toEqual(['callback-start'])

      await vi.advanceTimersByTimeAsync(900)
      await p

      expect(order).toEqual([
        'callback-start',
        'callback-end',
        'addAutoZoomEnd',
      ])
    })

    it('does not let preZoomDelay delay addAutoZoomEnd when postZoomDelay is also set', async () => {
      const callTimes: number[] = []
      vi.mocked(recorder.addAutoZoomEnd).mockImplementation(() => {
        callTimes.push(Date.now())
      })

      const startTime = Date.now()
      const p = autoZoom(() => {}, { preZoomDelay: 400, postZoomDelay: 200 })

      await Promise.resolve()
      expect(callTimes).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(200)
      await p

      expect(callTimes).toHaveLength(1)
      expect(callTimes[0]).toBe(startTime)
    })

    it('records a final zoom-out focusChange when the zoom viewport is active', async () => {
      setCurrentZoomViewport({
        focusPoint: { x: 120, y: 180 },
        elementRect: { x: 100, y: 160, width: 80, height: 40 },
        end: {
          pointPx: { x: 10, y: 20 },
          size: { widthPx: 640, heightPx: 360 },
        },
        viewportSize: { width: 1280, height: 720 },
      })

      const p = autoZoom(() => {}, { duration: 300, postZoomDelay: 0 })
      await vi.runAllTimersAsync()
      await p

      expect(recorder.addInput).toHaveBeenCalledWith('focusChange', undefined, [
        expect.objectContaining({
          type: 'focusChange',
          x: 120,
          y: 180,
          zoom: expect.objectContaining({
            endMs: expect.any(Number),
            end: {
              pointPx: { x: 0, y: 0 },
              size: { widthPx: 1280, heightPx: 720 },
            },
          }),
        }),
      ])
    })

    it('waits for the final zoom-out duration before resolving', async () => {
      setCurrentZoomViewport({
        focusPoint: { x: 120, y: 180 },
        elementRect: { x: 100, y: 160, width: 80, height: 40 },
        end: {
          pointPx: { x: 10, y: 20 },
          size: { widthPx: 640, heightPx: 360 },
        },
        viewportSize: { width: 1280, height: 720 },
      })

      let resolved = false
      const p = autoZoom(() => {}, {
        duration: 300,
        zoomOutDuration: 300,
        postZoomDelay: 0,
      }).then(() => {
        resolved = true
      })

      await Promise.resolve()
      expect(resolved).toBe(false)

      await vi.advanceTimersByTimeAsync(299)
      expect(resolved).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await p
      expect(resolved).toBe(true)
    })

    it('allows a second autoZoom immediately after awaiting the first', async () => {
      const realRecorder = new EventRecorder()
      realRecorder.start()
      setActiveAutoZoomRecorder(realRecorder)

      setCurrentZoomViewport({
        focusPoint: { x: 120, y: 180 },
        elementRect: { x: 100, y: 160, width: 80, height: 40 },
        end: {
          pointPx: { x: 10, y: 20 },
          size: { widthPx: 640, heightPx: 360 },
        },
        viewportSize: { width: 1280, height: 720 },
      })

      const first = autoZoom(() => {}, {
        duration: 300,
        zoomOutDuration: 300,
        postZoomDelay: 0,
      })
      await vi.advanceTimersByTimeAsync(300)
      await first

      setCurrentZoomViewport({
        focusPoint: { x: 240, y: 260 },
        elementRect: { x: 200, y: 240, width: 80, height: 40 },
        end: {
          pointPx: { x: 20, y: 30 },
          size: { widthPx: 640, heightPx: 360 },
        },
        viewportSize: { width: 1280, height: 720 },
      })

      const second = autoZoom(() => {}, {
        duration: 300,
        zoomOutDuration: 300,
        postZoomDelay: 0,
      })
      await vi.advanceTimersByTimeAsync(300)
      await expect(second).resolves.toBeUndefined()
    })

    it('does not delay addAutoZoomEnd when the callback takes longer than preZoomDelay', async () => {
      const order: string[] = []
      vi.mocked(recorder.addAutoZoomEnd).mockImplementation(() => {
        order.push('addAutoZoomEnd')
      })

      const p = autoZoom(
        async () => {
          order.push('callback-start')
          await vi.advanceTimersByTimeAsync(800)
          order.push('callback-end')
        },
        { preZoomDelay: 200, zoomOutDuration: 0, postZoomDelay: 0 }
      )

      await Promise.resolve()
      expect(order).toEqual(['callback-start'])

      await vi.advanceTimersByTimeAsync(800)
      await p

      expect(order).toEqual([
        'callback-start',
        'callback-end',
        'addAutoZoomEnd',
      ])
    })
  })
})
