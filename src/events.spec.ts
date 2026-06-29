import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { readFile } from 'fs/promises'
import { EventRecorder } from './events.js'
import type { RecordingData, InputEvent } from './events.js'
import { voices } from './voices.js'

describe('EventRecorder', () => {
  let recorder: EventRecorder
  let now = 1000

  beforeEach(() => {
    recorder = new EventRecorder()
    now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('start', () => {
    it('adds a videoStart event with timeMs: 0', () => {
      recorder.start()
      const events = recorder.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: 'videoStart', timeMs: 0 })
    })
  })

  describe('addValuesDeclare', () => {
    it('records the declaration with relative time and seed', () => {
      recorder.start()
      now = 1300
      recorder.addValuesDeclare(['heading'], [], { en: { heading: 'Hi' } })

      expect(recorder.getEvents().slice(1)).toEqual([
        {
          type: 'valuesDeclare',
          timeMs: 300,
          fields: ['heading'],
          studioFields: [],
          seed: { en: { heading: 'Hi' } },
        },
      ])
    })

    it('omits the seed when undefined (studio-only / shared mode)', () => {
      recorder.start()
      recorder.addValuesDeclare(['cta'], ['cta'])

      expect(recorder.getEvents().slice(1)).toEqual([
        {
          type: 'valuesDeclare',
          timeMs: 0,
          fields: ['cta'],
          studioFields: ['cta'],
        },
      ])
    })

    it('is a no-op before start', () => {
      recorder.addValuesDeclare(['heading'], [], { en: { heading: 'Hi' } })
      expect(recorder.getEvents()).toHaveLength(0)
    })
  })

  describe('timeline block events', () => {
    it('records speed start/end with relative time', () => {
      recorder.start()
      now = 1200
      recorder.addSpeedStart(0.5)
      now = 1500
      recorder.addSpeedEnd()

      expect(recorder.getEvents().slice(1)).toEqual([
        { type: 'speedStart', timeMs: 200, multiplier: 0.5 },
        { type: 'speedEnd', timeMs: 500 },
      ])
    })

    it('records time start/end with relative time', () => {
      recorder.start()
      now = 1100
      recorder.addTimeStart(1000)
      now = 1400
      recorder.addTimeEnd()

      expect(recorder.getEvents().slice(1)).toEqual([
        { type: 'timeStart', timeMs: 100, durationMs: 1000 },
        { type: 'timeEnd', timeMs: 400 },
      ])
    })
  })

  describe('background audio events', () => {
    it('records an audioStart with path, volume and repeat', () => {
      recorder.start()
      now = 1300
      recorder.addAudioStart('theme', {
        path: 'music.mp3',
        fileHash: 'a'.repeat(64),
        volume: 0.3,
        repeat: true,
      })

      expect(recorder.getEvents().slice(1)).toEqual([
        {
          type: 'audioStart',
          timeMs: 300,
          name: 'theme',
          path: 'music.mp3',
          fileHash: 'a'.repeat(64),
          volume: 0.3,
          repeat: true,
        },
      ])
    })

    it('records a paired audioEnd with the track name', () => {
      recorder.start()
      now = 1200
      recorder.addAudioStart('theme', {
        path: 'music.mp3',
        volume: 1,
        repeat: false,
      })
      now = 1800
      recorder.addAudioEnd('theme', 'wait')

      expect(recorder.getEvents().slice(1)).toEqual([
        {
          type: 'audioStart',
          timeMs: 200,
          name: 'theme',
          path: 'music.mp3',
          volume: 1,
          repeat: false,
        },
        { type: 'audioEnd', timeMs: 800, name: 'theme', reason: 'wait' },
      ])
    })
  })

  describe('addInput', () => {
    it('does nothing before start is called', () => {
      recorder.addInput('focusChange', undefined, [
        {
          type: 'focusChange',
          startMs: 1200,
          endMs: 1300,
          x: 100,
          y: 200,
          mouse: {
            startMs: 1200,
            endMs: 1300,
          },
        },
      ])
      expect(recorder.getEvents()).toHaveLength(0)
    })

    it('records a click with relative timestamps after start', () => {
      recorder.start() // startTime = 1000
      recorder.addInput('click', undefined, [
        {
          type: 'focusChange',
          startMs: 1200,
          endMs: 1300,
          x: 100,
          y: 200,
          mouse: {
            startMs: 1200,
            endMs: 1300,
          },
        },
        {
          type: 'mouseDown',
          startMs: 1300,
          endMs: 1350,
          easing: 'ease-in-out',
        },
        { type: 'mouseUp', startMs: 1350, endMs: 1500, easing: 'ease-in-out' },
      ])
      const events = recorder.getEvents()
      expect(events).toHaveLength(2)
      const click = events[1] as InputEvent
      expect(click.type).toBe('input')
      expect(click.subType).toBe('click')
      expect(click.events[0]).toEqual({
        type: 'focusChange',
        startMs: 200,
        endMs: 300,
        x: 100,
        y: 200,
        mouse: {
          startMs: 200,
          endMs: 300,
        },
      })
      expect(click.events[1]).toMatchObject({
        type: 'mouseDown',
        startMs: 300,
        endMs: 350,
      })
      expect(click.events[2]).toMatchObject({
        type: 'mouseUp',
        startMs: 350,
        endMs: 500,
      })
    })

    it('records a focusChange InputEvent with one inner event', () => {
      recorder.start() // startTime = 1000
      recorder.addInput('focusChange', undefined, [
        {
          type: 'focusChange',
          startMs: 1200,
          endMs: 1300,
          x: 100,
          y: 200,
          mouse: {
            startMs: 1200,
            endMs: 1300,
          },
        },
      ])
      const events = recorder.getEvents()
      expect(events).toHaveLength(2)
      const move = events[1] as InputEvent
      expect(move.subType).toBe('focusChange')
      expect(move.events[0]).toMatchObject({
        type: 'focusChange',
        startMs: 200,
        endMs: 300,
        x: 100,
        y: 200,
        mouse: {
          startMs: 200,
          endMs: 300,
        },
      })
    })

    it('records mouseShow and mouseHide InputEvents', () => {
      recorder.start()
      recorder.addInput('mouseHide', undefined, [
        { type: 'mouseHide', startMs: 1100, endMs: 1100 },
      ])
      recorder.addInput('mouseShow', undefined, [
        { type: 'mouseShow', startMs: 1200, endMs: 1200 },
      ])
      const events = recorder.getEvents()
      const hide = events[1] as InputEvent
      const show = events[2] as InputEvent
      expect(hide).toMatchObject({
        subType: 'mouseHide',
        events: [{ type: 'mouseHide', startMs: 100, endMs: 100 }],
      })
      expect(show).toMatchObject({
        subType: 'mouseShow',
        events: [{ type: 'mouseShow', startMs: 200, endMs: 200 }],
      })
    })

    it('does not store elementRect on the outer InputEvent', () => {
      recorder.start()
      const rect = { x: 10, y: 20, width: 100, height: 40 }
      recorder.addInput('click', rect, [
        {
          type: 'focusChange',
          startMs: 1100,
          endMs: 1200,
          x: 50,
          y: 60,
          mouse: {
            startMs: 1100,
            endMs: 1200,
          },
          elementRect: rect,
        },
        { type: 'mouseDown', startMs: 1200, endMs: 1250 },
        { type: 'mouseUp', startMs: 1250, endMs: 1300 },
      ])
      const events = recorder.getEvents()
      const click = events[1] as InputEvent
      expect(click.elementRect).toBeUndefined()
      expect(click.events[0]).toMatchObject({ elementRect: rect })
    })
  })

  describe('autoZoom validation', () => {
    it('throws when autoZoom centering exceeds the supported 0..1 range', () => {
      recorder.start()
      now = 1200

      expect(() =>
        recorder.addAutoZoomStart({
          centering: 2,
        })
      ).toThrow(
        /Invalid autoZoom option 'centering': must be between 0 and 1; received 2/
      )
    })

    it('throws when autoZoom amount exceeds the supported 0..1 range', () => {
      recorder.start()
      now = 1200

      expect(() =>
        recorder.addAutoZoomStart({
          amount: 2,
        })
      ).toThrow(
        /Invalid autoZoom option 'amount': must be between 0 and 1; received 2/
      )
    })

    it('throws from addAutoZoomStart when timeMs is strictly inside an input event', () => {
      recorder.start() // startTime=1000
      recorder.addInput('click', undefined, [
        {
          type: 'focusChange',
          startMs: 1100,
          endMs: 1200,
          x: 100,
          y: 100,
          mouse: {
            startMs: 1100,
            endMs: 1200,
          },
        },
        { type: 'mouseDown', startMs: 1200, endMs: 1250 },
        { type: 'mouseUp', startMs: 1250, endMs: 1400 },
      ]) // stored as [100ms, 400ms]
      now = 1300 // relative: 300ms — inside [100, 400]
      expect(() => recorder.addAutoZoomStart()).toThrow(
        /autoZoomStart at 300ms falls inside input 'click' event/
      )
    })

    it('allows addAutoZoomStart exactly at the end of an input event', () => {
      recorder.start()
      recorder.addInput('click', undefined, [
        { type: 'mouseDown', startMs: 1100, endMs: 1200 },
        { type: 'mouseUp', startMs: 1200, endMs: 1400 },
      ]) // stored as [100ms, 400ms]
      now = 1400 // relative: 400ms — at the boundary (not strictly inside)
      expect(() => recorder.addAutoZoomStart()).not.toThrow()
    })

    it('throws from addAutoZoomEnd when timeMs is strictly inside an input event', () => {
      recorder.start()
      recorder.addInput('focusChange', undefined, [
        {
          type: 'focusChange',
          startMs: 1100,
          endMs: 1500,
          x: 0,
          y: 0,
          mouse: {
            startMs: 1100,
            endMs: 1500,
          },
        },
      ]) // stored as [100ms, 500ms]
      now = 1300 // relative: 300ms — inside [100, 500]
      expect(() => recorder.addAutoZoomEnd()).toThrow(
        /autoZoomEnd at 300ms falls inside input 'focusChange' event/
      )
    })

    it('throws from addInput when the event contains an autoZoomStart', () => {
      recorder.start()
      now = 1200 // relative: 200ms
      recorder.addAutoZoomStart()
      now = 1000 // reset (unused)
      // Input spanning [100ms, 400ms] contains autoZoomStart at 200ms
      expect(() =>
        recorder.addInput('click', undefined, [
          { type: 'mouseDown', startMs: 1100, endMs: 1200 },
          { type: 'mouseUp', startMs: 1200, endMs: 1400 },
        ])
      ).toThrow(/contains autoZoomStart at 200ms/)
    })

    it('allows addInput that starts exactly at an autoZoomStart timeMs', () => {
      recorder.start()
      now = 1200 // relative: 200ms
      recorder.addAutoZoomStart()
      // Input starting at 200ms — boundary, not strictly inside
      expect(() =>
        recorder.addInput('click', undefined, [
          { type: 'mouseDown', startMs: 1200, endMs: 1400 },
        ])
      ).not.toThrow()
    })
  })

  describe('overlap validation', () => {
    it('throws when two input events overlap', () => {
      recorder.start() // startTime = 1000
      recorder.addInput('focusChange', undefined, [
        {
          type: 'focusChange',
          startMs: 1100,
          endMs: 1300,
          x: 100,
          y: 100,
          mouse: {
            startMs: 1100,
            endMs: 1300,
          },
        },
      ])
      expect(() =>
        recorder.addInput('click', undefined, [
          { type: 'mouseDown', startMs: 1200, endMs: 1400 },
        ])
      ).toThrow(/overlaps/)
    })

    it('allows events that are adjacent (not overlapping)', () => {
      recorder.start()
      recorder.addInput('focusChange', undefined, [
        {
          type: 'focusChange',
          startMs: 1100,
          endMs: 1200,
          x: 100,
          y: 100,
          mouse: {
            startMs: 1100,
            endMs: 1200,
          },
        },
      ])
      expect(() =>
        recorder.addInput('click', undefined, [
          { type: 'mouseDown', startMs: 1200, endMs: 1300 },
        ])
      ).not.toThrow()
    })

    it('throws when a new event starts inside an existing event', () => {
      recorder.start()
      recorder.addInput('click', undefined, [
        { type: 'mouseDown', startMs: 1100, endMs: 1300 },
      ])
      expect(() =>
        recorder.addInput('click', undefined, [
          { type: 'mouseUp', startMs: 1150, endMs: 1350 },
        ])
      ).toThrow(/overlaps/)
    })
  })

  describe('writeToFile', () => {
    let tmpDir: string

    beforeEach(async () => {
      tmpDir = join(tmpdir(), `screenci-test-${Date.now()}`)
      await mkdir(tmpDir, { recursive: true })
    })

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true })
    })

    it('writes data.json with nested input events', async () => {
      recorder.start() // 1000
      recorder.addInput('click', undefined, [
        { type: 'mouseDown', startMs: 1100, endMs: 1200 },
        { type: 'mouseUp', startMs: 1200, endMs: 1300 },
      ])
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      const packageJson = JSON.parse(
        await readFile(new URL('../package.json', import.meta.url), 'utf-8')
      ) as {
        version: string
      }
      expect(parsed.events).toHaveLength(2)
      expect(parsed.metadata).toMatchObject({
        videoName: 'Test Video',
        screenciVersion: packageJson.version,
      })
      expect(parsed.events[1]).toMatchObject({
        type: 'input',
        subType: 'click',
      })
      const click = parsed.events[1] as InputEvent
      expect(click.events).toHaveLength(2)
      expect(click.events[0]).toMatchObject({ type: 'mouseDown' })
      expect(click.events[1]).toMatchObject({ type: 'mouseUp' })
    })

    it('writes all render option defaults when no renderOptions provided', async () => {
      recorder.start()
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      const ro = parsed.renderOptions as Record<string, unknown>
      // output: stored as aspectRatio + quality (not pre-computed resolution)
      expect((ro.output as Record<string, unknown>).aspectRatio).toBe('16:9')
      expect((ro.output as Record<string, unknown>).quality).toBe('1080p')
      expect((ro.output as Record<string, unknown>).background).toEqual({
        backgroundCss: 'linear-gradient(135deg, #6366f1 0%, #ec4899 100%)',
      })
      // recording defaults
      expect((ro.recording as Record<string, unknown>).size).toBe(1.0)
      expect((ro.recording as Record<string, unknown>).roundness).toBe(0)
      expect((ro.recording as Record<string, unknown>).shape).toBe('rounded')
      expect((ro.recording as Record<string, unknown>).dropShadow).toBe(
        'drop-shadow(0 8px 24px rgba(0,0,0,0.5))'
      )
      // narration defaults
      expect((ro.narration as Record<string, unknown>).size).toBe(0.3)
      expect((ro.narration as Record<string, unknown>).roundness).toBe(0.2)
      expect((ro.narration as Record<string, unknown>).shape).toBe('rounded')
      expect((ro.narration as Record<string, unknown>).corner).toBe(
        'bottom-right'
      )
      expect((ro.narration as Record<string, unknown>).padding).toBe(0.04)
      expect((ro.narration as Record<string, unknown>).dropShadow).toBe(1)
      // mouse default
      expect((ro.mouse as Record<string, unknown>).size).toBe(0.05)
      // motion blur defaults (cursor + camera)
      expect((ro.mouse as Record<string, unknown>).motionBlur).toBe(0.5)
      expect((ro.zoom as Record<string, unknown>).motionBlur).toBe(0.5)
    })

    it('preserves explicit cursor and camera motion blur', async () => {
      recorder = new EventRecorder({
        mouse: { motionBlur: 0 },
        zoom: { motionBlur: 0.8 },
      })
      recorder.start()
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      const ro = parsed.renderOptions as Record<string, unknown>
      expect((ro.mouse as Record<string, unknown>).motionBlur).toBe(0)
      expect((ro.zoom as Record<string, unknown>).motionBlur).toBe(0.8)
    })

    it('merges explicit values with defaults', async () => {
      recorder = new EventRecorder({ recording: { size: 0.8 } })
      recorder.start()
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      const ro = parsed.renderOptions as Record<string, unknown>
      expect((ro.recording as Record<string, unknown>).size).toBe(0.8)
      // other recording fields still defaulted
      expect((ro.recording as Record<string, unknown>).roundness).toBe(0)
      expect((ro.recording as Record<string, unknown>).shape).toBe('rounded')
      // output also defaulted
      expect((ro.output as Record<string, unknown>).aspectRatio).toBe('16:9')
      expect((ro.output as Record<string, unknown>).quality).toBe('1080p')
    })

    it('preserves explicit aspectRatio and serialises to resolution', async () => {
      recorder = new EventRecorder({ output: { aspectRatio: '9:16' } })
      recorder.start()
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      const ro = parsed.renderOptions as Record<string, unknown>
      // explicit aspectRatio preserved, quality defaulted
      expect((ro.output as Record<string, unknown>).aspectRatio).toBe('9:16')
      expect((ro.output as Record<string, unknown>).quality).toBe('1080p')
    })

    it('always serialises aspectRatio + quality to resolution string', async () => {
      recorder = new EventRecorder({
        output: { aspectRatio: '16:9', quality: '1080p' },
      })
      recorder.start()
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      const ro = parsed.renderOptions as Record<string, unknown>
      expect((ro.output as Record<string, unknown>).aspectRatio).toBe('16:9')
      expect((ro.output as Record<string, unknown>).quality).toBe('1080p')
    })

    it('passes through screenshot render options (format, margin, aspectRatio)', async () => {
      recorder = new EventRecorder({
        screenshot: {
          format: { type: 'jpeg', quality: 80 },
          margin: 48,
          aspectRatio: '1:1',
        },
      })
      recorder.start()
      await recorder.writeToFile(tmpDir, 'Test Screenshot')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      const ro = parsed.renderOptions as Record<string, unknown>
      expect(ro.screenshot).toEqual({
        format: { type: 'jpeg', quality: 80 },
        margin: 48,
        aspectRatio: '1:1',
      })
    })

    it('omits the screenshot group when no screenshot options are set', async () => {
      recorder = new EventRecorder({})
      recorder.start()
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      const ro = parsed.renderOptions as Record<string, unknown>
      expect(ro.screenshot).toBeUndefined()
    })

    it('applies default dropShadow and background when not provided', async () => {
      recorder.start()
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      const ro = parsed.renderOptions as Record<string, unknown>
      expect((ro.recording as Record<string, unknown>).dropShadow).toBe(
        'drop-shadow(0 8px 24px rgba(0,0,0,0.5))'
      )
      expect((ro.narration as Record<string, unknown>).dropShadow).toBe(1)
      expect((ro.output as Record<string, unknown>).background).toEqual({
        backgroundCss: 'linear-gradient(135deg, #6366f1 0%, #ec4899 100%)',
      })
    })

    it('overrides dropShadow and background when explicitly provided', async () => {
      recorder = new EventRecorder({
        recording: { dropShadow: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' },
        narration: { dropShadow: 0.2 },
        output: { background: { backgroundCss: '#000' } },
      })
      recorder.start()
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      const ro = parsed.renderOptions as Record<string, unknown>
      expect((ro.recording as Record<string, unknown>).dropShadow).toBe(
        'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
      )
      expect((ro.narration as Record<string, unknown>).dropShadow).toBe(0.2)
      expect((ro.output as Record<string, unknown>).background).toEqual({
        backgroundCss: '#000',
      })
    })

    it('omits languages from metadata when no cues are used', async () => {
      recorder.start()
      recorder.addCueStart('Hello', 'greeting')
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      expect(parsed.metadata?.languages).toBeUndefined()
    })

    it('collects language from single-language cueConfig.voice into metadata', async () => {
      recorder.start()
      recorder.addCueStart('Hello', 'greeting', { voice: voices.Ava })
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      expect(parsed.metadata?.languages).toBeUndefined()
    })

    it('collects language codes from multi-language cues into metadata', async () => {
      recorder.start()
      recorder.addCueStart('', 'greeting', undefined, {
        en: { text: 'Hello', voice: voices.Ava },
        fi: { text: 'Hei', voice: voices.Ava },
      })
      recorder.addCueStart('', 'farewell', undefined, {
        en: { text: 'Goodbye', voice: voices.Ava },
        fi: { text: 'Näkemiin', voice: voices.Ava },
      })
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      expect(parsed.metadata?.languages).toEqual(['en', 'fi'])
    })

    it('deduplicates language codes across multiple cues', async () => {
      recorder.start()
      recorder.addCueStart('', 'a', undefined, {
        en: { text: 'A', voice: voices.Ava },
      })
      recorder.addCueStart('', 'b', undefined, {
        en: { text: 'B', voice: voices.Ava },
      })
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      expect(parsed.metadata?.languages).toEqual(['en'])
    })

    it('filters cue translations to the active language and stamps metadata', async () => {
      recorder.start()
      recorder.setActiveLanguage('fi')
      recorder.addCueStart('', 'greeting', undefined, {
        en: { text: 'Hello', voice: voices.Ava },
        fi: { text: 'Hei', voice: voices.Ava },
      })
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      expect(parsed.metadata?.languages).toEqual(['fi'])
      const cue = parsed.events.find((e) => e.type === 'cueStart') as {
        translations?: Record<string, unknown>
      }
      expect(Object.keys(cue.translations ?? {})).toEqual(['fi'])
    })

    it('drops cue translations entirely when the active language is absent', async () => {
      recorder.start()
      recorder.setActiveLanguage('de')
      recorder.addCueStart('', 'greeting', undefined, {
        en: { text: 'Hello', voice: voices.Ava },
      })
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      expect(parsed.metadata?.languages).toEqual(['de'])
      const cue = parsed.events.find((e) => e.type === 'cueStart') as {
        translations?: Record<string, unknown>
      }
      expect(cue.translations).toBeUndefined()
    })

    it('does not write metadata.voices even when voices are registered', async () => {
      recorder.start()
      recorder.registerVoiceForLang('en', { name: 'Ava' })
      recorder.registerVoiceForLang('en', {
        name: 'Nora',
        modelType: 'expressive',
      })
      recorder.addCueStart('', 'greeting', undefined, {
        en: { text: 'Hello', voice: voices.Ava, modelType: 'consistent' },
      })
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed = JSON.parse(content) as { metadata?: { voices?: unknown } }
      expect(parsed.metadata?.voices).toBeUndefined()
    })

    describe('studio mode', () => {
      it('writes resolved defaults and metadata.studio.renderOptions when render options are deferred to Studio', async () => {
        recorder = new EventRecorder(undefined, undefined, {
          renderOptions: true,
          recordOptions: false,
        })
        recorder.start()
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        // data.json always contains a complete, renderable set of options
        expect(parsed.renderOptions.recording.size).toBe(1.0)
        expect(parsed.renderOptions.output.aspectRatio).toBe('16:9')
        expect(parsed.metadata?.studio).toEqual({ renderOptions: true })
      })

      it('sets metadata.studio.recordOptions when record options are deferred to Studio', async () => {
        recorder = new EventRecorder(undefined, undefined, {
          renderOptions: false,
          recordOptions: true,
        })
        recorder.start()
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        expect(parsed.metadata?.studio).toEqual({ recordOptions: true })
      })

      it('records studio cue starts and sets metadata.studio.narration', async () => {
        recorder.start()
        now = 1500
        recorder.addStudioCueStart('intro')
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        expect(parsed.events[1]).toEqual({
          type: 'cueStart',
          timeMs: 500,
          name: 'intro',
          studio: true,
        })
        expect(parsed.metadata?.studio).toEqual({ narration: true })
        // studio cues have no translations, so no language list is derived
        expect(parsed.metadata?.languages).toBeUndefined()
      })

      it('sets both studio flags when deferred render options and studio cues are combined', async () => {
        recorder = new EventRecorder(undefined, undefined, {
          renderOptions: true,
          recordOptions: false,
        })
        recorder.start()
        recorder.addStudioCueStart('intro')
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        expect(parsed.metadata?.studio).toEqual({
          renderOptions: true,
          narration: true,
        })
      })

      it('records studio asset starts and sets metadata.studio.assets', async () => {
        recorder.start()
        now = 1500
        recorder.addStudioAssetStart('intro')
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        expect(parsed.events[1]).toEqual({
          type: 'assetStart',
          timeMs: 500,
          name: 'intro',
          studio: true,
        })
        expect(parsed.metadata?.studio).toEqual({ assets: true })
      })

      it('records studio audio starts and sets metadata.studio.audio', async () => {
        recorder.start()
        now = 1500
        recorder.addStudioAudioStart('theme')
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        expect(parsed.events[1]).toEqual({
          type: 'audioStart',
          timeMs: 500,
          name: 'theme',
          studio: true,
        })
        expect(parsed.metadata?.studio).toEqual({ audio: true })
      })

      it('does not set metadata.studio.audio for regular audio', async () => {
        recorder = new EventRecorder({ recording: { size: 0.8 } })
        recorder.start()
        recorder.addAudioStart('theme', {
          path: './music.mp3',
          volume: 1,
          repeat: false,
        })
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        expect(parsed.metadata?.studio).toBeUndefined()
      })

      it('sets metadata.studio.languages when the language set is web-owned', async () => {
        recorder = new EventRecorder(undefined, undefined, {
          renderOptions: false,
          recordOptions: false,
          languages: true,
        })
        recorder.start()
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        expect(parsed.metadata?.studio).toEqual({ languages: true })
      })

      it('does not set metadata.studio.languages for a code-defined language set', async () => {
        recorder = new EventRecorder(undefined, undefined, {
          renderOptions: false,
          recordOptions: false,
          languages: false,
        })
        recorder.start()
        recorder.addCueStart('', 'greeting', undefined, {
          en: { text: 'Hello', voice: voices.Ava },
        })
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        expect(parsed.metadata?.studio).toBeUndefined()
      })

      it('combines all studio flags', async () => {
        recorder = new EventRecorder(undefined, undefined, {
          renderOptions: true,
          recordOptions: true,
          languages: true,
        })
        recorder.start()
        recorder.addStudioCueStart('intro')
        recorder.addStudioAssetStart('logo')
        recorder.addStudioAudioStart('theme')
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        expect(parsed.metadata?.studio).toEqual({
          renderOptions: true,
          recordOptions: true,
          narration: true,
          assets: true,
          audio: true,
          languages: true,
        })
      })

      it('does not set metadata.studio.assets for regular assets', async () => {
        recorder = new EventRecorder({ recording: { size: 0.8 } })
        recorder.start()
        recorder.addAssetStart('logo', {
          kind: 'image',
          path: './logo.png',
          durationMs: 1200,
          fullScreen: false,
        })
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        expect(parsed.metadata?.studio).toBeUndefined()
      })

      it('writes no metadata.studio for regular recordings', async () => {
        recorder = new EventRecorder({ recording: { size: 0.8 } })
        recorder.start()
        recorder.addCueStart('', 'greeting', undefined, {
          en: { text: 'Hello', voice: voices.Ava },
        })
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        expect(parsed.metadata?.studio).toBeUndefined()
      })

      it('defaults both studio flags to false when no studio options are passed', async () => {
        recorder = new EventRecorder()
        recorder.start()
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        // No deferral and no studio events: metadata.studio stays absent.
        expect(parsed.metadata?.studio).toBeUndefined()
      })
    })
  })

  describe('addPendingAssetStart', () => {
    let tmpDir: string

    beforeEach(async () => {
      tmpDir = join(tmpdir(), `screenci-pending-${now}`)
      await mkdir(tmpDir, { recursive: true })
    })

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true })
    })

    it('pushes an assetStart with a placeholder path at the current time and registers it', () => {
      recorder.start()
      now = 1300
      recorder.addPendingAssetStart('hint', {
        kind: 'image',
        durationMs: 1500,
        fullScreen: false,
        placement: { relativeTo: 'recording', x: 0.1, y: 0.1, width: 0.3 },
        request: {
          kind: 'image',
          name: 'hint',
          html: '<div>Hi</div>',
          css: '',
          capturePadding: 0,
          deviceScaleFactor: 2,
        },
      })

      const events = recorder.getEvents()
      const start = events.find((e) => e.type === 'assetStart')
      expect(start).toMatchObject({
        type: 'assetStart',
        timeMs: 300,
        name: 'hint',
        kind: 'image',
        path: '',
        durationMs: 1500,
        fullScreen: false,
        placement: { relativeTo: 'recording', x: 0.1, y: 0.1, width: 0.3 },
      })
      expect(start).not.toHaveProperty('fileHash')

      const pending = recorder.getPendingOverlays()
      expect(pending).toHaveLength(1)
      // The registered event is the same object as the one in the timeline.
      expect(pending[0]!.event).toBe(start)
      expect(pending[0]!.request.html).toBe('<div>Hi</div>')
    })

    it('patching the pending event mutates what writeToFile serializes', async () => {
      recorder.start()
      recorder.addPendingAssetStart('hint', {
        kind: 'image',
        durationMs: 1000,
        fullScreen: false,
        request: {
          kind: 'image',
          name: 'hint',
          html: '<div/>',
          css: '',
          capturePadding: 0,
          deviceScaleFactor: 2,
        },
      })

      const entry = recorder.getPendingOverlays()[0]!
      entry.event.path = '/abs/generated/hint-abc.png'
      entry.event.fileHash = 'abc'

      await recorder.writeToFile(tmpDir, 'Patched Video')
      const parsed: RecordingData = JSON.parse(
        await readFile(join(tmpDir, 'data.json'), 'utf-8')
      )
      const serialized = parsed.events.find((e) => e.type === 'assetStart')
      expect(serialized).toMatchObject({
        path: '/abs/generated/hint-abc.png',
        fileHash: 'abc',
      })
    })
  })

  describe('addAssetStart with a dependency', () => {
    it('records a dependency assetStart with no path or fileHash', () => {
      recorder.start()
      now = 1500
      recorder.addAssetStart('intro', {
        kind: 'dependency',
        dependency: { name: 'Intro Clip' },
        durationMs: 1200,
        fullScreen: false,
      })

      const start = recorder.getEvents().find((e) => e.type === 'assetStart')
      expect(start).toEqual({
        type: 'assetStart',
        timeMs: 500,
        name: 'intro',
        kind: 'dependency',
        dependency: { name: 'Intro Clip' },
        durationMs: 1200,
        fullScreen: false,
      })
      expect(start).not.toHaveProperty('path')
      expect(start).not.toHaveProperty('fileHash')
    })

    it('omits durationMs for a live (start/end) dependency window and keeps placement', () => {
      recorder.start()
      recorder.addAssetStart('logo', {
        kind: 'dependency',
        dependency: { name: 'Logo Still' },
        fullScreen: false,
        placement: { relativeTo: 'recording', x: 10, y: 20, width: 100 },
      })

      const start = recorder.getEvents().find((e) => e.type === 'assetStart')
      expect(start).toMatchObject({
        kind: 'dependency',
        dependency: { name: 'Logo Still' },
        fullScreen: false,
        placement: { relativeTo: 'recording', x: 10, y: 20, width: 100 },
      })
      expect(start).not.toHaveProperty('durationMs')
    })
  })

  describe('transition snapping', () => {
    it('snaps assetStart to hideEnd when they are back-to-back within a few ms (hide + overlay)', () => {
      recorder.start()
      now = 1200
      recorder.addHideStart()
      now = 2500
      recorder.addHideEnd()
      now = 2503
      recorder.addAssetStart('clip', {
        kind: 'video',
        path: 'clip.mp4',
        audio: 1,
        fullScreen: true,
      })

      const events = recorder.getEvents().slice(1)
      expect(events[1]).toMatchObject({ type: 'hideEnd', timeMs: 1500 })
      expect(events[2]).toMatchObject({ type: 'assetStart', timeMs: 1500 })
    })

    it('snaps assetStart and patches cueStart to hideEnd when a cue fires in the gap (hide + cue + overlay)', () => {
      recorder.start()
      now = 1000
      recorder.addHideStart()
      now = 2000
      recorder.addHideEnd()
      now = 2084
      recorder.addCueStart('Hello', 'agent')
      now = 2086
      recorder.addAssetStart('clip', {
        kind: 'video',
        path: 'clip.mp4',
        audio: 1,
        fullScreen: true,
      })

      const events = recorder.getEvents().slice(1)
      expect(events[1]).toMatchObject({ type: 'hideEnd', timeMs: 1000 })
      // cueStart is patched to match the snap so narration starts with the overlay
      expect(events[2]).toMatchObject({ type: 'cueStart', timeMs: 1000 })
      expect(events[3]).toMatchObject({ type: 'assetStart', timeMs: 1000 })
    })

    it('snaps hideStart to assetEnd within a few ms (overlay + hide)', () => {
      recorder.start()
      now = 1100
      recorder.addAssetStart('clip', {
        kind: 'video',
        path: 'clip.mp4',
        audio: 1,
        fullScreen: true,
      })
      now = 3100
      recorder.addAssetEnd('clip', 'wait')
      now = 3103
      recorder.addHideStart()

      const events = recorder.getEvents().slice(1)
      expect(events[1]).toMatchObject({ type: 'assetEnd', timeMs: 2100 })
      expect(events[2]).toMatchObject({ type: 'hideStart', timeMs: 2100 })
    })

    it('snaps assetStart to assetEnd within a few ms (overlay + overlay)', () => {
      recorder.start()
      now = 1000
      recorder.addAssetStart('a', {
        kind: 'video',
        path: 'a.mp4',
        audio: 1,
        fullScreen: true,
      })
      now = 3000
      recorder.addAssetEnd('a', 'wait')
      now = 3004
      recorder.addAssetStart('b', {
        kind: 'video',
        path: 'b.mp4',
        audio: 1,
        fullScreen: true,
      })

      const events = recorder.getEvents().slice(1)
      expect(events[1]).toMatchObject({ type: 'assetEnd', timeMs: 2000 })
      expect(events[2]).toMatchObject({ type: 'assetStart', timeMs: 2000 })
    })

    it('snaps addPendingAssetStart to hideEnd within a few ms', () => {
      recorder.start()
      now = 1500
      recorder.addHideEnd()
      now = 1503
      recorder.addPendingAssetStart('hint', {
        kind: 'image',
        durationMs: 1000,
        fullScreen: true,
        request: {
          kind: 'image',
          name: 'hint',
          html: '<div/>',
          css: '',
          capturePadding: 0,
          deviceScaleFactor: 2,
        },
      })

      const events = recorder.getEvents().slice(1)
      expect(events[0]).toMatchObject({ type: 'hideEnd', timeMs: 500 })
      expect(events[1]).toMatchObject({ type: 'assetStart', timeMs: 500 })
    })

    it('snaps hideStart to hideEnd within a few ms (hide + hide)', () => {
      recorder.start()
      now = 1000
      recorder.addHideStart()
      now = 2000
      recorder.addHideEnd()
      now = 2004
      recorder.addHideStart()
      now = 3000
      recorder.addHideEnd()

      const events = recorder.getEvents().slice(1)
      expect(events[1]).toMatchObject({ type: 'hideEnd', timeMs: 1000 })
      expect(events[2]).toMatchObject({ type: 'hideStart', timeMs: 1000 })
    })

    it('does not snap a direct gap that exceeds the small direct threshold', () => {
      recorder.start()
      now = 1000
      recorder.addHideEnd()
      now = 1010
      recorder.addAssetStart('clip', {
        kind: 'video',
        path: 'clip.mp4',
        audio: 1,
        fullScreen: true,
      })

      const events = recorder.getEvents().slice(1)
      expect(events[1]).toMatchObject({ type: 'assetStart', timeMs: 10 })
    })

    it('does not snap a cue-mediated gap that exceeds the frame-sleep compensation', () => {
      recorder.start()
      now = 1000
      recorder.addHideEnd()
      now = 1200
      recorder.addCueStart('Hello', 'agent')
      now = 1203
      recorder.addAssetStart('clip', {
        kind: 'video',
        path: 'clip.mp4',
        audio: 1,
        fullScreen: true,
      })

      const events = recorder.getEvents().slice(1)
      // gap 203ms > SNAP_DIRECT_MS(5) + SNAP_CUE_COMPENSATION_MS(84) = 89ms, no snap
      expect(events[2]).toMatchObject({ type: 'assetStart', timeMs: 203 })
    })
  })
})
