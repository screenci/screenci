import { describe, it, expect } from 'vitest'

import {
  allEventsHaveEditIds,
  computeSourceHash,
  hashSourceFile,
  isRecordingFresh,
  readKeptRecordingData,
  rebaselineKeptSourceHashes,
  LAST_DATA_FILE,
} from './recordingFreshness.js'
import type { RecordingData } from './recordingData.js'

function makeData(overrides: Partial<RecordingData> = {}): RecordingData {
  return {
    events: [],
    renderOptions: {} as RecordingData['renderOptions'],
    metadata: {
      videoName: 'Demo',
      screenciVersion: '0.0.0',
      sourceHash: 'hash-a',
    },
    ...overrides,
  }
}

function editableEvent(editId: string | undefined): unknown {
  return {
    type: 'sleep',
    timeMs: 0,
    durationMs: 10,
    reason: 'delay',
    editable: {
      descriptor: { kind: 'delay', ordinal: 0, seq: 0, editId },
      locked: false,
      schemaKind: 'delay',
      defaults: { durationMs: 10 },
    },
  }
}

describe('computeSourceHash', () => {
  it('is a stable sha256 hex digest of the content', () => {
    const a = computeSourceHash('content')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(computeSourceHash('content')).toBe(a)
    expect(computeSourceHash('other')).not.toBe(a)
  })
})

describe('hashSourceFile', () => {
  it('hashes the file content via the injected reader', async () => {
    const hash = await hashSourceFile('/x/test.screenci.ts', async () =>
      Buffer.from('abc')
    )
    expect(hash).toBe(computeSourceHash('abc'))
  })

  it('resolves undefined when the file cannot be read', async () => {
    const hash = await hashSourceFile('/missing.ts', async () => {
      throw new Error('ENOENT')
    })
    expect(hash).toBeUndefined()
  })
})

describe('allEventsHaveEditIds', () => {
  it('true for events without editable metadata', () => {
    const data = makeData({
      events: [
        { type: 'sleep', timeMs: 0, durationMs: 1, reason: 'delay' },
      ] as RecordingData['events'],
    })
    expect(allEventsHaveEditIds(data)).toBe(true)
  })

  it('false when an editable event lacks an editId', () => {
    const data = makeData({
      events: [editableEvent(undefined)] as RecordingData['events'],
    })
    expect(allEventsHaveEditIds(data)).toBe(false)
  })

  it('false when an action param record lacks an editId', () => {
    const data = makeData({
      events: [editableEvent('delay1')] as RecordingData['events'],
      actionParams: [
        {
          selector: 'locator(form)',
          method: 'click',
          occurrence: 0,
          params: {},
        },
      ],
    })
    expect(allEventsHaveEditIds(data)).toBe(false)
  })

  it('true when all editables and action params carry editIds', () => {
    const data = makeData({
      events: [editableEvent('delay1')] as RecordingData['events'],
      actionParams: [
        {
          selector: 'locator(form)',
          method: 'click',
          occurrence: 0,
          editId: 'click1',
          params: {},
        },
      ],
    })
    expect(allEventsHaveEditIds(data)).toBe(true)
  })
})

describe('isRecordingFresh', () => {
  it('fresh when hashes match and all editIds are present', () => {
    const data = makeData({
      events: [editableEvent('delay1')] as RecordingData['events'],
    })
    expect(isRecordingFresh(data, 'hash-a')).toBe(true)
  })

  it('stale on hash mismatch', () => {
    expect(isRecordingFresh(makeData(), 'hash-b')).toBe(false)
  })

  it('stale when either hash is missing', () => {
    expect(isRecordingFresh(makeData(), undefined)).toBe(false)
    const noHash = makeData({
      metadata: { videoName: 'Demo', screenciVersion: '0.0.0' },
    })
    expect(isRecordingFresh(noHash, 'hash-a')).toBe(false)
  })

  it('stale when an editId is missing even with matching hash', () => {
    const data = makeData({
      events: [editableEvent(undefined)] as RecordingData['events'],
    })
    expect(isRecordingFresh(data, 'hash-a')).toBe(false)
  })
})

describe('readKeptRecordingData', () => {
  it('prefers data.json over last-data.json', async () => {
    const files: Record<string, string> = {
      '/rec/data.json': JSON.stringify(makeData()),
      [`/rec/${LAST_DATA_FILE}`]: JSON.stringify(
        makeData({
          metadata: {
            videoName: 'Old',
            screenciVersion: '0.0.0',
          },
        })
      ),
    }
    const data = await readKeptRecordingData('/rec', async (p) => {
      const content = files[p]
      if (content === undefined) throw new Error('ENOENT')
      return Buffer.from(content)
    })
    expect(data?.metadata?.videoName).toBe('Demo')
  })

  it('falls back to last-data.json', async () => {
    const files: Record<string, string> = {
      [`/rec/${LAST_DATA_FILE}`]: JSON.stringify(makeData()),
    }
    const data = await readKeptRecordingData('/rec', async (p) => {
      const content = files[p]
      if (content === undefined) throw new Error('ENOENT')
      return Buffer.from(content)
    })
    expect(data?.metadata?.videoName).toBe('Demo')
  })

  it('resolves null when neither file exists', async () => {
    const data = await readKeptRecordingData('/rec', async () => {
      throw new Error('ENOENT')
    })
    expect(data).toBeNull()
  })
})

describe('rebaselineKeptSourceHashes', () => {
  function makeFiles(initial: Record<string, string>): {
    files: Record<string, string>
    readFileFn: (path: string) => Promise<Buffer>
    writeFileFn: (path: string, content: string) => Promise<void>
    written: string[]
  } {
    const files = { ...initial }
    const written: string[] = []
    return {
      files,
      written,
      readFileFn: async (path) => {
        const content = files[path]
        if (content === undefined) throw new Error('ENOENT')
        return Buffer.from(content)
      },
      writeFileFn: async (path, content) => {
        files[path] = content
        written.push(path)
      },
    }
  }

  function dataFor(videoName: string, sourceFilePath: string): string {
    return JSON.stringify(
      makeData({
        metadata: {
          videoName,
          screenciVersion: '0.0.0',
          sourceHash: 'stale-hash',
          sourceFilePath,
        },
      })
    )
  }

  it('rewrites the stored hash of recordings whose source was rewritten', async () => {
    const io = makeFiles({
      '/s/.screenci/rec-a/data.json': dataFor('Login', '/p/login.screenci.ts'),
      '/p/login.screenci.ts': 'new source',
    })
    const names = await rebaselineKeptSourceHashes(
      {
        screenciDir: '/s/.screenci',
        changedSourcePaths: ['/p/login.screenci.ts'],
      },
      {
        listRecordingDirs: () => ['/s/.screenci/rec-a'],
        readFileFn: io.readFileFn,
        writeFileFn: io.writeFileFn,
      }
    )
    expect(names).toEqual(['Login'])
    const updated = JSON.parse(
      io.files['/s/.screenci/rec-a/data.json']!
    ) as RecordingData
    expect(updated.metadata?.sourceHash).toBe(computeSourceHash('new source'))
    expect(isRecordingFresh(updated, computeSourceHash('new source'))).toBe(
      true
    )
  })

  it('re-baselines every recording sharing the rewritten source file', async () => {
    // A multi-video source file plus a per-language sibling directory.
    const io = makeFiles({
      '/s/.screenci/rec-a/data.json': dataFor('Login', '/p/flows.screenci.ts'),
      '/s/.screenci/rec-b/data.json': dataFor('Signup', '/p/flows.screenci.ts'),
      [`/s/.screenci/rec-a-fi/${LAST_DATA_FILE}`]: dataFor(
        'Login',
        '/p/flows.screenci.ts'
      ),
      '/s/.screenci/rec-c/data.json': dataFor('Other', '/p/other.screenci.ts'),
      '/p/flows.screenci.ts': 'v2',
    })
    const names = await rebaselineKeptSourceHashes(
      {
        screenciDir: '/s/.screenci',
        changedSourcePaths: ['/p/flows.screenci.ts'],
      },
      {
        listRecordingDirs: () => [
          '/s/.screenci/rec-a',
          '/s/.screenci/rec-b',
          '/s/.screenci/rec-a-fi',
          '/s/.screenci/rec-c',
        ],
        readFileFn: io.readFileFn,
        writeFileFn: io.writeFileFn,
      }
    )
    expect(names).toEqual(['Login', 'Signup'])
    // The per-language dir's last-data.json was rewritten in place.
    expect(io.written).toContain(`/s/.screenci/rec-a-fi/${LAST_DATA_FILE}`)
    // The unrelated recording was left alone.
    expect(io.written).not.toContain('/s/.screenci/rec-c/data.json')
    const updatedFi = JSON.parse(
      io.files[`/s/.screenci/rec-a-fi/${LAST_DATA_FILE}`]!
    ) as RecordingData
    expect(updatedFi.metadata?.sourceHash).toBe(computeSourceHash('v2'))
  })

  it('skips unreadable data and never throws on a write failure', async () => {
    const io = makeFiles({
      '/s/.screenci/broken/data.json': 'not json',
      '/s/.screenci/rec-a/data.json': dataFor('Login', '/p/login.screenci.ts'),
      '/p/login.screenci.ts': 'v2',
    })
    const names = await rebaselineKeptSourceHashes(
      {
        screenciDir: '/s/.screenci',
        changedSourcePaths: ['/p/login.screenci.ts'],
      },
      {
        listRecordingDirs: () => ['/s/.screenci/broken', '/s/.screenci/rec-a'],
        readFileFn: io.readFileFn,
        writeFileFn: async () => {
          throw new Error('EACCES')
        },
      }
    )
    expect(names).toEqual([])
  })

  it('does not touch recordings whose source cannot be hashed', async () => {
    const io = makeFiles({
      '/s/.screenci/rec-a/data.json': dataFor('Login', '/p/gone.screenci.ts'),
    })
    const names = await rebaselineKeptSourceHashes(
      {
        screenciDir: '/s/.screenci',
        changedSourcePaths: ['/p/gone.screenci.ts'],
      },
      {
        listRecordingDirs: () => ['/s/.screenci/rec-a'],
        readFileFn: io.readFileFn,
        writeFileFn: io.writeFileFn,
      }
    )
    expect(names).toEqual([])
    expect(io.written).toEqual([])
  })
})
