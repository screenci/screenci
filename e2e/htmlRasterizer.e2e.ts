import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
import {
  rasterizeAnimatedHtmlOverlay,
  rasterizeHtmlOverlay,
} from '../src/htmlRasterizer.js'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
} from '../src/runtimeContext.js'

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

test('rasterizes HTML to a transparent PNG sized to its content', async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'screenci-html-e2e-'))
  try {
    const result = await runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ page, recordingDir: dir }),
      () =>
        rasterizeHtmlOverlay({
          name: 'badge',
          html: '<div style="width:200px;height:80px;background:#f00">hi</div>',
        })
    )

    // boundingBox is reported in CSS pixels (the underlying PNG is rendered at
    // the device scale factor for crispness).
    expect(result.width).toBe(200)
    expect(result.height).toBe(80)

    const buffer = await readFile(result.path)
    expect(buffer.subarray(0, 8)).toEqual(PNG_SIGNATURE)
    expect(buffer.length).toBeGreaterThan(0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('does not require a fixed viewport: content larger than the default viewport still renders', async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'screenci-html-e2e-'))
  try {
    const result = await runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ page, recordingDir: dir }),
      () =>
        rasterizeHtmlOverlay({
          name: 'wide',
          html: '<div style="width:640px;height:120px;background:#0a0"></div>',
        })
    )

    expect(result.width).toBe(640)
    expect(result.height).toBe(120)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('rasterizes an animated overlay to a two-stream transparent clip', async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'screenci-anim-e2e-'))
  try {
    const result = await runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ page, recordingDir: dir }),
      () =>
        rasterizeAnimatedHtmlOverlay({
          name: 'intro',
          html:
            '<div style="width:200px;height:80px;background:#f00;' +
            'animation:fade 1s linear">hi' +
            '<style>@keyframes fade{from{opacity:0}to{opacity:1}}</style></div>',
          durationMs: 500,
          fps: 30,
        })
    )

    expect(result.width).toBe(200)
    expect(result.height).toBe(80)
    expect(result.durationMs).toBe(500)
    expect(result.path.endsWith('.mp4')).toBe(true)

    const buffer = await readFile(result.path)
    expect(buffer.length).toBeGreaterThan(0)

    // The clip must carry two video streams: color + alpha matte.
    const ffmpegPath = ffmpegStatic as unknown as string
    const probe = spawnSync(ffmpegPath, ['-hide_banner', '-i', result.path], {
      encoding: 'utf8',
    })
    const info = `${probe.stdout ?? ''}${probe.stderr ?? ''}`
    const videoStreams = (info.match(/Stream #0:\d+.*Video:/g) ?? []).length
    expect(videoStreams).toBe(2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applies injected css so overlays can be styled with className', async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'screenci-css-e2e-'))
  try {
    const result = await runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ page, recordingDir: dir }),
      () =>
        rasterizeHtmlOverlay({
          name: 'card',
          html: '<div class="box"></div>',
          css: '.box{width:120px;height:60px;background:#f00}',
        })
    )

    // Without injected CSS the bare <div> would collapse; the className sizes it.
    expect(result.width).toBe(120)
    expect(result.height).toBe(60)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('capturePadding grows the captured box around the content', async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'screenci-pad-e2e-'))
  try {
    const result = await runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ page, recordingDir: dir }),
      () =>
        rasterizeHtmlOverlay({
          name: 'padded',
          html: '<div style="width:200px;height:80px;background:#0a0"></div>',
          capturePadding: 40,
        })
    )

    // 40px of transparent padding on every side: 200+80 x 80+80.
    expect(result.width).toBe(280)
    expect(result.height).toBe(160)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
