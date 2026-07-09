import { describe, it, expect } from 'vitest'
import {
  applyEditableOverride,
  resolveRuntimeOverridesForVideo,
} from './editableRuntime.js'
import { SCREENCI_TIMELINE_EDITS_ENV } from './timelineEdits.js'
import { buildEditableMeta } from './editableDescriptor.js'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
} from './runtimeContext.js'

function env(value: string): NodeJS.ProcessEnv {
  return { [SCREENCI_TIMELINE_EDITS_ENV]: value }
}

const paramEdit = (key: string, fields: Record<string, unknown>) => ({
  type: 'paramEdit',
  id: `param|${key}`,
  target: { key },
  fields,
})

/** Overrides map in the shape applyEditableOverride consumes. */
function overridesByKey(
  entries: Array<{ key: string; values: Record<string, unknown> }>
): Map<string, Record<string, unknown>> {
  return new Map(entries.map((entry) => [entry.key, entry.values]))
}

describe('resolveRuntimeOverridesForVideo', () => {
  it('indexes the unified doc param edits for the requested video only', () => {
    const e = env(
      JSON.stringify({
        a: { version: 2, edits: [paramEdit('speed||0', { multiplier: 2 })] },
        b: { version: 2, edits: [paramEdit('speed||0', { multiplier: 4 })] },
      })
    )
    const map = resolveRuntimeOverridesForVideo('a', e)
    expect(map?.get('speed||0')).toEqual({ multiplier: 2 })
    expect(resolveRuntimeOverridesForVideo('missing', e)).toBeNull()
  })

  it('returns null when unset, malformed, or without param edits', () => {
    expect(resolveRuntimeOverridesForVideo('a', {})).toBeNull()
    expect(resolveRuntimeOverridesForVideo('a', env('not json'))).toBeNull()
    expect(
      resolveRuntimeOverridesForVideo(
        'a',
        env(
          JSON.stringify({
            a: {
              version: 2,
              edits: [
                {
                  type: 'placedEvent',
                  id: 'e1',
                  kind: 'hide',
                  anchor: {
                    ref: { type: 'videoStart' },
                    edge: 'start',
                    offsetMs: 0,
                  },
                  end: { durationMs: 100 },
                },
              ],
            },
          })
        )
      )
    ).toBeNull()
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
    const overrides = overridesByKey([
      {
        key: 'input|click|getByRole(button)|0',
        values: { moveDuration: 250, unknownField: 1 },
      },
    ])
    const merged = applyEditableOverride(m, overrides)
    expect(merged).toEqual({ moveDuration: 250, moveEasing: 'ease-in-out' })
    expect(m.applied).toEqual({ moveDuration: 250 })
  })

  it('skips a field equal to the default (no no-op override)', () => {
    const m = meta()
    const warnings: string[] = []
    // moveDuration equals the default (900): a no-op that must not be applied,
    // logged, or reported. moveEasing genuinely changes.
    const overrides = overridesByKey([
      {
        key: 'input|click|getByRole(button)|0',
        values: { moveDuration: 900, moveEasing: 'linear' },
      },
    ])
    const merged = applyEditableOverride(m, overrides, (message) =>
      warnings.push(message)
    )
    expect(merged).toEqual({ moveDuration: 900, moveEasing: 'linear' })
    // Only the field that actually changed is recorded as applied.
    expect(m.applied).toEqual({ moveEasing: 'linear' })
  })

  it('applies nothing when every field equals the default', () => {
    const m = meta()
    const overrides = overridesByKey([
      {
        key: 'input|click|getByRole(button)|0',
        values: { moveDuration: 900, moveEasing: 'ease-in-out' },
      },
    ])
    expect(applyEditableOverride(m, overrides)).toEqual(m.defaults)
    expect(m.applied).toBeUndefined()
  })

  it('never applies keys outside the defaults', () => {
    const m = meta()
    const overrides = overridesByKey([
      { key: 'input|click|getByRole(button)|0', values: { evil: true } },
    ])
    expect(applyEditableOverride(m, overrides)).toEqual(m.defaults)
    expect(m.applied).toBeUndefined()
  })

  it('returns plain defaults for missing overrides', () => {
    const overrides = overridesByKey([
      { key: 'input|click|getByRole(button)|0', values: { moveDuration: 1 } },
    ])
    expect(applyEditableOverride(meta(), new Map())).toEqual(meta().defaults)
    expect(applyEditableOverride(undefined, overrides)).toEqual({})
  })

  it('applies overrides over explicit code values and warns per shadowed field', () => {
    const locked = {
      ...meta(),
      locked: true,
      lockedFields: ['moveDuration'],
    }
    const overrides = overridesByKey([
      {
        key: 'input|click|getByRole(button)|0',
        values: { moveDuration: 1, moveEasing: 'linear' },
      },
    ])
    const warnings: string[] = []
    const merged = applyEditableOverride(locked, overrides, (message) =>
      warnings.push(message)
    )
    expect(merged).toEqual({ moveDuration: 1, moveEasing: 'linear' })
    expect(locked.applied).toEqual({ moveDuration: 1, moveEasing: 'linear' })
    // Only the explicitly code-set field warns; the defaulted easing does not.
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('shadows code value')
    expect(warnings[0]).toContain('moveDuration')
    expect(warnings[0]).toContain('900')
  })

  it('treats every field of a locked meta without lockedFields as explicit', () => {
    const locked = { ...meta(), locked: true }
    const overrides = overridesByKey([
      { key: 'input|click|getByRole(button)|0', values: { moveDuration: 1 } },
    ])
    const warnings: string[] = []
    const merged = applyEditableOverride(locked, overrides, (message) =>
      warnings.push(message)
    )
    expect(merged).toMatchObject({ moveDuration: 1 })
    expect(warnings).toHaveLength(1)
  })

  it('reads overrides from the runtime context by default', () => {
    const context = createScreenCIRuntimeContext()
    context.editable.overridesByKey = overridesByKey([
      { key: 'input|click|getByRole(button)|0', values: { moveDuration: 111 } },
    ])
    runWithScreenCIRuntimeContext(context, () => {
      const m = meta()
      expect(applyEditableOverride(m)).toMatchObject({ moveDuration: 111 })
    })
  })
})
