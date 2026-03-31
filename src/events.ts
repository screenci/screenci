import { writeFile } from 'fs/promises'
import { join } from 'path'
import type {
  AutoZoomOptions,
  CaptionConfig,
  Easing,
  RecordOptions,
  RenderOptions,
  ResolvedRenderOptions,
} from './types.js'
import { RENDER_OPTIONS_DEFAULTS } from './types.js'
import type { VoiceKey, CustomVoiceRef } from './voices.js'
import {
  DEFAULT_ZOOM_AMOUNT,
  DEFAULT_ZOOM_DURATION,
  DEFAULT_ZOOM_EASING,
} from './defaults.js'

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
 * mouseMove, mouseShow, and mouseHide subtypes each contain exactly one inner event.
 * All input events must not overlap in time; recording will throw if they do.
 * Captions are automatically prevented from falling inside any input event's time range.
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
    | 'mouseMove'
    | 'mouseShow'
    | 'mouseHide'
    | 'hover'
    | 'selectText'
    | 'dragTo'
  elementRect?: ElementRect
  events: Array<
    | MouseMoveEvent
    | MouseDownEvent
    | MouseUpEvent
    | MouseShowEvent
    | MouseHideEvent
    | MouseWaitEvent
  >
}

export type CaptionTranslation = {
  text: string
  voice: VoiceKey | CustomVoiceRef
}

export type CaptionStartEvent = {
  type: 'captionStart'
  timeMs: number
  name: string
  /** Single-language API (backward compat) */
  text?: string
  captionConfig?: CaptionConfig
  /** Multi-language API — all language translations keyed by language code */
  translations?: Record<string, CaptionTranslation>
}

export type CaptionUntilEvent = {
  type: 'captionUntil'
  timeMs: number
  percentage: number
}

export type CaptionEndEvent = {
  type: 'captionEnd'
  timeMs: number
}

/** File-based video caption translation — uses a pre-recorded asset. */
export type VideoCaptionTranslationFile = {
  assetPath: string
  subtitle?: string
}
/** TTS-based video caption translation — generates audio via text-to-speech. */
export type VideoCaptionTranslationTTS = {
  text: string
  voice: VoiceKey | CustomVoiceRef
}
export type VideoCaptionTranslation =
  | VideoCaptionTranslationFile
  | VideoCaptionTranslationTTS

export type VideoCaptionStartEvent = {
  type: 'videoCaptionStart'
  timeMs: number
  name: string
  /** Single-language API: absolute path to the pre-recorded audio/video file. */
  assetPath?: string
  /** Optional subtitle text. Words are spread with equal timing at render time. */
  subtitle?: string
  /** Multi-language API — per-language asset paths keyed by language code. */
  translations?: Record<string, VideoCaptionTranslation>
}

export type AssetStartEvent = {
  type: 'assetStart'
  timeMs: number
  name: string
  path: string
  audio: number
  fullScreen: boolean
}

export type AssetEndEvent = {
  type: 'assetEnd'
  timeMs: number
  name: string
}

export type HideStartEvent = {
  type: 'hideStart'
  timeMs: number
}

export type HideEndEvent = {
  type: 'hideEnd'
  timeMs: number
}

export type AutoZoomStartEvent = {
  type: 'autoZoomStart'
  timeMs: number
  easing: string
  duration: number
  amount: number
  centering?: { cursor?: number; input?: number; click?: number }
  allowZoomingOut?: boolean
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
  | CaptionStartEvent
  | CaptionUntilEvent
  | CaptionEndEvent
  | VideoCaptionStartEvent
  | AssetStartEvent
  | AssetEndEvent
  | HideStartEvent
  | HideEndEvent
  | AutoZoomStartEvent
  | AutoZoomEndEvent

export type RecordingMetadata = {
  videoName: string
  /** Language codes present in multi-language captions, e.g. `['en', 'de']`. Omitted when no multi-language captions are used. */
  languages?: string[]
}

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
  addCaptionStart(
    text: string,
    name: string,
    captionConfig?: CaptionConfig,
    translations?: Record<string, CaptionTranslation>
  ): void
  addCaptionUntil(percentage: number): void
  addCaptionEnd(): void
  addVideoCaptionStart(
    name: string,
    assetPath: string | undefined,
    subtitle?: string,
    translations?: Record<string, VideoCaptionTranslation>
  ): void
  addAssetStart(
    name: string,
    path: string,
    audio: number,
    fullScreen: boolean
  ): void
  addAssetEnd(name: string): void
  addHideStart(): void
  addHideEnd(): void
  addAutoZoomStart(options?: AutoZoomOptions): void
  addAutoZoomEnd(options?: AutoZoomOptions): void
  getEvents(): RecordingEvent[]
  writeToFile(dir: string, videoName: string): Promise<void>
}

export class EventRecorder implements IEventRecorder {
  private readonly events: RecordingEvent[] = []
  private startTime: number | null = null
  private readonly recordOptions: RecordOptions | undefined
  private readonly renderOptions: RenderOptions | undefined

  constructor(renderOptions?: RenderOptions, recordOptions?: RecordOptions) {
    this.recordOptions = recordOptions
    this.renderOptions = renderOptions
  }

  start(): void {
    this.startTime = Date.now()
    this.events.push({ type: 'videoStart', timeMs: 0 })
  }

  addInput(
    subType: InputEvent['subType'],
    elementRect: ElementRect | undefined,
    events: InputEvent['events']
  ): void {
    if (this.startTime === null) return
    if (events.length === 0) return
    const st = this.startTime
    const relStart = events[0]!.startMs - st
    const relEnd = events[events.length - 1]!.endMs - st

    for (const existing of this.events) {
      if (existing.type === 'input') {
        const existingStart = existing.events[0]!.startMs
        const existingEnd = existing.events[existing.events.length - 1]!.endMs
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

    const relativeEvents = events.map((e) => ({
      ...e,
      startMs: e.startMs - st,
      endMs: e.endMs - st,
    }))

    this.events.push({
      type: 'input',
      subType,
      ...(elementRect !== undefined && { elementRect }),
      events: relativeEvents,
    } as InputEvent)
  }

  addCaptionStart(
    text: string,
    name: string,
    captionConfig?: CaptionConfig,
    translations?: Record<string, CaptionTranslation>
  ): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'captionStart',
      timeMs,
      name,
      ...(text.length > 0 && { text }),
      ...(captionConfig !== undefined && { captionConfig }),
      ...(translations !== undefined && { translations }),
    })
  }

  addCaptionUntil(percentage: number): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'captionUntil', timeMs, percentage })
  }

  addCaptionEnd(): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'captionEnd', timeMs })
  }

  addVideoCaptionStart(
    name: string,
    assetPath: string | undefined,
    subtitle?: string,
    translations?: Record<string, VideoCaptionTranslation>
  ): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'videoCaptionStart',
      timeMs,
      name,
      ...(assetPath !== undefined && { assetPath }),
      ...(subtitle !== undefined && { subtitle }),
      ...(translations !== undefined && { translations }),
    })
  }

  addAssetStart(
    name: string,
    path: string,
    audio: number,
    fullScreen: boolean
  ): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'assetStart',
      timeMs,
      name,
      path,
      audio,
      fullScreen,
    })
  }

  addAssetEnd(name: string): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'assetEnd', timeMs, name })
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

  addAutoZoomStart(options?: AutoZoomOptions): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    for (const existing of this.events) {
      if (existing.type !== 'input') continue
      const existingStart = existing.events[0]!.startMs
      const existingEnd = existing.events[existing.events.length - 1]!.endMs
      if (timeMs > existingStart && timeMs < existingEnd) {
        throw new Error(
          `autoZoomStart at ${timeMs}ms falls inside input '${existing.subType}' event [${existingStart}ms, ${existingEnd}ms]`
        )
      }
    }
    this.events.push({
      type: 'autoZoomStart',
      timeMs,
      easing: options?.easing ?? DEFAULT_ZOOM_EASING,
      duration: options?.duration ?? DEFAULT_ZOOM_DURATION,
      amount: options?.amount ?? DEFAULT_ZOOM_AMOUNT,
      ...(options?.centering !== undefined && {
        centering: options.centering,
      }),
      ...(options?.allowZoomingOut !== undefined && {
        allowZoomingOut: options.allowZoomingOut,
      }),
    })
  }

  addAutoZoomEnd(options?: AutoZoomOptions): void {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    for (const existing of this.events) {
      if (existing.type !== 'input') continue
      const existingStart = existing.events[0]!.startMs
      const existingEnd = existing.events[existing.events.length - 1]!.endMs
      if (timeMs > existingStart && timeMs < existingEnd) {
        throw new Error(
          `autoZoomEnd at ${timeMs}ms falls inside input '${existing.subType}' event [${existingStart}ms, ${existingEnd}ms]`
        )
      }
    }
    this.events.push({
      type: 'autoZoomEnd',
      timeMs,
      easing: options?.easing ?? DEFAULT_ZOOM_EASING,
      duration: options?.duration ?? DEFAULT_ZOOM_DURATION,
    })
  }

  getEvents(): RecordingEvent[] {
    return [...this.events]
  }

  async writeToFile(dir: string, videoName: string): Promise<void> {
    const filePath = join(dir, 'data.json')

    // Resolve all defaults so data.json always contains a complete set of
    // render options.
    const ro = this.renderOptions
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
      voiceOvers: {
        size: ro?.voiceOvers?.size ?? RENDER_OPTIONS_DEFAULTS.voiceOvers.size,
        roundness:
          ro?.voiceOvers?.roundness ??
          RENDER_OPTIONS_DEFAULTS.voiceOvers.roundness,
        shape:
          ro?.voiceOvers?.shape ?? RENDER_OPTIONS_DEFAULTS.voiceOvers.shape,
        corner:
          ro?.voiceOvers?.corner ?? RENDER_OPTIONS_DEFAULTS.voiceOvers.corner,
        padding:
          ro?.voiceOvers?.padding ?? RENDER_OPTIONS_DEFAULTS.voiceOvers.padding,
        dropShadow:
          ro?.voiceOvers?.dropShadow ??
          RENDER_OPTIONS_DEFAULTS.voiceOvers.dropShadow,
      },
      cursor: {
        size: ro?.cursor?.size ?? RENDER_OPTIONS_DEFAULTS.cursor.size,
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
      if (event.type === 'captionStart') {
        if (event.translations !== undefined) {
          for (const lang of Object.keys(event.translations)) {
            languageSet.add(lang)
          }
        } else if (event.captionConfig?.voice !== undefined) {
          const lang = event.captionConfig.voice.split('.')[0]
          if (lang) languageSet.add(lang)
        }
      }
    }
    const languages = languageSet.size > 0 ? [...languageSet].sort() : undefined

    const data: RecordingData = {
      events: this.events,
      renderOptions: resolved,
      ...(this.recordOptions !== undefined && {
        recordOptions: this.recordOptions,
      }),
      metadata: {
        videoName,
        ...(languages !== undefined && { languages }),
      },
    }
    await writeFile(filePath, JSON.stringify(data, null, 2))
  }
}
