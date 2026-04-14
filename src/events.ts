import { writeFile } from 'fs/promises'
import { join } from 'path'
import type {
  AutoZoomOptions,
  CueConfig,
  Easing,
  RecordOptions,
  RenderOptions,
  ResolvedRenderOptions,
} from './types.js'
import { RENDER_OPTIONS_DEFAULTS } from './types.js'
import type { VoiceKey } from './voices.js'
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
  duration: number
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

export type RecordingCustomVoiceRef = {
  assetHash: string
  /** Present only in recording phase (for CLI upload); stripped from submitted data. */
  assetPath?: string
}

export type CueTranslation = {
  text: string
  voice: VoiceKey | RecordingCustomVoiceRef
  /** BCP-47 region code, e.g. 'en-US'. Overrides the base language for TTS synthesis. */
  region?: string
  /** TTS model type — `'expressive'` or `'consistent'`. Defaults to `'consistent'`. */
  modelType?: string
  /** Speaking style prompt for expressive synthesis. */
  style?: string
  /** Accent description for expressive synthesis. Omitted from the prompt when not set. */
  accent?: string
  /** Pacing description for expressive synthesis. */
  pacing?: string
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
  /** BCP-47 region code, e.g. 'en-US'. Overrides the base language for TTS synthesis. */
  region?: string
  /** TTS model type — `'expressive'` or `'consistent'`. Defaults to `'consistent'`. */
  modelType?: string
  /** Speaking style prompt for expressive synthesis. */
  style?: string
  /** Accent description for expressive synthesis. Omitted from the prompt when not set. */
  accent?: string
  /** Pacing description for expressive synthesis. */
  pacing?: string
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
  /** Single-language API: SHA-256 hash of the pre-recorded asset. */
  assetHash?: string
  /** Single-language API: local file path — present only during recording; stripped from submitted data. */
  assetPath?: string
  /** Optional subtitle text. Words are spread with equal timing at render time. */
  subtitle?: string
  /** Multi-language API — per-language translations keyed by language code. */
  translations?: Record<string, VideoCueTranslation>
}

export type AssetStartEvent = {
  type: 'assetStart'
  timeMs: number
  name: string
  path: string
  fileHash?: string
  audio: number
  fullScreen: boolean
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
  | CueStartEvent
  | CueEndEvent
  | VideoCueStartEvent
  | AssetStartEvent
  | HideStartEvent
  | HideEndEvent
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
  /** BCP-47 region code, e.g. 'en-US'. Overrides the base language for TTS synthesis. */
  region?: string
  /** TTS model type — `'expressive'` or `'consistent'`. Defaults to `'consistent'`. */
  modelType?: string
  /** Speaking style prompt for expressive synthesis. */
  style?: string
  /** Accent description for expressive synthesis. Omitted from the prompt when not set. */
  accent?: string
  /** Pacing description for expressive synthesis. */
  pacing?: string
}

export type RecordingMetadata = {
  videoName: string
  /** Language codes present in multi-language cues, e.g. `['en', 'de']`. Omitted when no multi-language cues are used. */
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
  addCueStart(
    text: string,
    name: string,
    cueConfig?: CueConfig,
    translations?: Record<string, CueTranslation>
  ): void
  addCueEnd(reason?: 'auto' | 'wait'): void
  addVideoCueStart(
    name: string,
    assetPath: string | undefined,
    assetHash: string | undefined,
    subtitle?: string,
    translations?: Record<string, VideoCueTranslation>
  ): void
  addAssetStart(
    name: string,
    path: string,
    audio: number,
    fullScreen: boolean
  ): void
  addHideStart(): void
  addHideEnd(): void
  addAutoZoomStart(options?: AutoZoomOptions): void
  addAutoZoomEnd(options?: AutoZoomOptions): void
  /**
   * Registers voice metadata seen during recording.
   * Kept for API compatibility; voice settings are stored per cue event.
   */
  registerVoiceForLang(lang: string, meta: VoiceLanguageMeta): void
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

  registerVoiceForLang(_lang: string, _meta: VoiceLanguageMeta): void {}

  private clampUnitInterval(value: number): number {
    return Math.max(0, Math.min(1, value))
  }

  private normalizeCentering(
    options: AutoZoomOptions | undefined
  ): { cursor?: number; input?: number; click?: number } | undefined {
    if (options?.centering === undefined) return undefined

    const centering: { cursor?: number; input?: number; click?: number } = {}

    if (options.centering.cursor !== undefined) {
      centering.cursor = this.clampUnitInterval(options.centering.cursor)
    }
    if (options.centering.input !== undefined) {
      centering.input = this.clampUnitInterval(options.centering.input)
    }
    if (options.centering.click !== undefined) {
      centering.click = this.clampUnitInterval(options.centering.click)
    }

    return centering
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
    const centering = this.normalizeCentering(options)
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
      ...(centering !== undefined && {
        centering,
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
        dropShadow:
          ro?.narration?.dropShadow ??
          RENDER_OPTIONS_DEFAULTS.narration.dropShadow,
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
