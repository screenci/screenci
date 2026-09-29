import type { Locator } from '@playwright/test'
import type { OverlayAlign, OverlaySide } from '../anchorPlacement.js'
import type { KitTheme } from './theme.js'

/**
 * Options every kit primitive accepts besides its own props: timing and
 * fades (as for any overlay), stacking, and a theme override for this one
 * overlay (project-wide overrides go into a shared factory).
 */
export type KitCommon = {
  /** Length in ms for a blocking call; `.for(...)` or start()/end() otherwise. */
  duration?: number
  /** Fade lengths in ms. Default 180 each. */
  fadeIn?: number
  fadeOut?: number
  /** Keep the overlay fixed in screen space during zoom. */
  pinToScreen?: boolean
  /** Draw above the mouse cursor. */
  overMouse?: boolean
  /** Override extracted theme tokens for this overlay. */
  theme?: Partial<KitTheme>
}

/** Placement beside a live element, shared by the anchored primitives. */
export type KitAnchored = {
  anchor: Locator
  side?: Exclude<OverlaySide, 'over'>
  align?: OverlayAlign
  gap?: number
  x?: never
  y?: never
  relativeTo?: never
}

/** Placement at a fixed point (top-left, CSS px of the recording viewport). */
export type KitPoint = {
  x: number
  y: number
  relativeTo?: 'screen' | 'recording'
  anchor?: never
  side?: never
  align?: never
  gap?: never
}

/** A 2 to 4 px ring in the accent colour around an element. */
export type KitRingInput = {
  kit: 'ring'
  anchor: Locator
  /** Space between the element and the ring. Default 6. */
  margin?: number
} & KitCommon

/** Dims the recording except a rounded hole around the element. */
export type KitSpotlightInput = {
  kit: 'spotlight'
  anchor: Locator
  /** Space between the element and the hole. Default 8. */
  margin?: number
  /** Backdrop opacity, 0 to 1. Default 0.55. */
  dim?: number
} & KitCommon

/** A short text bubble with a pointer towards the element. */
export type KitCalloutInput = {
  kit: 'callout'
  text: string
  /** Wrap width in px. Default 360. */
  maxWidth?: number
} & KitAnchored &
  KitCommon

/** A small pill of text, beside an element or at a point. */
export type KitBadgeInput = {
  kit: 'badge'
  text: string
  /** `accent` (default) fills with the accent colour; `neutral` uses the surface. */
  tone?: 'accent' | 'neutral'
} & (KitAnchored | KitPoint) &
  KitCommon

/** A numbered circle beside an element. */
export type KitStepInput = {
  kit: 'step'
  number: number
} & KitAnchored &
  KitCommon

/** A full-recording title card with an optional subtitle. */
export type KitTitleInput = {
  kit: 'title'
  title: string
  subtitle?: string
  /** Centered (default) or aligned to the start edge. */
  align?: 'center' | 'start'
} & KitCommon

/** Keycaps for a shortcut, beside an element or at a point. */
export type KitKeysInput = {
  kit: 'keys'
  keys: readonly string[]
} & (KitAnchored | KitPoint) &
  KitCommon

export type KitOverlayInput =
  | KitRingInput
  | KitSpotlightInput
  | KitCalloutInput
  | KitBadgeInput
  | KitStepInput
  | KitTitleInput
  | KitKeysInput

export type KitName = KitOverlayInput['kit']
