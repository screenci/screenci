import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import {
  applyTextEdits,
  awaitedCallHead,
  chainRootIdentifier,
  classifyEditIdSite,
  collectEditIdOccurrences,
  createContext,
  diffLines,
  ensureNamedImport,
  findCallByEditId,
  findCallNamed,
  importTableFor,
  resolveImportedLocalName,
  resolvePageIdentifier,
  insertStatementAfter,
  insertStatementBefore,
  removeFullLine,
  removeOption,
  renameEditIdAtCall,
  setBuilderOptions,
  setNarrationValue,
  setValuesValue,
  setVideoLanguages,
  setEditorMedia,
  setOptionValue,
  setOverlayDeclProps,
  statementAtLine,
  statementsAfter,
  unwrapBlockCall,
  valueToSource,
  waitForTimeoutArg,
  findRecordedWait,
  mergeAdjacentWaitEdits,
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
    expect(ensureNamedImport(ctx, 'screenci', 'placeZoom')).toEqual({
      edits: [],
      localName: 'placeZoom',
    })
  })

  it('appends to an existing named import', () => {
    const source = "import { video } from 'screenci'\n"
    const ctx = ctxOf(source)
    const { edits, localName } = ensureNamedImport(
      ctx,
      'screenci',
      'placeZoom'
    )!
    expect(localName).toBe('placeZoom')
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

describe('setNarrationValue', () => {
  const isLanguageKey = (key: string): boolean =>
    key === 'default' || ['fr', 'de', 'en'].includes(key)

  function narrate(
    source: string,
    edit: { cueName: string; lang: string; isDefault?: boolean; value: unknown }
  ) {
    return setNarrationValue(ctxOf(source), 'Demo', edit, isLanguageKey)
  }

  function narrated(
    source: string,
    edit: { cueName: string; lang: string; isDefault?: boolean; value: unknown }
  ): string {
    const result = narrate(source, edit)
    expect(result.kind).toBe('edits')
    if (result.kind !== 'edits') throw new Error('unreachable')
    return applyTextEdits(source, result.edits)
  }

  it('adds a content-major .narration section when missing (default lang)', () => {
    const source = "video('Demo', async () => {})"
    expect(
      narrated(source, { cueName: 'intro', lang: 'default', value: 'Hi' })
    ).toBe("video.narration({ intro: 'Hi' })('Demo', async () => {})")
  })

  it('writes an empty-string placeholder value (added-language placeholders)', () => {
    const source = "video.narration({ intro: 'Hi' })('Demo', async () => {})"
    expect(
      narrated(source, { cueName: 'intro', lang: 'fr', value: { cue: '' } })
    ).toBe(
      "video.narration({ default: { intro: 'Hi' }, fr: { intro: '' } })" +
        "('Demo', async () => {})"
    )
  })

  it('adds a language-major .narration section when missing (specific lang)', () => {
    const source = "video.renderOptions({ fps: 30 })('Demo', async () => {})"
    expect(
      narrated(source, { cueName: 'intro', lang: 'fr', value: 'Salut' })
    ).toBe(
      'video.renderOptions({ fps: 30 })' +
        ".narration({ fr: { intro: 'Salut' } })('Demo', async () => {})"
    )
  })

  it('changes an existing content-major value in the default lang', () => {
    const source =
      "video.narration({ intro: 'Hi', cta: 'Go' })('Demo', async () => {})"
    expect(
      narrated(source, { cueName: 'intro', lang: 'default', value: 'Hello' })
    ).toBe(
      "video.narration({ intro: 'Hello', cta: 'Go' })('Demo', async () => {})"
    )
  })

  it('adds a new cue key to a content-major object', () => {
    const source = "video.narration({ intro: 'Hi' })('Demo', async () => {})"
    expect(
      narrated(source, { cueName: 'outro', lang: 'default', value: 'Bye' })
    ).toBe(
      "video.narration({ intro: 'Hi', outro: 'Bye' })('Demo', async () => {})"
    )
  })

  it('converts content-major to language-major on a non-default lang edit', () => {
    const source =
      "video.narration({ intro: 'Hi', cta: 'Go' })('Demo', async () => {})"
    expect(
      narrated(source, { cueName: 'intro', lang: 'fr', value: 'Salut' })
    ).toBe(
      "video.narration({ default: { intro: 'Hi', cta: 'Go' }, " +
        "fr: { intro: 'Salut' } })('Demo', async () => {})"
    )
  })

  it('populates an empty declaration in the language-major form', () => {
    const source = "video.narration({})('Demo', async () => {})"
    expect(
      narrated(source, { cueName: 'intro', lang: 'fr', value: 'Salut' })
    ).toBe(
      "video.narration({ fr: { intro: 'Salut' } })('Demo', async () => {})"
    )
  })

  it('merges into an existing language of a language-major object', () => {
    const source =
      "video.narration({ default: { intro: 'Hi' }, fr: { intro: 'Salut' } })" +
      "('Demo', async () => {})"
    expect(
      narrated(source, { cueName: 'intro', lang: 'fr', value: 'Coucou' })
    ).toBe(
      "video.narration({ default: { intro: 'Hi' }, fr: { intro: 'Coucou' } })" +
        "('Demo', async () => {})"
    )
  })

  it('adds a missing language key to a language-major object', () => {
    const source =
      "video.narration({ default: { intro: 'Hi' } })('Demo', async () => {})"
    expect(
      narrated(source, { cueName: 'intro', lang: 'de', value: 'Hallo' })
    ).toBe(
      "video.narration({ default: { intro: 'Hi' }, de: { intro: 'Hallo' } })" +
        "('Demo', async () => {})"
    )
  })

  it('adds a new cue to an existing language sub-object', () => {
    const source =
      "video.narration({ fr: { intro: 'Salut' } })('Demo', async () => {})"
    expect(
      narrated(source, { cueName: 'cta', lang: 'fr', value: 'Allez' })
    ).toBe(
      "video.narration({ fr: { intro: 'Salut', cta: 'Allez' } })" +
        "('Demo', async () => {})"
    )
  })

  it('updates the default sub-object of a language-major declaration', () => {
    const source =
      "video.narration({ default: { intro: 'Hi' } })('Demo', async () => {})"
    expect(
      narrated(source, { cueName: 'intro', lang: 'default', value: 'Hello' })
    ).toBe(
      "video.narration({ default: { intro: 'Hello' } })('Demo', async () => {})"
    )
  })

  it('merges an object value into an existing cue object, keeping other keys', () => {
    const source =
      "video.narration({ intro: { cue: 'Hi', volume: 0.5 } })" +
      "('Demo', async () => {})"
    expect(
      narrated(source, {
        cueName: 'intro',
        lang: 'default',
        value: { cue: 'Hello' },
      })
    ).toBe(
      "video.narration({ intro: { cue: 'Hello', volume: 0.5 } })" +
        "('Demo', async () => {})"
    )
  })

  it('keeps declared metadata when a plain text edit hits an object cue', () => {
    const source =
      "video.narration({ intro: { cue: 'Hi', volume: 0.5 } })" +
      "('Demo', async () => {})"
    expect(
      narrated(source, { cueName: 'intro', lang: 'default', value: 'Hello' })
    ).toBe(
      "video.narration({ intro: { cue: 'Hello', volume: 0.5 } })" +
        "('Demo', async () => {})"
    )
  })

  it('writes a cue-only object value as a plain string', () => {
    const source = "video.narration({ intro: 'Hi' })('Demo', async () => {})"
    expect(
      narrated(source, {
        cueName: 'intro',
        lang: 'default',
        value: { cue: 'Hello' },
      })
    ).toBe("video.narration({ intro: 'Hello' })('Demo', async () => {})")
  })

  it('upgrades a plain string cue to an object when metadata arrives', () => {
    const source = "video.narration({ intro: 'Hi' })('Demo', async () => {})"
    expect(
      narrated(source, {
        cueName: 'intro',
        lang: 'default',
        value: { cue: 'Hi', volume: 0.5 },
      })
    ).toBe(
      "video.narration({ intro: { cue: 'Hi', volume: 0.5 } })" +
        "('Demo', async () => {})"
    )
  })

  it('is a no-op when the string value already matches', () => {
    const source = "video.narration({ intro: 'Hi' })('Demo', async () => {})"
    const result = narrate(source, {
      cueName: 'intro',
      lang: 'default',
      value: 'Hi',
    })
    expect(result).toEqual({ kind: 'edits', edits: [] })
  })

  it('is a no-op when the object value already matches', () => {
    const source =
      "video.narration({ intro: { cue: 'Hi', volume: 0.5 } })" +
      "('Demo', async () => {})"
    const result = narrate(source, {
      cueName: 'intro',
      lang: 'default',
      value: { cue: 'Hi', volume: 0.5 },
    })
    expect(result).toEqual({ kind: 'edits', edits: [] })
  })

  it('reports a names-only declaration as app-managed', () => {
    const source = "video.narration(['intro', 'cta'])('Demo', async () => {})"
    expect(
      narrate(source, { cueName: 'intro', lang: 'default', value: 'Hi' })
    ).toEqual({ kind: 'appManaged' })
  })

  it('is unsupported when the declaration argument is not a literal', () => {
    const source = "video.narration(cues)('Demo', async () => {})"
    expect(
      narrate(source, { cueName: 'intro', lang: 'default', value: 'Hi' })
    ).toEqual({ kind: 'unsupported' })
  })

  it('is unsupported when the declaration contains a spread', () => {
    const source =
      "video.narration({ ...base, intro: 'Hi' })('Demo', async () => {})"
    expect(
      narrate(source, { cueName: 'intro', lang: 'default', value: 'Hello' })
    ).toEqual({ kind: 'unsupported' })
  })

  it('is unsupported when the video declaration is missing or ambiguous', () => {
    expect(
      setNarrationValue(
        ctxOf("video('Other', async () => {})"),
        'Demo',
        { cueName: 'intro', lang: 'default', value: 'Hi' },
        isLanguageKey
      )
    ).toEqual({ kind: 'unsupported' })
    const duplicated = [
      "video('Demo', async () => {})",
      "video('Demo', async () => {})",
    ].join('\n')
    expect(
      setNarrationValue(
        ctxOf(duplicated),
        'Demo',
        { cueName: 'intro', lang: 'default', value: 'Hi' },
        isLanguageKey
      )
    ).toEqual({ kind: 'unsupported' })
  })

  it('treats a default-language edit as the shared content-major value', () => {
    const source = "video.narration({ intro: 'Hi' })('Demo', async () => {})"
    expect(
      narrated(source, {
        cueName: 'intro',
        lang: 'en',
        isDefault: true,
        value: 'Hello',
      })
    ).toBe("video.narration({ intro: 'Hello' })('Demo', async () => {})")
  })

  it('prefers an explicit language key over default for a default-language edit', () => {
    const source =
      "video.narration({ default: { intro: 'Hi' }, en: { intro: 'Hey' } })" +
      "('Demo', async () => {})"
    expect(
      narrated(source, {
        cueName: 'intro',
        lang: 'en',
        isDefault: true,
        value: 'Hello',
      })
    ).toBe(
      "video.narration({ default: { intro: 'Hi' }, en: { intro: 'Hello' } })" +
        "('Demo', async () => {})"
    )
  })

  it('routes a default-language edit without an explicit key to default', () => {
    const source =
      "video.narration({ default: { intro: 'Hi' }, fr: { intro: 'Salut' } })" +
      "('Demo', async () => {})"
    expect(
      narrated(source, {
        cueName: 'intro',
        lang: 'en',
        isDefault: true,
        value: 'Hello',
      })
    ).toBe(
      "video.narration({ default: { intro: 'Hello' }, fr: { intro: 'Salut' } })" +
        "('Demo', async () => {})"
    )
  })

  it('adds a default sub-object for a default-language edit when missing', () => {
    const source =
      "video.narration({ fr: { intro: 'Salut' } })('Demo', async () => {})"
    expect(
      narrated(source, {
        cueName: 'intro',
        lang: 'en',
        isDefault: true,
        value: 'Hello',
      })
    ).toBe(
      "video.narration({ fr: { intro: 'Salut' }, default: { intro: 'Hello' } })" +
        "('Demo', async () => {})"
    )
  })

  it('starts a missing section content-major on a default-language edit', () => {
    const source = "video('Demo', async () => {})"
    expect(
      narrated(source, {
        cueName: 'intro',
        lang: 'en',
        isDefault: true,
        value: 'Hi',
      })
    ).toBe("video.narration({ intro: 'Hi' })('Demo', async () => {})")
  })

  it('quotes cue names that are not identifiers', () => {
    const source = "video('Demo', async () => {})"
    expect(
      narrated(source, {
        cueName: 'step one',
        lang: 'default',
        value: 'Hi',
      })
    ).toBe("video.narration({ 'step one': 'Hi' })('Demo', async () => {})")
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

describe('setVideoLanguages', () => {
  function applyAll(source: string, edits: TextEdit[] | null): string {
    expect(edits).not.toBeNull()
    return applyTextEdits(source, edits!)
  }

  it('inserts a .languages([...]) call when missing', () => {
    const source = "video('Demo', async () => {})"
    const edits = setVideoLanguages(ctxOf(source), 'Demo', ['en', 'fi'])
    expect(applyAll(source, edits)).toBe(
      "video.languages(['en', 'fi'])('Demo', async () => {})"
    )
  })

  it('extends an existing array literal, preserving order', () => {
    const source = "video.languages(['en', 'fi'])('Demo', async () => {})"
    const edits = setVideoLanguages(ctxOf(source), 'Demo', ['en', 'fi', 'de'])
    expect(applyAll(source, edits)).toBe(
      "video.languages(['en', 'fi', 'de'])('Demo', async () => {})"
    )
  })

  it('is a no-op when all desired languages are already present', () => {
    const source = "video.languages(['en', 'fi'])('Demo', async () => {})"
    expect(setVideoLanguages(ctxOf(source), 'Demo', ['en', 'fi'])).toEqual([])
  })

  it('merges into the languages array of an object-config declaration', () => {
    const source =
      "video.languages({ languages: ['en'], mode: 'shared' })('Demo', async () => {})"
    const edits = setVideoLanguages(ctxOf(source), 'Demo', ['en', 'fi'])
    expect(applyAll(source, edits)).toBe(
      "video.languages({ languages: ['en', 'fi'], mode: 'shared' })('Demo', async () => {})"
    )
  })

  it('adds a languages property to an object config that lacks one', () => {
    const source = "video.languages({ mode: 'shared' })('Demo', async () => {})"
    const edits = setVideoLanguages(ctxOf(source), 'Demo', ['en'])
    expect(applyAll(source, edits)).toBe(
      "video.languages({ mode: 'shared', languages: ['en'] })('Demo', async () => {})"
    )
  })

  it('returns null when the array holds a non-literal element', () => {
    const source = "video.languages([base])('Demo', async () => {})"
    expect(setVideoLanguages(ctxOf(source), 'Demo', ['en'])).toBeNull()
  })

  it('returns null when the video declaration is missing', () => {
    const source = "video('Other', async () => {})"
    expect(setVideoLanguages(ctxOf(source), 'Demo', ['en'])).toBeNull()
  })
})

describe('setValuesValue', () => {
  const isLanguageKey = (key: string): boolean =>
    key === 'default' || ['fr', 'de', 'en'].includes(key)

  function value(
    source: string,
    edit: { cueName: string; lang: string; isDefault?: boolean; value: unknown }
  ) {
    return setValuesValue(ctxOf(source), 'Demo', edit, isLanguageKey)
  }

  function valued(
    source: string,
    edit: { cueName: string; lang: string; isDefault?: boolean; value: unknown }
  ): string {
    const result = value(source, edit)
    expect(result.kind).toBe('edits')
    if (result.kind !== 'edits') throw new Error('unreachable')
    return applyTextEdits(source, result.edits)
  }

  it('adds a content-major .values section when missing (default lang)', () => {
    const source = "video('Demo', async () => {})"
    expect(
      valued(source, { cueName: 'title', lang: 'default', value: 'Hi' })
    ).toBe("video.values({ title: 'Hi' })('Demo', async () => {})")
  })

  it('converts a names-only array declaration to an object literal', () => {
    const source = "video.values(['title', 'subtitle'])('Demo', async () => {})"
    expect(
      valued(source, { cueName: 'title', lang: 'default', value: 'Hi' })
    ).toBe(
      "video.values({ title: 'Hi', subtitle: '' })('Demo', async () => {})"
    )
  })

  it('merges a field into an existing content-major object', () => {
    const source = "video.values({ title: 'Hi' })('Demo', async () => {})"
    expect(
      valued(source, { cueName: 'subtitle', lang: 'default', value: 'Yo' })
    ).toBe(
      "video.values({ title: 'Hi', subtitle: 'Yo' })('Demo', async () => {})"
    )
  })

  it('converts content-major to language-major on a non-default edit', () => {
    const source = "video.values({ title: 'Hi' })('Demo', async () => {})"
    expect(
      valued(source, { cueName: 'title', lang: 'fr', value: 'Salut' })
    ).toBe(
      "video.values({ default: { title: 'Hi' }, fr: { title: 'Salut' } })('Demo', async () => {})"
    )
  })

  it('is a no-op when the value already matches', () => {
    const source = "video.values({ title: 'Hi' })('Demo', async () => {})"
    const result = value(source, {
      cueName: 'title',
      lang: 'default',
      value: 'Hi',
    })
    expect(result).toEqual({ kind: 'edits', edits: [] })
  })
})

describe('setEditorMedia', () => {
  const isLanguageKey = (key: string): boolean =>
    key === 'default' || ['en', 'fi'].includes(key)

  function applyAll(source: string, edits: TextEdit[] | null): string {
    expect(edits).not.toBeNull()
    return applyTextEdits(source, edits!)
  }

  it('inserts an .overlays call when missing', () => {
    const source = "video('Demo', async () => {})"
    const edits = setEditorMedia(
      ctxOf(source),
      'Demo',
      'overlays',
      'logo',
      'logo'
    )
    expect(applyAll(source, edits)).toBe(
      "video.overlays({ logo: { editor: 'logo' } })('Demo', async () => {})"
    )
  })

  it('adds an item to an existing overlays object', () => {
    const source =
      "video.overlays({ hint: './hint.html' })('Demo', async () => {})"
    const edits = setEditorMedia(
      ctxOf(source),
      'Demo',
      'overlays',
      'logo',
      'logo'
    )
    expect(applyAll(source, edits)).toBe(
      "video.overlays({ hint: './hint.html', logo: { editor: 'logo' } })('Demo', async () => {})"
    )
  })

  it('converts a names-only array to the object form', () => {
    const source = "video.audio(['music'])('Demo', async () => {})"
    const edits = setEditorMedia(ctxOf(source), 'Demo', 'audio', 'sfx', 'sfx')
    expect(applyAll(source, edits)).toBe(
      "video.audio({ music: { editor: 'music' }, sfx: { editor: 'sfx' } })('Demo', async () => {})"
    )
  })

  it('is a no-op when the marker already matches', () => {
    const source =
      "video.overlays({ logo: { editor: 'logo' } })('Demo', async () => {})"
    expect(
      setEditorMedia(ctxOf(source), 'Demo', 'overlays', 'logo', 'logo')
    ).toEqual([])
  })

  it('adds a narration marker into the default sub-object (language-major)', () => {
    const source =
      "video.narration({ en: { intro: 'Hi' } })('Demo', async () => {})"
    const edits = setEditorMedia(
      ctxOf(source),
      'Demo',
      'narration',
      'outro',
      'outro',
      isLanguageKey
    )
    expect(applyAll(source, edits)).toBe(
      "video.narration({ en: { intro: 'Hi' }, default: { outro: { editor: 'outro' } } })('Demo', async () => {})"
    )
  })

  it('returns null when the video declaration is missing', () => {
    const source = "video('Other', async () => {})"
    expect(
      setEditorMedia(ctxOf(source), 'Demo', 'overlays', 'logo', 'logo')
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

describe('applyTextEdits: overlap guard', () => {
  it('throws on overlapping edits (a planner bug, never expected input)', () => {
    expect(() =>
      applyTextEdits('abcdef', [
        { start: 0, end: 4, replacement: 'x' },
        { start: 2, end: 6, replacement: 'y' },
      ])
    ).toThrow('Overlapping text edits')
  })

  it('accepts zero-length inserts at the same position', () => {
    expect(
      applyTextEdits('ab', [
        { start: 1, end: 1, replacement: 'x' },
        { start: 1, end: 1, replacement: 'y' },
      ])
    ).toBe('axyb')
  })
})

describe('importTableFor / resolveImportedLocalName', () => {
  it('maps aliases both ways', () => {
    const ctx = ctxOf(
      "import { video, autoZoom as az, hide } from 'screenci'\n" +
        "import { speed as fast } from 'other'\n"
    )
    const table = importTableFor(ctx, 'screenci')
    expect(table.localToExport.get('az')).toBe('autoZoom')
    expect(table.exportToLocal.get('autoZoom')).toBe('az')
    expect(table.localToExport.get('hide')).toBe('hide')
    expect(table.localToExport.has('fast')).toBe(false)
    expect(resolveImportedLocalName(ctx, 'screenci', 'autoZoom')).toBe('az')
    expect(resolveImportedLocalName(ctx, 'screenci', 'speed')).toBeNull()
  })

  it('returns null for a namespace import', () => {
    const ctx = ctxOf("import * as sc from 'screenci'\n")
    expect(resolveImportedLocalName(ctx, 'screenci', 'autoZoom')).toBeNull()
  })
})

describe('ensureNamedImport: alias reuse', () => {
  it('reuses an existing alias instead of appending a duplicate', () => {
    const ctx = ctxOf("import { video, autoZoom as az } from 'screenci'\n")
    expect(ensureNamedImport(ctx, 'screenci', 'autoZoom')).toEqual({
      edits: [],
      localName: 'az',
    })
  })
})

describe('classifyEditIdSite', () => {
  const source = [
    "import { video } from 'screenci'",
    "video('D', async ({ page }) => {",
    "  await page.locator('#a').click({ editId: 'one' })",
    "  await page.locator('#b').click({ editId: 'dup' })",
    "  await page.locator('#c').click({ editId: 'dup' })",
    '  if (x) {',
    "    await page.locator('#d').click({ editId: 'branchy' })",
    '  }',
    '})',
    '',
  ].join('\n')

  it('classifies missing, ambiguous, control-flow and ok sites', () => {
    const ctx = ctxOf(source)
    expect(classifyEditIdSite(ctx, 'nope')).toBe('missing')
    expect(classifyEditIdSite(ctx, 'dup')).toBe('ambiguous')
    expect(classifyEditIdSite(ctx, 'branchy')).toBe('control-flow')
    expect(classifyEditIdSite(ctx, 'one')).toBe('ok')
  })
})

describe('collectEditIdOccurrences', () => {
  it('finds every occurrence with its call name and duplicates', () => {
    const ctx = ctxOf(
      [
        "import { video, autoZoom } from 'screenci'",
        "video('D', async ({ page }) => {",
        "  await page.locator('#a').click({ editId: 'click1' })",
        "  await page.locator('#b').click({ editId: 'click1' })",
        "  await autoZoom(async () => {}, { editId: 'autoZoom1' })",
        '})',
        '',
      ].join('\n')
    )
    const occurrences = collectEditIdOccurrences(ctx)
    expect(occurrences.map((o) => [o.editId, o.callName])).toEqual([
      ['click1', 'click'],
      ['click1', 'click'],
      ['autoZoom1', 'autoZoom'],
    ])
    // The two click1 occurrences point at distinct literal ranges.
    expect(occurrences[0]!.literalStart).not.toBe(occurrences[1]!.literalStart)
  })
})

describe('renameEditIdAtCall', () => {
  it('rewrites one specific occurrence among duplicates', () => {
    const ctx = ctxOf(
      [
        "await page.locator('#a').click({ editId: 'dup' })",
        "await page.locator('#b').click({ editId: 'dup' })",
        '',
      ].join('\n')
    )
    const occurrences = collectEditIdOccurrences(ctx)
    const edit = renameEditIdAtCall(ctx, occurrences[1]!.call, 'dup', 'click9')
    expect(edit).not.toBeNull()
    const after = applyTextEdits(ctx.source, [edit!])
    expect(after).toContain("locator('#a').click({ editId: 'dup' })")
    expect(after).toContain("locator('#b').click({ editId: 'click9' })")
  })
})

describe('plain JavaScript recording files', () => {
  const jsSource = [
    "import { video, hide } from 'screenci'",
    '',
    "video('JS', async ({ page }) => {",
    "  await page.locator('#a').click({ editId: 'jsclick' })",
    '  await page.waitForTimeout(750)',
    "  await hide('mask', async () => {",
    "    await page.locator('#b').click()",
    '  })',
    '})',
    '',
  ].join('\n')

  it('parses a .js file and finds calls by editId', () => {
    const ctx = createContext(ts, 'demo.screenci.js', jsSource)
    const call = findCallByEditId(ctx, 'jsclick')
    expect(call).not.toBeNull()
    const statement = statementAtLine(ctx, 5)!
    expect(waitForTimeoutArg(ctx, statement, 'page')!.text).toBe('750')
  })

  it('unwraps a named block in a .js file', () => {
    const ctx = createContext(ts, 'demo.screenci.js', jsSource)
    const edits = unwrapBlockCall(ctx, 'mask')!
    const after = applyTextEdits(jsSource, edits)
    expect(after).not.toContain('hide(')
    expect(after).toContain("  await page.locator('#b').click()")
  })
})

describe('resolvePageIdentifier: deep locator alias chains', () => {
  it('follows a chain of stored locators back to the page', () => {
    const source = [
      "video('D', async ({ page }) => {",
      "  const list = page.locator('ul')",
      "  const row = list.locator('li').first()",
      "  const cell = row.locator('td')",
      "  await cell.click({ editId: 'deep' })",
      '})',
      '',
    ].join('\n')
    const ctx = ctxOf(source)
    const call = findCallByEditId(ctx, 'deep')!
    expect(ctx.ts.isPropertyAccessExpression(call.expression)).toBe(true)
    const root = resolvePageIdentifier(
      ctx.ts,
      ctx.sourceFile,
      (call.expression as import('typescript').PropertyAccessExpression)
        .expression
    )
    expect(root).toBe('page')
  })

  it('returns null when the chain has no identifier root', () => {
    const source = [
      "video('D', async ({ page }) => {",
      "  await (await helper()).click({ editId: 'odd' })",
      '})',
      '',
    ].join('\n')
    const ctx = ctxOf(source)
    const call = findCallByEditId(ctx, 'odd')!
    const receiver = (
      call.expression as import('typescript').PropertyAccessExpression
    ).expression
    expect(resolvePageIdentifier(ctx.ts, ctx.sourceFile, receiver)).toBeNull()
  })

  it('stops at a self-referential declaration without looping forever', () => {
    const source = [
      "const a = a.locator('x')",
      "video('D', async ({ page }) => {",
      "  await a.click({ editId: 'cyc' })",
      '})',
      '',
    ].join('\n')
    const ctx = ctxOf(source)
    const call = findCallByEditId(ctx, 'cyc')!
    const receiver = (
      call.expression as import('typescript').PropertyAccessExpression
    ).expression
    expect(resolvePageIdentifier(ctx.ts, ctx.sourceFile, receiver)).toBe('a')
  })
})

describe('findRecordedWait', () => {
  const source = [
    'import { video } from "screenci"',
    'export default video("demo", async (page) => {',
    "  await page.locator('#a').click({ editId: 'one' })",
    '  await page.waitForTimeout(3000)',
    "  await page.locator('#b').click({ editId: 'two' })",
    '})',
    '',
  ].join('\n')

  it('finds the wait before an anchor action', () => {
    const ctx = ctxOf(source)
    const literal = findRecordedWait(ctx, 'two', 'before')
    expect(literal?.text).toBe('3000')
  })

  it('finds the wait after an anchor action', () => {
    const ctx = ctxOf(source)
    const literal = findRecordedWait(ctx, 'one', 'after')
    expect(literal?.text).toBe('3000')
  })

  it('returns null when the adjacent statement is not a wait', () => {
    const ctx = ctxOf(source)
    // Nothing after 'two'.
    expect(findRecordedWait(ctx, 'two', 'after')).toBeNull()
    // Nothing but the wait before 'one'.
    expect(findRecordedWait(ctx, 'one', 'before')).toBeNull()
  })
})

describe('mergeAdjacentWaitEdits', () => {
  const wrap = (body: string[]): string =>
    [
      'import { video } from "screenci"',
      'export default video("demo", async (page) => {',
      ...body,
      '})',
      '',
    ].join('\n')

  it('merges a back-to-back pair into their sum', () => {
    const source = wrap([
      '  await page.waitForTimeout(1000)',
      '  await page.waitForTimeout(500)',
    ])
    const after = applyTextEdits(source, mergeAdjacentWaitEdits(ctxOf(source)))
    expect(after).toContain('await page.waitForTimeout(1500)')
    expect(after.match(/waitForTimeout/g)).toHaveLength(1)
  })

  it('merges a run of three', () => {
    const source = wrap([
      '  await page.waitForTimeout(100)',
      '  await page.waitForTimeout(200)',
      '  await page.waitForTimeout(300)',
    ])
    const after = applyTextEdits(source, mergeAdjacentWaitEdits(ctxOf(source)))
    expect(after).toContain('await page.waitForTimeout(600)')
    expect(after.match(/waitForTimeout/g)).toHaveLength(1)
  })

  it('does not merge waits on different roots', () => {
    const source = wrap([
      '  await page.waitForTimeout(100)',
      '  await other.waitForTimeout(200)',
    ])
    expect(mergeAdjacentWaitEdits(ctxOf(source))).toHaveLength(0)
  })

  it('does not merge across an interaction between the waits', () => {
    const source = wrap([
      '  await page.waitForTimeout(100)',
      "  await page.locator('#a').click()",
      '  await page.waitForTimeout(200)',
    ])
    expect(mergeAdjacentWaitEdits(ctxOf(source))).toHaveLength(0)
  })

  it('does not merge when a comment sits between the waits', () => {
    const source = wrap([
      '  await page.waitForTimeout(100)',
      '  // keep these separate',
      '  await page.waitForTimeout(200)',
    ])
    expect(mergeAdjacentWaitEdits(ctxOf(source))).toHaveLength(0)
  })

  it('does not merge waits in different blocks', () => {
    const source = wrap([
      '  if (true) {',
      '    await page.waitForTimeout(100)',
      '  }',
      '  await page.waitForTimeout(200)',
    ])
    expect(mergeAdjacentWaitEdits(ctxOf(source))).toHaveLength(0)
  })

  it('removes the whole run when the sum is zero', () => {
    const source = wrap([
      '  await page.waitForTimeout(0)',
      '  await page.waitForTimeout(0)',
    ])
    const after = applyTextEdits(source, mergeAdjacentWaitEdits(ctxOf(source)))
    expect(after).not.toContain('waitForTimeout')
  })

  it('is idempotent', () => {
    const source = wrap([
      '  await page.waitForTimeout(1000)',
      '  await page.waitForTimeout(500)',
    ])
    const once = applyTextEdits(source, mergeAdjacentWaitEdits(ctxOf(source)))
    expect(mergeAdjacentWaitEdits(ctxOf(once))).toHaveLength(0)
  })
})
