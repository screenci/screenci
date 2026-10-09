import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyProjectFiles,
  assertSafeRelativePath,
  assertStorableProjectPath,
  collectProjectFiles,
  hashProjectFileBytes,
  isIgnoredPath,
  nodeProjectFilesFs,
  parseIgnoreRules,
  planProjectFilesApply,
  readLocalHashes,
  type ProjectFilesDirent,
  type ProjectFilesFs,
} from './localProjectFiles.js'
import { MAX_PROJECT_TEXT_FILE_BYTES } from './projectFiles.js'

/** In-memory fs: a map of absolute POSIX paths to file bytes. */
function memoryFs(seed: Record<string, string | Buffer>): ProjectFilesFs & {
  files: Map<string, Buffer>
} {
  const files = new Map<string, Buffer>()
  for (const [path, content] of Object.entries(seed)) {
    files.set(path, Buffer.isBuffer(content) ? content : Buffer.from(content))
  }
  const dirent = (name: string, isDir: boolean): ProjectFilesDirent => ({
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  })
  return {
    files,
    readdir: async (dir) => {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`
      const names = new Map<string, boolean>()
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue
        const [head, ...tail] = path.slice(prefix.length).split('/')
        if (head === undefined || head === '') continue
        names.set(head, tail.length > 0)
      }
      if (names.size === 0) throw new Error(`ENOENT ${dir}`)
      // Reverse order on purpose: the collector must sort.
      return [...names.entries()]
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .map(([name, isDir]) => dirent(name, isDir))
    },
    readFile: async (path) => {
      const bytes = files.get(path)
      if (!bytes) throw new Error(`ENOENT ${path}`)
      return bytes
    },
    writeFile: async (path, data) => {
      files.set(path, Buffer.from(data))
    },
    mkdir: async () => undefined,
    exists: async (path) =>
      files.has(path) ||
      [...files.keys()].some((key) => key.startsWith(`${path}/`)),
  }
}

const sha = (text: string): string => hashProjectFileBytes(text)

describe('hashProjectFileBytes', () => {
  it('is the lowercase sha256 hex of the raw bytes', () => {
    expect(hashProjectFileBytes('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
    expect(hashProjectFileBytes(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})

describe('parseIgnoreRules', () => {
  it('parses the supported gitignore subset', () => {
    const rules = parseIgnoreRules(
      'dist/\n*.tmp\n/top.txt\nsub/dir/file.ts\n!keep\n# c\n'
    )
    expect(isIgnoredPath(rules, 'dist', true)).toBe(true)
    expect(isIgnoredPath(rules, 'dist', false)).toBe(false)
    expect(isIgnoredPath(rules, 'a/b.tmp', false)).toBe(true)
    expect(isIgnoredPath(rules, 'top.txt', false)).toBe(true)
    expect(isIgnoredPath(rules, 'x/top.txt', false)).toBe(false)
    expect(isIgnoredPath(rules, 'sub/dir/file.ts', false)).toBe(true)
    expect(isIgnoredPath(rules, 'keep', false)).toBe(false)
  })
})

describe('path guards', () => {
  it('refuses traversal and absolute paths', () => {
    expect(() => assertSafeRelativePath('/abs')).toThrow(/absolute/)
    expect(() => assertSafeRelativePath('a\\b')).toThrow(/backslashes/)
    expect(() => assertSafeRelativePath('a/../b')).toThrow(/island-relative/)
    expect(() => assertSafeRelativePath('recordings/a.ts')).not.toThrow()
  })

  it('refuses paths that are never stored', () => {
    expect(() => assertStorableProjectPath('.env')).toThrow(/Env files/)
    expect(() =>
      assertStorableProjectPath('recordings/shared/storage-state.json')
    ).toThrow(/session/)
    expect(() => assertStorableProjectPath('src/app.ts')).toThrow()
    expect(() =>
      assertStorableProjectPath('recordings/demo.screenci.ts')
    ).not.toThrow()
  })
})

describe('collectProjectFiles', () => {
  const island = '/island'
  const seed = {
    [`${island}/screenci.config.ts`]: 'cfg',
    [`${island}/package.json`]: '{}',
    [`${island}/.gitignore`]:
      'recordings/**/*.png\nrecordings/shared/tmp/\n*.log\n',
    [`${island}/.env`]: 'SCREENCI_SECRET=x',
    [`${island}/.npmrc`]: '//registry/:_authToken=x',
    [`${island}/src/app.ts`]: 'not stored',
    [`${island}/recordings/demo.screenci.ts`]: "video('Demo', async () => {})",
    [`${island}/recordings/other.screenci.ts`]:
      "video('Other', async () => {})",
    [`${island}/recordings/demo/callout.html`]: '<div/>',
    [`${island}/recordings/demo/logo.png`]: Buffer.from([0x89, 0x50]),
    [`${island}/recordings/demo/debug.log`]: 'ignored text',
    [`${island}/recordings/other/x.html`]: '<p/>',
    [`${island}/recordings/shared/theme.ts`]: 'export const t = 1',
    [`${island}/recordings/shared/tmp/brand.png`]: Buffer.from([1, 2]),
    [`${island}/recordings/shared/tmp/notes.md`]: 'ignored folder text',
    [`${island}/recordings/shared/.hidden.ts`]: 'hidden',
    [`${island}/recordings/shared/storage-state.json`]: '{}',
    [`${island}/recordings/shared/node_modules/x.js`]: 'x',
  }

  it('selects root, shared and the requested videos only', async () => {
    const fs = memoryFs(seed)
    const { files, skipped } = await collectProjectFiles(island, ['demo'], fs)
    expect(files.map((file) => file.path)).toEqual([
      '.gitignore',
      'package.json',
      'recordings/demo.screenci.ts',
      'recordings/demo/callout.html',
      // Media is collected even though the island's .gitignore ignores it:
      // ScreenCI stores it instead of git.
      'recordings/demo/logo.png',
      'recordings/shared/theme.ts',
      'recordings/shared/tmp/brand.png',
      'screenci.config.ts',
    ])
    expect(skipped).toEqual([])
    const logo = files.find((file) => file.path === 'recordings/demo/logo.png')!
    expect(logo.byteSize).toBe(2)
    expect(logo.hash).toBe(hashProjectFileBytes(Buffer.from([0x89, 0x50])))
  })

  it('collects several videos at once and ignores unsafe slugs', async () => {
    const fs = memoryFs(seed)
    const { files } = await collectProjectFiles(
      island,
      ['demo', 'other', '../escape', 'shared'],
      fs
    )
    const paths = files.map((file) => file.path)
    expect(paths).toContain('recordings/other.screenci.ts')
    expect(paths).toContain('recordings/other/x.html')
    expect(paths).toContain('recordings/demo.screenci.ts')
  })

  it('reports files over the per-file cap', async () => {
    const fs = memoryFs({
      [`${island}/package.json`]: '{}',
      [`${island}/recordings/big.screenci.ts`]: 'x'.repeat(
        MAX_PROJECT_TEXT_FILE_BYTES + 1
      ),
    })
    const { files, skipped } = await collectProjectFiles(island, ['big'], fs)
    expect(files.map((file) => file.path)).toEqual(['package.json'])
    expect(skipped).toEqual([
      { path: 'recordings/big.screenci.ts', reason: 'too-large' },
    ])
  })

  it('works on a real temp directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'screenci-files-'))
    try {
      await mkdir(join(dir, 'recordings', 'shared'), { recursive: true })
      await writeFile(join(dir, 'screenci.config.ts'), 'cfg')
      await writeFile(join(dir, 'recordings', 'x.screenci.ts'), 'x')
      await writeFile(join(dir, 'recordings', 'shared', 'a.ts'), 'a')
      const { files } = await collectProjectFiles(
        dir,
        ['x'],
        nodeProjectFilesFs
      )
      expect(files.map((file) => file.path)).toEqual([
        'recordings/shared/a.ts',
        'recordings/x.screenci.ts',
        'screenci.config.ts',
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('planProjectFilesApply', () => {
  it('classifies absent, identical and differing files', () => {
    const plan = planProjectFilesApply(
      [
        { path: 'a', hash: sha('a') },
        { path: 'b', hash: sha('b') },
        { path: 'c', hash: sha('c') },
      ],
      new Map([
        ['a', null],
        ['b', sha('b')],
        ['c', sha('local c')],
      ])
    )
    expect(plan).toEqual({ write: ['a'], unchanged: ['b'], conflicts: ['c'] })
  })
})

describe('applyProjectFiles', () => {
  const island = '/island'
  const remote = {
    'recordings/new.screenci.ts': 'new',
    'recordings/same.screenci.ts': 'same',
    'recordings/shared/theme.ts': 'remote theme',
  }
  const entries = Object.entries(remote).map(([path, content]) => ({
    path,
    hash: sha(content),
  }))
  const blobServer = () => {
    const byHash = new Map(
      Object.values(remote).map((content) => [sha(content), content])
    )
    return vi.fn(async (hash: string) => {
      const content = byHash.get(hash)
      if (content === undefined) throw new Error('404')
      return new Uint8Array(Buffer.from(content))
    })
  }

  it('writes only differing files and reports conflicts without force', async () => {
    const fs = memoryFs({
      [`${island}/recordings/same.screenci.ts`]: 'same',
      [`${island}/recordings/shared/theme.ts`]: 'local theme',
    })
    const fetchBlob = blobServer()
    const refused = await applyProjectFiles(island, entries, fetchBlob, fs, {
      force: false,
    })
    expect(refused).toEqual({
      ok: false,
      conflicts: ['recordings/shared/theme.ts'],
    })
    expect(fetchBlob).not.toHaveBeenCalled()
    expect(fs.files.has(`${island}/recordings/new.screenci.ts`)).toBe(false)

    const forced = await applyProjectFiles(island, entries, fetchBlob, fs, {
      force: true,
    })
    expect(forced).toEqual({
      ok: true,
      written: ['recordings/new.screenci.ts'],
      unchanged: ['recordings/same.screenci.ts'],
      overwritten: ['recordings/shared/theme.ts'],
    })
    // The unchanged file was never downloaded.
    expect(fetchBlob).toHaveBeenCalledTimes(2)
    expect(
      fs.files.get(`${island}/recordings/shared/theme.ts`)?.toString()
    ).toBe('remote theme')
  })

  it('refuses unsafe paths before writing anything', async () => {
    const fs = memoryFs({})
    await expect(
      applyProjectFiles(
        island,
        [{ path: '../escape.ts', hash: sha('x') }],
        blobServer(),
        fs,
        { force: true }
      )
    ).rejects.toThrow(/island-relative/)
    await expect(
      applyProjectFiles(
        island,
        [{ path: '.env', hash: sha('x') }],
        blobServer(),
        fs,
        { force: true }
      )
    ).rejects.toThrow(/Env files/)
    expect(fs.files.size).toBe(0)
  })

  it('refuses a blob whose bytes do not match its hash', async () => {
    const fs = memoryFs({})
    await expect(
      applyProjectFiles(
        island,
        [{ path: 'recordings/a.screenci.ts', hash: sha('expected') }],
        async () => new Uint8Array(Buffer.from('tampered')),
        fs,
        { force: false }
      )
    ).rejects.toThrow(/does not match/)
    expect(fs.files.size).toBe(0)
  })

  it('reads local hashes from a real directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'screenci-apply-'))
    try {
      await writeFile(join(dir, 'package.json'), '{}')
      const result = await applyProjectFiles(
        dir,
        [{ path: 'recordings/shared/a.ts', hash: sha('a') }],
        async () => new Uint8Array(Buffer.from('a')),
        nodeProjectFilesFs,
        { force: false }
      )
      expect(result.ok).toBe(true)
      expect(
        await readFile(join(dir, 'recordings', 'shared', 'a.ts'), 'utf-8')
      ).toBe('a')
      const hashes = await readLocalHashes(
        dir,
        ['package.json', 'missing.ts'],
        nodeProjectFilesFs
      )
      expect(hashes.get('package.json')).toBe(sha('{}'))
      expect(hashes.get('missing.ts')).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
