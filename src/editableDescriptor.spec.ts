import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildEditableMeta,
  chainLocatorDescription,
  describeLocatorCall,
  editableIdentityKey,
  getLocatorDescription,
  setLocatorDescription,
  stableEditableKey,
} from './editableDescriptor.js'
import {
  createScreenCIRuntimeContext,
  nextEditablePosition,
  resetEditableRuntimeState,
  runWithScreenCIRuntimeContext,
} from './runtimeContext.js'
import { EventRecorder } from './events.js'

describe('describeLocatorCall', () => {
  it('renders a simple selector call', () => {
    expect(describeLocatorCall('locator', ['#save'])).toBe('locator(#save)')
  })

  it('renders getByRole with an options object', () => {
    expect(describeLocatorCall('getByRole', ['button', { name: 'Save' }])).toBe(
      'getByRole(button, name=Save)'
    )
  })

  it('renders regexes, numbers, and booleans', () => {
    expect(describeLocatorCall('getByText', [/Sign in/i])).toBe(
      'getByText(/Sign in/i)'
    )
    expect(describeLocatorCall('nth', [2])).toBe('nth(2)')
    expect(
      describeLocatorCall('getByRole', ['checkbox', { checked: true }])
    ).toBe('getByRole(checkbox, checked=true)')
  })

  it('skips undefined option values and empty args', () => {
    expect(
      describeLocatorCall('getByRole', ['button', { name: undefined }])
    ).toBe('getByRole(button)')
    expect(describeLocatorCall('first', [])).toBe('first()')
  })

  it('uses a nested locator description when one was captured', () => {
    const nested = {}
    setLocatorDescription(nested, 'getByRole(listitem)')
    expect(describeLocatorCall('filter', [{ has: nested }])).toBe(
      'filter(has=getByRole(listitem))'
    )
  })
})

describe('chainLocatorDescription', () => {
  it('returns the call alone without a parent', () => {
    expect(chainLocatorDescription(undefined, 'getByRole(button)')).toBe(
      'getByRole(button)'
    )
  })

  it('joins parent and call with an arrow', () => {
    expect(chainLocatorDescription('getByRole(list)', 'nth(2)')).toBe(
      'getByRole(list) > nth(2)'
    )
  })
})

describe('locator description store', () => {
  it('stores and reads a description per object', () => {
    const locator = {}
    expect(getLocatorDescription(locator)).toBeUndefined()
    setLocatorDescription(locator, 'getByTestId(main)')
    expect(getLocatorDescription(locator)).toBe('getByTestId(main)')
  })
})

describe('editable keys', () => {
  it('prefers the explicit name over the matcher in the identity', () => {
    expect(
      editableIdentityKey({
        kind: 'input',
        subKind: 'click',
        name: 'save',
        matcher: 'getByRole(button)',
      })
    ).toBe('input|click|save')
  })

  it('falls back to the matcher, then to an empty identity part', () => {
    expect(
      editableIdentityKey({
        kind: 'input',
        subKind: 'click',
        matcher: 'getByRole(button)',
      })
    ).toBe('input|click|getByRole(button)')
    expect(editableIdentityKey({ kind: 'delay' })).toBe('delay||')
  })

  it('appends the ordinal for the stable key', () => {
    expect(
      stableEditableKey({
        kind: 'input',
        subKind: 'click',
        matcher: 'getByRole(button)',
        ordinal: 3,
      })
    ).toBe('input|click|getByRole(button)|3')
  })
})

describe('buildEditableMeta', () => {
  it('assembles descriptor and metadata, omitting absent fields', () => {
    const meta = buildEditableMeta({
      kind: 'input',
      subKind: 'click',
      matcher: 'getByRole(button, name=Save)',
      schemaKind: 'cursorMove',
      locked: false,
      defaults: { moveDuration: 900 },
      position: { seq: 4, ordinal: 1 },
    })
    expect(meta).toEqual({
      descriptor: {
        kind: 'input',
        subKind: 'click',
        matcher: 'getByRole(button, name=Save)',
        ordinal: 1,
        seq: 4,
      },
      locked: false,
      schemaKind: 'cursorMove',
      defaults: { moveDuration: 900 },
    })
  })

  it('carries applied overrides when present', () => {
    const meta = buildEditableMeta({
      kind: 'speed',
      schemaKind: 'speed',
      locked: true,
      defaults: { multiplier: 3 },
      applied: { multiplier: 2 },
      position: { seq: 0, ordinal: 0 },
    })
    expect(meta.applied).toEqual({ multiplier: 2 })
    expect(meta.descriptor).toEqual({ kind: 'speed', ordinal: 0, seq: 0 })
  })
})

describe('nextEditablePosition', () => {
  it('increments seq globally and ordinal per identity', () => {
    runWithScreenCIRuntimeContext(createScreenCIRuntimeContext(), () => {
      expect(nextEditablePosition('input|click|a')).toEqual({
        seq: 0,
        ordinal: 0,
      })
      expect(nextEditablePosition('input|click|b')).toEqual({
        seq: 1,
        ordinal: 0,
      })
      expect(nextEditablePosition('input|click|a')).toEqual({
        seq: 2,
        ordinal: 1,
      })
    })
  })

  it('resets with resetEditableRuntimeState', () => {
    runWithScreenCIRuntimeContext(createScreenCIRuntimeContext(), () => {
      nextEditablePosition('delay||')
      nextEditablePosition('delay||')
      resetEditableRuntimeState()
      expect(nextEditablePosition('delay||')).toEqual({ seq: 0, ordinal: 0 })
    })
  })

  it('starts fresh per runtime context', () => {
    runWithScreenCIRuntimeContext(createScreenCIRuntimeContext(), () => {
      nextEditablePosition('speed||')
    })
    runWithScreenCIRuntimeContext(createScreenCIRuntimeContext(), () => {
      expect(nextEditablePosition('speed||')).toEqual({ seq: 0, ordinal: 0 })
    })
  })
})

describe('EventRecorder editable metadata', () => {
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

  it('stamps editable metadata on input events', () => {
    recorder.start()
    const editable = buildEditableMeta({
      kind: 'input',
      subKind: 'click',
      matcher: 'getByRole(button)',
      schemaKind: 'cursorMove',
      locked: false,
      defaults: { moveDuration: 900 },
      position: { seq: 0, ordinal: 0 },
    })
    recorder.addInput(
      'click',
      undefined,
      [{ type: 'mouseWait', startMs: 1100, endMs: 1200 }],
      editable
    )
    const [, input] = recorder.getEvents()
    expect(input).toMatchObject({ type: 'input', editable })
  })

  it('records delay events with duration and editable metadata', () => {
    recorder.start()
    now = 1500
    const editable = buildEditableMeta({
      kind: 'delay',
      schemaKind: 'delay',
      locked: true,
      defaults: { durationMs: 250 },
      position: { seq: 0, ordinal: 0 },
    })
    recorder.addDelay(250, editable)
    expect(recorder.getEvents().slice(1)).toEqual([
      { type: 'delay', timeMs: 500, durationMs: 250, editable },
    ])
  })

  it('omits editable when not provided', () => {
    recorder.start()
    recorder.addDelay(100)
    recorder.addSpeedStart(2)
    const [, delay, speedStart] = recorder.getEvents()
    expect(delay).toEqual({ type: 'delay', timeMs: 0, durationMs: 100 })
    expect(speedStart).toEqual({ type: 'speedStart', timeMs: 0, multiplier: 2 })
  })

  it('stamps editable metadata on speedStart and autoZoomStart', () => {
    recorder.start()
    const speedEditable = buildEditableMeta({
      kind: 'speed',
      schemaKind: 'speed',
      locked: true,
      defaults: { multiplier: 3 },
      position: { seq: 0, ordinal: 0 },
    })
    recorder.addSpeedStart(3, speedEditable)
    recorder.addSpeedEnd()
    const zoomEditable = buildEditableMeta({
      kind: 'autoZoom',
      schemaKind: 'autoZoom',
      locked: false,
      defaults: { amount: 0.72 },
      position: { seq: 1, ordinal: 0 },
    })
    recorder.addAutoZoomStart(undefined, zoomEditable)
    const events = recorder.getEvents()
    expect(events[1]).toMatchObject({
      type: 'speedStart',
      editable: speedEditable,
    })
    expect(events[3]).toMatchObject({
      type: 'autoZoomStart',
      editable: zoomEditable,
    })
  })
})
