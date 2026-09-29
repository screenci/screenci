import type { Page } from '@playwright/test'
import { logger } from '../logger.js'
import {
  contrast,
  isOpaque,
  luminance,
  parseColor,
  toCss,
  type Rgba,
} from './color.js'

/**
 * The visual tokens every kit primitive is drawn with. By default they are
 * extracted from the recorded app (its primary button, root CSS variables,
 * body font and colour scheme) so overlays look like the product; a project
 * or a single overlay can override any of them.
 */
export type KitTheme = {
  /** The app's primary / accent colour: rings, step markers, accent badges. */
  accent: string
  /** Text and icon colour on `accent`. */
  accentForeground: string
  /** `accent` at low alpha, for glows and soft fills. */
  accentSoft: string
  /** Background of callouts and neutral badges. */
  surface: string
  /** Text colour on `surface`. */
  onSurface: string
  /** Control corner radius in CSS px. */
  radius: number
  /** Font family for every kit text. `inherit` keeps the overlay host stack. */
  fontFamily: string
  /** Whether the recorded app is light or dark, for scrims and shadows. */
  scheme: 'light' | 'dark'
}

/** Curated defaults, used when nothing usable can be read from the app. */
export const FALLBACK_THEME: KitTheme = {
  accent: 'rgb(37, 99, 235)',
  accentForeground: 'rgb(255, 255, 255)',
  accentSoft: 'rgba(37, 99, 235, 0.18)',
  surface: 'rgb(15, 23, 42)',
  onSurface: 'rgb(248, 250, 252)',
  radius: 10,
  fontFamily: 'inherit',
  scheme: 'light',
}

const LIGHT_SURFACE: Rgba = { r: 248, g: 250, b: 252, a: 1 }
const DARK_SURFACE: Rgba = { r: 15, g: 23, b: 42, a: 1 }
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }

/** Root CSS custom properties the extractor reads (shadcn / Tailwind style). */
export const THEME_CSS_VARS = [
  '--primary',
  '--primary-foreground',
  '--accent',
  '--ring',
  '--radius',
  '--background',
  '--foreground',
] as const
export type ThemeCssVar = (typeof THEME_CSS_VARS)[number]

/**
 * Raw values read from the page, as strings; every field is optional since a
 * page may expose none of them. Colours are `rgb()`/`rgba()` when they come
 * from the browser extractor (which normalizes any CSS colour), but the pure
 * derivation also accepts hex, hsl and bare HSL triplets for tests and
 * hand-written overrides.
 */
export type ExtractedStyles = {
  /** Computed background / text colour / border radius of the primary button. */
  primaryBg?: string
  primaryFg?: string
  primaryRadius?: string
  cssVars?: Partial<Record<ThemeCssVar, string>>
  bodyFont?: string
  bodyBg?: string
  bodyColor?: string
  /** The `color-scheme` computed on the root, e.g. `dark`. */
  colorScheme?: string
}

/** Reads the raw styles from a page. Injectable so unit tests need no browser. */
export type StyleEvaluator = () => Promise<ExtractedStyles>

const MIN_ACCENT_CONTRAST = 3
const MIN_TEXT_CONTRAST = 4.5

/** Has visible colour (not a grey): channel spread above a small threshold. */
function isChromatic(color: Rgba): boolean {
  const max = Math.max(color.r, color.g, color.b)
  const min = Math.min(color.r, color.g, color.b)
  return max - min >= 40
}

function parseOpaque(value: string | undefined): Rgba | null {
  const color = parseColor(value)
  return color !== null && isOpaque(color) ? color : null
}

function parsePx(value: string | undefined): number | null {
  if (value === undefined) return null
  const m = /^\s*(-?[\d.]+)\s*(px|rem|em)?\s*$/.exec(value)
  if (m === null) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return m[2] === 'rem' || m[2] === 'em' ? n * 16 : n
}

const SYSTEM_FAMILIES = [
  'system-ui',
  '-apple-system',
  'ui-sans-serif',
  'segoe ui',
  'roboto',
  'helvetica',
  'helvetica neue',
  'arial',
  'inter',
  'noto sans',
]

/**
 * Keeps the app's font stack only when it can fall through to a system
 * family: the overlay page loads no web fonts, so a stack with only a hosted
 * family would fall back to the browser's generic serif/sans-serif instead of
 * the host's tuned stack.
 */
function fontFamilyFrom(bodyFont: string | undefined): string {
  if (bodyFont === undefined) return 'inherit'
  const families = bodyFont
    .split(',')
    .map((f) =>
      f
        .trim()
        .replace(/^["']|["']$/g, '')
        .toLowerCase()
    )
    .filter((f) => f !== '')
  if (families.length === 0) return 'inherit'
  return families.some((f) => SYSTEM_FAMILIES.includes(f))
    ? bodyFont.trim()
    : 'inherit'
}

/** Pure: turns raw page styles into a complete, contrast-checked theme. */
export function deriveTheme(
  raw: ExtractedStyles,
  fallback: KitTheme = FALLBACK_THEME
): KitTheme {
  const vars = raw.cssVars ?? {}
  const pageBg = parseOpaque(raw.bodyBg) ?? parseOpaque(vars['--background'])
  const bodyBg = pageBg ?? WHITE
  const scheme: KitTheme['scheme'] =
    pageBg === null
      ? raw.colorScheme?.includes('dark')
        ? 'dark'
        : fallback.scheme
      : luminance(pageBg) < 0.4
        ? 'dark'
        : 'light'

  // Callouts sit on a surface that contrasts with the page: the app's own
  // foreground/background pair inverted when it reads well, else a curated
  // pair for the scheme.
  const appFg = parseOpaque(vars['--foreground']) ?? parseOpaque(raw.bodyColor)
  const appBg = parseOpaque(vars['--background']) ?? parseOpaque(raw.bodyBg)
  let surface: Rgba
  let onSurface: Rgba
  if (
    appFg !== null &&
    appBg !== null &&
    contrast(appFg, appBg) >= MIN_TEXT_CONTRAST
  ) {
    surface = appFg
    onSurface = appBg
  } else if (scheme === 'dark') {
    surface = LIGHT_SURFACE
    onSurface = DARK_SURFACE
  } else {
    surface = DARK_SURFACE
    onSurface = LIGHT_SURFACE
  }

  // The accent must read against both the page and the callout surface.
  const fallbackAccent = parseOpaque(fallback.accent) ?? {
    r: 37,
    g: 99,
    b: 235,
    a: 1,
  }
  // The first candidate that reads on the page wins, but a chromatic one is
  // preferred over a grey: a shadcn dark theme's near-white --primary would
  // otherwise turn every ring monochrome while --accent or --ring is coloured.
  const candidates = [
    vars['--primary'],
    raw.primaryBg,
    vars['--accent'],
    vars['--ring'],
  ]
  let accent: Rgba | null = null
  let greyAccent: Rgba | null = null
  for (const candidate of candidates) {
    const color = parseOpaque(candidate)
    if (color === null) continue
    if (contrast(color, bodyBg) < MIN_ACCENT_CONTRAST) continue
    if (isChromatic(color)) {
      accent = color
      break
    }
    greyAccent ??= color
  }
  accent ??= greyAccent ?? fallbackAccent

  const declaredFg =
    parseOpaque(vars['--primary-foreground']) ?? parseOpaque(raw.primaryFg)
  const accentForeground =
    declaredFg !== null && contrast(declaredFg, accent) >= MIN_ACCENT_CONTRAST
      ? declaredFg
      : contrast(WHITE, accent) >= contrast(DARK_SURFACE, accent)
        ? WHITE
        : DARK_SURFACE

  const radiusPx = parsePx(raw.primaryRadius) ?? parsePx(vars['--radius'])
  const radius =
    radiusPx === null
      ? fallback.radius
      : Math.min(16, Math.max(4, Math.round(radiusPx)))

  return {
    accent: toCss(accent),
    accentForeground: toCss(accentForeground),
    accentSoft: toCss(accent, 0.18),
    surface: toCss(surface),
    onSurface: toCss(onSurface),
    radius,
    fontFamily: fontFamilyFrom(raw.bodyFont),
    scheme,
  }
}

/**
 * Applies overrides on top of a theme. Derived tokens follow their source
 * (an overridden `accent` refreshes `accentSoft` unless that is overridden
 * too). A pair that fails the contrast check is kept, with a warning, since
 * the author asked for it.
 */
export function mergeTheme(
  base: KitTheme,
  override?: Partial<KitTheme>
): KitTheme {
  if (override === undefined) return base
  const merged: KitTheme = { ...base, ...stripUndefined(override) }
  if (override.accent !== undefined && override.accentSoft === undefined) {
    const accent = parseColor(override.accent)
    if (accent !== null) merged.accentSoft = toCss(accent, 0.18)
  }
  const accent = parseOpaque(merged.accent)
  const accentFg = parseOpaque(merged.accentForeground)
  if (
    accent !== null &&
    accentFg !== null &&
    contrast(accent, accentFg) < MIN_ACCENT_CONTRAST
  ) {
    logger.warn(
      `[screenci] Overlay theme: accentForeground ${merged.accentForeground} has low contrast on accent ${merged.accent}.`
    )
  }
  const surface = parseOpaque(merged.surface)
  const onSurface = parseOpaque(merged.onSurface)
  if (
    surface !== null &&
    onSurface !== null &&
    contrast(surface, onSurface) < MIN_TEXT_CONTRAST
  ) {
    logger.warn(
      `[screenci] Overlay theme: onSurface ${merged.onSurface} has low contrast on surface ${merged.surface}.`
    )
  }
  return merged
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

/**
 * Whether an extraction found anything to build a theme from. An empty read
 * (a page still loading, a blank document, a failed evaluate) is not cached,
 * so a later overlay on the same page reads again.
 */
export function hasUsableStyles(raw: ExtractedStyles): boolean {
  const vars = raw.cssVars ?? {}
  return (
    raw.primaryBg !== undefined ||
    raw.bodyBg !== undefined ||
    Object.values(vars).some((v) => v !== undefined && v !== '')
  )
}

/** Reads the page styles through the evaluator and derives the theme. */
export async function extractAppTheme(
  evaluate: StyleEvaluator
): Promise<{ theme: KitTheme; usable: boolean }> {
  let raw: ExtractedStyles
  try {
    raw = await evaluate()
  } catch (error) {
    logger.warn(
      `[screenci] Overlay theme: could not read the app's styles, using the default theme. ${String(error)}`
    )
    raw = {}
  }
  return { theme: deriveTheme(raw), usable: hasUsableStyles(raw) }
}

/**
 * The browser side of the extraction. Runs inside the recorded page and
 * returns strings only. Colours are normalized to `rgb()`/`rgba()` through a
 * canvas so oklch, color(), named and variable-based values all come back in
 * one form; a bare HSL triplet variable is wrapped in `hsl()` first.
 */
function readPageStyles(varNames: readonly string[]): ExtractedStyles {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const normalize = (value: string | null | undefined): string | undefined => {
    if (ctx === null || value === undefined || value === null) return undefined
    const raw = value.trim()
    if (raw === '') return undefined
    const attempts = [raw, `hsl(${raw})`]
    for (const attempt of attempts) {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#010203'
      ctx.fillStyle = attempt
      // An unparseable colour leaves the previous fillStyle in place.
      if (ctx.fillStyle === '#010203' && attempt !== '#010203') continue
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      const alpha = (a ?? 255) / 255
      return alpha >= 1
        ? `rgb(${r}, ${g}, ${b})`
        : `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`
    }
    return undefined
  }
  const rootStyle = getComputedStyle(document.documentElement)
  const bodyStyle = getComputedStyle(document.body)
  const cssVars: Record<string, string> = {}
  for (const name of varNames) {
    const value = rootStyle.getPropertyValue(name).trim()
    if (value === '') continue
    if (name === '--radius') {
      cssVars[name] = value
      continue
    }
    const color = normalize(value)
    if (color !== undefined) cssVars[name] = color
  }

  // The primary button: the most contrasting opaque button against the page,
  // with a preference for submit buttons.
  // The page background: the body's, else the root's; a transparent one is
  // no information (apps often paint the background on a wrapper).
  const opaque = (css: string | undefined) =>
    css !== undefined && !css.startsWith('rgba') ? css : undefined
  const bodyBg =
    opaque(normalize(bodyStyle.backgroundColor)) ??
    opaque(normalize(rootStyle.backgroundColor))
  const lum = (css: string | undefined): number => {
    const m = css === undefined ? null : /rgba?\((\d+), (\d+), (\d+)/.exec(css)
    if (m === null) return 1
    const ch = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return (
      0.2126 * ch(Number(m[1])) +
      0.7152 * ch(Number(m[2])) +
      0.0722 * ch(Number(m[3]))
    )
  }
  const pageLum = lum(bodyBg)
  const ratio = (l: number) =>
    (Math.max(l, pageLum) + 0.05) / (Math.min(l, pageLum) + 0.05)
  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button, [role="button"], input[type="submit"], a.btn, a.button'
    )
  ).slice(0, 60)
  let best: { score: number; el: HTMLElement; bg: string } | null = null
  for (const el of buttons) {
    const rect = el.getBoundingClientRect()
    if (rect.width < 24 || rect.height < 16) continue
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') continue
    const bg = normalize(style.backgroundColor)
    if (bg === undefined || bg.startsWith('rgba')) continue
    let score = ratio(lum(bg))
    if (score < 1.5) continue
    const type = el.getAttribute('type')
    const cls = el.className.toString().toLowerCase()
    if (type === 'submit') score += 2
    if (/primary|accent|cta/.test(cls)) score += 2
    if (best === null || score > best.score) best = { score, el, bg }
  }
  const result: ExtractedStyles = {
    cssVars,
    bodyFont: bodyStyle.fontFamily,
    colorScheme: rootStyle.colorScheme,
  }
  if (bodyBg !== undefined) result.bodyBg = bodyBg
  const bodyColor = normalize(bodyStyle.color)
  if (bodyColor !== undefined) result.bodyColor = bodyColor
  if (best !== null) {
    result.primaryBg = best.bg
    const primaryFg = normalize(getComputedStyle(best.el).color)
    if (primaryFg !== undefined) result.primaryFg = primaryFg
    result.primaryRadius = getComputedStyle(best.el).borderTopLeftRadius
  }
  return result
}

/** An evaluator that reads the live page through Playwright. */
export function pageStyleEvaluator(page: Page): StyleEvaluator {
  return () => page.evaluate(readPageStyles, THEME_CSS_VARS)
}

let evaluatorFactory: (page: Page) => StyleEvaluator = pageStyleEvaluator
const cacheRef = { current: new WeakMap<Page, Promise<KitTheme>>() }

/** Test hook: replace how a page's styles are read (null restores the default). */
export function setKitThemeEvaluator(
  factory: ((page: Page) => StyleEvaluator) | null
): void {
  evaluatorFactory = factory ?? pageStyleEvaluator
  resetKitThemeCache()
}

export function resetKitThemeCache(): void {
  // A WeakMap cannot be cleared; swap the reference.
  cacheRef.current = new WeakMap()
}

/**
 * The extracted theme for a page, read once per page and then cached. A read
 * that found nothing usable is not cached, so the next overlay tries again
 * (the first overlay may run before the app has painted).
 */
export function themeForPage(page: Page): Promise<KitTheme> {
  const cache = cacheRef.current
  let pending = cache.get(page)
  if (pending === undefined) {
    pending = extractAppTheme(evaluatorFactory(page)).then(
      ({ theme, usable }) => {
        if (!usable) cache.delete(page)
        return theme
      }
    )
    cache.set(page, pending)
  }
  return pending
}
