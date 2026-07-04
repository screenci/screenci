import { describe, it, expect, vi, afterEach } from 'vitest'
import { logMissingAsset } from './missingAssetLog.js'
import { logger } from './logger.js'

describe('logMissingAsset', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  function clearCIEnv(): void {
    delete process.env.CI
    delete process.env.CONTINUOUS_INTEGRATION
    delete process.env.GITHUB_ACTIONS
    delete process.env.GITLAB_CI
    delete process.env.BUILDKITE
    delete process.env.CIRCLECI
  }

  it('logs at info level, not warn', () => {
    clearCIEnv()
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    logMissingAsset('overlay', './logo.png')

    expect(warnSpy).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledWith(
      'Locally missing overlay: ./logo.png. It will be reused from a previous upload of this video if available, otherwise the upload fails.'
    )
  })

  it('notes that the file is expectedly uncommitted when running on CI', () => {
    clearCIEnv()
    process.env.CI = 'true'
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})

    logMissingAsset('narration media', './voice.mov')

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Not committed to CI, as expected.')
    )
  })
})
