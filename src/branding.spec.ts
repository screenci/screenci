import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_BRANDING,
  brandingRenderOptionsSnippet,
  downloadBrandingVoiceSample,
  fetchBranding,
  formatBrandingLines,
  isEmptyBranding,
  parseBranding,
  safeSampleFileName,
  type CliBranding,
  type DownloadSampleDeps,
  brandingAssetPaths,
  brandingAssetsSnippet,
  overlayKeyForAssetName,
  downloadBrandingAssets,
  type CliBrandingAsset,
} from './branding.js'

const HASH = 'a'.repeat(64)

const FULL: CliBranding = {
  backgroundCss: '#334155',
  aspectRatio: '9:16',
  quality: '1080p',
  cursorStyle: 'black',
  voice: { kind: 'builtIn', name: 'Ava' },
  warnings: [],
  sources: {
    backgroundCss: 'org',
    aspectRatio: 'project',
    quality: 'org',
    cursorStyle: 'org',
    voice: 'org',
  },
  assets: [],
}

describe('parseBranding', () => {
  it('reads a full payload and keeps the sources', () => {
    expect(parseBranding(FULL)).toEqual(FULL)
  })

  it('yields the empty branding for an older server', () => {
    expect(parseBranding(undefined)).toBe(EMPTY_BRANDING)
    expect(parseBranding('nope')).toBe(EMPTY_BRANDING)
    expect(isEmptyBranding(parseBranding({}))).toBe(true)
  })

  it('drops values the CLI cannot use, and their sources with them', () => {
    const parsed = parseBranding({
      aspectRatio: '2:1',
      quality: '8k',
      cursorStyle: 'red',
      voice: { kind: 'builtIn', name: 'Nobody' },
      warnings: ['x', 3],
      sources: { aspectRatio: 'org', voice: 'project' },
    })
    expect(parsed.aspectRatio).toBeNull()
    expect(parsed.sources.aspectRatio).toBe('none')
    expect(parsed.voice).toBeNull()
    expect(parsed.sources.voice).toBe('none')
    expect(parsed.warnings).toEqual(['x'])
    expect(
      parseBranding({ voice: { kind: 'elevenlabs', voiceId: 'v1' } }).voice
    ).toEqual({ kind: 'elevenlabs', voiceId: 'v1', name: null })
    expect(
      parseBranding({
        voice: { kind: 'sample', fileHash: 'short', fileName: 'a' },
      }).voice
    ).toBeNull()
  })
})

describe('fetchBranding', () => {
  it('calls the dev route with the secret and project name', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    const result = await fetchBranding(
      { apiUrl: 'https://api.example.com', secret: 'sec', projectName: 'Acme' },
      (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push([String(input), init])
        return new Response(JSON.stringify({ ...FULL, projectName: 'Acme' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }) as unknown as typeof fetch
    )
    expect(calls[0]?.[0]).toBe(
      'https://api.example.com/cli/dev/branding?projectName=Acme'
    )
    expect(
      (calls[0]?.[1]?.headers as Record<string, string>)['X-ScreenCI-Secret']
    ).toBe('sec')
    expect(result).toEqual({
      ok: true,
      branding: FULL,
      projectName: 'Acme',
      supported: true,
    })
  })

  it('treats a missing route (older server) as the empty branding, and says the service does not support it', async () => {
    const result = await fetchBranding(
      { apiUrl: 'https://api.example.com', secret: 'sec' },
      (async () =>
        new Response('Not found', { status: 404 })) as unknown as typeof fetch
    )
    // `supported: false` is what keeps the reference check from reporting
    // every `{ branding: '<name>' }` overlay as missing against such a service.
    expect(result).toEqual({
      ok: true,
      branding: EMPTY_BRANDING,
      projectName: null,
      supported: false,
    })
  })

  it('reports failures', async () => {
    const result = await fetchBranding(
      { apiUrl: 'https://api.example.com', secret: 'sec' },
      (async () =>
        new Response('nope', { status: 500 })) as unknown as typeof fetch
    )
    expect(result).toEqual({
      ok: false,
      message: 'Fetching the branding failed with status 500: nope',
    })
  })
})

describe('downloadBrandingVoiceSample', () => {
  const bytes = new Uint8Array([1, 2, 3])
  const hash = createHash('sha256').update(bytes).digest('hex')

  function makeDeps(
    response: () => Response,
    files: Map<string, Uint8Array> = new Map()
  ) {
    const dirs: string[] = []
    const deps: DownloadSampleDeps = {
      fetchFn: (async () => response()) as unknown as typeof fetch,
      readFile: async (path) => files.get(path) ?? null,
      writeFile: async (path, data) => {
        files.set(path, data)
      },
      mkdir: async (dir) => {
        dirs.push(dir)
      },
      sha256: (data) => createHash('sha256').update(data).digest('hex'),
    }
    return { deps, files, dirs }
  }

  it('writes the sample under branding/ with a safe name', async () => {
    const { deps, files, dirs } = makeDeps(
      () =>
        new Response(bytes, {
          status: 200,
          headers: {
            'X-ScreenCI-File-Hash': hash,
            'X-ScreenCI-File-Name': encodeURIComponent('my voice/ä.mp3'),
          },
        })
    )
    const result = await downloadBrandingVoiceSample(
      {
        apiUrl: 'https://api.example.com',
        secret: 'sec',
        islandDir: '/w/screenci',
      },
      deps
    )
    expect(result).toEqual({
      status: 'written',
      relativePath: 'branding/voice-sample.mp3',
      fileName: 'voice-sample.mp3',
    })
    expect(dirs).toEqual(['/w/screenci/branding'])
    expect(files.get('/w/screenci/branding/voice-sample.mp3')).toEqual(bytes)
  })

  it('keeps an identical local file, and maps 404 and hash mismatches', async () => {
    const files = new Map([['/w/screenci/branding/voice.mp3', bytes]])
    const kept = await downloadBrandingVoiceSample(
      {
        apiUrl: 'https://api.example.com',
        secret: 'sec',
        islandDir: '/w/screenci',
      },
      makeDeps(
        () =>
          new Response(bytes, {
            status: 200,
            headers: {
              'X-ScreenCI-File-Hash': hash,
              'X-ScreenCI-File-Name': 'voice.mp3',
            },
          }),
        files
      ).deps
    )
    expect(kept).toEqual({
      status: 'kept',
      relativePath: 'branding/voice.mp3',
      fileName: 'voice.mp3',
    })

    const none = await downloadBrandingVoiceSample(
      { apiUrl: 'https://api.example.com', secret: 'sec', islandDir: '/w' },
      makeDeps(() => new Response('', { status: 404 })).deps
    )
    expect(none).toEqual({ status: 'none' })

    const mismatch = await downloadBrandingVoiceSample(
      { apiUrl: 'https://api.example.com', secret: 'sec', islandDir: '/w' },
      makeDeps(
        () =>
          new Response(bytes, {
            status: 200,
            headers: { 'X-ScreenCI-File-Hash': HASH },
          })
      ).deps
    )
    expect(mismatch.status).toBe('error')
  })

  it('reports a disk failure instead of throwing out of a best-effort download', async () => {
    // `screenci start` calls this after it has already written the secret.
    // Throwing here would abort the command and leave the agent with no brief.
    const { deps } = makeDeps(
      () =>
        new Response(bytes, {
          status: 200,
          headers: { 'X-ScreenCI-File-Hash': hash },
        })
    )
    const result = await downloadBrandingVoiceSample(
      { apiUrl: 'https://api.example.com', secret: 'sec', islandDir: '/w' },
      {
        ...deps,
        writeFile: async () => {
          throw new Error('EACCES: permission denied')
        },
      }
    )
    expect(result).toEqual({
      status: 'error',
      message: expect.stringContaining('EACCES'),
    })
  })

  it('keeps a served file name that is not valid percent-encoding', async () => {
    const { deps, files } = makeDeps(
      () =>
        new Response(bytes, {
          status: 200,
          headers: {
            'X-ScreenCI-File-Hash': hash,
            // decodeURIComponent throws on this.
            'X-ScreenCI-File-Name': 'voice%ZZ.mp3',
          },
        })
    )
    const result = await downloadBrandingVoiceSample(
      { apiUrl: 'https://api.example.com', secret: 'sec', islandDir: '/w' },
      deps
    )
    expect(result).toMatchObject({ status: 'written' })
    expect([...files.keys()]).toHaveLength(1)
  })

  it('sanitizes file names', () => {
    expect(safeSampleFileName('../../etc/passwd')).toBe('passwd')
    expect(safeSampleFileName('.hidden')).toBe('hidden')
    expect(safeSampleFileName('///')).toBe('voice-sample')
    expect(safeSampleFileName('my voice (1).wav')).toBe('my-voice-1.wav')
    expect(safeSampleFileName('brand voice.mp3')).toBe('brand-voice.mp3')
  })
})

describe('brandingRenderOptionsSnippet and formatBrandingLines', () => {
  it('renders only the set fields', () => {
    expect(brandingRenderOptionsSnippet(EMPTY_BRANDING, null)).toBeNull()
    const snippet = brandingRenderOptionsSnippet(FULL, null)
    expect(snippet).toContain(
      '.recordOptions({ aspectRatio: "9:16", quality: "1080p" })'
    )
    expect(snippet).toContain('background: { backgroundCss: "#334155" }')
    expect(snippet).toContain('mouse: { style: "black" }')
    expect(snippet).toContain('narration: { voice: { name: "Ava" } }')
    expect(snippet).not.toContain('import { video, voices }')

    const sample = brandingRenderOptionsSnippet(
      {
        ...EMPTY_BRANDING,
        voice: { kind: 'sample', fileHash: HASH, fileName: 'v.mp3' },
      },
      'branding/v.mp3'
    )
    expect(sample).toContain("import { video, voices } from 'screenci'")
    expect(sample).toContain('voices.elevenlabs({ path: "./branding/v.mp3" })')
    // Without the local file the voice line is left out.
    expect(
      brandingRenderOptionsSnippet(
        {
          ...EMPTY_BRANDING,
          voice: { kind: 'sample', fileHash: HASH, fileName: 'v.mp3' },
        },
        null
      )
    ).not.toContain('narration')
  })

  it('lists the values with their source and the warnings', () => {
    expect(formatBrandingLines(EMPTY_BRANDING, null)).toEqual([
      'No organisation branding is set; the SDK defaults apply.',
    ])
    const lines = formatBrandingLines(
      { ...FULL, warnings: ['Needs the Business plan'] },
      null
    )
    expect(lines).toEqual([
      '- Background: #334155',
      '- Aspect ratio: 9:16 (project override)',
      '- Quality: 1080p',
      '- Cursor: black',
      '- Narration voice: Ava (built-in)',
      '- Warning: Needs the Business plan',
    ])
  })
})

describe('branding assets', () => {
  const asset: CliBrandingAsset = {
    name: 'logo',
    kind: 'image',
    guide: 'Bottom-right corner.\nKeep 24 px from the edges.',
    fileName: 'logo.png',
    fileHash: HASH,
    size: 100,
    source: 'org',
  }

  it('parses a payload and drops entries the CLI cannot use', () => {
    const parsed = parseBranding({
      assets: [
        asset,
        { ...asset, name: 'hero', kind: 'video', source: 'project' },
        // Dropped: bad hash, unknown kind, missing name, duplicate.
        { ...asset, name: 'bad-hash', fileHash: 'nope' },
        { ...asset, name: 'bad-kind', kind: 'audio' },
        { ...asset, name: undefined },
        { ...asset, guide: 'second' },
      ],
    })
    expect(parsed.assets.map((entry) => entry.name)).toEqual(['logo', 'hero'])
    expect(parsed.assets[0]?.guide).toBe(asset.guide)
    expect(parsed.assets[1]?.source).toBe('project')
  })

  it('defaults to no assets for an older server', () => {
    expect(parseBranding({}).assets).toEqual([])
    expect(EMPTY_BRANDING.assets).toEqual([])
  })

  it('counts assets as branding even when every value is unset', () => {
    expect(isEmptyBranding({ ...EMPTY_BRANDING, assets: [asset] })).toBe(false)
    expect(isEmptyBranding(EMPTY_BRANDING)).toBe(true)
  })

  it('lists each asset with its kind, source and local path', () => {
    const lines = formatBrandingLines(
      { ...EMPTY_BRANDING, assets: [{ ...asset, source: 'project' }] },
      null,
      { logo: 'branding/logo.png' }
    )
    expect(lines).toEqual([
      '- Shared asset logo (image, logo.png, project override, saved as branding/logo.png): Bottom-right corner.',
    ])
  })

  it('writes a snippet that references assets by name', () => {
    const snippet = brandingAssetsSnippet({
      ...EMPTY_BRANDING,
      assets: [asset, { ...asset, name: 'hero', kind: 'video', guide: '' }],
    })
    expect(snippet).toContain('logo: { branding: "logo"')
    expect(snippet).toContain('// Bottom-right corner.')
    expect(snippet).toContain('await overlays.logo.for(3000)')
    expect(snippet).toContain('await overlays.hero()')
    // Never a path or a hash: the export resolves the name.
    expect(snippet).not.toContain(HASH)
    expect(snippet).not.toContain('logo.png')
  })

  it('turns a dashed asset name into a usable overlay key', () => {
    // `intro-clip: {...}` and `overlays.intro-clip()` are both syntax errors,
    // so the agent would be handed a snippet that cannot run.
    const snippet = brandingAssetsSnippet({
      ...EMPTY_BRANDING,
      assets: [
        { ...asset, name: 'intro-clip', kind: 'video', guide: '' },
        { ...asset, name: '2024-badge', kind: 'image', guide: '' },
      ],
    })
    expect(snippet).toContain('introClip: { branding: "intro-clip"')
    expect(snippet).toContain('await overlays.introClip()')
    expect(snippet).toContain('asset2024Badge: { branding: "2024-badge"')
    expect(snippet).toContain('await overlays.asset2024Badge.for(3000)')
    expect(snippet).not.toContain('overlays.intro-clip')
  })

  it('keeps two names that collapse onto one key apart', () => {
    const snippet = brandingAssetsSnippet({
      ...EMPTY_BRANDING,
      assets: [
        { ...asset, name: 'intro-clip', kind: 'image', guide: '' },
        { ...asset, name: 'introclip', kind: 'image', guide: '' },
      ],
    })
    // A duplicate object key would silently drop one of the overlays.
    expect(snippet).toContain('introClip: { branding: "intro-clip"')
    expect(snippet).toContain('introclip: { branding: "introclip"')
  })

  it('has no snippet without assets', () => {
    expect(brandingAssetsSnippet(EMPTY_BRANDING)).toBeNull()
  })

  describe('overlayKeyForAssetName', () => {
    it('produces a valid identifier for every legal asset name', () => {
      const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/
      for (const name of [
        'logo',
        'intro-clip',
        'a-b-c-d',
        '2024-badge',
        '9',
        'x-',
      ]) {
        expect(overlayKeyForAssetName(name)).toMatch(identifier)
      }
    })
  })

  it('downloads each asset under its own name and keeps identical files', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const written: Record<string, Uint8Array> = {}
    const fetchFn = (async () =>
      new Response(bytes, {
        headers: {
          'X-ScreenCI-File-Name': encodeURIComponent('original name.png'),
          'X-ScreenCI-File-Hash': 'hash-of-bytes',
        },
      })) as unknown as typeof fetch

    const deps = {
      fetchFn,
      readFile: async () => null,
      writeFile: async (path: string, data: Uint8Array) => {
        written[path] = data
      },
      mkdir: async () => undefined,
      sha256: () => 'hash-of-bytes',
    }

    const results = await downloadBrandingAssets(
      { apiUrl: 'https://api.test', secret: 's', islandDir: '/island' },
      [asset],
      deps
    )
    expect(results.logo).toEqual({
      status: 'written',
      relativePath: 'branding/logo.png',
      fileName: 'logo.png',
    })
    expect(Object.keys(written)).toEqual(['/island/branding/logo.png'])
    expect(brandingAssetPaths(results)).toEqual({
      logo: 'branding/logo.png',
    })

    const kept = await downloadBrandingAssets(
      { apiUrl: 'https://api.test', secret: 's', islandDir: '/island' },
      [asset],
      { ...deps, readFile: async () => bytes }
    )
    expect(kept.logo?.status).toBe('kept')
  })
})
