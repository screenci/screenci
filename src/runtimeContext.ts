import { AsyncLocalStorage } from 'async_hooks'
import type { Page } from '@playwright/test'
import {
  NOOP_EVENT_RECORDER,
  type IEventRecorder,
  type ElementRect,
} from './events.js'
import type { AutoZoomOptions, RecordOptions, RenderOptions } from './types.js'
import type { StudioRenderOptionsSentinel } from './studio.js'
import type { ScreenshotCropRecord } from './crop.js'

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

export type ActiveAudioRun = {
  finished: Promise<void>
  resolveFinished: () => void
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
  audioRecorder: IEventRecorder
  clickRecorder: IEventRecorder
  page: Page | null
  testFilePath: string | null
  /**
   * Per-recording output directory (`.screenci/<title>/`) when recording is
   * active. Generated overlay assets (HTML/React rasterized to PNG) are written
   * here so they are uploaded alongside the recording. Null when not recording.
   */
  recordingDir: string | null
  /** Resolved capture options for the active recording, when available. */
  recordOptions: RecordOptions | null
  /** Base render options for the active recording (drive a still's framing). */
  renderOptions: RenderOptions | StudioRenderOptionsSentinel | undefined
  /**
   * Crop recorded for the current `screenshot()` fixture capture, or null for the
   * full image. Set via the `crop` fixture argument and read by the fixture at
   * capture time. Replaces the previous module-global crop state.
   */
  crop: ScreenshotCropRecord | null
  timelineBlocks: TimelineBlockState[]
  cue: {
    activeCueName: string | null
    activeCueRun: ActiveCueRun | null
    usedCueNames: Set<string>
  }
  asset: {
    /**
     * Live overlays driven by `start()`/`end()`, keyed by name. Overlays may
     * overlap (several active at once), so this is a map rather than a single
     * slot. Blocking overlays (`overlays.x(ms)`) never register here.
     */
    activeRuns: Map<string, ActiveAssetRun>
  }
  audio: {
    /**
     * Background audio tracks (`createAudio`) that are playing, keyed by name.
     * Tracks are non-exclusive (music plus a sound effect can overlap), so this
     * is a map. A track left open here plays to the end of the video.
     */
    activeRuns: Map<string, ActiveAudioRun>
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
    recordOptions?: RecordOptions | null
    renderOptions?: RenderOptions | StudioRenderOptionsSentinel | undefined
  } = {}
): ScreenCIRuntimeContext {
  const defaultRecorder = overrides.recorder ?? NOOP_EVENT_RECORDER
  return {
    cueRecorder: defaultRecorder,
    hideRecorder: defaultRecorder,
    autoZoomRecorder: defaultRecorder,
    assetRecorder: defaultRecorder,
    audioRecorder: defaultRecorder,
    clickRecorder: defaultRecorder,
    page: overrides.page ?? null,
    testFilePath: overrides.testFilePath ?? null,
    recordingDir: overrides.recordingDir ?? null,
    recordOptions: overrides.recordOptions ?? null,
    renderOptions: overrides.renderOptions,
    crop: null,
    timelineBlocks: [],
    cue: {
      activeCueName: null,
      activeCueRun: null,
      usedCueNames: new Set<string>(),
    },
    asset: {
      activeRuns: new Map<string, ActiveAssetRun>(),
    },
    audio: {
      activeRuns: new Map<string, ActiveAudioRun>(),
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

export function setRuntimeAudioRecorder(recorder: IEventRecorder | null): void {
  getScreenCIRuntimeContext().audioRecorder = recorder ?? NOOP_EVENT_RECORDER
}

export function getRuntimeAudioRecorder(): IEventRecorder {
  return getScreenCIRuntimeContext().audioRecorder
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

export function getRuntimeRecordOptions(): RecordOptions | null {
  return getScreenCIRuntimeContext().recordOptions
}

export function getRuntimeRenderOptions():
  | RenderOptions
  | StudioRenderOptionsSentinel
  | undefined {
  return getScreenCIRuntimeContext().renderOptions
}

export function setRuntimeCrop(crop: ScreenshotCropRecord | null): void {
  getScreenCIRuntimeContext().crop = crop
}

export function getRuntimeCrop(): ScreenshotCropRecord | undefined {
  return getScreenCIRuntimeContext().crop ?? undefined
}

export function resetCueRuntimeState(): void {
  const context = getScreenCIRuntimeContext()
  context.cue.activeCueName = null
  context.cue.activeCueRun = null
  context.cue.usedCueNames.clear()
}

export function resetAssetRuntimeState(): void {
  const context = getScreenCIRuntimeContext()
  context.asset.activeRuns.clear()
}

export function resetAudioRuntimeState(): void {
  const context = getScreenCIRuntimeContext()
  context.audio.activeRuns.clear()
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
