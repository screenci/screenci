import { existsSync, readFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { invalidOptionError, ScreenciError } from './errors.js'
import type {
  AutoZoomOptions,
  CueConfig,
  Easing,
  RecordOptions,
  RenderOptions,
  ResolvedRenderOptions,
} from './types.js'
import { RENDER_OPTIONS_DEFAULTS } from './types.js'
import {
  isStudioRenderOptions,
  type StudioRenderOptionsSentinel,
} from './studio.js'
import type { VoiceKey } from './voices.js'
import { DEFAULT_ZOOM_OPTIONS } from './defaults.js'
import { getGitMetadata } from './git.js'

function assertAutoZoomUnitIntervalOption(
  value: number,
  name: 'amount' | 'centering'
): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidOptionError({
      api: 'autoZoom',
      option: name,
      expectation: 'must be between 0 and 1',
      value,
    })
  }
}

export type VideoStartEvent = {
  type: 'videoStart'
  timeMs: 0
}

export type ElementRect = {
  x: number
  y: number
  width: number
  height: number
}

// ─── Inner event types (nested inside InputEvent.events) ──────────────────────

export type FocusChangeEvent = {
  type: 'focusChange'
  startMs: number
  endMs: number
  x: number
  y: number
  mouse?: {
    startMs: number
    endMs: number
    easing?: Easing
  }
  scroll?: {
    startMs: number
    endMs: number
    easing?: Easing
  }
  zoom?: {
    startMs: number
    endMs: number
    easing?: Easing
    end: {
      pointPx: { x: number; y: number }
      size: { widthPx: number; heightPx: number }
    }
    optimalOffset?: {
      x: number
      y: number
    }
  }
  elementRect?: ElementRect
}

export type MouseMoveEvent = {
  type: 'mouseMove'
  startMs: number
  endMs: number
  x: number
  y: number
  easing?: Easing
  zoomFollow?: boolean
  /** Bounding rect of the element the cursor moved to — used for zoom centering hints. */
  elementRect?: ElementRect
}

export type MouseDownEvent = {
  type: 'mouseDown'
  startMs: number
  endMs: number
  mouseSize?: number
  easing?: Easing
}

export type MouseUpEvent = {
  type: 'mouseUp'
  startMs: number
  endMs: number
  easing?: Easing
}

export type MouseShowEvent = {
  type: 'mouseShow'
  startMs: number
  endMs: number
}

export type MouseHideEvent = {
  type: 'mouseHide'
  startMs: number
  endMs: number
}

export type MouseWaitEvent = {
  type: 'mouseWait'
  startMs: number
  endMs: number
}

// ─── Outer InputEvent ─────────────────────────────────────────────────────────

/**
 * A recorded user input action containing one or more inner mouse events.
 * focusChange/mouseMove, mouseShow, and mouseHide subtypes each contain exactly one inner event.
 * All input events must not overlap in time; recording will throw if they do.
 * Cues are automatically prevented from falling inside any input event's time range.
 */
export type InputEvent = {
  type: 'input'
  subType:
    | 'click'
    | 'pressSequentially'
    | 'tap'
    | 'check'
    | 'uncheck'
    | 'select'
    | 'focusChange'
    | 'mouseMove'
    | 'mouseShow'
    | 'mouseHide'
    | 'hover'
    | 'selectText'
    | 'dragTo'
  events: Array<
    | FocusChangeEvent
    | MouseMoveEvent
    | MouseDownEvent
    | MouseUpEvent
    | MouseShowEvent
    | MouseHideEvent
    | MouseWaitEvent
  >
}

export type RecordingCustomVoiceRef = {
  assetHash: string
  /** Present only in recording phase (for CLI upload); stripped from submitted data. */
  assetPath?: string
}

export type CueTranslation = {
  text: string
  voice: VoiceKey | RecordingCustomVoiceRef
  /** TTS model type — `'expressive'` or `'consistent'`. Defaults to `'consistent'`. `'expressive'` requires the Business tier. */
  modelType?: string
  /** Gemini style prompt, or ElevenLabs `eleven_multilingual_v2` style exaggeration. */
  style?: string | number
  /** Accent description for expressive synthesis. Omitted from the prompt when not set. */
  accent?: string
  /** Pacing description for expressive synthesis, or speaking rate for consistent synthesis. */
  pacing?: string | number
  /** ElevenLabs `eleven_multilingual_v2` stability, from 0 to 1. */
  stability?: number
  /** ElevenLabs `eleven_multilingual_v2` similarity boost, from 0 to 1. */
  similarityBoost?: number
  /** ElevenLabs `eleven_multilingual_v2` speed, from 0.7 to 1.2. */
  speed?: number
  /** Whether ElevenLabs speaker boost is enabled. */
  useSpeakerBoost?: boolean
  /**
   * Integer seed included in the audio cache key. A different seed always forces
   * regeneration. Consistent output is not guaranteed across all voice types.
   */
  seed?: number
}

export type CueStartEvent = {
  type: 'cueStart'
  timeMs: number
  name: string
  /** Cue declared via `createStudioNarration` — text and voice come from Studio. */
  studio?: true
  /** Single-language API (backward compat) */
  text?: string
  cueConfig?: CueConfig
  /** Multi-language API — all language translations keyed by language code */
  translations?: Record<string, CueTranslation>
}

export type CueEndEvent = {
  type: 'cueEnd'
  timeMs: number
  reason?: 'auto' | 'wait'
}

/** File-based video cue translation. assetPath is present only in the local
 *  recording phase (for CLI upload) and is stripped before submitting to the backend. */
export type VideoCueTranslationFile = {
  assetHash: string
  /** Local file path — present only during recording; stripped from submitted data. */
  assetPath?: string
  subtitle?: string
}
/** TTS-based video cue translation — generates audio via text-to-speech. */
export type VideoCueTranslationTTS = {
  text: string
  voice: VoiceKey | RecordingCustomVoiceRef
  /** TTS model type — `'expressive'` or `'consistent'`. Defaults to `'consistent'`. `'expressive'` requires the Business tier. */
  modelType?: string
  /** Gemini style prompt, or ElevenLabs `eleven_multilingual_v2` style exaggeration. */
  style?: string | number
  /** Accent description for expressive synthesis. Omitted from the prompt when not set. */
  accent?: string
  /** Pacing description for expressive synthesis, or speaking rate for consistent synthesis. */
  pacing?: string | number
  stability?: number
  similarityBoost?: number
  speed?: number
  useSpeakerBoost?: boolean
  /**
   * Integer seed included in the audio cache key. A different seed always forces
   * regeneration. Consistent output is not guaranteed across all voice types.
   */
  seed?: number
}
export type VideoCueTranslation =
  | VideoCueTranslationFile
  | VideoCueTranslationTTS

export type VideoCueStartEvent = {
  type: 'videoCueStart'
  timeMs: number
  name: string
  /** Cue declared via `createStudioNarration` whose Studio entry is a media file. */
  studio?: true
  /** Single-language API: SHA-256 hash of the pre-recorded asset. */
  assetHash?: string
  /** Single-language API: local file path — present only during recording; stripped from submitted data. */
  assetPath?: string
  /** Optional subtitle text. Words are spread with equal timing at render time. */
  subtitle?: string
  /** Multi-language API — per-language translations keyed by language code. */
  translations?: Record<string, VideoCueTranslation>
}

/**
 * Asset format policy is recorded explicitly so renderers never need to infer
 * timing or audio rules from file extensions after the recording phase.
 */
export type ImageAssetStartEvent = {
  type: 'assetStart'
  timeMs: number
  name: string
  kind: 'image'
  path: string
  fileHash?: string
  durationMs: number
  fullScreen: boolean
}

export type VideoAssetStartEvent = {
  type: 'assetStart'
  timeMs: number
  name: string
  kind: 'video'
  path: string
  fileHash?: string
  audio: number
  fullScreen: boolean
}

export type AssetStartEvent = ImageAssetStartEvent | VideoAssetStartEvent
export type AssetStartPayload =
  | Omit<ImageAssetStartEvent, 'type' | 'timeMs' | 'name'>
  | Omit<VideoAssetStartEvent, 'type' | 'timeMs' | 'name'>

/**
 * Asset declared via `createStudioAssets` — the file and display options are
 * configured in Studio, so the recording only marks the timeline point.
 */
export type StudioAssetStartEvent = {
  type: 'assetStart'
  timeMs: number
  name: string
  studio: true
}

export type HideStartEvent = {
  type: 'hideStart'
  timeMs: number
}

export type HideEndEvent = {
  type: 'hideEnd'
  timeMs: number
}

export type SpeedStartEvent = {
  type: 'speedStart'
  timeMs: number
  multiplier: number
}

export type SpeedEndEvent = {
  type: 'speedEnd'
  timeMs: number
}

export type TimeStartEvent = {
  type: 'timeStart'
  timeMs: number
  durationMs: number
}

export type TimeEndEvent = {
  type: 'timeEnd'
  timeMs: number
}

export type AutoZoomStartEvent = {
  type: 'autoZoomStart'
  timeMs: number
  easing: string
  duration: number
  amount: number
  centering?: number
}

export type AutoZoomEndEvent = {
  type: 'autoZoomEnd'
  timeMs: number
  easing: string
  duration: number
}

export type RecordingEvent =
  | VideoStartEvent
  | InputEvent
  | CueStartEvent
  | CueEndEvent
  | VideoCueStartEvent
  | AssetStartEvent
  | StudioAssetStartEvent
  | HideStartEvent
  | HideEndEvent
  | SpeedStartEvent
  | SpeedEndEvent
  | TimeStartEvent
  | TimeEndEvent
  | AutoZoomStartEvent
  | AutoZoomEndEvent

export type VoiceLanguageMeta = {
  /** Voice key string: a built-in voice name or an external voice key. */
  name: string
  /**
   * Integer seed included in the audio cache key. A different seed always forces
   * regeneration. Consistent output is not guaranteed across all voice types.
   */
  seed?: number
  /** TTS model type — `'expressive'` or `'consistent'`. Defaults to `'consistent'`. `'expressive'` requires the Business tier. */
  modelType?: string
  /** Gemini style prompt, or ElevenLabs `eleven_multilingual_v2` style exaggeration. */
  style?: string | number
  /** Accent description for expressive synthesis. Omitted from the prompt when not set. */
  accent?: string
  /** Pacing description for expressive synthesis, or speaking rate for consistent synthesis. */
  pacing?: string | number
  stability?: number
  similarityBoost?: number
  speed?: number
  useSpeakerBoost?: boolean
}

export type RecordingMetadata = {
  videoName: string
  screenciVersion: string
  /** Language codes present in multi-language cues, e.g. `['en', 'de']`. Omitted when no multi-language cues are used. */
  languages?: string[]
  sourceFilePath?: string
  /**
   * Which parts of this recording opted into Studio configuration.
   * `renderOptions` is set when `STUDIO_RENDER_OPTIONS` was used; `narration`
   * when the recording contains `createStudioNarration` cues; `assets` when it
   * contains `createStudioAssets` assets.
   */
  studio?: {
    renderOptions?: boolean
    narration?: boolean
    assets?: boolean
  }
}

function readScreenciVersion(): string {
  const currentFileDir = dirname(fileURLToPath(import.meta.url))
  const packageJsonPaths = [
    resolve(currentFileDir, '../package.json'),
    resolve(currentFileDir, '../../package.json'),
  ]

  for (const packageJsonPath of packageJsonPaths) {
    if (!existsSync(packageJsonPath)) continue

    try {
      const packageJson = JSON.parse(
        readFileSync(packageJsonPath, 'utf-8')
      ) as {
        version?: unknown
      }
      if (typeof packageJson.version === 'string') {
        return packageJson.version
      }
    } catch {
      // Try the next candidate path.
    }
  }

  return 'unknown'
}

const SCREENCI_VERSION = readScreenciVersion()

export type RecordingData = {
  events: RecordingEvent[]
  renderOptions: ResolvedRenderOptions
  recordOptions?: RecordOptions
  metadata?: RecordingMetadata
}

export interface IEventRecorder {
  start(): void
  /**
   * Records an input action. Inner event timestamps are absolute (e.g. Date.now())
   * and are converted to recording-relative milliseconds internally.
   * Throws if the event's time span overlaps with any previously recorded input event.
   */
  addInput(
    subType: InputEvent['subType'],
    elementRect: ElementRect | undefined,
    events: InputEvent['events']
  ): void
  addInput(subType: InputEvent['subType'], events: InputEvent['events']): void
  addCueStart(
    text: string,
    name: string,
    cueConfig?: CueConfig,
    translations?: Record<string, CueTranslation>
  ): void
  /** Records a studio-mode cue start — text and voice are configured in Studio. */
  addStudioCueStart(name: string): void
  addCueEnd(reason?: 'auto' | 'wait'): void
  addVideoCueStart(
    name: string,
    assetPath: string | undefined,
    assetHash: string | undefined,
    subtitle?: string,
    translations?: Record<string, VideoCueTranslation>
  ): void
  addAssetStart(name: string, asset: AssetStartPayload): void
  /** Records a studio-mode asset start — the file and options are configured in Studio. */
  addStudioAssetStart(name: string): void
  addHideStart(): void
  addHideEnd(): void
  getHideLagThresholdMs(): number
  addSpeedStart(multiplier: number): void
  addSpeedEnd(): void
  addTimeStart(durationMs: number): void
  addTimeEnd(): void
  addAutoZoomStart(options?: AutoZoomOptions): void
  addAutoZoomEnd(options?: AutoZoomOptions): void
  /**
   * Registers voice metadata seen during recording.
   * Kept for API compatibility; voice settings are stored per cue event.
   */
  registerVoiceForLang(lang: string, meta: VoiceLanguageMeta): void
  getEvents(): RecordingEvent[]
  writeToFile(
    dir: string,
    videoName: string,
    sourceFilePath?: string
  ): Promise<void>
}

export const NOOP_EVENT_RECORDER: IEventRecorder = {
  start(): void {},
  addInput(): void {},
  addCueStart(): void {},
  addStudioCueStart(): void {},
  addCueEnd(): void {},
  addVideoCueStart(): void {},
  addAssetStart(): void {},
  addStudioAssetStart(): void {},
  addHideStart(): void {},
  addHideEnd(): void {},
  getHideLagThresholdMs(): number {
    return 0
  },
  addSpeedStart(): void {},
  addSpeedEnd(): void {},
  addTimeStart(): void {},
  addTimeEnd(): void {},
  addAutoZoomStart(): void {},
  addAutoZoomEnd(): void {},
  registerVoiceForLang(): void {},
  getEvents(): RecordingEvent[] {
    return []
  },
  async writeToFile(): Promise<void> {},
}

export class EventRecorder implements IEventRecorder {
  private readonly events: RecordingEvent[] = []
  private startTime: number | null = null
  private readonly recordOptions: RecordOptions | undefined
  private readonly renderOptions:
    | RenderOptions
    | StudioRenderOptionsSentinel
    | undefined

  constructor(
    renderOptions?: RenderOptions | StudioRenderOptionsSentinel,
    recordOptions?: RecordOptions
  ) {
    this.recordOptions = recordOptions
    this.renderOptions = renderOptions
  }

  registerVoiceForLang(_lang: string, _meta: VoiceLanguageMeta): void {}

  private normalizeCentering(
    options: AutoZoomOptions | undefined
  ): number | undefined {
    if (options?.centering === undefined) return undefined
    assertAutoZoomUnitIntervalOption(options.centering, 'centering')
    return options.centering
  }

  start(): void {
    this.startTime = Date.now()
    this.events.push({ type: 'videoStart', timeMs: 0 })
  }

  private getInnerEventBounds(event: InputEvent['events'][number]): {
    startMs: number
    endMs: number
  } {
    if (event.type === 'focusChange') {
      return {
        startMs: event.startMs,
        endMs: event.endMs,
      }
    }

    return {
      startMs: event.startMs,
      endMs: event.endMs,
    }
  }

  private getInputEventBounds(events: InputEvent['events']): {
    startMs: number
    endMs: number
  } {
    const bounds = events.map((event) => this.getInnerEventBounds(event))
    return {
      startMs: Math.min(...bounds.map((bound) => bound.startMs)),
      endMs: Math.max(...bounds.map((bound) => bound.endMs)),
    }
  }

  private relativizeFocusChangeEvent(
    event: FocusChangeEvent,
    startTime: number
  ): FocusChangeEvent {
    return {
      ...event,
      startMs: event.startMs - startTime,
      endMs: event.endMs - startTime,
      ...(event.mouse !== undefined
        ? {
            mouse: {
              ...event.mouse,
              startMs: event.mouse.startMs - startTime,
              endMs: event.mouse.endMs - startTime,
            },
          }
        : {}),
      ...(event.scroll !== undefined
        ? {
            scroll: {
              ...event.scroll,
              startMs: event.scroll.startMs - startTime,
              endMs: event.scroll.endMs - startTime,
            },
          }
        : {}),
      ...(event.zoom !== undefined
        ? {
            zoom: {
              ...event.zoom,
              startMs: event.zoom.startMs - startTime,
              endMs: event.zoom.endMs - startTime,
            },
          }
        : {}),
    }
  }

  addInput(
    subType: InputEvent['subType'],
    elementRectOrEvents: ElementRect | InputEvent['events'] | undefined,
    maybeEvents?: InputEvent['events']
  ): void {
    if (this.startTime === null) return
    const events = Array.isArray(elementRectOrEvents)
      ? elementRectOrEvents
      : maybeEvents
    if (events === undefined) return
    if (events.length === 0) return
    const st = this.startTime
    const inputBounds = this.getInputEventBounds(events)
    const relStart = inputBounds.startMs - st
    const relEnd = inputBounds.endMs - st

    for (const existing of this.events) {
      if (existing.type === 'input') {
        const existingBounds = this.getInputEventBounds(existing.events)
        const existingStart = existingBounds.startMs
        const existingEnd = existingBounds.endMs
        if (relStart < existingEnd && relEnd > existingStart) {
          throw new Error(
            `Input event '${subType}' [${relStart}ms, ${relEnd}ms] overlaps with existing '${existing.subType}' event [${existingStart}ms, ${existingEnd}ms]`
          )
        }
      } else if (
        existing.type === 'autoZoomStart' ||
        existing.type === 'autoZoomEnd'
      ) {
        if (existing.timeMs > relStart && existing.timeMs < relEnd) {
          throw new Error(
            `Input event '${subType}' [${relStart}ms, ${relEnd}ms] contains ${existing.type} at ${existing.timeMs}ms`
          )
        }
      }
    }

    const relativeEvents = events.map((event) => {
      if (event.type === 'focusChange') {
        return this.relativizeFocusChangeEvent(event, st)
      }

      return {
        ...event,
        startMs: event.startMs - st,
        endMs: event.endMs - st,
      }
    })

    this.events.push({
      type: 'input',
      subType,
      events: relativeEvents,
    } as InputEvent)
  }

  addCueStart(
    text: string,
    name: string,
    cueConfig?: CueConfig,
    translations?: Record<string, CueTranslation>
  ): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'cueStart',
      timeMs,
      name,
      ...(text.length > 0 && { text }),
      ...(cueConfig !== undefined && { cueConfig }),
      ...(translations !== undefined && { translations }),
    })
  }

  addStudioCueStart(name: string): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'cueStart',
      timeMs,
      name,
      studio: true,
    })
  }

  addCueEnd(reason?: 'auto' | 'wait'): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'cueEnd',
      timeMs,
      ...(reason !== undefined && { reason }),
    })
  }

  addVideoCueStart(
    name: string,
    assetPath: string | undefined,
    assetHash: string | undefined,
    subtitle?: string,
    translations?: Record<string, VideoCueTranslation>
  ): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'videoCueStart',
      timeMs,
      name,
      ...(assetHash !== undefined && { assetHash }),
      ...(assetPath !== undefined && { assetPath }),
      ...(subtitle !== undefined && { subtitle }),
      ...(translations !== undefined && { translations }),
    })
  }

  addAssetStart(name: string, asset: AssetStartPayload): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    if (asset.kind === 'image') {
      this.events.push({
        type: 'assetStart',
        timeMs,
        name,
        kind: 'image',
        path: asset.path,
        ...(asset.fileHash !== undefined && { fileHash: asset.fileHash }),
        durationMs: asset.durationMs,
        fullScreen: asset.fullScreen,
      })
      return
    }

    this.events.push({
      type: 'assetStart',
      timeMs,
      name,
      kind: 'video',
      path: asset.path,
      ...(asset.fileHash !== undefined && { fileHash: asset.fileHash }),
      audio: asset.audio,
      fullScreen: asset.fullScreen,
    })
  }

  addStudioAssetStart(name: string): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'assetStart',
      timeMs,
      name,
      studio: true,
    })
  }

  addHideStart(): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'hideStart', timeMs })
  }

  addHideEnd(): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'hideEnd', timeMs })
  }

  getHideLagThresholdMs(): number {
    return this.recordOptions?.hideLagThresholdMs ?? 0
  }

  addSpeedStart(multiplier: number): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'speedStart', timeMs, multiplier })
  }

  addSpeedEnd(): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'speedEnd', timeMs })
  }

  addTimeStart(durationMs: number): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'timeStart', timeMs, durationMs })
  }

  addTimeEnd(): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'timeEnd', timeMs })
  }

  addAutoZoomStart(options?: AutoZoomOptions): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    const centering = this.normalizeCentering(options)
    for (const existing of this.events) {
      if (existing.type !== 'input') continue
      const existingBounds = this.getInputEventBounds(existing.events)
      const existingStart = existingBounds.startMs
      const existingEnd = existingBounds.endMs
      if (timeMs > existingStart && timeMs < existingEnd) {
        throw new ScreenciError(
          `autoZoomStart at ${timeMs}ms falls inside input '${existing.subType}' event [${existingStart}ms, ${existingEnd}ms]`
        )
      }
    }
    const resolvedOptions = {
      ...DEFAULT_ZOOM_OPTIONS,
      ...(options ?? {}),
    }
    assertAutoZoomUnitIntervalOption(resolvedOptions.amount, 'amount')
    this.events.push({
      type: 'autoZoomStart',
      timeMs,
      easing: resolvedOptions.easing,
      duration: resolvedOptions.duration,
      amount: resolvedOptions.amount,
      ...(centering !== undefined && {
        centering,
      }),
    })
  }

  addAutoZoomEnd(options?: AutoZoomOptions): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    for (const existing of this.events) {
      if (existing.type !== 'input') continue
      const existingBounds = this.getInputEventBounds(existing.events)
      const existingStart = existingBounds.startMs
      const existingEnd = existingBounds.endMs
      if (timeMs > existingStart && timeMs < existingEnd) {
        throw new ScreenciError(
          `autoZoomEnd at ${timeMs}ms falls inside input '${existing.subType}' event [${existingStart}ms, ${existingEnd}ms]`
        )
      }
    }
    const resolvedOptions = {
      ...DEFAULT_ZOOM_OPTIONS,
      ...(options ?? {}),
    }
    this.events.push({
      type: 'autoZoomEnd',
      timeMs,
      easing: resolvedOptions.easing,
      duration: resolvedOptions.duration,
    })
  }

  getEvents(): RecordingEvent[] {
    return [...this.events]
  }

  async writeToFile(
    dir: string,
    videoName: string,
    sourceFilePath?: string
  ): Promise<void> {
    const filePath = join(dir, 'data.json')

    // Studio mode: render options come from the Studio page. data.json still
    // gets fully-resolved defaults (so it always validates and renders), and
    // metadata.studio.renderOptions marks the deferral for the backend.
    const studioRenderOptions = isStudioRenderOptions(this.renderOptions)

    // Resolve all defaults so data.json always contains a complete set of
    // render options.
    const ro = studioRenderOptions ? undefined : this.renderOptions
    const resolved: ResolvedRenderOptions = {
      recording: {
        size: ro?.recording?.size ?? RENDER_OPTIONS_DEFAULTS.recording.size,
        roundness:
          ro?.recording?.roundness ??
          RENDER_OPTIONS_DEFAULTS.recording.roundness,
        shape: ro?.recording?.shape ?? RENDER_OPTIONS_DEFAULTS.recording.shape,
        dropShadow:
          ro?.recording?.dropShadow ??
          RENDER_OPTIONS_DEFAULTS.recording.dropShadow,
      },
      narration: {
        size: ro?.narration?.size ?? RENDER_OPTIONS_DEFAULTS.narration.size,
        roundness:
          ro?.narration?.roundness ??
          RENDER_OPTIONS_DEFAULTS.narration.roundness,
        shape: ro?.narration?.shape ?? RENDER_OPTIONS_DEFAULTS.narration.shape,
        corner:
          ro?.narration?.corner ?? RENDER_OPTIONS_DEFAULTS.narration.corner,
        padding:
          ro?.narration?.padding ?? RENDER_OPTIONS_DEFAULTS.narration.padding,
        dropShadow: normalizeNarrationDropShadow(
          ro?.narration?.dropShadow,
          RENDER_OPTIONS_DEFAULTS.narration.dropShadow
        ),
      },
      mouse: {
        size: ro?.mouse?.size ?? RENDER_OPTIONS_DEFAULTS.mouse.size,
        style: ro?.mouse?.style ?? RENDER_OPTIONS_DEFAULTS.mouse.style,
      },
      output: {
        aspectRatio:
          ro?.output?.aspectRatio ?? RENDER_OPTIONS_DEFAULTS.output.aspectRatio,
        quality: ro?.output?.quality ?? RENDER_OPTIONS_DEFAULTS.output.quality,
        background:
          ro?.output?.background ?? RENDER_OPTIONS_DEFAULTS.output.background,
      },
    }

    const languageSet = new Set<string>()
    for (const event of this.events) {
      if (event.type === 'cueStart') {
        if (event.translations !== undefined) {
          for (const lang of Object.keys(event.translations)) {
            languageSet.add(lang)
          }
        } else if (event.cueConfig?.voice !== undefined) {
          const lang =
            event.cueConfig.voice.includes('.') &&
            !event.cueConfig.voice.startsWith('elevenlabs:')
              ? event.cueConfig.voice.split('.')[0]
              : undefined
          if (lang) languageSet.add(lang)
        }
      }
    }
    const languages = languageSet.size > 0 ? [...languageSet].sort() : undefined

    const git = getGitMetadata()

    const studioNarration = this.events.some(
      (event) => event.type === 'cueStart' && event.studio === true
    )
    const studioAssets = this.events.some(
      (event) =>
        event.type === 'assetStart' &&
        'studio' in event &&
        event.studio === true
    )
    const studio: RecordingMetadata['studio'] =
      studioRenderOptions || studioNarration || studioAssets
        ? {
            ...(studioRenderOptions && { renderOptions: true }),
            ...(studioNarration && { narration: true }),
            ...(studioAssets && { assets: true }),
          }
        : undefined

    const data: RecordingData = {
      events: this.events,
      renderOptions: resolved,
      ...(this.recordOptions !== undefined && {
        recordOptions: this.recordOptions,
      }),
      metadata: {
        videoName,
        screenciVersion: SCREENCI_VERSION,
        ...(languages !== undefined && { languages }),
        ...(sourceFilePath !== undefined && { sourceFilePath }),
        ...(git.commit !== undefined && { commit: git.commit }),
        ...(git.isDirty !== undefined && { isDirty: git.isDirty }),
        ...(studio !== undefined && { studio }),
      },
    }
    await writeFile(filePath, JSON.stringify(data, null, 2))
  }
}

function normalizeNarrationDropShadow(
  input: number | undefined,
  fallback: number
): number {
  if (typeof input === 'number') {
    return clamp01(input)
  }

  return fallback
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }
  return value
}
