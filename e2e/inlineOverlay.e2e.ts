import { test, expect } from '@playwright/test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createElement } from 'react'
import {
  rasterizeAnimatedHtmlOverlay,
  rasterizeHtmlOverlay,
} from '../src/htmlRasterizer.js'
import { buildClientOverlayDocument } from '../src/clientOverlay.js'
import { buildElementOverlayDocument } from '../src/elementOverlay.js'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
} from '../src/runtimeContext.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/** Rasterizes an overlay document to a still and returns the measured result. */
async function rasterize(
  page: import('@playwright/test').Page,
  dir: string,
  name: string,
  html: string
) {
  return runWithScreenCIRuntimeContext(
    createScreenCIRuntimeContext({ page, recordingDir: dir }),
    () => rasterizeHtmlOverlay({ name, html, awaitMount: true })
  )
}

test('renders an inline React element (SSR) overlay to a sized still', async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'screenci-element-e2e-'))
  try {
    // A real ReactElement rendered by react-dom/server: props are baked into
    // the JSX, no client bundle runs.
    const element = createElement(
      'div',
      { style: { width: 200, height: 80, background: '#111', color: '#fff' } },
      'Static'
    )
    const html = await buildElementOverlayDocument(element)
    const result = await runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ page, recordingDir: dir }),
      () => rasterizeHtmlOverlay({ name: 'element-still', html })
    )
    expect(result.width).toBe(200)
    expect(result.height).toBe(80)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('bundles inline jsx source with Vite and runs its hooks (animated)', async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'screenci-inline-jsx-e2e-'))
  try {
    const code = `
      import { useState, useEffect } from 'react'
      export default function Bar({ to = 100 }) {
        const [n, setN] = useState(0)
        useEffect(() => {
          const start = Date.now()
          let raf = 0
          const tick = () => {
            const t = Math.min(1, (Date.now() - start) / 500)
            setN(Math.round(t * to))
            if (t < 1) raf = requestAnimationFrame(tick)
          }
          tick()
          return () => cancelAnimationFrame(raf)
        }, [to])
        return <div style={{ width: 200, height: 80, background: '#111', color: '#fff', font: '700 40px system-ui' }}>{n}</div>
      }
    `
    const html = await buildClientOverlayDocument(
      { kind: 'source', code, resolveDir: fixturesDir, framework: 'react' },
      { to: 100 }
    )
    const result = await runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ page, recordingDir: dir }),
      () =>
        rasterizeAnimatedHtmlOverlay({
          name: 'inline-jsx-anim',
          html,
          awaitMount: true,
          durationMs: 600,
          fps: 30,
        })
    )
    expect(result.width).toBe(200)
    expect(result.height).toBe(80)
    expect(result.durationMs).toBe(600)
    expect(result.path.endsWith('.mp4')).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('bundles inline solidJsx source with Vite (Solid transform)', async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), 'screenci-inline-solid-e2e-'))
  try {
    const code = `
      import { createSignal, onMount } from 'solid-js'
      export default function Badge(props) {
        const [mounted, setMounted] = createSignal(false)
        onMount(() => setMounted(true))
        return (
          <div id="b" data-mounted={mounted() ? 'yes' : 'no'}>
            <style>{'#b{width:200px;height:80px;background:#181818;color:#fff}'}</style>
            {props.label}
          </div>
        )
      }
    `
    const html = await buildClientOverlayDocument(
      { kind: 'source', code, resolveDir: fixturesDir, framework: 'solid' },
      { label: 'Hi' }
    )
    const result = await rasterize(page, dir, 'inline-solid-still', html)
    expect(result.width).toBe(200)
    expect(result.height).toBe(80)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

for (const [file, framework] of [
  ['SolidBadge.solid.tsx', 'solid'],
  ['VueBadge.vue', 'vue'],
  ['SvelteBadge.svelte', 'svelte'],
] as const) {
  test(`bundles a ${framework} component file (${file}) with Vite and inlines its CSS`, async ({
    page,
  }) => {
    const dir = await mkdtemp(join(tmpdir(), `screenci-${framework}-e2e-`))
    try {
      const html = await buildClientOverlayDocument(
        { kind: 'file', path: join(fixturesDir, file), framework },
        { label: 'Hi' }
      )
      const result = await rasterize(page, dir, `${framework}-still`, html)
      // The 200x80 box comes from the component's own style block, so the
      // measured size proves both the mount and the CSS inlining worked.
      expect(result.width).toBe(200)
      expect(result.height).toBe(80)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
