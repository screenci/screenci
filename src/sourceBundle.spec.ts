import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applySourceBundle,
  assertSafeBundlePath,
  collectSourceBundle,
  hashSourceBundleFiles,
  nodeSourceBundleFs,
  parseIgnoreRules,
  parseSourceBundleFiles,
  planSourceBundleApply,
  serializeSourceBundleFiles,
  type SourceBundleDirent,
  type SourceBundleFs,
} from './sourceBundle.js'

// Shared fixture vector with the backend (apps/backend/src/sourceBundle.test.ts):
// both implementations must agree on the canonical JSON and its hash.
const FIXTURE_FILES = [
  { path: 'recordings/b.screenci.ts', content: 'b\n' },
  { path: 'a.txt', content: 'a' },
]
const FIXTURE_CANONICAL_JSON =
  '{"files":[{"path":"a.txt","content":"a"},{"path":"recordings/b.screenci.ts","content":"b\\n"}]}'
const FIXTURE_HASH =
  '3d3c3baa54986ebaec2dbc78022f6a3115a5a20a701caeb696e84836e4045cbc'

/** In-memory fs: a map of POSIX-ish absolute paths to file bytes. */
function memoryFs(seed: Record<string, string | Buffer>): SourceBundleFs & {
  files: Map<string, Buffer>
} {
  const files = new Map<string, Buffer>()
  for (const [path, content] of Object.entries(seed)) {
    files.set(path, Buffer.isBuffer(content) ? content : Buffer.from(content))
  }
  const dirent = (name: string, isDir: boolean): SourceBundleDirent => ({
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
        const rest = path.slice(prefix.length)
        const [head, ...tail] = rest.split('/')
        if (head === undefined || head === '') continue
        names.set(head, tail.length > 0)
      }
      if (names.size === 0 && !dir.startsWith('/island')) {
        throw new Error('ENOENT')
      }
      // Reverse order on purpose: the collector must sort, not rely on readdir.
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
    exists: async (path) => {
      if (files.has(path)) return true
      const prefix = `${path}/`
      return [...files.keys()].some((key) => key.startsWith(prefix))
    },
  }
}

describe('canonical form', () => {
  it('matches the shared fixture vector', () => {
    expect(serializeSourceBundleFiles(FIXTURE_FILES)).toBe(
      FIXTURE_CANONICAL_JSON
    )
    expect(hashSourceBundleFiles(FIXTURE_FILES)).toBe(FIXTURE_HASH)
    expect(hashSourceBundleFiles([...FIXTURE_FILES].reverse())).toBe(
      FIXTURE_HASH
    )
  })
})

describe('collectSourceBundle', () => {
  const island = '/island'

  it('collects root allowlist files and recordings text, in a deterministic order', async () => {
    const fs = memoryFs({
      [`${island}/screenci.config.ts`]: 'config',
      [`${island}/package.json`]: '{}',
      [`${island}/README.md`]: 'readme',
      [`${island}/package-lock.json`]: 'lock',
      [`${island}/.env`]: 'SECRET=1',
      [`${island}/recordings/z.screenci.ts`]: 'z',
      [`${island}/recordings/nested/a.screenci.tsx`]: 'a',
      [`${island}/recordings/assets/logo.png`]: Buffer.from([0x89, 0x50]),
      [`${island}/recordings/assets/ring.html`]: '<div/>',
      [`${island}/recordings/.env.local`]: 'x',
      [`${island}/recordings/node_modules/dep/index.js`]: 'dep',
      [`${island}/node_modules/x.js`]: 'x',
    })

    const { bundle, skipped } = await collectSourceBundle(island, fs)

    expect(bundle.files.map((file) => file.path)).toEqual([
      'README.md',
      'package.json',
      'recordings/assets/ring.html',
      'recordings/nested/a.screenci.tsx',
      'recordings/z.screenci.ts',
      'screenci.config.ts',
    ])
    expect(skipped).toEqual([
      { path: 'recordings/assets/logo.png', reason: 'binary' },
    ])
    expect(bundle.fileCount).toBe(6)
    expect(bundle.hash).toBe(hashSourceBundleFiles(bundle.files))
    expect(bundle.byteSize).toBe(
      Buffer.byteLength(serializeSourceBundleFiles(bundle.files))
    )
  })

  it('bundles helper modules outside recordings and skips dot-directories', async () => {
    const fs = memoryFs({
      [`${island}/helpers/login.ts`]: 'login',
      [`${island}/recordings/tour.screenci.ts`]: "import '../helpers/login'",
      [`${island}/recordings/.auth/user.json`]: '{"cookies":[]}',
      [`${island}/.cache/state.json`]: '{}',
      [`${island}/.prettierrc`]: '{}',
      [`${island}/.secretrc`]: 'x',
    })
    const { bundle } = await collectSourceBundle(island, fs)
    expect(bundle.files.map((file) => file.path)).toEqual([
      '.prettierrc',
      'helpers/login.ts',
      'recordings/tour.screenci.ts',
    ])
  })

  it("honors the island's .gitignore", async () => {
    const fs = memoryFs({
      [`${island}/.gitignore`]: [
        '# tool state',
        'recordings/fixtures/',
        '*.log',
        '/local-notes.md',
        'secrets.json',
        '!keep.log',
      ].join('\n'),
      [`${island}/recordings/fixtures/big.ts`]: 'x',
      [`${island}/recordings/run.log`]: 'log',
      [`${island}/recordings/keep.log`]: 'log',
      [`${island}/local-notes.md`]: 'notes',
      [`${island}/recordings/nested/secrets.json`]: '{}',
      [`${island}/recordings/ok.screenci.ts`]: 'ok',
    })
    const { bundle } = await collectSourceBundle(island, fs)
    expect(bundle.files.map((file) => file.path)).toEqual([
      '.gitignore',
      'recordings/ok.screenci.ts',
    ])
  })

  it('parses the supported gitignore subset', () => {
    const rules = parseIgnoreRules('dist/\n*.tmp\n/top.txt\nsub/dir/file.ts\n')
    const ignored = (path: string, dir = false) =>
      rules.some((rule) => (!rule.dirOnly || dir) && rule.regex.test(path))
    expect(ignored('dist', true)).toBe(true)
    expect(ignored('dist')).toBe(false)
    expect(ignored('a/b.tmp')).toBe(true)
    expect(ignored('top.txt')).toBe(true)
    expect(ignored('x/top.txt')).toBe(false)
    expect(ignored('sub/dir/file.ts')).toBe(true)
  })

  it('skips files with NUL bytes even without a media extension', async () => {
    const fs = memoryFs({
      [`${island}/recordings/blob.bin`]: Buffer.from([0x00, 0x01, 0x02]),
      [`${island}/recordings/ok.screenci.ts`]: 'ok',
    })
    const { bundle, skipped } = await collectSourceBundle(island, fs)
    expect(bundle.files.map((file) => file.path)).toEqual([
      'recordings/ok.screenci.ts',
    ])
    expect(skipped).toEqual([{ path: 'recordings/blob.bin', reason: 'binary' }])
  })

  it('applies per-file, total-size and file-count caps without throwing', async () => {
    const fs = memoryFs({
      [`${island}/recordings/a.screenci.ts`]: 'aaaa',
      [`${island}/recordings/b.screenci.ts`]: 'bbbbbbbbbb',
      [`${island}/recordings/c.screenci.ts`]: 'cc',
      [`${island}/recordings/d.screenci.ts`]: 'dd',
    })
    // The total cap is measured on the serialized bundle, the form the
    // service enforces: one small file fits, two do not.
    const one = Buffer.byteLength(
      serializeSourceBundleFiles([
        { path: 'recordings/a.screenci.ts', content: 'aaaa' },
      ])
    )
    const { bundle, skipped } = await collectSourceBundle(island, fs, {
      maxFileBytes: 5,
      maxTotalBytes: one + 10,
      maxFiles: 10,
    })
    expect(bundle.files.map((file) => file.path)).toEqual([
      'recordings/a.screenci.ts',
    ])
    expect(bundle.byteSize).toBeLessThanOrEqual(one + 10)
    expect(skipped).toEqual([
      { path: 'recordings/b.screenci.ts', reason: 'too-large' },
      { path: 'recordings/c.screenci.ts', reason: 'total-cap' },
      { path: 'recordings/d.screenci.ts', reason: 'total-cap' },
    ])

    const capped = await collectSourceBundle(island, fs, {
      maxFileBytes: 100,
      maxTotalBytes: 1000,
      maxFiles: 1,
    })
    expect(capped.bundle.fileCount).toBe(1)
    expect(capped.skipped.map((skip) => skip.reason)).toEqual([
      'total-cap',
      'total-cap',
      'total-cap',
    ])
  })

  it('works on a real temp directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'screenci-bundle-'))
    try {
      await mkdir(join(dir, 'recordings'), { recursive: true })
      await writeFile(join(dir, 'screenci.config.ts'), 'cfg')
      await writeFile(join(dir, 'recordings', 'x.screenci.ts'), 'x')
      const { bundle } = await collectSourceBundle(dir, nodeSourceBundleFs)
      expect(bundle.files.map((file) => file.path)).toEqual([
        'recordings/x.screenci.ts',
        'screenci.config.ts',
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('planSourceBundleApply', () => {
  it('classifies absent, identical and differing files', () => {
    const plan = planSourceBundleApply(
      [
        { path: 'a', content: '1' },
        { path: 'b', content: '2' },
        { path: 'c', content: '3' },
      ],
      new Map([
        ['a', null],
        ['b', '2'],
        ['c', 'changed'],
      ])
    )
    expect(plan).toEqual({ write: ['a'], unchanged: ['b'], conflicts: ['c'] })
  })
})

describe('applySourceBundle', () => {
  const island = '/island'

  it('refuses to overwrite modified files and writes nothing', async () => {
    const fs = memoryFs({ [`${island}/recordings/a.screenci.ts`]: 'local' })
    const result = await applySourceBundle(
      island,
      [
        { path: 'recordings/a.screenci.ts', content: 'remote' },
        { path: 'recordings/b.screenci.ts', content: 'new' },
      ],
      fs,
      { force: false }
    )
    expect(result).toEqual({
      ok: false,
      conflicts: ['recordings/a.screenci.ts'],
    })
    expect(fs.files.has(`${island}/recordings/b.screenci.ts`)).toBe(false)
  })

  it('writes new files, keeps identical ones, overwrites with force, never deletes extras', async () => {
    const fs = memoryFs({
      [`${island}/recordings/a.screenci.ts`]: 'local',
      [`${island}/recordings/same.screenci.ts`]: 'same',
      [`${island}/recordings/extra.screenci.ts`]: 'extra',
    })
    const result = await applySourceBundle(
      island,
      [
        { path: 'recordings/a.screenci.ts', content: 'remote' },
        { path: 'recordings/same.screenci.ts', content: 'same' },
        { path: 'recordings/b.screenci.ts', content: 'new' },
      ],
      fs,
      { force: true }
    )
    expect(result).toEqual({
      ok: true,
      written: ['recordings/b.screenci.ts'],
      unchanged: ['recordings/same.screenci.ts'],
      overwritten: ['recordings/a.screenci.ts'],
    })
    expect(fs.files.get(`${island}/recordings/a.screenci.ts`)?.toString()).toBe(
      'remote'
    )
    expect(fs.files.get(`${island}/recordings/b.screenci.ts`)?.toString()).toBe(
      'new'
    )
    expect(fs.files.has(`${island}/recordings/extra.screenci.ts`)).toBe(true)
  })

  it('rejects unsafe paths from the server', async () => {
    const fs = memoryFs({})
    await expect(
      applySourceBundle(island, [{ path: '../escape.ts', content: '' }], fs, {
        force: true,
      })
    ).rejects.toThrow(/island-relative/)
    expect(() => assertSafeBundlePath('/abs')).toThrow(/absolute/)
    expect(() => assertSafeBundlePath('a\\b')).toThrow(/backslashes/)
  })
})

describe('parseSourceBundleFiles', () => {
  it('accepts the server shape and refuses anything else', () => {
    expect(parseSourceBundleFiles({ files: FIXTURE_FILES })).toEqual(
      FIXTURE_FILES
    )
    expect(() => parseSourceBundleFiles({})).toThrow(/malformed/)
    expect(() => parseSourceBundleFiles({ files: [{ path: 'a' }] })).toThrow(
      /malformed/
    )
    expect(() =>
      parseSourceBundleFiles({ files: [{ path: '../x', content: '' }] })
    ).toThrow(/island-relative/)
  })
})
