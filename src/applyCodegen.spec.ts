import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import {
  applyCodegenRequest,
  requireTypescriptForCodegen,
} from './applyCodegen.js'
import type { EditableSnapshot } from './editableSnapshot.js'

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

  it('throws with the reason when a narration edit is app-managed', async () => {
    const source = SOURCE.replace(
      "video('Demo'",
      "video.narration(['intro'])('Demo'"
    )
    await expect(
      apply(
        JSON.stringify({
          type: 'narrationEdit',
          id: 'narration|intro|default',
          cueName: 'intro',
          lang: 'default',
          value: 'Hi',
        }),
        source
      )
    ).rejects.toThrow(/app-managed/)
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
