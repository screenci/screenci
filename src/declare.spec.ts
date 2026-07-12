import { describe, it, expect } from 'vitest'
import { normalizeFeature, isLanguageKey } from './declare.js'

describe('isLanguageKey', () => {
  it('treats supported language codes and "default" as language keys', () => {
    expect(isLanguageKey('fr')).toBe(true)
    expect(isLanguageKey('fi')).toBe(true)
    expect(isLanguageKey('default')).toBe(true)
  })

  it('treats content names as non-language keys', () => {
    expect(isLanguageKey('intro')).toBe(false)
    expect(isLanguageKey('cta')).toBe(false)
  })
})

describe('normalizeFeature', () => {
  it('array declares blank editor-owned names', () => {
    const n = normalizeFeature<string>('narration', ['intro', 'cta'])
    expect(n.studioNames).toEqual(['intro', 'cta'])
    expect(n.codeNames).toEqual([])
    expect(n.names).toEqual(['intro', 'cta'])
    expect(n.shared).toEqual({})
    expect(n.byLang).toEqual({})
    expect(n.languages).toEqual([])
  })

  it('object seed declares code-owned values (web may override)', () => {
    const n = normalizeFeature<string>('narration', {
      intro: 'Hi',
      cta: 'Buy',
    })
    // Code supplies the values; every declaration is editable in the web app.
    expect(n.studioNames).toEqual([])
    expect(n.codeNames).toEqual(['intro', 'cta'])
    expect(n.names).toEqual(['intro', 'cta'])
    expect(n.shared).toEqual({ intro: 'Hi', cta: 'Buy' })
    expect(n.byLang).toEqual({})
  })

  it('language-major seed keeps per-language code values', () => {
    const n = normalizeFeature<string>('narration', {
      en: { intro: 'Hi' },
      fi: { intro: 'Moi' },
    })
    expect(n.codeNames).toEqual(['intro'])
    expect(n.studioNames).toEqual([])
    expect(n.byLang).toEqual({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } })
  })

  it('rejects duplicate names in the array form', () => {
    expect(() => normalizeFeature('narration', ['a', 'a'])).toThrow(/Duplicate/)
  })

  it('accepts a single-name bare array (editor-owned)', () => {
    const n = normalizeFeature<string>('narration', ['intro'])
    expect(n.studioNames).toEqual(['intro'])
    expect(n.codeNames).toEqual([])
    expect(n.shared).toEqual({})
  })

  it('treats an empty array as an empty editor-owned declaration', () => {
    const n = normalizeFeature<string>('narration', [])
    expect(n.names).toEqual([])
    expect(n.studioNames).toEqual([])
    expect(n.codeNames).toEqual([])
  })

  it('content-major object declares shared code values', () => {
    const n = normalizeFeature<string>('narration', { intro: 'Hi', cta: 'Buy' })
    expect(n.codeNames).toEqual(['intro', 'cta'])
    expect(n.shared).toEqual({ intro: 'Hi', cta: 'Buy' })
    expect(n.byLang).toEqual({})
    expect(n.languages).toEqual([])
    expect(n.studioNames).toEqual([])
  })

  it('language-major object declares per-language values', () => {
    const n = normalizeFeature<string>('narration', {
      fr: { intro: 'Salut' },
      fi: { intro: 'Moi' },
    })
    expect(n.shared).toEqual({})
    expect(n.byLang).toEqual({ fr: { intro: 'Salut' }, fi: { intro: 'Moi' } })
    expect(n.languages.sort()).toEqual(['fi', 'fr'])
    expect(n.codeNames).toEqual(['intro'])
  })

  it('language-major with `default` uses default as the shared fallback', () => {
    const n = normalizeFeature<string>('narration', {
      default: { intro: 'Hi', cta: 'Buy' },
      fr: { intro: 'Salut' },
    })
    expect(n.shared).toEqual({ intro: 'Hi', cta: 'Buy' })
    expect(n.byLang).toEqual({ fr: { intro: 'Salut' } })
    expect(n.languages).toEqual(['fr'])
    // names: shared first, then any override-only names (none here)
    expect(n.codeNames).toEqual(['intro', 'cta'])
  })

  it('forbidLanguageMajor rejects a language-major object (overlays)', () => {
    expect(() =>
      normalizeFeature<string>(
        'overlays',
        { en: { badge: 'a' }, fi: { badge: 'b' } },
        { forbidLanguageMajor: true }
      )
    ).toThrow(/no longer accepts the language-major form/)
  })

  it('forbidLanguageMajor still allows the content-major and array forms', () => {
    const content = normalizeFeature<string>(
      'overlays',
      { badge: 'a' },
      { forbidLanguageMajor: true }
    )
    expect(content.shared).toEqual({ badge: 'a' })
    const names = normalizeFeature<string>('overlays', ['badge'], {
      forbidLanguageMajor: true,
    })
    expect(names.studioNames).toEqual(['badge'])
  })

  it('collects override-only names after shared names', () => {
    const n = normalizeFeature<string>('text', {
      default: { a: 'A' },
      fr: { a: 'Afr', b: 'Bfr' },
    })
    expect(n.codeNames).toEqual(['a', 'b'])
  })

  it('rejects a content name that collides with a language code', () => {
    // `fr` as a content value would be read as the French language, so it is
    // rejected in the content-major form.
    expect(() =>
      normalizeFeature<string>('text', { fr: 'France', heading: 'H' })
    ).toThrow(/collides with a language code/)
  })

  it('rejects a content name equal to "default"', () => {
    // `{ default, heading }` is content-major (heading is not a language key), so
    // the reserved `default` key collides.
    expect(() =>
      normalizeFeature<string>('text', { default: 'x', heading: 'H' } as never)
    ).toThrow(/collides with a language code/)
  })

  it('treats an empty object as an empty content-major declaration', () => {
    const n = normalizeFeature<string>('narration', {})
    expect(n.names).toEqual([])
    expect(n.codeNames).toEqual([])
  })
})
