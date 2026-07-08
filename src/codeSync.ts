/**
 * Planner for `screenci sync`: turns the web editor's edits into concrete
 * text changes to the user's .screenci.ts files, using the codemod primitives.
 * Everything it cannot apply mechanically lands in `fallback`, which the CLI
 * renders with the existing agent-prompt builders so nothing is lost.
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
  ensureNamedImport,
  findActionCall,
  findCallNamed,
  insertStatementAfter,
  insertStatementBefore,
  enclosingStatement,
  findCallByEditId,
  previousStatement,
  renameEditId as renameEditIdInSource,
  removeOption,
  setOptionValue,
  statementAtLine,
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

/** `kind|subKind|...` of a stable editable key. */
function parseEditableKey(key: string): { kind: string; subKind: string } {
  const parts = key.split('|')
  return { kind: parts[0] ?? '', subKind: parts[1] ?? '' }
}

/** A line-anchored edit derived from the editable snapshot's source anchors. */
type LineItem = {
  videoName: string
  file: string
  line: number
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

    // ── Line-anchored items (param edits + placed events) ──────────────────
    const lineItems: LineItem[] = []

    /** The single candidate file whose text contains the editId slug. */
    const fileWithEditId = (editId: string): string | null => {
      const needle = `'${editId}'`
      const holders = candidateFiles.filter((file) => {
        const text = getText(file)
        return text !== null && text.includes(needle)
      })
      return holders.length === 1 ? holders[0]! : null
    }

    for (const override of input.editableOverrides[videoName] ?? []) {
      const entry = byKey.get(override.key)
      // `fill1#2`: a repeat execution of one call site (a loop). No code
      // identity can distinguish the executions; web-runtime only.
      if (override.key.includes('#')) {
        fallbackOverrideFields(
          override.key,
          Object.entries(override.values).filter(
            ([, value]) => value !== undefined
          )
        )
        continue
      }
      const editId = entry?.editId
      const editIdFile = editId !== undefined ? fileWithEditId(editId) : null
      const { kind, subKind } = parseEditableKey(override.key)
      const remaining: [string, unknown][] = []
      for (const [field, value] of Object.entries(override.values)) {
        if (value === undefined) continue
        if (entry !== undefined && jsonEqual(entry.defaults[field], value)) {
          continue // in sync, nothing to do
        }
        const source = entry?.source
        // editId-stamped actions: exact identity, no line anchors needed.
        if (editId !== undefined && editIdFile !== null) {
          if (
            field === 'sleepBefore' &&
            typeof value === 'number' &&
            value > 0
          ) {
            const ms = Math.round(value)
            lineItems.push({
              videoName,
              file: editIdFile,
              line: source?.line ?? 0,
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
            lineItems.push({
              videoName,
              file: editIdFile,
              line: source?.line ?? 0,
              description: `set ${field}: ${JSON.stringify(value)} on '${editId}'`,
              onFallback: () => remaining.push([field, value]),
              compute: (ctx) => {
                const call = findCallByEditId(ctx, editId)
                if (call === null) return null
                const callee = call.expression
                if (
                  !ctx.ts.isIdentifier(callee) ||
                  callee.text !== 'autoZoom'
                ) {
                  return null
                }
                const edit = setOptionValue(ctx, call, 1, [field], value)
                return edit === null ? null : [edit]
              },
            })
            continue
          }
          remaining.push([field, value])
          continue
        }
        if (
          field === 'sleepBefore' &&
          typeof value === 'number' &&
          value > 0 &&
          kind === 'input' &&
          source !== undefined
        ) {
          const ms = Math.round(value)
          lineItems.push({
            videoName,
            file: source.file,
            line: source.line,
            description:
              `insert await <page>.waitForTimeout(${ms}) before ` +
              `${source.file}:${source.line}`,
            onFallback: () => remaining.push([field, value]),
            compute: (ctx) => {
              const statement = statementAtLine(ctx, source.line)
              if (statement === null) return null
              const call = findCallNamed(ctx, statement, subKind)
              if (call === null) return null
              if (!ctx.ts.isPropertyAccessExpression(call.expression)) {
                return null
              }
              const root = chainRootIdentifier(
                ctx.ts,
                call.expression.expression
              )
              if (root === null) return null
              // A wait we (or the user) already placed directly before the
              // action: update its duration instead of stacking another one.
              // Keeps repeated syncs (e.g. dev auto-sync) idempotent.
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
        if (
          (field === 'startOffset' || field === 'endOffset') &&
          kind === 'autoZoom' &&
          source !== undefined
        ) {
          lineItems.push({
            videoName,
            file: source.file,
            line: source.line,
            description:
              `set ${field}: ${JSON.stringify(value)} on autoZoom at ` +
              `${source.file}:${source.line}`,
            onFallback: () => remaining.push([field, value]),
            compute: (ctx) => {
              const statement = statementAtLine(ctx, source.line)
              if (statement === null) return null
              const call = findCallNamed(ctx, statement, 'autoZoom')
              if (call === null) return null
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

    for (const event of input.placedEvents[videoName] ?? []) {
      const planned = planPlacedEvent(event, byKey, entries)
      if (planned === null) {
        fallbackEvent(event)
        continue
      }
      lineItems.push({
        videoName,
        file: planned.file,
        line: planned.line,
        description: planned.description,
        onFallback: () => fallbackEvent(event),
        compute: planned.compute,
      })
    }

    // Higher lines first: earlier insertions must not shift later anchors.
    lineItems.sort((a, b) =>
      a.file === b.file ? b.line - a.line : a.file.localeCompare(b.file)
    )
    for (const item of lineItems) {
      if (tryApply(item.file, item.compute)) {
        applied.push({
          videoName: item.videoName,
          file: item.file,
          description: item.description,
        })
        bump(appliedCounts, item.videoName)
      } else {
        item.onFallback()
      }
    }

    // ── Action-parameter overrides (selector-matched, line-independent) ────
    const comparisonVideo = input.comparison.videos.find(
      (video) => video.videoName === videoName
    )
    if (comparisonVideo !== undefined) {
      const records = input.actionSnapshot.videos[videoName] ?? []
      const fallbackAssessments: OverrideAssessment[] = []
      for (const assessment of comparisonVideo.overrides) {
        if (assessment.kind === 'in-sync') continue
        if (assessment.kind === 'stale') {
          fallbackAssessments.push(assessment)
          bump(fallbackCounts, videoName)
          continue
        }
        const expectedTotal = records.filter(
          (record) =>
            record.selector === assessment.selector &&
            record.method === assessment.method
        ).length
        const optionsIndex =
          OPTIONS_ARG_INDEX[assessment.method as ActionMethod]
        const pathSegments = assessment.optionPath.split('.')
        // Exactly one candidate file may resolve the call unambiguously.
        const resolvable =
          expectedTotal === 0 || optionsIndex === undefined
            ? []
            : candidateFiles.filter((file) => {
                const text = getText(file)
                if (text === null) return false
                const ctx = createContext(deps.ts, file, text)
                return (
                  findActionCall(ctx, {
                    selector: assessment.selector,
                    method: assessment.method,
                    occurrence: assessment.occurrence,
                    expectedTotal,
                  }) !== null
                )
              })
        const file = resolvable.length === 1 ? resolvable[0]! : null
        const ok =
          file !== null &&
          tryApply(file, (ctx) => {
            const call = findActionCall(ctx, {
              selector: assessment.selector,
              method: assessment.method,
              occurrence: assessment.occurrence,
              expectedTotal,
            })
            if (call === null) return null
            const edit =
              assessment.kind === 'remove'
                ? removeOption(ctx, call, optionsIndex!, pathSegments)
                : setOptionValue(
                    ctx,
                    call,
                    optionsIndex!,
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
                ? `remove ${assessment.optionPath} from ` +
                  `${assessment.selector}.${assessment.method}() ` +
                  `#${assessment.occurrence + 1}`
                : `set ${assessment.optionPath} = ` +
                  `${JSON.stringify(assessment.editorValue)} on ` +
                  `${assessment.selector}.${assessment.method}() ` +
                  `#${assessment.occurrence + 1}`,
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
 * Where and how to insert a placed event's code. Span kinds (declarative
 * placeX calls) can sit anywhere in the test body, so any anchored statement
 * of the video works; timestamps must land exactly at their anchor, so only
 * zero-offset action anchors qualify. Null routes the event to the prompt.
 */
function planPlacedEvent(
  event: PlacedEvent,
  byKey: Map<string, EditableSnapshotEntry>,
  entries: EditableSnapshotEntry[]
): {
  file: string
  line: number
  description: string
  compute: (ctx: CodemodContext) => TextEdit[] | null
} | null {
  const call = placeCallFor(event)
  if (call !== null) {
    const importName = PLACE_FN_IMPORTS[event.kind]
    if (importName === undefined) return null
    const anchorSource =
      event.anchor.ref.type === 'action'
        ? byKey.get(event.anchor.ref.key)?.source
        : undefined
    // Declarative calls may sit anywhere: fall back to any anchored statement.
    const source =
      anchorSource ??
      entries.find((entry) => entry.source !== undefined)?.source
    if (source === undefined) return null
    return {
      file: source.file,
      line: source.line,
      description: `add ${call} near ${source.file}:${source.line}`,
      compute: (ctx) => {
        const statement = statementAtLine(ctx, source.line)
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
    const source = byKey.get(event.anchor.ref.key)?.source
    if (source === undefined) return null
    const name =
      typeof event.props?.name === 'string' ? event.props.name : event.id
    const code = `await timestamp('${name.replace(/'/g, "\\'")}')`
    const before = event.anchor.edge === 'start'
    return {
      file: source.file,
      line: source.line,
      description:
        `insert ${code} ${before ? 'before' : 'after'} ` +
        `${source.file}:${source.line}`,
      compute: (ctx) => {
        const statement = statementAtLine(ctx, source.line)
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
