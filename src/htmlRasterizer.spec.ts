import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import {
  framesForDuration,
  overlayInputHash,
  rasterizeAnimatedHtmlOverlay,
  rasterizeHtmlOverlay,
  setAnimatedHtmlRasterizer,
  setHtmlRasterizer,
  setOverlayCacheEnabled,
  setOverlayCss,
  type HtmlRasterizeRequest,
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

  it('keys the on-disk cache by overlayInputHash (single source of truth)', async () => {
    await render('<div>hash-me</div>')
    // overlayInputHash must reproduce the exact key the cache writes to, so the
    // deferred flush can dedupe against the same identity the cache uses.
    const hash = overlayInputHash({
      kind: 'image',
      deviceScaleFactor: 2,
      capturePadding: 0,
      css: '',
      html: '<div>hash-me</div>',
    })
    expect(existsSync(join(base, '.overlay-cache', `${hash}.png`))).toBe(true)
  })
})

describe('framesForDuration', () => {
  it('samples one frame per output frame period', () => {
    expect(framesForDuration(1000, 30)).toBe(30)
    expect(framesForDuration(1500, 30)).toBe(45)
    expect(framesForDuration(1000, 24)).toBe(24)
    expect(framesForDuration(100, 30)).toBe(3)
  })

  it('always captures at least one frame', () => {
    expect(framesForDuration(0, 30)).toBe(1)
    expect(framesForDuration(5, 30)).toBe(1)
  })

  it('rejects invalid duration or fps', () => {
    expect(() => framesForDuration(-1, 30)).toThrow('durationMs')
    expect(() => framesForDuration(1000, 0)).toThrow('fps')
    expect(() => framesForDuration(1000, -5)).toThrow('fps')
  })
})

describe('rasterizeAnimatedHtmlOverlay', () => {
  let dir: string
  const clipBytes = Buffer.from('fake-mp4-bytes')

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'screenci-anim-raster-'))
    setAnimatedHtmlRasterizer(async () => ({
      buffer: clipBytes,
      width: 320,
      height: 80,
    }))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes an .mp4 into the recording dir and returns its path, hash, size, and duration', async () => {
    const result = await runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ recordingDir: dir }),
      () =>
        rasterizeAnimatedHtmlOverlay({
          name: 'intro',
          html: '<div>hi</div>',
          durationMs: 1500,
        })
    )

    expect(result.width).toBe(320)
    expect(result.height).toBe(80)
    expect(result.durationMs).toBe(1500)
    expect(result.fileHash).toBe(
      createHash('sha256').update(clipBytes).digest('hex')
    )
    expect(result.path.startsWith(join(dir, 'generated'))).toBe(true)
    expect(result.path.endsWith('.mp4')).toBe(true)
    expect(existsSync(result.path)).toBe(true)
    expect(await readFile(result.path)).toEqual(clipBytes)
  })

  it('throws when there is no active recording directory', async () => {
    await expect(
      runWithScreenCIRuntimeContext(
        createScreenCIRuntimeContext({ recordingDir: null }),
        () =>
          rasterizeAnimatedHtmlOverlay({
            name: 'intro',
            html: '<div>hi</div>',
            durationMs: 1000,
          })
      )
    ).rejects.toThrow('no active recording directory')
  })
})

describe('rasterizeAnimatedHtmlOverlay caching', () => {
  let base: string
  let recordingDir: string
  let calls: number

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'screenci-anim-cache-'))
    recordingDir = join(base, 'recording')
    calls = 0
    setAnimatedHtmlRasterizer(async () => {
      calls += 1
      return { buffer: Buffer.from(`mp4-${calls}`), width: 100, height: 50 }
    })
    setOverlayCacheEnabled(true)
  })

  afterEach(async () => {
    setOverlayCacheEnabled(false)
    await rm(base, { recursive: true, force: true })
  })

  const render = (html: string, opts?: { fps?: number; durationMs?: number }) =>
    runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ recordingDir }),
      () =>
        rasterizeAnimatedHtmlOverlay({
          name: 'intro',
          html,
          durationMs: opts?.durationMs ?? 1000,
          ...(opts?.fps !== undefined && { fps: opts.fps }),
        })
    )

  it('renders once for the same input and serves later runs from the cache', async () => {
    const first = await render('<div>same</div>')
    const second = await render('<div>same</div>')

    expect(calls).toBe(1)
    expect(second.fileHash).toBe(first.fileHash)
  })

  it('re-renders when the markup, fps, or duration changes', async () => {
    await render('<div>a</div>')
    await render('<div>b</div>')
    expect(calls).toBe(2)
    await render('<div>b</div>', { fps: 60 })
    expect(calls).toBe(3)
    await render('<div>b</div>', { fps: 60, durationMs: 2000 })
    expect(calls).toBe(4)
  })

  it('keys the on-disk cache by overlayInputHash (single source of truth)', async () => {
    await render('<div>hash-me</div>', { fps: 30, durationMs: 1000 })
    const hash = overlayInputHash({
      kind: 'animation',
      deviceScaleFactor: 2,
      capturePadding: 0,
      fps: 30,
      durationMs: 1000,
      css: '',
      html: '<div>hash-me</div>',
    })
    expect(existsSync(join(base, '.overlay-cache', `${hash}.mp4`))).toBe(true)
  })
})

describe('overlay css and capturePadding', () => {
  let dir: string
  let lastRequest: HtmlRasterizeRequest | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'screenci-overlay-css-'))
    lastRequest = undefined
    setHtmlRasterizer(async (request) => {
      lastRequest = request
      return { buffer: Buffer.from('png'), width: 10, height: 10 }
    })
  })

  afterEach(async () => {
    setOverlayCss('')
    await rm(dir, { recursive: true, force: true })
  })

  const render = (opts: { css?: string; capturePadding?: number }) =>
    runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ recordingDir: dir }),
      () =>
        rasterizeHtmlOverlay({ name: 'badge', html: '<div>hi</div>', ...opts })
    )

  it('passes css and capturePadding through to the rasterizer', async () => {
    await render({ css: '.a{color:red}', capturePadding: 40 })
    expect(lastRequest?.css).toBe('.a{color:red}')
    expect(lastRequest?.capturePadding).toBe(40)
  })

  it('merges the global default css ahead of the per-overlay css', async () => {
    setOverlayCss('.base{margin:0}')
    await render({ css: '.a{color:red}' })
    expect(lastRequest?.css).toBe('.base{margin:0}\n.a{color:red}')
  })

  it('omits css when neither global nor per-overlay css is set', async () => {
    await render({})
    expect(lastRequest?.css).toBeUndefined()
    expect(lastRequest?.capturePadding).toBeUndefined()
  })
})

describe('rasterizeHtmlOverlay caching by css and capturePadding', () => {
  let base: string
  let recordingDir: string
  let calls: number

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'screenci-css-cache-'))
    recordingDir = join(base, 'recording')
    calls = 0
    setHtmlRasterizer(async () => {
      calls += 1
      return { buffer: Buffer.from(`png-${calls}`), width: 10, height: 10 }
    })
    setOverlayCacheEnabled(true)
  })

  afterEach(async () => {
    setOverlayCacheEnabled(false)
    setOverlayCss('')
    await rm(base, { recursive: true, force: true })
  })

  const render = (opts: { css?: string; capturePadding?: number }) =>
    runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ recordingDir }),
      () =>
        rasterizeHtmlOverlay({ name: 'badge', html: '<div>x</div>', ...opts })
    )

  it('re-renders when css or capturePadding changes, caches when unchanged', async () => {
    await render({})
    await render({ css: '.a{}' }) // css changed -> miss
    await render({ css: '.a{}' }) // same -> hit
    await render({ css: '.a{}', capturePadding: 20 }) // padding changed -> miss
    expect(calls).toBe(3)
  })
})
