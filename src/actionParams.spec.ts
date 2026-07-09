import { describe, expect, it, vi } from 'vitest'
import {
  ACTION_PARAM_DEFAULTS,
  ActionParamCollector,
  type ActionMethod,
  actionParamKey,
  normalizeSelector,
  resolveSpecWithoutTracking,
} from './actionParams.js'

describe('actionParamKey', () => {
  it('joins selector, method, occurrence, and option path with pipes', () => {
    expect(
      actionParamKey("getByRole('button')", 'click', 0, 'move.duration')
    ).toBe("getByRole('button')|click|0|move.duration")
  })
})

describe('normalizeSelector', () => {
  it('strips the Locator@ engine prefix', () => {
    expect(normalizeSelector("Locator@getByRole('button')")).toBe(
      "getByRole('button')"
    )
  })

  it('keeps a plain selector string untouched', () => {
    expect(
      normalizeSelector("locator('#a').getByRole('button', { name: 'Save' })")
    ).toBe("locator('#a').getByRole('button', { name: 'Save' })")
  })
})

describe('resolveSpecWithoutTracking', () => {
  it('resolves explicit over fallback', () => {
    expect(
      resolveSpecWithoutTracking({
        'move.duration': { explicit: 400, fallback: 900 },
        'move.easing': { explicit: undefined, fallback: 'ease-in-out' },
      })
    ).toEqual({ 'move.duration': 400, 'move.easing': 'ease-in-out' })
  })
})

describe('ActionParamCollector', () => {
  const SELECTOR = "getByRole('button', { name: 'Save' })"

  it('records defaults with source "default"', () => {
    const collector = new ActionParamCollector()
    const effective = collector.apply(SELECTOR, 'click', {
      'move.duration': { explicit: undefined, fallback: 900 },
    })
    expect(effective).toEqual({ 'move.duration': 900 })
    expect(collector.getRecords()).toEqual([
      {
        selector: SELECTOR,
        method: 'click',
        occurrence: 0,
        params: { 'move.duration': { value: 900, source: 'default' } },
      },
    ])
  })

  it('records explicit call-site values with source "explicit"', () => {
    const collector = new ActionParamCollector()
    collector.apply(SELECTOR, 'click', {
      'move.duration': { explicit: 400, fallback: 900 },
    })
    expect(collector.getRecords()[0]!.params['move.duration']).toEqual({
      value: 400,
      source: 'explicit',
    })
  })

  it('collapses an undefined code value to null in the record', () => {
    const collector = new ActionParamCollector()
    collector.apply(SELECTOR, 'click', {
      'move.speed': { explicit: undefined, fallback: undefined },
    })
    expect(collector.getRecords()[0]!.params['move.speed']).toEqual({
      value: null,
      source: 'default',
    })
  })

  it('stores the editId on the record when provided', () => {
    const collector = new ActionParamCollector()
    collector.apply(
      SELECTOR,
      'click',
      { 'move.duration': { explicit: undefined, fallback: 900 } },
      'save-button-click'
    )
    expect(collector.getRecords()[0]!.editId).toBe('save-button-click')
  })

  it('omits editId from the record when not provided', () => {
    const collector = new ActionParamCollector()
    collector.apply(SELECTOR, 'click', {
      'move.duration': { explicit: undefined, fallback: 900 },
    })
    const record = collector.getRecords()[0]!
    expect(record.editId).toBeUndefined()
    expect('editId' in record).toBe(false)
  })

  it('counts occurrences per selector + method', () => {
    const collector = new ActionParamCollector()
    collector.apply(SELECTOR, 'click', {})
    collector.apply(SELECTOR, 'click', {})
    collector.apply(SELECTOR, 'hover', {})
    expect(collector.getRecords().map((r) => [r.method, r.occurrence])).toEqual(
      [
        ['click', 0],
        ['click', 1],
        ['hover', 0],
      ]
    )
  })

  it('applies a matching override, logs it, and keeps code provenance', () => {
    const log = vi.fn()
    const collector = new ActionParamCollector(
      { [actionParamKey(SELECTOR, 'click', 0, 'move.duration')]: 250 },
      log
    )
    const effective = collector.apply(SELECTOR, 'click', {
      'move.duration': { explicit: 400, fallback: 900 },
    })
    expect(effective).toEqual({ 'move.duration': 250 })
    // The record keeps the code value plus the actually used value.
    expect(collector.getRecords()[0]!.params['move.duration']).toEqual({
      value: 400,
      source: 'explicit',
      used: 250,
    })
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toContain('editor override')
    expect(log.mock.calls[0]![0]).toContain(SELECTOR)
    expect(log.mock.calls[0]![0]).toContain('move.duration')
    expect(log.mock.calls[0]![0]).toContain('250')
    expect(log.mock.calls[0]![0]).toContain('400')
  })

  it('only overrides the matching occurrence', () => {
    const log = vi.fn()
    const collector = new ActionParamCollector(
      { [actionParamKey(SELECTOR, 'click', 1, 'move.duration')]: 250 },
      log
    )
    const first = collector.apply(SELECTOR, 'click', {
      'move.duration': { explicit: undefined, fallback: 900 },
    })
    const second = collector.apply(SELECTOR, 'click', {
      'move.duration': { explicit: undefined, fallback: 900 },
    })
    expect(first).toEqual({ 'move.duration': 900 })
    expect(second).toEqual({ 'move.duration': 250 })
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('ignores non-matching override keys and inapplicable values', () => {
    const log = vi.fn()
    const collector = new ActionParamCollector(
      {
        'other|click|0|move.duration': 250,
        [actionParamKey(SELECTOR, 'click', 0, 'noWaitAfter')]: null,
      },
      log
    )
    const effective = collector.apply(SELECTOR, 'click', {
      'move.duration': { explicit: undefined, fallback: 900 },
      noWaitAfter: { explicit: undefined, fallback: true },
    })
    expect(effective).toEqual({ 'move.duration': 900, noWaitAfter: true })
    expect(log).not.toHaveBeenCalled()
  })

  it('treats an override equal to the code value as a no-op (no log, no used)', () => {
    const log = vi.fn()
    const collector = new ActionParamCollector(
      { [actionParamKey(SELECTOR, 'click', 0, 'move.duration')]: 400 },
      log
    )
    const effective = collector.apply(SELECTOR, 'click', {
      'move.duration': { explicit: 400, fallback: 900 },
    })
    expect(effective).toEqual({ 'move.duration': 400 })
    expect(collector.getRecords()[0]!.params['move.duration']).toEqual({
      value: 400,
      source: 'explicit',
    })
    expect(log).not.toHaveBeenCalled()
  })

  it('accepts structured overrides (e.g. position)', () => {
    const collector = new ActionParamCollector(
      { [actionParamKey(SELECTOR, 'click', 0, 'position')]: { x: 1, y: 2 } },
      vi.fn()
    )
    const effective = collector.apply(SELECTOR, 'click', {
      position: { explicit: undefined, fallback: undefined },
    })
    expect(effective).toEqual({ position: { x: 1, y: 2 } })
  })
})

describe('ACTION_PARAM_DEFAULTS', () => {
  it('exposes the effective defaults of the instrumented actions', () => {
    expect(ACTION_PARAM_DEFAULTS.click).toEqual({
      'move.duration': 900,
      'move.speed': null,
      'move.easing': 'ease-in-out',
      'move.curve': 'none',
      'move.curviness': null,
      'move.delayAfter': 50,
      position: null,
      noWaitAfter: true,
    })
    expect(ACTION_PARAM_DEFAULTS.fill['duration']).toBe(1000)
    expect(ACTION_PARAM_DEFAULTS.hover['duration']).toBe(1000)
    expect(ACTION_PARAM_DEFAULTS.dragTo['dragSteps']).toBe(24)
    expect(ACTION_PARAM_DEFAULTS.dragTo['move.delayAfter']).toBe(100)
    expect(ACTION_PARAM_DEFAULTS.scrollIntoViewIfNeeded['easing']).toBe(
      'ease-in-out'
    )
  })

  it('covers every action method', () => {
    const methods: ActionMethod[] = [
      'click',
      'fill',
      'pressSequentially',
      'tap',
      'check',
      'uncheck',
      'selectOption',
      'hover',
      'dragTo',
      'selectText',
      'scrollIntoViewIfNeeded',
    ]
    for (const method of methods) {
      expect(ACTION_PARAM_DEFAULTS[method]).toBeDefined()
    }
  })
})
