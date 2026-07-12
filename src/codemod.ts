/**
 * Static-analysis primitives for `screenci sync`: surgical text edits to
 * .screenci.ts files, computed with the TypeScript compiler API used purely as
 * a parser. Only the edited ranges change; untouched text is never reprinted,
 * so the user's formatting and comments survive exactly.
 *
 * The `typescript` module is loaded lazily from the user's project (screenci
 * projects are TypeScript projects, so it is present). Every function returns
 * `null` when the requested edit cannot be made safely; the caller falls back
 * to the agent sync prompt for that item.
 */
import { createRequire } from 'module'
import { join } from 'path'
import type TS from 'typescript'

export type TsModule = typeof TS

/** One splice into the original source text. */
export type TextEdit = {
  start: number
  end: number
  replacement: string
}

/** A parsed file plus everything the edit helpers need. */
export type CodemodContext = {
  ts: TsModule
  sourceFile: TS.SourceFile
  source: string
}

/**
 * Load the `typescript` module, preferring the user's project installation
 * (resolved from `projectDir`), falling back to whatever this package can
 * resolve (e.g. a hoisted dev install). Returns null when neither resolves;
 * the caller then skips code edits entirely.
 */
export function loadTypescript(projectDir: string): TsModule | null {
  for (const from of [join(projectDir, 'noop.js'), import.meta.url]) {
    try {
      const require = createRequire(from)
      return require('typescript') as TsModule
    } catch {
      continue
    }
  }
  return null
}

/** Parse a source text into a context for the edit helpers. */
export function createContext(
  ts: TsModule,
  fileName: string,
  source: string
): CodemodContext {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true
  )
  return { ts, sourceFile, source }
}

/**
 * Apply text edits to a source string. Edits must not overlap (zero-length
 * inserts at the same position are fine); throws on overlap because that is a
 * planner bug, never expected input.
 */
export function applyTextEdits(source: string, edits: TextEdit[]): string {
  const ordered = edits
    .map((edit, index) => ({ ...edit, index }))
    .sort((a, b) => b.start - a.start || b.index - a.index)
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]!.end > ordered[i - 1]!.start) {
      throw new Error('Overlapping text edits')
    }
  }
  let result = source
  for (const edit of ordered) {
    result =
      result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}

/** The leftmost identifier of a property/call chain, e.g. `page` of
 *  `page.getByRole('button').click()`. Null when the chain does not start at
 *  a plain identifier (destructured helper results, awaited expressions). */
export function chainRootIdentifier(
  ts: TsModule,
  expression: TS.Expression
): string | null {
  let current: TS.Expression = expression
  for (;;) {
    if (ts.isPropertyAccessExpression(current)) {
      current = current.expression
    } else if (ts.isCallExpression(current)) {
      current = current.expression
    } else if (ts.isNonNullExpression(current)) {
      current = current.expression
    } else if (ts.isIdentifier(current)) {
      return current.text
    } else {
      return null
    }
  }
}

/**
 * The initializer of a top-level-or-nested `const <name> = <init>` declaration
 * with the given name, or null when `name` is not a local variable (e.g. it is
 * the `page` test parameter). Used to trace a stored locator back to the page.
 */
function variableInitializer(
  ts: TsModule,
  sourceFile: TS.SourceFile,
  name: string
): TS.Expression | null {
  let found: TS.Expression | null = null
  const visit = (node: TS.Node): void => {
    if (found !== null) return
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined
    ) {
      found = node.initializer
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

/**
 * Resolves the page identifier behind an action's receiver expression.
 *
 * `chainRootIdentifier` returns the leftmost identifier of a call chain, which
 * is the page for `page.getByRole(...).click()` but a stored locator variable
 * for `sliderThumb.dragTo(...)`. A `waitForTimeout` sleep must always be emitted
 * on the page, so this follows a locator variable back through its declaration
 * (`const sliderThumb = page.locator(...)`) until it reaches an identifier with
 * no local declaration (the `page` parameter). Falls back to the chain root when
 * no declaration is found.
 */
export function resolvePageIdentifier(
  ts: TsModule,
  sourceFile: TS.SourceFile,
  expression: TS.Expression
): string | null {
  let name = chainRootIdentifier(ts, expression)
  const seen = new Set<string>()
  while (name !== null && !seen.has(name)) {
    seen.add(name)
    const init = variableInitializer(ts, sourceFile, name)
    if (init === null) return name // no local declaration: the page parameter
    const next = chainRootIdentifier(ts, init)
    if (next === null || next === name) return name
    name = next
  }
  return name
}

/** JS source text for a JSON-safe value, in single-quote style. */
export function valueToSource(value: unknown): string | null {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => valueToSource(item))
    if (items.some((item) => item === null)) return null
    return `[${items.join(', ')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([key, entryValue]) => {
      const rendered = valueToSource(entryValue)
      if (rendered === null) return null
      const name = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
        ? key
        : `'${key.replace(/'/g, "\\'")}'`
      return `${name}: ${rendered}`
    })
    if (entries.some((entry) => entry === null)) return null
    return `{ ${entries.join(', ')} }`
  }
  return null
}

/** `{ a: { b: value } }` source for a nested option path. */
function nestedObjectSource(path: string[], valueSource: string): string {
  let text = valueSource
  for (const segment of [...path].reverse()) {
    text = `{ ${segment}: ${text} }`
  }
  return text
}

/** The property assignment named `name` in an object literal, if plain. */
function findProperty(
  ts: TsModule,
  object: TS.ObjectLiteralExpression,
  name: string
): { property: TS.PropertyAssignment | null; unsafe: boolean } {
  let unsafe = false
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      // A spread may define the option out of sight; refuse to edit.
      unsafe = true
      continue
    }
    const propertyName = property.name
    if (propertyName === undefined) continue
    const text = ts.isIdentifier(propertyName)
      ? propertyName.text
      : ts.isStringLiteral(propertyName)
        ? propertyName.text
        : null
    if (text !== name) continue
    if (ts.isPropertyAssignment(property)) return { property, unsafe: false }
    // Shorthand or method: too clever to edit mechanically.
    return { property: null, unsafe: true }
  }
  return { property: null, unsafe }
}

/** Insert a `name: value` property into an object literal. */
function insertPropertyEdit(
  object: TS.ObjectLiteralExpression,
  propertyText: string
): TextEdit {
  if (object.properties.length === 0) {
    return {
      start: object.getStart(),
      end: object.getEnd(),
      replacement: `{ ${propertyText} }`,
    }
  }
  const last = object.properties[object.properties.length - 1]!
  return {
    start: last.getEnd(),
    end: last.getEnd(),
    replacement: `, ${propertyText}`,
  }
}

/**
 * Set an option (possibly nested, e.g. `move.duration`) on a call's options
 * argument, creating the argument or intermediate objects when missing.
 * Returns null when the call shape resists a mechanical edit (non-literal
 * options, spreads, shorthand properties, non-JSON value).
 */
export function setOptionValue(
  ctx: CodemodContext,
  call: TS.CallExpression,
  optionsIndex: number,
  optionPath: string[],
  value: unknown
): TextEdit | null {
  const { ts } = ctx
  const valueSource = valueToSource(value)
  if (valueSource === null || optionPath.length === 0) return null
  const args = call.arguments
  if (args.length < optionsIndex) return null
  if (args.length === optionsIndex) {
    // No options argument yet: append one.
    const finalText = nestedObjectSource(optionPath, valueSource)
    if (args.length === 0) {
      const openParenEnd = args.pos
      return { start: openParenEnd, end: openParenEnd, replacement: finalText }
    }
    const lastArg = args[args.length - 1]!
    return {
      start: lastArg.getEnd(),
      end: lastArg.getEnd(),
      replacement: `, ${finalText}`,
    }
  }
  const optionsArg = args[optionsIndex]!
  if (!ts.isObjectLiteralExpression(optionsArg)) return null
  let object: TS.ObjectLiteralExpression = optionsArg
  for (let i = 0; i < optionPath.length; i++) {
    const segment = optionPath[i]!
    const isLast = i === optionPath.length - 1
    const { property, unsafe } = findProperty(ts, object, segment)
    if (property === null) {
      if (unsafe) return null
      const rest = optionPath.slice(i + 1)
      const text =
        rest.length === 0 ? valueSource : nestedObjectSource(rest, valueSource)
      return insertPropertyEdit(object, `${segment}: ${text}`)
    }
    if (isLast) {
      return {
        start: property.initializer.getStart(),
        end: property.initializer.getEnd(),
        replacement: valueSource,
      }
    }
    if (!ts.isObjectLiteralExpression(property.initializer)) return null
    object = property.initializer
  }
  return null
}

/** Remove a property from an object literal that has other properties. */
function removePropertyEdit(
  object: TS.ObjectLiteralExpression,
  property: TS.ObjectLiteralElementLike
): TextEdit {
  const index = object.properties.indexOf(property)
  if (index < object.properties.length - 1) {
    // Not last: remove through the start of the next property (eats the comma).
    const next = object.properties[index + 1]!
    return { start: property.getStart(), end: next.getStart(), replacement: '' }
  }
  // Last: remove from the previous property's end (eats the preceding comma).
  const previous = object.properties[index - 1]!
  return { start: previous.getEnd(), end: property.getEnd(), replacement: '' }
}

/**
 * Remove an explicit option (possibly nested) from a call's options argument.
 * Empty intermediate objects collapse; when the whole options argument would
 * become empty it is removed entirely. Returns null when the option is not a
 * plain property of plain object literals.
 */
export function removeOption(
  ctx: CodemodContext,
  call: TS.CallExpression,
  optionsIndex: number,
  optionPath: string[]
): TextEdit | null {
  const { ts } = ctx
  const args = call.arguments
  if (args.length <= optionsIndex) return null
  const optionsArg = args[optionsIndex]!
  if (!ts.isObjectLiteralExpression(optionsArg)) return null
  // Walk down collecting the object/property chain.
  const chain: Array<{
    object: TS.ObjectLiteralExpression
    property: TS.PropertyAssignment
  }> = []
  let object: TS.ObjectLiteralExpression = optionsArg
  for (let i = 0; i < optionPath.length; i++) {
    const { property } = findProperty(ts, object, optionPath[i]!)
    if (property === null) return null
    chain.push({ object, property })
    if (i < optionPath.length - 1) {
      if (!ts.isObjectLiteralExpression(property.initializer)) return null
      object = property.initializer
    }
  }
  // Find the deepest level that keeps other properties after the removal.
  for (let i = chain.length - 1; i >= 0; i--) {
    const level = chain[i]!
    if (level.object.properties.length > 1) {
      return removePropertyEdit(level.object, level.property)
    }
  }
  // Every level collapses: remove the whole options argument.
  if (optionsIndex > 0) {
    const previousArg = args[optionsIndex - 1]!
    return {
      start: previousArg.getEnd(),
      end: optionsArg.getEnd(),
      replacement: '',
    }
  }
  return {
    start: optionsArg.getStart(),
    end: optionsArg.getEnd(),
    replacement: '',
  }
}

/**
 * The innermost statement covering a 1-based line whose parent is a block (so
 * sibling statements can be inserted around it). Null when the line is blank
 * or outside any block statement.
 */
export function statementAtLine(
  ctx: CodemodContext,
  line: number
): TS.Statement | null {
  const { ts, sourceFile } = ctx
  let found: TS.Statement | null = null
  const targetLine = line - 1
  const visit = (node: TS.Node): void => {
    const startLine = sourceFile.getLineAndCharacterOfPosition(
      node.getStart()
    ).line
    const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line
    if (targetLine < startLine || targetLine > endLine) return
    if (
      isStatementNode(ts, node) &&
      node.parent !== undefined &&
      (ts.isBlock(node.parent) || ts.isSourceFile(node.parent))
    ) {
      found = node as TS.Statement
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function isStatementNode(ts: TsModule, node: TS.Node): boolean {
  return (
    ts.isExpressionStatement(node) ||
    ts.isVariableStatement(node) ||
    ts.isReturnStatement(node) ||
    ts.isIfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isWhileStatement(node)
  )
}

/** Every call expression whose options carry `editId: '<slug>'`. */
function findCallsByEditId(
  ctx: CodemodContext,
  editId: string
): TS.CallExpression[] {
  const { ts, sourceFile } = ctx
  const matches: TS.CallExpression[] = []
  const visit = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      for (const argument of node.arguments) {
        if (!ts.isObjectLiteralExpression(argument)) continue
        for (const property of argument.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === 'editId' &&
            ts.isStringLiteral(property.initializer) &&
            property.initializer.text === editId
          ) {
            matches.push(node)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return matches
}

/**
 * The call expression whose options carry `editId: '<slug>'`. Exact identity:
 * immune to line drift, refactors, helpers, and locator changes. Null when
 * the slug is absent or (duplicated in one file) ambiguous.
 */
export function findCallByEditId(
  ctx: CodemodContext,
  editId: string
): TS.CallExpression | null {
  const matches = findCallsByEditId(ctx, editId)
  return matches.length === 1 ? matches[0]! : null
}

/**
 * Diagnose why an editId may not be an editable call site: absent from the
 * file, duplicated (ambiguous), or locked inside control flow. `ok` means the
 * site is unique and linear; an edit that still fails there was refused by the
 * call's shape (non-literal options, spreads, unsupported structure).
 */
export function classifyEditIdSite(
  ctx: CodemodContext,
  editId: string
): 'missing' | 'ambiguous' | 'control-flow' | 'ok' {
  const matches = findCallsByEditId(ctx, editId)
  if (matches.length === 0) return 'missing'
  if (matches.length > 1) return 'ambiguous'
  return isLinearCallSite(ctx, editId) === null ? 'control-flow' : 'ok'
}

/**
 * Replace the `editId: '<oldId>'` string literal with `newId`. Null when the
 * slug is absent or ambiguous in the file.
 */
export function renameEditId(
  ctx: CodemodContext,
  oldId: string,
  newId: string
): TextEdit | null {
  const call = findCallByEditId(ctx, oldId)
  if (call === null) return null
  return renameEditIdAtCall(ctx, call, oldId, newId)
}

/**
 * Replace the `editId: '<oldId>'` string literal on a specific, already-located
 * call node with `newId`. Unlike {@link renameEditId} this targets one known
 * node, so it works even when the slug is duplicated in the file (the caller
 * disambiguates which occurrence to rewrite). Null when the node carries no
 * matching `editId` literal.
 */
export function renameEditIdAtCall(
  ctx: CodemodContext,
  call: TS.CallExpression,
  oldId: string,
  newId: string
): TextEdit | null {
  const { ts } = ctx
  for (const argument of call.arguments) {
    if (!ts.isObjectLiteralExpression(argument)) continue
    for (const property of argument.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === 'editId' &&
        ts.isStringLiteral(property.initializer) &&
        property.initializer.text === oldId
      ) {
        return {
          start: property.initializer.getStart(),
          end: property.initializer.getEnd(),
          replacement: `'${newId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`,
        }
      }
    }
  }
  return null
}

/** A single `editId: '<slug>'` occurrence found by static analysis. */
export type EditIdOccurrence = {
  editId: string
  call: TS.CallExpression
  /** Bounds of the string literal (including quotes), for a surgical rewrite. */
  literalStart: number
  literalEnd: number
  /** The call's method/function name, e.g. `click`, `autoZoom`. */
  callName: string
}

/** The method/function name of a call, or '' when it is not a plain call. */
function callExpressionName(
  ctx: CodemodContext,
  call: TS.CallExpression
): string {
  const { ts } = ctx
  const callee = call.expression
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  if (ts.isIdentifier(callee)) return callee.text
  return ''
}

/**
 * Every `editId: '<slug>'` occurrence in the file. Unlike the slug-filtered
 * {@link findCallByEditId}, this walks the source once and returns them all, so
 * a caller can detect duplicates (one slug at more than one call site).
 */
export function collectEditIdOccurrences(
  ctx: CodemodContext
): EditIdOccurrence[] {
  const { ts, sourceFile } = ctx
  const occurrences: EditIdOccurrence[] = []
  const visit = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      for (const argument of node.arguments) {
        if (!ts.isObjectLiteralExpression(argument)) continue
        for (const property of argument.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === 'editId' &&
            ts.isStringLiteral(property.initializer)
          ) {
            occurrences.push({
              editId: property.initializer.text,
              call: node,
              literalStart: property.initializer.getStart(),
              literalEnd: property.initializer.getEnd(),
              callName: callExpressionName(ctx, node),
            })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return occurrences
}

/** The statement containing `node` whose parent is a block (insertable). */
export function enclosingStatement(
  ctx: CodemodContext,
  node: TS.Node
): TS.Statement | null {
  const { ts } = ctx
  for (
    let current: TS.Node | undefined = node;
    current !== undefined;
    current = current.parent
  ) {
    if (
      isStatementNode(ts, current) &&
      current.parent !== undefined &&
      (ts.isBlock(current.parent) || ts.isSourceFile(current.parent))
    ) {
      return current as TS.Statement
    }
  }
  return null
}

/** The sibling statements of `statement` (its block/source-file body), or null. */
function siblingStatements(
  ctx: CodemodContext,
  statement: TS.Statement
): TS.NodeArray<TS.Statement> | null {
  const { ts } = ctx
  const parent = statement.parent
  if (parent === undefined) return null
  return ts.isBlock(parent)
    ? parent.statements
    : ts.isSourceFile(parent)
      ? parent.statements
      : null
}

/** The statement immediately before `statement` in its enclosing block. */
export function previousStatement(
  ctx: CodemodContext,
  statement: TS.Statement
): TS.Statement | null {
  const statements = siblingStatements(ctx, statement)
  if (statements === null) return null
  const index = statements.indexOf(statement)
  return index > 0 ? statements[index - 1]! : null
}

/** The statement immediately after `statement` in its enclosing block. */
export function nextStatement(
  ctx: CodemodContext,
  statement: TS.Statement
): TS.Statement | null {
  const statements = siblingStatements(ctx, statement)
  if (statements === null) return null
  const index = statements.indexOf(statement)
  return index >= 0 && index < statements.length - 1
    ? statements[index + 1]!
    : null
}

/**
 * The numeric-literal argument node of an `await <root>.waitForTimeout(<n>)`
 * expression statement, or null when `statement` is not such a sleep on `root`.
 * Editor-placed gap sleeps are recognised (and split/coalesced/removed) through
 * this shape: there is no marker on the node, only the structural match.
 */
export function waitForTimeoutArg(
  ctx: CodemodContext,
  statement: TS.Statement,
  root: string
): TS.NumericLiteral | null {
  const info = waitStatementInfo(ctx, statement)
  return info !== null && info.root === root ? info.literal : null
}

/**
 * The receiver identifier and numeric-literal argument of any
 * `await <root>.waitForTimeout(<n>)` statement, regardless of which root it sits
 * on. Null when `statement` is not such a sleep. Used by the coalescing pass,
 * which does not know the root ahead of time.
 */
function waitStatementInfo(
  ctx: CodemodContext,
  statement: TS.Statement
): { root: string; literal: TS.NumericLiteral } | null {
  const { ts } = ctx
  if (!ts.isExpressionStatement(statement)) return null
  let expression: TS.Expression = statement.expression
  if (ts.isAwaitExpression(expression)) expression = expression.expression
  if (!ts.isCallExpression(expression)) return null
  const callee = expression.expression
  if (!ts.isPropertyAccessExpression(callee)) return null
  if (callee.name.text !== 'waitForTimeout') return null
  if (!ts.isIdentifier(callee.expression)) return null
  const argument = expression.arguments[0]
  if (argument === undefined || !ts.isNumericLiteral(argument)) return null
  return { root: callee.expression.text, literal: argument }
}

/** The numeric value of a wait literal, tolerating `_` digit separators. */
function waitLiteralValue(literal: TS.NumericLiteral): number {
  return Number(literal.text.replace(/_/g, ''))
}

/**
 * Text edits that collapse every maximal run of two or more consecutive
 * `await <root>.waitForTimeout(n)` statements (same root, nothing but those
 * sleeps between them) into a single `waitForTimeout(<sum>)`. Adjacency is
 * judged per statement list (block / source-file body), so a run never spans a
 * control-flow boundary. A comment between two sleeps breaks the run (authored
 * intent is preserved). A run whose sum is 0 is removed entirely. Idempotent:
 * a lone sleep is never rewritten, so re-running yields no further edits.
 */
export function mergeAdjacentWaitEdits(ctx: CodemodContext): TextEdit[] {
  const { ts } = ctx
  const edits: TextEdit[] = []
  const visitList = (statements: TS.NodeArray<TS.Statement>): void => {
    let i = 0
    while (i < statements.length) {
      const first = waitStatementInfo(ctx, statements[i]!)
      if (first === null) {
        i += 1
        continue
      }
      const run = [{ statement: statements[i]!, info: first }]
      let j = i + 1
      while (j < statements.length) {
        const next = statements[j]!
        const info = waitStatementInfo(ctx, next)
        if (info === null || info.root !== first.root) break
        const comments = ts.getLeadingCommentRanges(
          ctx.source,
          next.getFullStart()
        )
        if (comments !== undefined && comments.length > 0) break
        run.push({ statement: next, info })
        j += 1
      }
      if (run.length >= 2) {
        const sum = run.reduce(
          (total, item) => total + waitLiteralValue(item.info.literal),
          0
        )
        if (sum === 0) {
          for (const item of run)
            edits.push(removeFullLine(ctx, item.statement))
        } else {
          const firstLiteral = run[0]!.info.literal
          edits.push({
            start: firstLiteral.getStart(),
            end: firstLiteral.getEnd(),
            replacement: String(sum),
          })
          for (let k = 1; k < run.length; k += 1) {
            edits.push(removeFullLine(ctx, run[k]!.statement))
          }
        }
      }
      i = j
    }
  }
  const walk = (node: TS.Node): void => {
    if (ts.isSourceFile(node) || ts.isBlock(node)) {
      visitList((node as TS.SourceFile | TS.Block).statements)
    }
    ts.forEachChild(node, walk)
  }
  walk(ctx.sourceFile)
  return edits
}

/**
 * The numeric-literal argument of a recorded `await <page>.waitForTimeout(<n>)`
 * that sits immediately adjacent to the call carrying `anchorEditId`. A recorded
 * wait carries no editId of its own (waitForTimeout takes no options object), so
 * it is located structurally through a stamped neighbor: the wait immediately
 * before the anchor action (`direction: 'before'`) or immediately after it
 * (`direction: 'after'`). Null when the anchor is missing/ambiguous or the
 * adjacent statement is not such a wait (drifted source: caller should refuse
 * rather than guess).
 */
export function findRecordedWait(
  ctx: CodemodContext,
  anchorEditId: string,
  direction: 'before' | 'after'
): TS.NumericLiteral | null {
  const { ts } = ctx
  const call = findCallByEditId(ctx, anchorEditId)
  if (call === null) return null
  if (!ts.isPropertyAccessExpression(call.expression)) return null
  const root = resolvePageIdentifier(
    ts,
    ctx.sourceFile,
    call.expression.expression
  )
  if (root === null) return null
  const statement = enclosingStatement(ctx, call)
  if (statement === null) return null
  const neighbor =
    direction === 'before'
      ? previousStatement(ctx, statement)
      : nextStatement(ctx, statement)
  if (neighbor === null) return null
  return waitForTimeoutArg(ctx, neighbor, root)
}

/** The statements that precede `statement` in its enclosing block, nearest first. */
export function statementsBefore(
  ctx: CodemodContext,
  statement: TS.Statement
): TS.Statement[] {
  const statements = siblingStatements(ctx, statement)
  if (statements === null) return []
  const index = statements.indexOf(statement)
  return index <= 0 ? [] : Array.from(statements).slice(0, index).reverse()
}

/** The statements that follow `statement` in its enclosing block, in order. */
export function statementsAfter(
  ctx: CodemodContext,
  statement: TS.Statement
): TS.Statement[] {
  const statements = siblingStatements(ctx, statement)
  if (statements === null) return []
  const index = statements.indexOf(statement)
  return index < 0 ? [] : Array.from(statements).slice(index + 1)
}

/** The call expression of an `await <call>` / `<call>` expression statement. */
function awaitedCallOf(
  ctx: CodemodContext,
  statement: TS.Statement
): TS.CallExpression | null {
  const { ts } = ctx
  if (!ts.isExpressionStatement(statement)) return null
  let expression: TS.Expression = statement.expression
  if (ts.isAwaitExpression(expression)) expression = expression.expression
  return ts.isCallExpression(expression) ? expression : null
}

/**
 * The callee head of an awaited-call statement, with a trailing `.start`
 * stripped so `await narration.intro.start()` and `await narration.intro()`
 * share the head `narration.intro`. Null when the statement is not an awaited
 * call. This is how a codemod-authored effect placement is matched back to the
 * effect it carries: no marker on the node, only its callee identity.
 */
export function awaitedCallHead(
  ctx: CodemodContext,
  statement: TS.Statement
): string | null {
  const call = awaitedCallOf(ctx, statement)
  if (call === null) return null
  const callee = call.expression
  if (
    ctx.ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'start'
  ) {
    return callee.expression.getText()
  }
  return callee.getText()
}

/**
 * Remove `statement` together with the whole physical line it occupies (its
 * leading indentation and its trailing newline). Used to delete an orphaned
 * effect call and its editor-placed gap sleep so the surrounding text closes up
 * cleanly (no blank line left behind).
 */
export function removeFullLine(
  ctx: CodemodContext,
  statement: TS.Statement
): TextEdit {
  const start = statement.getStart()
  const lineStart = ctx.source.lastIndexOf('\n', start - 1) + 1
  let end = statement.getEnd()
  if (ctx.source[end] === '\n') end += 1
  return { start: lineStart, end, replacement: '' }
}

/**
 * The block body of a `<fnName>(async () => { ... })` wrap the codemod authors,
 * when `call` sits directly inside that callback (its nearest enclosing
 * function is the wrap's callback). Null otherwise. Lets a re-sync recognise an
 * already-wrapped run instead of wrapping it a second time.
 */
export function enclosingWrapBody(
  ctx: CodemodContext,
  call: TS.CallExpression,
  fnName: string
): TS.Block | null {
  const { ts } = ctx
  for (
    let node: TS.Node | undefined = call.parent;
    node !== undefined;
    node = node.parent
  ) {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const parent = node.parent
      if (parent !== undefined && ts.isCallExpression(parent)) {
        const callee = parent.expression
        const name = ts.isIdentifier(callee) ? callee.text : null
        if (name === fnName && ts.isBlock(node.body)) return node.body
      }
      return null
    }
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isSourceFile(node)
    ) {
      return null
    }
  }
  return null
}

/**
 * The named-import table of a module: for every `import { a, b as c } from
 * '<moduleName>'` binding, maps the local name to the exported name (`c -> b`)
 * and back (`b -> c`). Lets every callee-name match resolve through aliases,
 * so `import { autoZoom as az }` + `az(...)` is still recognised.
 */
export type ImportTable = {
  localToExport: Map<string, string>
  exportToLocal: Map<string, string>
}

/** Build the {@link ImportTable} for `moduleName` (usually `'screenci'`). */
export function importTableFor(
  ctx: CodemodContext,
  moduleName: string
): ImportTable {
  const { ts, sourceFile } = ctx
  const localToExport = new Map<string, string>()
  const exportToLocal = new Map<string, string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleName
    ) {
      continue
    }
    const bindings = statement.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      const exported = element.propertyName?.text ?? element.name.text
      const local = element.name.text
      localToExport.set(local, exported)
      if (!exportToLocal.has(exported)) exportToLocal.set(exported, local)
    }
  }
  return { localToExport, exportToLocal }
}

/**
 * The local name under which `exportName` is imported from `moduleName`, or
 * null when it is not imported as a named binding (absent, namespace import,
 * or re-exported through another module).
 */
export function resolveImportedLocalName(
  ctx: CodemodContext,
  moduleName: string,
  exportName: string
): string | null {
  return importTableFor(ctx, moduleName).exportToLocal.get(exportName) ?? null
}

/**
 * The timeline-block wrapper function names an unwrap may target. `autoZoom` is
 * included so a code-authored autoZoom can be split: the editor removes the
 * original bracket (a `blockRemoveEdit` on its stamped `editId`) and re-adds two
 * autoZoom brackets over the sub-runs. Every one of these is stamped with a
 * unique `editId`, so widening the set only ever unwraps the exact block a
 * `blockRemoveEdit` names.
 */
const UNWRAPPABLE_BLOCK_KINDS = ['hide', 'speed', 'time', 'autoZoom'] as const

/**
 * Find the timeline-block wrap call (`hide` / `speed` / `time`) identified by
 * `name`: either an `{ editId: '<name>' }` property in its options object
 * (the current identity form) or a legacy `'<name>'` string argument. The
 * callback body must be a plain block. Null when absent or ambiguous (two
 * blocks with the same identity).
 */
function findNamedBlockCall(
  ctx: CodemodContext,
  name: string
): { call: TS.CallExpression; body: TS.Block } | null {
  const { ts } = ctx
  const { localToExport } = importTableFor(ctx, 'screenci')
  const matches: Array<{ call: TS.CallExpression; body: TS.Block }> = []
  const hasEditIdOption = (call: TS.CallExpression): boolean =>
    call.arguments.some(
      (arg) =>
        ts.isObjectLiteralExpression(arg) &&
        arg.properties.some(
          (prop) =>
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'editId' &&
            ts.isStringLiteral(prop.initializer) &&
            prop.initializer.text === name
        )
    )
  const visit = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (
        ts.isIdentifier(callee) &&
        (UNWRAPPABLE_BLOCK_KINDS as readonly string[]).includes(
          localToExport.get(callee.text) ?? callee.text
        ) &&
        (node.arguments.some(
          (arg) => ts.isStringLiteral(arg) && arg.text === name
        ) ||
          hasEditIdOption(node))
      ) {
        const fn = node.arguments.find(
          (arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)
        ) as TS.ArrowFunction | TS.FunctionExpression | undefined
        if (fn !== undefined && ts.isBlock(fn.body)) {
          matches.push({ call: node, body: fn.body })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ctx.sourceFile)
  return matches.length === 1 ? matches[0]! : null
}

/**
 * Unwrap a NAMED timeline block (`hide`/`speed`/`time`): the wrapper statement
 * is replaced by the callback body's statements, dedented one level, so the
 * wrapped calls keep running (and any `waitForTimeout` pacing inside them is
 * preserved as plain gap sleeps). Conservative by design: only a named block
 * whose enclosing statement is a plain awaited expression statement is
 * unwrapped; anything else returns null (locked).
 */
export function unwrapBlockCall(
  ctx: CodemodContext,
  name: string
): TextEdit[] | null {
  const found = findNamedBlockCall(ctx, name)
  if (found === null) return null
  return unwrapWrapCallStatement(ctx, found.call, found.body)
}

/**
 * Unwrap one wrap call: replace its enclosing `await <wrap>(...)` statement
 * with the callback body's statements, dedented one level, preserving any
 * `waitForTimeout` pacing inside. Null when the statement is not exactly a
 * plain awaited expression statement of that call.
 */
export function unwrapWrapCallStatement(
  ctx: CodemodContext,
  call: TS.CallExpression,
  body: TS.Block
): TextEdit[] | null {
  const { ts } = ctx
  const statement = enclosingStatement(ctx, call)
  if (statement === null || !ts.isExpressionStatement(statement)) return null
  // The statement must be exactly `await <kind>(...)`: a wrap nested in other
  // expressions is not a mechanical unwrap.
  const expr = statement.expression
  if (!ts.isAwaitExpression(expr) || expr.expression !== call) return null
  const inner = body.statements
  const whole = removeFullLine(ctx, statement)
  if (inner.length === 0) return [whole]
  // Replace the wrapper's physical lines with the inner statements' text,
  // dedented by the indentation difference between the wrapper and its body.
  const stmtStart = statement.getStart()
  const stmtLineStart = ctx.source.lastIndexOf('\n', stmtStart - 1) + 1
  const stmtIndent = ctx.source.slice(stmtLineStart, stmtStart)
  const firstInnerStart = inner[0]!.getStart()
  const firstInnerLineStart =
    ctx.source.lastIndexOf('\n', firstInnerStart - 1) + 1
  const innerIndent = ctx.source.slice(firstInnerLineStart, firstInnerStart)
  const dedent =
    innerIndent.startsWith(stmtIndent) && innerIndent.length > stmtIndent.length
      ? innerIndent.slice(stmtIndent.length)
      : ''
  const innerText = ctx.source.slice(
    firstInnerLineStart,
    inner[inner.length - 1]!.getEnd()
  )
  const dedented = innerText
    .split('\n')
    .map((line) =>
      dedent !== '' && line.startsWith(dedent)
        ? line.slice(dedent.length)
        : line
    )
    .join('\n')
  return [{ start: whole.start, end: whole.end, replacement: `${dedented}\n` }]
}

/**
 * A contiguous run of statements `from..until` that are direct siblings in the
 * same plain block (or source file), or null when they are not (different
 * blocks, or `until` precedes `from`). Contiguity is guaranteed by them being
 * siblings; the caller wraps that whole run.
 */
export function sameBlockRun(
  ctx: CodemodContext,
  from: TS.Statement,
  until: TS.Statement
): { statements: TS.Statement[] } | null {
  if (from.parent !== until.parent) return null
  const statements = siblingStatements(ctx, from)
  if (statements === null) return null
  const fromIndex = statements.indexOf(from)
  const untilIndex = statements.indexOf(until)
  if (fromIndex === -1 || untilIndex === -1 || untilIndex < fromIndex) {
    return null
  }
  return { statements: statements.slice(fromIndex, untilIndex + 1) }
}

/**
 * The call carrying `editId` when it sits on an editable, linear call site:
 * exactly one occurrence in the file, and every ancestor up to the enclosing
 * function/arrow body is a plain block (no for/while/if/switch/ternary/case).
 * Returns null when the slug is missing, ambiguous, or locked in control flow
 * (a loop repeat or a branch): such sections are shown but never a codemod
 * target.
 */
export function isLinearCallSite(
  ctx: CodemodContext,
  editId: string
): TS.CallExpression | null {
  const { ts } = ctx
  const call = findCallByEditId(ctx, editId)
  if (call === null) return null
  for (
    let node: TS.Node | undefined = call.parent;
    node !== undefined;
    node = node.parent
  ) {
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isSourceFile(node)
    ) {
      // Reached the enclosing function body without hitting control flow.
      return call
    }
    if (
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isIfStatement(node) ||
      ts.isSwitchStatement(node) ||
      ts.isCaseClause(node) ||
      ts.isDefaultClause(node) ||
      ts.isConditionalExpression(node)
    ) {
      return null
    }
  }
  return null
}

/**
 * Wrap the statement run `from..until` (must be same-block siblings) in a block
 * call: insert `<header>` before `from` and `})` after `until`, with optional
 * `leadLine` as the first inner statement and `trailLine` as the last. The
 * inner statements keep their text and indentation; only the bracket lines are
 * inserted. Returns the two edits, or null when they are not a same-block run.
 */
export function wrapStatementsInBlock(
  ctx: CodemodContext,
  from: TS.Statement,
  until: TS.Statement,
  header: string,
  opts: {
    leadLine?: string | undefined
    trailLine?: string | undefined
    footerClose?: string | undefined
  } = {}
): TextEdit[] | null {
  if (sameBlockRun(ctx, from, until) === null) return null
  const indent = statementIndent(ctx, from)
  const footerClose = opts.footerClose ?? '})'
  const open =
    `${header}\n${indent}` +
    (opts.leadLine !== undefined ? `${opts.leadLine}\n${indent}` : '')
  const close =
    `\n${indent}` +
    (opts.trailLine !== undefined ? `${opts.trailLine}\n${indent}` : '') +
    footerClose
  const start = from.getStart()
  const end = until.getEnd()
  return [
    { start, end: start, replacement: open },
    { start: end, end, replacement: close },
  ]
}

/** Insert one or more statements, each on its own line, after `statement`. */
export function insertStatementsAfter(
  ctx: CodemodContext,
  statement: TS.Statement,
  codes: string[]
): TextEdit {
  const indent = statementIndent(ctx, statement)
  const end = statement.getEnd()
  const text = codes
    .filter((code) => code.length > 0)
    .map((code) => `\n${indent}${code}`)
    .join('')
  return { start: end, end, replacement: text }
}

/**
 * Split an existing `waitForTimeout(N)` gap so an item can sit inside it: the
 * numeric literal becomes `beforeMs`, and a new `await <root>.waitForTimeout(N
 * - beforeMs)` is inserted right after the item lands. Returns the edit that
 * shrinks the existing sleep plus the source text for the trailing remainder
 * sleep (empty when the split leaves nothing after). The caller places the
 * remainder after the inserted item.
 */
export function splitWaitEdit(
  ctx: CodemodContext,
  waitArg: TS.NumericLiteral,
  beforeMs: number,
  root: string
): { shrink: TextEdit; remainderCode: string } {
  const total = Number(waitArg.text)
  const remainder = Math.max(0, total - beforeMs)
  return {
    shrink: {
      start: waitArg.getStart(),
      end: waitArg.getEnd(),
      replacement: String(beforeMs),
    },
    remainderCode:
      remainder > 0 ? `await ${root}.waitForTimeout(${remainder})` : '',
  }
}

/**
 * The first call expression inside a node whose callee is (or ends with) the
 * given name, e.g. `click` matches `page.getByRole(...).click(...)` and
 * `autoZoom` matches `autoZoom(async () => {...})`.
 */
export function findCallNamed(
  ctx: CodemodContext,
  root: TS.Node,
  name: string
): TS.CallExpression | null {
  const { ts } = ctx
  let found: TS.CallExpression | null = null
  const visit = (node: TS.Node): void => {
    if (found !== null) return
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const calleeName = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : null
      if (calleeName === name) {
        found = node
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

/** The indentation (leading whitespace) of the line a statement starts on. */
function statementIndent(ctx: CodemodContext, statement: TS.Statement): string {
  const start = statement.getStart()
  const lineStart = ctx.source.lastIndexOf('\n', start - 1) + 1
  const prefix = ctx.source.slice(lineStart, start)
  return /^\s*$/.test(prefix) ? prefix : ''
}

/** Insert `code` as a new statement on its own line before `statement`. */
export function insertStatementBefore(
  ctx: CodemodContext,
  statement: TS.Statement,
  code: string
): TextEdit {
  const indent = statementIndent(ctx, statement)
  const start = statement.getStart()
  return { start, end: start, replacement: `${code}\n${indent}` }
}

/** Insert `code` as a new statement on its own line after `statement`. */
export function insertStatementAfter(
  ctx: CodemodContext,
  statement: TS.Statement,
  code: string
): TextEdit {
  const indent = statementIndent(ctx, statement)
  const end = statement.getEnd()
  return { start: end, end, replacement: `\n${indent}${code}` }
}

/**
 * Ensure the export `importName` is available among the named imports from
 * `moduleName`. When it is already imported (possibly under an alias, e.g.
 * `import { autoZoom as az }`), returns no edits and the existing local name
 * so the caller reuses the alias. Otherwise returns a single edit appending it
 * to an existing named-import list. Null when the file has no editable named
 * import from that module (absent or namespace-only import).
 */
export function ensureNamedImport(
  ctx: CodemodContext,
  moduleName: string,
  importName: string
): { edits: TextEdit[]; localName: string } | null {
  const { ts, sourceFile } = ctx
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleName
    ) {
      continue
    }
    const bindings = statement.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    const existing = bindings.elements.find(
      (element) =>
        (element.propertyName?.text ?? element.name.text) === importName
    )
    if (existing !== undefined) {
      return { edits: [], localName: existing.name.text }
    }
    if (bindings.elements.length === 0) continue
    const last = bindings.elements[bindings.elements.length - 1]!
    return {
      edits: [
        {
          start: last.getEnd(),
          end: last.getEnd(),
          replacement: `, ${importName}`,
        },
      ],
      localName: importName,
    }
  }
  return null
}

/**
 * The single `video('<name>', ...)` builder call for `videoName`: a call whose
 * FIRST argument is the string literal `videoName` and whose callee chain's
 * leftmost identifier is `video`. Supports every builder form:
 * `video('N', fn)`, `video.narration([...])('N', fn)`,
 * `video.renderOptions({...}).recordOptions({...})('N', fn)`. Null when the
 * declaration is absent or (duplicated in one file) ambiguous, so the caller
 * never edits a chain it cannot pin down.
 */
export function findVideoCall(
  ctx: CodemodContext,
  videoName: string
): TS.CallExpression | null {
  const { ts, sourceFile } = ctx
  const matches: TS.CallExpression[] = []
  const visit = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      const first = node.arguments[0]
      if (
        first !== undefined &&
        ts.isStringLiteral(first) &&
        first.text === videoName &&
        chainRootIdentifier(ts, node.expression) === 'video'
      ) {
        matches.push(node)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return matches.length === 1 ? matches[0]! : null
}

/**
 * The `.<method>(<arg>)` call already present in `callee`'s chain (e.g. the
 * existing `.renderOptions({...})` of a video builder), or null when the chain
 * has no such call. Walks the property/call chain from the outside in.
 */
export function findMethodCallInChain(
  ts: TsModule,
  callee: TS.Expression,
  method: string
): TS.CallExpression | null {
  let current: TS.Expression = callee
  for (;;) {
    if (ts.isCallExpression(current)) {
      const inner = current.expression
      if (ts.isPropertyAccessExpression(inner) && inner.name.text === method) {
        return current
      }
      current = current.expression
    } else if (ts.isPropertyAccessExpression(current)) {
      current = current.expression
    } else if (ts.isNonNullExpression(current)) {
      current = current.expression
    } else {
      return null
    }
  }
}

/** Flatten a plain-object value to `{ path, value }` leaves (arrays are leaves). */
function optionLeaves(
  value: Record<string, unknown>,
  prefix: string[] = []
): Array<{ path: string[]; value: unknown }> {
  const leaves: Array<{ path: string[]; value: unknown }> = []
  for (const [key, entryValue] of Object.entries(value)) {
    const path = [...prefix, key]
    if (
      entryValue !== null &&
      typeof entryValue === 'object' &&
      !Array.isArray(entryValue)
    ) {
      leaves.push(...optionLeaves(entryValue as Record<string, unknown>, path))
    } else {
      leaves.push({ path, value: entryValue })
    }
  }
  return leaves
}

/**
 * Merge `valueObject`'s leaves into the source text of an object literal,
 * reusing `setOptionValue`'s deep-set logic. Returns the new object-literal
 * source, or null when any leaf resists a mechanical edit (spread, shorthand,
 * non-literal nesting, non-JSON value). Same-value merges return the input
 * unchanged (idempotent).
 */
function mergeObjectLiteralText(
  ts: TsModule,
  objectText: string,
  valueObject: Record<string, unknown>
): string | null {
  let text = objectText
  for (const leaf of optionLeaves(valueObject)) {
    const source = `__m(${text})`
    const ctx = createContext(ts, 'merge.ts', source)
    const statement = ctx.sourceFile.statements[0]
    if (statement === undefined || !ts.isExpressionStatement(statement)) {
      return null
    }
    const call = statement.expression
    if (!ts.isCallExpression(call)) return null
    const edit = setOptionValue(ctx, call, 0, leaf.path, leaf.value)
    if (edit === null) return null
    const newSource = applyTextEdits(source, [edit])
    const reparsed = createContext(ts, 'merge.ts', newSource)
    const reStatement = reparsed.sourceFile.statements[0]
    if (reStatement === undefined || !ts.isExpressionStatement(reStatement)) {
      return null
    }
    const reCall = reStatement.expression
    if (!ts.isCallExpression(reCall)) return null
    const arg = reCall.arguments[0]
    if (arg === undefined) return null
    text = newSource.slice(arg.getStart(), arg.getEnd())
  }
  return text
}

/**
 * Codify a Studio render/record option set onto a video builder call: either
 * update an existing `.<method>({...})` object literal (deep-merging the given
 * keys) or insert `.<method>(<object>)` into the chain immediately before the
 * final `('<name>', fn)` call. `method` is `renderOptions` or `recordOptions`.
 *
 * Conservative by design: returns null when the video declaration is missing or
 * ambiguous, when the value is not JSON-serialisable, or when an existing
 * `.<method>()` argument is not a plain object literal (a spread or a variable).
 * Never mangles a chain it does not fully understand. Idempotent: re-applying
 * the same values produces no edit.
 */
export function setBuilderOptions(
  ctx: CodemodContext,
  videoName: string,
  method: 'renderOptions' | 'recordOptions',
  valueObject: Record<string, unknown>
): TextEdit[] | null {
  const { ts } = ctx
  const call = findVideoCall(ctx, videoName)
  if (call === null) return null
  const existing = findMethodCallInChain(ts, call.expression, method)
  if (existing !== null) {
    const arg = existing.arguments[0]
    if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return null
    const objectText = ctx.source.slice(arg.getStart(), arg.getEnd())
    const merged = mergeObjectLiteralText(ts, objectText, valueObject)
    if (merged === null) return null
    if (merged === objectText) return [] // idempotent no-op
    return [{ start: arg.getStart(), end: arg.getEnd(), replacement: merged }]
  }
  const valueSource = valueToSource(valueObject)
  if (valueSource === null) return null
  const insertAt = call.expression.getEnd()
  return [
    {
      start: insertAt,
      end: insertAt,
      replacement: `.${method}(${valueSource})`,
    },
  ]
}

/**
 * The string-literal elements of an array literal, or null when any element is
 * not a plain string literal (a spread, identifier, or nested expression).
 */
function stringArrayElements(
  ts: TsModule,
  array: TS.ArrayLiteralExpression
): string[] | null {
  const values: string[] = []
  for (const element of array.elements) {
    if (!ts.isStringLiteralLike(element)) return null
    values.push(element.text)
  }
  return values
}

/**
 * Order-preserving union of an existing language array with a desired set: the
 * existing elements keep their order, then any desired language not already
 * present is appended in the order given.
 */
function unionLanguages(existing: string[], desired: string[]): string[] {
  const result = [...existing]
  for (const lang of desired) {
    if (!result.includes(lang)) result.push(lang)
  }
  return result
}

/**
 * Write the desired language set into the `video.languages(...)` declaration of
 * `videoName`: create a `.languages([...])` call when missing, extend an
 * existing array literal (order-preserving union), or merge into the
 * `languages` array of an object-config declaration (`{ languages: [...] }`),
 * adding the property when absent.
 *
 * Conservative by design: returns null when the video declaration is missing or
 * ambiguous, or when an existing `.languages()` argument (or its `languages`
 * property) is not a plain array of string literals. Idempotent: re-applying a
 * subset already present produces no edit.
 */
export function setVideoLanguages(
  ctx: CodemodContext,
  videoName: string,
  languages: string[]
): TextEdit[] | null {
  const { ts } = ctx
  const call = findVideoCall(ctx, videoName)
  if (call === null) return null
  const arraySource = (langs: string[]): string =>
    `[${langs.map((lang) => valueToSource(lang)).join(', ')}]`
  const existing = findMethodCallInChain(ts, call.expression, 'languages')
  if (existing === null) {
    const insertAt = call.expression.getEnd()
    return [
      {
        start: insertAt,
        end: insertAt,
        replacement: `.languages(${arraySource(languages)})`,
      },
    ]
  }
  const arg = existing.arguments[0]
  if (arg === undefined) {
    // `video.languages()` with no argument: seed it with the desired set.
    const insertAt = arg === undefined ? existing.getEnd() - 1 : 0
    return [
      { start: insertAt, end: insertAt, replacement: arraySource(languages) },
    ]
  }
  if (ts.isArrayLiteralExpression(arg)) {
    const current = stringArrayElements(ts, arg)
    if (current === null) return null
    const merged = unionLanguages(current, languages)
    if (
      merged.length === current.length &&
      merged.every((lang, index) => lang === current[index])
    ) {
      return [] // idempotent no-op
    }
    return [
      {
        start: arg.getStart(),
        end: arg.getEnd(),
        replacement: arraySource(merged),
      },
    ]
  }
  if (ts.isObjectLiteralExpression(arg)) {
    const { property, unsafe } = findProperty(ts, arg, 'languages')
    if (unsafe) return null
    if (property === null) {
      return [insertPropertyEdit(arg, `languages: ${arraySource(languages)}`)]
    }
    const initializer = property.initializer
    if (!ts.isArrayLiteralExpression(initializer)) return null
    const current = stringArrayElements(ts, initializer)
    if (current === null) return null
    const merged = unionLanguages(current, languages)
    if (
      merged.length === current.length &&
      merged.every((lang, index) => lang === current[index])
    ) {
      return []
    }
    return [
      {
        start: initializer.getStart(),
        end: initializer.getEnd(),
        replacement: arraySource(merged),
      },
    ]
  }
  return null
}

/**
 * Declare an editor-uploaded media item as backend-hosted in a
 * `video.<method>({...})` call (`overlays` / `narration` / `audio`), writing
 * `{ <name>: { editor: '<editorName>' } }`:
 *
 * - Missing declaration: a `.<method>({ '<name>': { editor } })` call is inserted
 *   before the terminal `('<name>', fn)` call.
 * - Names-only array (`['a', 'b']`): converted to the object form, every existing
 *   name becoming `{ editor: '<name>' }`, then the new item added.
 * - Object literal: the item property is added (or replaced when it does not
 *   already match). For a language-major narration object the marker is added
 *   into the shared `default` sub-object (created when missing), since an
 *   uploaded audio cue is language-agnostic. `isLanguageKey` identifies the
 *   language-major shape (pass it for narration; overlays/audio are flat).
 *
 * Conservative: returns null on a missing/ambiguous video declaration or a shape
 * it cannot edit mechanically. Idempotent when the marker is already present.
 */
export function setEditorMedia(
  ctx: CodemodContext,
  videoName: string,
  method: 'overlays' | 'narration' | 'audio',
  name: string,
  editorName: string,
  isLanguageKey: (key: string) => boolean = () => false
): TextEdit[] | null {
  const { ts } = ctx
  const call = findVideoCall(ctx, videoName)
  if (call === null) return null
  const markerSource = `{ editor: ${valueToSource(editorName)} }`
  const itemSource = `${propertyNameSource(name)}: ${markerSource}`
  const existing = findMethodCallInChain(ts, call.expression, method)
  if (existing === null) {
    const insertAt = call.expression.getEnd()
    return [
      {
        start: insertAt,
        end: insertAt,
        replacement: `.${method}({ ${itemSource} })`,
      },
    ]
  }
  const arg = existing.arguments[0]
  if (arg === undefined) return null
  if (ts.isArrayLiteralExpression(arg)) {
    const names = stringArrayElements(ts, arg)
    if (names === null) return null
    if (!names.includes(name)) names.push(name)
    const entries = names.map((entryName) => {
      const entryEditor = entryName === name ? editorName : entryName
      return `${propertyNameSource(entryName)}: { editor: ${valueToSource(entryEditor)} }`
    })
    return [
      {
        start: arg.getStart(),
        end: arg.getEnd(),
        replacement: `{ ${entries.join(', ')} }`,
      },
    ]
  }
  if (!ts.isObjectLiteralExpression(arg)) return null
  const keys = objectLiteralKeys(ts, arg)
  if (keys === null) return null
  const languageMajor = keys.length > 0 && keys.every(isLanguageKey)
  if (languageMajor) {
    // Add the marker into the shared `default` sub-object (an uploaded cue is
    // language-agnostic). Create `default` when absent.
    const shared = findProperty(ts, arg, 'default')
    if (shared.unsafe) return null
    if (shared.property === null) {
      return [insertPropertyEdit(arg, `default: { ${itemSource} }`)]
    }
    if (!ts.isObjectLiteralExpression(shared.property.initializer)) return null
    const inner = shared.property.initializer
    const found = findProperty(ts, inner, name)
    if (found.unsafe) return null
    if (found.property !== null) {
      return [
        {
          start: found.property.initializer.getStart(),
          end: found.property.initializer.getEnd(),
          replacement: markerSource,
        },
      ]
    }
    return [insertPropertyEdit(inner, itemSource)]
  }
  const found = findProperty(ts, arg, name)
  if (found.unsafe) return null
  if (found.property !== null) {
    const initializer = found.property.initializer
    const currentText = ctx.source.slice(
      initializer.getStart(),
      initializer.getEnd()
    )
    if (currentText === markerSource) return [] // idempotent no-op
    return [
      {
        start: initializer.getStart(),
        end: initializer.getEnd(),
        replacement: markerSource,
      },
    ]
  }
  return [insertPropertyEdit(arg, itemSource)]
}

/** `name` when it is a plain identifier, else a quoted property name. */
function propertyNameSource(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    ? name
    : `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/**
 * The top-level property names of an object literal, or null when the literal
 * contains a spread or a computed name (its key set cannot be known
 * statically).
 */
function objectLiteralKeys(
  ts: TsModule,
  object: TS.ObjectLiteralExpression
): string[] | null {
  const keys: string[] = []
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) return null
    const name = property.name
    if (name === undefined) return null
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
      keys.push(name.text)
    } else {
      return null
    }
  }
  return keys
}

/** One narration cue value change to write into a declaration argument. */
export type NarrationValueEdit = {
  cueName: string
  /** A language code, or `'default'` for the shared value. */
  lang: string
  /**
   * True when `lang` is the video's default language: the edit targets the
   * shared (content-major or `default`) value unless the declaration carries
   * an explicit `[lang]` sub-object.
   */
  isDefault?: boolean
  value: unknown
}

/**
 * Result of {@link setNarrationValue}: computed edits (empty when already
 * up to date), `appManaged` for a names-only declaration whose content lives
 * in the web app, or `unsupported` when the declaration resists a mechanical
 * edit.
 */
export type NarrationValueResult =
  | { kind: 'edits'; edits: TextEdit[] }
  | { kind: 'appManaged' }
  | { kind: 'unsupported' }

/** Merge one cue value into a `name -> value` object literal. */
function mergeCueIntoObject(
  ctx: CodemodContext,
  object: TS.ObjectLiteralExpression,
  edit: NarrationValueEdit,
  valueSource: string
): NarrationValueResult {
  const { ts } = ctx
  const { property, unsafe } = findProperty(ts, object, edit.cueName)
  if (unsafe) return { kind: 'unsupported' }
  if (property === null) {
    return {
      kind: 'edits',
      edits: [
        insertPropertyEdit(
          object,
          `${propertyNameSource(edit.cueName)}: ${valueSource}`
        ),
      ],
    }
  }
  const initializer = property.initializer
  // Object (or string, onto an object cue) value onto an existing object
  // literal: deep-merge only the sent keys, so an edited cue text keeps a
  // declared voice or volume, and vice versa.
  const mergeValue: Record<string, unknown> | null =
    typeof edit.value === 'object' &&
    edit.value !== null &&
    !Array.isArray(edit.value)
      ? (edit.value as Record<string, unknown>)
      : typeof edit.value === 'string'
        ? { cue: edit.value }
        : null
  if (mergeValue !== null && ts.isObjectLiteralExpression(initializer)) {
    const objectText = ctx.source.slice(
      initializer.getStart(),
      initializer.getEnd()
    )
    const merged = mergeObjectLiteralText(ts, objectText, mergeValue)
    if (merged === null) return { kind: 'unsupported' }
    if (merged === objectText) return { kind: 'edits', edits: [] }
    return {
      kind: 'edits',
      edits: [
        {
          start: initializer.getStart(),
          end: initializer.getEnd(),
          replacement: merged,
        },
      ],
    }
  }
  // Plain replacement otherwise: string onto string, and the shape upgrades
  // (string value onto an object, object value onto a plain string).
  if (
    typeof edit.value === 'string' &&
    ts.isStringLiteralLike(initializer) &&
    initializer.text === edit.value
  ) {
    return { kind: 'edits', edits: [] } // idempotent no-op
  }
  return {
    kind: 'edits',
    edits: [
      {
        start: initializer.getStart(),
        end: initializer.getEnd(),
        replacement: valueSource,
      },
    ],
  }
}

/**
 * Write one narration cue value into the `video.narration(...)` declaration
 * of `videoName`, handling every declaration shape (see declare.ts):
 *
 * - Declaration missing: a `.narration({...})` call is appended to the chain,
 *   content-major for a default-language edit and language-major otherwise.
 * - Content-major object: the cue is merged in place for a default-language
 *   edit; editing a non-default language rewrites the argument to the
 *   language-major form, with the existing object text preserved verbatim
 *   under `default`.
 * - Language-major object: the cue is merged into the language's sub-object
 *   when present. A default-language edit without an explicit `[lang]` key
 *   targets the shared `default` sub-object (added when missing); any other
 *   missing language key is added.
 * - Names-only array: content is app-managed by design; reported as such.
 *
 * Conservative by design: `unsupported` whenever the declaration or the video
 * call resists a mechanical edit (missing/ambiguous declaration, spreads,
 * shorthand properties, non-literal arguments). Idempotent: re-applying the
 * same value produces no edit.
 */
export function setNarrationValue(
  ctx: CodemodContext,
  videoName: string,
  edit: NarrationValueEdit,
  isLanguageKey: (key: string) => boolean
): NarrationValueResult {
  return setDeclarationValue(
    ctx,
    videoName,
    'narration',
    edit,
    isLanguageKey,
    () => ({
      kind: 'appManaged',
    })
  )
}

/**
 * Write one on-screen `values` field value into the `video.values(...)`
 * declaration of `videoName`. Behaves exactly like {@link setNarrationValue}
 * with one difference: a names-only array declaration (`values(['title'])`) is
 * CONVERTED to an object literal (the listed fields become properties, the
 * edited field seeded with its value and the rest with empty strings) instead
 * of being reported as app-managed. There is no backend store of overrides
 * anymore, so conversion is the only way the field stays editable from code.
 */
export function setValuesValue(
  ctx: CodemodContext,
  videoName: string,
  edit: NarrationValueEdit,
  isLanguageKey: (key: string) => boolean
): NarrationValueResult {
  const { ts } = ctx
  return setDeclarationValue(
    ctx,
    videoName,
    'values',
    edit,
    isLanguageKey,
    (arg) => convertNamesOnlyValuesArray(ctx, ts, arg, edit)
  )
}

/**
 * Convert a names-only `values([...])` array literal into an object literal.
 * Every listed field name becomes a property: the edited field gets its new
 * value, the others empty strings. Refuses (`unsupported`) when the array
 * holds anything but plain string literals.
 */
function convertNamesOnlyValuesArray(
  ctx: CodemodContext,
  ts: TsModule,
  arg: TS.ArrayLiteralExpression,
  edit: NarrationValueEdit
): NarrationValueResult {
  const names: string[] = []
  for (const element of arg.elements) {
    if (!ts.isStringLiteralLike(element)) return { kind: 'unsupported' }
    names.push(element.text)
  }
  if (!names.includes(edit.cueName)) names.push(edit.cueName)
  const valueSource = valueToSource(edit.value)
  if (valueSource === null) return { kind: 'unsupported' }
  const entries = names.map((name) => {
    const rendered = name === edit.cueName ? valueSource : `''`
    return `${propertyNameSource(name)}: ${rendered}`
  })
  return {
    kind: 'edits',
    edits: [
      {
        start: arg.getStart(),
        end: arg.getEnd(),
        replacement: `{ ${entries.join(', ')} }`,
      },
    ],
  }
}

/** Shared implementation of {@link setNarrationValue} and {@link setValuesValue}. */
function setDeclarationValue(
  ctx: CodemodContext,
  videoName: string,
  method: 'narration' | 'values',
  edit: NarrationValueEdit,
  isLanguageKey: (key: string) => boolean,
  namesOnlyArray: (arg: TS.ArrayLiteralExpression) => NarrationValueResult
): NarrationValueResult {
  const { ts } = ctx
  // A `{ cue }` object with no other keys is the plain-string spelling: keep
  // declarations minimal (a text edit never upgrades a string cue to an
  // object).
  if (
    typeof edit.value === 'object' &&
    edit.value !== null &&
    !Array.isArray(edit.value)
  ) {
    const valueKeys = Object.keys(edit.value)
    const cueOnly = (edit.value as { cue?: unknown }).cue
    if (
      valueKeys.length === 1 &&
      valueKeys[0] === 'cue' &&
      typeof cueOnly === 'string'
    ) {
      edit = { ...edit, value: cueOnly }
    }
  }
  const valueSource = valueToSource(edit.value)
  if (valueSource === null) return { kind: 'unsupported' }
  const call = findVideoCall(ctx, videoName)
  if (call === null) return { kind: 'unsupported' }
  const cueProp = propertyNameSource(edit.cueName)
  const langProp = propertyNameSource(edit.lang)
  const isDefault = edit.isDefault === true || edit.lang === 'default'
  const existing = findMethodCallInChain(ts, call.expression, method)
  if (existing === null) {
    const objectSource = isDefault
      ? `{ ${cueProp}: ${valueSource} }`
      : `{ ${langProp}: { ${cueProp}: ${valueSource} } }`
    const insertAt = call.expression.getEnd()
    return {
      kind: 'edits',
      edits: [
        {
          start: insertAt,
          end: insertAt,
          replacement: `.${method}(${objectSource})`,
        },
      ],
    }
  }
  const arg = existing.arguments[0]
  if (arg === undefined) return { kind: 'unsupported' }
  if (ts.isArrayLiteralExpression(arg)) return namesOnlyArray(arg)
  if (!ts.isObjectLiteralExpression(arg)) return { kind: 'unsupported' }
  const keys = objectLiteralKeys(ts, arg)
  if (keys === null) return { kind: 'unsupported' }
  const languageMajor = keys.length > 0 && keys.every(isLanguageKey)
  if (!languageMajor) {
    if (isDefault || keys.length === 0) {
      if (keys.length === 0 && !isDefault) {
        // Empty declaration: start it directly in the language-major form.
        return {
          kind: 'edits',
          edits: [
            {
              start: arg.getStart(),
              end: arg.getEnd(),
              replacement: `{ ${langProp}: { ${cueProp}: ${valueSource} } }`,
            },
          ],
        }
      }
      return mergeCueIntoObject(ctx, arg, edit, valueSource)
    }
    // Content-major declaration edited in a specific language: convert to the
    // language-major form, keeping the existing object text verbatim as the
    // shared `default` values.
    const existingText = ctx.source.slice(arg.getStart(), arg.getEnd())
    return {
      kind: 'edits',
      edits: [
        {
          start: arg.getStart(),
          end: arg.getEnd(),
          replacement:
            `{ default: ${existingText}, ` +
            `${langProp}: { ${cueProp}: ${valueSource} } }`,
        },
      ],
    }
  }
  // Language-major: an explicit `[lang]` sub-object wins; a default-language
  // edit without one targets the shared `default` sub-object.
  const explicit = findProperty(ts, arg, edit.lang)
  if (explicit.unsafe) return { kind: 'unsupported' }
  let property = explicit.property
  let targetProp = langProp
  if (property === null && isDefault && edit.lang !== 'default') {
    const shared = findProperty(ts, arg, 'default')
    if (shared.unsafe) return { kind: 'unsupported' }
    property = shared.property
    targetProp = 'default'
  }
  if (property === null) {
    return {
      kind: 'edits',
      edits: [
        insertPropertyEdit(
          arg,
          `${targetProp}: { ${cueProp}: ${valueSource} }`
        ),
      ],
    }
  }
  if (!ts.isObjectLiteralExpression(property.initializer)) {
    return { kind: 'unsupported' }
  }
  return mergeCueIntoObject(ctx, property.initializer, edit, valueSource)
}

/**
 * Remove the named top-level keys from an object-literal source text. Missing
 * keys are skipped. Returns the new source, or null when the object resists a
 * mechanical edit (spreads, shorthand properties, not a plain literal).
 */
function removeObjectLiteralKeys(
  ts: TsModule,
  objectText: string,
  keys: readonly string[]
): string | null {
  let text = objectText
  for (const key of keys) {
    const source = `__m(${text})`
    const ctx = createContext(ts, 'merge.ts', source)
    const statement = ctx.sourceFile.statements[0]
    if (statement === undefined || !ts.isExpressionStatement(statement)) {
      return null
    }
    const call = statement.expression
    if (!ts.isCallExpression(call)) return null
    const arg = call.arguments[0]
    if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return null
    const { property, unsafe } = findProperty(ts, arg, key)
    if (unsafe) return null
    if (property === null) continue // key absent: nothing to remove
    const edit =
      arg.properties.length > 1
        ? removePropertyEdit(arg, property)
        : // Only property: an empty object literal stays valid here (unlike a
          // removable options argument), so collapse to `{}`.
          { start: arg.getStart(), end: arg.getEnd(), replacement: '{}' }
    const newSource = applyTextEdits(source, [edit])
    const reparsed = createContext(ts, 'merge.ts', newSource)
    const reStatement = reparsed.sourceFile.statements[0]
    if (reStatement === undefined || !ts.isExpressionStatement(reStatement)) {
      return null
    }
    const reCall = reStatement.expression
    if (!ts.isCallExpression(reCall)) return null
    const reArg = reCall.arguments[0]
    if (reArg === undefined) return null
    text = newSource.slice(reArg.getStart(), reArg.getEnd())
  }
  return text
}

/** The placement-variant keys of an overlay config, for stale-key cleanup. */
const OVERLAY_BOX_KEYS = [
  'x',
  'y',
  'width',
  'height',
  'relativeTo',
  'aspectRatio',
] as const

/**
 * The top-level keys that become stale when `props` (one placement variant)
 * is merged into an overlay declaration, so the result stays a single valid
 * placement variant:
 * - merging `fill` removes every box key (and would remove `over`/`margin`,
 *   but the caller refuses `fill` on an `over` declaration entirely);
 * - merging box keys removes `fill` and the opposite dimension;
 * - merging `margin` alone removes nothing.
 */
function staleOverlayKeys(props: Record<string, unknown>): string[] {
  const keys = new Set<string>()
  if ('fill' in props) {
    for (const key of OVERLAY_BOX_KEYS) keys.add(key)
  }
  if (OVERLAY_BOX_KEYS.some((key) => key in props)) {
    keys.add('fill')
    if ('width' in props) keys.add('height')
    if ('height' in props) keys.add('width')
  }
  for (const key of Object.keys(props)) keys.delete(key)
  return [...keys]
}

/**
 * Merge placement props into one overlay's declaration inside the
 * `video.overlays({...})` call of the named video. Returns the text edits, an
 * empty array when already in sync (idempotent), or null when the shape
 * resists a mechanical edit.
 *
 * Handled declaration shapes:
 * - an object-literal config (`logo: { path: ..., ... }`): props are merged
 *   and stale placement-variant keys removed;
 * - a string path shorthand (`logo: './logo.png'`): rewritten to
 *   `{ path: './logo.png', ...props }` (the shorthand meant fill-recording,
 *   so a placement edit must expand it).
 *
 * Refused (null): a missing/ambiguous video declaration, an array (studio
 * names) argument, a factory/JSX/spread/`selected(...)` declaration, free
 * placement props on a declaration that uses `over` (the box is pinned to a
 * live element), and `margin` on a declaration that does not use `over`.
 */
export function setOverlayDeclProps(
  ctx: CodemodContext,
  videoName: string,
  overlayName: string,
  props: Record<string, unknown>
): TextEdit[] | null {
  const { ts } = ctx
  if (Object.keys(props).length === 0) return []
  const videoCall = findVideoCall(ctx, videoName)
  if (videoCall === null) return null
  const overlaysCall = findMethodCallInChain(
    ts,
    videoCall.expression,
    'overlays'
  )
  if (overlaysCall === null) return null
  const arg = overlaysCall.arguments[0]
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return null
  const { property, unsafe } = findProperty(ts, arg, overlayName)
  if (property === null || unsafe) return null

  const initializer = property.initializer
  if (ts.isStringLiteral(initializer)) {
    // Path shorthand: expand to a config object carrying the new placement.
    const pathSource = ctx.source.slice(
      initializer.getStart(),
      initializer.getEnd()
    )
    if ('margin' in props) return null // margin needs an `over` declaration
    const merged = mergeObjectLiteralText(ts, `{ path: ${pathSource} }`, props)
    if (merged === null) return null
    return [
      {
        start: initializer.getStart(),
        end: initializer.getEnd(),
        replacement: merged,
      },
    ]
  }
  if (!ts.isObjectLiteralExpression(initializer)) {
    return null // factory, JSX element, selected(...), variable: refuse
  }
  const { property: overProperty, unsafe: overUnsafe } = findProperty(
    ts,
    initializer,
    'over'
  )
  if (overUnsafe) return null
  const hasOver = overProperty !== null
  const freeKeys = ['fill', ...OVERLAY_BOX_KEYS]
  if (hasOver && freeKeys.some((key) => key in props)) {
    return null // over-locked: only margin may change
  }
  if (!hasOver && 'margin' in props) {
    return null // margin without over is invalid
  }

  const objectText = ctx.source.slice(
    initializer.getStart(),
    initializer.getEnd()
  )
  const cleaned = removeObjectLiteralKeys(
    ts,
    objectText,
    staleOverlayKeys(props)
  )
  if (cleaned === null) return null
  const merged = mergeObjectLiteralText(ts, cleaned, props)
  if (merged === null) return null
  if (merged === objectText) return [] // idempotent no-op
  return [
    {
      start: initializer.getStart(),
      end: initializer.getEnd(),
      replacement: merged,
    },
  ]
}

/**
 * Minimal line diff (LCS) for dry-run output: `-` lines from `before`, `+`
 * lines from `after`, unchanged lines omitted except one line of context on
 * each side of a change.
 */
export function diffLines(before: string, after: string): string[] {
  const a = before.split('\n')
  const b = after.split('\n')
  // LCS table (files are small; O(n*m) is fine).
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  type Op = { type: ' ' | '-' | '+'; line: string }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: ' ', line: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ type: '-', line: a[i]! })
      i++
    } else {
      ops.push({ type: '+', line: b[j]! })
      j++
    }
  }
  while (i < a.length) ops.push({ type: '-', line: a[i++]! })
  while (j < b.length) ops.push({ type: '+', line: b[j++]! })
  const keep = new Set<number>()
  ops.forEach((op, index) => {
    if (op.type !== ' ') {
      keep.add(index - 1)
      keep.add(index)
      keep.add(index + 1)
    }
  })
  const lines: string[] = []
  let lastKept = -2
  ops.forEach((op, index) => {
    if (!keep.has(index)) return
    if (index > lastKept + 1) lines.push('  ...')
    lines.push(`${op.type} ${op.line}`)
    lastKept = index
  })
  if (lastKept < ops.length - 1) lines.push('  ...')
  return lines
}
