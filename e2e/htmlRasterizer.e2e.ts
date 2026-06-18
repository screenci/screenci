import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { rasterizeHtmlOverlay } from '../src/htmlRasterizer.js'
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
