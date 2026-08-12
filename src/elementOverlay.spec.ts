import { describe, it, expect, afterEach } from 'vitest'
import {
  buildElementOverlayDocument,
  isReactElement,
  setElementOverlayRenderer,
  resetElementOverlayRenderer,
} from './elementOverlay.js'

function fakeElement(brand: string): unknown {
  return {
    $$typeof: Symbol.for(brand),
    type: 'div',
    props: { children: 'Hi' },
    key: null,
  }
}

describe('isReactElement', () => {
  it('accepts the React 18 element brand', () => {
    expect(isReactElement(fakeElement('react.element'))).toBe(true)
  })

  it('accepts the React 19 element brand', () => {
    expect(isReactElement(fakeElement('react.transient.element'))).toBe(true)
  })

  it('rejects plain objects, configs, and primitives', () => {
    expect(isReactElement({ path: './x.png' })).toBe(false)
    expect(isReactElement({ type: 'div', props: {}, key: null })).toBe(false)
    expect(isReactElement('logo.png')).toBe(false)
    expect(isReactElement(null)).toBe(false)
    expect(isReactElement(undefined)).toBe(false)
  })
})

describe('buildElementOverlayDocument', () => {
  afterEach(() => {
    resetElementOverlayRenderer()
  })

  it('places the rendered markup inside the overlay root of the host document', async () => {
    let seen: unknown
    setElementOverlayRenderer(async (element) => {
      seen = element
      return '<span class="badge">New</span>'
    })

    const element = fakeElement('react.element')
    const doc = await buildElementOverlayDocument(element)

    expect(seen).toBe(element)
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc).toContain(
      '<div id="screenci-overlay-root"><span class="badge">New</span></div>'
    )
    // Static markup only: no mount script is emitted.
    expect(doc).not.toContain('<script>')
  })
})
