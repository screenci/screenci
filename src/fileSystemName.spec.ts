import { describe, expect, it } from 'vitest'
import { escapeFileSystemPathSegment } from './fileSystemName.js'

describe('escapeFileSystemPathSegment', () => {
  it('preserves human-readable titles when no escaping is needed', () => {
    expect(escapeFileSystemPathSegment('My Video Title')).toBe('My Video Title')
  })

  it('escapes invalid path characters without changing punctuation style', () => {
    expect(escapeFileSystemPathSegment('My/Video:Title?')).toBe(
      'My%2FVideo%3ATitle%3F'
    )
  })

  it('escapes trailing dots and spaces', () => {
    expect(escapeFileSystemPathSegment('My Video. ')).toBe('My Video%2E%20')
  })

  it('does not collapse distinct raw titles to the same path', () => {
    expect(escapeFileSystemPathSegment('My Video')).not.toBe(
      escapeFileSystemPathSegment('My!Video')
    )
  })
})
