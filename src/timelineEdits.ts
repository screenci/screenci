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
 * - `optionsEdit`: a full snapshot of the editor's render or record option
 *   values, merged into the video's `.renderOptions({...})` /
 *   `.recordOptions({...})` builder call (added when missing).
 * - `narrationEdit`: a narration cue value change, merged into the
 *   `video.narration({...})` declaration (added when missing; the declaration
 *   is converted to the language-major form when a non-default language is
 *   edited).
 * - `valuesEdit`: an on-screen `values` field value change, merged into the
 *   `video.values({...})` declaration the same way narration edits are (added
 *   when missing; a names-only declaration is converted to an object literal
 *   seeded with the edited field).
 * - `languagesEdit`: the full desired language set for a video, written into
 *   the `video.languages([...])` declaration (the block is created when
 *   missing and its array extended otherwise).
 * - `editorMediaEdit`: declares an editor-uploaded media item (overlay, narration
 *   audio, or audio track) as backend-hosted in code, written into
 *   `video.overlays/narration/audio({...})` as `{ <name>: { editor } }`. The
 *   bytes stay in the backend; the declaration only makes the item explicit.
 */

export const TIMELINE_EDITS_VERSION = 5

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
 * Removes a code-owned NAMED wrapper block (`hide('name', ...)` /
 * `speed('name', ...)` / `time('name', ...)`) from source. `screenci sync`
 * unwraps the block, keeping the wrapped calls (any `waitForTimeout` pacing
 * inside the block survives as plain gap sleeps). `target.editId` is the
 * block's stable name slug. Anonymous blocks cannot be targeted.
 */
export type BlockRemoveEdit = {
  type: 'blockRemoveEdit'
  id: string
  target: { editId: string }
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

export const OPTIONS_EDIT_METHODS = ['renderOptions', 'recordOptions'] as const
export type OptionsEditMethod = (typeof OPTIONS_EDIT_METHODS)[number]

/**
 * A full snapshot of the editor's render or record option values for a video.
 * Merged (deep, idempotent) into the existing `.<method>({...})` object
 * literal of the video builder chain, or appended as a new `.<method>({...})`
 * call when the section is missing. The id is `options|<method>` so repeated
 * sends coalesce last-write-wins per method.
 */
export type OptionsEdit = {
  type: 'optionsEdit'
  id: string
  method: OptionsEditMethod
  values: Record<string, unknown>
}

/**
 * The value of one narration cue: a plain string, or an object carrying the
 * cue text plus per-cue metadata (voice override, volume).
 */
export type NarrationCueValue = string | { cue: string; [key: string]: unknown }

/**
 * A narration cue value change made in the web editor, applied to the
 * `video.narration(...)` declaration argument. `lang` is a language code or
 * `'default'` for the shared value. When the declaration is content-major and
 * a non-default language is edited, the argument is rewritten to the
 * language-major form (existing values move under `default`). The id is
 * `narration|<cueName>|<lang>` so repeated sends coalesce per cue and
 * language.
 */
export type NarrationEdit = {
  type: 'narrationEdit'
  id: string
  cueName: string
  lang: string
  /**
   * True when `lang` is the video's default language: the edit targets the
   * shared value (content-major object or `default` sub-object) unless the
   * declaration carries an explicit `[lang]` sub-object.
   */
  isDefault?: boolean
  value: NarrationCueValue
}

/**
 * The value of one on-screen `values` field: a plain string. Unlike narration
 * there is no per-cue metadata, so the value is always the raw text.
 */
export type ValuesFieldValue = string

/**
 * An on-screen `values` field value change made in the web editor, applied to
 * the `video.values(...)` declaration argument. `lang` is a language code or
 * `'default'` for the shared value. Handled exactly like {@link NarrationEdit}:
 * a content-major declaration edited in a non-default language is rewritten to
 * the language-major form, and a names-only declaration is converted to an
 * object literal seeded with the edited field. The id is
 * `values|<field>|<lang>` so repeated sends coalesce per field and language.
 */
export type ValuesEdit = {
  type: 'valuesEdit'
  id: string
  field: string
  lang: string
  /**
   * True when `lang` is the video's default language: the edit targets the
   * shared value (content-major object or `default` sub-object) unless the
   * declaration carries an explicit `[lang]` sub-object.
   */
  isDefault?: boolean
  value: ValuesFieldValue
}

/**
 * The full desired language set for a video, written into the
 * `video.languages([...])` declaration. `languages` lists every language the
 * video should record, the default language first. The declaration's array is
 * created when missing and extended (preserving existing order) otherwise; an
 * object-config declaration has its `languages` array merged. The id is
 * `languages` so repeated sends coalesce last-write-wins per video.
 */
export type LanguagesEdit = {
  type: 'languagesEdit'
  id: string
  languages: string[]
}

export const EDITOR_MEDIA_METHODS = ['overlays', 'narration', 'audio'] as const
export type EditorMediaMethod = (typeof EDITOR_MEDIA_METHODS)[number]

/**
 * Declares an editor-uploaded media item in code as backend-hosted: written
 * into `video.overlays({...})` / `video.narration({...})` / `video.audio({...})`
 * as `{ <name>: { editor: '<editor>' } }` (the declaration is created when
 * missing; a names-only array form is converted to the object form). The bytes
 * stay in the ScreenCI backend; the declaration only makes the item an explicit
 * part of the video. The id is `editorMedia|<method>|<name>` so repeated sends
 * coalesce per item.
 */
export type EditorMediaEdit = {
  type: 'editorMediaEdit'
  id: string
  method: EditorMediaMethod
  /** The declaration key (the code-facing controller/cue name). */
  name: string
  /** The backend asset name (conventionally the same as `name`). */
  editor: string
}

/** Codify-only records: placed into code by `screenci sync`, never at runtime. */
export type CodifyEdit =
  | MediaEdit
  | ZoomEdit
  | GapSpanEdit
  | GapPointEdit
  | BlockRemoveEdit

export type EditRecord =
  | ParamEdit
  | RenameEdit
  | CodifyEdit
  | OverlayDeclEdit
  | OptionsEdit
  | NarrationEdit
  | ValuesEdit
  | LanguagesEdit
  | EditorMediaEdit

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

/** Stable id of the options snapshot edit for a builder method. */
export function optionsEditIdFor(method: OptionsEditMethod): string {
  return `options|${method}`
}

/** Stable id of the narration value edit for a cue name and language. */
export function narrationEditIdFor(cueName: string, lang: string): string {
  return `narration|${cueName}|${lang}`
}

/** Stable id of the values field edit for a field name and language. */
export function valuesEditIdFor(field: string, lang: string): string {
  return `values|${field}|${lang}`
}

/** Stable id of the languages edit for a video (one per video). */
export function languagesEditId(): string {
  return `languages`
}

/** Stable id of the editor-media marker edit for a method and item name. */
export function editorMediaEditIdFor(
  method: EditorMediaMethod,
  name: string
): string {
  return `editorMedia|${method}|${name}`
}

/** Stable id of the param edit targeting an editable key. */
export function paramEditIdFor(key: string): string {
  return `param|${key}`
}

/** Stable id of the rename edit targeting an action's editId slug. */
export function renameEditIdFor(targetEditId: string): string {
  return `rename|${targetEditId}`
}

/**
 * A structured view of a wire edit id, parsed back from the string forms the
 * `*IdFor` encoders produce. Ids that follow none of the known conventions
 * come back as `{ kind: 'other' }` with the raw id.
 */
export type ParsedEditId =
  | { kind: 'param'; key: string }
  | { kind: 'rename'; targetEditId: string }
  | { kind: 'options'; method: OptionsEditMethod }
  | { kind: 'narration'; cueName: string; lang: string }
  | { kind: 'values'; field: string; lang: string }
  | { kind: 'languages' }
  | { kind: 'editorMedia'; method: EditorMediaMethod; name: string }
  | { kind: 'overlayDecl'; overlayName: string }
  | { kind: 'other'; editId: string }

/**
 * Parse a wire edit id into its structured form. Inverse of the encoders:
 * `param|<key>`, `rename|<targetEditId>`, `options|<method>`,
 * `narration|<cueName>|<lang>` (the language is the last segment, so cue
 * names may contain `|`), and `overlaydecl-<overlayName>`.
 */
export function parseEditId(editId: string): ParsedEditId {
  if (editId.startsWith('param|')) {
    return { kind: 'param', key: editId.slice('param|'.length) }
  }
  if (editId.startsWith('rename|')) {
    return { kind: 'rename', targetEditId: editId.slice('rename|'.length) }
  }
  if (editId.startsWith('options|')) {
    const method = editId.slice('options|'.length)
    const known = OPTIONS_EDIT_METHODS.find((candidate) => candidate === method)
    if (known !== undefined) return { kind: 'options', method: known }
    return { kind: 'other', editId }
  }
  if (editId.startsWith('narration|')) {
    const rest = editId.slice('narration|'.length)
    const split = rest.lastIndexOf('|')
    if (split > 0 && split < rest.length - 1) {
      return {
        kind: 'narration',
        cueName: rest.slice(0, split),
        lang: rest.slice(split + 1),
      }
    }
    return { kind: 'other', editId }
  }
  if (editId.startsWith('values|')) {
    const rest = editId.slice('values|'.length)
    const split = rest.lastIndexOf('|')
    if (split > 0 && split < rest.length - 1) {
      return {
        kind: 'values',
        field: rest.slice(0, split),
        lang: rest.slice(split + 1),
      }
    }
    return { kind: 'other', editId }
  }
  if (editId === 'languages') {
    return { kind: 'languages' }
  }
  if (editId.startsWith('editorMedia|')) {
    const rest = editId.slice('editorMedia|'.length)
    const split = rest.indexOf('|')
    if (split > 0 && split < rest.length - 1) {
      const method = rest.slice(0, split)
      const known = EDITOR_MEDIA_METHODS.find(
        (candidate) => candidate === method
      )
      if (known !== undefined) {
        return {
          kind: 'editorMedia',
          method: known,
          name: rest.slice(split + 1),
        }
      }
    }
    return { kind: 'other', editId }
  }
  if (editId.startsWith('overlaydecl-')) {
    return {
      kind: 'overlayDecl',
      overlayName: editId.slice('overlaydecl-'.length),
    }
  }
  return { kind: 'other', editId }
}
