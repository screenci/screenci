import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { listScreenciSourceFiles } from './cli'

describe('listScreenciSourceFiles', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'screenci-scan-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('collects nested .screenci.ts sources and skips ignored dirs', async () => {
    await mkdir(join(root, 'recordings'), { recursive: true })
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    await mkdir(join(root, '.screenci', 'Demo'), { recursive: true })
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(join(root, 'recordings', 'a.screenci.ts'), '')
    await writeFile(join(root, 'b.screenci.ts'), '')
    await writeFile(join(root, 'recordings', 'notes.ts'), '')
    await writeFile(join(root, 'node_modules', 'pkg', 'x.screenci.ts'), '')
    await writeFile(join(root, '.screenci', 'Demo', 'y.screenci.ts'), '')
    await writeFile(join(root, 'dist', 'z.screenci.ts'), '')

    expect(listScreenciSourceFiles(root).sort()).toEqual(
      [
        join(root, 'b.screenci.ts'),
        join(root, 'recordings', 'a.screenci.ts'),
      ].sort()
    )
  })

  it('returns an empty list for a missing directory', () => {
    expect(listScreenciSourceFiles(join(root, 'does-not-exist'))).toEqual([])
  })
})
