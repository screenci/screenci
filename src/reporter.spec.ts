import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FullConfig, Suite, TestCase } from '@playwright/test/reporter'
import VideoNameValidator from './reporter.js'
import { logger } from './logger.js'

// Helper to create a mock test
function createMockTest(title: string): TestCase {
  return {
    title,
    id: `test-${title}`,
    titlePath: () => [title],
  } as TestCase
}

// Helper to create a mock suite with tests
function createMockSuite(tests: string[]): Suite {
  return {
    tests: tests.map(createMockTest),
    suites: [],
  } as Suite
}

// Helper to create a mock suite with nested suites
function createNestedMockSuite(tests: string[], childSuites: Suite[]): Suite {
  return {
    tests: tests.map(createMockTest),
    suites: childSuites,
  } as Suite
}

describe('VideoNameValidator Reporter', () => {
  let reporter: VideoNameValidator
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    reporter = new VideoNameValidator()
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: number): never => {
        throw new Error(`process.exit called with code ${code}`)
      })
  })

  afterEach(() => {
    loggerErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })

  it('should not error when all video names are unique', () => {
    const suite = createMockSuite(['video one', 'video two', 'video three'])

    expect(() => {
      reporter.onBegin({} as FullConfig, suite)
    }).not.toThrow()

    expect(loggerErrorSpy).not.toHaveBeenCalled()
    expect(processExitSpy).not.toHaveBeenCalled()
  })

  it('should detect duplicate sanitized names', () => {
    const suite = createMockSuite([
      'My Video',
      'My!Video', // Sanitizes to same name (my-video)
    ])

    expect(() => {
      reporter.onBegin({} as FullConfig, suite)
    }).toThrow('process.exit called with code 1')

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate video names detected')
    )
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('my-video')
    )
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  it('should detect multiple sets of duplicates', () => {
    const suite = createMockSuite([
      'Test One',
      'Test!One', // Duplicates with Test One → test-one
      'Another Test',
      'Another@Test', // Duplicates with Another Test → another-test
    ])

    expect(() => {
      reporter.onBegin({} as FullConfig, suite)
    }).toThrow('process.exit called with code 1')

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('test-one')
    )
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('another-test')
    )
  })

  it('should handle special characters in sanitization', () => {
    const suite = createMockSuite([
      'test!@#$',
      'test____', // Same after sanitization
    ])

    expect(() => {
      reporter.onBegin({} as FullConfig, suite)
    }).toThrow('process.exit called with code 1')

    expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('test'))
  })

  it('should handle nested suites', () => {
    const childSuite = createMockSuite(['nested video', 'nested!video'])
    const parentSuite = createNestedMockSuite(['parent video'], [childSuite])

    expect(() => {
      reporter.onBegin({} as FullConfig, parentSuite)
    }).toThrow('process.exit called with code 1')

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('nested-video')
    )
  })

  it('should handle three or more duplicates', () => {
    const suite = createMockSuite([
      'my test',
      'my-test',
      'MY TEST!',
      'my___test',
    ])

    expect(() => {
      reporter.onBegin({} as FullConfig, suite)
    }).toThrow('process.exit called with code 1')

    // Should show all conflicting titles - check for the sanitized name (kebab-case)
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('my-test')
    )
    // And some of the original titles
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('my test')
    )
  })

  it('should handle empty suite', () => {
    const suite = createMockSuite([])

    expect(() => {
      reporter.onBegin({} as FullConfig, suite)
    }).not.toThrow()

    expect(loggerErrorSpy).not.toHaveBeenCalled()
    expect(processExitSpy).not.toHaveBeenCalled()
  })

  it('should not error when names are different after kebab-case', () => {
    const suite = createMockSuite([
      'video-one',
      'video-two',
      'video three', // Becomes "video-three" - different from "video-one"
    ])

    expect(() => {
      reporter.onBegin({} as FullConfig, suite)
    }).not.toThrow()
  })

  it('should preserve valid characters in sanitization', () => {
    const suite = createMockSuite([
      'valid-test_name123',
      'another-valid_test456',
    ])

    expect(() => {
      reporter.onBegin({} as FullConfig, suite)
    }).not.toThrow()

    expect(loggerErrorSpy).not.toHaveBeenCalled()
  })
})
