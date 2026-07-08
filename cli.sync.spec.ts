import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ts from 'typescript'

const mockExistsSync = vi.fn()
const mockRealpathSync = vi.fn((path: string) => path)
const mockMkdirSync = vi.fn()
const mockRmSync = vi.fn()
const mockReaddirSync = vi.fn(() => [] as string[])
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockRenameSync = vi.fn()
const mockCreateReadStream = vi.fn()
const mockReaddir = vi.fn()
const mockReadFile = vi.fn()
const mockStat = vi.fn()
const mockAppendFile = vi.fn()
const mockWriteFile = vi.fn()
const mockMkdir = vi.fn()
const mockRm = vi.fn()

vi.mock('fs', () => ({
  createReadStream: mockCreateReadStream,
  existsSync: mockExistsSync,
  realpathSync: mockRealpathSync,
  mkdirSync: mockMkdirSync,
  rmSync: mockRmSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  renameSync: mockRenameSync,
  default: {
    createReadStream: mockCreateReadStream,
    existsSync: mockExistsSync,
    realpathSync: mockRealpathSync,
    mkdirSync: mockMkdirSync,
    rmSync: mockRmSync,
    readdirSync: mockReaddirSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    renameSync: mockRenameSync,
  },
}))

vi.mock('fs/promises', () => ({
  appendFile: mockAppendFile,
  rm: mockRm,
  readdir: mockReaddir,
  readFile: mockReadFile,
  stat: mockStat,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  default: {
    appendFile: mockAppendFile,
    rm: mockRm,
    readdir: mockReaddir,
    readFile: mockReadFile,
    stat: mockStat,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
  },
}))

const SAVE_SELECTOR = "getByRole('button', { name: 'Save' })"
// The fixture is already editId-stamped: its stable key IS the slug.
const CLICK_KEY = 'click1'

const SOURCE = [
  "import { video } from 'screenci'",
  '',
  "video('My video', async ({ page }) => {",
  "  await page.getByRole('button', { name: 'Save' }).click({ move: { duration: 400 }, editId: 'click1' })",
  '})',
  '',
].join('\n')

const ACTION_SNAPSHOT = {
  version: 1,
  videos: {
    'My video': [
      {
        selector: SAVE_SELECTOR,
        method: 'click',
        occurrence: 0,
        params: { 'move.duration': { value: 400, source: 'explicit' } },
      },
    ],
  },
}

const EDITABLE_SNAPSHOT = {
  version: 1,
  videos: {
    'My video': [
      {
        key: CLICK_KEY,
        editId: 'click1',
        locked: false,
        defaults: { sleepBefore: 0 },
        source: { file: '/project/demo.screenci.ts', line: 4 },
      },
    ],
  },
}

function setupProject(overrides: Record<string, unknown>) {
  process.env.SCREENCI_SECRET = 'sk-test'
  mockExistsSync.mockImplementation((path: string) => {
    if (path.endsWith('screenci.config.ts')) return true
    if (path.endsWith('action-params.json')) return true
    if (path.endsWith('editable-actions.json')) return true
    return false
  })
  mockReadFile.mockImplementation(async (path: string | URL) => {
    if (String(path).endsWith('screenci.config.ts')) {
      return "export default { projectName: 'Test Project' }"
    }
    return ''
  })
  mockReadFileSync.mockImplementation((path: string | URL) => {
    if (String(path).endsWith('action-params.json')) {
      return JSON.stringify(ACTION_SNAPSHOT)
    }
    if (String(path).endsWith('editable-actions.json')) {
      return JSON.stringify(EDITABLE_SNAPSHOT)
    }
    return ''
  })
  return {
    fetchActionOverrides: vi.fn(async () => overrides),
  }
}

function baseDeps(
  files: Record<string, string> = {
    '/project/demo.screenci.ts': SOURCE,
  }
) {
  const written: Record<string, string> = {}
  const resets: string[] = []
  return {
    written,
    resets,
    deps: {
      fetchEditableOverrides: vi.fn(async () => ({ timelineEdits: {} })),
      fetchStudioSync: vi.fn(async () => ({ videos: {} })),
      loadTs: () => ts,
      readFileText: (path: string) => files[path] ?? null,
      writeFileText: (path: string, text: string) => {
        written[path] = text
      },
      resetVideoEdits: vi.fn(async (_config, videoName: string) => {
        resets.push(videoName)
      }),
    },
  }
}

describe('screenci sync', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    vi.clearAllMocks()
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('dry-runs by default: prints a diff, writes nothing', async () => {
    const client = setupProject({
      'My video': { [`${SAVE_SELECTOR}|click|0|move.duration`]: 250 },
    })
    const { runSync } = await import('./cli')
    const { deps, written } = baseDeps()
    const lines: string[] = []
    await runSync(
      'test-fixtures/screenci.config.ts',
      {},
      (message) => lines.push(message),
      { client, ...deps }
    )
    const out = lines.join('\n')
    expect(out).toContain('Would update /project/demo.screenci.ts')
    expect(out).toContain('- ')
    expect(out).toContain('duration: 250')
    expect(out).toContain('Would apply 1 edit(s):')
    expect(out).toContain('screenci sync --write')
    expect(written).toEqual({})
  })

  it('--write saves the edited file', async () => {
    const client = setupProject({
      'My video': { [`${SAVE_SELECTOR}|click|0|move.duration`]: 250 },
    })
    const { runSync } = await import('./cli')
    const { deps, written } = baseDeps()
    const lines: string[] = []
    await runSync(
      'test-fixtures/screenci.config.ts',
      { write: true },
      (message) => lines.push(message),
      { client, ...deps }
    )
    expect(written['/project/demo.screenci.ts']).toContain(
      ".click({ move: { duration: 250 }, editId: 'click1' })"
    )
    expect(lines.join('\n')).toContain('Applied 1 edit(s):')
  })

  it('--write --reset clears web edits only for fully applied videos', async () => {
    const client = setupProject({
      'My video': { [`${SAVE_SELECTOR}|click|0|move.duration`]: 250 },
    })
    const { runSync } = await import('./cli')
    const { deps, resets } = baseDeps()
    await runSync(
      'test-fixtures/screenci.config.ts',
      { write: true, reset: true },
      () => {},
      { client, ...deps }
    )
    expect(resets).toEqual(['My video'])
  })

  it('keeps web edits when something fell back to the prompt', async () => {
    const client = setupProject({
      'My video': {
        [`${SAVE_SELECTOR}|click|0|move.duration`]: 250,
        [`locator('#gone')|click|0|duration`]: 5,
      },
    })
    const { runSync } = await import('./cli')
    const { deps, resets } = baseDeps()
    const lines: string[] = []
    await runSync(
      'test-fixtures/screenci.config.ts',
      { write: true, reset: true },
      (message) => lines.push(message),
      { client, ...deps }
    )
    expect(resets).toEqual([])
    const out = lines.join('\n')
    expect(out).toContain('Not applied automatically')
    expect(out).toContain('stale')
    expect(out).toContain('No video had all of its edits applied')
  })

  it('applies timeline sleepBefore edits from the editable snapshot', async () => {
    const client = setupProject({})
    const { runSync } = await import('./cli')
    const { deps, written } = baseDeps()
    deps.fetchEditableOverrides = vi.fn(async () => ({
      timelineEdits: {
        'My video': {
          version: 2,
          edits: [
            {
              type: 'paramEdit',
              id: 'p1',
              target: { key: CLICK_KEY },
              fields: { sleepBefore: 500 },
            },
          ],
        },
      },
    }))
    await runSync(
      'test-fixtures/screenci.config.ts',
      { write: true },
      () => {},
      { client, ...deps }
    )
    expect(written['/project/demo.screenci.ts']).toContain(
      'await page.waitForTimeout(500)'
    )
  })

  it('stamps missing editIds even without editor edits', async () => {
    const unstampedSource = SOURCE.replace(", editId: 'click1'", '')
    const client = setupProject({})
    // Replace the editable snapshot with an unstamped entry.
    mockReadFileSync.mockImplementation((path: string | URL) => {
      if (String(path).endsWith('action-params.json')) {
        return JSON.stringify(ACTION_SNAPSHOT)
      }
      if (String(path).endsWith('editable-actions.json')) {
        return JSON.stringify({
          version: 1,
          videos: {
            'My video': [
              {
                key: 'input|click|getByRole(button, name=Save)|0',
                locked: false,
                defaults: { sleepBefore: 0 },
                source: { file: '/project/demo.screenci.ts', line: 4 },
              },
            ],
          },
        })
      }
      return ''
    })
    const { runSync } = await import('./cli')
    const { deps, written } = baseDeps({
      '/project/demo.screenci.ts': unstampedSource,
    })
    const lines: string[] = []
    await runSync(
      'test-fixtures/screenci.config.ts',
      { write: true },
      (message) => lines.push(message),
      { client, ...deps }
    )
    expect(written['/project/demo.screenci.ts']).toContain(
      ".click({ move: { duration: 400 }, editId: 'click1' })"
    )
    expect(lines.join('\n')).toContain('Stamped editIds for 1 action(s):')
    // Counters persisted via write-then-rename.
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('edit-ids.json'),
      expect.stringContaining('"click": 1')
    )
  })

  it('reports nothing to sync when the editor has no differing edits', async () => {
    const client = setupProject({})
    const { runSync } = await import('./cli')
    const { deps } = baseDeps()
    const lines: string[] = []
    await runSync(
      'test-fixtures/screenci.config.ts',
      {},
      (message) => lines.push(message),
      { client, ...deps }
    )
    expect(lines.join('\n')).toContain('Nothing to sync')
  })

  it('auto-sync applies once, dedupes unchanged state, and resets applied videos', async () => {
    // Mutable editor state: after the reset the backend has no overrides.
    let overrides: Record<string, unknown> = {
      'My video': { [`${SAVE_SELECTOR}|click|0|move.duration`]: 250 },
    }
    const client = setupProject({})
    client.fetchActionOverrides = vi.fn(async () => overrides)
    const { runDevAutoSync } = await import('./cli')
    const { deps, written, resets } = baseDeps()
    deps.resetVideoEdits = vi.fn(async (_config, videoName: string) => {
      resets.push(videoName)
      overrides = {}
    })
    const controller = { stopped: false }
    let ticks = 0
    const lines: string[] = []
    await runDevAutoSync(
      'test-fixtures/screenci.config.ts',
      controller,
      () => false,
      (message) => lines.push(message),
      { client, ...deps },
      1,
      async () => {
        ticks += 1
        if (ticks > 4) controller.stopped = true
      }
    )
    expect(written['/project/demo.screenci.ts']).toContain(
      ".click({ move: { duration: 250 }, editId: 'click1' })"
    )
    expect(resets).toEqual(['My video'])
    const out = lines.join('\n')
    expect(out).toContain('auto-sync: [My video]')
    expect(out).toContain('cleared web timeline edits')
    // The edit applied exactly once across the ticks.
    expect(
      lines.filter((line) => line.includes('set move.duration'))
    ).toHaveLength(1)
  })

  it('auto-sync skips ticks while a record is running', async () => {
    const client = setupProject({
      'My video': { [`${SAVE_SELECTOR}|click|0|move.duration`]: 250 },
    })
    const { runDevAutoSync } = await import('./cli')
    const { deps, written } = baseDeps()
    const controller = { stopped: false }
    let ticks = 0
    await runDevAutoSync(
      'test-fixtures/screenci.config.ts',
      controller,
      () => true,
      () => {},
      { client, ...deps },
      1,
      async () => {
        ticks += 1
        if (ticks > 3) controller.stopped = true
      }
    )
    expect(written).toEqual({})
    expect(client.fetchActionOverrides).not.toHaveBeenCalled()
  })

  it('falls back entirely to the prompt when typescript is unavailable', async () => {
    const client = setupProject({
      'My video': { [`${SAVE_SELECTOR}|click|0|move.duration`]: 250 },
    })
    const { runSync } = await import('./cli')
    const { deps, written } = baseDeps()
    const lines: string[] = []
    await runSync(
      'test-fixtures/screenci.config.ts',
      {},
      (message) => lines.push(message),
      { client, ...deps, loadTs: () => null }
    )
    const out = lines.join('\n')
    expect(out).toContain('Could not load the typescript module')
    expect(out).toContain('CHANGE `move.duration` from 400 to 250')
    expect(written).toEqual({})
  })
})
