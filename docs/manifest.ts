/**
 * Source of truth for ScreenCI docs information architecture.
 * Slugs are web-facing and stable even if source filenames change.
 */

export const docsManifest = [
  {
    source: 'overview.mdx',
    slug: 'docs',
    section: 'Getting Started',
    order: 1,
    navLabel: 'Overview',
    title: 'Overview',
    description:
      'How ScreenCI works: record locally, render in the service, and serve from a CDN. The service never sees your source code, and the CLI is open source.',
    prev: null,
    next: 'docs/agent-integration',
  },
  {
    source: 'agent-integration.mdx',
    slug: 'docs/agent-integration',
    section: 'Getting Started',
    order: 2,
    navLabel: 'Agent integration',
    title: 'Agent Integration',
    description:
      'The recommended path: point a coding agent at the integration brief so it scaffolds ScreenCI, authors a video for your flow, and records it.',
    prev: 'docs',
    next: 'docs/installation',
  },
  {
    source: 'installation.mdx',
    slug: 'docs/installation',
    section: 'Getting Started',
    order: 3,
    navLabel: 'Manual setup & first video',
    title: 'Manual Setup & First Video',
    description:
      'Wire ScreenCI up by hand: initialize a project, run the starter video locally, and record your first final video.',
    prev: 'docs/agent-integration',
    next: 'docs/write-video-scripts',
  },
  {
    source: 'write-video-scripts.md',
    slug: 'docs/write-video-scripts',
    section: 'Getting Started',
    order: 4,
    navLabel: 'Video script basics',
    title: 'Video Script Basics',
    description:
      'Author .video.ts files with Playwright-like APIs, ScreenCI narration and camera helpers, and workflow-aware pacing.',
    prev: 'docs/installation',
    next: 'docs/ci-setup',
  },
  {
    source: 'ci-setup.md',
    slug: 'docs/ci-setup',
    section: 'Getting Started',
    order: 5,
    navLabel: 'CI setup',
    title: 'CI Setup',
    description:
      'Understand the generated GitHub Actions workflow, required secrets, and how to keep CI recordings deterministic.',
    prev: 'docs/write-video-scripts',
    next: 'docs/guides/page-instrumentation',
  },
  {
    source: 'page-instrumentation.md',
    slug: 'docs/guides/page-instrumentation',
    section: 'Guides',
    order: 1,
    navLabel: 'Page instrumentation',
    title: 'Page Instrumentation',
    description:
      'Understand how ScreenCI instruments the Playwright page so visible actions like clicks, typing, mouse movement, and scrolling are animated.',
    prev: 'docs/ci-setup',
    next: 'docs/guides/narration-and-localization',
  },
  {
    source: 'narration-and-localization.md',
    slug: 'docs/guides/narration-and-localization',
    section: 'Guides',
    order: 2,
    navLabel: 'Narration and localization',
    title: 'Narration and Localization',
    description:
      'Create spoken cues, overlap narration with visible UI motion, and keep multi-language variants consistent and type-safe.',
    prev: 'docs/guides/page-instrumentation',
    next: 'docs/guides/camera-and-zooming',
  },
  {
    source: 'camera-and-zooming.md',
    slug: 'docs/guides/camera-and-zooming',
    section: 'Guides',
    order: 3,
    navLabel: 'Camera and zooming',
    title: 'Camera and Zooming',
    description:
      'Choose between autoZoom and manual framing, and use camera direction to guide attention without making the video frantic.',
    prev: 'docs/guides/narration-and-localization',
    next: 'docs/guides/assets-and-overlays',
  },
  {
    source: 'assets-and-overlays.md',
    slug: 'docs/guides/assets-and-overlays',
    section: 'Guides',
    order: 4,
    navLabel: 'Overlays',
    title: 'Overlays',
    description:
      'Add intro clips, corner logos, transitions, and timed overlays to ScreenCI recordings from files, HTML, or React.',
    prev: 'docs/guides/camera-and-zooming',
    next: 'docs/guides/studio',
  },
  {
    source: 'studio.md',
    slug: 'docs/guides/studio',
    section: 'Guides',
    order: 5,
    navLabel: 'Studio',
    title: 'Studio',
    description:
      'Remix render options, narration text, voices, and overlays from the web app, or manage them entirely in Studio with createStudioNarration and createStudioOverlays. Business tier.',
    prev: 'docs/guides/assets-and-overlays',
    next: 'docs/guides/public-urls-and-embeds',
  },
  {
    source: 'public-urls-and-embeds.md',
    slug: 'docs/guides/public-urls-and-embeds',
    section: 'Guides',
    order: 6,
    navLabel: 'Public URLs and embeds',
    title: 'Public URLs and Embeds',
    description:
      'Enable public delivery for a video, understand stable language-specific URLs, and embed ScreenCI outputs in other sites.',
    prev: 'docs/guides/studio',
    next: 'docs/guides/update-screenci',
  },
  {
    source: 'update-screenci.mdx',
    slug: 'docs/guides/update-screenci',
    section: 'Guides',
    order: 7,
    navLabel: 'Update ScreenCI',
    title: 'Update ScreenCI',
    description:
      'Upgrade the screenci package, refresh Playwright when needed, and verify that existing videos still behave as expected.',
    prev: 'docs/guides/public-urls-and-embeds',
    next: 'docs/reference/cli',
  },
  {
    source: 'cli.mdx',
    slug: 'docs/reference/cli',
    section: 'Reference',
    order: 1,
    navLabel: 'CLI',
    title: 'CLI',
    description:
      'Command reference for screenci init, test, record, project info, and public delivery commands.',
    prev: 'docs/guides/update-screenci',
    next: 'docs/reference/configuration',
  },
  {
    source: 'configuration.md',
    slug: 'docs/reference/configuration',
    section: 'Reference',
    order: 2,
    navLabel: 'Configuration',
    title: 'Configuration',
    description:
      'Configure project identity, file locations, rendering defaults, upload behavior, and Playwright integration in screenci.config.ts.',
    prev: 'docs/reference/cli',
    next: 'docs/reference/public-delivery-api',
  },
  {
    source: 'public-delivery-api.md',
    slug: 'docs/reference/public-delivery-api',
    section: 'Reference',
    order: 3,
    navLabel: 'Public delivery API',
    title: 'Public Delivery API',
    description:
      'Technical reference for the unauthenticated endpoints that serve published videos, thumbnails, subtitles, and metadata.',
    prev: 'docs/reference/configuration',
    next: 'docs/reference/api',
  },
] as const

export const docsSections = ['Getting Started', 'Guides', 'Reference'] as const

export function getDocBySlug(slug: string) {
  return docsManifest.find((entry) => entry.slug === slug)
}

export function getOutputPathFromSlug(slug: string) {
  const entry = getDocBySlug(slug)
  const extension = entry?.source.endsWith('.mdx') ? '.mdx' : '.md'

  if (slug === 'docs') return `index${extension}`
  return `${slug.replace(/^docs\//, '')}${extension}`
}

export function getGeneratedDocsManifest() {
  return docsManifest.map((entry) => ({
    ...entry,
    outputPath: getOutputPathFromSlug(entry.slug),
  }))
}

function toSidebarItem(entry: (typeof docsManifest)[number]) {
  return {
    label: entry.navLabel,
    slug: entry.slug,
    translations: {},
    attrs: {},
  }
}

type DocsSidebarItem = ReturnType<typeof toSidebarItem>
type TypedocSidebarItem = {
  label: string
  items?: unknown[]
  collapsed?: boolean
  translations?: Record<string, string>
  attrs?: Record<string, unknown>
}

export function getDocsSidebarConfig(
  typedocSidebarGroup?: TypedocSidebarItem | null
) {
  return docsSections.map((section) => {
    const items: Array<DocsSidebarItem | TypedocSidebarItem> = docsManifest
      .filter((entry) => entry.section === section)
      .sort((a, b) => a.order - b.order)
      .map(toSidebarItem)

    if (section === 'Reference' && typedocSidebarGroup) {
      items.push(typedocSidebarGroup)
    }

    return {
      label: section,
      translations: {},
      collapsed: false,
      items,
    }
  })
}

export function getPrevNextLinkConfig(slug: string | null) {
  if (!slug) return false
  if (slug === 'docs/reference/api') {
    return {
      label: 'Full API Reference',
      link: '/docs/reference/api',
    }
  }

  const entry = getDocBySlug(slug)
  if (!entry) {
    throw new Error(`Unknown docs slug in prev/next config: ${slug}`)
  }

  return {
    label: entry.title,
    link: `/${entry.slug}`,
  }
}
