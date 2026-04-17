import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

export type RecordingChromiumProfile = {
  userDataDir: string
  cleanup: () => Promise<void>
}

export async function createRecordingChromiumProfile(): Promise<RecordingChromiumProfile> {
  const userDataDir = await mkdtemp(
    join(tmpdir(), 'screenci-chromium-profile-')
  )
  const defaultProfileDir = join(userDataDir, 'Default')

  await mkdir(defaultProfileDir, { recursive: true })

  await writeFile(
    join(defaultProfileDir, 'Preferences'),
    JSON.stringify(
      {
        translate: {
          enabled: false,
        },
      },
      null,
      2
    )
  )

  return {
    userDataDir,
    cleanup: async () => {
      await rm(userDataDir, { recursive: true, force: true })
    },
  }
}
