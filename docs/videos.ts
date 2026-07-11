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
  // The Screenshots guide and its locator-highlight still were removed for
  // release (the screenshot() fixture is unfinished); the demo source moved to
  // docs/removed/video-sources/ at the repo root.
  // The narrated walkthroughs below are authored but not yet recorded: they have
  // no publicId, so the page injects an invisible placeholder until the video is
  // recorded and published, then a publicId is added here (see videos.ts docs).
  // The four app demos record the authenticated app via shared auth
  // (SCREENCI_APP_STORAGE_STATE); camera-and-zooming records the public site.
  'docs/guides/narration': {
    sourcePath: 'screenci/docs/video-sources/narration.screenci.ts',
    showSource: false,
  },
  'docs/guides/camera-and-zooming': {
    sourcePath: 'screenci/docs/video-sources/camera-and-zooming.screenci.ts',
    showSource: false,
  },
  'docs/guides/languages': {
    sourcePath: 'screenci/docs/video-sources/languages.screenci.ts',
    showSource: false,
  },
  'docs/guides/editor': {
    sourcePath: 'screenci/docs/video-sources/editor.screenci.ts',
    showSource: false,
  },
  'docs/guides/public-urls-and-embeds': {
    sourcePath:
      'screenci/docs/video-sources/public-urls-and-embeds.screenci.ts',
    showSource: false,
  },
} as const satisfies Record<string, DocVideo>

export function getDocVideo(slug: string): DocVideo | null {
  return docsVideoRegistry[slug as keyof typeof docsVideoRegistry] ?? null
}

export function hasPublicId(video: DocVideo): video is PublishedDocVideo {
  return 'publicId' in video
}
