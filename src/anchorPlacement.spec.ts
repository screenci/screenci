import { describe, expect, it } from 'vitest'
import {
  oppositeSide,
  overContentBox,
  resolveAnchoredBox,
  SIDES,
  type AnchorSpec,
  type OverlaySide,
} from './anchorPlacement.js'

const VIEWPORT = { width: 1000, height: 600 }
const ELEMENT = { x: 400, y: 250, width: 200, height: 100 }
const CONTENT = { width: 120, height: 40 }

const spec = (over: Partial<AnchorSpec> = {}): AnchorSpec => ({
  element: ELEMENT,
  viewport: VIEWPORT,
  side: 'bottom',
  align: 'center',
  gap: 10,
  margin: 0,
  bleed: 0,
  flip: true,
  keepInViewport: true,
  ...over,
})

describe('resolveAnchoredBox', () => {
  it('places the content below the element, centred, gap apart', () => {
    const r = resolveAnchoredBox(spec(), CONTENT)
    expect(r.content).toEqual({ x: 440, y: 360, width: 120, height: 40 })
    expect(r.side).toBe('bottom')
    expect(r.flipped).toBe(false)
    expect(r.box).toEqual(r.content)
  })

  it('places on every side with every alignment', () => {
    const top = resolveAnchoredBox(
      spec({ side: 'top', align: 'start' }),
      CONTENT
    )
    expect(top.content).toEqual({ x: 400, y: 200, width: 120, height: 40 })
    const right = resolveAnchoredBox(
      spec({ side: 'right', align: 'end' }),
      CONTENT
    )
    expect(right.content).toEqual({ x: 610, y: 310, width: 120, height: 40 })
    const left = resolveAnchoredBox(
      spec({ side: 'left', align: 'center' }),
      CONTENT
    )
    expect(left.content).toEqual({ x: 270, y: 280, width: 120, height: 40 })
  })

  it('inflates the recorded box by the bleed and keeps the content box', () => {
    const r = resolveAnchoredBox(spec({ bleed: 16 }), CONTENT)
    expect(r.content).toEqual({ x: 440, y: 360, width: 120, height: 40 })
    expect(r.box).toEqual({ x: 424, y: 344, width: 152, height: 72 })
  })

  it('flips to the opposite side when the content leaves the viewport', () => {
    const nearBottom = spec({ element: { ...ELEMENT, y: 540 } })
    const r = resolveAnchoredBox(nearBottom, CONTENT)
    expect(r.side).toBe('top')
    expect(r.flipped).toBe(true)
    expect(r.content.y).toBe(540 - 10 - 40)
  })

  it('does not flip when flip is off, and does not flip to a worse side', () => {
    const nearBottom = spec({ element: { ...ELEMENT, y: 540 }, flip: false })
    expect(resolveAnchoredBox(nearBottom, CONTENT).side).toBe('bottom')
    // Tall content that fits nowhere: stays on the requested side.
    const tall = { width: 120, height: 700 }
    const r = resolveAnchoredBox(
      spec({ element: { ...ELEMENT, y: 550 } }),
      tall
    )
    expect(r.side).toBe('top')
    const worse = resolveAnchoredBox(
      spec({ element: { ...ELEMENT, y: 10 } }),
      tall
    )
    expect(worse.side).toBe('bottom')
    expect(worse.flipped).toBe(false)
  })

  it('slides along the align axis only, never onto the element', () => {
    const atRightEdge = spec({
      element: { ...ELEMENT, x: 950 },
      align: 'start',
    })
    const r = resolveAnchoredBox(atRightEdge, CONTENT)
    expect(r.content.x).toBe(1000 - 120)
    expect(r.content.y).toBe(360)
    const atLeftEdge = spec({
      side: 'right',
      element: { ...ELEMENT, y: -30 },
      align: 'start',
    })
    const l = resolveAnchoredBox(atLeftEdge, CONTENT)
    expect(l.content.y).toBe(0)
    expect(l.content.x).toBe(610)
  })

  it('leaves an overflowing box alone when keepInViewport is off', () => {
    const r = resolveAnchoredBox(
      spec({
        element: { ...ELEMENT, x: 950 },
        align: 'start',
        keepInViewport: false,
      }),
      CONTENT
    )
    expect(r.content.x).toBe(950)
  })

  it('uses the element box plus margin for over, ignoring the content size', () => {
    const r = resolveAnchoredBox(
      spec({ side: 'over', margin: 8, bleed: 12 }),
      CONTENT
    )
    expect(r.content).toEqual({ x: 392, y: 242, width: 216, height: 116 })
    expect(r.box).toEqual({ x: 380, y: 230, width: 240, height: 140 })
    expect(r.side).toBe('over')
  })
})

describe('overContentBox', () => {
  it('clamps the inflated element box to the viewport', () => {
    expect(
      overContentBox({ x: 5, y: 5, width: 100, height: 50 }, VIEWPORT, 10)
    ).toEqual({ x: 0, y: 0, width: 115, height: 65 })
  })
})

describe('oppositeSide', () => {
  it('pairs every side', () => {
    const pairs: Record<OverlaySide, OverlaySide> = {
      top: 'bottom',
      bottom: 'top',
      left: 'right',
      right: 'left',
      over: 'over',
    }
    for (const side of SIDES) expect(oppositeSide(side)).toBe(pairs[side])
  })
})
