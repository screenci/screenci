import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  collectEditableFromRecordings,
  splitTimelineEditsByVideo,
} from './editableSnapshot.js'

describe('splitTimelineEditsByVideo', () => {
  it('splits docs into param-edit entries and codify records', () => {
    const { overrides, codify, renames } = splitTimelineEditsByVideo({
      demo: {
        version: 3,
        edits: [
          {
            type: 'paramEdit',
            id: 'p1',
            target: { key: 'delay|||0' },
            fields: { durationMs: 100 },
          },
          {
            type: 'mediaEdit',
            id: 'e1',
            kind: 'narrationCue',
            afterEditId: 'click1',
            blocking: true,
            props: { name: 'intro' },
          },
          {
            type: 'zoomEdit',
            id: 'e2',
            fromEditId: 'a',
            untilEditId: 'b',
            disabled: true,
          },
          {
            type: 'renameEdit',
            id: 'r1',
            target: { editId: 'click1' },
            newEditId: 'save',
          },
        ],
      },
      broken: 'not a doc',
    })
    expect(overrides).toEqual({
      demo: [{ key: 'delay|||0', values: { durationMs: 100 } }],
    })
    expect(codify.demo?.map((event) => event.id)).toEqual(['e1'])
    expect(codify.broken).toBeUndefined()
    expect(renames.demo).toEqual([{ editId: 'click1', newEditId: 'save' }])
  })
})

describe('collectEditableFromRecordings', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'screenci-editable-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('collects editable metas from recording data.json files', () => {
    const recDir = join(dir, 'My video [en]')
    mkdirSync(recDir)
    writeFileSync(
      join(recDir, 'data.json'),
      JSON.stringify({
        metadata: { videoName: 'My video' },
        events: [
          {
            type: 'input',
            editable: {
              descriptor: {
                kind: 'input',
                subKind: 'click',
                matcher: 'getByRole(button)',
                ordinal: 0,
                seq: 0,
              },
              locked: true,
              lockedFields: ['moveDuration'],
              schemaKind: 'cursorMove',
              defaults: { moveDuration: 400 },
            },
          },
          { type: 'cueStart' },
        ],
      })
    )
    const collected = collectEditableFromRecordings(dir)
    expect(collected['My video']).toEqual([
      {
        key: 'input|click|getByRole(button)|0',
        locked: true,
        lockedFields: ['moveDuration'],
        defaults: { moveDuration: 400 },
      },
    ])
  })
})
