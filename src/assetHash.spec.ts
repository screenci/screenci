import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join, dirname, resolve } from 'path'
import {
  assetCandidatePaths,
  hashAssetFile,
  prewarmAssetFile,
  resetAssetHashCache,
} from './assetHash.js'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

describe('assetCandidatePaths', () => {
  it('returns the path as-is when there is no anchor file', () => {
    expect(assetCandidatePaths('a/b.mov', null)).toEqual(['a/b.mov'])
  })

  it('adds the path resolved relative to the anchor file', () => {
    const anchor = '/work/videos/pitch.screenci.ts'
    expect(assetCandidatePaths('./assets/x.mov', anchor)).toEqual([
      './assets/x.mov',
      resolve(dirname(anchor), './assets/x.mov'),
    ])
  })
})

describe('hashAssetFile', () => {
  let dir: string

  beforeEach(async () => {
    resetAssetHashCache()
    dir = await mkdtemp(join(tmpdir(), 'screenci-assethash-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    resetAssetHashCache()
  })

  it('returns the SHA-256 of the first readable candidate', async () => {
    const file = join(dir, 'clip.mov')
    await writeFile(file, 'hello')
    expect(await hashAssetFile([file])).toBe(sha256('hello'))
  })

  it('falls through to the next candidate when the first is missing', async () => {
    const file = join(dir, 'clip.mov')
    await writeFile(file, 'world')
    expect(await hashAssetFile([join(dir, 'missing.mov'), file])).toBe(
      sha256('world')
    )
  })

  it('resolves to undefined when no candidate is readable', async () => {
    expect(await hashAssetFile([join(dir, 'nope.mov')])).toBeUndefined()
  })

  it('caches by candidate list: a changed file is not re-read', async () => {
    const file = join(dir, 'clip.mov')
    await writeFile(file, 'first')
    const initial = await hashAssetFile([file])
    // Overwrite the file: a cached lookup must still return the original hash,
    // proving the second call did not read the file again.
    await writeFile(file, 'second-different-content')
    expect(await hashAssetFile([file])).toBe(initial)
    expect(initial).toBe(sha256('first'))
  })

  it('re-reads after the cache is reset', async () => {
    const file = join(dir, 'clip.mov')
    await writeFile(file, 'first')
    await hashAssetFile([file])
    await writeFile(file, 'second')
    resetAssetHashCache()
    expect(await hashAssetFile([file])).toBe(sha256('second'))
  })
})

describe('prewarmAssetFile', () => {
  let dir: string

  beforeEach(async () => {
    resetAssetHashCache()
    dir = await mkdtemp(join(tmpdir(), 'screenci-prewarm-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    resetAssetHashCache()
  })

  it('warms the cache so a later hash reuses it without re-reading', async () => {
    const file = join(dir, 'clip.mov')
    await writeFile(file, 'warm')
    // Pre-warm (fire-and-forget). Awaiting the cached promise (the same one the
    // pre-warm started) lets that read settle.
    prewarmAssetFile(file, null)
    const warmed = await hashAssetFile(assetCandidatePaths(file, null))
    // Change the file: the cached hash from the pre-warm must still win, proving
    // the second lookup did not re-read.
    await writeFile(file, 'changed-after-prewarm')
    expect(await hashAssetFile(assetCandidatePaths(file, null))).toBe(warmed)
    expect(warmed).toBe(sha256('warm'))
  })

  it('is harmless for an absent file (no throw, undefined hash)', async () => {
    const missing = join(dir, 'absent.mov')
    expect(() => prewarmAssetFile(missing, null)).not.toThrow()
    expect(
      await hashAssetFile(assetCandidatePaths(missing, null))
    ).toBeUndefined()
  })
})
