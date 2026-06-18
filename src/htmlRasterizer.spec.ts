import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import {
  rasterizeHtmlOverlay,
  setHtmlRasterizer,
  setOverlayCacheEnabled,
} from './htmlRasterizer.js'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
} from './runtimeContext.js'

describe('rasterizeHtmlOverlay', () => {
  let dir: string
  const pngBytes = Buffer.from('fake-png-bytes')

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'screenci-html-raster-'))
    setHtmlRasterizer(async () => ({
      buffer: pngBytes,
      width: 320,
      height: 80,
    }))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes a PNG into the recording dir and returns its path, hash, and size', async () => {
    const result = await runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ recordingDir: dir }),
      () => rasterizeHtmlOverlay({ name: 'badge', html: '<div>hi</div>' })
    )

    expect(result.width).toBe(320)
    expect(result.height).toBe(80)
    expect(result.fileHash).toBe(
      createHash('sha256').update(pngBytes).digest('hex')
    )
    expect(result.path.startsWith(join(dir, 'generated'))).toBe(true)
    expect(existsSync(result.path)).toBe(true)
    expect(await readFile(result.path)).toEqual(pngBytes)
  })

  it('throws when there is no active recording directory', async () => {
    await expect(
      runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({ recordingDir: null }),
        () => rasterizeHtmlOverlay({ name: 'badge', html: '<div>hi</div>' })
      )
    ).rejects.toThrow('no active recording directory')
  })
})

describe('rasterizeHtmlOverlay caching', () => {
  let base: string
  // recordingDir is a child of `base`, so the cross-run cache lives at
  // base/.overlay-cache (isolated to this test and cleaned afterwards).
  let recordingDir: string
  let calls: number

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'screenci-html-cache-'))
    recordingDir = join(base, 'recording')
    calls = 0
    setHtmlRasterizer(async () => {
      calls += 1
      return { buffer: Buffer.from(`png-${calls}`), width: 100, height: 50 }
    })
    setOverlayCacheEnabled(true)
  })

  afterEach(async () => {
    setOverlayCacheEnabled(false)
    await rm(base, { recursive: true, force: true })
  })

  const render = (html: string, deviceScaleFactor?: number) =>
    runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ recordingDir }),
      () =>
        rasterizeHtmlOverlay({
          name: 'badge',
          html,
          ...(deviceScaleFactor !== undefined && { deviceScaleFactor }),
        })
    )

  it('renders once for the same input and serves later runs from the cache', async () => {
    const first = await render('<div>same</div>')
    const second = await render('<div>same</div>')

    expect(calls).toBe(1)
    expect(second.fileHash).toBe(first.fileHash)
    expect(second.width).toBe(100)
    expect(second.height).toBe(50)
  })

  it('re-renders when the markup changes', async () => {
    await render('<div>a</div>')
    await render('<div>b</div>')
    expect(calls).toBe(2)
  })

  it('re-renders when the device scale factor changes', async () => {
    await render('<div>x</div>', 2)
    await render('<div>x</div>', 4)
    expect(calls).toBe(2)
  })

  it('does not cache when an injected rasterizer disables it', async () => {
    setOverlayCacheEnabled(false)
    await render('<div>same</div>')
    await render('<div>same</div>')
    expect(calls).toBe(2)
  })
})
