import { test, expect } from '@playwright/test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { rasterizeHtmlOverlay } from '../src/htmlRasterizer.js'
import { buildOverlayHostDocument } from '../src/clientOverlay.js'
import { injectOverlayRootStyle } from '../src/asset.js'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
} from '../src/runtimeContext.js'

/**
 * The bleed is captured as transparent padding around the content, so the
 * rasterized root is the content box plus the bleed on every side. The flush
 * relies on this to subtract the bleed back out when placing an anchored
 * overlay, and the renderer places the capture 1:1 at the recorded width.
 */
test('captures the bleed around shrink-wrapped anchored content', async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'screenci-anchor-e2e-'))
  try {
    const html = injectOverlayRootStyle(
      buildOverlayHostDocument({
        rootContent:
          '<div style="width:120px;height:40px;box-shadow:0 0 0 6px red"></div>',
      }),
      { bleed: 8 }
    )
    const result = await runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ page, recordingDir: dir }),
      () => rasterizeHtmlOverlay({ name: 'anchored', html })
    )
    expect(result.width).toBe(136)
    expect(result.height).toBe(56)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('sizes an over root to the element box plus bleed while the content fills the element box', async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'screenci-over-bleed-e2e-'))
  try {
    const html = injectOverlayRootStyle(
      buildOverlayHostDocument({
        rootContent:
          '<div id="fill" style="width:100%;height:100%;border:2px solid blue;box-sizing:border-box"></div>',
      }),
      { size: { width: 240, height: 90 }, bleed: 16 }
    )
    await page.setContent(html)
    const content = await page.locator('#fill').boundingBox()
    // The padding keeps the content box at the element box (208x58 inside a
    // 240x90 root), offset by the bleed.
    expect(content).toEqual({ x: 16, y: 16, width: 208, height: 58 })
    const result = await runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ page, recordingDir: dir }),
      () => rasterizeHtmlOverlay({ name: 'over-bleed', html })
    )
    expect(result.width).toBe(240)
    expect(result.height).toBe(90)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
