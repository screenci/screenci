import { describe, it, expectTypeOf } from 'vitest'
import type { Locator } from '@playwright/test'
import { redact } from './redact.js'
import type {
  RedactHandle,
  ScreenCILocatorFillOptions,
  ScreenCILocatorPressSequentiallyOptions,
} from './types.js'

declare const locator: Locator

describe('redact overloads', () => {
  it('returns a handle when called without a callback', () => {
    expectTypeOf(redact(locator)).toEqualTypeOf<Promise<RedactHandle>>()
    expectTypeOf(
      redact(locator, { style: { color: '#000', radius: 8 } })
    ).toEqualTypeOf<Promise<RedactHandle>>()
    expectTypeOf(
      redact(locator, { style: { css: 'background: red' } })
    ).toEqualTypeOf<Promise<RedactHandle>>()
  })

  it('returns void when called with a scoped callback', () => {
    expectTypeOf(redact(locator, async () => {})).toEqualTypeOf<Promise<void>>()
    expectTypeOf(
      redact(locator, () => {}, { style: { radius: 5 } })
    ).toEqualTypeOf<Promise<void>>()
  })
})

describe('per-action redact option', () => {
  it('accepts a boolean on fill', () => {
    expectTypeOf<{ redact: true }>().toMatchTypeOf<ScreenCILocatorFillOptions>()
  })

  it('accepts redact options on fill', () => {
    expectTypeOf<{
      redact: { style: { color: 'black' } }
    }>().toMatchTypeOf<ScreenCILocatorFillOptions>()
  })

  it('accepts redact on pressSequentially', () => {
    expectTypeOf<{
      redact: true
    }>().toMatchTypeOf<ScreenCILocatorPressSequentiallyOptions>()
  })
})
