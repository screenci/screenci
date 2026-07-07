import { describe, expect, it } from 'vitest'
import {
  buildSyncPrompt,
  compareWebStateToSnapshot,
  formatStatusReport,
} from './actionSync.js'
import type { ActionParamsSnapshot } from './actionParamsSnapshot.js'

const SELECTOR = "getByRole('button', { name: 'Save' })"

const SNAPSHOT: ActionParamsSnapshot = {
  version: 1,
  videos: {
    'My video': [
      {
        selector: SELECTOR,
        method: 'click',
        occurrence: 0,
        params: {
          'move.duration': { value: 400, source: 'explicit' },
          'move.easing': { value: 'ease-in-out', source: 'default' },
        },
      },
    ],
  },
}

function key(optionPath: string, occurrence = 0): string {
  return `${SELECTOR}|click|${occurrence}|${optionPath}`
}

describe('compareWebStateToSnapshot', () => {
  it('classifies change, remove, codify, in-sync, and stale', () => {
    const comparison = compareWebStateToSnapshot(SNAPSHOT, {
      'My video': {
        [key('move.duration')]: 250, // explicit 400 -> change
        [key('move.easing')]: 'linear', // default -> codify
        [key('move.duration', 1)]: 111, // unknown occurrence -> stale
      },
      'Other video': { [key('move.duration')]: 5 }, // video unknown -> stale
    })
    const my = comparison.videos.find((v) => v.videoName === 'My video')!
    expect(my.inSnapshot).toBe(true)
    expect(
      my.overrides.map((o) => [o.optionPath, o.occurrence, o.kind])
    ).toEqual([
      ['move.duration', 0, 'change'],
      ['move.easing', 0, 'codify'],
      ['move.duration', 1, 'stale'],
    ])
    const other = comparison.videos.find((v) => v.videoName === 'Other video')!
    expect(other.inSnapshot).toBe(false)
    expect(other.overrides[0]!.kind).toBe('stale')
  })

  it('classifies an override equal to the method default on an explicit value as remove', () => {
    const comparison = compareWebStateToSnapshot(SNAPSHOT, {
      'My video': { [key('move.duration')]: 900 },
    })
    const override = comparison.videos[0]!.overrides[0]!
    expect(override.kind).toBe('remove')
    expect(override.codeValue).toBe(400)
    expect(override.defaultValue).toBe(900)
  })

  it('classifies an override equal to the code value as in-sync', () => {
    const comparison = compareWebStateToSnapshot(SNAPSHOT, {
      'My video': { [key('move.duration')]: 400 },
    })
    expect(comparison.videos[0]!.overrides[0]!.kind).toBe('in-sync')
  })

  it('filters videos with a grep regex', () => {
    const comparison = compareWebStateToSnapshot(
      SNAPSHOT,
      {
        'My video': { [key('move.duration')]: 250 },
        'Other video': { [key('move.duration')]: 250 },
      },
      /^My/
    )
    expect(comparison.videos.map((v) => v.videoName)).toEqual(['My video'])
  })

  it('flags an empty snapshot', () => {
    const comparison = compareWebStateToSnapshot({ version: 1, videos: {} }, {})
    expect(comparison.snapshotEmpty).toBe(true)
  })
})

describe('formatStatusReport', () => {
  it('reports in-sync when there are no overrides', () => {
    const lines = formatStatusReport(compareWebStateToSnapshot(SNAPSHOT, {}))
    expect(lines).toEqual([
      'Editor overrides: none. Code and web editor are in sync.',
    ])
  })

  it('describes each override kind', () => {
    const lines = formatStatusReport(
      compareWebStateToSnapshot(SNAPSHOT, {
        'My video': {
          [key('move.duration')]: 250,
          [key('move.easing')]: 'linear',
          [key('move.duration', 1)]: 111,
        },
      })
    ).join('\n')
    expect(lines).toContain('Video: My video')
    expect(lines).toContain('override shadows explicit code value')
    expect(lines).toContain('override changes a defaulted value')
    expect(lines).toContain('stale override')
  })
})

describe('buildSyncPrompt', () => {
  it('returns null when nothing is actionable', () => {
    expect(
      buildSyncPrompt(compareWebStateToSnapshot(SNAPSHOT, {}), 'proj')
    ).toBeNull()
    expect(
      buildSyncPrompt(
        compareWebStateToSnapshot(SNAPSHOT, {
          'My video': { [key('move.duration')]: 400 },
        }),
        'proj'
      )
    ).toBeNull()
  })

  it('names the project and video once and emits change/remove/warning items', () => {
    const prompt = buildSyncPrompt(
      compareWebStateToSnapshot(SNAPSHOT, {
        'My video': {
          [key('move.duration')]: 250,
          [key('move.easing')]: 'linear',
          [key('move.duration', 1)]: 111,
        },
      }),
      'my-project'
    )!
    expect(prompt).toContain('"my-project"')
    expect(prompt.match(/## Video: My video/g)).toHaveLength(1)
    expect(prompt).toContain('CHANGE `move.duration` from 400 to 250')
    expect(prompt).toContain('set it explicitly to "linear"')
    expect(prompt).toContain('WARNING (stale)')
  })

  it('emits remove instructions with the default value', () => {
    const prompt = buildSyncPrompt(
      compareWebStateToSnapshot(SNAPSHOT, {
        'My video': { [key('move.duration')]: 900 },
      }),
      'my-project'
    )!
    expect(prompt).toContain('REMOVE the explicit `move.duration` option')
    expect(prompt).toContain('(currently 400)')
    expect(prompt).toContain('default (900)')
  })
})
