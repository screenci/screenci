import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resizeRecording, resetRecordingSize } from './recordingSize.js'
import { setActiveHideRecorder } from './hide.js'
import { setRuntimeRecordingSize } from './runtimeContext.js'
import { NOOP_EVENT_RECORDER, type IEventRecorder } from './events.js'

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
    addRecordingSizeStart: vi.fn(),
    addRecordingSizeEnd: vi.fn(),
    registerVoiceForLang: vi.fn(),
    getEvents: vi.fn(() => []),
    writeToFile: vi.fn(),
  } as unknown as IEventRecorder
}

describe('resizeRecording / resetRecordingSize', () => {
  let recorder: IEventRecorder

  beforeEach(() => {
    recorder = makeRecorder()
    setActiveHideRecorder(recorder)
    setRuntimeRecordingSize(1)
  })

  afterEach(() => {
    setActiveHideRecorder(NOOP_EVENT_RECORDER)
    setRuntimeRecordingSize(1)
  })

  it('emits recordingSizeStart with the requested size', async () => {
    await resizeRecording(0.8)
    expect(recorder.addRecordingSizeStart).toHaveBeenCalledExactlyOnceWith(0.8)
  })

  it('emits recordingSizeEnd when resetting after a resize', async () => {
    await resizeRecording(0.8)
    await resetRecordingSize()
    expect(recorder.addRecordingSizeEnd).toHaveBeenCalledOnce()
  })

  it('no-ops resetRecordingSize when already full screen', async () => {
    await resetRecordingSize()
    expect(recorder.addRecordingSizeEnd).not.toHaveBeenCalled()
  })

  it('no-ops a second consecutive resetRecordingSize', async () => {
    await resizeRecording(0.5)
    await resetRecordingSize()
    await resetRecordingSize()
    expect(recorder.addRecordingSizeEnd).toHaveBeenCalledOnce()
  })

  it('allows resizing back to full screen explicitly', async () => {
    await resizeRecording(1)
    expect(recorder.addRecordingSizeStart).toHaveBeenCalledExactlyOnceWith(1)
  })

  it.each([0, -0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws for out-of-range size %p',
    async (size) => {
      await expect(resizeRecording(size)).rejects.toThrow(
        'resizeRecording(size) requires size in (0, 1]'
      )
    }
  )

  it('works with the default no-op recorder', async () => {
    setActiveHideRecorder(NOOP_EVENT_RECORDER)
    await expect(resizeRecording(0.7)).resolves.toBeUndefined()
    await expect(resetRecordingSize()).resolves.toBeUndefined()
  })
})
