import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOOP_EVENT_RECORDER, type IEventRecorder } from './events.js'
import { hide, setActiveHideRecorder } from './hide.js'
import { speed } from './speed.js'
import { time } from './time.js'

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

describe('timeline blocks', () => {
  let recorder: IEventRecorder

  beforeEach(() => {
    recorder = makeRecorder()
    setActiveHideRecorder(recorder)
  })

  afterEach(() => {
    setActiveHideRecorder(NOOP_EVENT_RECORDER)
  })

  it('records speed start/end with multiplier', async () => {
    await speed(0.5, async () => {})

    expect(recorder.addSpeedStart).toHaveBeenCalledWith(0.5)
    expect(recorder.addSpeedEnd).toHaveBeenCalledOnce()
  })

  it('records time start/end with duration', async () => {
    await time(1000, async () => {})

    expect(recorder.addTimeStart).toHaveBeenCalledWith(1000)
    expect(recorder.addTimeEnd).toHaveBeenCalledOnce()
  })

  it('validates speed multiplier', async () => {
    await expect(speed(0, async () => {})).rejects.toThrow(
      'speed() multiplier must be a finite number greater than 0'
    )
  })

  it('validates time duration', async () => {
    await expect(time(-1, async () => {})).rejects.toThrow(
      'time() durationMs must be a finite number greater than or equal to 0'
    )
  })

  it('allows hide inside time', async () => {
    await time(1000, async () => {
      await hide(async () => {})
    })

    expect(recorder.addTimeStart).toHaveBeenCalledOnce()
    expect(recorder.addHideStart).toHaveBeenCalledOnce()
  })

  it('rejects nested time blocks', async () => {
    await expect(
      time(1000, async () => {
        await time(500, async () => {})
      })
    ).rejects.toThrow(
      'time() cannot be nested inside time(); only hide() inside speed() or time() is supported'
    )
  })

  it('rejects nested speed blocks', async () => {
    await speed(2, async () => {
      await expect(speed(0.5, async () => {})).rejects.toThrow(
        'speed() cannot be nested inside speed(); only hide() inside speed() or time() is supported'
      )
    })
  })

  it('rejects speed inside time', async () => {
    await expect(
      time(1000, async () => {
        await speed(0.5, async () => {})
      })
    ).rejects.toThrow(
      'speed() cannot be nested inside time(); only hide() inside speed() or time() is supported'
    )
  })

  it('rejects time inside speed', async () => {
    await expect(
      speed(0.5, async () => {
        await time(1000, async () => {})
      })
    ).rejects.toThrow(
      'time() cannot be nested inside speed(); only hide() inside speed() or time() is supported'
    )
  })

  it('emits speed end when the block body throws', async () => {
    await expect(
      speed(2, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    expect(recorder.addSpeedStart).toHaveBeenCalledWith(2)
    expect(recorder.addSpeedEnd).toHaveBeenCalledOnce()
  })

  it('emits time end when the block body throws', async () => {
    await expect(
      time(1000, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    expect(recorder.addTimeStart).toHaveBeenCalledWith(1000)
    expect(recorder.addTimeEnd).toHaveBeenCalledOnce()
  })
})
