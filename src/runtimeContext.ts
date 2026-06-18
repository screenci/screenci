import { AsyncLocalStorage } from 'async_hooks'
import type { Page } from '@playwright/test'
import {
  NOOP_EVENT_RECORDER,
  type IEventRecorder,
  type ElementRect,
} from './events.js'
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

export type ActiveAssetRun = {
  finished: Promise<void>
  resolveFinished: () => void
  startedWithExplicitStart: boolean
}

export type TimelineBlockType = 'hide' | 'speed' | 'time'

export type TimelineBlockState = {
  type: TimelineBlockType
  multiplier?: number
  durationMs?: number
}

export type ScreenCIRuntimeContext = {
  cueRecorder: IEventRecorder
  hideRecorder: IEventRecorder
  autoZoomRecorder: IEventRecorder
  assetRecorder: IEventRecorder
  clickRecorder: IEventRecorder
  page: Page | null
  testFilePath: string | null
  /**
   * Per-recording output directory (`.screenci/<title>/`) when recording is
   * active. Generated overlay assets (HTML/React rasterized to PNG) are written
   * here so they are uploaded alongside the recording. Null when not recording.
   */
  recordingDir: string | null
  timelineBlocks: TimelineBlockState[]
  cue: {
    activeCueName: string | null
    activeCueRun: ActiveCueRun | null
    usedCueNames: Set<string>
  }
  asset: {
    activeAssetName: string | null
    activeAssetRun: ActiveAssetRun | null
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
    recordingDir?: string | null
  } = {}
): ScreenCIRuntimeContext {
  const defaultRecorder = overrides.recorder ?? NOOP_EVENT_RECORDER
  return {
    cueRecorder: defaultRecorder,
    hideRecorder: defaultRecorder,
    autoZoomRecorder: defaultRecorder,
    assetRecorder: defaultRecorder,
    clickRecorder: defaultRecorder,
    page: overrides.page ?? null,
    testFilePath: overrides.testFilePath ?? null,
    recordingDir: overrides.recordingDir ?? null,
    timelineBlocks: [],
    cue: {
      activeCueName: null,
      activeCueRun: null,
      usedCueNames: new Set<string>(),
    },
    asset: {
      activeAssetName: null,
      activeAssetRun: null,
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
  getScreenCIRuntimeContext().cueRecorder = recorder ?? NOOP_EVENT_RECORDER
}

export function getRuntimeCueRecorder(): IEventRecorder {
  return getScreenCIRuntimeContext().cueRecorder
}

export function setRuntimeHideRecorder(recorder: IEventRecorder | null): void {
  getScreenCIRuntimeContext().hideRecorder = recorder ?? NOOP_EVENT_RECORDER
}

export function getRuntimeHideRecorder(): IEventRecorder {
  return getScreenCIRuntimeContext().hideRecorder
}

export function setRuntimeAutoZoomRecorder(
  recorder: IEventRecorder | null
): void {
  getScreenCIRuntimeContext().autoZoomRecorder = recorder ?? NOOP_EVENT_RECORDER
}

export function getRuntimeAutoZoomRecorder(): IEventRecorder {
  return getScreenCIRuntimeContext().autoZoomRecorder
}

export function setRuntimeAssetRecorder(recorder: IEventRecorder | null): void {
  getScreenCIRuntimeContext().assetRecorder = recorder ?? NOOP_EVENT_RECORDER
}

export function getRuntimeAssetRecorder(): IEventRecorder {
  return getScreenCIRuntimeContext().assetRecorder
}

export function setRuntimeClickRecorder(recorder: IEventRecorder | null): void {
  getScreenCIRuntimeContext().clickRecorder = recorder ?? NOOP_EVENT_RECORDER
}

export function getRuntimeClickRecorder(): IEventRecorder {
  return getScreenCIRuntimeContext().clickRecorder
}

export function setRuntimePage(page: Page | null): void {
  getScreenCIRuntimeContext().page = page
}

export function getRuntimePage(): Page | null {
  return getScreenCIRuntimeContext().page
}

export function getRuntimeRecordingDir(): string | null {
  return getScreenCIRuntimeContext().recordingDir
}

export function resetCueRuntimeState(): void {
  const context = getScreenCIRuntimeContext()
  context.cue.activeCueName = null
  context.cue.activeCueRun = null
  context.cue.usedCueNames.clear()
}

export function resetAssetRuntimeState(): void {
  const context = getScreenCIRuntimeContext()
  context.asset.activeAssetName = null
  context.asset.activeAssetRun = null
}

export function pushRuntimeTimelineBlock(block: TimelineBlockState): void {
  getScreenCIRuntimeContext().timelineBlocks.push(block)
}

export function popRuntimeTimelineBlock(
  expectedType: TimelineBlockType
): TimelineBlockState {
  const blocks = getScreenCIRuntimeContext().timelineBlocks
  const block = blocks.pop()
  if (block === undefined) {
    throw new Error(`Cannot end ${expectedType}() without an active block`)
  }
  if (block.type !== expectedType) {
    throw new Error(
      `Cannot end ${expectedType}() while ${block.type}() is the active block`
    )
  }
  return block
}

export function hasRuntimeTimelineBlock(type: TimelineBlockType): boolean {
  return getScreenCIRuntimeContext().timelineBlocks.some(
    (block) => block.type === type
  )
}

export function getRuntimeTimelineBlocks(): TimelineBlockState[] {
  return [...getScreenCIRuntimeContext().timelineBlocks]
}

export function isRuntimeInsideHide(): boolean {
  return hasRuntimeTimelineBlock('hide')
}

export function getRuntimeAutoZoomState(): AutoZoomState {
  return getScreenCIRuntimeContext().autoZoom
}

export function setRuntimeAutoZoomState(state: AutoZoomState): void {
  getScreenCIRuntimeContext().autoZoom = state
}
