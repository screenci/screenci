import { existsSync, readFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { invalidOptionError, ScreenciError } from './errors.js'
import { RENDER_OPTIONS_DEFAULTS } from './types.js'
import { DEFAULT_ZOOM_OPTIONS } from './defaults.js'
function assertAutoZoomUnitIntervalOption(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidOptionError({
      api: 'autoZoom',
      option: name,
      expectation: 'must be between 0 and 1',
      value,
    })
  }
}
function readScreenciVersion() {
  const currentFileDir = dirname(fileURLToPath(import.meta.url))
  const packageJsonPaths = [
    resolve(currentFileDir, '../package.json'),
    resolve(currentFileDir, '../../package.json'),
  ]
  for (const packageJsonPath of packageJsonPaths) {
    if (!existsSync(packageJsonPath)) continue
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
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
export class EventRecorder {
  events = []
  startTime = null
  recordOptions
  renderOptions
  constructor(renderOptions, recordOptions) {
    this.recordOptions = recordOptions
    this.renderOptions = renderOptions
  }
  registerVoiceForLang(lang, meta) {
    void lang
    void meta
  }
  normalizeCentering(options) {
    if (options?.centering === undefined) return undefined
    assertAutoZoomUnitIntervalOption(options.centering, 'centering')
    return options.centering
  }
  start() {
    this.startTime = Date.now()
    this.events.push({ type: 'videoStart', timeMs: 0 })
  }
  getInnerEventBounds(event) {
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
  getInputEventBounds(events) {
    const bounds = events.map((event) => this.getInnerEventBounds(event))
    return {
      startMs: Math.min(...bounds.map((bound) => bound.startMs)),
      endMs: Math.max(...bounds.map((bound) => bound.endMs)),
    }
  }
  relativizeFocusChangeEvent(event, startTime) {
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
  addInput(subType, elementRectOrEvents, maybeEvents) {
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
    })
  }
  addCueStart(text, name, cueConfig, translations) {
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
  addCueEnd(reason) {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({
      type: 'cueEnd',
      timeMs,
      ...(reason !== undefined && { reason }),
    })
  }
  addVideoCueStart(name, assetPath, assetHash, subtitle, translations) {
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
  addAssetStart(name, path, audio, fullScreen) {
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
  addHideStart() {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'hideStart', timeMs })
  }
  addHideEnd() {
    if (this.startTime === null) return
    const timeMs = Date.now() - this.startTime
    this.events.push({ type: 'hideEnd', timeMs })
  }
  addAutoZoomStart(options) {
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
  addAutoZoomEnd(options) {
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
  getEvents() {
    return [...this.events]
  }
  async writeToFile(dir, videoName) {
    const filePath = join(dir, 'data.json')
    // Resolve all defaults so data.json always contains a complete set of
    // render options.
    const ro = this.renderOptions
    const resolved = {
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
      },
      output: {
        aspectRatio:
          ro?.output?.aspectRatio ?? RENDER_OPTIONS_DEFAULTS.output.aspectRatio,
        quality: ro?.output?.quality ?? RENDER_OPTIONS_DEFAULTS.output.quality,
        background:
          ro?.output?.background ?? RENDER_OPTIONS_DEFAULTS.output.background,
      },
    }
    const languageSet = new Set()
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
    const data = {
      events: this.events,
      renderOptions: resolved,
      ...(this.recordOptions !== undefined && {
        recordOptions: this.recordOptions,
      }),
      metadata: {
        videoName,
        screenciVersion: SCREENCI_VERSION,
        ...(languages !== undefined && { languages }),
      },
    }
    await writeFile(filePath, JSON.stringify(data, null, 2))
  }
}
function normalizeNarrationDropShadow(input, fallback) {
  if (typeof input === 'number') {
    return clamp01(input)
  }
  return fallback
}
function clamp01(value) {
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
