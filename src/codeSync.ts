/**
 * Planner for `screenci sync`: turns the web editor's edits into concrete
 * text changes to the user's .screenci.ts files, using the codemod primitives.
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
import { jsonEqual, type ActionMethod } from './actionParams.js'
import type { ActionParamsSnapshot } from './actionParamsSnapshot.js'
import type { WebStateComparison } from './actionSync.js'
import type { StudioSyncState } from './studioSync.js'
import type {
  CodifyEditsByVideo,
  EditableOverridesByVideo,
  EditableSnapshot,
  RenamesByVideo,
} from './editableSnapshot.js'
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
  resolvePageIdentifier,
  createContext,
  enclosingStatement,
  enclosingWrapBody,
  ensureNamedImport,
  findCallByEditId,
  findVideoCall,
  insertStatementBefore,
  insertStatementsAfter,
  isLinearCallSite,
  nextStatement,
  previousStatement,
  removeFullLine,
  renameEditId as renameEditIdInSource,
  removeOption,
  setBuilderOptions,
  setOptionValue,
  splitWaitEdit,
  statementsAfter,
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

export type AppliedItem = {
  videoName: string
  file: string
  description: string
}

/** An edit whose section is locked (never a codemod target this run). */
export type UnappliableItem = {
  videoName: string
  reason: string
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
   * Studio render/record option edits, keyed by video name. Codified into
   * `video.renderOptions({...})` / `video.recordOptions({...})` builder calls.
   * Optional so existing callers (and tests) need not pass it.
   */
  studioSync?: StudioSyncState
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
  onUnappliable: () => void
  compute: (ctx: CodemodContext) => TextEdit[] | null
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
  return {
    callCode: edit.blocking ? `await ${head}()` : `await ${head}.start()`,
    head,
  }
}

/** The instant call + import for a GapPointEdit, or null when incomplete. */
function gapPointCode(
  edit: GapPointEdit
): { code: string; importName: string } | null {
  const props = edit.props ?? {}
  switch (edit.kind) {
    case 'narrationBox': {
      const corner = typeof props.corner === 'string' ? props.corner : undefined
      const size = typeof props.size === 'number' ? props.size : undefined
      if (corner !== undefined) {
        const opt = size !== undefined ? `, { size: ${size} }` : ''
        return {
          code: `await moveNarration(${valueToSource(corner)}${opt})`,
          importName: 'moveNarration',
        }
      }
      if (size !== undefined) {
        return {
          code: `await resizeNarration(${size})`,
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
        return { code: `await hideRecording()`, importName: 'hideRecording' }
      }
      if (visible === true) {
        return { code: `await showRecording()`, importName: 'showRecording' }
      }
      if (size !== undefined) {
        return {
          code: `await resizeRecording(${size})`,
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
        code: `await setBackground(${valueToSource(css)})`,
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
): TextEdit[] | null {
  const call = isLinearCallSite(ctx, afterEditId)
  if (call === null) return null
  const statement = enclosingStatement(ctx, call)
  if (statement === null) return null
  const root = chainRootIdentifier(ctx.ts, call.expression)
  const edits: TextEdit[] = []
  if (importName !== undefined) {
    const importEdits = ensureNamedImport(ctx, 'screenci', importName)
    if (importEdits === null) return null
    edits.push(...importEdits)
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

/** Wrap the interaction run `fromEditId..untilEditId` in a block call. */
function wrapRun(
  ctx: CodemodContext,
  fromEditId: string,
  untilEditId: string,
  header: string,
  leadMs: number | undefined,
  trailMs: number | undefined,
  footerClose?: string,
  importName?: string
): TextEdit[] | null {
  const fromCall = isLinearCallSite(ctx, fromEditId)
  const untilCall = isLinearCallSite(ctx, untilEditId)
  if (fromCall === null || untilCall === null) return null
  const fromStmt = enclosingStatement(ctx, fromCall)
  const untilStmt = enclosingStatement(ctx, untilCall)
  if (fromStmt === null || untilStmt === null) return null
  const root = chainRootIdentifier(ctx.ts, fromCall.expression)

  // Idempotent re-sync: when the run is already inside the wrap this edit would
  // create (same block for both ends), do not wrap again. Update the lead/trail
  // gap sleeps in place when they changed; otherwise it is a no-op.
  if (importName !== undefined) {
    const fromBody = enclosingWrapBody(ctx, fromCall, importName)
    const untilBody = enclosingWrapBody(ctx, untilCall, importName)
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
  const wrap = wrapStatementsInBlock(ctx, fromStmt, untilStmt, header, {
    leadLine: lead,
    trailLine: trail,
    footerClose,
  })
  if (wrap === null) return null
  const edits: TextEdit[] = []
  if (importName !== undefined) {
    const importEdits = ensureNamedImport(ctx, 'screenci', importName)
    if (importEdits === null) return null
    edits.push(...importEdits)
  }
  edits.push(...wrap)
  return edits
}

/** Plan the code edits for one codify record, or null when it is unappliable. */
function planCodifyEdit(edit: CodifyEdit): {
  editIds: string[]
  description: string
  compute: (ctx: CodemodContext) => TextEdit[] | null
} | null {
  switch (edit.type) {
    case 'mediaEdit': {
      const media = mediaHeadAndCall(edit)
      if (media === null) return null
      return {
        editIds: [edit.afterEditId],
        description: `insert \`${media.callCode}\` after '${edit.afterEditId}'`,
        compute: (ctx) =>
          insertInGapAfter(
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
        description: `insert \`${point.code}\` after '${edit.afterEditId}'`,
        compute: (ctx) =>
          insertInGapAfter(
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
      return {
        editIds: [span.fromEditId, span.untilEditId],
        description: `wrap '${span.fromEditId}'..'${span.untilEditId}' in ${span.kind}`,
        compute: (ctx) =>
          wrapRun(
            ctx,
            span.fromEditId,
            span.untilEditId,
            header,
            span.fromSleepMs,
            span.untilSleepMs,
            undefined,
            span.kind
          ),
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
 * Plan the removal of a removed (disabled) codify record, or null when the kind
 * cannot be removed with high confidence. Only point effects are removed: their
 * call is unambiguous (a single `narration.`/`overlays.`/`audio.` cue or a known
 * point function) and adjacent to the editId. Wrap edits (zoom/hide/speed/time)
 * are NOT auto-removed here: safely un-wrapping a block (restoring the inner run
 * and its formatting) is ambiguous, so a stale wrap is left for the user rather
 * than risk deleting hand-authored structure. This is the documented limit.
 */
function plannedRemoval(edit: CodifyEdit): {
  editIds: string[]
  description: string
  compute: (ctx: CodemodContext) => TextEdit[] | null
} | null {
  if (edit.type === 'mediaEdit') {
    const media = mediaHeadAndCall(edit)
    if (media === null) return null
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
    return {
      editIds: [edit.afterEditId],
      description: `remove \`${point.code}\` after '${edit.afterEditId}'`,
      compute: (ctx) =>
        removeEffectAfter(
          ctx,
          edit.afterEditId,
          point.importName,
          edit.sleepBeforeMs ?? 0
        ),
    }
  }
  return null // wrap edits (zoomEdit/gapSpanEdit): conservative, not removed
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
  /** Compute and apply one item's edits against the file's current text. */
  const tryApply = (
    file: string,
    compute: (ctx: CodemodContext) => TextEdit[] | null
  ): boolean => {
    const text = getText(file)
    if (text === null) return false
    const ctx = createContext(deps.ts, file, text)
    const edits = compute(ctx)
    if (edits === null) return false
    if (edits.length > 0) texts.set(file, applyTextEdits(text, edits))
    return true
  }

  const videoNames = [
    ...new Set([
      ...input.comparison.videos.map((video) => video.videoName),
      ...Object.keys(input.editableOverrides),
      ...Object.keys(input.codifyEdits),
      ...Object.keys(input.removedCodifyEdits),
      ...Object.keys(input.renames),
      ...Object.keys(input.studioSync?.videos ?? {}),
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
    const markUnappliable = (reason: string): void => {
      unappliable.push({ videoName, reason })
      bump(unappliableCounts, videoName)
    }

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
      if (file !== null && tryApply(file, item.compute)) {
        applied.push({
          videoName: item.videoName,
          file,
          description: item.description,
        })
        bump(appliedCounts, item.videoName)
      } else {
        item.onUnappliable()
      }
    }

    // ── Timeline param edits (sleepBefore, autoZoom offsets) ───────────────
    for (const override of input.editableOverrides[videoName] ?? []) {
      const entry = byKey.get(override.key)
      const editId = entry?.editId
      // No editId (unstamped action or a `slug#N` loop repeat execution):
      // never guess at a call site; the section is locked.
      if (editId === undefined || override.key.includes('#')) {
        for (const [field, value] of Object.entries(override.values)) {
          if (value === undefined) continue
          if (entry !== undefined && jsonEqual(entry.defaults[field], value)) {
            continue
          }
          markUnappliable(`locked param edit '${override.key}' ${field}`)
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
            onUnappliable: () =>
              markUnappliable(`locked sleepBefore on '${editId}'`),
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
        markUnappliable(`unsupported param field '${field}' on '${editId}'`)
      }
    }

    // ── Codify edits (media / zoom / gap span / gap point) ─────────────────
    for (const edit of input.codifyEdits[videoName] ?? []) {
      const planned = planCodifyEdit(edit)
      if (planned === null) {
        markUnappliable(`unappliable ${edit.type} '${edit.id}'`)
        continue
      }
      const file = fileWithAllEditIds(planned.editIds)
      if (file !== null && tryApply(file, planned.compute)) {
        applied.push({ videoName, file, description: planned.description })
        bump(appliedCounts, videoName)
      } else {
        markUnappliable(`locked ${edit.type} '${edit.id}'`)
      }
    }

    // ── Ghost cleanup: removed (disabled) codify effects ───────────────────
    // Runs after the inserts above so a place-then-remove round trip nets out.
    for (const edit of input.removedCodifyEdits[videoName] ?? []) {
      const planned = plannedRemoval(edit)
      if (planned === null) continue // wrap edits: left in place by design
      const file = fileWithAllEditIds(planned.editIds)
      if (file !== null && tryApply(file, planned.compute)) {
        applied.push({ videoName, file, description: planned.description })
        bump(appliedCounts, videoName)
      } else {
        markUnappliable(`locked removal ${edit.type} '${edit.id}'`)
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
            `locked action override ${assessment.selector} ${assessment.method}`
          )
          continue
        }
        const pathSegments = assessment.optionPath.split('.')
        const file = fileWithEditId(editId)
        const ok =
          file !== null &&
          tryApply(file, (ctx) => {
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
          })
        if (ok) {
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
          markUnappliable(`locked action override on '${editId}'`)
        }
      }
    }

    // ── editId renames (applied last: earlier items key on the old slug) ───
    for (const rename of input.renames[videoName] ?? []) {
      if (rename.newEditId === rename.editId) continue // no-op
      const file = fileWithEditId(rename.editId)
      const ok =
        isValidEditId(rename.newEditId) &&
        file !== null &&
        tryApply(file, (ctx) => {
          const edit = renameEditIdInSource(
            ctx,
            rename.editId,
            rename.newEditId
          )
          return edit === null ? null : [edit]
        })
      if (ok) {
        applied.push({
          videoName,
          file: file!,
          description: `rename editId '${rename.editId}' -> '${rename.newEditId}'`,
        })
        bump(appliedCounts, videoName)
      } else {
        markUnappliable(
          `locked rename '${rename.editId}' -> '${rename.newEditId}'`
        )
      }
    }

    // ── Studio render/record option edits (codify into builder calls) ──────
    const studioVideo = input.studioSync?.videos[videoName]
    if (studioVideo !== undefined) {
      // Locate the single file that declares this video's builder call. Prefer
      // the video's editable source files; fall back to every source file in
      // the snapshot so a video with no editable entries can still be found.
      const searchFiles =
        candidateFiles.length > 0 ? candidateFiles : allSnapshotFiles
      const declaringFile = (): string | null => {
        const holders = searchFiles.filter((file) => {
          const text = getText(file)
          if (text === null) return false
          const ctx = createContext(deps.ts, file, text)
          return findVideoCall(ctx, videoName) !== null
        })
        return holders.length === 1 ? holders[0]! : null
      }
      const file = declaringFile()
      for (const method of ['renderOptions', 'recordOptions'] as const) {
        const values = studioVideo[method]
        if (values === undefined || Object.keys(values).length === 0) continue
        const ok =
          file !== null &&
          tryApply(file, (ctx) =>
            setBuilderOptions(ctx, videoName, method, values)
          )
        if (ok) {
          applied.push({
            videoName,
            file: file!,
            description: `codify ${method} on video '${videoName}'`,
          })
          bump(appliedCounts, videoName)
        } else {
          markUnappliable(`locked ${method} on video '${videoName}'`)
        }
      }
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
