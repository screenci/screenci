/**
 * A doc media embed is either a recorded `video` (the default) or a still
 * `screenshot`. Both are produced by the same `.screenci.ts` source recorded in
 * CI and published to the public delivery CDN; only the embed differs (a player
 * vs an `<img>`).
 */
export type DocMediaKind = 'video' | 'screenshot'

type DocMediaCommon = {
  sourcePath: string
  showSource?: boolean
  /** Defaults to `'video'`. */
  kind?: DocMediaKind
  /** Alt text for `kind: 'screenshot'` embeds. */
  alt?: string
}

export type PublishedDocVideo = DocMediaCommon & {
  publicId: string
}

export type UnpublishedDocVideo = DocMediaCommon

export type DocVideo = PublishedDocVideo | UnpublishedDocVideo

export const docsVideoRegistry = {
  'docs/manual-setup': {
    publicId: 'kh7ccy03njvxjm0daef5g50zv587hrbd',
    sourcePath: 'screenci/docs/video-sources/installation.screenci.ts',
    showSource: false,
  },
  // The animated locator-highlight overlay in the Overlays guide.
  'docs/guides/overlays': {
    publicId: 'kh71x1021zsq1h8ja72c147yr5893q69',
    sourcePath:
      'screenci/docs/video-sources/locator-highlight-animated.screenci.ts',
  },
  // The locator-highlight still in the Screenshots guide. Published as a
  // screenshot recording.
  'docs/guides/screenshots': {
    publicId: 'kh7405zt507ht1qr1mg5hgxxpx892amb',
    kind: 'screenshot',
    alt: 'A marketing-site link highlighted by a pink ring with margin around it, framed as a branded still',
    sourcePath:
      'screenci/docs/video-sources/locator-highlight-still.screenci.ts',
  },
} as const satisfies Record<string, DocVideo>

export function getDocVideo(slug: string): DocVideo | null {
  return docsVideoRegistry[slug as keyof typeof docsVideoRegistry] ?? null
}

export function hasPublicId(video: DocVideo): video is PublishedDocVideo {
  return 'publicId' in video
}
