import type { Locator } from '@playwright/test'
import {
  isOverlayAlign,
  isOverlaySide,
  type OverlayAlign,
  type OverlaySide,
} from '../anchorPlacement.js'
import { KIT } from './tokens.js'
import type { KitTheme } from './theme.js'
import type {
  KitBadgeInput,
  KitCalloutInput,
  KitKeysInput,
  KitOverlayInput,
  KitRingInput,
  KitSpotlightInput,
  KitStepInput,
  KitTitleInput,
} from './types.js'

/** `{ kit: '<name>' }` marks a built-in kit overlay. */
export function isKitOverlayInput(value: unknown): value is KitOverlayInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kit?: unknown }).kit === 'string'
  )
}

/** Where a kit overlay goes, with every default filled in. */
export type KitPlacement =
  | {
      kind: 'anchor'
      anchor: Locator
      side: OverlaySide
      align: OverlayAlign
      gap: number
      margin: number
      bleed: number
    }
  | {
      kind: 'point'
      x: number
      y: number
      relativeTo: 'screen' | 'recording'
      bleed: number
    }
  | { kind: 'fill' }

/** Common fields, validated. */
export type KitSpecCommon = {
  durationMs: number | undefined
  fadeInMs: number
  fadeOutMs: number
  pinToScreen: boolean
  overMouse: boolean
  theme: Partial<KitTheme> | undefined
  placement: KitPlacement
}

export type KitSpec = KitSpecCommon &
  (
    | { kit: 'ring' }
    | { kit: 'spotlight'; anchor: Locator; margin: number; dim: number }
    | { kit: 'callout'; text: string; maxWidth: number }
    | { kit: 'badge'; text: string; tone: 'accent' | 'neutral' }
    | { kit: 'step'; number: number }
    | {
        kit: 'title'
        title: string
        subtitle: string | undefined
        align: 'center' | 'start'
      }
    | { kit: 'keys'; keys: string[] }
  )

const KIT_NAMES = [
  'ring',
  'spotlight',
  'callout',
  'badge',
  'step',
  'title',
  'keys',
] as const

function fail(name: string, message: string): never {
  throw new Error(`[screenci] Overlay "${name}": ${message}`)
}

function isLocator(value: unknown): value is Locator {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { boundingBox?: unknown }).boundingBox === 'function'
  )
}

function text(name: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(name, `"${field}" must be a non-empty string.`)
  }
  return value
}

function px(
  name: string,
  field: string,
  value: unknown,
  fallback: number
): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(
      name,
      `"${field}" must be a finite number of CSS px greater than or equal to 0.`
    )
  }
  return value
}

function bool(name: string, field: string, value: unknown): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') fail(name, `"${field}" must be a boolean.`)
  return value
}

function fade(name: string, field: string, value: unknown): number {
  if (value === undefined) return KIT.fadeMs
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(name, `"${field}" must be an integer >= 0 (milliseconds).`)
  }
  return value
}

function common(
  name: string,
  input: KitOverlayInput,
  placement: KitPlacement
): KitSpecCommon {
  let durationMs: number | undefined
  if (input.duration !== undefined) {
    if (
      typeof input.duration !== 'number' ||
      !Number.isFinite(input.duration) ||
      input.duration <= 0
    ) {
      fail(name, '"duration" must be a positive number of milliseconds.')
    }
    durationMs = input.duration
  }
  validateThemeOverride(name, input.theme)
  return {
    durationMs,
    fadeInMs: fade(name, 'fadeIn', input.fadeIn),
    fadeOutMs: fade(name, 'fadeOut', input.fadeOut),
    pinToScreen: bool(name, 'pinToScreen', input.pinToScreen),
    overMouse: bool(name, 'overMouse', input.overMouse),
    theme: input.theme,
    placement,
  }
}

const THEME_COLOR_KEYS = [
  'accent',
  'accentForeground',
  'accentSoft',
  'surface',
  'onSurface',
] as const

function validateThemeOverride(name: string, theme: unknown): void {
  if (theme === undefined) return
  if (typeof theme !== 'object' || theme === null) {
    fail(name, '"theme" must be an object of theme overrides.')
  }
  const t = theme as Record<string, unknown>
  for (const key of THEME_COLOR_KEYS) {
    const value = t[key]
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.trim() === '')
    ) {
      fail(name, `theme.${key} must be a CSS colour string.`)
    }
  }
  if (
    t.radius !== undefined &&
    (typeof t.radius !== 'number' || !Number.isFinite(t.radius) || t.radius < 0)
  ) {
    fail(
      name,
      'theme.radius must be a number of CSS px greater than or equal to 0.'
    )
  }
  if (
    t.fontFamily !== undefined &&
    (typeof t.fontFamily !== 'string' || t.fontFamily.trim() === '')
  ) {
    fail(name, 'theme.fontFamily must be a non-empty string.')
  }
  if (t.scheme !== undefined && t.scheme !== 'light' && t.scheme !== 'dark') {
    fail(name, `theme.scheme must be 'light' or 'dark'.`)
  }
}

function anchored(
  name: string,
  input: { anchor?: unknown; side?: unknown; align?: unknown; gap?: unknown },
  defaults: {
    side: OverlaySide
    align: OverlayAlign
    gap: number
    bleed: number
  }
): KitPlacement {
  if (!isLocator(input.anchor)) {
    fail(
      name,
      '"anchor" must be a Playwright locator for the element the overlay points at.'
    )
  }
  const side = input.side ?? defaults.side
  if (!isOverlaySide(side) || side === 'over') {
    fail(name, `"side" must be one of 'top', 'bottom', 'left', or 'right'.`)
  }
  const align = input.align ?? defaults.align
  if (!isOverlayAlign(align)) {
    fail(name, `"align" must be one of 'start', 'center', or 'end'.`)
  }
  return {
    kind: 'anchor',
    anchor: input.anchor,
    side,
    align,
    gap: px(name, 'gap', input.gap, defaults.gap),
    margin: 0,
    bleed: defaults.bleed,
  }
}

function anchoredOrPoint(
  name: string,
  input: {
    anchor?: unknown
    side?: unknown
    align?: unknown
    gap?: unknown
    x?: unknown
    y?: unknown
    relativeTo?: unknown
  },
  defaults: {
    side: OverlaySide
    align: OverlayAlign
    gap: number
    bleed: number
  }
): KitPlacement {
  if (input.anchor !== undefined) {
    if (
      input.x !== undefined ||
      input.y !== undefined ||
      input.relativeTo !== undefined
    ) {
      fail(name, 'cannot combine "anchor" with x/y/relativeTo.')
    }
    return anchored(name, input, defaults)
  }
  if (
    input.side !== undefined ||
    input.align !== undefined ||
    input.gap !== undefined
  ) {
    fail(name, 'side/align/gap only apply with "anchor".')
  }
  if (typeof input.x !== 'number' || typeof input.y !== 'number') {
    fail(
      name,
      'set "anchor" (a locator) or both "x" and "y" (CSS px of the recording viewport).'
    )
  }
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
    fail(name, '"x" and "y" must be finite numbers.')
  }
  const relativeTo = input.relativeTo ?? 'recording'
  if (relativeTo !== 'screen' && relativeTo !== 'recording') {
    fail(name, `"relativeTo" must be 'screen' or 'recording'.`)
  }
  return {
    kind: 'point',
    x: input.x,
    y: input.y,
    relativeTo,
    bleed: defaults.bleed,
  }
}

/** Validates a kit input at declaration time and fills in the defaults. */
export function validateKitInput(
  name: string,
  input: KitOverlayInput
): KitSpec {
  if (!(KIT_NAMES as readonly string[]).includes(input.kit)) {
    fail(
      name,
      `unknown kit "${String(input.kit)}". Use one of ${KIT_NAMES.map((k) => `'${k}'`).join(', ')}.`
    )
  }
  switch (input.kit) {
    case 'ring': {
      const ring = input as KitRingInput
      if (!isLocator(ring.anchor)) {
        fail(
          name,
          '"anchor" must be a Playwright locator for the element to ring.'
        )
      }
      return {
        kit: 'ring',
        ...common(name, input, {
          kind: 'anchor',
          anchor: ring.anchor,
          side: 'over',
          align: 'center',
          gap: 0,
          margin: px(name, 'margin', ring.margin, KIT.ring.margin),
          bleed: KIT.ring.bleed,
        }),
      }
    }
    case 'spotlight': {
      const spot = input as KitSpotlightInput
      if (!isLocator(spot.anchor)) {
        fail(
          name,
          '"anchor" must be a Playwright locator for the element to spotlight.'
        )
      }
      const dim = spot.dim ?? KIT.spotlight.dim
      if (typeof dim !== 'number' || !(dim > 0 && dim <= 1)) {
        fail(name, '"dim" must be a number greater than 0 and at most 1.')
      }
      return {
        kit: 'spotlight',
        anchor: spot.anchor,
        margin: px(name, 'margin', spot.margin, KIT.spotlight.margin),
        dim,
        ...common(name, input, { kind: 'fill' }),
      }
    }
    case 'callout': {
      const callout = input as KitCalloutInput
      const maxWidth = callout.maxWidth ?? KIT.callout.maxWidth
      if (typeof maxWidth !== 'number' || !(maxWidth > 0)) {
        fail(name, '"maxWidth" must be a positive number of CSS px.')
      }
      return {
        kit: 'callout',
        text: text(name, 'text', callout.text),
        maxWidth,
        ...common(
          name,
          input,
          anchored(name, callout, {
            side: 'bottom',
            align: 'center',
            gap: KIT.callout.gap,
            bleed: KIT.callout.bleed,
          })
        ),
      }
    }
    case 'badge': {
      const badge = input as KitBadgeInput
      const tone = badge.tone ?? 'accent'
      if (tone !== 'accent' && tone !== 'neutral') {
        fail(name, `"tone" must be 'accent' or 'neutral'.`)
      }
      return {
        kit: 'badge',
        text: text(name, 'text', badge.text),
        tone,
        ...common(
          name,
          input,
          anchoredOrPoint(name, badge, {
            side: 'top',
            align: 'start',
            gap: KIT.badge.gap,
            bleed: KIT.badge.bleed,
          })
        ),
      }
    }
    case 'step': {
      const step = input as KitStepInput
      if (!Number.isInteger(step.number) || step.number < 1) {
        fail(name, '"number" must be an integer >= 1.')
      }
      return {
        kit: 'step',
        number: step.number,
        ...common(
          name,
          input,
          anchored(name, step, {
            side: 'left',
            align: 'start',
            gap: KIT.step.gap,
            bleed: KIT.step.bleed,
          })
        ),
      }
    }
    case 'title': {
      const title = input as KitTitleInput
      const align = title.align ?? 'center'
      if (align !== 'center' && align !== 'start') {
        fail(name, `"align" must be 'center' or 'start'.`)
      }
      return {
        kit: 'title',
        title: text(name, 'title', title.title),
        subtitle:
          title.subtitle === undefined
            ? undefined
            : text(name, 'subtitle', title.subtitle),
        align,
        ...common(name, input, { kind: 'fill' }),
      }
    }
    case 'keys': {
      const keys = input as KitKeysInput
      if (!Array.isArray(keys.keys) || keys.keys.length === 0) {
        fail(
          name,
          "\"keys\" must be a non-empty array of key names, e.g. ['Cmd', 'K']."
        )
      }
      return {
        kit: 'keys',
        keys: keys.keys.map((k, i) => text(name, `keys[${i}]`, k)),
        ...common(
          name,
          input,
          anchoredOrPoint(name, keys, {
            side: 'top',
            align: 'start',
            gap: KIT.keys.gap,
            bleed: KIT.keys.bleed,
          })
        ),
      }
    }
    default:
      input satisfies never
      return fail(
        name,
        `unknown kit "${String((input as { kit: unknown }).kit)}".`
      )
  }
}
