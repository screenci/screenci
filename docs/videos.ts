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
} as const satisfies Record<string, DocVideo>

export function getDocVideo(slug: string) {
  return docsVideoRegistry[slug as keyof typeof docsVideoRegistry] ?? null
}

export function hasPublicId(video: DocVideo): video is PublishedDocVideo {
  return 'publicId' in video
}
