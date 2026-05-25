export const docsVideoRegistry = {
  docs: {
    publicId: 'kh7dq5rk3vabtxya45w6zm1fmd871jdx',
    sourcePath: 'screenci/docs/video-sources/installation.video.ts',
  },
  'docs/write-video-scripts': {
    sourcePath: 'screenci/docs/video-sources/write-video-scripts.video.ts',
  },
  'docs/generating-videos': {
    sourcePath: 'screenci/docs/video-sources/generating-videos.video.ts',
  },
  'docs/run-and-debug-videos': {
    sourcePath: 'screenci/docs/video-sources/run-and-debug-videos.video.ts',
  },
  'docs/record-and-publish': {
    sourcePath: 'screenci/docs/video-sources/record-and-publish.video.ts',
  },
  'docs/ci-setup': {
    sourcePath: 'screenci/docs/video-sources/ci-setup.video.ts',
  },
  'docs/guides/narration-and-localization': {
    sourcePath:
      'screenci/docs/video-sources/narration-and-localization.video.ts',
  },
  'docs/guides/camera-and-zooming': {
    sourcePath: 'screenci/docs/video-sources/camera-and-zooming.video.ts',
  },
  'docs/guides/public-urls-and-embeds': {
    sourcePath: 'screenci/docs/video-sources/public-urls-and-embeds.video.ts',
  },
  'docs/reference/cli': {
    sourcePath: 'screenci/docs/video-sources/cli.video.ts',
  },
} as const

export function getDocVideo(slug: string) {
  return docsVideoRegistry[slug as keyof typeof docsVideoRegistry] ?? null
}
