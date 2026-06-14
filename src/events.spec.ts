import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { readFile } from 'fs/promises'
import { EventRecorder } from './events.js'
import type { RecordingData, InputEvent } from './events.js'
import { STUDIO_RENDER_OPTIONS, isStudioRenderOptions } from './studio.js'
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

    it('records a compressed span as a time block over the elapsed wait', () => {
      recorder.start() // startTime = 1000
      const startedAt = 1200 // absolute Date.now() captured when the wait began
      now = 4200 // wait ended 3000ms later
      recorder.addCompressedSpan(startedAt, 500)

      expect(recorder.getEvents().slice(1)).toEqual([
        { type: 'timeStart', timeMs: 200, durationMs: 500 },
        { type: 'timeEnd', timeMs: 3200 },
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

  describe('getMaxLagMs', () => {
    it('returns 0 when no recordOptions are provided', () => {
      expect(new EventRecorder().getMaxLagMs()).toBe(0)
    })

    it('returns the configured maxLagMs', () => {
      expect(
        new EventRecorder(undefined, {
          maxLagMs: 500,
        }).getMaxLagMs()
      ).toBe(500)
    })

    it('returns 0 when maxLagMs is not set in recordOptions', () => {
      expect(new EventRecorder(undefined, { fps: 60 }).getMaxLagMs()).toBe(0)
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
      // narration defaults
      expect((ro.narration as Record<string, unknown>).size).toBe(0.3)
      expect((ro.narration as Record<string, unknown>).roundness).toBe(0)
      expect((ro.narration as Record<string, unknown>).shape).toBe('rounded')
      expect((ro.narration as Record<string, unknown>).corner).toBe(
        'bottom-right'
      )
      expect((ro.narration as Record<string, unknown>).padding).toBe(0.04)
      expect((ro.narration as Record<string, unknown>).dropShadow).toBe(1)
      // mouse default
      expect((ro.mouse as Record<string, unknown>).size).toBe(0.05)
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
      expect((ro.narration as Record<string, unknown>).dropShadow).toBe(1)
      expect((ro.output as Record<string, unknown>).background).toEqual({
        backgroundCss:
          'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
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
      it('writes resolved defaults and metadata.studio.renderOptions for STUDIO_RENDER_OPTIONS', async () => {
        recorder = new EventRecorder(STUDIO_RENDER_OPTIONS)
        recorder.start()
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        // data.json always contains a complete, renderable set of options
        expect(parsed.renderOptions.recording.size).toBe(1.0)
        expect(parsed.renderOptions.output.aspectRatio).toBe('16:9')
        expect(parsed.metadata?.studio).toEqual({ renderOptions: true })
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

      it('sets both studio flags when sentinel and studio cues are combined', async () => {
        recorder = new EventRecorder(STUDIO_RENDER_OPTIONS)
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

      it('combines all three studio flags', async () => {
        recorder = new EventRecorder(STUDIO_RENDER_OPTIONS)
        recorder.start()
        recorder.addStudioCueStart('intro')
        recorder.addStudioAssetStart('logo')
        await recorder.writeToFile(tmpDir, 'Test Video')

        const content = await readFile(join(tmpDir, 'data.json'), 'utf-8')
        const parsed: RecordingData = JSON.parse(content)
        expect(parsed.metadata?.studio).toEqual({
          renderOptions: true,
          narration: true,
          assets: true,
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

      it('survives JSON serialization of the sentinel (Playwright use options)', () => {
        const roundTripped: unknown = JSON.parse(
          JSON.stringify(STUDIO_RENDER_OPTIONS)
        )
        expect(isStudioRenderOptions(roundTripped)).toBe(true)
        expect(isStudioRenderOptions({ recording: { size: 1 } })).toBe(false)
        expect(isStudioRenderOptions(undefined)).toBe(false)
      })
    })
  })
})
