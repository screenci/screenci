/**
 * Studio mode — configure render/record options, narration, on-screen text,
 * overlays, and background audio from the ScreenCI web app instead of code.
 * Business tier only.
 *
 * Opt in with a single `video.studio({...})` (or `screenshot.studio({...})`)
 * declaration, chainable with `.localize()` / `.each()`:
 *
 * - `renderOptions: true` / `recordOptions: true` defer those option groups to
 *   Studio. `recordOptions` (aspect ratio, quality, fps) changes the capture, so
 *   it is fetched before recording; `renderOptions` is applied at render.
 * - `narration`, `text`, `overlays`, `audio` are name lists declaring the cues /
 *   fields / overlays / tracks whose content is owned by Studio. The matching
 *   `narration` / `text` / `overlays` / `audio` fixtures expose typed
 *   controllers/values for them.
 *
 * On the first upload of a studio-mode video, rendering is held until the video
 * is configured in Studio (the CLI prints a direct link); later uploads reuse
 * the saved configuration automatically.
 *
 * @example
 * ```ts
 * import { video } from 'screenci'
 *
 * video
 *   .studio({ renderOptions: true, narration: ['intro'], overlays: ['logo'] })
 *   .localize({ languages: ['en', 'fi'] })(
 *   'Product demo',
 *   async ({ page, narration, overlays }) => {
 *     await overlays.logo()
 *     await narration.intro()
 *   }
 * )
 * ```
 */
export type StudioDeclaration = {
  /** Defer render options to Studio. Applied at render time. */
  renderOptions?: boolean
  /**
   * Defer record options (aspect ratio, quality, fps) to Studio. Fetched before
   * recording, since they change the captured viewport/encode.
   */
  recordOptions?: boolean
  /** Studio-managed narration cue names (text and voice configured in Studio). */
  narration?: readonly string[]
  /** Studio-managed on-screen text field names (values configured in Studio). */
  text?: readonly string[]
  /** Studio-managed overlay names (file and placement configured in Studio). */
  overlays?: readonly string[]
  /** Studio-managed background-audio track names (file/volume configured in Studio). */
  audio?: readonly string[]
}

/** The studio option groups deferred to render/record. */
export type StudioOptionFlags = {
  renderOptions: boolean
  recordOptions: boolean
}

/** Returns the render/record deferral flags for a (possibly absent) declaration. */
export function studioOptionFlags(
  declaration: StudioDeclaration | undefined
): StudioOptionFlags {
  return {
    renderOptions: declaration?.renderOptions === true,
    recordOptions: declaration?.recordOptions === true,
  }
}

function assertUniqueStudioNames(
  label: string,
  names: readonly string[]
): void {
  const seen = new Set<string>()
  for (const name of names) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(
        `video.studio(): ${label} names must be non-empty strings.`
      )
    }
    if (seen.has(name)) {
      throw new Error(`video.studio(): duplicate ${label} name "${name}".`)
    }
    seen.add(name)
  }
}

function assertDisjointFromSeeded(
  label: string,
  studioNames: readonly string[],
  seededNames: readonly string[]
): void {
  const seeded = new Set(seededNames)
  const overlap = studioNames.filter((name) => seeded.has(name))
  if (overlap.length === 0) return
  throw new Error(
    `video.studio(): ${label} name(s) ${overlap.join(
      ', '
    )} are both seeded in localize() and declared as Studio-managed. A name must be one or the other.`
  )
}

/**
 * Validates a studio declaration against the seeded localize names: each name
 * list is unique and non-empty, and Studio-managed narration/text names are
 * disjoint from the names seeded in `localize()`. Pure; throws on violation.
 */
export function validateStudioDeclaration(
  declaration: StudioDeclaration | null,
  seededNarrationNames: readonly string[],
  seededTextNames: readonly string[]
): void {
  if (declaration === null) return

  assertUniqueStudioNames('narration', declaration.narration ?? [])
  assertUniqueStudioNames('text', declaration.text ?? [])
  assertUniqueStudioNames('overlays', declaration.overlays ?? [])
  assertUniqueStudioNames('audio', declaration.audio ?? [])

  assertDisjointFromSeeded(
    'narration',
    declaration.narration ?? [],
    seededNarrationNames
  )
  assertDisjointFromSeeded('text', declaration.text ?? [], seededTextNames)
}
