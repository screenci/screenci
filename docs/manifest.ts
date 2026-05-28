/**
 * Source of truth for ScreenCI docs information architecture.
 * Slugs are web-facing and stable even if source filenames change.
 */

export const docsManifest = [
  {
    source: 'installation.mdx',
    slug: 'docs',
    section: 'Getting Started',
    order: 1,
    navLabel: 'Installation & first video',
    title: 'Installation & First Video',
    description:
      'Install ScreenCI, initialize a project, run the starter video locally, and record your first final video.',
    prev: null,
    next: 'docs/generating-videos',
  },
  {
    source: 'generating-videos.mdx',
    slug: 'docs/generating-videos',
    section: 'Getting Started',
    order: 2,
    navLabel: 'Generating videos',
    title: 'Generating Videos',
    description:
      'Use Playwright codegen and AI-assisted workflows to generate a first ScreenCI draft, then refine it into a real video script.',
    prev: 'docs',
    next: 'docs/write-video-scripts',
  },
  {
    source: 'write-video-scripts.md',
    slug: 'docs/write-video-scripts',
    section: 'Getting Started',
    order: 3,
    navLabel: 'Video script basics',
    title: 'Video Script Basics',
    description:
      'Author .video.ts files with Playwright-like APIs, ScreenCI narration and camera helpers, and workflow-aware pacing.',
    prev: 'docs/generating-videos',
    next: 'docs/ci-setup',
  },
  {
    source: 'ci-setup.md',
    slug: 'docs/ci-setup',
    section: 'Getting Started',
    order: 4,
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
    navLabel: 'Assets and overlays',
    title: 'Assets and Overlays',
    description:
      'Add intro clips, corner logos, transition assets, and timed overlays to ScreenCI recordings.',
    prev: 'docs/guides/camera-and-zooming',
    next: 'docs/guides/public-urls-and-embeds',
  },
  {
    source: 'public-urls-and-embeds.md',
    slug: 'docs/guides/public-urls-and-embeds',
    section: 'Guides',
    order: 5,
    navLabel: 'Public URLs and embeds',
    title: 'Public URLs and Embeds',
    description:
      'Enable public delivery for a video, understand stable language-specific URLs, and embed ScreenCI outputs in other sites.',
    prev: 'docs/guides/assets-and-overlays',
    next: 'docs/guides/update-screenci',
  },
  {
    source: 'update-screenci.mdx',
    slug: 'docs/guides/update-screenci',
    section: 'Guides',
    order: 6,
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
    section: 'Guides',
    order: 7,
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
    section: 'Guides',
    order: 8,
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
    section: 'Guides',
    order: 9,
    navLabel: 'Public delivery API',
    title: 'Public Delivery API',
    description:
      'Technical reference for the unauthenticated endpoints that serve published videos, thumbnails, subtitles, and metadata.',
    prev: 'docs/reference/configuration',
    next: 'docs/reference/api',
  },
] as const

export const docsSections = ['Getting Started', 'Guides'] as const

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

    if (section === 'Guides' && typedocSidebarGroup) {
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
