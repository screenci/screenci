import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import {
  applyTextEdits,
  awaitedCallHead,
  chainRootIdentifier,
  createContext,
  diffLines,
  ensureNamedImport,
  findCallNamed,
  insertStatementAfter,
  insertStatementBefore,
  removeFullLine,
  removeOption,
  setBuilderOptions,
  setOptionValue,
  setOverlayDeclProps,
  statementAtLine,
  statementsAfter,
  valueToSource,
  type CodemodContext,
  type TextEdit,
} from './codemod.js'

function ctxOf(source: string): CodemodContext {
  return createContext(ts, 'test.screenci.ts', source)
}

function callNamed(ctx: CodemodContext, method: string) {
  return findCallNamed(ctx, ctx.sourceFile, method)!
}

function applied(source: string, edit: TextEdit | null): string {
  expect(edit).not.toBeNull()
  return applyTextEdits(source, [edit!])
}

describe('applyTextEdits', () => {
  it('applies edits back to front', () => {
    const result = applyTextEdits('abcdef', [
      { start: 1, end: 2, replacement: 'B' },
      { start: 4, end: 5, replacement: 'E' },
    ])
    expect(result).toBe('aBcdEf')
  })

  it('allows zero-length inserts at the same position in order', () => {
    const result = applyTextEdits('ab', [
      { start: 1, end: 1, replacement: 'x' },
      { start: 1, end: 1, replacement: 'y' },
    ])
    expect(result).toBe('axyb')
  })

  it('throws on overlapping edits', () => {
    expect(() =>
      applyTextEdits('abcdef', [
        { start: 1, end: 4, replacement: 'x' },
        { start: 2, end: 5, replacement: 'y' },
      ])
    ).toThrow('Overlapping text edits')
  })
})

describe('valueToSource', () => {
  it('renders primitives in single-quote style', () => {
    expect(valueToSource(500)).toBe('500')
    expect(valueToSource(true)).toBe('true')
    expect(valueToSource(null)).toBe('null')
    expect(valueToSource("it's")).toBe("'it\\'s'")
  })

  it('renders objects and arrays', () => {
    expect(valueToSource({ x: 1, y: 2 })).toBe('{ x: 1, y: 2 }')
    expect(valueToSource([1, 'a'])).toBe("[1, 'a']")
  })
})

describe('setOptionValue', () => {
  it('replaces an existing literal value', () => {
    const source =
      "await page.locator('#a').click({ move: { duration: 500 } })\n"
    const ctx = ctxOf(source)
    const call = callNamed(ctx, 'click')
    const edit = setOptionValue(ctx, call, 0, ['move', 'duration'], 1200)
    expect(applied(source, edit)).toBe(
      "await page.locator('#a').click({ move: { duration: 1200 } })\n"
    )
  })

  it('creates a nested object when the path is missing', () => {
    const source = "await page.locator('#a').click({ delay: 5 })\n"
    const ctx = ctxOf(source)
    const call = callNamed(ctx, 'click')
    const edit = setOptionValue(ctx, call, 0, ['move', 'duration'], 800)
    expect(applied(source, edit)).toBe(
      "await page.locator('#a').click({ delay: 5, move: { duration: 800 } })\n"
    )
  })

  it('adds the options argument when missing (index 0)', () => {
    const source = "await page.locator('#a').click()\n"
    const ctx = ctxOf(source)
    const call = callNamed(ctx, 'click')
    const edit = setOptionValue(ctx, call, 0, ['position'], { x: 1, y: 2 })
    expect(applied(source, edit)).toBe(
      "await page.locator('#a').click({ position: { x: 1, y: 2 } })\n"
    )
  })

  it('adds the options argument after a required argument (index 1)', () => {
    const source = "await page.locator('#a').fill('Jane')\n"
    const ctx = ctxOf(source)
    const call = callNamed(ctx, 'fill')
    const edit = setOptionValue(ctx, call, 1, ['duration'], 900)
    expect(applied(source, edit)).toBe(
      "await page.locator('#a').fill('Jane', { duration: 900 })\n"
    )
  })

  it('preserves comments and multi-line formatting around the edit', () => {
    const source = [
      "await page.locator('#a').click({",
      '  // keep me',
      '  move: {',
      '    duration: 500, // and me',
      '  },',
      '})',
      '',
    ].join('\n')
    const ctx = ctxOf(source)
    const call = callNamed(ctx, 'click')
    const edit = setOptionValue(ctx, call, 0, ['move', 'duration'], 750)
    expect(applied(source, edit)).toBe(
      source.replace('duration: 500', 'duration: 750')
    )
  })

  it('returns null for a non-literal current value', () => {
    const source = "await page.locator('#a').click({ delay: DELAY })\n"
    const ctx = ctxOf(source)
    const call = callNamed(ctx, 'click')
    // Replacing an identifier value is allowed (we overwrite the initializer);
    // but a spread that may hide the option must refuse.
    const spreadSource = "await page.locator('#a').click({ ...base })\n"
    const spreadCtx = ctxOf(spreadSource)
    const spreadCall = findCallNamed(spreadCtx, spreadCtx.sourceFile, 'click')!
    expect(setOptionValue(spreadCtx, spreadCall, 0, ['delay'], 5)).toBeNull()
    // Options argument that is not an object literal: refuse.
    const identSource = "await page.locator('#a').click(opts)\n"
    const identCtx = ctxOf(identSource)
    const identCall = findCallNamed(identCtx, identCtx.sourceFile, 'click')!
    expect(setOptionValue(identCtx, identCall, 0, ['delay'], 5)).toBeNull()
    void call
  })
})

describe('removeOption', () => {
  function callOf(ctx: CodemodContext, method = 'click') {
    return findCallNamed(ctx, ctx.sourceFile, method)!
  }

  it('removes a property and its comma', () => {
    const source =
      "await page.locator('#a').click({ delay: 5, noWaitAfter: true })\n"
    const ctx = ctxOf(source)
    const edit = removeOption(ctx, callOf(ctx), 0, ['delay'])
    expect(applied(source, edit)).toBe(
      "await page.locator('#a').click({ noWaitAfter: true })\n"
    )
  })

  it('removes a last property including the preceding comma', () => {
    const source =
      "await page.locator('#a').click({ delay: 5, noWaitAfter: true })\n"
    const ctx = ctxOf(source)
    const edit = removeOption(ctx, callOf(ctx), 0, ['noWaitAfter'])
    expect(applied(source, edit)).toBe(
      "await page.locator('#a').click({ delay: 5 })\n"
    )
  })

  it('collapses empty nested objects up to the options argument', () => {
    const source =
      "await page.locator('#a').click({ move: { duration: 500 } })\n"
    const ctx = ctxOf(source)
    const edit = removeOption(ctx, callOf(ctx), 0, ['move', 'duration'])
    expect(applied(source, edit)).toBe("await page.locator('#a').click()\n")
  })

  it('keeps siblings when collapsing a nested object', () => {
    const source =
      "await page.locator('#a').click({ move: { duration: 500 }, delay: 5 })\n"
    const ctx = ctxOf(source)
    const edit = removeOption(ctx, callOf(ctx), 0, ['move', 'duration'])
    expect(applied(source, edit)).toBe(
      "await page.locator('#a').click({ delay: 5 })\n"
    )
  })

  it('removes an options argument at index 1 including the comma', () => {
    const source = "await page.locator('#a').fill('Jane', { duration: 900 })\n"
    const ctx = ctxOf(source)
    const edit = removeOption(ctx, callOf(ctx, 'fill'), 1, ['duration'])
    expect(applied(source, edit)).toBe(
      "await page.locator('#a').fill('Jane')\n"
    )
  })

  it('returns null when the option is missing', () => {
    const source = "await page.locator('#a').click({ delay: 5 })\n"
    const ctx = ctxOf(source)
    expect(removeOption(ctx, callOf(ctx), 0, ['noWaitAfter'])).toBeNull()
  })
})

describe('statements and inserts', () => {
  const source = [
    "video('Demo', async ({ page }) => {",
    "  await page.locator('#a').click()",
    '})',
    '',
  ].join('\n')

  it('finds the statement at a line and inserts before it', () => {
    const ctx = ctxOf(source)
    const statement = statementAtLine(ctx, 2)!
    const edit = insertStatementBefore(
      ctx,
      statement,
      'await page.waitForTimeout(500)'
    )
    expect(applyTextEdits(source, [edit])).toBe(
      [
        "video('Demo', async ({ page }) => {",
        '  await page.waitForTimeout(500)',
        "  await page.locator('#a').click()",
        '})',
        '',
      ].join('\n')
    )
  })

  it('inserts after a statement with matching indentation', () => {
    const ctx = ctxOf(source)
    const statement = statementAtLine(ctx, 2)!
    const edit = insertStatementAfter(
      ctx,
      statement,
      "placeZoom({ from: 'video:start' })"
    )
    expect(applyTextEdits(source, [edit])).toBe(
      [
        "video('Demo', async ({ page }) => {",
        "  await page.locator('#a').click()",
        "  placeZoom({ from: 'video:start' })",
        '})',
        '',
      ].join('\n')
    )
  })

  it('finds a named call inside a statement and its chain root', () => {
    const ctx = ctxOf(source)
    const statement = statementAtLine(ctx, 2)!
    const call = findCallNamed(ctx, statement, 'click')!
    expect(call).not.toBeNull()
    expect(
      chainRootIdentifier(
        ts,
        (call.expression as ts.PropertyAccessExpression).expression
      )
    ).toBe('page')
  })

  it('returns null for a line outside any block statement', () => {
    const ctx = ctxOf(source)
    expect(statementAtLine(ctx, 4)).toBeNull()
  })
})

describe('awaitedCallHead', () => {
  const source = [
    "video('Demo', async ({ page }) => {", // 1
    '  await narration.intro()', // 2
    '  await overlays.logo.start()', // 3
    "  await setBackground('#000')", // 4
    '  await page.waitForTimeout(500)', // 5
    '  const x = 1', // 6
    '})', // 7
    '',
  ].join('\n')

  it('reads the callee head, stripping a trailing .start', () => {
    const ctx = ctxOf(source)
    expect(awaitedCallHead(ctx, statementAtLine(ctx, 2)!)).toBe(
      'narration.intro'
    )
    expect(awaitedCallHead(ctx, statementAtLine(ctx, 3)!)).toBe('overlays.logo')
    expect(awaitedCallHead(ctx, statementAtLine(ctx, 4)!)).toBe('setBackground')
  })

  it('returns null for a non-awaited-call statement', () => {
    const ctx = ctxOf(source)
    expect(awaitedCallHead(ctx, statementAtLine(ctx, 6)!)).toBeNull()
  })
})

describe('statementsAfter and removeFullLine', () => {
  const source = [
    "video('Demo', async ({ page }) => {", // 1
    "  await page.locator('#a').click()", // 2
    '  await page.waitForTimeout(300)', // 3
    '  await narration.intro()', // 4
    '})', // 5
    '',
  ].join('\n')

  it('lists the sibling statements after a statement', () => {
    const ctx = ctxOf(source)
    const after = statementsAfter(ctx, statementAtLine(ctx, 2)!)
    expect(after.map((stmt) => awaitedCallHead(ctx, stmt))).toEqual([
      'page.waitForTimeout',
      'narration.intro',
    ])
  })

  it('removes a statement and its whole physical line', () => {
    const ctx = ctxOf(source)
    const edit = removeFullLine(ctx, statementAtLine(ctx, 3)!)
    expect(applyTextEdits(source, [edit])).toBe(
      [
        "video('Demo', async ({ page }) => {",
        "  await page.locator('#a').click()",
        '  await narration.intro()',
        '})',
        '',
      ].join('\n')
    )
  })
})

describe('ensureNamedImport', () => {
  it('returns [] when the name is already imported', () => {
    const ctx = ctxOf("import { video, placeZoom } from 'screenci'\n")
    expect(ensureNamedImport(ctx, 'screenci', 'placeZoom')).toEqual([])
  })

  it('appends to an existing named import', () => {
    const source = "import { video } from 'screenci'\n"
    const ctx = ctxOf(source)
    const edits = ensureNamedImport(ctx, 'screenci', 'placeZoom')!
    expect(applyTextEdits(source, edits)).toBe(
      "import { video, placeZoom } from 'screenci'\n"
    )
  })

  it('returns null when there is no import from the module', () => {
    const ctx = ctxOf("import { test } from '@playwright/test'\n")
    expect(ensureNamedImport(ctx, 'screenci', 'placeZoom')).toBeNull()
  })
})

describe('setBuilderOptions', () => {
  function applyAll(source: string, edits: TextEdit[] | null): string {
    expect(edits).not.toBeNull()
    return applyTextEdits(source, edits!)
  }

  it('inserts renderOptions into a bare video(name, fn) call', () => {
    const source = "video('Demo', async ({ page }) => {})"
    const ctx = ctxOf(source)
    const edits = setBuilderOptions(ctx, 'Demo', 'renderOptions', {
      fps: 60,
    })
    expect(applyAll(source, edits)).toBe(
      "video.renderOptions({ fps: 60 })('Demo', async ({ page }) => {})"
    )
  })

  it('inserts before the final call on a video.narration([...]) chain', () => {
    const source = "video.narration(['en'])('Demo', async () => {})"
    const ctx = ctxOf(source)
    const edits = setBuilderOptions(ctx, 'Demo', 'recordOptions', {
      headless: true,
    })
    expect(applyAll(source, edits)).toBe(
      "video.narration(['en']).recordOptions({ headless: true })('Demo', async () => {})"
    )
  })

  it('updates an existing renderOptions object literal, merging keys', () => {
    const source = "video.renderOptions({ fps: 30 })('Demo', async () => {})"
    const ctx = ctxOf(source)
    const edits = setBuilderOptions(ctx, 'Demo', 'renderOptions', {
      fps: 60,
      mouse: { size: 2 },
    })
    expect(applyAll(source, edits)).toBe(
      "video.renderOptions({ fps: 60, mouse: { size: 2 } })('Demo', async () => {})"
    )
  })

  it('is a no-op when the existing values already match', () => {
    const source = "video.renderOptions({ fps: 60 })('Demo', async () => {})"
    const ctx = ctxOf(source)
    const edits = setBuilderOptions(ctx, 'Demo', 'renderOptions', { fps: 60 })
    expect(edits).toEqual([])
  })

  it('returns null when the video declaration is ambiguous', () => {
    const source = [
      "video('Demo', async () => {})",
      "video('Demo', async () => {})",
    ].join('\n')
    const ctx = ctxOf(source)
    expect(
      setBuilderOptions(ctx, 'Demo', 'renderOptions', { fps: 60 })
    ).toBeNull()
  })

  it('returns null when the video declaration is missing', () => {
    const source = "video('Other', async () => {})"
    const ctx = ctxOf(source)
    expect(
      setBuilderOptions(ctx, 'Demo', 'renderOptions', { fps: 60 })
    ).toBeNull()
  })

  it('returns null when an existing option arg is not a plain object', () => {
    const source = "video.renderOptions(baseOptions)('Demo', async () => {})"
    const ctx = ctxOf(source)
    expect(
      setBuilderOptions(ctx, 'Demo', 'renderOptions', { fps: 60 })
    ).toBeNull()
  })
})

describe('setOverlayDeclProps', () => {
  function applyAll(source: string, edits: TextEdit[] | null): string {
    expect(edits).not.toBeNull()
    return applyTextEdits(source, edits!)
  }
  const decl = (config: string): string =>
    `video.overlays({ logo: ${config} })('Demo', async () => {})`

  it('merges box props into an object declaration, dropping fill', () => {
    const source = decl("{ path: './logo.png', fill: 'recording' }")
    const edits = setOverlayDeclProps(ctxOf(source), 'Demo', 'logo', {
      x: 96,
      y: 96,
      width: 240,
    })
    expect(applyAll(source, edits)).toBe(
      decl("{ path: './logo.png', x: 96, y: 96, width: 240 }")
    )
  })

  it('switches a box declaration to fill, dropping box keys', () => {
    const source = decl("{ path: './logo.png', x: 96, y: 96, width: 240 }")
    const edits = setOverlayDeclProps(ctxOf(source), 'Demo', 'logo', {
      fill: 'screen',
    })
    expect(applyAll(source, edits)).toBe(
      decl("{ path: './logo.png', fill: 'screen' }")
    )
  })

  it('drops the opposite dimension when switching width to height', () => {
    const source = decl("{ path: './logo.png', width: 240 }")
    const edits = setOverlayDeclProps(ctxOf(source), 'Demo', 'logo', {
      height: 120,
    })
    expect(applyAll(source, edits)).toBe(
      decl("{ path: './logo.png', height: 120 }")
    )
  })

  it('updates margin on an over declaration', () => {
    const source = decl("{ path: './ring.html', over: target, margin: 8 }")
    const edits = setOverlayDeclProps(ctxOf(source), 'Demo', 'logo', {
      margin: 16,
    })
    expect(applyAll(source, edits)).toBe(
      decl("{ path: './ring.html', over: target, margin: 16 }")
    )
  })

  it('adds margin to an over declaration that had none', () => {
    const source = decl("{ path: './ring.html', over: target }")
    const edits = setOverlayDeclProps(ctxOf(source), 'Demo', 'logo', {
      margin: 12,
    })
    expect(applyAll(source, edits)).toBe(
      decl("{ path: './ring.html', over: target, margin: 12 }")
    )
  })

  it('expands a path-string shorthand into a config with the props', () => {
    const source = decl("'./logo.png'")
    const edits = setOverlayDeclProps(ctxOf(source), 'Demo', 'logo', {
      x: 10,
      width: 200,
    })
    expect(applyAll(source, edits)).toBe(
      decl("{ path: './logo.png', x: 10, width: 200 }")
    )
  })

  it('is a no-op when the values already match', () => {
    const source = decl("{ path: './logo.png', width: 240 }")
    expect(
      setOverlayDeclProps(ctxOf(source), 'Demo', 'logo', { width: 240 })
    ).toEqual([])
  })

  it('refuses free placement props on an over declaration', () => {
    const source = decl("{ path: './ring.html', over: target }")
    expect(
      setOverlayDeclProps(ctxOf(source), 'Demo', 'logo', { width: 240 })
    ).toBeNull()
    expect(
      setOverlayDeclProps(ctxOf(source), 'Demo', 'logo', { fill: 'screen' })
    ).toBeNull()
  })

  it('refuses margin on a declaration without over', () => {
    const source = decl("{ path: './logo.png', width: 240 }")
    expect(
      setOverlayDeclProps(ctxOf(source), 'Demo', 'logo', { margin: 8 })
    ).toBeNull()
    expect(
      setOverlayDeclProps(ctxOf(decl("'./logo.png'")), 'Demo', 'logo', {
        margin: 8,
      })
    ).toBeNull()
  })

  it('refuses factory, spread, and missing declarations', () => {
    const factory = decl("(t) => ({ path: './ring.html', over: t })")
    expect(
      setOverlayDeclProps(ctxOf(factory), 'Demo', 'logo', { width: 1 })
    ).toBeNull()
    const spread = decl('{ ...base, width: 240 }')
    expect(
      setOverlayDeclProps(ctxOf(spread), 'Demo', 'logo', { width: 1 })
    ).toBeNull()
    const other = decl("{ path: './logo.png', width: 240 }")
    expect(
      setOverlayDeclProps(ctxOf(other), 'Demo', 'other', { width: 1 })
    ).toBeNull()
    const noOverlays = "video('Demo', async () => {})"
    expect(
      setOverlayDeclProps(ctxOf(noOverlays), 'Demo', 'logo', { width: 1 })
    ).toBeNull()
  })

  it('refuses an array (studio names) overlays argument', () => {
    const source = "video.overlays(['logo'])('Demo', async () => {})"
    expect(
      setOverlayDeclProps(ctxOf(source), 'Demo', 'logo', { width: 1 })
    ).toBeNull()
  })
})

describe('diffLines', () => {
  it('shows changed lines with one line of context', () => {
    const before = ['a', 'b', 'c', 'd', 'e'].join('\n')
    const after = ['a', 'b', 'C', 'd', 'e'].join('\n')
    expect(diffLines(before, after)).toEqual([
      '  ...',
      '  b',
      '- c',
      '+ C',
      '  d',
      '  ...',
    ])
  })
})
