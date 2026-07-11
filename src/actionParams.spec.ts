import { describe, expect, it } from 'vitest'
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
