import { AsyncLocalStorage } from 'async_hooks'
import type { Page } from '@playwright/test'
import type { IEventRecorder, ElementRect } from './events.js'
import type { AutoZoomOptions } from './types.js'

export type CurrentZoomViewport = {
  focusPoint: { x: number; y: number }
  elementRect?: ElementRect
  end: {
    pointPx: { x: number; y: number }
    size: { widthPx: number; heightPx: number }
  }
  optimalOffset?: { x: number; y: number }
  viewportSize: { width: number; height: number }
}

export type AutoZoomState = {
  insideAutoZoom: boolean
  mode: 'idle' | 'auto' | 'manual'
  options: AutoZoomOptions
  currentZoomViewport: CurrentZoomViewport | null
}

export type ActiveCueRun = {
  finished: Promise<void>
  resolveFinished: () => void
  startedWithExplicitStart: boolean
}

export type ScreenCIRuntimeContext = {
  cueRecorder: IEventRecorder | null
  hideRecorder: IEventRecorder | null
  autoZoomRecorder: IEventRecorder | null
  assetRecorder: IEventRecorder | null
  clickRecorder: IEventRecorder | null
  page: Page | null
  testFilePath: string | null
  insideHide: boolean
  cue: {
    activeCueName: string | null
    activeCueRun: ActiveCueRun | null
    usedCueNames: Set<string>
  }
  autoZoom: AutoZoomState
}

const runtimeContextStorage = new AsyncLocalStorage<ScreenCIRuntimeContext>()

const fallbackRuntimeContext = createScreenCIRuntimeContext()
let activeRuntimeContext: ScreenCIRuntimeContext | null = null

export function createScreenCIRuntimeContext(
  overrides: {
    recorder?: IEventRecorder | null
    page?: Page | null
    testFilePath?: string | null
  } = {}
): ScreenCIRuntimeContext {
  const defaultRecorder = overrides.recorder ?? null
  return {
    cueRecorder: defaultRecorder,
    hideRecorder: defaultRecorder,
    autoZoomRecorder: defaultRecorder,
    assetRecorder: defaultRecorder,
    clickRecorder: defaultRecorder,
    page: overrides.page ?? null,
    testFilePath: overrides.testFilePath ?? null,
    insideHide: false,
    cue: {
      activeCueName: null,
      activeCueRun: null,
      usedCueNames: new Set<string>(),
    },
    autoZoom: {
      insideAutoZoom: false,
      mode: 'idle',
      options: {},
      currentZoomViewport: null,
    },
  }
}

export function runWithScreenCIRuntimeContext<T>(
  context: ScreenCIRuntimeContext,
  fn: () => T
): T {
  return runtimeContextStorage.run(context, fn)
}

export function getScreenCIRuntimeContext(): ScreenCIRuntimeContext {
  return (
    runtimeContextStorage.getStore() ??
    activeRuntimeContext ??
    fallbackRuntimeContext
  )
}

export function setActiveScreenCIRuntimeContext(
  context: ScreenCIRuntimeContext | null
): void {
  activeRuntimeContext = context
}

export function setRuntimeCueRecorder(recorder: IEventRecorder | null): void {
  getScreenCIRuntimeContext().cueRecorder = recorder
}

export function getRuntimeCueRecorder(): IEventRecorder | null {
  return getScreenCIRuntimeContext().cueRecorder
}

export function setRuntimeHideRecorder(recorder: IEventRecorder | null): void {
  getScreenCIRuntimeContext().hideRecorder = recorder
}

export function getRuntimeHideRecorder(): IEventRecorder | null {
  return getScreenCIRuntimeContext().hideRecorder
}

export function setRuntimeAutoZoomRecorder(
  recorder: IEventRecorder | null
): void {
  getScreenCIRuntimeContext().autoZoomRecorder = recorder
}

export function getRuntimeAutoZoomRecorder(): IEventRecorder | null {
  return getScreenCIRuntimeContext().autoZoomRecorder
}

export function setRuntimeAssetRecorder(recorder: IEventRecorder | null): void {
  getScreenCIRuntimeContext().assetRecorder = recorder
}

export function getRuntimeAssetRecorder(): IEventRecorder | null {
  return getScreenCIRuntimeContext().assetRecorder
}

export function setRuntimeClickRecorder(recorder: IEventRecorder | null): void {
  getScreenCIRuntimeContext().clickRecorder = recorder
}

export function getRuntimeClickRecorder(): IEventRecorder | null {
  return getScreenCIRuntimeContext().clickRecorder
}

export function setRuntimePage(page: Page | null): void {
  getScreenCIRuntimeContext().page = page
}

export function getRuntimePage(): Page | null {
  return getScreenCIRuntimeContext().page
}

export function resetCueRuntimeState(): void {
  const context = getScreenCIRuntimeContext()
  context.cue.activeCueName = null
  context.cue.activeCueRun = null
  context.cue.usedCueNames.clear()
}

export function setRuntimeInsideHide(insideHide: boolean): void {
  getScreenCIRuntimeContext().insideHide = insideHide
}

export function isRuntimeInsideHide(): boolean {
  return getScreenCIRuntimeContext().insideHide
}

export function getRuntimeAutoZoomState(): AutoZoomState {
  return getScreenCIRuntimeContext().autoZoom
}

export function setRuntimeAutoZoomState(state: AutoZoomState): void {
  getScreenCIRuntimeContext().autoZoom = state
}
