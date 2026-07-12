import { describe, expect, it } from 'vitest'

import {
  cueIdFor,
  narrationEditIdFor,
  optionsEditIdFor,
  overlayDeclIdFor,
  overlayIdFor,
  paramEditIdFor,
  parseEditId,
  renameEditIdFor,
} from './timelineEdits.js'

describe('cueIdFor / overlayIdFor', () => {
  it('produces stable name-ordinal ids', () => {
    expect(cueIdFor('welcome', 0)).toBe('cue||welcome|0')
    expect(overlayIdFor('logo', 2)).toBe('overlay||logo|2')
    expect(overlayDeclIdFor('logo')).toBe('overlaydecl-logo')
  })
})

describe('edit id encoders', () => {
  it('produce the wire conventions the app and convex share', () => {
    expect(paramEditIdFor('click1')).toBe('param|click1')
    expect(renameEditIdFor('open-menu')).toBe('rename|open-menu')
    expect(optionsEditIdFor('renderOptions')).toBe('options|renderOptions')
    expect(narrationEditIdFor('intro', 'de')).toBe('narration|intro|de')
  })
})

describe('parseEditId', () => {
  it('round-trips every encoder', () => {
    expect(parseEditId(paramEditIdFor('click1'))).toEqual({
      kind: 'param',
      key: 'click1',
    })
    expect(parseEditId(renameEditIdFor('open-menu'))).toEqual({
      kind: 'rename',
      targetEditId: 'open-menu',
    })
    expect(parseEditId(optionsEditIdFor('recordOptions'))).toEqual({
      kind: 'options',
      method: 'recordOptions',
    })
    expect(parseEditId(narrationEditIdFor('intro', 'de'))).toEqual({
      kind: 'narration',
      cueName: 'intro',
      lang: 'de',
    })
    expect(parseEditId(overlayDeclIdFor('logo'))).toEqual({
      kind: 'overlayDecl',
      overlayName: 'logo',
    })
  })

  it('keeps the language as the last narration segment', () => {
    expect(parseEditId('narration|a|b|fr')).toEqual({
      kind: 'narration',
      cueName: 'a|b',
      lang: 'fr',
    })
  })

  it("falls back to 'other' for unknown or malformed ids", () => {
    expect(parseEditId('media-123')).toEqual({
      kind: 'other',
      editId: 'media-123',
    })
    expect(parseEditId('options|bogus')).toEqual({
      kind: 'other',
      editId: 'options|bogus',
    })
    expect(parseEditId('narration|onlycue')).toEqual({
      kind: 'other',
      editId: 'narration|onlycue',
    })
  })
})
