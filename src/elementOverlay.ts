import { buildOverlayHostDocument } from './clientOverlay.js'

/**
 * The `$$typeof` brands a React element carries at runtime. React 18 uses
 * `react.element`; React 19 renamed it to `react.transient.element`. Checked
 * structurally so react is never imported just to detect an element.
 */
const REACT_ELEMENT_TYPES = new Set<symbol>([
  Symbol.for('react.element'),
  Symbol.for('react.transient.element'),
])

/**
 * Minimal structural type for a React element, used instead of the `react`
 * types so screenci's public types never require `@types/react`. A real
 * `ReactElement` (the value of a JSX expression) satisfies it.
 */
export type ReactElementLike = {
  type: unknown
  props: unknown
  key: string | null
}

/** Runtime check for a React element (React 18 and 19 brands). */
export function isReactElement(value: unknown): value is ReactElementLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    REACT_ELEMENT_TYPES.has(
      (value as { $$typeof?: unknown }).$$typeof as symbol
    )
  )
}

/**
 * Renders a React element to static HTML markup. Injectable so tests can avoid
 * importing react-dom.
 */
export type ElementOverlayRenderer = (element: unknown) => Promise<string>

/**
 * react-dom is an optional peer dependency imported lazily, so installing
 * screenci never pulls it in unless an `element` overlay is actually used.
 */
async function reactDomServerRenderer(element: unknown): Promise<string> {
  let server: typeof import('react-dom/server')
  try {
    server =
      (await import('react-dom/server')) as unknown as typeof import('react-dom/server')
  } catch {
    throw new Error(
      '[screenci] An `element` overlay requires the optional peer dependencies "react" and "react-dom" to render the element. Install them (for example `npm install --save-dev react react-dom`).'
    )
  }
  return server.renderToStaticMarkup(
    element as Parameters<typeof server.renderToStaticMarkup>[0]
  )
}

let renderer: ElementOverlayRenderer = reactDomServerRenderer

/** Test hook: replace the react-dom/server renderer with a stub. */
export function setElementOverlayRenderer(fn: ElementOverlayRenderer): void {
  renderer = fn
}

/** Restore the real renderer (used by tests to undo {@link setElementOverlayRenderer}). */
export function resetElementOverlayRenderer(): void {
  renderer = reactDomServerRenderer
}

/**
 * Builds the full overlay document for an `element` overlay: the element is
 * rendered in-process to static markup (so props are baked in and test-scope
 * values can be closed over directly) and placed inside the shared transparent
 * host document's overlay root. No client JS runs; CSS animations still play
 * under the virtual clock when `animate: true`.
 */
export async function buildElementOverlayDocument(
  element: unknown
): Promise<string> {
  const markup = await renderer(element)
  return buildOverlayHostDocument({ rootContent: markup })
}
