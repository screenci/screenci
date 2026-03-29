import { describe, it, expect } from 'vitest'
import { sanitizeVideoName } from './sanitize.js'

describe('sanitizeVideoName', () => {
  it('should convert uppercase to lowercase', () => {
    expect(sanitizeVideoName('Hello World')).toBe('hello-world')
  })

  it('should replace spaces with hyphens', () => {
    expect(sanitizeVideoName('my video title')).toBe('my-video-title')
  })

  it('should replace special characters with hyphens', () => {
    expect(sanitizeVideoName('my@video#title')).toBe('my-video-title')
  })

  it('should replace multiple consecutive special characters with single hyphen', () => {
    expect(sanitizeVideoName('my!!!video???title')).toBe('my-video-title')
  })

  it('should remove leading hyphens', () => {
    expect(sanitizeVideoName('---my-video')).toBe('my-video')
  })

  it('should remove trailing hyphens', () => {
    expect(sanitizeVideoName('my-video---')).toBe('my-video')
  })

  it('should remove both leading and trailing hyphens', () => {
    expect(sanitizeVideoName('---my-video---')).toBe('my-video')
  })

  it('should handle already valid kebab-case input', () => {
    expect(sanitizeVideoName('my-video-title')).toBe('my-video-title')
  })

  it('should preserve numbers', () => {
    expect(sanitizeVideoName('video 123 test')).toBe('video-123-test')
  })

  it('should handle mixed alphanumeric and special characters', () => {
    expect(sanitizeVideoName('Test_123@Video#2024')).toBe('test-123-video-2024')
  })

  it('should handle empty string', () => {
    expect(sanitizeVideoName('')).toBe('')
  })

  it('should handle string with only special characters', () => {
    expect(sanitizeVideoName('!@#$%^&*()')).toBe('')
  })

  it('should handle dots, slashes, and other file-unsafe characters', () => {
    expect(sanitizeVideoName('my/video\\title.mp4')).toBe('my-video-title-mp4')
  })

  it('should preserve existing hyphens in the middle', () => {
    expect(sanitizeVideoName('my-existing-video-name')).toBe(
      'my-existing-video-name'
    )
  })

  it('should handle complex real-world example', () => {
    expect(
      sanitizeVideoName('User Login & Authentication (Part 1) - Tutorial!')
    ).toBe('user-login-authentication-part-1-tutorial')
  })
})
