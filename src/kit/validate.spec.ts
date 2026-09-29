import { describe, expect, it } from 'vitest'
import type { Locator } from '@playwright/test'
import { isKitOverlayInput, validateKitInput } from './validate.js'

const locator = { boundingBox: async () => null } as unknown as Locator

describe('isKitOverlayInput', () => {
  it('matches objects with a string kit', () => {
    expect(isKitOverlayInput({ kit: 'ring' })).toBe(true)
    expect(isKitOverlayInput({ path: './x.html' })).toBe(false)
    expect(isKitOverlayInput('x')).toBe(false)
    expect(isKitOverlayInput(null)).toBe(false)
  })
})

describe('validateKitInput', () => {
  it('fills the per-primitive placement defaults', () => {
    const ring = validateKitInput('ov', { kit: 'ring', anchor: locator })
    expect(ring.placement).toMatchObject({
      kind: 'anchor',
      side: 'over',
      margin: 6,
      bleed: 16,
    })
    const callout = validateKitInput('ov', {
      kit: 'callout',
      anchor: locator,
      text: 'Hi',
    })
    expect(callout.placement).toMatchObject({
      kind: 'anchor',
      side: 'bottom',
      align: 'center',
      gap: 14,
      bleed: 24,
    })
    const step = validateKitInput('ov', {
      kit: 'step',
      number: 2,
      anchor: locator,
    })
    expect(step.placement).toMatchObject({
      kind: 'anchor',
      side: 'left',
      align: 'start',
      gap: 10,
    })
    const badge = validateKitInput('ov', {
      kit: 'badge',
      text: 'New',
      x: 5,
      y: 6,
    })
    expect(badge.placement).toEqual({
      kind: 'point',
      x: 5,
      y: 6,
      relativeTo: 'recording',
      bleed: 12,
    })
    const title = validateKitInput('ov', { kit: 'title', title: 'T' })
    expect(title.placement).toEqual({ kind: 'fill' })
    expect(title).toMatchObject({
      fadeInMs: 180,
      fadeOutMs: 180,
      pinToScreen: false,
    })
  })

  it('keeps explicit options', () => {
    const spec = validateKitInput('ov', {
      kit: 'callout',
      anchor: locator,
      text: 'Hi',
      side: 'right',
      align: 'end',
      gap: 20,
      maxWidth: 200,
      duration: 1500,
      fadeIn: 0,
      pinToScreen: true,
      theme: { accent: '#fff' },
    })
    expect(spec).toMatchObject({
      kit: 'callout',
      maxWidth: 200,
      durationMs: 1500,
      fadeInMs: 0,
      fadeOutMs: 180,
      pinToScreen: true,
      theme: { accent: '#fff' },
      placement: { side: 'right', align: 'end', gap: 20 },
    })
  })

  it('rejects bad inputs with a clear message', () => {
    const bad = (input: unknown) => () => validateKitInput('ov', input as never)
    expect(bad({ kit: 'sparkle' })).toThrow(/unknown kit "sparkle"/)
    expect(bad({ kit: 'ring' })).toThrow(
      /"anchor" must be a Playwright locator/
    )
    expect(bad({ kit: 'callout', anchor: locator, text: '' })).toThrow(
      /"text" must be a non-empty/
    )
    expect(
      bad({ kit: 'callout', anchor: locator, text: 'x', side: 'over' })
    ).toThrow(/"side" must be/)
    expect(
      bad({ kit: 'callout', anchor: locator, text: 'x', align: 'middle' })
    ).toThrow(/"align"/)
    expect(bad({ kit: 'badge', text: 'x' })).toThrow(
      /set "anchor" \(a locator\) or both "x" and "y"/
    )
    expect(
      bad({ kit: 'badge', text: 'x', anchor: locator, x: 1, y: 2 })
    ).toThrow(/cannot combine/)
    expect(bad({ kit: 'badge', text: 'x', x: 1, y: 2, side: 'top' })).toThrow(
      /only apply with "anchor"/
    )
    expect(bad({ kit: 'badge', text: 'x', x: 1, y: 2, tone: 'loud' })).toThrow(
      /"tone"/
    )
    expect(bad({ kit: 'step', number: 0, anchor: locator })).toThrow(
      /"number" must be an integer/
    )
    expect(bad({ kit: 'spotlight', anchor: locator, dim: 2 })).toThrow(/"dim"/)
    expect(bad({ kit: 'keys', keys: [], x: 0, y: 0 })).toThrow(
      /"keys" must be a non-empty array/
    )
    expect(bad({ kit: 'title', title: 'T', duration: -1 })).toThrow(
      /"duration"/
    )
    expect(bad({ kit: 'title', title: 'T', fadeIn: 1.5 })).toThrow(/"fadeIn"/)
    expect(bad({ kit: 'title', title: 'T', theme: { radius: '8px' } })).toThrow(
      /theme.radius must be a number/
    )
    expect(bad({ kit: 'title', title: 'T', theme: { accent: '' } })).toThrow(
      /theme.accent must be a CSS colour/
    )
    expect(
      bad({ kit: 'title', title: 'T', theme: { scheme: 'auto' } })
    ).toThrow(/theme.scheme/)
  })
})
