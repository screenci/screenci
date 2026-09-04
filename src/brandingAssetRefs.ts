import type { CliBrandingAsset } from './branding.js'

/**
 * Record-time checks for `{ branding: '<name>' }` overlays.
 *
 * The bytes are resolved at export, so a typo would otherwise only surface as
 * a failed export minutes later. The CLI fetches the branding once before
 * uploading and runs these checks against the names the Branding page holds.
 */

export type BrandingAssetRef = {
  /** The overlay key in the video code. */
  overlayName: string
  /** The referenced shared asset. */
  assetName: string
  /**
   * Whether the overlay is bounded at all: by a length on the start event
   * (`duration`, `.for`, `.until`) or by a paired `assetEnd`, which is what
   * `start()` / `end()` produces. An image with neither has nothing to show
   * for, and the export refuses it.
   */
  hasLength: boolean
  /** Whether it uses options that only apply to a video asset. */
  usesVideoOptions: boolean
}

const VIDEO_ONLY_KEYS = [
  'audio',
  'speed',
  'time',
  'sourceStart',
  'sourceEnd',
] as const

/** Every branding overlay in a recording's events. */
export function collectBrandingAssetRefs(data: unknown): BrandingAssetRef[] {
  const events =
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { events?: unknown }).events)
      ? ((data as { events: unknown[] }).events as unknown[])
      : []
  const refs: BrandingAssetRef[] = []
  // Overlays may overlap, so track which are still open and pair each end to
  // its start the way the renderer does: by name, falling back to the most
  // recently opened when a recording predates the name (see AssetEndEvent).
  // Non-branding overlays go on the stack too, or that fallback picks wrong.
  const open: { name: string; ref: BrandingAssetRef | null }[] = []
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue
    const e = event as Record<string, unknown>
    const name = typeof e.name === 'string' ? e.name : ''

    if (e.type === 'assetStart') {
      const branding =
        e.kind === 'branding'
          ? (e.branding as { name?: unknown } | undefined)
          : undefined
      const assetName =
        typeof branding?.name === 'string' ? branding.name : undefined
      if (assetName === undefined) {
        open.push({ name, ref: null })
        continue
      }
      const ref: BrandingAssetRef = {
        overlayName: name,
        assetName,
        hasLength:
          e.durationMs !== undefined ||
          e.untilOutputMs !== undefined ||
          e.untilPercent !== undefined,
        usesVideoOptions: VIDEO_ONLY_KEYS.some((key) => e[key] !== undefined),
      }
      refs.push(ref)
      open.push({ name, ref })
      continue
    }

    if (e.type === 'assetEnd') {
      const index =
        typeof e.name === 'string'
          ? findLastIndex(open, (entry) => entry.name === e.name)
          : open.length - 1
      if (index < 0) continue
      const [closed] = open.splice(index, 1)
      if (closed?.ref !== undefined && closed.ref !== null) {
        closed.ref.hasLength = true
      }
    }
  }
  return refs
}

/** `Array.prototype.findLastIndex` is newer than the Node floor this targets. */
function findLastIndex<T>(
  items: readonly T[],
  matches: (item: T) => boolean
): number {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item !== undefined && matches(item)) return index
  }
  return -1
}

/**
 * Problems to report before uploading. `assets` null means the branding could
 * not be fetched (an older service, or an offline check): nothing is reported,
 * and the caller warns that the names could not be verified.
 */
export function validateBrandingAssetRefs(
  refs: readonly BrandingAssetRef[],
  assets: readonly CliBrandingAsset[] | null
): string[] {
  if (assets === null) return []
  const byName = new Map(assets.map((asset) => [asset.name, asset]))
  const available =
    assets.length === 0
      ? 'none are defined yet'
      : `available: ${[...byName.keys()].sort().join(', ')}`
  const problems: string[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const key = `${ref.overlayName}:${ref.assetName}`
    if (seen.has(key)) continue
    seen.add(key)
    const asset = byName.get(ref.assetName)
    if (asset === undefined) {
      problems.push(
        `Overlay "${ref.overlayName}" references the branding asset "${ref.assetName}", which is not on the Branding page (${available}). Add it there, or fix the name.`
      )
      continue
    }
    if (asset.kind === 'image') {
      if (!ref.hasLength) {
        problems.push(
          `Overlay "${ref.overlayName}" shows the branding image "${ref.assetName}" but has no length. Give it a duration, or use start() and end().`
        )
      }
      if (ref.usesVideoOptions) {
        problems.push(
          `Overlay "${ref.overlayName}" uses video options, but the branding asset "${ref.assetName}" is an image.`
        )
      }
      continue
    }
    if (ref.hasLength) {
      problems.push(
        `Overlay "${ref.overlayName}" sets a length, but the branding video "${ref.assetName}" plays for its own length.`
      )
    }
  }
  return problems
}
