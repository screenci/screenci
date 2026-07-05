import { dirname } from 'path'

const OVERLAY_ROOT_ID = 'screenci-overlay-root'

/**
 * Bundles a `.tsx` page overlay: an author React component module is bundled for
 * the browser and mounted into the overlay root, so the FULL React runtime runs
 * during capture (function components with hooks and effects, class components
 * with lifecycle and state, inline styles, `className`).
 *
 * With `animate: true` the mounted app is advanced by the same deterministic
 * virtual clock that samples each frame, so effect timers / requestAnimationFrame
 * / state updates drive the captured frames reproducibly (see htmlRasterizer).
 *
 * The bundler is injectable so tests can avoid running esbuild.
 */
export type ClientOverlayBundler = (opts: {
  entryPath: string
  propsJson: string
}) => Promise<string>

/**
 * esbuild is an optional peer dependency imported lazily, so installing screenci
 * never pulls it in unless a `.tsx` page overlay is actually used.
 */
async function esbuildClientBundler(opts: {
  entryPath: string
  propsJson: string
}): Promise<string> {
  let esbuild: typeof import('esbuild')
  try {
    esbuild = (await import('esbuild')) as unknown as typeof import('esbuild')
  } catch {
    throw new Error(
      '[screenci] A `.tsx` page overlay requires the optional peer dependency "esbuild" to bundle the component for the browser. Install it (for example `npm install --save-dev esbuild`).'
    )
  }

  // The mount stub imported by esbuild. It pulls in the author's default-exported
  // component plus the browser React runtime (resolved from the entry file's own
  // node_modules), and renders it into the overlay root with the given props.
  const stub =
    `import __Component from ${JSON.stringify(opts.entryPath)}\n` +
    `import { createElement as __createElement } from 'react'\n` +
    `import { createRoot as __createRoot } from 'react-dom/client'\n` +
    `const __root = document.getElementById(${JSON.stringify(OVERLAY_ROOT_ID)})\n` +
    `__createRoot(__root).render(__createElement(__Component, ${opts.propsJson}))\n`

  let result
  try {
    result = await esbuild.build({
      stdin: {
        contents: stub,
        // Resolve the author's imports (react, react-dom, helpers) from the
        // component file's own project, not screenci's.
        resolveDir: dirname(opts.entryPath),
        loader: 'ts',
        sourcefile: 'screenci-overlay-mount.ts',
      },
      bundle: true,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      // Build React in production mode: no dev-only warnings or overhead in the
      // captured overlay.
      define: { 'process.env.NODE_ENV': '"production"' },
      write: false,
      logLevel: 'silent',
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[screenci] Failed to bundle client overlay entry "${opts.entryPath}".\n${detail}`
    )
  }

  const file = result.outputFiles?.[0]
  if (file === undefined) {
    throw new Error(
      `[screenci] Bundling client overlay entry "${opts.entryPath}" produced no output.`
    )
  }
  return file.text
}

let bundler: ClientOverlayBundler = esbuildClientBundler

/** Test hook: replace the esbuild bundler with a stub. */
export function setClientOverlayBundler(fn: ClientOverlayBundler): void {
  bundler = fn
}

/** Restore the real esbuild bundler (used by tests to undo {@link setClientOverlayBundler}). */
export function resetClientOverlayBundler(): void {
  bundler = esbuildClientBundler
}

/**
 * Builds the full overlay document for a `.tsx` page overlay: a minimal
 * transparent host page with an empty `#screenci-overlay-root` and the bundled
 * component's IIFE, which mounts the React app into that root with the given
 * props. The rasterizer loads this document and waits for the mount (awaitMount)
 * before capturing.
 */
export async function buildClientOverlayDocument(
  entryPath: string,
  props: Record<string, unknown> | undefined
): Promise<string> {
  const script = await bundler({
    entryPath,
    propsJson: JSON.stringify(props ?? {}),
  })
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;background:transparent}' +
    `#${OVERLAY_ROOT_ID}{display:inline-block}` +
    `</style></head><body><div id="${OVERLAY_ROOT_ID}"></div>` +
    `<script>${script}</script></body></html>`
  )
}
