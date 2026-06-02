import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { POST_HIDE_PAUSE, hide, setActiveHideRecorder } from './hide.js'
import { NOOP_EVENT_RECORDER, type IEventRecorder } from './events.js'

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
    addSpeedStart: vi.fn(),
    addSpeedEnd: vi.fn(),
    addTimeStart: vi.fn(),
    addTimeEnd: vi.fn(),
    addAutoZoomStart: vi.fn(),
    addAutoZoomEnd: vi.fn(),
    registerVoiceForLang: vi.fn(),
    getEvents: vi.fn(() => []),
    writeToFile: vi.fn(),
  }
}

describe('hide', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    process.env = originalEnv
    setActiveHideRecorder(NOOP_EVENT_RECORDER)
  })

  describe('with configured recorder', () => {
    let recorder: IEventRecorder

    beforeEach(() => {
      recorder = makeRecorder()
      setActiveHideRecorder(recorder)
    })

    it('adds hideStart before executing the callback', async () => {
      const order: string[] = []
      vi.mocked(recorder.addHideStart).mockImplementation(() => {
        order.push('hideStart')
      })

      await hide(() => {
        order.push('callback')
      })

      expect(order[0]).toBe('hideStart')
      expect(order[1]).toBe('callback')
    })

    it('sets insideHide before emitting hideStart', async () => {
      const states: boolean[] = []
      vi.mocked(recorder.addHideStart).mockImplementation(() => {
        states.push(true)
      })

      await hide(() => {
        states.push(true)
      })

      expect(states).toEqual([true, true])
    })

    it('adds hideEnd after executing the callback', async () => {
      const order: string[] = []
      vi.mocked(recorder.addHideEnd).mockImplementation(() => {
        order.push('hideEnd')
      })

      await hide(() => {
        order.push('callback')
      })

      expect(order[0]).toBe('callback')
      expect(order[1]).toBe('hideEnd')
    })

    it('waits for the post-hide pause before emitting hideEnd', async () => {
      vi.useFakeTimers()

      try {
        const order: string[] = []
        vi.mocked(recorder.addHideEnd).mockImplementation(() => {
          order.push('hideEnd')
        })

        const hidePromise = hide(() => {
          order.push('callback')
        }).then(() => {
          order.push('resolved')
        })

        await Promise.resolve()
        expect(order).toEqual(['callback'])

        await vi.advanceTimersByTimeAsync(POST_HIDE_PAUSE - 1)
        await Promise.resolve()
        expect(order).toEqual(['callback'])

        await vi.advanceTimersByTimeAsync(1)
        await hidePromise
        expect(order).toEqual(['callback', 'hideEnd', 'resolved'])
      } finally {
        vi.useRealTimers()
      }
    })

    it('skips the post-hide pause when recording timings are disabled', async () => {
      vi.useFakeTimers()

      try {
        process.env.SCREENCI_DISABLE_RECORDING_TIMINGS = 'true'

        const order: string[] = []
        vi.mocked(recorder.addHideEnd).mockImplementation(() => {
          order.push('hideEnd')
        })

        const hidePromise = hide(() => {
          order.push('callback')
        }).then(() => {
          order.push('resolved')
        })

        await vi.advanceTimersByTimeAsync(0)
        await hidePromise

        expect(order).toEqual(['callback', 'hideEnd', 'resolved'])
      } finally {
        vi.useRealTimers()
      }
    })

    it('awaits async callbacks', async () => {
      const order: string[] = []

      await hide(async () => {
        await Promise.resolve()
        order.push('async-callback')
      })

      expect(order).toEqual(['async-callback'])
      expect(recorder.addHideEnd).toHaveBeenCalledOnce()
    })

    it('calls addHideStart and addHideEnd once each', async () => {
      await hide(() => {})
      expect(recorder.addHideStart).toHaveBeenCalledOnce()
      expect(recorder.addHideEnd).toHaveBeenCalledOnce()
    })
  })

  describe('with the default no-op recorder', () => {
    it('still executes the callback', async () => {
      setActiveHideRecorder(NOOP_EVENT_RECORDER)
      const called = vi.fn()
      await hide(called)
      expect(called).toHaveBeenCalledOnce()
    })
  })

  describe('nested hide', () => {
    it('throws when hide() is called inside another hide()', async () => {
      await expect(
        hide(async () => {
          await hide(async () => {})
        })
      ).rejects.toThrow('Cannot nest hide() calls')
    })

    it('resets state after nested hide throws', async () => {
      await expect(
        hide(async () => {
          await hide(async () => {})
        })
      ).rejects.toThrow('Cannot nest hide() calls')

      const recorder = makeRecorder()
      setActiveHideRecorder(recorder)
      await hide(async () => {})
      expect(recorder.addHideStart).toHaveBeenCalledOnce()
    })
  })

  describe('POST_HIDE_PAUSE', () => {
    it('adds a 350ms tail before revealing hidden recording', () => {
      expect(POST_HIDE_PAUSE).toBe(350)
    })
  })
})
