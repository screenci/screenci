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
  docs: {
    publicId: 'kh7dq5rk3vabtxya45w6zm1fmd871jdx',
    sourcePath: 'screenci/docs/video-sources/installation.video.ts',
    showSource: false,
  },
  'docs/write-video-scripts': {
    publicId: 'kh72bybz8329zbtb6ed50cxwxx87ds9x',
    sourcePath: 'screenci/docs/video-sources/write-video-scripts.video.ts',
  },
  'docs/generating-videos': {
    publicId: 'kh7e67grs9kzcsas7hp7m14mr187ca4d',
    sourcePath: 'screenci/docs/video-sources/generating-videos.video.ts',
  },
  'docs/run-and-debug-videos': {
    publicId: 'kh74qwftww03ttjr88783bby2987dpjm',
    sourcePath: 'screenci/docs/video-sources/run-and-debug-videos.video.ts',
  },
  'docs/record-and-publish': {
    publicId: 'kh71k5cb27n0zwnqxj0tyep3vn87d4j4',
    sourcePath: 'screenci/docs/video-sources/record-and-publish.video.ts',
  },
  'docs/ci-setup': {
    publicId: 'kh7876qg4e8z7nazvnhphpvtb987dvw9',
    sourcePath: 'screenci/docs/video-sources/ci-setup.video.ts',
  },
  'docs/guides/narration-and-localization': {
    publicId: 'kh76xpma702zp7a531es8bpd9x87cvx4',
    sourcePath:
      'screenci/docs/video-sources/narration-and-localization.video.ts',
  },
  'docs/guides/camera-and-zooming': {
    publicId: 'kh7acwtyyfdqn0by8naxtbpjns87d4xf',
    sourcePath: 'screenci/docs/video-sources/camera-and-zooming.video.ts',
  },
  'docs/guides/assets-and-overlays': {
    publicId: 'kh7e6bdc95pb410tg07q0v45d587ejv9',
    sourcePath: 'screenci/docs/video-sources/assets-and-overlays.video.ts',
  },
  'docs/guides/public-urls-and-embeds': {
    publicId: 'kh7483thsgvsh4b5qghtw81b4587dqgj',
    sourcePath: 'screenci/docs/video-sources/public-urls-and-embeds.video.ts',
  },
  'docs/reference/cli': {
    publicId: 'kh778mvzqw1t504wts9wqyaa2187dfc0',
    sourcePath: 'screenci/docs/video-sources/cli.video.ts',
  },
} as const satisfies Record<string, DocVideo>

export function getDocVideo(slug: string) {
  return docsVideoRegistry[slug as keyof typeof docsVideoRegistry] ?? null
}

export function hasPublicId(video: DocVideo): video is PublishedDocVideo {
  return 'publicId' in video
}
