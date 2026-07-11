/**
 * Unified timeline edits: the typed record shapes of web-editor edits.
 *
 * A `TimelineEditsDoc` carries every edit the web editor produced for a video
 * as typed records keyed by the stable code identity of an action (its
 * `editId` slug). There are no anchors and no offsets: position is "where the
 * call sits in code call-order," and timing gaps are plain `waitForTimeout`
 * sleeps.
 *
 * Code is the single source of truth: edits arrive over the dev channel as
 * codegen requests (`screenci dev`, see applyCodegen.ts) and are written
 * straight into the .screenci.ts sources. Nothing is applied at record time;
 * a recording always runs purely from code values.
 *
 * - `paramEdit`: changes parameter fields of a recorded action (durations,
 *   sleeps, typing delay). It targets an action by its stable editable key.
 * - `renameEdit`: renames an action's `editId` slug.
 * - `mediaEdit`: a narration cue / overlay / audio start placed in the gap
 *   after an action. `blocking:true` awaits it (backbone, advances the
 *   timeline); `blocking:false` fires and forgets (background). End is never
 *   stored.
 * - `zoomEdit`: an `autoZoom` bracket over the interaction run
 *   `fromEditId..untilEditId`; lead-in/hold are sleeps inside the block.
 * - `gapSpanEdit`: a `hide`/`speed`/`time` span whose start and end both land
 *   in gaps (after `fromEditId` and after `untilEditId`).
 * - `gapPointEdit`: an instant `moveNarration`/`resizeRecording`/`setBackground`
 *   point in the gap after an action.
 */

export const TIMELINE_EDITS_VERSION = 3

// ─── Edit records ────────────────────────────────────────────────────────────

export const MEDIA_EDIT_KINDS = ['narrationCue', 'overlay', 'audio'] as const
export const GAP_SPAN_KINDS = ['hide', 'speed', 'time'] as const
export const GAP_POINT_KINDS = [
  'narrationBox',
  'recording',
  'background',
] as const

export type MediaEditKind = (typeof MEDIA_EDIT_KINDS)[number]
export type GapSpanKind = (typeof GAP_SPAN_KINDS)[number]
export type GapPointKind = (typeof GAP_POINT_KINDS)[number]

/**
 * Parameter edit for a recorded action. Targets a stable editable key and
 * carries only field values: the record shape cannot express repositioning.
 */
export type ParamEdit = {
  type: 'paramEdit'
  id: string
  target: { key: string }
  fields: Record<string, unknown>
}

/**
 * Rename of an action's stable `editId` slug, made in the web editor. Applied
 * to code by `screenci sync` (the slug's string literal is replaced); until
 * then the recorded slug keeps matching, so nothing goes stale in between.
 */
export type RenameEdit = {
  type: 'renameEdit'
  id: string
  target: { editId: string }
  newEditId: string
}

/**
 * A narration cue / overlay / audio start, placed in the gap after the action
 * identified by `afterEditId`. `blocking:true` is awaited (backbone); a
 * `sleepBeforeMs` gap precedes it. `props.name` names the media.
 */
export type MediaEdit = {
  type: 'mediaEdit'
  id: string
  kind: MediaEditKind
  afterEditId: string
  sleepBeforeMs?: number
  /**
   * Places the call BEFORE the anchor instead of in the gap after it, with a
   * `{ delay: delayMs }` option: the recorded start lands `delayMs` after the
   * anchor's start, so the media can begin during the anchor interaction.
   * Mutually exclusive with a positive `sleepBeforeMs`.
   */
  delayMs?: number
  blocking: boolean
  props?: Record<string, unknown>
  disabled?: boolean
}

/**
 * An `autoZoom` bracket over the interaction run `fromEditId..untilEditId`.
 * `leadInMs`/`holdMs` become `waitForTimeout` sleeps at the start/end inside
 * the block; `props` carry the zoom options (amount/duration/easing/...).
 */
export type ZoomEdit = {
  type: 'zoomEdit'
  id: string
  fromEditId: string
  untilEditId: string
  leadInMs?: number
  holdMs?: number
  props?: Record<string, unknown>
  disabled?: boolean
}

/**
 * A zero-record-time span (`hide`/`speed`/`time`). Start lands in the gap
 * after `fromEditId`, end in the gap after `untilEditId`; the backbone in
 * between is blanked/retimed. `fromSleepMs`/`untilSleepMs` pace the gap edges.
 */
export type GapSpanEdit = {
  type: 'gapSpanEdit'
  id: string
  kind: GapSpanKind
  fromEditId: string
  fromSleepMs?: number
  /**
   * Delays the span's recorded START into the `fromEditId` interaction: the
   * wrap opens with `{ delay: delayMs }` so the effect begins `delayMs` after
   * the interaction's start. Mutually exclusive with a positive `fromSleepMs`.
   */
  delayMs?: number
  untilEditId: string
  untilSleepMs?: number
  props?: Record<string, unknown>
  disabled?: boolean
}

/**
 * An instant zero-duration point (`narrationBox`/`recording`/`background`) in
 * the gap after `afterEditId`. `props` carry the change (corner/size/css/...).
 */
export type GapPointEdit = {
  type: 'gapPointEdit'
  id: string
  kind: GapPointKind
  afterEditId: string
  sleepBeforeMs?: number
  /**
   * Places the call BEFORE the anchor with a `{ delay: delayMs }` option so
   * the instant change lands `delayMs` after the anchor interaction's start
   * (i.e. during it). Mutually exclusive with a positive `sleepBeforeMs`.
   */
  delayMs?: number
  props?: Record<string, unknown>
  disabled?: boolean
}

/**
 * A placement change to an overlay DECLARATION in `video.overlays({...})`,
 * made graphically in the web editor. `props` carries exactly one placement
 * variant to merge into the named overlay's config object:
 * - `{ margin }` for a locator-locked overlay (declared with `over`),
 * - `{ x?, y?, width | height }` or `{ fill }` for a freely placed one.
 * Applied by `screenci sync` only (nothing to do at record time); stale
 * variant keys (e.g. `fill` when switching to a box) are removed by the
 * codemod. The id is `overlaydecl-<overlayName>` so upserts are
 * last-write-wins per overlay.
 */
export type OverlayDeclEdit = {
  type: 'overlayDeclEdit'
  id: string
  overlayName: string
  props: Record<string, unknown>
  disabled?: boolean
}

/** Codify-only records: placed into code by `screenci sync`, never at runtime. */
export type CodifyEdit = MediaEdit | ZoomEdit | GapSpanEdit | GapPointEdit

export type EditRecord = ParamEdit | RenameEdit | CodifyEdit | OverlayDeclEdit

export type TimelineEditsDoc = {
  version: number
  edits: EditRecord[]
}

// ─── Stable ids for cues and overlays ────────────────────────────────────────

/** Stable id of the nth (0-based) narration cue with this name. */
export function cueIdFor(name: string, ordinal: number): string {
  return `cue||${name}|${ordinal}`
}

/** Stable id of the nth (0-based) overlay/asset with this name. */
export function overlayIdFor(name: string, ordinal: number): string {
  return `overlay||${name}|${ordinal}`
}

/** Stable id of the declaration-placement edit for an overlay name. */
export function overlayDeclIdFor(name: string): string {
  return `overlaydecl-${name}`
}
