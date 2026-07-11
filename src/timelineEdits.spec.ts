import { describe, expect, it } from 'vitest'

import { cueIdFor, overlayDeclIdFor, overlayIdFor } from './timelineEdits.js'

describe('cueIdFor / overlayIdFor', () => {
  it('produces stable name-ordinal ids', () => {
    expect(cueIdFor('welcome', 0)).toBe('cue||welcome|0')
    expect(overlayIdFor('logo', 2)).toBe('overlay||logo|2')
    expect(overlayDeclIdFor('logo')).toBe('overlaydecl-logo')
  })
})
