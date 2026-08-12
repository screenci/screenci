import { dirname, join } from 'path'
import type {
  ClientOverlayBundle,
  ClientOverlayEntry,
  OverlayFramework,
} from './clientOverlay.js'
import { OVERLAY_ROOT_ID } from './clientOverlay.js'

type VitePlugin = import('vite').Plugin
type ViteInlineConfig = import('vite').InlineConfig

/** Virtual specifier for the mount stub that bootstraps the overlay bundle. */
const VIRTUAL_ENTRY_ID = 'virtual:screenci-overlay-entry'
const RESOLVED_ENTRY_ID = '\0screenci-overlay-entry.ts'

/**
 * Basename for an inline-source overlay module. The synthetic id is anchored in
 * the recording file's directory (a real, existing directory) so relative and
 * package imports inside the inline source resolve exactly as they would from a
 * sibling file of the recording.
 */
const INLINE_SOURCE_BASENAME = '__screenci-inline-overlay__'

/** Human-readable install hint per optional peer dependency group. */
const FRAMEWORK_REQUIREMENTS: Record<
  OverlayFramework,
  { packages: string[]; what: string }
> = {
  react: { packages: ['react', 'react-dom'], what: 'a React page overlay' },
  solid: {
    packages: ['solid-js', 'vite-plugin-solid'],
    what: 'a Solid page overlay',
  },
  vue: { packages: ['vue', '@vitejs/plugin-vue'], what: 'a Vue page overlay' },
  svelte: {
    packages: ['svelte', '@sveltejs/vite-plugin-svelte'],
    what: 'a Svelte page overlay',
  },
}

function missingDependencyError(
  what: string,
  packages: string[],
  detail?: string
): Error {
  const list = packages.map((p) => `"${p}"`).join(', ')
  return new Error(
    `[screenci] ${what} requires the optional peer ${packages.length === 1 ? 'dependency' : 'dependencies'} ${list}. ` +
      `Install ${packages.length === 1 ? 'it' : 'them'} (for example \`npm install --save-dev ${packages.join(' ')}\`).` +
      (detail !== undefined ? `\n${detail}` : '')
  )
}

/**
 * The extension the synthetic inline-source module needs so the right transform
 * applies: `.solid.tsx` keeps Solid's JSX away from the default React
 * transform; `.tsx` gets Vite's automatic-runtime React JSX.
 */
function inlineSourceExtension(framework: OverlayFramework): string {
  switch (framework) {
    case 'react':
      return '.tsx'
    case 'solid':
      return '.solid.tsx'
    case 'vue':
      return '.vue'
    case 'svelte':
      return '.svelte'
  }
}

/**
 * The framework-specific mount stub: plain TS (no JSX) that imports the
 * author's default-exported component from `componentId` and renders it into
 * the overlay root with the given props.
 */
function buildMountStub(
  framework: OverlayFramework,
  componentId: string,
  propsJson: string
): string {
  const importComponent = `import __Component from ${JSON.stringify(componentId)}\n`
  const getRoot = `const __root = document.getElementById(${JSON.stringify(OVERLAY_ROOT_ID)})\n`
  const props = `const __props = ${propsJson}\n`
  switch (framework) {
    case 'react':
      return (
        importComponent +
        `import { createElement as __createElement } from 'react'\n` +
        `import { createRoot as __createRoot } from 'react-dom/client'\n` +
        getRoot +
        props +
        `__createRoot(__root).render(__createElement(__Component, __props))\n`
      )
    case 'solid':
      return (
        importComponent +
        `import { render as __render } from 'solid-js/web'\n` +
        getRoot +
        props +
        `__render(() => __Component(__props), __root)\n`
      )
    case 'vue':
      return (
        importComponent +
        `import { createApp as __createApp } from 'vue'\n` +
        getRoot +
        props +
        `__createApp(__Component, __props).mount(__root)\n`
      )
    case 'svelte':
      return (
        importComponent +
        `import { mount as __mount } from 'svelte'\n` +
        getRoot +
        props +
        `__mount(__Component, { target: __root, props: __props })\n`
      )
  }
}

/**
 * Loads the Vite plugin(s) a framework's single-file components / JSX need.
 * React needs none (Vite's built-in esbuild transform handles `.tsx` with the
 * automatic JSX runtime). Plugins are imported lazily so installing screenci
 * never pulls them in unless that framework is actually used.
 */
async function loadFrameworkPlugins(
  framework: OverlayFramework
): Promise<VitePlugin[]> {
  const requirement = FRAMEWORK_REQUIREMENTS[framework]
  try {
    switch (framework) {
      case 'react':
        return []
      case 'solid': {
        const mod = (await import('vite-plugin-solid')) as unknown as {
          default: (options?: unknown) => VitePlugin
        }
        return [mod.default()]
      }
      case 'vue': {
        const mod = (await import('@vitejs/plugin-vue')) as unknown as {
          default: (options?: unknown) => VitePlugin
        }
        return [mod.default()]
      }
      case 'svelte': {
        const mod =
          (await import('@sveltejs/vite-plugin-svelte')) as unknown as {
            svelte: (options?: unknown) => VitePlugin | VitePlugin[]
          }
        const plugin = mod.svelte()
        return Array.isArray(plugin) ? plugin : [plugin]
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw missingDependencyError(requirement.what, requirement.packages, detail)
  }
}

/**
 * The plugin providing the two virtual modules of an overlay build: the mount
 * stub entry, and (for inline source) the author's module anchored in the
 * recording file's directory. `enforce: 'pre'` so these ids are claimed before
 * Vite's own resolver looks for them on disk.
 */
function screenciOverlayEntryPlugin(
  entry: ClientOverlayEntry,
  propsJson: string
): VitePlugin {
  const componentId =
    entry.kind === 'file'
      ? entry.path
      : join(
          entry.resolveDir,
          INLINE_SOURCE_BASENAME + inlineSourceExtension(entry.framework)
        )
  const stub = buildMountStub(entry.framework, componentId, propsJson)
  return {
    name: 'screenci-overlay-entry',
    enforce: 'pre',
    resolveId(id) {
      if (id === VIRTUAL_ENTRY_ID) return RESOLVED_ENTRY_ID
      if (entry.kind === 'source' && id === componentId) return componentId
      return null
    },
    load(id) {
      if (id === RESOLVED_ENTRY_ID) return stub
      if (entry.kind === 'source' && id === componentId) return entry.code
      return null
    },
  }
}

/**
 * Bundles a page overlay with Vite (an optional peer dependency imported
 * lazily, so installing screenci never pulls it in unless a bundled page
 * overlay is actually used). The build is fully in-memory (`write: false`), an
 * IIFE for the browser, with the author's imports resolved from the component
 * file's own project. Extracted CSS (framework single-file-component styles,
 * `import './x.css'`) is returned separately for the host document `<style>`.
 */
export async function viteOverlayBundler(opts: {
  entry: ClientOverlayEntry
  propsJson: string
}): Promise<ClientOverlayBundle> {
  let vite: typeof import('vite')
  try {
    vite = (await import('vite')) as unknown as typeof import('vite')
  } catch {
    throw missingDependencyError(
      'A bundled page overlay (.tsx/.solid.tsx/.vue/.svelte or inline jsx/solidJsx)',
      ['vite']
    )
  }

  const { entry, propsJson } = opts
  const root = entry.kind === 'file' ? dirname(entry.path) : entry.resolveDir
  const entryLabel =
    entry.kind === 'file' ? entry.path : `inline ${entry.framework} source`

  const plugins: VitePlugin[] = [
    screenciOverlayEntryPlugin(entry, propsJson),
    ...(await loadFrameworkPlugins(entry.framework)),
  ]

  const config: ViteInlineConfig = {
    configFile: false,
    envFile: false,
    root,
    logLevel: 'silent',
    plugins,
    // Build the framework in production mode: no dev-only warnings or overhead
    // in the captured overlay.
    define: { 'process.env.NODE_ENV': '"production"' },
    esbuild: { jsx: 'automatic' },
    build: {
      write: false,
      minify: false,
      cssCodeSplit: false,
      target: 'es2020',
      rollupOptions: {
        input: VIRTUAL_ENTRY_ID,
        output: { format: 'iife', inlineDynamicImports: true },
        // Keep rollup warnings out of the recording output; hard errors still throw.
        onwarn: () => {},
      },
    },
  }

  let output
  try {
    const result = await vite.build(config)
    output = Array.isArray(result) ? result[0] : result
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[screenci] Failed to bundle client overlay entry "${entryLabel}".\n${detail}`
    )
  }
  if (output === undefined || !('output' in output)) {
    throw new Error(
      `[screenci] Bundling client overlay entry "${entryLabel}" produced no output.`
    )
  }

  let js = ''
  let css = ''
  for (const item of output.output) {
    if (item.type === 'chunk') {
      js += item.code
    } else if (
      item.fileName.endsWith('.css') &&
      typeof item.source === 'string'
    ) {
      css += item.source
    }
  }
  if (js === '') {
    throw new Error(
      `[screenci] Bundling client overlay entry "${entryLabel}" produced no output.`
    )
  }
  return { js, css }
}
