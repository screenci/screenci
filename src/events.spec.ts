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

  describe('addInput', () => {
    it('does nothing before start is called', () => {
      recorder.addInput('mouseMove', undefined, [
        {
          type: 'mouseMove',
          startMs: 1200,
          endMs: 1300,
          duration: 100,
          x: 100,
          y: 200,
        },
      ])
      expect(recorder.getEvents()).toHaveLength(0)
    })

    it('records a click with relative timestamps after start', () => {
      recorder.start() // startTime = 1000
      recorder.addInput('click', undefined, [
        {
          type: 'mouseMove',
          startMs: 1200,
          endMs: 1300,
          duration: 100,
          x: 100,
          y: 200,
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
        type: 'mouseMove',
        startMs: 200,
        endMs: 300,
        duration: 100,
        x: 100,
        y: 200,
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

    it('records a mouseMove InputEvent with one inner event', () => {
      recorder.start() // startTime = 1000
      recorder.addInput('mouseMove', undefined, [
        {
          type: 'mouseMove',
          startMs: 1200,
          endMs: 1300,
          duration: 100,
          x: 100,
          y: 200,
        },
      ])
      const events = recorder.getEvents()
      expect(events).toHaveLength(2)
      const move = events[1] as InputEvent
      expect(move.subType).toBe('mouseMove')
      expect(move.events[0]).toMatchObject({
        type: 'mouseMove',
        startMs: 200,
        endMs: 300,
        duration: 100,
        x: 100,
        y: 200,
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

    it('stores elementRect on the outer InputEvent', () => {
      recorder.start()
      const rect = { x: 10, y: 20, width: 100, height: 40 }
      recorder.addInput('click', rect, [
        {
          type: 'mouseMove',
          startMs: 1100,
          endMs: 1200,
          duration: 100,
          x: 50,
          y: 60,
        },
        { type: 'mouseDown', startMs: 1200, endMs: 1250 },
        { type: 'mouseUp', startMs: 1250, endMs: 1300 },
      ])
      const events = recorder.getEvents()
      const click = events[1] as InputEvent
      expect(click.elementRect).toEqual(rect)
    })
  })

  describe('autoZoom validation', () => {
    it('clamps autoZoom centering values into the supported 0..1 range', () => {
      recorder.start()
      now = 1200

      recorder.addAutoZoomStart({
        centering: { cursor: 2, input: 5, click: -1 },
      })

      const event = recorder.getEvents()[1]
      expect(event).toMatchObject({
        type: 'autoZoomStart',
        centering: { cursor: 1, input: 1, click: 0 },
      })
    })

    it('throws from addAutoZoomStart when timeMs is strictly inside an input event', () => {
      recorder.start() // startTime=1000
      recorder.addInput('click', undefined, [
        {
          type: 'mouseMove',
          startMs: 1100,
          endMs: 1200,
          duration: 100,
          x: 100,
          y: 100,
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
      recorder.addInput('mouseMove', undefined, [
        {
          type: 'mouseMove',
          startMs: 1100,
          endMs: 1500,
          duration: 400,
          x: 0,
          y: 0,
        },
      ]) // stored as [100ms, 500ms]
      now = 1300 // relative: 300ms — inside [100, 500]
      expect(() => recorder.addAutoZoomEnd()).toThrow(
        /autoZoomEnd at 300ms falls inside input 'mouseMove' event/
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
      recorder.addInput('mouseMove', undefined, [
        {
          type: 'mouseMove',
          startMs: 1100,
          endMs: 1300,
          duration: 200,
          x: 100,
          y: 100,
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
      recorder.addInput('mouseMove', undefined, [
        {
          type: 'mouseMove',
          startMs: 1100,
          endMs: 1200,
          duration: 100,
          x: 100,
          y: 100,
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
      expect(parsed.events).toHaveLength(2)
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
        backgroundCss:
          'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      })
      // recording defaults
      expect((ro.recording as Record<string, unknown>).size).toBe(1.0)
      expect((ro.recording as Record<string, unknown>).roundness).toBe(0)
      expect((ro.recording as Record<string, unknown>).shape).toBe('rounded')
      expect((ro.recording as Record<string, unknown>).dropShadow).toBe(
        'drop-shadow(0 8px 24px rgba(0,0,0,0.5))'
      )
      // voiceOvers defaults
      expect((ro.voiceOvers as Record<string, unknown>).size).toBe(0.3)
      expect((ro.voiceOvers as Record<string, unknown>).roundness).toBe(0)
      expect((ro.voiceOvers as Record<string, unknown>).shape).toBe('squircle')
      expect((ro.voiceOvers as Record<string, unknown>).corner).toBe(
        'bottom-right'
      )
      expect((ro.voiceOvers as Record<string, unknown>).padding).toBe(0.04)
      expect((ro.voiceOvers as Record<string, unknown>).dropShadow).toBe(
        'drop-shadow(0 8px 24px rgba(0,0,0,0.5))'
      )
      // cursor default
      expect((ro.cursor as Record<string, unknown>).size).toBe(0.05)
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

    it('applies default dropShadow and background when not provided', async () => {
      recorder.start()
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      const ro = parsed.renderOptions as Record<string, unknown>
      expect((ro.recording as Record<string, unknown>).dropShadow).toBe(
        'drop-shadow(0 8px 24px rgba(0,0,0,0.5))'
      )
      expect((ro.voiceOvers as Record<string, unknown>).dropShadow).toBe(
        'drop-shadow(0 8px 24px rgba(0,0,0,0.5))'
      )
      expect((ro.output as Record<string, unknown>).background).toEqual({
        backgroundCss:
          'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      })
    })

    it('overrides dropShadow and background when explicitly provided', async () => {
      recorder = new EventRecorder({
        recording: { dropShadow: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' },
        voiceOvers: { dropShadow: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' },
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
      expect((ro.voiceOvers as Record<string, unknown>).dropShadow).toBe(
        'drop-shadow(0 1px 2px rgba(0,0,0,0.2))'
      )
      expect((ro.output as Record<string, unknown>).background).toEqual({
        backgroundCss: '#000',
      })
    })

    it('omits languages from metadata when no captions are used', async () => {
      recorder.start()
      recorder.addCaptionStart('Hello', 'greeting')
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      expect(parsed.metadata?.languages).toBeUndefined()
    })

    it('collects language from single-language captionConfig.voice into metadata', async () => {
      recorder.start()
      recorder.addCaptionStart('Hello', 'greeting', { voice: voices.Ava })
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      expect(parsed.metadata?.languages).toBeUndefined()
    })

    it('collects language codes from multi-language captions into metadata', async () => {
      recorder.start()
      recorder.addCaptionStart('', 'greeting', undefined, {
        en: { text: 'Hello', voice: voices.Ava },
        fi: { text: 'Hei', voice: voices.Ava },
      })
      recorder.addCaptionStart('', 'farewell', undefined, {
        en: { text: 'Goodbye', voice: voices.Ava },
        fi: { text: 'Näkemiin', voice: voices.Ava },
      })
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      expect(parsed.metadata?.languages).toEqual(['en', 'fi'])
    })

    it('deduplicates language codes across multiple captions', async () => {
      recorder.start()
      recorder.addCaptionStart('', 'a', undefined, {
        en: { text: 'A', voice: voices.Ava },
      })
      recorder.addCaptionStart('', 'b', undefined, {
        en: { text: 'B', voice: voices.Ava },
      })
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed: RecordingData = JSON.parse(content)
      expect(parsed.metadata?.languages).toEqual(['en'])
    })

    it('does not write metadata.voices even when voices are registered', async () => {
      recorder.start()
      recorder.registerVoiceForLang('en', { name: 'Ava' })
      recorder.registerVoiceForLang('en', {
        name: 'Nora',
        modelType: 'expressive',
      })
      recorder.addCaptionStart('', 'greeting', undefined, {
        en: { text: 'Hello', voice: voices.Ava, modelType: 'consistent' },
      })
      await recorder.writeToFile(tmpDir, 'Test Video')

      const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
      const parsed = JSON.parse(content) as { metadata?: { voices?: unknown } }
      expect(parsed.metadata?.voices).toBeUndefined()
    })
  })
})
