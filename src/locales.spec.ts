import { describe, it, expect } from 'vitest'
import {
  resolveLocaleForLanguage,
  DEFAULT_LANGUAGE_LOCALES,
} from './locales.js'

describe('resolveLocaleForLanguage', () => {
  it('maps common languages to their default locale', () => {
    expect(resolveLocaleForLanguage('en')).toBe('en-US')
    expect(resolveLocaleForLanguage('fi')).toBe('fi-FI')
    expect(resolveLocaleForLanguage('de')).toBe('de-DE')
  })

  it('prefers an explicit override over the default', () => {
    expect(resolveLocaleForLanguage('en', { en: 'en-GB' })).toBe('en-GB')
    expect(resolveLocaleForLanguage('fi', { fi: 'fi-FI', en: 'en-GB' })).toBe(
      'fi-FI'
    )
  })

  it('falls back to the bare language code when no mapping exists', () => {
    // `la` (Latin) has no default region mapping.
    expect(DEFAULT_LANGUAGE_LOCALES.la).toBeUndefined()
    expect(resolveLocaleForLanguage('la')).toBe('la')
  })

  it('ignores overrides for other languages', () => {
    expect(resolveLocaleForLanguage('de', { fi: 'fi-FI' })).toBe('de-DE')
  })
})
