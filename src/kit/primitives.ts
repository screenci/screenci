import type { OverlaySide } from '../anchorPlacement.js'
import { escapeHtml } from './escape.js'
import type { KitTheme } from './theme.js'
import { KIT } from './tokens.js'
import type { KitSpec } from './validate.js'

/**
 * Each primitive is a pure function from its validated spec, the theme and
 * the side it lands on to a markup fragment plus its CSS. Plain strings, not
 * a framework: the kit must render in every project (React, Vue, Svelte or
 * none), and strings make the output snapshot testable without a browser.
 */
export type KitFragment = { html: string; css: string }

/** Geometry a primitive may need beyond its own props (spotlight, title). */
export type KitGeometry = {
  element?: { x: number; y: number; width: number; height: number }
  viewport?: { width: number; height: number }
}

const font = (theme: KitTheme): string => `font-family:${theme.fontFamily};`

export function ring(theme: KitTheme): KitFragment {
  const radius = Math.max(theme.radius, 6)
  return {
    html: '<div class="k-ring"></div>',
    css:
      `.k-ring{width:100%;height:100%;box-sizing:border-box;` +
      `border:${KIT.ring.width}px solid ${theme.accent};border-radius:${radius}px;` +
      `box-shadow:0 0 0 ${KIT.ring.glow}px ${theme.accentSoft},0 8px 24px rgba(0,0,0,0.18)}`,
  }
}

export function spotlight(
  spec: Extract<KitSpec, { kit: 'spotlight' }>,
  theme: KitTheme,
  geometry: KitGeometry
): KitFragment {
  const { element, viewport } = geometry
  if (element === undefined || viewport === undefined) {
    throw new Error(
      '[screenci] spotlight needs the element box and the viewport.'
    )
  }
  // The hole is the element plus margin; a huge box-shadow around it dims the
  // rest of the recording. The document is sized to the viewport so the fill
  // placement lands 1:1 on the recording.
  const m = spec.margin
  const hole = {
    x: element.x - m,
    y: element.y - m,
    width: element.width + 2 * m,
    height: element.height + 2 * m,
  }
  return {
    html: '<div class="k-spot"><div class="k-hole"></div></div>',
    css:
      `.k-spot{position:relative;width:${viewport.width}px;height:${viewport.height}px;overflow:hidden}` +
      `.k-hole{position:absolute;left:${hole.x}px;top:${hole.y}px;width:${hole.width}px;height:${hole.height}px;` +
      `border-radius:${theme.radius}px;box-shadow:0 0 0 ${Math.max(viewport.width, viewport.height) * 2}px rgba(0,0,0,${spec.dim})}`,
  }
}

/** The pointer sits on the edge facing the element: below the bubble for `top`, and so on. */
function pointerCss(
  side: OverlaySide | undefined,
  size: number,
  color: string
): string {
  const half = size / 2
  const base =
    `.k-pointer{position:absolute;width:${size}px;height:${size}px;background:${color};` +
    `transform:rotate(45deg);border-radius:2px}`
  switch (side) {
    case 'top':
      return base + `.k-pointer{left:calc(50% - ${half}px);bottom:-${half}px}`
    case 'bottom':
      return base + `.k-pointer{left:calc(50% - ${half}px);top:-${half}px}`
    case 'left':
      return base + `.k-pointer{top:calc(50% - ${half}px);right:-${half}px}`
    case 'right':
      return base + `.k-pointer{top:calc(50% - ${half}px);left:-${half}px}`
    case 'over':
    case undefined:
      return `.k-pointer{display:none}`
    default:
      side satisfies never
      return ''
  }
}

export function callout(
  spec: Extract<KitSpec, { kit: 'callout' }>,
  theme: KitTheme,
  side: OverlaySide | undefined
): KitFragment {
  const c = KIT.callout
  return {
    html: `<div class="k-callout"><div class="k-pointer"></div><div class="k-text">${escapeHtml(spec.text)}</div></div>`,
    css:
      `.k-callout{position:relative;display:inline-block;max-width:${spec.maxWidth}px;box-sizing:border-box;` +
      `padding:${c.paddingY}px ${c.paddingX}px;border-radius:${theme.radius}px;background:${theme.surface};` +
      `color:${theme.onSurface};${font(theme)}font-size:${c.fontSize}px;line-height:${c.lineHeight};` +
      `font-weight:${c.fontWeight};box-shadow:${c.shadow}}` +
      `.k-text{position:relative;white-space:pre-wrap;overflow-wrap:break-word}` +
      pointerCss(side, c.pointer, theme.surface),
  }
}

export function badge(
  spec: Extract<KitSpec, { kit: 'badge' }>,
  theme: KitTheme
): KitFragment {
  const b = KIT.badge
  const bg = spec.tone === 'accent' ? theme.accent : theme.surface
  const fg = spec.tone === 'accent' ? theme.accentForeground : theme.onSurface
  return {
    html: `<div class="k-badge">${escapeHtml(spec.text)}</div>`,
    css:
      `.k-badge{display:inline-block;padding:${b.paddingY}px ${b.paddingX}px;border-radius:999px;` +
      `background:${bg};color:${fg};${font(theme)}font-size:${b.fontSize}px;font-weight:${b.fontWeight};` +
      `line-height:1.4;letter-spacing:${b.letterSpacing};text-transform:uppercase;white-space:nowrap;` +
      `box-shadow:0 0 0 1px rgba(0,0,0,0.08),0 4px 12px rgba(0,0,0,0.18)}`,
  }
}

export function step(
  spec: Extract<KitSpec, { kit: 'step' }>,
  theme: KitTheme
): KitFragment {
  const s = KIT.step
  return {
    html: `<div class="k-step">${spec.number}</div>`,
    css:
      `.k-step{display:flex;align-items:center;justify-content:center;width:${s.size}px;height:${s.size}px;` +
      `border-radius:50%;background:${theme.accent};color:${theme.accentForeground};${font(theme)}` +
      `font-size:${s.fontSize}px;font-weight:${s.fontWeight};line-height:1;` +
      `box-shadow:0 0 0 ${KIT.ring.glow}px ${theme.accentSoft},0 6px 16px rgba(0,0,0,0.22)}`,
  }
}

export function title(
  spec: Extract<KitSpec, { kit: 'title' }>,
  theme: KitTheme,
  geometry: KitGeometry
): KitFragment {
  const { viewport } = geometry
  if (viewport === undefined) {
    throw new Error('[screenci] title needs the viewport size.')
  }
  const t = KIT.title
  const scrim = theme.scheme === 'dark' ? t.darkScrim : t.lightScrim
  const textColor = theme.scheme === 'dark' ? '#f8fafc' : '#0f172a'
  const inset = Math.round(Math.min(viewport.width, viewport.height) * t.inset)
  const alignItems = spec.align === 'center' ? 'center' : 'flex-start'
  const textAlign = spec.align === 'center' ? 'center' : 'left'
  const subtitle =
    spec.subtitle === undefined
      ? ''
      : `<div class="k-subtitle">${escapeHtml(spec.subtitle)}</div>`
  return {
    html: `<div class="k-title-card"><div class="k-title">${escapeHtml(spec.title)}</div>${subtitle}</div>`,
    css:
      `.k-title-card{display:flex;flex-direction:column;justify-content:center;align-items:${alignItems};` +
      `box-sizing:border-box;width:${viewport.width}px;height:${viewport.height}px;padding:${inset}px;` +
      `background:${scrim};color:${textColor};${font(theme)}text-align:${textAlign}}` +
      `.k-title{font-size:${t.titleSize}px;font-weight:700;letter-spacing:-0.01em;line-height:1.1}` +
      `.k-subtitle{margin-top:${Math.round(t.subtitleSize * 0.6)}px;font-size:${t.subtitleSize}px;font-weight:500;opacity:0.8;line-height:1.3}`,
  }
}

export function keys(
  spec: Extract<KitSpec, { kit: 'keys' }>,
  theme: KitTheme
): KitFragment {
  const k = KIT.keys
  const caps = spec.keys
    .map((key) => `<kbd class="k-key">${escapeHtml(key)}</kbd>`)
    .join('<span class="k-plus">+</span>')
  return {
    html: `<div class="k-keys">${caps}</div>`,
    css:
      `.k-keys{display:inline-flex;align-items:center;gap:6px;${font(theme)}}` +
      `.k-key{display:inline-block;padding:${k.paddingY}px ${k.paddingX}px;border-radius:${k.radius}px;` +
      `background:${theme.surface};color:${theme.onSurface};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;` +
      `font-size:${k.fontSize}px;font-weight:${k.fontWeight};line-height:1.3;` +
      `box-shadow:0 2px 0 rgba(0,0,0,0.25),0 0 0 1px rgba(0,0,0,0.08)}` +
      `.k-plus{color:${theme.onSurface};opacity:0.6;font-size:${k.fontSize}px}`,
  }
}
