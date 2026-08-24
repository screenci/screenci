import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import {
  applyCodegenRequest,
  requireTypescriptForCodegen,
} from './applyCodegen.js'
import type { EditableSnapshot } from './editableSnapshot.js'
import { planDuplicateEditIdFixes, readEditIdCounters } from './editIdStamp.js'

const FILE = '/proj/demo.screenci.ts'

const SOURCE = [
  "import { video } from 'screenci'",
  '',
  "video('Demo', async ({ page }) => {",
  "  await page.locator('#name').fill('Jane', { editId: 'fill1' })",
  '})',
  '',
].join('\n')

const SNAPSHOT: EditableSnapshot = {
  version: 1,
  videos: {
    Demo: [
      {
        key: 'fill1',
        editId: 'fill1',
        locked: false,
        defaults: {},
        source: { file: FILE, line: 4 },
      },
    ],
  },
}

async function apply(
  editJson: string,
  source: string = SOURCE,
  formatFile?: (path: string, content: string) => Promise<string>
) {
  const writes: Record<string, string> = {}
  await applyCodegenRequest(
    {
      requestId: 'req1',
      videoName: 'Demo',
      editId: 'edit1',
      editJson,
      requiresRecord: false,
    },
    {
      ts,
      readFile: (path) => (path === FILE ? source : null),
      writeFile: (path, content) => {
        writes[path] = content
      },
      editableSnapshot: SNAPSHOT,
      ...(formatFile !== undefined && { formatFile }),
    }
  )
  return writes
}

describe('applyCodegenRequest: options and narration records', () => {
  it('writes an optionsEdit as a new .renderOptions call', async () => {
    const writes = await apply(
      JSON.stringify({
        type: 'optionsEdit',
        id: 'options|renderOptions',
        method: 'renderOptions',
        values: { fps: 60, mouse: { size: 2 } },
      })
    )
    expect(writes[FILE]).toContain(
      "video.renderOptions({ fps: 60, mouse: { size: 2 } })('Demo'"
    )
  })

  it('merges an optionsEdit into an existing .recordOptions call', async () => {
    const source = SOURCE.replace(
      "video('Demo'",
      "video.recordOptions({ headless: false })('Demo'"
    )
    const writes = await apply(
      JSON.stringify({
        type: 'optionsEdit',
        id: 'options|recordOptions',
        method: 'recordOptions',
        values: { headless: true, slowMo: 50 },
      }),
      source
    )
    expect(writes[FILE]).toContain(
      "video.recordOptions({ headless: true, slowMo: 50 })('Demo'"
    )
  })

  it('does not rewrite the file when the options already match', async () => {
    const source = SOURCE.replace(
      "video('Demo'",
      "video.renderOptions({ fps: 60 })('Demo'"
    )
    const writes = await apply(
      JSON.stringify({
        type: 'optionsEdit',
        id: 'options|renderOptions',
        method: 'renderOptions',
        values: { fps: 60 },
      }),
      source
    )
    expect(writes).toEqual({})
  })

  it('writes a narrationEdit into the declaration, adding the section', async () => {
    const writes = await apply(
      JSON.stringify({
        type: 'narrationEdit',
        id: 'narration|intro|default',
        cueName: 'intro',
        lang: 'default',
        value: 'Hi there',
      })
    )
    expect(writes[FILE]).toContain(
      "video.narration({ intro: 'Hi there' })('Demo'"
    )
  })

  it('converts a content-major declaration on a non-default lang edit', async () => {
    const source = SOURCE.replace(
      "video('Demo'",
      "video.narration({ intro: 'Hi' })('Demo'"
    )
    const writes = await apply(
      JSON.stringify({
        type: 'narrationEdit',
        id: 'narration|intro|fi',
        cueName: 'intro',
        lang: 'fi',
        value: 'Moi',
      }),
      source
    )
    expect(writes[FILE]).toContain(
      "video.narration({ default: { intro: 'Hi' }, fi: { intro: 'Moi' } })"
    )
  })

  it('writes a valuesEdit into the declaration, adding the section', async () => {
    const writes = await apply(
      JSON.stringify({
        type: 'valuesEdit',
        id: 'values|title|default',
        field: 'title',
        lang: 'default',
        value: 'Welcome',
      })
    )
    expect(writes[FILE]).toContain("video.values({ title: 'Welcome' })('Demo'")
  })

  it('converts a names-only values array to an object literal', async () => {
    const source = SOURCE.replace(
      "video('Demo'",
      "video.values(['title', 'subtitle'])('Demo'"
    )
    const writes = await apply(
      JSON.stringify({
        type: 'valuesEdit',
        id: 'values|title|default',
        field: 'title',
        lang: 'default',
        value: 'Welcome',
      }),
      source
    )
    expect(writes[FILE]).toContain(
      "video.values({ title: 'Welcome', subtitle: '' })('Demo'"
    )
  })

  it('writes a languagesEdit as a new .languages call', async () => {
    const writes = await apply(
      JSON.stringify({
        type: 'languagesEdit',
        id: 'languages',
        languages: ['en', 'fi'],
      })
    )
    expect(writes[FILE]).toContain("video.languages(['en', 'fi'])('Demo'")
  })

  it('extends an existing .languages array', async () => {
    const source = SOURCE.replace(
      "video('Demo'",
      "video.languages(['en'])('Demo'"
    )
    const writes = await apply(
      JSON.stringify({
        type: 'languagesEdit',
        id: 'languages',
        languages: ['en', 'fi'],
      }),
      source
    )
    expect(writes[FILE]).toContain("video.languages(['en', 'fi'])('Demo'")
  })

  it('removes a language via a languagesEdit with removeLanguages', async () => {
    const source = SOURCE.replace(
      "video('Demo'",
      "video.languages(['en', 'fi', 'de'])('Demo'"
    )
    const writes = await apply(
      JSON.stringify({
        type: 'languagesEdit',
        id: 'languages',
        languages: ['en', 'de'],
        removeLanguages: ['fi'],
      }),
      source
    )
    expect(writes[FILE]).toContain("video.languages(['en', 'de'])('Demo'")
  })

  it('writes an editorMediaEdit as a backend-hosted overlay declaration', async () => {
    const writes = await apply(
      JSON.stringify({
        type: 'editorMediaEdit',
        id: 'editorMedia|overlays|logo',
        method: 'overlays',
        name: 'logo',
        editor: 'logo',
      })
    )
    expect(writes[FILE]).toContain(
      "video.overlays({ logo: { editor: 'logo' } })('Demo'"
    )
  })

  it('converts a names-only narration declaration instead of refusing', async () => {
    const source = SOURCE.replace(
      "video('Demo'",
      "video.narration(['intro'])('Demo'"
    )
    const writes = await apply(
      JSON.stringify({
        type: 'narrationEdit',
        id: 'narration|intro|default',
        cueName: 'intro',
        lang: 'default',
        value: 'Hi',
      }),
      source
    )
    expect(writes[FILE]).toContain("video.narration({ intro: 'Hi' })('Demo'")
  })
})

describe('applyCodegenRequest: formatting', () => {
  it('writes the formatted content when a formatFile dep is provided', async () => {
    const formatted: string[] = []
    const writes = await apply(
      JSON.stringify({
        type: 'optionsEdit',
        id: 'options|renderOptions',
        method: 'renderOptions',
        values: { fps: 60 },
      }),
      SOURCE,
      async (path, content) => {
        formatted.push(path)
        return `${content}// formatted\n`
      }
    )
    expect(formatted).toEqual([FILE])
    expect(writes[FILE]).toMatch(/\/\/ formatted\n$/)
  })

  it('does not format when no file changes', async () => {
    const source = SOURCE.replace(
      "video('Demo'",
      "video.renderOptions({ fps: 60 })('Demo'"
    )
    const formatted: string[] = []
    const writes = await apply(
      JSON.stringify({
        type: 'optionsEdit',
        id: 'options|renderOptions',
        method: 'renderOptions',
        values: { fps: 60 },
      }),
      source,
      async (path, content) => {
        formatted.push(path)
        return content
      }
    )
    expect(writes).toEqual({})
    expect(formatted).toEqual([])
  })
})

describe('requireTypescriptForCodegen', () => {
  it('throws an actionable error when the loader resolves nothing', () => {
    expect(() => requireTypescriptForCodegen(() => null, '/proj')).toThrow(
      'TypeScript is not available; install it to enable editor codegen'
    )
  })

  it('returns the loaded module and passes the project dir through', () => {
    const seen: string[] = []
    const loaded = requireTypescriptForCodegen((dir) => {
      seen.push(dir)
      return ts
    }, '/proj')
    expect(loaded).toBe(ts)
    expect(seen).toEqual(['/proj'])
  })
})

describe('applyCodegenRequest: human-readable edit names in errors', () => {
  async function applyRaw(editId: string, editJson: string) {
    await applyCodegenRequest(
      {
        requestId: 'req1',
        videoName: 'Demo',
        editId,
        editJson,
        requiresRecord: false,
      },
      {
        ts,
        readFile: (path) => (path === FILE ? SOURCE : null),
        writeFile: () => {},
        editableSnapshot: SNAPSHOT,
      }
    )
  }

  it('never shows the raw pipe slug, names the edit instead', async () => {
    const error = await applyRaw('options|renderOptions', 'not json').then(
      () => null,
      (thrown: unknown) => thrown as Error
    )
    expect(error).not.toBeNull()
    expect(error?.message).toContain('render options (renderOptions)')
    expect(error?.message).not.toContain('options|renderOptions')
  })

  it('describes the edit when the payload is not a record', async () => {
    await expect(
      applyRaw('options|recordOptions', '"just a string"')
    ).rejects.toThrow(
      'Edit for record options (recordOptions) is not an edit record'
    )
  })
})

describe('applyCodegenRequest: typed refusal reasons in errors', () => {
  it('names the reason so the editor toast is actionable', async () => {
    const record = JSON.stringify({
      type: 'mediaEdit',
      id: 'm1',
      kind: 'narrationCue',
      afterEditId: 'missing-slug',
      blocking: true,
      props: { name: 'intro' },
    })
    await expect(apply(record)).rejects.toThrow(/\[unknown-edit-id\]/)
  })
})

describe('applyCodegenRequest: orphaned (stale key) soft skip', () => {
  async function applyReturning(editJson: string) {
    const writes: Record<string, string> = {}
    const result = await applyCodegenRequest(
      {
        requestId: 'req1',
        videoName: 'Demo',
        editId: 'param|delay',
        editJson,
        requiresRecord: true,
      },
      {
        ts,
        readFile: (path) => (path === FILE ? SOURCE : null),
        writeFile: (path, content) => {
          writes[path] = content
        },
        editableSnapshot: SNAPSHOT,
      }
    )
    return { result, writes }
  }

  // A paramEdit whose target key is absent from the current recording snapshot
  // (SNAPSHOT only knows 'fill1'). The action drifted or was removed; there is
  // no call site to touch.
  const staleDelayEdit = JSON.stringify({
    type: 'paramEdit',
    id: 'param|delay',
    target: { key: 'delay' },
    fields: { durationMs: 500 },
  })

  it('returns { outcome: orphaned } instead of throwing', async () => {
    const { result, writes } = await applyReturning(staleDelayEdit)
    expect(result).toEqual({ outcome: 'orphaned' })
    expect(writes).toEqual({})
  })

  it('returns { outcome: applied } for a real edit that writes', async () => {
    const record = JSON.stringify({
      type: 'paramEdit',
      id: 'p1',
      target: { key: 'fill1' },
      fields: { moveDuration: 400 },
    })
    const result = await applyCodegenRequest(
      {
        requestId: 'req1',
        videoName: 'Demo',
        editId: 'param|fill1',
        editJson: record,
        requiresRecord: true,
      },
      {
        ts,
        readFile: (path) => (path === FILE ? SOURCE : null),
        writeFile: () => {},
        editableSnapshot: SNAPSHOT,
      }
    )
    expect(result).toEqual({ outcome: 'applied' })
  })
})

describe('applyCodegenRequest: duplicate editId self-heal', () => {
  const DUP_SOURCE = [
    "import { video } from 'screenci'",
    '',
    "video('Demo', async ({ page }) => {",
    "  await page.locator('#a').fill('A', { editId: 'fill1' })",
    "  await page.locator('#b').fill('B', { editId: 'fill1' })",
    '})',
    '',
  ].join('\n')

  const DUP_SNAPSHOT: EditableSnapshot = {
    version: 1,
    videos: {
      Demo: [
        {
          key: 'fill1',
          editId: 'fill1',
          locked: false,
          defaults: {},
          source: { file: FILE, line: 4 },
        },
      ],
    },
  }

  const mediaAfterFill1 = JSON.stringify({
    type: 'mediaEdit',
    id: 'm1',
    kind: 'narrationCue',
    afterEditId: 'fill1',
    blocking: true,
    props: { name: 'intro' },
  })

  it('re-stamps the duplicate then applies the edit', async () => {
    const files: Record<string, string> = { [FILE]: DUP_SOURCE }
    await applyCodegenRequest(
      {
        requestId: 'req1',
        videoName: 'Demo',
        editId: 'edit1',
        editJson: mediaAfterFill1,
        requiresRecord: false,
      },
      {
        ts,
        readFile: (path) => files[path] ?? null,
        writeFile: (path, content) => {
          files[path] = content
        },
        editableSnapshot: DUP_SNAPSHOT,
        resolveDuplicateEditIds: async (paths) => {
          const plan = planDuplicateEditIdFixes(
            paths.map((path) => ({ path, text: files[path]! })),
            readEditIdCounters('/proj/.screenci'),
            { ts }
          )
          for (const file of plan.files) files[file.path] = file.after
          return plan.renamed.length > 0
        },
      }
    )
    // The duplicate became fill2, the surviving fill1 got the narration cue.
    expect(files[FILE]).toContain("editId: 'fill2'")
    expect(files[FILE]).toContain('await narration.intro()')
    expect(files[FILE]!.match(/editId: 'fill1'/g)).toHaveLength(1)
  })

  it('still throws when the duplicate cannot be resolved', async () => {
    const files: Record<string, string> = { [FILE]: DUP_SOURCE }
    await expect(
      applyCodegenRequest(
        {
          requestId: 'req1',
          videoName: 'Demo',
          editId: 'edit1',
          editJson: mediaAfterFill1,
          requiresRecord: false,
        },
        {
          ts,
          readFile: (path) => files[path] ?? null,
          writeFile: () => {},
          editableSnapshot: DUP_SNAPSHOT,
          resolveDuplicateEditIds: async () => false,
        }
      )
    ).rejects.toThrow(/\[ambiguous-edit-id\]/)
  })
})

describe('applyCodegenRequest: onSourcesRewritten', () => {
  const OPTIONS_EDIT = JSON.stringify({
    type: 'optionsEdit',
    id: 'options|renderOptions',
    method: 'renderOptions',
    values: { fps: 60 },
  })

  async function applyWithHook(params: {
    editJson: string
    requiresRecord: boolean
    source?: string
  }) {
    const rewritten: string[][] = []
    const recordRequired: string[][] = []
    await applyCodegenRequest(
      {
        requestId: 'req1',
        videoName: 'Demo',
        editId: 'edit1',
        editJson: params.editJson,
        requiresRecord: params.requiresRecord,
      },
      {
        ts,
        readFile: (path) => (path === FILE ? (params.source ?? SOURCE) : null),
        writeFile: () => {},
        editableSnapshot: SNAPSHOT,
        onSourcesRewritten: async (paths) => {
          rewritten.push(paths)
        },
        onRecordRequiredRewrite: (paths) => {
          recordRequired.push(paths)
        },
      }
    )
    return { rewritten, recordRequired }
  }

  it('reports the written paths for a render-time edit', async () => {
    const { rewritten } = await applyWithHook({
      editJson: OPTIONS_EDIT,
      requiresRecord: false,
    })
    expect(rewritten).toEqual([[FILE]])
  })

  it('is not called for a record-requiring edit, which reports separately', async () => {
    const { rewritten, recordRequired } = await applyWithHook({
      editJson: OPTIONS_EDIT,
      requiresRecord: true,
    })
    expect(rewritten).toEqual([])
    // The record-requiring hook fires instead, so the caller can keep the
    // file out of later render-time re-baselines until a record runs.
    expect(recordRequired).toEqual([[FILE]])
  })

  it('is not called when the edit changes nothing', async () => {
    const { rewritten } = await applyWithHook({
      editJson: OPTIONS_EDIT,
      requiresRecord: false,
      source: SOURCE.replace(
        "video('Demo'",
        "video.renderOptions({ fps: 60 })('Demo'"
      ),
    })
    expect(rewritten).toEqual([])
  })
})
