import { describe, expect, it } from 'vitest'
import { isSingleKeyCombo, parseKeyCombo } from './keyCombo'

describe('parseKeyCombo', () => {
  it('parses a single key', () => {
    expect(parseKeyCombo('A', 'linux')).toEqual(['A'])
    expect(parseKeyCombo('Enter', 'linux')).toEqual(['Enter'])
  })

  it('parses modifier combos', () => {
    expect(parseKeyCombo('Shift+A', 'linux')).toEqual(['Shift', 'A'])
    expect(parseKeyCombo('Control+Shift+P', 'linux')).toEqual([
      'Control',
      'Shift',
      'P',
    ])
  })

  it('resolves ControlOrMeta per platform', () => {
    expect(parseKeyCombo('ControlOrMeta+A', 'darwin')).toEqual(['Meta', 'A'])
    expect(parseKeyCombo('ControlOrMeta+A', 'linux')).toEqual(['Control', 'A'])
    expect(parseKeyCombo('ControlOrMeta+A', 'win32')).toEqual(['Control', 'A'])
  })

  it('treats an empty segment as the literal plus key', () => {
    expect(parseKeyCombo('+', 'linux')).toEqual(['+'])
    expect(parseKeyCombo('Control++', 'linux')).toEqual(['Control', '+'])
  })

  it('returns no parts for an empty string', () => {
    expect(parseKeyCombo('', 'linux')).toEqual([])
  })
})

describe('isSingleKeyCombo', () => {
  it('is true for one non-modifier key', () => {
    expect(isSingleKeyCombo(['A'])).toBe(true)
    expect(isSingleKeyCombo(['Enter'])).toBe(true)
  })

  it('is false for modifier combos and bare modifiers', () => {
    expect(isSingleKeyCombo(['Shift', 'A'])).toBe(false)
    expect(isSingleKeyCombo(['Shift'])).toBe(false)
  })
})
