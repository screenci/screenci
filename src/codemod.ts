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

/** The statement immediately before `statement` in its enclosing block. */
export function previousStatement(
  ctx: CodemodContext,
  statement: TS.Statement
): TS.Statement | null {
  const { ts } = ctx
  const parent = statement.parent
  if (parent === undefined) return null
  const statements = ts.isBlock(parent)
    ? parent.statements
    : ts.isSourceFile(parent)
      ? parent.statements
      : null
  if (statements === null) return null
  const index = statements.indexOf(statement)
  return index > 0 ? statements[index - 1]! : null
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
