import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ACTION_PARAMS_SNAPSHOT_FILE,
  collectActionParamsFromRecordings,
  diffOverridesAgainstSnapshot,
  mergeActionParamsSnapshot,
  readActionParamsSnapshot,
  updateActionParamsSnapshot,
  writeActionParamsSnapshot,
  type ActionParamsSnapshot,
} from './actionParamsSnapshot.js'
import type { ActionParamRecord } from './actionParams.js'

const CLICK_RECORD: ActionParamRecord = {
  selector: "getByRole('button', { name: 'Save' })",
  method: 'click',
  occurrence: 0,
  params: {
    'move.duration': { value: 400, source: 'explicit' },
    'move.easing': { value: 'ease-in-out', source: 'default' },
  },
}

describe('actionParamsSnapshot', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'screenci-action-params-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips a snapshot through write and read', () => {
    const snapshot: ActionParamsSnapshot = {
      version: 1,
      videos: { 'My video': [CLICK_RECORD] },
    }
    writeActionParamsSnapshot(dir, snapshot)
    expect(readActionParamsSnapshot(dir)).toEqual(snapshot)
  })

  it('returns an empty snapshot for a missing or corrupt file', () => {
    expect(readActionParamsSnapshot(dir)).toEqual({ version: 1, videos: {} })
    writeFileSync(join(dir, ACTION_PARAMS_SNAPSHOT_FILE), 'not json')
    expect(readActionParamsSnapshot(dir)).toEqual({ version: 1, videos: {} })
  })

  it('collects actionParams from per-recording data.json files', () => {
    mkdirSync(join(dir, 'My-video'))
    writeFileSync(
      join(dir, 'My-video', 'data.json'),
      JSON.stringify({
        metadata: { videoName: 'My video' },
        actionParams: [CLICK_RECORD],
      })
    )
    mkdirSync(join(dir, 'broken'))
    writeFileSync(join(dir, 'broken', 'data.json'), 'not json')
    writeFileSync(join(dir, 'stray.json'), '{}')

    expect(collectActionParamsFromRecordings(dir)).toEqual({
      'My video': [CLICK_RECORD],
    })
  })

  it('merge preserves videos not recorded this run', () => {
    const existing: ActionParamsSnapshot = {
      version: 1,
      videos: { Old: [CLICK_RECORD] },
    }
    expect(
      mergeActionParamsSnapshot(existing, { New: [CLICK_RECORD] })
    ).toEqual({
      version: 1,
      videos: { Old: [CLICK_RECORD], New: [CLICK_RECORD] },
    })
  })

  it('updateActionParamsSnapshot aggregates recordings into the snapshot file', () => {
    mkdirSync(join(dir, 'My-video'))
    writeFileSync(
      join(dir, 'My-video', 'data.json'),
      JSON.stringify({
        metadata: { videoName: 'My video' },
        actionParams: [CLICK_RECORD],
      })
    )
    updateActionParamsSnapshot(dir)
    expect(existsSync(join(dir, ACTION_PARAMS_SNAPSHOT_FILE))).toBe(true)
    expect(readActionParamsSnapshot(dir).videos['My video']).toEqual([
      CLICK_RECORD,
    ])
  })

  it('updateActionParamsSnapshot writes nothing when no recordings exist', () => {
    updateActionParamsSnapshot(dir)
    expect(existsSync(join(dir, ACTION_PARAMS_SNAPSHOT_FILE))).toBe(false)
  })
})

describe('diffOverridesAgainstSnapshot', () => {
  const snapshot: ActionParamsSnapshot = {
    version: 1,
    videos: { 'My video': [CLICK_RECORD] },
  }
  const selector = CLICK_RECORD.selector

  it('reports overrides shadowing explicit code values', () => {
    const collisions = diffOverridesAgainstSnapshot(snapshot, {
      'My video': { [`${selector}|click|0|move.duration`]: 250 },
    })
    expect(collisions).toEqual([
      {
        videoName: 'My video',
        selector,
        method: 'click',
        occurrence: 0,
        optionPath: 'move.duration',
        codeValue: 400,
        editorValue: 250,
      },
    ])
  })

  it('ignores overrides of defaulted params, unknown keys, and unknown videos', () => {
    expect(
      diffOverridesAgainstSnapshot(snapshot, {
        'My video': {
          [`${selector}|click|0|move.easing`]: 'linear',
          [`${selector}|click|1|move.duration`]: 250,
          [`${selector}|hover|0|move.duration`]: 250,
          malformed: 1,
        },
        'Other video': { [`${selector}|click|0|move.duration`]: 250 },
      })
    ).toEqual([])
  })

  it('parses selectors that themselves contain pipes', () => {
    const pipedSelector = "getByText('a|b')"
    const piped: ActionParamsSnapshot = {
      version: 1,
      videos: {
        V: [
          {
            selector: pipedSelector,
            method: 'click',
            occurrence: 0,
            params: { timeout: { value: 5, source: 'explicit' } },
          },
        ],
      },
    }
    expect(
      diffOverridesAgainstSnapshot(piped, {
        V: { [`${pipedSelector}|click|0|timeout`]: 9 },
      })
    ).toHaveLength(1)
  })
})
