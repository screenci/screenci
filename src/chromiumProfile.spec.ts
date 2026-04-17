import { access, readFile } from 'fs/promises'
import { constants } from 'fs'
import { describe, expect, it } from 'vitest'
import { createRecordingChromiumProfile } from './chromiumProfile.js'

describe('createRecordingChromiumProfile', () => {
  it('writes chromium prefs that disable translate', async () => {
    const profile = await createRecordingChromiumProfile()

    try {
      const prefsPath = `${profile.userDataDir}/Default/Preferences`
      const prefs = JSON.parse(await readFile(prefsPath, 'utf8')) as {
        translate?: { enabled?: boolean }
      }

      expect(prefs.translate?.enabled).toBe(false)
    } finally {
      await profile.cleanup()
    }

    await expect(access(profile.userDataDir, constants.F_OK)).rejects.toThrow()
  })
})
