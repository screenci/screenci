import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Page } from '@playwright/test'
import {
  deriveTheme,
  extractAppTheme,
  FALLBACK_THEME,
  mergeTheme,
  resetKitThemeCache,
  setKitThemeEvaluator,
  themeForPage,
} from './theme.js'
import { contrast, parseColor } from './color.js'

describe('deriveTheme', () => {
  it('returns the curated fallback when nothing is readable', () => {
    expect(deriveTheme({})).toEqual(FALLBACK_THEME)
  })

  it('reads a shadcn light theme from bare HSL variables', () => {
    const theme = deriveTheme({
      cssVars: {
        '--primary': '222.2 47.4% 11.2%',
        '--primary-foreground': '210 40% 98%',
        '--background': '0 0% 100%',
        '--foreground': '222.2 84% 4.9%',
        '--radius': '0.5rem',
      },
      bodyBg: 'rgb(255, 255, 255)',
      bodyFont: 'Inter, ui-sans-serif, system-ui, sans-serif',
    })
    expect(theme.scheme).toBe('light')
    expect(theme.accent).toBe('rgb(15, 23, 42)')
    expect(theme.accentForeground).toBe('rgb(248, 250, 252)')
    expect(theme.accentSoft).toBe('rgba(15, 23, 42, 0.18)')
    // Inverted app pair: dark foreground becomes the callout surface.
    expect(theme.surface).toBe('rgb(2, 8, 23)')
    expect(theme.onSurface).toBe('rgb(255, 255, 255)')
    expect(theme.radius).toBe(8)
    expect(theme.fontFamily).toBe('Inter, ui-sans-serif, system-ui, sans-serif')
  })

  it('detects a dark app and picks a light callout surface', () => {
    const theme = deriveTheme({
      bodyBg: '#0b0f19',
      primaryBg: '#7c3aed',
      primaryFg: '#ffffff',
      primaryRadius: '6px',
    })
    expect(theme.scheme).toBe('dark')
    expect(theme.accent).toBe('rgb(124, 58, 237)')
    expect(theme.accentForeground).toBe('rgb(255, 255, 255)')
    expect(theme.surface).toBe('rgb(248, 250, 252)')
    expect(theme.onSurface).toBe('rgb(15, 23, 42)')
    expect(theme.radius).toBe(6)
  })

  it('skips an accent that does not contrast with the page', () => {
    const theme = deriveTheme({
      bodyBg: '#ffffff',
      cssVars: { '--primary': '#f1f5f9', '--accent': '#0284c7' },
    })
    expect(theme.accent).toBe('rgb(2, 132, 199)')
    const accent = parseColor(theme.accent)!
    expect(contrast(accent, parseColor('#ffffff')!)).toBeGreaterThanOrEqual(3)
  })

  it('falls back to the default accent when no candidate reads on the page', () => {
    const theme = deriveTheme({ bodyBg: '#ffffff', primaryBg: '#fafafa' })
    expect(theme.accent).toBe(FALLBACK_THEME.accent)
  })

  it('chooses the accent foreground by contrast when none is declared', () => {
    expect(
      deriveTheme({ bodyBg: '#111827', primaryBg: '#facc15' }).accentForeground
    ).toBe('rgb(15, 23, 42)')
    expect(deriveTheme({ primaryBg: '#1d4ed8' }).accentForeground).toBe(
      'rgb(255, 255, 255)'
    )
  })

  it('clamps the radius and ignores values it cannot parse', () => {
    expect(deriveTheme({ primaryRadius: '9999px' }).radius).toBe(16)
    expect(deriveTheme({ primaryRadius: '0px' }).radius).toBe(4)
    expect(
      deriveTheme({ cssVars: { '--radius': 'calc(1rem - 2px)' } }).radius
    ).toBe(FALLBACK_THEME.radius)
  })

  it('keeps the font stack only when it can fall through to a system family', () => {
    expect(deriveTheme({ bodyFont: '"Fancy Web", serif' }).fontFamily).toBe(
      'inherit'
    )
    expect(
      deriveTheme({ bodyFont: '"Fancy Web", system-ui, sans-serif' }).fontFamily
    ).toBe('"Fancy Web", system-ui, sans-serif')
  })

  it('uses color-scheme when no background is readable', () => {
    expect(deriveTheme({ colorScheme: 'dark' }).scheme).toBe('dark')
    // A transparent body background is no information either.
    expect(
      deriveTheme({ bodyBg: 'rgba(0, 0, 0, 0)', colorScheme: 'dark' }).scheme
    ).toBe('dark')
  })

  it('prefers a chromatic accent over a near-white shadcn dark primary', () => {
    const theme = deriveTheme({
      bodyBg: '#020817',
      cssVars: { '--primary': '210 40% 98%', '--accent': '#7c3aed' },
    })
    expect(theme.accent).toBe('rgb(124, 58, 237)')
    // With only greys on offer, the grey primary still wins over the fallback.
    expect(
      deriveTheme({
        bodyBg: '#020817',
        cssVars: { '--primary': '210 40% 98%' },
      }).accent
    ).toBe('rgb(248, 250, 252)')
  })
})

describe('mergeTheme', () => {
  afterEach(() => vi.restoreAllMocks())

  it('overrides tokens and refreshes the derived soft accent', () => {
    const merged = mergeTheme(FALLBACK_THEME, { accent: '#dc2626', radius: 4 })
    expect(merged.accent).toBe('#dc2626')
    expect(merged.accentSoft).toBe('rgba(220, 38, 38, 0.18)')
    expect(merged.radius).toBe(4)
    expect(merged.surface).toBe(FALLBACK_THEME.surface)
  })

  it('keeps an explicit accentSoft override', () => {
    const merged = mergeTheme(FALLBACK_THEME, {
      accent: '#dc2626',
      accentSoft: 'pink',
    })
    expect(merged.accentSoft).toBe('pink')
  })

  it('warns (but keeps) a low-contrast pair', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const merged = mergeTheme(FALLBACK_THEME, {
      surface: '#ffffff',
      onSurface: '#fafafa',
    })
    expect(merged.onSurface).toBe('#fafafa')
    expect(warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('low contrast on surface')
    )
  })
})

describe('extractAppTheme and the page cache', () => {
  afterEach(() => {
    setKitThemeEvaluator(null)
    vi.restoreAllMocks()
  })

  it('derives from the evaluator and falls back when it throws', async () => {
    const { theme, usable } = await extractAppTheme(async () => ({
      primaryBg: '#16a34a',
    }))
    expect(theme.accent).toBe('rgb(22, 163, 74)')
    expect(usable).toBe(true)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failed = await extractAppTheme(async () => {
      throw new Error('detached')
    })
    expect(failed).toEqual({ theme: FALLBACK_THEME, usable: false })
  })

  it('does not cache an empty read, so a later overlay reads the loaded page', async () => {
    let loaded = false
    const evaluate = vi.fn(async () => (loaded ? { primaryBg: '#16a34a' } : {}))
    setKitThemeEvaluator(() => evaluate)
    const page = {} as Page
    expect((await themeForPage(page)).accent).toBe(FALLBACK_THEME.accent)
    loaded = true
    expect((await themeForPage(page)).accent).toBe('rgb(22, 163, 74)')
    await themeForPage(page)
    expect(evaluate).toHaveBeenCalledTimes(2)
  })

  it('reads each page once', async () => {
    const evaluate = vi.fn(async () => ({ primaryBg: '#16a34a' }))
    setKitThemeEvaluator(() => evaluate)
    const page = {} as Page
    const other = {} as Page
    await themeForPage(page)
    await themeForPage(page)
    await themeForPage(other)
    expect(evaluate).toHaveBeenCalledTimes(2)
    resetKitThemeCache()
    await themeForPage(page)
    expect(evaluate).toHaveBeenCalledTimes(3)
  })
})
