import { describe, it, expect } from 'vitest'

import {
  allEventsHaveEditIds,
  computeSourceHash,
  hashSourceFile,
  isRecordingFresh,
  readKeptRecordingData,
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
