/**
 * editId allocation and stamping for `screenci sync` / `screenci dev --sync`.
 *
 * Every editable action can carry a stable, human-readable identity slug in
 * code (`editId: 'fill1'`). This module assigns slugs to actions recorded
 * without one (using the call sites captured in the editable snapshot) and
 * inserts them into the source via the codemod primitives. Counters live in
 * `.screenci/edit-ids.json` and are never reused, so a removed slug can never
 * come back as a different action's identity.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  applyTextEdits,
  createContext,
  findCallNamed,
  setOptionValue,
  statementAtLine,
  type CodemodContext,
  type TsModule,
} from './codemod.js'
import type {
  EditableSnapshot,
  EditableSnapshotEntry,
} from './editableSnapshot.js'

/** File name of the allocation counters inside `.screenci`. Committed. */
export const EDIT_IDS_FILE = 'edit-ids.json'

export type EditIdCounters = {
  version: 1
  /** Highest allocated number per slug prefix, e.g. `{ fill: 3, click: 7 }`. */
  counters: Record<string, number>
}

export function readEditIdCounters(screenciDir: string): EditIdCounters {
  const filePath = join(screenciDir, EDIT_IDS_FILE)
  if (!existsSync(filePath)) return { version: 1, counters: {} }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    const counters = (parsed as { counters?: unknown }).counters
    if (typeof counters !== 'object' || counters === null) {
      return { version: 1, counters: {} }
    }
    return {
      version: 1,
      counters: Object.fromEntries(
        Object.entries(counters).filter(
          (entry): entry is [string, number] => typeof entry[1] === 'number'
        )
      ),
    }
  } catch {
    return { version: 1, counters: {} }
  }
}

/** Write the counters (write-then-rename so a crash never corrupts them). */
export function writeEditIdCounters(
  screenciDir: string,
  counters: EditIdCounters
): void {
  const filePath = join(screenciDir, EDIT_IDS_FILE)
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(counters, null, 2))
  renameSync(tmpPath, filePath)
}

/** Allocate the next slug for a prefix; mutates `counters`. Never reuses. */
export function allocateEditId(
  counters: EditIdCounters,
  prefix: string
): string {
  const next = (counters.counters[prefix] ?? 0) + 1
  counters.counters[prefix] = next
  return `${prefix}${next}`
}

/** `kind|subKind|...` of a legacy stable editable key. */
function parseKindSubKind(key: string): { kind: string; subKind: string } {
  const parts = key.split('|')
  return { kind: parts[0] ?? '', subKind: parts[1] ?? '' }
}

/**
 * The call names to look for in the source statement, and the options
 * argument that carries `editId`, per editable identity. Returns null for
 * kinds that cannot be stamped (yet).
 */
function stampTarget(entry: EditableSnapshotEntry): {
  callNames: string[]
  optionsIndex: (callName: string) => number
} | null {
  const { kind, subKind } = parseKindSubKind(entry.key)
  if (kind === 'autoZoom') {
    return { callNames: ['autoZoom'], optionsIndex: () => 1 }
  }
  // Timeline block wrappers carry their editId in the trailing options
  // object: hide(fn, opts), speed(fn|multiplier, fn?, opts), time(ms, fn,
  // opts). The exact index depends on the call shape, so it is derived from
  // the callback argument's position (see blockOptionsIndex).
  if (kind === 'hide' || kind === 'speed' || kind === 'time') {
    return { callNames: [kind], optionsIndex: () => -1 }
  }
  if (kind !== 'input') return null
  switch (subKind) {
    case 'click':
    case 'tap':
    case 'check':
    case 'uncheck':
    case 'hover':
    case 'selectText':
      return { callNames: [subKind], optionsIndex: () => 0 }
    // fill records subKind 'pressSequentially' too; match either call.
    case 'pressSequentially':
      return {
        callNames: ['pressSequentially', 'fill'],
        optionsIndex: () => 1,
      }
    case 'select':
      return { callNames: ['selectOption'], optionsIndex: () => 1 }
    case 'dragTo':
      return { callNames: ['dragTo'], optionsIndex: () => 1 }
    default:
      return null
  }
}

/** Slug prefix: always the function name of the stamped call. */
function prefixFor(callName: string): string {
  return callName
}

/**
 * The options-argument index for a timeline block wrapper call: right after
 * the callback argument (hide(fn, opts) -> 1, speed(2, fn, opts) -> 2, ...).
 * Null when the call has no function argument to anchor on.
 */
function blockOptionsIndex(
  ts: TsModule,
  call: import('typescript').CallExpression
): number | null {
  const fnIndex = call.arguments.findIndex(
    (arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)
  )
  return fnIndex === -1 ? null : fnIndex + 1
}

export type EditIdStampPlan = {
  /** Files with stamps inserted: original and edited text (not yet written). */
  files: Array<{ path: string; before: string; after: string }>
  /** One line per stamped action, for logging. */
  stamped: Array<{ videoName: string; key: string; editId: string }>
  /** Mutated counters to persist when the stamps are written. */
  counters: EditIdCounters
}

export type EditIdStampDeps = {
  ts: TsModule
  readFile: (path: string) => string | null
}

/**
 * Plan editId stamps for every snapshot entry that has a source anchor but no
 * editId. Loop call sites are skipped: entries sharing one identity and one
 * source location ran more than once, so a single slug cannot distinguish
 * their executions and the action stays web-runtime-only until refactored.
 * Call sites shared across videos get one slug (dedup by file:line).
 */
export function planEditIdStamps(
  snapshot: EditableSnapshot,
  counters: EditIdCounters,
  deps: EditIdStampDeps
): EditIdStampPlan {
  const texts = new Map<string, string>()
  const originals = new Map<string, string>()
  const slugBySite = new Map<string, string>()
  const stamped: EditIdStampPlan['stamped'] = []

  const getText = (file: string): string | null => {
    if (!texts.has(file)) {
      const content = deps.readFile(file)
      if (content === null) return null
      texts.set(file, content)
      originals.set(file, content)
    }
    return texts.get(file)!
  }

  for (const [videoName, entries] of Object.entries(snapshot.videos)) {
    // Loop detection: identical identity at the same call site means the
    // statement executed repeatedly in one recording.
    const siteCounts = new Map<string, number>()
    for (const entry of entries) {
      if (entry.source === undefined) continue
      const { kind, subKind } = parseKindSubKind(entry.key)
      const site = `${kind}|${subKind}|${entry.source.file}:${entry.source.line}`
      siteCounts.set(site, (siteCounts.get(site) ?? 0) + 1)
    }

    // Stamp bottom-up so an insert never shifts a lower entry's line anchor.
    const candidates = entries
      .filter(
        (entry) => entry.editId === undefined && entry.source !== undefined
      )
      .sort((a, b) =>
        a.source!.file === b.source!.file
          ? b.source!.line - a.source!.line
          : a.source!.file.localeCompare(b.source!.file)
      )
    for (const entry of candidates) {
      const source = entry.source!
      const target = stampTarget(entry)
      if (target === null) continue
      const { kind, subKind } = parseKindSubKind(entry.key)
      if (
        (siteCounts.get(`${kind}|${subKind}|${source.file}:${source.line}`) ??
          0) > 1
      ) {
        continue // loop: no code identity can distinguish the executions
      }
      const siteKey = `${source.file}:${source.line}`
      const alreadyStamped = slugBySite.get(siteKey)
      if (alreadyStamped !== undefined) {
        // A helper shared between videos: one call site, one slug.
        stamped.push({ videoName, key: entry.key, editId: alreadyStamped })
        continue
      }
      const text = getText(source.file)
      if (text === null) continue
      const ctx: CodemodContext = createContext(deps.ts, source.file, text)
      const statement = statementAtLine(ctx, source.line)
      if (statement === null) continue
      let call = null
      let callName = ''
      for (const name of target.callNames) {
        call = findCallNamed(ctx, statement, name)
        if (call !== null) {
          callName = name
          break
        }
      }
      if (call === null) continue
      // Block wrappers signal a shape-dependent options index with -1: it
      // sits right after the callback argument.
      const declaredIndex = target.optionsIndex(callName)
      const optionsIndex =
        declaredIndex === -1 ? blockOptionsIndex(deps.ts, call) : declaredIndex
      if (optionsIndex === null) continue
      const slug = allocateEditId(counters, prefixFor(callName))
      const edit = setOptionValue(ctx, call, optionsIndex, ['editId'], slug)
      if (edit === null) {
        // Allocation is not rolled back: the counter gap is harmless and
        // reuse is forbidden by design.
        continue
      }
      texts.set(source.file, applyTextEdits(text, [edit]))
      slugBySite.set(siteKey, slug)
      stamped.push({ videoName, key: entry.key, editId: slug })
    }
  }

  const files = [...texts.entries()]
    .filter(([path, after]) => originals.get(path) !== after)
    .map(([path, after]) => ({ path, before: originals.get(path)!, after }))
  return { files, stamped, counters }
}
