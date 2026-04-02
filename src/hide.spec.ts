import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { hide, setActiveHideRecorder } from './hide.js'
import type { IEventRecorder } from './events.js'

function makeRecorder(): IEventRecorder {
  return {
    start: vi.fn(),
    addClick: vi.fn(),
    addMouseMove: vi.fn(),
    addMouseShow: vi.fn(),
    addMouseHide: vi.fn(),
    addCaptionStart: vi.fn(),
    addCaptionEnd: vi.fn(),
    addHideStart: vi.fn(),
    addHideEnd: vi.fn(),
    addAutoZoomStart: vi.fn(),
    addAutoZoomEnd: vi.fn(),
    addInput: vi.fn(),
    getEvents: vi.fn(() => []),
    writeToFile: vi.fn(),
  }
}

describe('hide', () => {
  afterEach(() => {
    setActiveHideRecorder(null)
  })

  describe('with active recorder', () => {
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

  describe('without active recorder', () => {
    it('still executes the callback when recorder is null', async () => {
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

    it('resets insideHide state after the outer hide throws', async () => {
      // First call: nested hide causes throw, outer hide exits
      await expect(
        hide(async () => {
          await hide(async () => {})
        })
      ).rejects.toThrow('Cannot nest hide() calls')

      // Should be able to call hide again without error
      const called = vi.fn()
      await hide(called)
      expect(called).toHaveBeenCalledOnce()
    })
  })
})
