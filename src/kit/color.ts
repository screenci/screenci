/**
 * Small colour toolkit for the overlay kit: parse the colour strings a page
 * (or a theme override) can hand us, and measure contrast the WCAG way so a
 * theme never pairs an accent with a background it disappears into. Pure.
 */

export type Rgba = { r: number; g: number; b: number; a: number }

const NAMED: Record<string, Rgba> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  let rgb: [number, number, number]
  if (hue < 60) rgb = [c, x, 0]
  else if (hue < 120) rgb = [x, c, 0]
  else if (hue < 180) rgb = [0, c, x]
  else if (hue < 240) rgb = [0, x, c]
  else if (hue < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return [
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  ]
}

function parseNumberList(body: string): number[] | null {
  const parts = body
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter((part) => part !== '')
  const values: number[] = []
  for (const part of parts) {
    const percent = part.endsWith('%')
    const n = Number(percent ? part.slice(0, -1) : part)
    if (!Number.isFinite(n)) return null
    values.push(percent ? n / 100 : n)
  }
  return values
}

/**
 * Parses hex (`#rgb`, `#rrggbb`, `#rrggbbaa`), `rgb()`/`rgba()`,
 * `hsl()`/`hsla()`, a bare shadcn HSL triplet (`222.2 47.4% 11.2%`), and a
 * few named colours. Anything else (oklch, color(), var()) returns null: the
 * browser-side extractor normalizes those to `rgb()` before they get here.
 */
export function parseColor(input: string | undefined): Rgba | null {
  if (input === undefined) return null
  const value = input.trim().toLowerCase()
  if (value === '') return null
  const named = NAMED[value]
  if (named !== undefined) return { ...named }

  if (value.startsWith('#')) {
    const hex = value.slice(1)
    const expand = (s: string) =>
      s.length === 3 || s.length === 4
        ? s
            .split('')
            .map((c) => c + c)
            .join('')
        : s
    const full = expand(hex)
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(full)) return null
    const n = (at: number) => parseInt(full.slice(at, at + 2), 16)
    return {
      r: n(0),
      g: n(2),
      b: n(4),
      a: full.length === 8 ? n(6) / 255 : 1,
    }
  }

  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(value)
  if (fn !== null) {
    const values = parseNumberList(fn[2]!)
    if (values === null || values.length < 3) return null
    const a = values.length >= 4 ? clamp(values[3]!, 0, 1) : 1
    if (fn[1]!.startsWith('rgb')) {
      // Percent channels came back as 0..1 fractions.
      const ch = (v: number) =>
        Math.round(clamp(fn[2]!.includes('%') && v <= 1 ? v * 255 : v, 0, 255))
      return { r: ch(values[0]!), g: ch(values[1]!), b: ch(values[2]!), a }
    }
    const [r, g, b] = hslToRgb(values[0]!, values[1]!, values[2]!)
    return { r, g, b, a }
  }

  // Bare `h s% l%` (shadcn v3 CSS variables), optionally `/ alpha`.
  const triplet = /^-?[\d.]+\s+[\d.]+%\s+[\d.]+%(\s*\/\s*[\d.]+%?)?$/.exec(
    value
  )
  if (triplet !== null) {
    const values = parseNumberList(value)
    if (values === null || values.length < 3) return null
    const [r, g, b] = hslToRgb(values[0]!, values[1]!, values[2]!)
    return { r, g, b, a: values.length >= 4 ? clamp(values[3]!, 0, 1) : 1 }
  }
  return null
}

export function toCss(color: Rgba, alpha = color.a): string {
  const a = clamp(alpha, 0, 1)
  return a >= 1
    ? `rgb(${color.r}, ${color.g}, ${color.b})`
    : `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(a.toFixed(3))})`
}

/** WCAG relative luminance (0 black .. 1 white) of an opaque colour. */
export function luminance(color: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel(color.r) +
    0.7152 * channel(color.g) +
    0.0722 * channel(color.b)
  )
}

/** WCAG contrast ratio (1 .. 21) between two opaque colours. */
export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [light, dark] = la >= lb ? [la, lb] : [lb, la]
  return (light + 0.05) / (dark + 0.05)
}

/** True for a colour that is effectively opaque. */
export function isOpaque(color: Rgba): boolean {
  return color.a >= 0.99
}
