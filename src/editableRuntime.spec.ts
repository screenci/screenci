import { describe, it, expect } from 'vitest'
import {
  applyEditableOverride,
  indexEditableOverrides,
  parseEditableOverrides,
  resolveEditableOverridesForVideo,
  SCREENCI_EDITABLE_OVERRIDES_ENV,
} from './editableRuntime.js'
import { buildEditableMeta } from './editableDescriptor.js'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
} from './runtimeContext.js'

function env(value: string): NodeJS.ProcessEnv {
  return { [SCREENCI_EDITABLE_OVERRIDES_ENV]: value }
}

describe('parseEditableOverrides', () => {
  it('parses a valid override map', () => {
    const parsed = parseEditableOverrides(
      env(
        JSON.stringify({
          'My video': [
            {
              key: 'input|click|getByRole(button)|0',
              values: { moveDuration: 300 },
            },
          ],
        })
      )
    )
    expect(parsed).toEqual({
      'My video': [
        {
          key: 'input|click|getByRole(button)|0',
          values: { moveDuration: 300 },
        },
      ],
    })
  })

  it('returns null when unset or malformed', () => {
    expect(parseEditableOverrides({})).toBeNull()
    expect(parseEditableOverrides(env('not json'))).toBeNull()
    expect(parseEditableOverrides(env('42'))).toBeNull()
  })

  it('drops invalid entries but keeps valid ones', () => {
    const parsed = parseEditableOverrides(
      env(
        JSON.stringify({
          v: [
            { key: 5, values: {} },
            { key: 'delay||0', values: { durationMs: 100 } },
            'nope',
            { key: 'x' },
          ],
          w: 'not-an-array',
        })
      )
    )
    expect(parsed).toEqual({
      v: [{ key: 'delay||0', values: { durationMs: 100 } }],
    })
  })
})

describe('resolveEditableOverridesForVideo', () => {
  it('indexes entries for the requested video only', () => {
    const e = env(
      JSON.stringify({
        a: [{ key: 'speed||0', values: { multiplier: 2 } }],
        b: [{ key: 'speed||0', values: { multiplier: 4 } }],
      })
    )
    const map = resolveEditableOverridesForVideo('a', e)
    expect(map?.get('speed||0')).toEqual({ multiplier: 2 })
    expect(resolveEditableOverridesForVideo('missing', e)).toBeNull()
  })
})

describe('applyEditableOverride', () => {
  const meta = () =>
    buildEditableMeta({
      kind: 'input',
      subKind: 'click',
      matcher: 'getByRole(button)',
      schemaKind: 'cursorMove',
      locked: false,
      defaults: { moveDuration: 900, moveEasing: 'ease-in-out' },
      position: { seq: 0, ordinal: 0 },
    })

  it('merges the override over defaults and stamps applied', () => {
    const m = meta()
    const overrides = indexEditableOverrides([
      {
        key: 'input|click|getByRole(button)|0',
        values: { moveDuration: 250, unknownField: 1 },
      },
    ])
    const merged = applyEditableOverride(m, overrides)
    expect(merged).toEqual({ moveDuration: 250, moveEasing: 'ease-in-out' })
    expect(m.applied).toEqual({ moveDuration: 250 })
  })

  it('never applies keys outside the defaults', () => {
    const m = meta()
    const overrides = indexEditableOverrides([
      { key: 'input|click|getByRole(button)|0', values: { evil: true } },
    ])
    expect(applyEditableOverride(m, overrides)).toEqual(m.defaults)
    expect(m.applied).toBeUndefined()
  })

  it('returns plain defaults for locked metas and missing overrides', () => {
    const locked = { ...meta(), locked: true }
    const overrides = indexEditableOverrides([
      { key: 'input|click|getByRole(button)|0', values: { moveDuration: 1 } },
    ])
    expect(applyEditableOverride(locked, overrides)).toEqual(locked.defaults)
    expect(applyEditableOverride(meta(), new Map())).toEqual(meta().defaults)
    expect(applyEditableOverride(undefined, overrides)).toEqual({})
  })

  it('reads overrides from the runtime context by default', () => {
    const context = createScreenCIRuntimeContext()
    context.editable.overridesByKey = indexEditableOverrides([
      { key: 'input|click|getByRole(button)|0', values: { moveDuration: 111 } },
    ])
    runWithScreenCIRuntimeContext(context, () => {
      const m = meta()
      expect(applyEditableOverride(m)).toMatchObject({ moveDuration: 111 })
    })
  })
})
