export type PublishedDocVideo = {
  publicId: string
  sourcePath: string
  showSource?: boolean
}

export type UnpublishedDocVideo = {
  sourcePath: string
  showSource?: boolean
}

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
} as const satisfies Record<string, DocVideo>

export function getDocVideo(slug: string) {
  return docsVideoRegistry[slug as keyof typeof docsVideoRegistry] ?? null
}

export function hasPublicId(video: DocVideo): video is PublishedDocVideo {
  return 'publicId' in video
}
