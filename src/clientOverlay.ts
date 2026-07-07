import { viteOverlayBundler } from './viteOverlayBundler.js'

export const OVERLAY_ROOT_ID = 'screenci-overlay-root'
const OVERLAY_FONT_STACK =
  '"Noto Sans", "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans Devanagari", "Noto Color Emoji", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/** The UI framework a bundled page overlay component is written in. */
export type OverlayFramework = 'react' | 'solid' | 'vue' | 'svelte'

/**
 * The component module handed to the bundler: either a file on disk (a `.tsx`,
 * `.solid.tsx`, `.vue`, or `.svelte` path) or inline source code. Inline source
 * resolves its imports relative to `resolveDir` (the declaring recording file's
 * directory), so relative and package imports behave as if the module lived
 * next to the recording.
 */
export type ClientOverlayEntry =
  | { kind: 'file'; path: string; framework: OverlayFramework }
  | {
      kind: 'source'
      code: string
      resolveDir: string
      framework: OverlayFramework
    }

/** A browser-ready overlay bundle: an IIFE script plus any extracted CSS. */
export type ClientOverlayBundle = { js: string; css: string }

/**
 * Bundles a page overlay component for the browser: the author's
 * default-exported component is bundled together with a framework-specific
 * mount stub that renders it into the overlay root, so the FULL framework
 * runtime runs during capture (hooks/effects/state, scoped styles, class
 * bindings).
 *
 * With `animate: true` the mounted app is advanced by the same deterministic
 * virtual clock that samples each frame, so effect timers /
 * requestAnimationFrame / state updates drive the captured frames reproducibly
 * (see htmlRasterizer).
 *
 * The bundler is injectable so tests can avoid running Vite.
 */
export type ClientOverlayBundler = (opts: {
  entry: ClientOverlayEntry
  propsJson: string
}) => Promise<ClientOverlayBundle>

let bundler: ClientOverlayBundler = viteOverlayBundler

/** Test hook: replace the Vite bundler with a stub. */
export function setClientOverlayBundler(fn: ClientOverlayBundler): void {
  bundler = fn
}

/** Restore the real Vite bundler (used by tests to undo {@link setClientOverlayBundler}). */
export function resetClientOverlayBundler(): void {
  bundler = viteOverlayBundler
}

/**
 * Builds the minimal transparent host page every rendered overlay variant
 * shares: a document with the overlay root (`#screenci-overlay-root`) holding
 * `rootContent`, plus optional extra CSS and a mount script. The rasterizer
 * loads this document and screenshots the root.
 */
export function buildOverlayHostDocument(opts: {
  rootContent?: string
  css?: string
  script?: string
}): string {
  const extraCss = opts.css !== undefined && opts.css !== '' ? opts.css : ''
  const script =
    opts.script !== undefined && opts.script !== ''
      ? `<script>${opts.script}</script>`
      : ''
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    `html,body{margin:0;padding:0;background:transparent;font-family:${OVERLAY_FONT_STACK}}` +
    `#${OVERLAY_ROOT_ID}{display:inline-block;font-family:inherit}` +
    '</style>' +
    (extraCss !== '' ? `<style>${extraCss}</style>` : '') +
    `</head><body><div id="${OVERLAY_ROOT_ID}">${opts.rootContent ?? ''}</div>` +
    `${script}</body></html>`
  )
}

/**
 * Builds the full overlay document for a bundled page overlay: the host page
 * with an empty `#screenci-overlay-root`, the bundle's CSS, and its IIFE, which
 * mounts the component into that root with the given props. The rasterizer
 * loads this document and waits for the mount (awaitMount) before capturing.
 */
export async function buildClientOverlayDocument(
  entry: ClientOverlayEntry,
  props: Record<string, unknown> | undefined
): Promise<string> {
  const bundle = await bundler({
    entry,
    propsJson: JSON.stringify(props ?? {}),
  })
  return buildOverlayHostDocument({
    css: bundle.css,
    script: bundle.js,
  })
}
