/**
 * Planner for editor codegen: turns the web editor's edits into concrete
 * text changes to the user's .screenci.ts files, using the codemod primitives.
 * Driven by `screenci dev` (applyCodegen.ts), which applies each edit to the
 * sources the moment it arrives; code is the single source of truth.
 *
 * Every code edit locates its call site by an action's `editId` slug: an exact
 * string identity with no heuristics. The model is one linear timeline in call
 * order: interactions and effects interleave, gaps are `waitForTimeout` sleeps.
 * Placing an effect means inserting a call in the gap after a known editId'd
 * action (splitting an existing sleep when needed), or wrapping a contiguous
 * run of interactions in a block (`autoZoom`/`hide`/`speed`/`time`).
 *
 * An edit either applies by editId or its section is locked (unstamped action,
 * a `slug#N` loop repeat, control flow around the call, or a shape the codemod
 * refuses). Locked edits are counted in `unappliable` and reported as plain
 * text: there is no agent-prompt fallback.
 *
 * Pure over injected inputs (parsed comparison, snapshots, a readFile): unit
 * tests drive it with in-memory files.
 */
import {
  jsonEqual,
  type ActionMethod,
  type ActionParamRecord,
} from './actionParams.js'
import type { EditorOptionsSyncState } from './editorOptionsSync.js'
import type {
  CodifyEditsByVideo,
  EditableOverridesByVideo,
  EditableSnapshot,
  EditableSnapshotEntry,
  EditorMediaEditsByVideo,
  LanguagesEditsByVideo,
  NarrationEditsByVideo,
  OverlayDeclEditsByVideo,
  RenamesByVideo,
  ValuesEditsByVideo,
} from './editableSnapshot.js'
import { isLanguageKey } from './declare.js'
import type {
  CodifyEdit,
  GapPointEdit,
  GapSpanEdit,
  MediaEdit,
  ZoomEdit,
} from './timelineEdits.js'
import {
  applyTextEdits,
  awaitedCallHead,
  chainRootIdentifier,
  classifyEditIdSite,
  resolveImportedLocalName,
  resolvePageIdentifier,
  createContext,
  enclosingStatement,
  enclosingWrapBody,
  ensureNamedImport,
  findCallByEditId,
  findRecordedWait,
  findVideoCall,
  insertStatementBefore,
  insertStatementsAfter,
  isLinearCallSite,
  mergeAdjacentWaitEdits,
  nextStatement,
  previousStatement,
  removeFullLine,
  renameEditId as renameEditIdInSource,
  removeOption,
  setBuilderOptions,
  setNarrationValue,
  setValuesValue,
  setVideoLanguages,
  setEditorMedia,
  setOptionValue,
  setOverlayDeclProps,
  splitWaitEdit,
  statementsAfter,
  statementsBefore,
  unwrapBlockCall,
  unwrapWrapCallStatement,
  valueToSource,
  waitForTimeoutArg,
  wrapStatementsInBlock,
  type CodemodContext,
  type TextEdit,
  type TsModule,
} from './codemod.js'
import type TS from 'typescript'

/**
 * The duration-argument node of an `await <root>.waitForTimeout(<number>)`
 * statement sitting immediately before `statement`, or null. Lets repeated
 * sleepBefore syncs update the existing wait instead of stacking new ones.
 */
function existingWaitBefore(
  ctx: CodemodContext,
  statement: TS.Statement,
  root: string
): TS.NumericLiteral | null {
  const previous = previousStatement(ctx, statement)
  if (previous === null) return null
  return waitForTimeoutArg(ctx, previous, root)
}

/**
 * A recorded delay (waitForTimeout) has no editId of its own, so it is located
 * for codegen through its nearest stamped neighbor in recording order: the
 * following action (the wait sits before it) or, failing that, the preceding
 * action (the wait sits after it). The neighbor must be the immediate one; a
 * non-stamped entry in between (another delay/effect) makes the source position
 * ambiguous, so we return null and the caller refuses rather than guessing.
 */
function resolveDelayAnchor(
  entries: readonly EditableSnapshotEntry[],
  delayKey: string
): { anchorEditId: string; direction: 'before' | 'after' } | null {
  const index = entries.findIndex((entry) => entry.key === delayKey)
  if (index < 0) return null
  const following = entries[index + 1]
  if (following?.editId !== undefined) {
    return { anchorEditId: following.editId, direction: 'before' }
  }
  const preceding = entries[index - 1]
  if (preceding?.editId !== undefined) {
    return { anchorEditId: preceding.editId, direction: 'after' }
  }
  return null
}

/** Which argument holds the options object, per instrumented method. */
const OPTIONS_ARG_INDEX: Record<ActionMethod, number> = {
  click: 0,
  tap: 0,
  check: 0,
  uncheck: 0,
  hover: 0,
  selectText: 0,
  scrollIntoViewIfNeeded: 0,
  fill: 1,
  pressSequentially: 1,
  selectOption: 1,
  dragTo: 1,
}

/**
 * Editable cursor-move param fields and the option path they codify to on the
 * stamped call. Shared by every pointer-driven action (click, fill, dragTo,
 * hover, ...); action-specific extras (`duration`, `easing`, `dragSteps`) are
 * top-level options on their methods.
 */
const CURSOR_MOVE_OPTION_PATHS: Record<string, string> = {
  moveDuration: 'move.duration',
  moveSpeed: 'move.speed',
  moveEasing: 'move.easing',
  moveCurve: 'move.curve',
  moveCurviness: 'move.curviness',
  moveDelayAfter: 'move.delayAfter',
  duration: 'duration',
  easing: 'easing',
  dragSteps: 'dragSteps',
}

/**
 * Mutually exclusive sibling options: writing one must drop the other so a
 * call never carries both a duration and a speed.
 */
const EXCLUSIVE_OPTION_SIBLINGS: Record<string, string> = {
  moveDuration: 'move.speed',
  moveSpeed: 'move.duration',
}

/** Whether two text edits touch overlapping ranges (unsafe to co-apply). */
export function editsOverlap(a: TextEdit, b: TextEdit): boolean {
  return a.start < b.end && b.start < a.end
}

/** Refusal for a video whose builder declaration cannot be located. */
function unknownVideoRefusal(videoName: string): Refusal {
  return {
    reason: 'unknown-video',
    message:
      `the builder declaration of video '${videoName}' was not found in ` +
      `exactly one source file`,
  }
}

export type AppliedItem = {
  videoName: string
  file: string
  description: string
}

/**
 * Why an edit could not be applied by editId. Typed so callers (the CLI, the
 * web editor toast) can act on the category, not just show text:
 * - `unknown-edit-id`: the editId is absent from the candidate source files
 *   (or not present in exactly one of them).
 * - `ambiguous-edit-id`: the editId appears more than once in the file.
 * - `inside-control-flow`: the call sits inside a loop, branch, or ternary.
 * - `unstamped-action`: the action carries no editId yet (stamping pending).
 * - `loop-repeat`: the target is a `slug#N` repeat execution of a loop.
 * - `unsupported-field`: the edited param field has no code representation.
 * - `invalid-edit`: the edit record itself is incomplete or invalid.
 * - `unresolved-import`: the effect function is not importable in the file
 *   (no editable named import from 'screenci', e.g. a namespace import or a
 *   re-export wrapper).
 * - `unknown-video`: the video's builder declaration was not found in exactly
 *   one source file.
 * - `app-managed`: the value lives in the web app by design (a names-only
 *   narration declaration).
 * - `unsupported-shape`: the call site resists a mechanical edit (non-literal
 *   options, spreads, shorthand properties, unexpected structure).
 */
export type UnappliableReason =
  | 'unknown-edit-id'
  | 'ambiguous-edit-id'
  | 'inside-control-flow'
  | 'unstamped-action'
  | 'loop-repeat'
  | 'unsupported-field'
  | 'invalid-edit'
  | 'unresolved-import'
  | 'unknown-video'
  | 'app-managed'
  | 'unsupported-shape'

/** A typed refusal: why a compute step could not produce edits. */
export type Refusal = { reason: UnappliableReason; message: string }

/**
 * A compute step's outcome: text edits (possibly empty, idempotent no-op), a
 * typed {@link Refusal}, or null for an unclassified refusal (the caller
 * classifies it from the editIds involved).
 */
type ComputeResult = TextEdit[] | Refusal | null

function isRefusal(result: ComputeResult): result is Refusal {
  return result !== null && !Array.isArray(result)
}

/** An edit whose section is locked (never a codemod target this run). */
export type UnappliableItem = {
  videoName: string
  reason: UnappliableReason
  /** Human-readable explanation, shown in CLI output and editor toasts. */
  message: string
}

export type CodeSyncPlan = {
  /** Files with changes: original and edited text (not yet written). */
  files: Array<{ path: string; before: string; after: string }>
  applied: AppliedItem[]
  /** Edits that could not be applied by editId (locked sections). */
  unappliable: UnappliableItem[]
  /** Videos where every pending edit was applied (safe to reset web edits). */
  fullyAppliedVideos: string[]
}

/**
 * The latest recorded action-parameter records per video, used to locate
 * stamped call sites for comparison-driven option edits. The codegen path
 * passes an empty snapshot (the single edit record is the change).
 */
export type ActionParamsSnapshot = {
  version: 1
  videos: Record<string, ActionParamRecord[]>
}

/** How one editor action-parameter override relates to the code. */
export type OverrideAssessment = {
  kind: 'change' | 'remove' | 'codify' | 'in-sync' | 'stale'
  selector: string
  method: string
  occurrence: number
  optionPath: string
  editorValue: unknown
}

/**
 * Editor action-parameter override state to reconcile into code. The codegen
 * path passes an empty comparison; the shape stays so callers can feed
 * assessed overrides through the same planner.
 */
export type WebStateComparison = {
  videos: Array<{ videoName: string; overrides: OverrideAssessment[] }>
  snapshotEmpty: boolean
}

export type CodeSyncInput = {
  comparison: WebStateComparison
  actionSnapshot: ActionParamsSnapshot
  editableSnapshot: EditableSnapshot
  editableOverrides: EditableOverridesByVideo
  codifyEdits: CodifyEditsByVideo
  /**
   * Codify edits the editor removed (a disabled record still names the editId,
   * kind and sleep it placed). Their codemod-authored calls are deleted from
   * code so a "place then remove" round trip leaves no orphaned effect or
   * ghost gap sleep. Removal is implemented for the unambiguous point effects
   * (media cues/overlays/audio and gap points); disabled wrap edits
   * (zoom/hide/speed/time) are left in place (see `plannedRemoval`).
   */
  removedCodifyEdits: CodifyEditsByVideo
  renames: RenamesByVideo
  /**
   * Overlay declaration placement edits, keyed by video name. Codified into
   * the overlay's config object inside `video.overlays({...})`. Optional so
   * existing callers (and tests) need not pass it.
   */
  overlayDeclEdits?: OverlayDeclEditsByVideo
  /**
   * Studio render/record option edits, keyed by video name. Codified into
   * `video.renderOptions({...})` / `video.recordOptions({...})` builder calls.
   * Optional so existing callers (and tests) need not pass it.
   */
  editorOptionsSync?: EditorOptionsSyncState
  /**
   * Narration cue value edits, keyed by video name. Codified into the
   * `video.narration(...)` declaration argument (added when missing, converted
   * to the language-major form when a non-default language is edited).
   * Optional so existing callers (and tests) need not pass it.
   */
  narrationEdits?: NarrationEditsByVideo
  /**
   * On-screen `values` field edits, keyed by video name. Codified into the
   * `video.values(...)` declaration argument (added when missing; a names-only
   * declaration is converted to an object literal seeded with the edit).
   * Optional so existing callers (and tests) need not pass it.
   */
  valuesEdits?: ValuesEditsByVideo
  /**
   * Desired language set per video. Codified into `video.languages([...])`
   * (created when missing, its array extended otherwise). Optional so existing
   * callers (and tests) need not pass it.
   */
  languagesEdits?: LanguagesEditsByVideo
  /**
   * Editor-uploaded media markers per video. Codified into
   * `video.overlays/narration/audio({...})` as `{ <name>: { editor } }`.
   * Optional so existing callers (and tests) need not pass it.
   */
  editorMediaEdits?: EditorMediaEditsByVideo
}

/** A slug that is safe as a code identity and a wire key. */
export function isValidEditId(slug: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(slug)
}

export type CodeSyncDeps = {
  ts: TsModule
  readFile: (path: string) => string | null
}

/** An edit that locates its call site by editId. */
type SlugItem = {
  videoName: string
  editId: string
  description: string
  /** Marks the source item unappliable so it counts as locked. */
  onUnappliable: (refusal: Refusal) => void
  compute: (ctx: CodemodContext) => ComputeResult
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** `root.name` when `name` is a plain identifier, else `root['name']`. */
function memberAccess(root: string, name: string): string {
  return IDENTIFIER.test(name)
    ? `${root}.${name}`
    : `${root}[${valueToSource(name)}]`
}

/**
 * The imperative media call for a MediaEdit plus its callee `head` (the callee
 * text a re-sync matches against, e.g. `narration.intro`), or null when the
 * edit lacks a name.
 */
function mediaHeadAndCall(
  edit: MediaEdit
): { callCode: string; head: string } | null {
  const props = edit.props ?? {}
  const name = typeof props.name === 'string' && props.name ? props.name : null
  if (name === null) return null
  const root =
    edit.kind === 'narrationCue'
      ? 'narration'
      : edit.kind === 'overlay'
        ? 'overlays'
        : typeof props.fixture === 'string' && props.fixture
          ? props.fixture
          : 'audio'
  const head = memberAccess(root, name)
  // A delayed placement (validated non-blocking) carries the offset as a
  // `delay` option on start(); the call itself sits before the anchor.
  const startArgs =
    edit.delayMs !== undefined
      ? valueToSource({ delay: Math.round(edit.delayMs) })!
      : ''
  return {
    callCode: edit.blocking
      ? `await ${head}()`
      : `await ${head}.start(${startArgs})`,
    head,
  }
}

/** The instant call + import for a GapPointEdit, or null when incomplete. */
function gapPointCode(
  edit: GapPointEdit
): { code: string; importName: string } | null {
  const props = edit.props ?? {}
  // A delayed placement carries the offset as a `delay` option on the call.
  const delayFields: Record<string, unknown> =
    edit.delayMs !== undefined ? { delay: Math.round(edit.delayMs) } : {}
  /** Options-object source for `fields` merged with the delay, '' when empty. */
  const optionsSource = (fields: Record<string, unknown>): string => {
    const merged = { ...fields, ...delayFields }
    return Object.keys(merged).length > 0 ? valueToSource(merged)! : ''
  }
  /** `, { ... }` trailing-argument form of {@link optionsSource}. */
  const trailingOptions = (fields: Record<string, unknown>): string => {
    const source = optionsSource(fields)
    return source === '' ? '' : `, ${source}`
  }
  switch (edit.kind) {
    case 'narrationBox': {
      const corner = typeof props.corner === 'string' ? props.corner : undefined
      const size = typeof props.size === 'number' ? props.size : undefined
      if (corner !== undefined) {
        const opt = trailingOptions(size !== undefined ? { size } : {})
        return {
          code: `await moveNarration(${valueToSource(corner)}${opt})`,
          importName: 'moveNarration',
        }
      }
      if (size !== undefined) {
        return {
          code: `await resizeNarration(${size}${trailingOptions({})})`,
          importName: 'resizeNarration',
        }
      }
      return null
    }
    case 'recording': {
      const visible =
        typeof props.visible === 'boolean' ? props.visible : undefined
      const size = typeof props.size === 'number' ? props.size : undefined
      if (visible === false) {
        return {
          code: `await hideRecording(${optionsSource({})})`,
          importName: 'hideRecording',
        }
      }
      if (visible === true) {
        return {
          code: `await showRecording(${optionsSource({})})`,
          importName: 'showRecording',
        }
      }
      if (size !== undefined) {
        return {
          code: `await resizeRecording(${size}${trailingOptions({})})`,
          importName: 'resizeRecording',
        }
      }
      return null
    }
    case 'background': {
      const css =
        typeof props.backgroundCss === 'string' && props.backgroundCss
          ? props.backgroundCss
          : undefined
      if (css === undefined) return null
      return {
        code: `await setBackground(${valueToSource(css)}${trailingOptions({})})`,
        importName: 'setBackground',
      }
    }
    default: {
      const exhaustive: never = edit.kind
      void exhaustive
      return null
    }
  }
}

/**
 * A codemod-authored effect placement already in code: the effect call
 * statement and, when present, the editor-placed `waitForTimeout` sleep sitting
 * immediately before it. Recognised structurally (no marker): scanning the
 * statements after the anchor, every gap sleep and awaited effect call is part
 * of the placement region; the first ordinary statement ends it.
 */
type PlacedEffect = {
  callStatement: TS.Statement
  sleepStatement: TS.Statement | null
}

/**
 * Find the codemod-authored placement of the effect whose callee head is
 * `expectedHead`, sitting in the gap after `anchor`. Only editor gap sleeps
 * (`<root>.waitForTimeout`) and awaited effect calls may lie between; the scan
 * stops at the first ordinary statement so a call further down the body is
 * never mistaken for the placement. Null when no such placement is there.
 */
function findPlacedEffect(
  ctx: CodemodContext,
  anchor: TS.Statement,
  root: string,
  expectedHead: string
): PlacedEffect | null {
  let sleepStatement: TS.Statement | null = null
  for (const statement of statementsAfter(ctx, anchor)) {
    if (waitForTimeoutArg(ctx, statement, root) !== null) {
      sleepStatement = statement
      continue
    }
    const head = awaitedCallHead(ctx, statement)
    if (head === null) return null // an ordinary statement ends the gap region
    if (head === expectedHead)
      return { callStatement: statement, sleepStatement }
    sleepStatement = null // a different effect call: its own sleep, not ours
  }
  return null
}

/**
 * Find the codemod-authored BEFORE-anchor placement of the effect whose
 * callee head is `expectedHead`: the awaited effect calls sitting immediately
 * before `anchor` (nearest first, with editor gap sleeps allowed in between).
 * The scan stops at the first ordinary statement, mirroring
 * {@link findPlacedEffect} for the delayed-placement region.
 */
function findPlacedEffectBefore(
  ctx: CodemodContext,
  anchor: TS.Statement,
  root: string | null,
  expectedHead: string
): TS.Statement | null {
  for (const statement of statementsBefore(ctx, anchor)) {
    if (root !== null && waitForTimeoutArg(ctx, statement, root) !== null) {
      continue
    }
    const head = awaitedCallHead(ctx, statement)
    if (head === null) return null // an ordinary statement ends the region
    if (head === expectedHead) return statement
  }
  return null
}

/**
 * Edits that remove a stale AFTER-anchor placement of the effect `head` when
 * its edit switched to a delayed (before-anchor) placement, re-coalescing the
 * split gap sleep like {@link removeEffectAfter} so no ghost pause is left.
 * Empty when there is nothing to remove.
 */
function removeStalePlacedEffectAfter(
  ctx: CodemodContext,
  anchor: TS.Statement,
  root: string | null,
  head: string
): TextEdit[] {
  if (root === null) return []
  const placed = findPlacedEffect(ctx, anchor, root, head)
  if (placed === null) return []
  const edits: TextEdit[] = [removeFullLine(ctx, placed.callStatement)]
  const sleepArg =
    placed.sleepStatement !== null
      ? waitForTimeoutArg(ctx, placed.sleepStatement, root)
      : null
  if (placed.sleepStatement !== null && sleepArg !== null) {
    const after = nextStatement(ctx, placed.callStatement)
    const remainderArg =
      after !== null ? waitForTimeoutArg(ctx, after, root) : null
    if (remainderArg !== null) {
      // Merge the split back into a single gap sleep.
      edits.push({
        start: remainderArg.getStart(),
        end: remainderArg.getEnd(),
        replacement: String(Number(sleepArg.text) + Number(remainderArg.text)),
      })
      edits.push(removeFullLine(ctx, placed.sleepStatement))
    }
  }
  return edits
}

/**
 * Place `callCode` immediately BEFORE the action `afterEditId`: the delayed
 * placement form, where the call carries a `{ delay }` option instead of a
 * preceding gap sleep. Idempotent: an existing before-anchor placement of the
 * same effect (matched by callee `head`) is updated in place. A stale
 * after-anchor placement of the same effect is removed, so switching an edit
 * between sleep and delay placement never leaves two copies. Returns null
 * when the site is locked.
 */
function insertBeforeAnchor(
  ctx: CodemodContext,
  afterEditId: string,
  callCode: string,
  head: string,
  importName?: string
): ComputeResult {
  const call = isLinearCallSite(ctx, afterEditId)
  if (call === null) return null
  const statement = enclosingStatement(ctx, call)
  if (statement === null) return null
  const root = chainRootIdentifier(ctx.ts, call.expression)
  const edits: TextEdit[] = []
  if (importName !== undefined) {
    const ensured = ensureNamedImport(ctx, 'screenci', importName)
    if (ensured === null) return unresolvedImport(importName)
    edits.push(...ensured.edits)
    if (ensured.localName !== importName) {
      // The export is already imported under an alias: reuse it.
      callCode = callCode.replace(`${importName}(`, `${ensured.localName}(`)
      if (head === importName) head = ensured.localName
    }
  }
  const placed = findPlacedEffectBefore(ctx, statement, root, head)
  if (placed !== null) {
    if (placed.getText() !== callCode) {
      edits.push({
        start: placed.getStart(),
        end: placed.getEnd(),
        replacement: callCode,
      })
    }
    return edits
  }
  edits.push(...removeStalePlacedEffectAfter(ctx, statement, root, head))
  edits.push(insertStatementBefore(ctx, statement, callCode))
  return edits
}

/** Refusal for an effect function that cannot be imported in this file. */
function unresolvedImport(importName: string): Refusal {
  return {
    reason: 'unresolved-import',
    message:
      `the function '${importName}' needs a named import from 'screenci' ` +
      `in this file (namespace imports and re-export wrappers cannot be ` +
      `edited mechanically)`,
  }
}

/**
 * The local name to match an effect export against in this file: an existing
 * import alias when present, else the canonical export name.
 */
function localEffectName(ctx: CodemodContext, importName: string): string {
  return resolveImportedLocalName(ctx, 'screenci', importName) ?? importName
}

/**
 * Edits that remove a codemod-authored delayed effect placed BEFORE
 * `afterEditId` whose callee head is `head`. Returns [] when the effect is
 * already gone (idempotent), null when the site is locked.
 */
function removeEffectBefore(
  ctx: CodemodContext,
  afterEditId: string,
  head: string
): TextEdit[] | null {
  const call = isLinearCallSite(ctx, afterEditId)
  if (call === null) return null
  const statement = enclosingStatement(ctx, call)
  if (statement === null) return null
  const root = chainRootIdentifier(ctx.ts, call.expression)
  const placed = findPlacedEffectBefore(ctx, statement, root, head)
  if (placed === null) return []
  return [removeFullLine(ctx, placed)]
}

/**
 * Edits that make the editor-placed sleep before `placed.callStatement` equal
 * `sleep` ms: update the existing sleep literal, insert one when missing, or
 * remove it when `sleep` is 0. Same-value re-syncs produce no edit (idempotent).
 */
function reconcileSleepBefore(
  ctx: CodemodContext,
  placed: PlacedEffect,
  sleep: number,
  root: string
): TextEdit[] {
  const sleepStatement = placed.sleepStatement
  const arg =
    sleepStatement !== null
      ? waitForTimeoutArg(ctx, sleepStatement, root)
      : null
  if (sleep > 0) {
    if (arg !== null) {
      return Number(arg.text) === sleep
        ? []
        : [
            {
              start: arg.getStart(),
              end: arg.getEnd(),
              replacement: String(sleep),
            },
          ]
    }
    // Insert a fresh sleep line before the call (at the call's line start so it
    // never overlaps a same-position call-text replacement).
    const start = placed.callStatement.getStart()
    const lineStart = ctx.source.lastIndexOf('\n', start - 1) + 1
    const indent = ctx.source.slice(lineStart, start)
    return [
      {
        start: lineStart,
        end: lineStart,
        replacement: `${indent}await ${root}.waitForTimeout(${sleep})\n`,
      },
    ]
  }
  return sleepStatement !== null ? [removeFullLine(ctx, sleepStatement)] : []
}

/**
 * Place `callCode` in the gap after the action `afterEditId`, preceded by a
 * `waitForTimeout(sleepMs)` gap. Idempotent: when a previous sync already
 * placed this same effect (matched by its callee `head`), update that call and
 * its editor sleep in place instead of stacking a second copy. On a fresh
 * placement it splits an existing sleep in the gap (so the item lands inside
 * it), otherwise inserts a new sleep. Returns null when the site is locked
 * (control flow / ambiguous) or the call needs an import the file cannot take.
 */
function insertInGapAfter(
  ctx: CodemodContext,
  afterEditId: string,
  callCode: string,
  sleepMs: number,
  head: string,
  importName?: string
): ComputeResult {
  const call = isLinearCallSite(ctx, afterEditId)
  if (call === null) return null
  const statement = enclosingStatement(ctx, call)
  if (statement === null) return null
  const root = chainRootIdentifier(ctx.ts, call.expression)
  const edits: TextEdit[] = []
  if (importName !== undefined) {
    const ensured = ensureNamedImport(ctx, 'screenci', importName)
    if (ensured === null) return unresolvedImport(importName)
    edits.push(...ensured.edits)
    if (ensured.localName !== importName) {
      // The export is already imported under an alias: reuse it.
      callCode = callCode.replace(`${importName}(`, `${ensured.localName}(`)
      if (head === importName) head = ensured.localName
    }
  }
  const sleep = Math.max(0, Math.round(sleepMs))

  // Idempotent re-sync: reuse an existing placement of this effect.
  if (root !== null) {
    const placed = findPlacedEffect(ctx, statement, root, head)
    if (placed !== null) {
      if (placed.callStatement.getText() !== callCode) {
        edits.push({
          start: placed.callStatement.getStart(),
          end: placed.callStatement.getEnd(),
          replacement: callCode,
        })
      }
      edits.push(...reconcileSleepBefore(ctx, placed, sleep, root))
      return edits
    }
  }

  // A stale delayed (before-anchor) placement of this effect means the edit
  // switched back to sleep placement: remove it before placing fresh.
  const placedBefore = findPlacedEffectBefore(ctx, statement, root, head)
  if (placedBefore !== null) edits.push(removeFullLine(ctx, placedBefore))

  // Fresh placement.
  if (sleep === 0) {
    edits.push(insertStatementsAfter(ctx, statement, [callCode]))
    return edits
  }
  if (root === null) return null
  const next = nextStatement(ctx, statement)
  const nextArg = next !== null ? waitForTimeoutArg(ctx, next, root) : null
  if (nextArg !== null && Number(nextArg.text) >= sleep) {
    // Split the existing gap: shrink it to `sleep`, then place the call and the
    // remainder sleep after it.
    const split = splitWaitEdit(ctx, nextArg, sleep, root)
    edits.push(split.shrink)
    edits.push(
      insertStatementsAfter(ctx, next!, [callCode, split.remainderCode])
    )
    return edits
  }
  edits.push(
    insertStatementsAfter(ctx, statement, [
      `await ${root}.waitForTimeout(${sleep})`,
      callCode,
    ])
  )
  return edits
}

/**
 * Edits that remove a codemod-authored effect placed after `afterEditId` whose
 * callee head is `head`, re-coalescing the split gap. Safe deletion signal: the
 * effect is present in code adjacent to the editId and its edit record was
 * removed (a disabled edit still names the editId, kind and `sleepBeforeMs`).
 * The editor-placed sleep is only reclaimed when its ms matches `sleepBeforeMs`
 * (the user asked to verify via the sleep time); a hand-edited sleep is left
 * alone. Returns [] when the effect is already gone (idempotent), null when the
 * site is locked.
 */
function removeEffectAfter(
  ctx: CodemodContext,
  afterEditId: string,
  head: string,
  sleepBeforeMs: number
): TextEdit[] | null {
  const call = isLinearCallSite(ctx, afterEditId)
  if (call === null) return null
  const statement = enclosingStatement(ctx, call)
  if (statement === null) return null
  const root = chainRootIdentifier(ctx.ts, call.expression)
  if (root === null) return null
  const placed = findPlacedEffect(ctx, statement, root, head)
  if (placed === null) return [] // nothing to remove: already reconciled
  const edits: TextEdit[] = [removeFullLine(ctx, placed.callStatement)]
  const expected = Math.max(0, Math.round(sleepBeforeMs))
  const sleepArg =
    placed.sleepStatement !== null
      ? waitForTimeoutArg(ctx, placed.sleepStatement, root)
      : null
  // Only reclaim the editor sleep when its ms matches what the edit placed.
  if (
    placed.sleepStatement !== null &&
    sleepArg !== null &&
    Number(sleepArg.text) === expected
  ) {
    const after = nextStatement(ctx, placed.callStatement)
    const remainderArg =
      after !== null ? waitForTimeoutArg(ctx, after, root) : null
    if (remainderArg !== null) {
      // Merge the split back into a single gap: sleepBefore + remainder.
      edits.push({
        start: remainderArg.getStart(),
        end: remainderArg.getEnd(),
        replacement: String(expected + Number(remainderArg.text)),
      })
    }
    edits.push(removeFullLine(ctx, placed.sleepStatement))
  }
  return edits
}

/**
 * Edits that reconcile the `{ delay }` option on an existing wrap call whose
 * callback body is `body`: update the numeric value when it changed, or
 * append the options argument when `delayMs` is set and the wrap has none.
 * A wrap without the option is left alone when `delayMs` is unset (removing a
 * possibly hand-authored option is not worth the risk). Empty when in sync.
 */
function updateWrapDelayOption(
  ctx: CodemodContext,
  body: TS.Block,
  delayMs: number | undefined
): TextEdit[] {
  const { ts } = ctx
  const arrow = body.parent
  if (!ts.isArrowFunction(arrow) && !ts.isFunctionExpression(arrow)) return []
  const call = arrow.parent
  if (!ts.isCallExpression(call)) return []
  const arrowIndex = call.arguments.findIndex((arg) => arg === arrow)
  if (arrowIndex < 0) return []
  const optionsArg = call.arguments[arrowIndex + 1]
  if (optionsArg !== undefined && ts.isObjectLiteralExpression(optionsArg)) {
    for (const prop of optionsArg.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === 'delay' &&
        ts.isNumericLiteral(prop.initializer)
      ) {
        if (delayMs === undefined) return []
        const rounded = Math.round(delayMs)
        if (Number(prop.initializer.text) === rounded) return []
        return [
          {
            start: prop.initializer.getStart(),
            end: prop.initializer.getEnd(),
            replacement: String(rounded),
          },
        ]
      }
    }
    return []
  }
  if (optionsArg !== undefined || delayMs === undefined) return []
  const end = arrow.getEnd()
  return [
    {
      start: end,
      end,
      replacement: `, ${valueToSource({ delay: Math.round(delayMs) })!}`,
    },
  ]
}

/** Wrap the interaction run `fromEditId..untilEditId` in a block call. */
function wrapRun(
  ctx: CodemodContext,
  fromEditId: string,
  untilEditId: string,
  header: string,
  leadMs: number | undefined,
  trailMs: number | undefined,
  footerClose?: string,
  importName?: string,
  delayMs?: number
): ComputeResult {
  const fromCall = isLinearCallSite(ctx, fromEditId)
  const untilCall = isLinearCallSite(ctx, untilEditId)
  if (fromCall === null || untilCall === null) return null
  const fromStmt = enclosingStatement(ctx, fromCall)
  const untilStmt = enclosingStatement(ctx, untilCall)
  if (fromStmt === null || untilStmt === null) return null
  const root = chainRootIdentifier(ctx.ts, fromCall.expression)
  const localName =
    importName !== undefined ? localEffectName(ctx, importName) : undefined

  // Idempotent re-sync: when the run is already inside the wrap this edit would
  // create (same block for both ends), do not wrap again. Update the lead/trail
  // gap sleeps in place when they changed; otherwise it is a no-op.
  if (importName !== undefined && localName !== undefined) {
    const fromBody = enclosingWrapBody(ctx, fromCall, localName)
    const untilBody = enclosingWrapBody(ctx, untilCall, localName)
    if (fromBody !== null && fromBody === untilBody) {
      const edits: TextEdit[] = []
      const body = fromBody.statements
      const first = body.length > 0 ? body[0]! : null
      const last = body.length > 0 ? body[body.length - 1]! : null
      const updateSleep = (
        stmt: TS.Statement | null,
        ms: number | undefined,
        boundary: TS.Statement
      ): void => {
        if (stmt === null || root === null) return
        // Only touch a sleep that is the codemod's lead/trail: a
        // `waitForTimeout` at the very edge of the block, outside the run.
        if (stmt === boundary) return
        const arg = waitForTimeoutArg(ctx, stmt, root)
        if (arg === null || ms === undefined || ms <= 0) return
        const rounded = Math.round(ms)
        if (Number(arg.text) !== rounded) {
          edits.push({
            start: arg.getStart(),
            end: arg.getEnd(),
            replacement: String(rounded),
          })
        }
      }
      updateSleep(first, leadMs, fromStmt)
      updateSleep(last, trailMs, untilStmt)
      edits.push(...updateWrapDelayOption(ctx, fromBody, delayMs))
      return edits
    }
  }
  const lead =
    leadMs !== undefined && leadMs > 0 && root !== null
      ? `await ${root}.waitForTimeout(${Math.round(leadMs)})`
      : undefined
  const trail =
    trailMs !== undefined && trailMs > 0 && root !== null
      ? `await ${root}.waitForTimeout(${Math.round(trailMs)})`
      : undefined
  const edits: TextEdit[] = []
  if (importName !== undefined) {
    const ensured = ensureNamedImport(ctx, 'screenci', importName)
    if (ensured === null) return unresolvedImport(importName)
    edits.push(...ensured.edits)
    if (ensured.localName !== importName) {
      // The export is already imported under an alias: wrap with the alias.
      header = header.replace(`${importName}(`, `${ensured.localName}(`)
    }
  }
  const wrap = wrapStatementsInBlock(ctx, fromStmt, untilStmt, header, {
    leadLine: lead,
    trailLine: trail,
    footerClose,
  })
  if (wrap === null) return null
  edits.push(...wrap)
  return edits
}

/** Plan the code edits for one codify record, or null when it is unappliable. */
function planCodifyEdit(edit: CodifyEdit): {
  editIds: string[]
  description: string
  compute: (ctx: CodemodContext) => ComputeResult
} | null {
  switch (edit.type) {
    case 'mediaEdit': {
      const media = mediaHeadAndCall(edit)
      if (media === null) return null
      if (edit.delayMs !== undefined && edit.blocking) return null
      return {
        editIds: [edit.afterEditId],
        description:
          edit.delayMs !== undefined
            ? `insert \`${media.callCode}\` before '${edit.afterEditId}'`
            : `insert \`${media.callCode}\` after '${edit.afterEditId}'`,
        compute: (ctx) =>
          edit.delayMs !== undefined
            ? insertBeforeAnchor(
                ctx,
                edit.afterEditId,
                media.callCode,
                media.head
              )
            : insertInGapAfter(
                ctx,
                edit.afterEditId,
                media.callCode,
                edit.sleepBeforeMs ?? 0,
                media.head
              ),
      }
    }
    case 'gapPointEdit': {
      const point = gapPointCode(edit)
      if (point === null) return null
      return {
        editIds: [edit.afterEditId],
        description:
          edit.delayMs !== undefined
            ? `insert \`${point.code}\` before '${edit.afterEditId}'`
            : `insert \`${point.code}\` after '${edit.afterEditId}'`,
        compute: (ctx) =>
          edit.delayMs !== undefined
            ? insertBeforeAnchor(
                ctx,
                edit.afterEditId,
                point.code,
                point.importName,
                point.importName
              )
            : insertInGapAfter(
                ctx,
                edit.afterEditId,
                point.code,
                edit.sleepBeforeMs ?? 0,
                point.importName,
                point.importName
              ),
      }
    }
    case 'zoomEdit': {
      const zoom = edit as ZoomEdit
      const props = zoom.props ?? {}
      const optionFields: Record<string, unknown> = {}
      for (const key of ['amount', 'duration', 'easing', 'centering']) {
        if (props[key] !== undefined) optionFields[key] = props[key]
      }
      const optionSource =
        Object.keys(optionFields).length > 0
          ? valueToSource(optionFields)
          : null
      const footerClose =
        optionSource !== null ? `}, ${optionSource})` : undefined
      return {
        editIds: [zoom.fromEditId, zoom.untilEditId],
        description: `wrap '${zoom.fromEditId}'..'${zoom.untilEditId}' in autoZoom`,
        compute: (ctx) =>
          wrapRun(
            ctx,
            zoom.fromEditId,
            zoom.untilEditId,
            'await autoZoom(async () => {',
            zoom.leadInMs,
            zoom.holdMs,
            footerClose,
            'autoZoom'
          ),
      }
    }
    case 'gapSpanEdit': {
      const span = edit as GapSpanEdit
      const props = span.props ?? {}
      let header: string
      if (span.kind === 'hide') {
        header = 'await hide(async () => {'
      } else if (span.kind === 'speed') {
        const multiplier =
          typeof props.multiplier === 'number' && props.multiplier > 0
            ? props.multiplier
            : 2
        header = `await speed(${multiplier}, async () => {`
      } else {
        const durationMs =
          typeof props.durationMs === 'number' ? props.durationMs : null
        if (durationMs === null || durationMs < 0) return null
        header = `await time(${Math.round(durationMs)}, async () => {`
      }
      // A delayed span opens with `{ delay }` on the wrapper call: the start
      // stamp lands inside the `fromEditId` interaction (validation rules out
      // a positive fromSleepMs alongside).
      const footerClose =
        span.delayMs !== undefined
          ? `}, ${valueToSource({ delay: Math.round(span.delayMs) })!})`
          : undefined
      // A lead-hide (start pulled before `fromEditId`) emits the same leading
      // `waitForTimeout` as a forward `fromSleepMs`: the block opens with a
      // wait, then the run executes. Only `fromLeadMs` reaches codegen; the
      // end-side `untilLeadMs` lives only on editor-only bare splits.
      const leadMs = span.fromLeadMs ?? span.fromSleepMs
      return {
        editIds: [span.fromEditId, span.untilEditId],
        description: `wrap '${span.fromEditId}'..'${span.untilEditId}' in ${span.kind}`,
        compute: (ctx) =>
          wrapRun(
            ctx,
            span.fromEditId,
            span.untilEditId,
            header,
            leadMs,
            span.untilSleepMs,
            footerClose,
            span.kind,
            span.delayMs
          ),
      }
    }
    case 'blockRemoveEdit': {
      return {
        editIds: [edit.target.editId],
        description: `unwrap block '${edit.target.editId}'`,
        compute: (ctx) => unwrapBlockCall(ctx, edit.target.editId),
      }
    }
    default: {
      const exhaustive: never = edit
      void exhaustive
      return null
    }
  }
}

/**
 * True for a bare split marker: a zero-width hide the editor uses to cut the
 * recording filmstrip without removing footage. It stays editor-only state
 * (never codified): syncing `await hide(async () => {})` would add noise for
 * no output change, and the split remains editable in the web editor.
 */
function isBareSplit(edit: CodifyEdit): boolean {
  return (
    edit.type === 'gapSpanEdit' &&
    edit.kind === 'hide' &&
    edit.fromEditId === edit.untilEditId &&
    edit.delayMs === undefined &&
    // A lead split (placed left of the first interaction) is bare when both
    // boundaries pull back by the same lead; a forward split when both sleeps
    // match. The two modes never mix on a bare split.
    (edit.fromLeadMs ?? 0) === (edit.untilLeadMs ?? 0) &&
    (edit.fromSleepMs ?? 0) === (edit.untilSleepMs ?? 0)
  )
}

/**
 * Plan the removal of a removed (disabled) codify record, or null when the kind
 * cannot be removed with high confidence. Point effects are removed directly:
 * their call is unambiguous (a single `narration.`/`overlays.`/`audio.` cue or
 * a known point function) and adjacent to the editId. Wrap edits
 * (zoom/hide/speed/time) are unwrapped when the wrap is recognisably
 * editor-owned: an ANONYMOUS `autoZoom`/`hide`/`speed`/`time` wrap directly
 * enclosing both anchor calls (the same identification the wrap reconciler
 * uses). The inner statements and pacing sleeps survive, dedented one level.
 * A NAMED block (`hide('name', ...)`) is user-authored and is never touched
 * here; removing one takes an explicit blockRemoveEdit.
 */
function plannedRemoval(edit: CodifyEdit): {
  editIds: string[]
  description: string
  compute: (ctx: CodemodContext) => ComputeResult
} | null {
  if (edit.type === 'mediaEdit') {
    const media = mediaHeadAndCall(edit)
    if (media === null) return null
    if (edit.delayMs !== undefined) {
      return {
        editIds: [edit.afterEditId],
        description: `remove \`${media.callCode}\` before '${edit.afterEditId}'`,
        compute: (ctx) => removeEffectBefore(ctx, edit.afterEditId, media.head),
      }
    }
    return {
      editIds: [edit.afterEditId],
      description: `remove \`${media.callCode}\` after '${edit.afterEditId}'`,
      compute: (ctx) =>
        removeEffectAfter(
          ctx,
          edit.afterEditId,
          media.head,
          edit.sleepBeforeMs ?? 0
        ),
    }
  }
  if (edit.type === 'gapPointEdit') {
    const point = gapPointCode(edit)
    if (point === null) return null
    if (edit.delayMs !== undefined) {
      return {
        editIds: [edit.afterEditId],
        description: `remove \`${point.code}\` before '${edit.afterEditId}'`,
        compute: (ctx) =>
          removeEffectBefore(
            ctx,
            edit.afterEditId,
            localEffectName(ctx, point.importName)
          ),
      }
    }
    return {
      editIds: [edit.afterEditId],
      description: `remove \`${point.code}\` after '${edit.afterEditId}'`,
      compute: (ctx) =>
        removeEffectAfter(
          ctx,
          edit.afterEditId,
          localEffectName(ctx, point.importName),
          edit.sleepBeforeMs ?? 0
        ),
    }
  }
  if (edit.type === 'zoomEdit' || edit.type === 'gapSpanEdit') {
    if (isBareSplit(edit)) return null // editor-only marker: nothing in code
    const importName = edit.type === 'zoomEdit' ? 'autoZoom' : edit.kind
    const { fromEditId, untilEditId } = edit
    return {
      editIds: [fromEditId, untilEditId],
      description:
        `unwrap stale ${importName} around ` +
        `'${fromEditId}'..'${untilEditId}'`,
      compute: (ctx) => {
        const { ts } = ctx
        const localName = localEffectName(ctx, importName)
        const fromCall = findCallByEditId(ctx, fromEditId)
        const untilCall = findCallByEditId(ctx, untilEditId)
        if (fromCall === null || untilCall === null) return null
        // Editor-owned identification, same as the wrap reconciler: BOTH
        // anchors sit directly inside one wrap callback of this kind.
        const fromBody = enclosingWrapBody(ctx, fromCall, localName)
        const untilBody = enclosingWrapBody(ctx, untilCall, localName)
        if (fromBody === null || fromBody !== untilBody) {
          return [] // no such wrap: already reconciled (idempotent)
        }
        const arrow = fromBody.parent
        if (!ts.isArrowFunction(arrow) && !ts.isFunctionExpression(arrow)) {
          return null
        }
        const wrapCall = arrow.parent
        if (!ts.isCallExpression(wrapCall)) return null
        // A NAMED block is user-authored: leave it alone.
        if (wrapCall.arguments.some((arg) => ts.isStringLiteral(arg))) {
          return []
        }
        return unwrapWrapCallStatement(ctx, wrapCall, fromBody)
      },
    }
  }
  if (edit.type === 'blockRemoveEdit') {
    return null // removing a block-removal record: nothing to reconcile
  }
  const exhaustive: never = edit
  void exhaustive
  return null
}

export function planCodeSync(
  input: CodeSyncInput,
  deps: CodeSyncDeps
): CodeSyncPlan {
  const texts = new Map<string, string>()
  const originals = new Map<string, string>()
  const applied: AppliedItem[] = []
  const unappliable: UnappliableItem[] = []
  const appliedCounts = new Map<string, number>()
  const unappliableCounts = new Map<string, number>()

  const bump = (map: Map<string, number>, video: string): void => {
    map.set(video, (map.get(video) ?? 0) + 1)
  }
  const getText = (file: string): string | null => {
    if (!texts.has(file)) {
      const content = deps.readFile(file)
      if (content === null) return null
      texts.set(file, content)
      originals.set(file, content)
    }
    return texts.get(file)!
  }
  /** Classify a null compute result from the editIds it targeted. */
  const classifyRefusal = (ctx: CodemodContext, editIds: string[]): Refusal => {
    for (const editId of editIds) {
      const site = classifyEditIdSite(ctx, editId)
      if (site === 'missing') {
        return {
          reason: 'unknown-edit-id',
          message: `editId '${editId}' was not found in the source file`,
        }
      }
      if (site === 'ambiguous') {
        return {
          reason: 'ambiguous-edit-id',
          message: `editId '${editId}' appears more than once in the file`,
        }
      }
      if (site === 'control-flow') {
        return {
          reason: 'inside-control-flow',
          message: `editId '${editId}' sits inside a loop, branch, or ternary`,
        }
      }
    }
    return {
      reason: 'unsupported-shape',
      message:
        'the call site resists a mechanical edit ' +
        '(non-literal options, spreads, or unexpected structure)',
    }
  }
  /**
   * Compute and apply one item's edits against the file's current text.
   * Returns null on success, else the typed refusal (a null compute result is
   * classified from the editIds it targeted).
   */
  const tryApply = (
    file: string,
    compute: (ctx: CodemodContext) => ComputeResult,
    editIds: string[] = []
  ): Refusal | null => {
    const text = getText(file)
    if (text === null) {
      return {
        reason: 'unsupported-shape',
        message: `the source file '${file}' could not be read`,
      }
    }
    const ctx = createContext(deps.ts, file, text)
    const result = compute(ctx)
    if (isRefusal(result)) return result
    if (result === null) return classifyRefusal(ctx, editIds)
    if (result.length > 0) texts.set(file, applyTextEdits(text, result))
    return null
  }

  const videoNames = [
    ...new Set([
      ...input.comparison.videos.map((video) => video.videoName),
      ...Object.keys(input.editableOverrides),
      ...Object.keys(input.codifyEdits),
      ...Object.keys(input.removedCodifyEdits),
      ...Object.keys(input.renames),
      ...Object.keys(input.overlayDeclEdits ?? {}),
      ...Object.keys(input.editorOptionsSync?.videos ?? {}),
      ...Object.keys(input.narrationEdits ?? {}),
      ...Object.keys(input.valuesEdits ?? {}),
      ...Object.keys(input.languagesEdits ?? {}),
      ...Object.keys(input.editorMediaEdits ?? {}),
    ]),
  ]

  // Every source file named across the whole editable snapshot: the fallback
  // search space for a studio video that has no editable entries of its own.
  const allSnapshotFiles = [
    ...new Set(
      Object.values(input.editableSnapshot.videos)
        .flat()
        .map((entry) => entry.source?.file)
        .filter((file): file is string => file !== undefined)
    ),
  ]

  for (const videoName of videoNames) {
    const entries = input.editableSnapshot.videos[videoName] ?? []
    const byKey = new Map(entries.map((entry) => [entry.key, entry]))
    const candidateFiles = [
      ...new Set(
        entries
          .map((entry) => entry.source?.file)
          .filter((file): file is string => file !== undefined)
      ),
    ]
    const markUnappliable = (
      reason: UnappliableReason,
      message: string
    ): void => {
      unappliable.push({ videoName, reason, message })
      bump(unappliableCounts, videoName)
    }
    /** Refusal for an editId that no single candidate file contains. */
    const missingEditIdRefusal = (editIds: string[]): Refusal => ({
      reason: 'unknown-edit-id',
      message:
        editIds.length === 1
          ? `editId '${editIds[0]}' was not found in exactly one source file`
          : `editIds ${editIds.map((id) => `'${id}'`).join(', ')} were not ` +
            `found together in exactly one source file`,
    })

    /** The single candidate file whose text contains the editId slug. */
    const fileWithEditId = (editId: string): string | null => {
      const needle = `'${editId}'`
      const holders = candidateFiles.filter((file) => {
        const text = getText(file)
        return text !== null && text.includes(needle)
      })
      return holders.length === 1 ? holders[0]! : null
    }
    /** The single file that contains every editId in the set. */
    const fileWithAllEditIds = (editIds: string[]): string | null => {
      const files = editIds.map((editId) => fileWithEditId(editId))
      const first = files[0]
      if (first === null || first === undefined) return null
      return files.every((file) => file === first) ? first : null
    }
    const applySlugItem = (item: SlugItem): void => {
      const file = fileWithEditId(item.editId)
      const refusal =
        file === null
          ? missingEditIdRefusal([item.editId])
          : tryApply(file, item.compute, [item.editId])
      if (refusal === null) {
        applied.push({
          videoName: item.videoName,
          file: file!,
          description: item.description,
        })
        bump(appliedCounts, item.videoName)
      } else {
        item.onUnappliable(refusal)
      }
    }

    // ── Timeline param edits (sleepBefore, autoZoom offsets) ───────────────
    for (const override of input.editableOverrides[videoName] ?? []) {
      const entry = byKey.get(override.key)
      const editId = entry?.editId

      // Recorded delay (waitForTimeout): durationMs rewrites the numeric arg in
      // place (or removes the whole call at 0). The wait has no editId of its
      // own, so it is located via a stamped neighbor action. Dragging an
      // interaction along the timeline commits durationMs on the adjacent delay,
      // which is how a move re-expresses as resizing the neighboring sleep.
      if (entry?.schemaKind === 'delay') {
        const value = override.values.durationMs
        if (
          typeof value === 'number' &&
          !jsonEqual(entry.defaults.durationMs, value)
        ) {
          const ms = Math.round(value)
          const anchor = resolveDelayAnchor(entries, override.key)
          if (anchor === null) {
            markUnappliable(
              'unstamped-action',
              `delay durationMs on '${override.key}': no adjacent stamped ` +
                `action to locate the waitForTimeout call`
            )
          } else {
            applySlugItem({
              videoName,
              editId: anchor.anchorEditId,
              description:
                ms === 0
                  ? `remove waitForTimeout near '${anchor.anchorEditId}'`
                  : `set waitForTimeout to ${ms}ms near '${anchor.anchorEditId}'`,
              onUnappliable: (refusal) =>
                markUnappliable(
                  refusal.reason,
                  `delay durationMs on '${override.key}': ${refusal.message}`
                ),
              compute: (ctx) => {
                const literal = findRecordedWait(
                  ctx,
                  anchor.anchorEditId,
                  anchor.direction
                )
                if (literal === null) {
                  return {
                    reason: 'unsupported-shape',
                    message:
                      `the recorded waitForTimeout adjacent to ` +
                      `'${anchor.anchorEditId}' was not found (source drifted)`,
                  }
                }
                if (ms === 0) {
                  const statement = enclosingStatement(ctx, literal)
                  return statement === null
                    ? null
                    : [removeFullLine(ctx, statement)]
                }
                return [
                  {
                    start: literal.getStart(),
                    end: literal.getEnd(),
                    replacement: String(ms),
                  },
                ]
              },
            })
          }
        }
        continue
      }

      // No editId (unstamped action or a `slug#N` loop repeat execution):
      // never guess at a call site; the section is locked.
      if (editId === undefined || override.key.includes('#')) {
        for (const [field, value] of Object.entries(override.values)) {
          if (value === undefined) continue
          if (entry !== undefined && jsonEqual(entry.defaults[field], value)) {
            continue
          }
          if (override.key.includes('#')) {
            markUnappliable(
              'loop-repeat',
              `locked param edit '${override.key}' ${field}: the action is ` +
                `a loop repeat execution and has no call site of its own`
            )
          } else {
            markUnappliable(
              'unstamped-action',
              `locked param edit '${override.key}' ${field}: the action ` +
                `carries no editId yet`
            )
          }
        }
        continue
      }
      for (const [field, value] of Object.entries(override.values)) {
        if (value === undefined) continue
        if (jsonEqual(entry!.defaults[field], value)) {
          continue // in sync, nothing to do
        }
        if (field === 'sleepBefore' && typeof value === 'number' && value > 0) {
          const ms = Math.round(value)
          applySlugItem({
            videoName,
            editId,
            description: `insert await <page>.waitForTimeout(${ms}) before '${editId}'`,
            onUnappliable: (refusal) =>
              markUnappliable(
                refusal.reason,
                `locked sleepBefore on '${editId}': ${refusal.message}`
              ),
            compute: (ctx) => {
              const call = findCallByEditId(ctx, editId)
              if (call === null) return null
              if (!ctx.ts.isPropertyAccessExpression(call.expression)) {
                return null
              }
              // waitForTimeout must sit on the page, not the action receiver:
              // an action on a stored locator (`sliderThumb.dragTo(...)`) has a
              // locator chain root, so resolve it back to the page identifier.
              const root = resolvePageIdentifier(
                ctx.ts,
                ctx.sourceFile,
                call.expression.expression
              )
              if (root === null) return null
              const statement = enclosingStatement(ctx, call)
              if (statement === null) return null
              const existing = existingWaitBefore(ctx, statement, root)
              if (existing !== null) {
                return [
                  {
                    start: existing.getStart(),
                    end: existing.getEnd(),
                    replacement: String(ms),
                  },
                ]
              }
              return [
                insertStatementBefore(
                  ctx,
                  statement,
                  `await ${root}.waitForTimeout(${ms})`
                ),
              ]
            },
          })
          continue
        }
        const optionPath = CURSOR_MOVE_OPTION_PATHS[field]
        if (optionPath !== undefined) {
          applySlugItem({
            videoName,
            editId,
            description: `set ${optionPath} = ${JSON.stringify(value)} on '${editId}'`,
            onUnappliable: (refusal) =>
              markUnappliable(
                refusal.reason,
                `locked param edit '${editId}' ${field}: ${refusal.message}`
              ),
            compute: (ctx) => {
              const call = findCallByEditId(ctx, editId)
              if (call === null) return null
              if (!ctx.ts.isPropertyAccessExpression(call.expression)) {
                return null
              }
              const method = call.expression.name.text
              const optionsIndex = (
                OPTIONS_ARG_INDEX as Record<string, number | undefined>
              )[method]
              if (optionsIndex === undefined) return null
              const edits: TextEdit[] = []
              // Duration and speed are mutually exclusive: writing one drops
              // any explicit sibling so the call never carries both.
              const siblingPath = EXCLUSIVE_OPTION_SIBLINGS[field]
              if (siblingPath !== undefined) {
                const removal = removeOption(
                  ctx,
                  call,
                  optionsIndex,
                  siblingPath.split('.')
                )
                if (removal !== null) edits.push(removal)
              }
              const edit = setOptionValue(
                ctx,
                call,
                optionsIndex,
                optionPath.split('.'),
                value
              )
              if (edit === null) return null
              if (edits.some((other) => editsOverlap(other, edit))) {
                // The sibling removal collapses the object the set edit
                // targets; too entangled for a mechanical edit.
                return null
              }
              edits.push(edit)
              return edits
            },
          })
          continue
        }
        markUnappliable(
          'unsupported-field',
          `unsupported param field '${field}' on '${editId}'`
        )
      }
    }

    // ── Codify edits (media / zoom / gap span / gap point) ─────────────────
    // Same-anchor delayed placements must land in ascending-delay code order
    // (each insert goes immediately before its anchor, so a later-processed
    // edit sits closer to the anchor = later in code = must carry the larger
    // delay). Stable sort: everything else keeps its doc order.
    const codifyEdits = [...(input.codifyEdits[videoName] ?? [])].sort(
      (a, b) => {
        if (
          'afterEditId' in a &&
          'afterEditId' in b &&
          a.afterEditId === b.afterEditId &&
          a.delayMs !== undefined &&
          b.delayMs !== undefined
        ) {
          return a.delayMs - b.delayMs
        }
        return 0
      }
    )
    for (const edit of codifyEdits) {
      // Bare split markers are editor-only: skipped without counting, so the
      // video is not marked fully applied (the split survives in the editor).
      if (isBareSplit(edit)) continue
      const planned = planCodifyEdit(edit)
      if (planned === null) {
        markUnappliable(
          'invalid-edit',
          `unappliable ${edit.type} '${edit.id}': the edit record is ` +
            `incomplete or invalid`
        )
        continue
      }
      const file = fileWithAllEditIds(planned.editIds)
      const refusal =
        file === null
          ? missingEditIdRefusal(planned.editIds)
          : tryApply(file, planned.compute, planned.editIds)
      if (refusal === null) {
        applied.push({
          videoName,
          file: file!,
          description: planned.description,
        })
        bump(appliedCounts, videoName)
      } else {
        markUnappliable(
          refusal.reason,
          `locked ${edit.type} '${edit.id}': ${refusal.message}`
        )
      }
    }

    // ── Ghost cleanup: removed (disabled) codify effects ───────────────────
    // Runs after the inserts above so a place-then-remove round trip nets out.
    for (const edit of input.removedCodifyEdits[videoName] ?? []) {
      const planned = plannedRemoval(edit)
      if (planned === null) continue // nothing in code to reconcile
      const file = fileWithAllEditIds(planned.editIds)
      const refusal =
        file === null
          ? missingEditIdRefusal(planned.editIds)
          : tryApply(file, planned.compute, planned.editIds)
      if (refusal === null) {
        applied.push({
          videoName,
          file: file!,
          description: planned.description,
        })
        bump(appliedCounts, videoName)
      } else {
        markUnappliable(
          refusal.reason,
          `locked removal ${edit.type} '${edit.id}': ${refusal.message}`
        )
      }
    }

    // ── Action-parameter overrides (option values on stamped calls) ────────
    const comparisonVideo = input.comparison.videos.find(
      (video) => video.videoName === videoName
    )
    if (comparisonVideo !== undefined) {
      const records = input.actionSnapshot.videos[videoName] ?? []
      for (const assessment of comparisonVideo.overrides) {
        if (assessment.kind === 'in-sync') continue
        const record =
          assessment.kind === 'stale'
            ? undefined
            : records.find(
                (candidate) =>
                  candidate.selector === assessment.selector &&
                  candidate.method === assessment.method &&
                  candidate.occurrence === assessment.occurrence
              )
        const editId = record?.editId
        const optionsIndex =
          OPTIONS_ARG_INDEX[assessment.method as ActionMethod]
        // Stale, unstamped, or unknown method: never guess.
        if (editId === undefined || optionsIndex === undefined) {
          markUnappliable(
            'unstamped-action',
            `locked action override ${assessment.selector} ` +
              `${assessment.method}: the action is stale, unstamped, or ` +
              `uses an unknown method`
          )
          continue
        }
        const pathSegments = assessment.optionPath.split('.')
        const file = fileWithEditId(editId)
        const refusal =
          file === null
            ? missingEditIdRefusal([editId])
            : tryApply(
                file,
                (ctx) => {
                  const call = findCallByEditId(ctx, editId)
                  if (call === null) return null
                  // Sanity: the slug must sit on a call of the recorded method.
                  if (
                    !ctx.ts.isPropertyAccessExpression(call.expression) ||
                    call.expression.name.text !== assessment.method
                  ) {
                    return null
                  }
                  const edit =
                    assessment.kind === 'remove'
                      ? removeOption(ctx, call, optionsIndex, pathSegments)
                      : setOptionValue(
                          ctx,
                          call,
                          optionsIndex,
                          pathSegments,
                          assessment.editorValue
                        )
                  return edit === null ? null : [edit]
                },
                [editId]
              )
        if (refusal === null) {
          applied.push({
            videoName,
            file: file!,
            description:
              assessment.kind === 'remove'
                ? `remove ${assessment.optionPath} from '${editId}'`
                : `set ${assessment.optionPath} = ` +
                  `${JSON.stringify(assessment.editorValue)} on '${editId}'`,
          })
          bump(appliedCounts, videoName)
        } else {
          markUnappliable(
            refusal.reason,
            `locked action override on '${editId}': ${refusal.message}`
          )
        }
      }
    }

    // ── editId renames (applied last: earlier items key on the old slug) ───
    for (const rename of input.renames[videoName] ?? []) {
      if (rename.newEditId === rename.editId) continue // no-op
      const file = fileWithEditId(rename.editId)
      const refusal = !isValidEditId(rename.newEditId)
        ? {
            reason: 'invalid-edit' as const,
            message: `'${rename.newEditId}' is not a valid editId slug`,
          }
        : file === null
          ? missingEditIdRefusal([rename.editId])
          : tryApply(
              file,
              (ctx) => {
                const edit = renameEditIdInSource(
                  ctx,
                  rename.editId,
                  rename.newEditId
                )
                return edit === null ? null : [edit]
              },
              [rename.editId]
            )
      if (refusal === null) {
        applied.push({
          videoName,
          file: file!,
          description: `rename editId '${rename.editId}' -> '${rename.newEditId}'`,
        })
        bump(appliedCounts, videoName)
      } else {
        markUnappliable(
          refusal.reason,
          `locked rename '${rename.editId}' -> '${rename.newEditId}': ` +
            refusal.message
        )
      }
    }

    // Locate the single file that declares this video's builder call. Prefer
    // the video's editable source files; fall back to every source file in
    // the snapshot so a video with no editable entries can still be found.
    const declaringFile = (): string | null => {
      const searchFiles =
        candidateFiles.length > 0 ? candidateFiles : allSnapshotFiles
      const holders = searchFiles.filter((file) => {
        const text = getText(file)
        if (text === null) return false
        const ctx = createContext(deps.ts, file, text)
        return findVideoCall(ctx, videoName) !== null
      })
      return holders.length === 1 ? holders[0]! : null
    }

    // ── Overlay declaration placement edits (codify into video.overlays) ───
    const overlayDeclEdits = input.overlayDeclEdits?.[videoName] ?? []
    if (overlayDeclEdits.length > 0) {
      const file = declaringFile()
      for (const edit of overlayDeclEdits) {
        const refusal =
          file === null
            ? unknownVideoRefusal(videoName)
            : tryApply(file, (ctx) =>
                setOverlayDeclProps(
                  ctx,
                  videoName,
                  edit.overlayName,
                  edit.props
                )
              )
        if (refusal === null) {
          applied.push({
            videoName,
            file: file!,
            description:
              `set overlay '${edit.overlayName}' placement ` +
              JSON.stringify(edit.props),
          })
          bump(appliedCounts, videoName)
        } else {
          markUnappliable(
            refusal.reason,
            `locked overlay declaration '${edit.overlayName}' on video ` +
              `'${videoName}': ${refusal.message}`
          )
        }
      }
    }

    // ── Studio render/record option edits (codify into builder calls) ──────
    const editorOptionsVideo = input.editorOptionsSync?.videos[videoName]
    if (editorOptionsVideo !== undefined) {
      const file = declaringFile()
      for (const method of ['renderOptions', 'recordOptions'] as const) {
        const values = editorOptionsVideo[method]
        if (values === undefined || Object.keys(values).length === 0) continue
        const refusal =
          file === null
            ? unknownVideoRefusal(videoName)
            : tryApply(file, (ctx) =>
                setBuilderOptions(ctx, videoName, method, values)
              )
        if (refusal === null) {
          applied.push({
            videoName,
            file: file!,
            description: `codify ${method} on video '${videoName}'`,
          })
          bump(appliedCounts, videoName)
        } else {
          markUnappliable(
            refusal.reason,
            `locked ${method} on video '${videoName}': ${refusal.message}`
          )
        }
      }
    }

    // ── Narration cue value edits (codify into video.narration) ────────────
    const narrationEdits = input.narrationEdits?.[videoName] ?? []
    if (narrationEdits.length > 0) {
      const file = declaringFile()
      for (const edit of narrationEdits) {
        const refusal =
          file === null
            ? unknownVideoRefusal(videoName)
            : tryApply(file, (ctx) => {
                const result = setNarrationValue(
                  ctx,
                  videoName,
                  {
                    cueName: edit.cueName,
                    lang: edit.lang,
                    ...(edit.isDefault !== undefined && {
                      isDefault: edit.isDefault,
                    }),
                    value: edit.value,
                  },
                  isLanguageKey
                )
                if (result.kind === 'edits') return result.edits
                if (result.kind === 'appManaged') {
                  return {
                    reason: 'app-managed' as const,
                    message:
                      `narration cue '${edit.cueName}' on video ` +
                      `'${videoName}' is app-managed (names-only declaration)`,
                  }
                }
                return null
              })
        if (refusal === null) {
          applied.push({
            videoName,
            file: file!,
            description:
              `set narration cue '${edit.cueName}' (${edit.lang}) ` +
              `on video '${videoName}'`,
          })
          bump(appliedCounts, videoName)
        } else {
          markUnappliable(
            refusal.reason,
            refusal.reason === 'app-managed'
              ? refusal.message
              : `locked narration cue '${edit.cueName}' on video ` +
                  `'${videoName}': ${refusal.message}`
          )
        }
      }
    }

    // ── On-screen `values` field edits (codify into video.values) ──────────
    const valuesEdits = input.valuesEdits?.[videoName] ?? []
    if (valuesEdits.length > 0) {
      const file = declaringFile()
      for (const edit of valuesEdits) {
        const refusal =
          file === null
            ? unknownVideoRefusal(videoName)
            : tryApply(file, (ctx) => {
                const result = setValuesValue(
                  ctx,
                  videoName,
                  {
                    cueName: edit.field,
                    lang: edit.lang,
                    ...(edit.isDefault !== undefined && {
                      isDefault: edit.isDefault,
                    }),
                    value: edit.value,
                  },
                  isLanguageKey
                )
                if (result.kind === 'edits') return result.edits
                return null
              })
        if (refusal === null) {
          applied.push({
            videoName,
            file: file!,
            description:
              `set values field '${edit.field}' (${edit.lang}) ` +
              `on video '${videoName}'`,
          })
          bump(appliedCounts, videoName)
        } else {
          markUnappliable(
            refusal.reason,
            `locked values field '${edit.field}' on video ` +
              `'${videoName}': ${refusal.message}`
          )
        }
      }
    }

    // ── Language set (codify into video.languages) ─────────────────────────
    const languagesEdit = input.languagesEdits?.[videoName]
    if (languagesEdit !== undefined && languagesEdit.languages.length > 0) {
      const file = declaringFile()
      const refusal =
        file === null
          ? unknownVideoRefusal(videoName)
          : tryApply(file, (ctx) =>
              setVideoLanguages(ctx, videoName, languagesEdit.languages)
            )
      if (refusal === null) {
        applied.push({
          videoName,
          file: file!,
          description:
            `set languages [${languagesEdit.languages.join(', ')}] ` +
            `on video '${videoName}'`,
        })
        bump(appliedCounts, videoName)
      } else {
        markUnappliable(
          refusal.reason,
          `locked languages on video '${videoName}': ${refusal.message}`
        )
      }
    }

    // ── Editor-uploaded media markers (codify into media declarations) ─────
    const editorMediaEdits = input.editorMediaEdits?.[videoName] ?? []
    for (const edit of editorMediaEdits) {
      const file = declaringFile()
      const refusal =
        file === null
          ? unknownVideoRefusal(videoName)
          : tryApply(file, (ctx) =>
              setEditorMedia(
                ctx,
                videoName,
                edit.method,
                edit.name,
                edit.editor,
                edit.method === 'narration' ? isLanguageKey : undefined
              )
            )
      if (refusal === null) {
        applied.push({
          videoName,
          file: file!,
          description:
            `declare editor ${edit.method} '${edit.name}' ` +
            `on video '${videoName}'`,
        })
        bump(appliedCounts, videoName)
      } else {
        markUnappliable(
          refusal.reason,
          `locked ${edit.method} '${edit.name}' on video ` +
            `'${videoName}': ${refusal.message}`
        )
      }
    }
  }

  // Coalesce back-to-back waitForTimeout calls left adjacent by this sync (a
  // removed effect/delay can butt two sleeps together). Adjacency is judged in
  // source, per block, so it never crosses control flow. Runs only on files
  // this sync already changed, and only after their edits are applied (the
  // edits are offset-based against the pre-edit text, so this re-parses the
  // final text and applies a second, independent round). Untouched files are
  // left exactly as authored.
  for (const [path, after] of texts) {
    if (originals.get(path) === after) continue
    const ctx = createContext(deps.ts, path, after)
    const mergeEdits = mergeAdjacentWaitEdits(ctx)
    if (mergeEdits.length > 0) {
      texts.set(path, applyTextEdits(after, mergeEdits))
    }
  }

  const files = [...texts.entries()]
    .filter(([path, after]) => originals.get(path) !== after)
    .map(([path, after]) => ({ path, before: originals.get(path)!, after }))

  const fullyAppliedVideos = videoNames.filter(
    (videoName) =>
      (appliedCounts.get(videoName) ?? 0) > 0 &&
      (unappliableCounts.get(videoName) ?? 0) === 0
  )

  return { files, applied, unappliable, fullyAppliedVideos }
}
