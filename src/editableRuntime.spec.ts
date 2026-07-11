import { describe, it, expect } from 'vitest'
import { applyEditableOverride } from './editableRuntime.js'
import { buildEditableMeta } from './editableDescriptor.js'

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

  it('returns the code-declared defaults', () => {
    const m = meta()
    expect(applyEditableOverride(m)).toEqual({
      moveDuration: 900,
      moveEasing: 'ease-in-out',
    })
  })

  it('returns a copy, never the meta defaults object itself', () => {
    const m = meta()
    const values = applyEditableOverride(m)
    values['moveDuration'] = 1
    expect(m.defaults['moveDuration']).toBe(900)
  })

  it('returns an empty object without meta', () => {
    expect(applyEditableOverride(undefined)).toEqual({})
  })
})
