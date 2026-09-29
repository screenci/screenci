import { describe, expect, it } from 'vitest'
import { buildKitDocument, renderKitFragment } from './render.js'
import { FALLBACK_THEME } from './theme.js'
import { validateKitInput, type KitSpec } from './validate.js'
import type { Locator } from '@playwright/test'

const locator = { boundingBox: async () => null } as unknown as Locator
const theme = { ...FALLBACK_THEME, accent: 'rgb(220, 38, 38)', radius: 8 }
const spec = (input: Parameters<typeof validateKitInput>[1]): KitSpec =>
  validateKitInput('ov', input)

describe('renderKitFragment', () => {
  it('draws a ring that fills its box in the accent colour', () => {
    const { html, css } = renderKitFragment(
      spec({ kit: 'ring', anchor: locator }),
      {
        theme,
        side: 'over',
        geometry: {},
      }
    )
    expect(html).toBe('<div class="k-ring"></div>')
    expect(css).toContain('width:100%;height:100%')
    expect(css).toContain('border:3px solid rgb(220, 38, 38)')
    expect(css).toContain('border-radius:8px')
  })

  it('escapes callout text and points the pointer at the element for the landed side', () => {
    const callout = spec({
      kit: 'callout',
      anchor: locator,
      text: '<b>Save</b> & go',
    })
    const below = renderKitFragment(callout, {
      theme,
      side: 'bottom',
      geometry: {},
    })
    expect(below.html).toContain('&lt;b&gt;Save&lt;/b&gt; &amp; go')
    // Sitting below the element: the pointer sticks out of the top edge.
    expect(below.css).toContain('.k-pointer{left:calc(50% - 7px);top:-7px}')
    const above = renderKitFragment(callout, {
      theme,
      side: 'top',
      geometry: {},
    })
    expect(above.css).toContain('.k-pointer{left:calc(50% - 7px);bottom:-7px}')
    expect(below.css).toContain(`background:${theme.surface}`)
    expect(below.css).toContain('max-width:360px')
  })

  it('renders badge tones, step numbers and keycaps from the theme', () => {
    const accent = renderKitFragment(
      spec({ kit: 'badge', text: 'New', x: 0, y: 0 }),
      {
        theme,
        side: undefined,
        geometry: {},
      }
    )
    expect(accent.css).toContain(
      `background:${theme.accent};color:${theme.accentForeground}`
    )
    const neutral = renderKitFragment(
      spec({ kit: 'badge', text: 'New', tone: 'neutral', x: 0, y: 0 }),
      { theme, side: undefined, geometry: {} }
    )
    expect(neutral.css).toContain(
      `background:${theme.surface};color:${theme.onSurface}`
    )
    const step = renderKitFragment(
      spec({ kit: 'step', number: 3, anchor: locator }),
      {
        theme,
        side: 'left',
        geometry: {},
      }
    )
    expect(step.html).toBe('<div class="k-step">3</div>')
    expect(step.css).toContain('width:32px;height:32px')
    const keys = renderKitFragment(
      spec({ kit: 'keys', keys: ['Cmd', 'K'], x: 0, y: 0 }),
      {
        theme,
        side: undefined,
        geometry: {},
      }
    )
    expect(keys.html).toBe(
      '<div class="k-keys"><kbd class="k-key">Cmd</kbd><span class="k-plus">+</span><kbd class="k-key">K</kbd></div>'
    )
  })

  it('sizes the spotlight and title to the viewport', () => {
    const geometry = {
      element: { x: 100, y: 50, width: 200, height: 40 },
      viewport: { width: 1280, height: 720 },
    }
    const spot = renderKitFragment(
      spec({ kit: 'spotlight', anchor: locator, dim: 0.4 }),
      {
        theme,
        side: undefined,
        geometry,
      }
    )
    expect(spot.css).toContain('width:1280px;height:720px')
    expect(spot.css).toContain('left:92px;top:42px;width:216px;height:56px')
    expect(spot.css).toContain('rgba(0,0,0,0.4)')
    const title = renderKitFragment(
      spec({ kit: 'title', title: 'Invite your team', subtitle: 'Settings' }),
      { theme: { ...theme, scheme: 'dark' }, side: undefined, geometry }
    )
    expect(title.html).toContain('<div class="k-title">Invite your team</div>')
    expect(title.html).toContain('<div class="k-subtitle">Settings</div>')
    expect(title.css).toContain('width:1280px;height:720px')
    expect(title.css).toContain('rgba(0, 0, 0, 0.35)')
    expect(() =>
      renderKitFragment(spec({ kit: 'title', title: 'x' }), {
        theme,
        side: undefined,
        geometry: {},
      })
    ).toThrow(/viewport/)
  })
})

describe('buildKitDocument', () => {
  it('wraps the fragment in the shared host document', () => {
    const html = buildKitDocument(
      spec({ kit: 'badge', text: 'Beta', x: 10, y: 10 }),
      {
        theme,
        side: undefined,
        geometry: {},
      }
    )
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('id="screenci-overlay-root"')
    expect(html).toContain('<div class="k-badge">Beta</div>')
    expect(html).toContain('.k-badge{')
  })
})
