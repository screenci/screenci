import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  autoZoom,
  setActiveAutoZoomRecorder,
  getZoomDuration,
  getZoomEasing,
  getLastZoomLocation,
  setLastZoomLocation,
} from './autoZoom.js'
import type { IEventRecorder } from './events.js'

function makeRecorder(): IEventRecorder {
  return {
    start: vi.fn(),
    addInput: vi.fn(),
    addCueStart: vi.fn(),
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
    setActiveAutoZoomRecorder(null)
    setLastZoomLocation(null)
    vi.useRealTimers()
  })

  describe('with active recorder', () => {
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

  describe('without active recorder', () => {
    it('still executes the callback when recorder is null', async () => {
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
          durationDuringFn = getZoomDuration()
        },
        { duration: 400 }
      )
      await vi.runAllTimersAsync()
      await p
      expect(durationDuringFn).toBe(400)
    })

    it('defaults zoom duration to DEFAULT_ZOOM_DURATION when no option given', async () => {
      let durationDuringFn: number | null = null
      const p = autoZoom(() => {
        durationDuringFn = getZoomDuration()
      })
      await vi.runAllTimersAsync()
      await p
      expect(durationDuringFn).not.toBeNull()
    })

    it('exposes zoom easing during fn execution', async () => {
      let easingDuringFn: string | null = null
      const p = autoZoom(
        () => {
          easingDuringFn = getZoomEasing()
        },
        { easing: 'ease-in-out-strong' }
      )
      await vi.runAllTimersAsync()
      await p
      expect(easingDuringFn).toBe('ease-in-out-strong')
    })

    it('defaults zoom easing when no option given', async () => {
      let easingDuringFn: string | null = null
      const p = autoZoom(() => {
        easingDuringFn = getZoomEasing()
      })
      await vi.runAllTimersAsync()
      await p
      expect(easingDuringFn).toBe('ease-out')
    })

    it('zoom duration is null after fn completes', async () => {
      const p = autoZoom(() => {}, { duration: 300 })
      await vi.runAllTimersAsync()
      await p
      expect(getZoomDuration()).toBeNull()
    })

    it('zoom easing is null after fn completes', async () => {
      const p = autoZoom(() => {}, { easing: 'linear' })
      await vi.runAllTimersAsync()
      await p
      expect(getZoomEasing()).toBeNull()
    })

    it('resets lastZoomLocation to null after fn completes', async () => {
      setLastZoomLocation({
        x: 100,
        y: 200,
        elementRect: { x: 80, y: 190, width: 40, height: 20 },
        eventType: 'click',
      })
      const p = autoZoom(() => {})
      await vi.runAllTimersAsync()
      await p
      expect(getLastZoomLocation()).toBeNull()
    })

    it('preserves lastZoomLocation set during fn execution while still inside', async () => {
      let locDuringFn: ReturnType<typeof getLastZoomLocation> = null
      const p = autoZoom(() => {
        setLastZoomLocation({
          x: 50,
          y: 60,
          elementRect: { x: 40, y: 55, width: 20, height: 10 },
          eventType: 'fill',
        })
        locDuringFn = getLastZoomLocation()
      })
      await vi.runAllTimersAsync()
      await p
      expect(locDuringFn).not.toBeNull()
      expect(locDuringFn!.x).toBe(50)
      expect(getLastZoomLocation()).toBeNull() // reset after
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

  describe('duration sleep behaviour', () => {
    let recorder: IEventRecorder

    beforeEach(() => {
      recorder = makeRecorder()
      setActiveAutoZoomRecorder(recorder)
    })

    it('sleeps duration ms after addAutoZoomEnd', async () => {
      const order: string[] = []
      vi.mocked(recorder.addAutoZoomEnd).mockImplementation(() => {
        order.push('addAutoZoomEnd')
      })

      const p = autoZoom(
        () => {
          order.push('callback')
        },
        { duration: 500, postZoomInOutDelay: 0 }
      )

      // pre-end sleep (500ms) + post-end sleep (duration+postZoomInOutDelay = 500ms)
      await vi.advanceTimersByTimeAsync(1000)
      await p

      expect(order).toEqual(['callback', 'addAutoZoomEnd'])
    })

    it('sleeps remaining time before addAutoZoomEnd when fn finishes early', async () => {
      const endTimes: number[] = []
      vi.mocked(recorder.addAutoZoomEnd).mockImplementation(() => {
        endTimes.push(Date.now())
      })

      const startTime = Date.now()
      const p = autoZoom(() => {}, { duration: 300, postZoomInOutDelay: 0 })

      // pre-end (300ms) + post-end (300ms)
      await vi.advanceTimersByTimeAsync(600)
      await p

      // addAutoZoomEnd should have been called at or after startTime + 300ms
      expect(endTimes[0]).toBeGreaterThanOrEqual(startTime + 300)
    })

    it('does not add extra pre-end sleep when fn already takes longer than duration + postZoomInOutDelay', async () => {
      const order: string[] = []
      vi.mocked(recorder.addAutoZoomEnd).mockImplementation(() => {
        order.push('addAutoZoomEnd')
      })

      const p = autoZoom(
        async () => {
          order.push('callback-start')
          // fn takes 900ms; duration=300 + postZoomInOutDelay=0 = 300ms, already exceeded
          await vi.advanceTimersByTimeAsync(900)
          order.push('callback-end')
        },
        { duration: 300, postZoomInOutDelay: 0 }
      )

      // post-end sleep: duration+postZoomInOutDelay = 300ms
      await vi.advanceTimersByTimeAsync(300)
      await p

      expect(order).toEqual([
        'callback-start',
        'callback-end',
        'addAutoZoomEnd',
      ])
    })

    it('includes postZoomInOutDelay in the pre-end wait', async () => {
      const callTimes: number[] = []
      vi.mocked(recorder.addAutoZoomEnd).mockImplementation(() => {
        callTimes.push(Date.now())
      })

      const startTime = Date.now()
      // duration=0, postZoomInOutDelay=400 → pre-end wait = 0+400 = 400ms
      const p = autoZoom(() => {}, { duration: 0, postZoomInOutDelay: 400 })

      // Advance only partway — addAutoZoomEnd should not be called yet
      await vi.advanceTimersByTimeAsync(200)
      expect(callTimes).toHaveLength(0)

      // Advance past the full pre-end wait (400ms) + post-end (duration+postZoomInOutDelay = 400ms)
      await vi.advanceTimersByTimeAsync(600)
      await p

      expect(callTimes).toHaveLength(1)
      expect(callTimes[0]).toBeGreaterThanOrEqual(startTime + 400)
    })

    it('skips pre-end sleep when fn already consumed duration + postZoomInOutDelay', async () => {
      const order: string[] = []
      vi.mocked(recorder.addAutoZoomEnd).mockImplementation(() => {
        order.push('addAutoZoomEnd')
      })

      const p = autoZoom(
        async () => {
          order.push('callback-start')
          // fn takes 800ms; duration=200 + postZoomInOutDelay=300 = 500ms, already exceeded
          await vi.advanceTimersByTimeAsync(800)
          order.push('callback-end')
        },
        { duration: 200, postZoomInOutDelay: 300 }
      )

      // post-end sleep: duration+postZoomInOutDelay = 200+300 = 500ms
      await vi.advanceTimersByTimeAsync(500)
      await p

      expect(order).toEqual([
        'callback-start',
        'callback-end',
        'addAutoZoomEnd',
      ])
    })
  })
})
