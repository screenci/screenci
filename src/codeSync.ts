/**
 * Planner for `screenci sync`: turns the web editor's edits into concrete
 * text changes to the user's .screenci.ts files, using the codemod primitives.
 *
 * Every code edit locates its call site by the action's `editId` slug: an
 * exact string identity with no heuristics. Actions without a slug are not
 * guessed at; they land in `fallback` (rendered as the agent prompt) until a
 * record plus sync stamps them. Loops (`slug#N` repeat executions), narration
 * content, and other judgment edits stay on the fallback path by design.
 *
 * Pure over injected inputs (parsed comparison, snapshots, a readFile): unit
 * tests drive it with in-memory files.
 */
import { jsonEqual, type ActionMethod } from './actionParams.js'
import type { ActionParamsSnapshot } from './actionParamsSnapshot.js'
import type {
  OverrideAssessment,
  VideoComparison,
  WebStateComparison,
} from './actionSync.js'
import {
  placeCallFor,
  type EditableOverridesByVideo,
  type EditableSnapshot,
  type EditableSnapshotEntry,
  type PlacedEventsByVideo,
  type RenamesByVideo,
} from './editableSnapshot.js'
import type { PlacedEvent } from './timelineEdits.js'
import {
  applyTextEdits,
  chainRootIdentifier,
  createContext,
  enclosingStatement,
  ensureNamedImport,
  findCallByEditId,
  insertStatementAfter,
  insertStatementBefore,
  previousStatement,
  renameEditId as renameEditIdInSource,
  removeOption,
  setOptionValue,
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
): TS.Expression | null {
  const { ts } = ctx
  const previous = previousStatement(ctx, statement)
  if (previous === null || !ts.isExpressionStatement(previous)) return null
  let expression: TS.Expression = previous.expression
  if (ts.isAwaitExpression(expression)) expression = expression.expression
  if (!ts.isCallExpression(expression)) return null
  const callee = expression.expression
  if (!ts.isPropertyAccessExpression(callee)) return null
  if (callee.name.text !== 'waitForTimeout') return null
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== root) {
    return null
  }
  const argument = expression.arguments[0]
  if (argument === undefined || !ts.isNumericLiteral(argument)) return null
  return argument
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

export type CodeSyncPlan = {
  /** Files with changes: original and edited text (not yet written). */
  files: Array<{ path: string; before: string; after: string }>
  applied: AppliedItem[]
  /** Everything that must go through the agent prompt instead. */
  fallback: {
    comparison: WebStateComparison
    overrides: EditableOverridesByVideo
    placed: PlacedEventsByVideo
    renames: RenamesByVideo
  }
  /** Videos where every pending edit was applied (safe to reset web edits). */
  fullyAppliedVideos: string[]
}

export type CodeSyncInput = {
  comparison: WebStateComparison
  actionSnapshot: ActionParamsSnapshot
  editableSnapshot: EditableSnapshot
  editableOverrides: EditableOverridesByVideo
  placedEvents: PlacedEventsByVideo
  renames: RenamesByVideo
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
  /** Marks the source item so a failure can be routed back to fallback. */
  onFallback: () => void
  compute: (ctx: CodemodContext) => TextEdit[] | null
}

export function planCodeSync(
  input: CodeSyncInput,
  deps: CodeSyncDeps
): CodeSyncPlan {
  const texts = new Map<string, string>()
  const originals = new Map<string, string>()
  const applied: AppliedItem[] = []
  const fallbackOverrides: EditableOverridesByVideo = {}
  const fallbackPlaced: PlacedEventsByVideo = {}
  const fallbackRenames: RenamesByVideo = {}
  const fallbackVideos: VideoComparison[] = []
  const fallbackCounts = new Map<string, number>()
  const appliedCounts = new Map<string, number>()

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
      ...Object.keys(input.placedEvents),
      ...Object.keys(input.renames),
    ]),
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
    const fallbackOverrideFields = (
      key: string,
      fields: [string, unknown][]
    ): void => {
      if (fields.length === 0) return
      ;(fallbackOverrides[videoName] ??= []).push({
        key,
        values: Object.fromEntries(fields),
      })
      bump(fallbackCounts, videoName)
    }
    const fallbackEvent = (event: PlacedEvent): void => {
      ;(fallbackPlaced[videoName] ??= []).push(event)
      bump(fallbackCounts, videoName)
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
        item.onFallback()
      }
    }

    // ── Timeline param edits (sleepBefore, autoZoom offsets) ───────────────
    for (const override of input.editableOverrides[videoName] ?? []) {
      const entry = byKey.get(override.key)
      const editId = entry?.editId
      // No editId (unstamped action or a `slug#N` loop repeat execution):
      // never guess at a call site; the prompt handles it.
      if (editId === undefined || override.key.includes('#')) {
        fallbackOverrideFields(
          override.key,
          Object.entries(override.values).filter(([field, value]) => {
            if (value === undefined) return false
            return !(
              entry !== undefined && jsonEqual(entry.defaults[field], value)
            )
          })
        )
        continue
      }
      const remaining: [string, unknown][] = []
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
            onFallback: () => remaining.push([field, value]),
            compute: (ctx) => {
              const call = findCallByEditId(ctx, editId)
              if (call === null) return null
              if (!ctx.ts.isPropertyAccessExpression(call.expression)) {
                return null
              }
              const root = chainRootIdentifier(
                ctx.ts,
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
        if (field === 'startOffset' || field === 'endOffset') {
          applySlugItem({
            videoName,
            editId,
            description: `set ${field}: ${JSON.stringify(value)} on '${editId}'`,
            onFallback: () => remaining.push([field, value]),
            compute: (ctx) => {
              const call = findCallByEditId(ctx, editId)
              if (call === null) return null
              const callee = call.expression
              if (!ctx.ts.isIdentifier(callee) || callee.text !== 'autoZoom') {
                return null
              }
              const edit = setOptionValue(ctx, call, 1, [field], value)
              return edit === null ? null : [edit]
            },
          })
          continue
        }
        remaining.push([field, value])
      }
      fallbackOverrideFields(override.key, remaining)
    }

    // ── Placed events (declarative placeX calls, timestamp markers) ────────
    for (const event of input.placedEvents[videoName] ?? []) {
      const planned = planPlacedEvent(event, byKey, entries)
      if (planned === null) {
        fallbackEvent(event)
        continue
      }
      applySlugItem({
        videoName,
        editId: planned.editId,
        description: planned.description,
        onFallback: () => fallbackEvent(event),
        compute: planned.compute,
      })
    }

    // ── Action-parameter overrides (option values on stamped calls) ────────
    const comparisonVideo = input.comparison.videos.find(
      (video) => video.videoName === videoName
    )
    if (comparisonVideo !== undefined) {
      const records = input.actionSnapshot.videos[videoName] ?? []
      const fallbackAssessments: OverrideAssessment[] = []
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
          fallbackAssessments.push(assessment)
          bump(fallbackCounts, videoName)
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
          fallbackAssessments.push(assessment)
          bump(fallbackCounts, videoName)
        }
      }
      if (fallbackAssessments.length > 0) {
        fallbackVideos.push({
          videoName,
          inSnapshot: comparisonVideo.inSnapshot,
          overrides: fallbackAssessments,
        })
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
        ;(fallbackRenames[videoName] ??= []).push(rename)
        bump(fallbackCounts, videoName)
      }
    }
  }

  const files = [...texts.entries()]
    .filter(([path, after]) => originals.get(path) !== after)
    .map(([path, after]) => ({ path, before: originals.get(path)!, after }))

  const fullyAppliedVideos = videoNames.filter(
    (videoName) =>
      (appliedCounts.get(videoName) ?? 0) > 0 &&
      (fallbackCounts.get(videoName) ?? 0) === 0
  )

  return {
    files,
    applied,
    fallback: {
      comparison: {
        videos: fallbackVideos,
        snapshotEmpty: input.comparison.snapshotEmpty,
      },
      overrides: fallbackOverrides,
      placed: fallbackPlaced,
      renames: fallbackRenames,
    },
    fullyAppliedVideos,
  }
}

const PLACE_FN_IMPORTS: Record<string, string> = {
  hide: 'placeHide',
  speed: 'placeSpeed',
  time: 'placeTime',
  zoom: 'placeZoom',
}

/**
 * How to insert a placed event's code, keyed by an editId. Span kinds
 * (declarative placeX calls) can sit anywhere in the test body, so any
 * stamped action of the video works as the insertion anchor; timestamps must
 * land exactly at their anchor, so only zero-offset action anchors qualify.
 * Null routes the event to the prompt (including videos with no stamped
 * action at all: no guessing).
 */
function planPlacedEvent(
  event: PlacedEvent,
  byKey: Map<string, EditableSnapshotEntry>,
  entries: EditableSnapshotEntry[]
): {
  editId: string
  description: string
  compute: (ctx: CodemodContext) => TextEdit[] | null
} | null {
  const call = placeCallFor(event)
  if (call !== null) {
    const importName = PLACE_FN_IMPORTS[event.kind]
    if (importName === undefined) return null
    const anchorEditId =
      event.anchor.ref.type === 'action'
        ? byKey.get(event.anchor.ref.key)?.editId
        : undefined
    // Declarative calls may sit anywhere: any stamped action anchors them.
    const editId =
      anchorEditId ??
      entries.find((entry) => entry.editId !== undefined)?.editId
    if (editId === undefined) return null
    return {
      editId,
      description: `add ${call} after '${editId}'`,
      compute: (ctx) => {
        const anchorCall = findCallByEditId(ctx, editId)
        if (anchorCall === null) return null
        const statement = enclosingStatement(ctx, anchorCall)
        if (statement === null) return null
        const importEdits = ensureNamedImport(ctx, 'screenci', importName)
        if (importEdits === null) return null
        return [...importEdits, insertStatementAfter(ctx, statement, call)]
      },
    }
  }
  if (
    event.kind === 'timestamp' &&
    event.anchor.offsetMs === 0 &&
    event.anchor.ref.type === 'action'
  ) {
    const editId = byKey.get(event.anchor.ref.key)?.editId
    if (editId === undefined) return null
    const name =
      typeof event.props?.name === 'string' ? event.props.name : event.id
    const code = `await timestamp('${name.replace(/'/g, "\\'")}')`
    const before = event.anchor.edge === 'start'
    return {
      editId,
      description: `insert ${code} ${before ? 'before' : 'after'} '${editId}'`,
      compute: (ctx) => {
        const anchorCall = findCallByEditId(ctx, editId)
        if (anchorCall === null) return null
        const statement = enclosingStatement(ctx, anchorCall)
        if (statement === null) return null
        const importEdits = ensureNamedImport(ctx, 'screenci', 'timestamp')
        if (importEdits === null) return null
        return [
          ...importEdits,
          before
            ? insertStatementBefore(ctx, statement, code)
            : insertStatementAfter(ctx, statement, code),
        ]
      },
    }
  }
  return null
}
