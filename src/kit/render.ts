import type { OverlaySide } from '../anchorPlacement.js'
import { buildOverlayHostDocument } from '../clientOverlay.js'
import * as primitives from './primitives.js'
import type { KitGeometry } from './primitives.js'
import type { KitTheme } from './theme.js'
import type { KitSpec } from './validate.js'

export type KitRenderContext = {
  theme: KitTheme
  /** The side an anchored primitive lands on (after a flip), else undefined. */
  side: OverlaySide | undefined
  geometry: KitGeometry
}

/** The markup and css for a kit spec, before wrapping in the host document. */
export function renderKitFragment(
  spec: KitSpec,
  context: KitRenderContext
): primitives.KitFragment {
  switch (spec.kit) {
    case 'ring':
      return primitives.ring(context.theme)
    case 'spotlight':
      return primitives.spotlight(spec, context.theme, context.geometry)
    case 'callout':
      return primitives.callout(spec, context.theme, context.side)
    case 'badge':
      return primitives.badge(spec, context.theme)
    case 'step':
      return primitives.step(spec, context.theme)
    case 'title':
      return primitives.title(spec, context.theme, context.geometry)
    case 'keys':
      return primitives.keys(spec, context.theme)
    default:
      spec satisfies never
      throw new Error('[screenci] Unknown kit primitive.')
  }
}

/** The full overlay document for a kit spec (the same host every inline overlay uses). */
export function buildKitDocument(
  spec: KitSpec,
  context: KitRenderContext
): string {
  const fragment = renderKitFragment(spec, context)
  return buildOverlayHostDocument({
    rootContent: fragment.html,
    css: fragment.css,
  })
}
