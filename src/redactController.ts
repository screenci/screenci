/**
 * In-page redaction controller.
 *
 * screenci records the live browser page, so the only way to keep a secret out
 * of `recording.mp4` (and therefore out of the upload) is to mask it in the DOM
 * before Chrome captures the frame. This module is the browser-side half: a
 * self-contained controller installed via `addInitScript` that covers target
 * elements with an opaque panel (by default tinted to match the surface beneath
 * them), tracking their position every animation frame so the mask follows
 * scroll, layout, and animation.
 *
 * The functions here are serialized and shipped to the page by Playwright, so
 * they must not reference anything outside their own bodies.
 */

/**
 * A redact style resolved to concrete pixel values, ready to apply in the page.
 * `RedactStyle` (the user-facing option) is resolved to this by
 * `resolveRedactStyle` in `redact.ts`.
 */
export type ResolvedRedactStyle = {
  /** Fixed fill color, or null to sample one from underneath in the page. */
  color: string | null
  radiusPx: number
  shadow: string | null
  /** Extra CSS for the mask panel, or null. */
  css: string | null
}

/** Window global exposed by the controller for the Node side to drive. */
export type RedactWindowApi = {
  /** Mask specific element handles (used by runtime `redact`; pierces shadow DOM). */
  addElements: (
    id: string,
    elements: Element[],
    style: ResolvedRedactStyle
  ) => void
  /** Mask everything matching a CSS selector, re-queried each frame. */
  addSelector: (
    id: string,
    selector: string,
    style: ResolvedRedactStyle
  ) => void
  /** Remove a mask by id, restoring the element. */
  remove: (id: string) => void
  /** Remove every mask. */
  clear: () => void
}

/** Attribute stamped on elements masked by a runtime `redact` call. */
export const REDACT_ID_ATTRIBUTE = 'data-screenci-redact-id'

/** Id of the fixed-position container that holds every tint div. */
export const REDACT_ROOT_ID = '__screenci_redact_root'

/** Name of the window global the controller installs. */
export const REDACT_WINDOW_KEY = '__screenci_redact'

/**
 * The controller bootstrap. Runs in the page (via `addInitScript`) on every
 * document. Idempotent: a second run is a no-op, so it is safe to inject more
 * than once.
 */
export function redactControllerBootstrap(): void {
  const KEY = '__screenci_redact'
  const ROOT_ID = '__screenci_redact_root'
  const win = window as unknown as Record<string, unknown>
  if (win[KEY]) return

  type Resolved = {
    color: string | null
    radiusPx: number
    shadow: string | null
    css: string | null
  }

  type Entry = {
    style: Resolved
    selector: string | null
    elements: Element[] | null
    // Per-element mask panels.
    masks: Map<Element, HTMLDivElement>
  }

  const entries = new Map<string, Entry>()
  let root: HTMLDivElement | null = null
  let rafId: number | null = null

  function ensureRoot(): HTMLDivElement | null {
    if (root && root.isConnected) return root
    // At document-start (init script) the parent may not exist yet; the rAF
    // loop retries next frame rather than throwing and dying.
    const parent = document.body ?? document.documentElement
    if (!parent) return null
    const existing = document.getElementById(ROOT_ID)
    if (existing) {
      root = existing as HTMLDivElement
      return root
    }
    const el = document.createElement('div')
    el.id = ROOT_ID
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;margin:0;padding:0;' +
      'border:0;pointer-events:none;z-index:2147483647;'
    // Append to documentElement so it survives <body> swaps in SPAs.
    document.documentElement.appendChild(el)
    root = el
    return el
  }

  function isTransparentColor(c: string): boolean {
    return (
      !c ||
      c === 'transparent' ||
      /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(c)
    )
  }

  // Pick an opaque fill color from the surface under the element: its own
  // background, or the nearest ancestor (or the body) that paints one. This
  // gives a clean, uniform panel that blends with the surrounding UI.
  function sampleRegionColor(el: Element): string {
    let node: Element | null = el
    while (node) {
      const bg = getComputedStyle(node).backgroundColor
      if (!isTransparentColor(bg)) return bg
      node = node.parentElement
    }
    const bodyBg = document.body
      ? getComputedStyle(document.body).backgroundColor
      : ''
    return isTransparentColor(bodyBg) ? '#e5e5e5' : bodyBg
  }

  function styleMask(
    div: HTMLDivElement,
    style: Resolved,
    autoColor: string | null
  ): void {
    // Opaque panel: a fixed color, or one sampled to match what is underneath.
    div.style.background = style.color ?? autoColor ?? '#e5e5e5'
    div.style.borderRadius = `${style.radiusPx}px`
    div.style.boxShadow = style.shadow ?? 'none'
    // Custom styling, applied last so it can override the defaults.
    if (style.css) div.style.cssText += ';' + style.css
    // Keep the panel non-interactive and absolutely positioned regardless of
    // any custom CSS.
    div.style.position = 'absolute'
    div.style.pointerEvents = 'none'
  }

  function resolveElements(entry: Entry): Element[] {
    if (entry.selector !== null) {
      return Array.from(document.querySelectorAll(entry.selector))
    }
    return (entry.elements ?? []).filter((el) => el.isConnected)
  }

  function positionFrame(): void {
    const container = ensureRoot()
    if (!container) {
      // DOM not ready yet; try again next frame while masks are pending.
      rafId = entries.size > 0 ? requestAnimationFrame(positionFrame) : null
      return
    }
    for (const entry of entries.values()) {
      const seen = new Set<Element>()
      for (const el of resolveElements(entry)) {
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue
        seen.add(el)
        let div = entry.masks.get(el)
        if (!div) {
          div = document.createElement('div')
          div.style.cssText =
            'position:absolute;top:0;left:0;pointer-events:none;will-change:transform;'
          const autoColor =
            entry.style.color === null ? sampleRegionColor(el) : null
          styleMask(div, entry.style, autoColor)
          container.appendChild(div)
          entry.masks.set(el, div)
        }
        // Inflate just enough that the rounded corners never expose the
        // element's square corners underneath. A rounded rect of radius r covers
        // an inner corner once it extends about 0.29*r beyond it, so this stays
        // tight to the element rather than looking oversized.
        const pad = Math.ceil(entry.style.radiusPx * 0.3)
        div.style.transform = `translate(${rect.left - pad}px, ${rect.top - pad}px)`
        div.style.width = `${rect.width + pad * 2}px`
        div.style.height = `${rect.height + pad * 2}px`
        div.style.display = 'block'
      }
      // Tear down masks for elements that vanished this frame.
      for (const [el, div] of entry.masks) {
        if (seen.has(el)) continue
        div.remove()
        entry.masks.delete(el)
      }
    }
    rafId = entries.size > 0 ? requestAnimationFrame(positionFrame) : null
  }

  function startLoop(): void {
    if (rafId !== null) return
    // Run one synchronous frame so a freshly added mask covers its element
    // before this call returns (no unmasked frame escapes to the recording),
    // then keep tracking on rAF.
    positionFrame()
  }

  function teardownEntry(entry: Entry): void {
    for (const [el, div] of entry.masks) {
      div.remove()
      entry.masks.delete(el)
    }
  }

  const api: RedactWindowApi = {
    addElements(id, elements, style) {
      const entry: Entry = {
        style: style as Resolved,
        selector: null,
        elements,
        masks: new Map(),
      }
      const prev = entries.get(id)
      if (prev) teardownEntry(prev)
      entries.set(id, entry)
      startLoop()
    },
    addSelector(id, selector, style) {
      const entry: Entry = {
        style: style as Resolved,
        selector,
        elements: null,
        masks: new Map(),
      }
      const prev = entries.get(id)
      if (prev) teardownEntry(prev)
      entries.set(id, entry)
      startLoop()
    },
    remove(id) {
      const entry = entries.get(id)
      if (!entry) return
      teardownEntry(entry)
      entries.delete(id)
    },
    clear() {
      for (const entry of entries.values()) teardownEntry(entry)
      entries.clear()
    },
  }

  win[KEY] = api
}

/**
 * Init script that masks the configured first-paint selectors. Registered after
 * the bootstrap so `window.__screenci_redact` already exists. A CSS rule hides
 * matches the instant they paint (race free, no JS timing), and the controller
 * lays the opaque panel over them a frame later.
 */
export function redactApplyConfigSelectors(config: {
  selectors: string[]
  style: ResolvedRedactStyle
}): void {
  const KEY = '__screenci_redact'
  const api = (window as unknown as Record<string, unknown>)[KEY] as
    | RedactWindowApi
    | undefined
  if (!api || config.selectors.length === 0) return

  // Hide matches the instant they paint, before the JS panel can position
  // itself, so the secret never flashes on the first frame. `visibility:hidden`
  // keeps the layout box so the panel is sized correctly, and it fails closed if
  // the controller never runs.
  const css = config.selectors
    .map((sel) => `${sel}{visibility:hidden !important;}`)
    .join('')
  const style = document.createElement('style')
  style.setAttribute('data-screenci-redact', 'config')
  style.textContent = css
  const attach = (): void => {
    ;(document.head ?? document.documentElement).appendChild(style)
  }
  if (document.head) attach()
  else document.addEventListener('DOMContentLoaded', attach, { once: true })

  config.selectors.forEach((selector, index) => {
    api.addSelector(`__screenci_config_${index}`, selector, config.style)
  })
}
