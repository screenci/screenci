import { describe, it, expect } from 'vitest'
import { EventRecorder } from './events.js'
import type { AssetStartEvent } from './events.js'

/**
 * Regression: EventRecorder serializes `overMouse` and `pinToScreen` onto the
 * recorded assetStart. These are set by the SDK (asset.ts) but were being
 * dropped by the recorder's per-kind serialization whitelist, so they never
 * reached data.json and the renderer never saw them.
 */
describe('EventRecorder serializes overMouse / pinToScreen', () => {
  function record(fn: (r: EventRecorder) => void): AssetStartEvent {
    const r = new EventRecorder()
    r.start()
    fn(r)
    const event = r
      .getEvents()
      .find((e) => e.type === 'assetStart') as AssetStartEvent
    return event
  }

  it('image assetStart keeps overMouse and pinToScreen', () => {
    const e = record((r) =>
      r.addAssetStart('logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 2000,
        fullScreen: false,
        overMouse: true,
        pinToScreen: true,
      })
    )
    expect(e).toMatchObject({ overMouse: true, pinToScreen: true })
  })

  it('video assetStart keeps overMouse and pinToScreen', () => {
    const e = record((r) =>
      r.addAssetStart('clip', {
        kind: 'video',
        path: './clip.mp4',
        audio: 1,
        fullScreen: false,
        overMouse: true,
        pinToScreen: true,
      })
    )
    expect(e).toMatchObject({ overMouse: true, pinToScreen: true })
  })

  it('animation assetStart keeps overMouse and pinToScreen', () => {
    const e = record((r) =>
      r.addAssetStart('anim', {
        kind: 'animation',
        path: './anim.mp4',
        durationMs: 1000,
        fullScreen: false,
        overMouse: true,
        pinToScreen: true,
      })
    )
    expect(e).toMatchObject({ overMouse: true, pinToScreen: true })
  })

  it('dependency assetStart keeps overMouse and pinToScreen', () => {
    const e = record((r) =>
      r.addAssetStart('dep', {
        kind: 'dependency',
        dependency: { name: 'other' },
        fullScreen: false,
        overMouse: true,
        pinToScreen: true,
      })
    )
    expect(e).toMatchObject({ overMouse: true, pinToScreen: true })
  })

  it('pending assetStart (rendered/animated overlay) keeps overMouse and pinToScreen', () => {
    const e = record((r) =>
      r.addPendingAssetStart('ring', {
        kind: 'image',
        durationMs: 1500,
        fullScreen: false,
        overMouse: true,
        pinToScreen: true,
        request: {} as never,
      })
    )
    expect(e).toMatchObject({ overMouse: true, pinToScreen: true })
  })

  it('omits both fields when unset (byte-identical default)', () => {
    const e = record((r) =>
      r.addAssetStart('logo', {
        kind: 'image',
        path: './logo.png',
        durationMs: 2000,
        fullScreen: false,
      })
    )
    expect(e).not.toHaveProperty('overMouse')
    expect(e).not.toHaveProperty('pinToScreen')
  })
})
