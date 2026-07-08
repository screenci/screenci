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
  removeOption,
  setOptionValue,
  statementAtLine,
  type CodemodContext,
  type TextEdit,
  type TsModule,
} from './codemod.js'

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

    for (const override of input.editableOverrides[videoName] ?? []) {
      const entry = byKey.get(override.key)
      const { kind, subKind } = parseEditableKey(override.key)
      const remaining: [string, unknown][] = []
      for (const [field, value] of Object.entries(override.values)) {
        if (value === undefined) continue
        if (entry !== undefined && jsonEqual(entry.defaults[field], value)) {
          continue // in sync, nothing to do
        }
        const source = entry?.source
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
