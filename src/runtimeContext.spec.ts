import { describe, it, expect } from 'vitest'
import {
  createScreenCIRuntimeContext,
  getRuntimeCaptureKind,
  getRuntimeCrop,
  getRuntimeRecordOptions,
  getRuntimeRenderOptions,
  isScreenshotCapture,
  runWithScreenCIRuntimeContext,
  setRuntimeCrop,
} from './runtimeContext.js'

describe('createScreenCIRuntimeContext', () => {
  it('defaults the new recording fields', () => {
    const ctx = createScreenCIRuntimeContext()
    expect(ctx.recordOptions).toBeNull()
    expect(ctx.renderOptions).toBeUndefined()
    expect(ctx.crop).toBeNull()
    expect(ctx.captureKind).toBe('video')
  })

  it('carries the capture kind from overrides', () => {
    const ctx = createScreenCIRuntimeContext({ captureKind: 'screenshot' })
    expect(ctx.captureKind).toBe('screenshot')
  })

  it('carries the recording fields from overrides', () => {
    const recordOptions = { aspectRatio: '16:9', quality: '1080p' } as const
    const ctx = createScreenCIRuntimeContext({
      recordOptions,
      renderOptions: undefined,
    })
    expect(ctx.recordOptions).toBe(recordOptions)
  })
})

describe('runtime getters/setters', () => {
  it('reads recording fields from the active context', () => {
    const recordOptions = { aspectRatio: '1:1', quality: '720p' } as const
    const ctx = createScreenCIRuntimeContext({ recordOptions })

    runWithScreenCIRuntimeContext(ctx, () => {
      expect(getRuntimeRecordOptions()).toBe(recordOptions)
      expect(getRuntimeRenderOptions()).toBeUndefined()
    })
  })

  it('sets and reads the per-test crop on the active context', () => {
    const ctx = createScreenCIRuntimeContext()

    const cropRecord = {
      box: { x: 100, y: 200, width: 500, height: 400 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      source: 'region' as const,
    }

    runWithScreenCIRuntimeContext(ctx, () => {
      expect(getRuntimeCrop()).toBeUndefined()
      setRuntimeCrop(cropRecord)
      expect(getRuntimeCrop()).toEqual(cropRecord)
    })

    // The crop is stored on the context object itself, not a module global.
    expect(ctx.crop).toEqual(cropRecord)
  })

  it('reports the capture kind from the active context', () => {
    runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ captureKind: 'screenshot' }),
      () => {
        expect(getRuntimeCaptureKind()).toBe('screenshot')
        expect(isScreenshotCapture()).toBe(true)
      }
    )

    runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ captureKind: 'video' }),
      () => {
        expect(getRuntimeCaptureKind()).toBe('video')
        expect(isScreenshotCapture()).toBe(false)
      }
    )
  })
})
