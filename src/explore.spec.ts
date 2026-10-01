import { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'
import {
  existingStorageState,
  parseFillArgument,
  registerExploreCommand,
  runExplore,
  trimAriaSnapshot,
  type ExploreDeps,
  type ExploreSession,
} from './explore.js'

const SNAPSHOT = [
  '- banner:',
  '  - heading "Invoices" [level=1]',
  '  - navigation:',
  '    - link "Home":',
  '      - /url: /',
  '- paragraph: Some text',
  '- generic:',
  '  - button "New invoice"',
  '  - textbox "Customer"',
].join('\n')

function fakeSession(): ExploreSession & { calls: string[] } {
  const calls: string[] = []
  let current = 'about:blank'
  return {
    calls,
    goto: vi.fn(async (url: string) => {
      calls.push(`goto ${url}`)
      current = url
    }),
    clickByName: vi.fn(async (name: string) => {
      calls.push(`click ${name}`)
      current = 'https://app.example.com/invoices/new'
    }),
    fillByLabel: vi.fn(async (label: string, value: string) => {
      calls.push(`fill ${label}=${value}`)
    }),
    ariaSnapshot: vi.fn(async () => SNAPSHOT),
    url: () => current,
    close: vi.fn(async () => {
      calls.push('close')
    }),
  }
}

function makeDeps(session: ExploreSession): ExploreDeps & { out: string[] } {
  const out: string[] = []
  return {
    out,
    launch: vi.fn(async () => session),
    resolveLaunchOptions: vi.fn(async () => ({
      channel: 'chrome',
      storageStatePath: '/w/.screenci/auth/default.json',
    })),
    print: (text) => out.push(text),
  }
}

describe('trimAriaSnapshot', () => {
  it('keeps headings and interactive roles and drops the rest', () => {
    expect(trimAriaSnapshot(SNAPSHOT)).toBe(
      [
        ' - heading "Invoices" [level=1]',
        ' - navigation',
        '  - link "Home"',
        ' - button "New invoice"',
        ' - textbox "Customer"',
      ].join('\n')
    )
  })

  it('caps the output', () => {
    const big = Array.from({ length: 200 }, (_, i) => `- button "B${i}"`).join(
      '\n'
    )
    const lines = trimAriaSnapshot(big).split('\n')
    expect(lines).toHaveLength(151)
    expect(lines.at(-1)).toBe('... (50 more lines)')
  })
})

describe('parseFillArgument', () => {
  it('splits on the first =', () => {
    expect(parseFillArgument('Note=a=b')).toEqual({
      label: 'Note',
      value: 'a=b',
    })
  })

  it('rejects a value without a label', () => {
    expect(() => parseFillArgument('=x')).toThrow('<label>=<value>')
  })
})

describe('runExplore', () => {
  it('prints a snapshot after load and after each action, then the final URL', async () => {
    const session = fakeSession()
    const deps = makeDeps(session)
    await runExplore(
      {
        url: 'https://app.example.com/invoices',
        actions: [
          { kind: 'fill', label: 'Customer', value: 'Acme' },
          { kind: 'click', name: 'New invoice' },
        ],
      },
      deps
    )
    expect(deps.launch).toHaveBeenCalledWith({
      channel: 'chrome',
      storageStatePath: '/w/.screenci/auth/default.json',
    })
    expect(session.calls).toEqual([
      'goto https://app.example.com/invoices',
      'fill Customer=Acme',
      'click New invoice',
      'close',
    ])
    const text = deps.out.join('\n')
    expect(text).toContain('## after load (https://app.example.com/invoices)')
    expect(text).toContain('## after fill "Customer"')
    expect(text).toContain(
      '## after click "New invoice" (https://app.example.com/invoices/new)'
    )
    expect(deps.out.at(-1)).toBe(
      'Final URL: https://app.example.com/invoices/new'
    )
  })

  it('closes the browser when an action fails', async () => {
    const session = fakeSession()
    session.clickByName = vi.fn(async () => {
      throw new Error('no such button')
    })
    const deps = makeDeps(session)
    await expect(
      runExplore(
        { url: 'https://x.test', actions: [{ kind: 'click', name: 'Nope' }] },
        deps
      )
    ).rejects.toThrow('no such button')
    expect(session.close).toHaveBeenCalled()
  })
})

describe('registerExploreCommand', () => {
  it('runs clicks and fills in command-line order', async () => {
    const session = fakeSession()
    const deps = makeDeps(session)
    const program = new Command().exitOverride()
    registerExploreCommand(program, deps)
    await program.parseAsync(
      [
        'explore',
        'https://app.example.com',
        '--click',
        'Invoices',
        '--fill',
        'Customer=Acme',
        '--click',
        'Save',
      ],
      { from: 'user' }
    )
    expect(session.calls).toEqual([
      'goto https://app.example.com',
      'click Invoices',
      'fill Customer=Acme',
      'click Save',
      'close',
    ])
  })
})

describe('existingStorageState', () => {
  it('returns the path only when the file exists', () => {
    expect(existingStorageState('/a.json', () => true)).toBe('/a.json')
    expect(existingStorageState('/a.json', () => false)).toBeUndefined()
  })
})
