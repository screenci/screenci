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
  'docs/installation': {
    publicId: 'kh7ccy03njvxjm0daef5g50zv587hrbd',
    sourcePath: 'screenci/docs/video-sources/installation.screenci.ts',
    showSource: false,
  },
  'docs/reference/cli': {
    publicId: 'kh778mvzqw1t504wts9wqyaa2187dfc0',
    sourcePath: 'screenci/docs/video-sources/cli.screenci.ts',
  },
  // Recorded locally via apps/demo-saas/videos/pitch-embed.screenci.ts, then
  // published with `screenci make-public`.
  'docs/guides/public-urls-and-embeds': {
    publicId: 'kh7aj5s49s6wgfb86jgd0zht59890f17',
    sourcePath: 'screenci/docs/video-sources/public-urls.screenci.ts',
    showSource: false,
  },
  // Add a publicId after publishing. The Studio video needs a logged-in app
  // session (SCREENCI_APP_STORAGE_STATE) to record against app.screenci.com.
  'docs/guides/studio': {
    sourcePath: 'screenci/docs/video-sources/studio.screenci.ts',
    showSource: false,
  },
  // The animated locator-highlight overlay in the Overlays guide. Add a
  // publicId after publishing the source.
  'docs/guides/assets-and-overlays': {
    sourcePath:
      'screenci/docs/video-sources/locator-highlight-animated.screenci.ts',
  },
  // The locator-highlight still in the Screenshots guide. Published as a
  // screenshot recording; add a publicId after publishing the source.
  'docs/guides/screenshots': {
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
