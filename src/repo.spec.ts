import { describe, expect, it } from 'vitest'
import { normalizeGitUrl, sameRepository } from './repo.js'

describe('normalizeGitUrl', () => {
  it.each([
    ['https://github.com/Acme/App.git', 'github.com/acme/app'],
    ['https://github.com/acme/app/', 'github.com/acme/app'],
    [
      'http://user@gitlab.example.com:8443/team/app.git',
      'gitlab.example.com/team/app',
    ],
    ['git@github.com:acme/app.git', 'github.com/acme/app'],
    ['git@github.com:acme/app', 'github.com/acme/app'],
    ['ssh://git@github.com/acme/app.git', 'github.com/acme/app'],
    ['ssh://git@github.com:22/acme/app.git', 'github.com/acme/app'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeGitUrl(input)).toBe(expected)
  })

  it('returns null for junk', () => {
    expect(normalizeGitUrl('')).toBeNull()
    expect(normalizeGitUrl('not a url')).toBeNull()
    expect(normalizeGitUrl('https://github.com/')).toBeNull()
  })
})

describe('sameRepository', () => {
  it('matches across schemes and case', () => {
    expect(
      sameRepository(
        'git@github.com:Acme/App.git',
        'https://github.com/acme/app'
      )
    ).toBe(true)
    expect(
      sameRepository(
        'https://github.com/acme/app',
        'https://github.com/acme/other'
      )
    ).toBe(false)
    expect(sameRepository('junk', 'junk')).toBe(false)
  })
})
