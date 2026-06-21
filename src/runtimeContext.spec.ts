import { describe, it, expect } from 'vitest'
import {
  createScreenCIRuntimeContext,
  getRuntimeCrop,
  getRuntimeRecordOptions,
  getRuntimeRenderOptions,
  runWithScreenCIRuntimeContext,
  setRuntimeCrop,
} from './runtimeContext.js'

describe('createScreenCIRuntimeContext', () => {
  it('defaults the new recording fields', () => {
    const ctx = createScreenCIRuntimeContext()
    expect(ctx.recordOptions).toBeNull()
    expect(ctx.renderOptions).toBeUndefined()
    expect(ctx.crop).toBeNull()
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

    runWithScreenCIRuntimeContext(ctx, () => {
      expect(getRuntimeCrop()).toBeUndefined()
      setRuntimeCrop({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 })
      expect(getRuntimeCrop()).toEqual({
        x: 0.1,
        y: 0.2,
        width: 0.5,
        height: 0.4,
      })
    })

    // The crop is stored on the context object itself, not a module global.
    expect(ctx.crop).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 })
  })
})
