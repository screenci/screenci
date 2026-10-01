import { describe, expect, it } from 'vitest'
import { getOrCreateMachineId, type MachineIdFs } from './machineId.js'

function memoryFs(files: Record<string, string> = {}): MachineIdFs & {
  files: Record<string, string>
} {
  return {
    files,
    readFile: (path) => {
      const content = files[path]
      if (content === undefined) throw new Error('ENOENT')
      return content
    },
    writeFile: (path, content) => {
      files[path] = content
    },
    mkdir: () => {},
  }
}

describe('getOrCreateMachineId', () => {
  it('mints and persists a random id, then reuses it', () => {
    const fs = memoryFs()
    const first = getOrCreateMachineId({
      fs,
      homeDir: '/home/u',
      newId: () => '11111111-2222-3333-4444-555555555555',
    })
    expect(first).toBe('11111111-2222-3333-4444-555555555555')
    expect(fs.files['/home/u/.screenci/machine-id']).toBe(`${first}\n`)
    const second = getOrCreateMachineId({
      fs,
      homeDir: '/home/u',
      newId: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    })
    expect(second).toBe(first)
  })

  it('replaces a malformed file instead of sending its contents', () => {
    const fs = memoryFs({ '/h/.screenci/machine-id': 'pop-os\n' })
    const id = getOrCreateMachineId({
      fs,
      homeDir: '/h',
      newId: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    })
    expect(id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })

  it('still returns an id when the home dir is read-only', () => {
    const id = getOrCreateMachineId({
      fs: {
        readFile: () => {
          throw new Error('ENOENT')
        },
        writeFile: () => {
          throw new Error('EROFS')
        },
        mkdir: () => {},
      },
      homeDir: '/ro',
      newId: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    })
    expect(id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })
})
