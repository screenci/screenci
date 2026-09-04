import { describe, expect, it } from 'vitest'
import type { CliBrandingAsset } from './branding.js'
import {
  collectBrandingAssetRefs,
  validateBrandingAssetRefs,
} from './brandingAssetRefs.js'

const asset = (
  name: string,
  kind: 'image' | 'video' = 'image'
): CliBrandingAsset => ({
  name,
  kind,
  guide: '',
  fileName: `${name}.png`,
  fileHash: 'a'.repeat(64),
  size: 10,
  source: 'org',
})

const event = (overrides: Record<string, unknown> = {}) => ({
  type: 'assetStart',
  kind: 'branding',
  name: 'logo',
  branding: { name: 'logo' },
  durationMs: 3000,
  ...overrides,
})

describe('collectBrandingAssetRefs', () => {
  it('collects each branding overlay with its shape', () => {
    const refs = collectBrandingAssetRefs({
      events: [
        event(),
        event({
          name: 'intro',
          branding: { name: 'hero' },
          durationMs: undefined,
          audio: 1,
        }),
        { type: 'assetStart', kind: 'image', name: 'local' },
      ],
    })
    expect(refs).toEqual([
      {
        overlayName: 'logo',
        assetName: 'logo',
        hasLength: true,
        usesVideoOptions: false,
      },
      {
        overlayName: 'intro',
        assetName: 'hero',
        hasLength: false,
        usesVideoOptions: true,
      },
    ])
  })

  it('counts a paired assetEnd as a length: that is what start()/end() emits', () => {
    // `overlays.logo.start()` ... `overlays.logo.end()` puts no duration on the
    // start event; the end event is what bounds it. Reading only the start
    // would refuse the very usage the error message recommends.
    const refs = collectBrandingAssetRefs({
      events: [
        event({ durationMs: undefined }),
        { type: 'assetEnd', name: 'logo', reason: 'wait' },
      ],
    })
    expect(refs).toEqual([
      {
        overlayName: 'logo',
        assetName: 'logo',
        hasLength: true,
        usesVideoOptions: false,
      },
    ])
  })

  it('pairs ends to starts by name when overlays overlap', () => {
    const refs = collectBrandingAssetRefs({
      events: [
        event({ name: 'a', branding: { name: 'a' }, durationMs: undefined }),
        event({ name: 'b', branding: { name: 'b' }, durationMs: undefined }),
        { type: 'assetEnd', name: 'a' },
      ],
    })
    expect(refs.map((ref) => [ref.overlayName, ref.hasLength])).toEqual([
      ['a', true],
      ['b', false],
    ])
  })

  it('closes the most recently opened overlay when an end carries no name', () => {
    // Recordings made before assetEnd carried a name.
    const refs = collectBrandingAssetRefs({
      events: [
        event({ name: 'a', branding: { name: 'a' }, durationMs: undefined }),
        event({ name: 'b', branding: { name: 'b' }, durationMs: undefined }),
        { type: 'assetEnd' },
      ],
    })
    expect(refs.map((ref) => [ref.overlayName, ref.hasLength])).toEqual([
      ['a', false],
      ['b', true],
    ])
  })

  it('does not credit a branding overlay with a local overlay end', () => {
    const refs = collectBrandingAssetRefs({
      events: [
        event({ durationMs: undefined }),
        { type: 'assetStart', kind: 'image', name: 'local' },
        { type: 'assetEnd', name: 'local' },
      ],
    })
    expect(refs[0]?.hasLength).toBe(false)
  })

  it('tolerates malformed data', () => {
    expect(collectBrandingAssetRefs(null)).toEqual([])
    expect(collectBrandingAssetRefs({ events: [null, 3] })).toEqual([])
  })
})

describe('validateBrandingAssetRefs', () => {
  const refs = collectBrandingAssetRefs({ events: [event()] })

  it('accepts a reference to an existing image with a length', () => {
    expect(validateBrandingAssetRefs(refs, [asset('logo')])).toEqual([])
  })

  it('reports an unknown name and lists what exists', () => {
    const problems = validateBrandingAssetRefs(refs, [asset('wordmark')])
    expect(problems[0]).toContain('is not on the Branding page')
    expect(problems[0]).toContain('available: wordmark')
  })

  it('says so when nothing is defined yet', () => {
    expect(validateBrandingAssetRefs(refs, [])[0]).toContain(
      'none are defined yet'
    )
  })

  it('reports an image overlay with no length', () => {
    const noLength = collectBrandingAssetRefs({
      events: [event({ durationMs: undefined })],
    })
    expect(validateBrandingAssetRefs(noLength, [asset('logo')])[0]).toContain(
      'has no length'
    )
  })

  it('reports video options on an image asset', () => {
    const withVideoOptions = collectBrandingAssetRefs({
      events: [event({ audio: 0.5 })],
    })
    expect(
      validateBrandingAssetRefs(withVideoOptions, [asset('logo')])[0]
    ).toContain('is an image')
  })

  it('reports a length on a video asset', () => {
    expect(
      validateBrandingAssetRefs(refs, [asset('logo', 'video')])[0]
    ).toContain('plays for its own length')
  })

  it('reports nothing when the branding could not be fetched', () => {
    expect(validateBrandingAssetRefs(refs, null)).toEqual([])
  })
})
