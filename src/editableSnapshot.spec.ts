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

  it('splits options and narration records into their own buckets', () => {
    const { studioOptions, narrationEdits } = splitTimelineEditsByVideo({
      demo: {
        version: 4,
        edits: [
          {
            type: 'optionsEdit',
            id: 'options|renderOptions',
            method: 'renderOptions',
            values: { fps: 60 },
          },
          {
            type: 'optionsEdit',
            id: 'options|recordOptions',
            method: 'recordOptions',
            values: { headless: true },
          },
          {
            type: 'narrationEdit',
            id: 'narration|intro|default',
            cueName: 'intro',
            lang: 'default',
            value: 'Hi',
          },
          {
            type: 'narrationEdit',
            id: 'narration|intro|fi',
            cueName: 'intro',
            lang: 'fi',
            value: { cue: 'Moi', volume: 0.5 },
          },
        ],
      },
    })
    expect(studioOptions.demo).toEqual({
      renderOptions: { fps: 60 },
      recordOptions: { headless: true },
    })
    expect(narrationEdits.demo?.map((edit) => edit.id)).toEqual([
      'narration|intro|default',
      'narration|intro|fi',
    ])
  })

  it('ignores malformed options and narration records', () => {
    const { studioOptions, narrationEdits } = splitTimelineEditsByVideo({
      demo: {
        version: 4,
        edits: [
          { type: 'optionsEdit', id: 'x', method: 'other', values: {} },
          { type: 'optionsEdit', id: 'y', method: 'renderOptions' },
          {
            type: 'narrationEdit',
            id: 'z',
            cueName: 'intro',
            lang: 'default',
            value: { volume: 0.5 },
          },
          { type: 'narrationEdit', id: 'w', cueName: 'intro', value: 'Hi' },
        ],
      },
    })
    expect(studioOptions).toEqual({})
    expect(narrationEdits).toEqual({})
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
