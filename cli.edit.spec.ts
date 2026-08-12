import { describe, expect, it } from 'vitest'
import { resolveSingleEditVideo } from './cli'

const suggest = (name: string) => `screenci edit "${name}"`

describe('resolveSingleEditVideo', () => {
  it('resolves the only video of a project without a pattern', () => {
    expect(resolveSingleEditVideo(['Login'], undefined, suggest)).toEqual({
      ok: true,
      videoName: 'Login',
    })
  })

  it('resolves a pattern matching exactly one video', () => {
    const result = resolveSingleEditVideo(['Login', 'Signup'], 'Sign', suggest)
    expect(result).toEqual({ ok: true, videoName: 'Signup' })
  })

  it('errors with the available titles when nothing matches', () => {
    const result = resolveSingleEditVideo(['Login', 'Signup'], 'Nope', suggest)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('No video matches "Nope"')
      expect(result.message).toContain('- Login')
      expect(result.message).toContain('- Signup')
    }
  })

  it('errors listing the matches when the pattern matches several videos', () => {
    const result = resolveSingleEditVideo(
      ['Login flow', 'Login error', 'Signup'],
      'Login',
      suggest
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('one video at a time')
      expect(result.message).toContain('- Login flow')
      expect(result.message).toContain('- Login error')
      expect(result.message).not.toContain('- Signup')
      expect(result.message).toContain('screenci edit "Login flow"')
    }
  })

  it('errors asking to pick when the project has several videos and no pattern', () => {
    const result = resolveSingleEditVideo(['A', 'B'], undefined, suggest)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('one video at a time')
      expect(result.message).toContain('screenci edit "A"')
    }
  })

  it('errors when the project has no videos at all', () => {
    const result = resolveSingleEditVideo([], 'Login', suggest)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('No videos found')
    }
  })
})
