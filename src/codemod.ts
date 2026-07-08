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

/**
 * The call expression whose options carry `editId: '<slug>'`. Exact identity:
 * immune to line drift, refactors, helpers, and locator changes. Null when
 * the slug is absent or (duplicated in one file) ambiguous.
 */
export function findCallByEditId(
  ctx: CodemodContext,
  editId: string
): TS.CallExpression | null {
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
  return matches.length === 1 ? matches[0]! : null
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
  const { ts } = ctx
  const call = findCallByEditId(ctx, oldId)
  if (call === null) return null
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
  const { ts } = ctx
  if (!ts.isExpressionStatement(statement)) return null
  let expression: TS.Expression = statement.expression
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
 * Ensure `importName` is among the named imports from `moduleName`. Returns
 * [] when already imported, a single edit when it can be appended to an
 * existing named-import list, and null when the file has no editable import
 * from that module.
 */
export function ensureNamedImport(
  ctx: CodemodContext,
  moduleName: string,
  importName: string
): TextEdit[] | null {
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
    if (bindings.elements.some((element) => element.name.text === importName)) {
      return []
    }
    if (bindings.elements.length === 0) continue
    const last = bindings.elements[bindings.elements.length - 1]!
    return [
      {
        start: last.getEnd(),
        end: last.getEnd(),
        replacement: `, ${importName}`,
      },
    ]
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
function findMethodCallInChain(
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
