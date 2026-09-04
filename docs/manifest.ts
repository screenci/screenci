/**
 * Source of truth for ScreenCI docs information architecture.
 * Slugs are web-facing and stable even if source filenames change.
 */

import { getDocVideo, hasPublicId } from './videos'

export const docsManifest = [
  {
    source: 'overview.mdx',
    slug: 'docs',
    section: 'Getting Started',
    order: 1,
    navLabel: 'Overview',
    title: 'Overview',
    description:
      "How ScreenCI works: record locally, refine in the web editor, export in the service, and serve from a CDN. The service never sees your app's source code, and the CLI is open source.",
    prev: null,
    next: 'docs/guides/create-from-web-app',
  },
  {
    source: 'agent-integration.mdx',
    slug: 'docs/agent-integration',
    section: 'Getting Started',
    order: 3,
    navLabel: 'Agent integration',
    title: 'Agent Integration',
    description:
      'The recommended path: point a coding agent at the integration brief so it scaffolds ScreenCI, authors a video for your flow, and records it.',
    prev: 'docs/guides/create-from-web-app',
    next: 'docs/editor',
  },
  {
    source: 'manual-setup.mdx',
    slug: 'docs/manual-setup',
    section: 'Code and CI',
    order: 1,
    navLabel: 'Manual setup & first video',
    title: 'Manual Setup & First Video',
    description:
      'Wire ScreenCI up by hand: initialize a project, run the starter video locally, and record your first final video.',
    prev: 'docs/guides/signing-in',
    next: 'docs/video-script-basics',
  },
  {
    source: 'video-script-basics.md',
    slug: 'docs/video-script-basics',
    section: 'Code and CI',
    order: 2,
    navLabel: 'Video script basics',
    title: 'Video Script Basics',
    description:
      'Author .screenci.ts files with Playwright-like APIs, ScreenCI narration and camera helpers, and workflow-aware pacing.',
    prev: 'docs/manual-setup',
    next: 'docs/guides/animated-interactions',
  },
  {
    source: 'editor.md',
    slug: 'docs/editor',
    section: 'Getting Started',
    order: 4,
    navLabel: 'Editor',
    title: 'Editor',
    description:
      'Edit videos visually in the web app: live preview, timeline cuts and pacing, narration, overlays, and render options. With screenci preview connected, edits are written back into your script, and Export renders the finished video.',
    prev: 'docs/agent-integration',
    next: 'docs/guides/ai-context',
  },
  {
    source: 'ci-setup.md',
    slug: 'docs/ci-setup',
    section: 'Code and CI',
    order: 4,
    navLabel: 'CI setup',
    title: 'CI Setup',
    description:
      'Understand the generated GitHub Actions workflow, required secrets, and how to keep CI recordings deterministic.',
    prev: 'docs/guides/animated-interactions',
    next: 'docs/guides/update-screenci',
  },
  {
    source: 'animated-interactions.md',
    slug: 'docs/guides/animated-interactions',
    section: 'Code and CI',
    order: 3,
    navLabel: 'Animated interactions',
    title: 'Animated Interactions',
    description:
      'Understand how ScreenCI instruments the Playwright page so visible actions like clicks, typing, mouse movement, and scrolling are animated.',
    prev: 'docs/video-script-basics',
    next: 'docs/ci-setup',
  },
  // The Keyboard Shortcuts guide (docs/guides/keyboard-shortcuts) was removed
  // for release along with the shortcut selection surfaces: its source moved
  // to docs/removed/keyboard-shortcuts.md at the repo root.
  {
    source: 'narration.md',
    slug: 'docs/guides/narration',
    section: 'Fixtures',
    order: 1,
    navLabel: 'Narration',
    title: 'Narration',
    description:
      'Attach spoken cues to a video, overlap narration with visible UI motion, choose voices, use speech markup, and connect ElevenLabs for custom voices.',
    prev: 'docs/guides/branding',
    next: 'docs/guides/overlays',
  },
  // The Values (docs/guides/values), Audio (docs/guides/audio), and Render
  // dependencies (docs/guides/dependencies) docs were removed for release:
  // the features are unfinished and no longer exported. Their sources moved to
  // docs/removed/ at the repo root.
  {
    source: 'overlays.md',
    slug: 'docs/guides/overlays',
    section: 'Fixtures',
    order: 2,
    navLabel: 'Overlays',
    title: 'Overlays',
    description:
      'Add intro clips, corner logos, transitions, and timed overlays to ScreenCI recordings from files, HTML, or React.',
    prev: 'docs/guides/narration',
    next: 'docs/guides/languages',
  },
  {
    source: 'languages.md',
    slug: 'docs/guides/languages',
    section: 'Fixtures',
    order: 3,
    navLabel: 'Languages',
    title: 'Languages',
    description:
      'Record per-language video versions from one script: set browser locale automatically, localize narration and overlays, and control the recording mode.',
    prev: 'docs/guides/overlays',
    next: 'docs/guides/camera-and-zooming',
  },
  {
    source: 'camera-and-zooming.md',
    slug: 'docs/guides/camera-and-zooming',
    section: 'Guides',
    order: 1,
    navLabel: 'Camera and zooming',
    title: 'Camera and Zooming',
    description:
      'Choose between autoZoom and manual framing, and use camera direction to guide attention without making the video frantic.',
    prev: 'docs/guides/languages',
    next: 'docs/guides/overlay-updates',
  },
  {
    source: 'overlay-updates.md',
    slug: 'docs/guides/overlay-updates',
    section: 'Guides',
    order: 2,
    navLabel: 'Mid-video overlay updates',
    title: 'Mid-Video Overlay Updates',
    description:
      'Resize, hide, and show the recording frame and narration bubble mid-video with animated transitions, and fade overlays in and out.',
    prev: 'docs/guides/camera-and-zooming',
    next: 'docs/guides/screenshots',
  },
  {
    source: 'screenshots.md',
    slug: 'docs/guides/screenshots',
    section: 'Guides',
    order: 3,
    navLabel: 'Screenshots',
    title: 'Screenshots',
    description:
      'Capture branded still screenshots with the screenshot() fixture: crop to a component, set quality and dark mode, and frame the shot on a background with overlays.',
    prev: 'docs/guides/overlay-updates',
    next: 'docs/guides/public-urls-and-embeds',
  },
  {
    source: 'public-urls-and-embeds.md',
    slug: 'docs/guides/public-urls-and-embeds',
    section: 'Guides',
    order: 4,
    navLabel: 'Public URLs and embeds',
    title: 'Public URLs and Embeds',
    description:
      'Enable public delivery for a video, understand stable language-specific URLs, and embed ScreenCI outputs in other sites.',
    prev: 'docs/guides/screenshots',
    next: 'docs/guides/redact',
  },
  {
    source: 'redact.md',
    slug: 'docs/guides/redact',
    section: 'Guides',
    order: 5,
    navLabel: 'Redact sensitive content',
    title: 'Redact Sensitive Content',
    description:
      'Keep secrets out of a recording with redact: mask locators, typed values, and always-secret elements in the page before the frame is captured, so they are never uploaded.',
    prev: 'docs/guides/public-urls-and-embeds',
    next: 'docs/guides/screen-audio',
  },
  {
    source: 'screen-audio.md',
    slug: 'docs/guides/screen-audio',
    section: 'Guides',
    order: 6,
    navLabel: 'Screen audio',
    title: 'Screen Audio',
    description:
      'Capture system audio alongside the screen recording and mix it into the rendered video. Linux only, with an automatic, isolated per-worker capture sink.',
    prev: 'docs/guides/redact',
    next: 'docs/guides/version-history',
  },
  {
    source: 'update-screenci.mdx',
    slug: 'docs/guides/update-screenci',
    section: 'Code and CI',
    order: 5,
    navLabel: 'Update ScreenCI',
    title: 'Update ScreenCI',
    description:
      'Upgrade the screenci package, refresh Playwright when needed, and verify that existing videos still behave as expected.',
    prev: 'docs/ci-setup',
    next: 'docs/reference/cli',
  },
  {
    source: 'version-history.md',
    slug: 'docs/guides/version-history',
    section: 'Guides',
    order: 7,
    navLabel: 'Version history',
    title: 'Version History',
    description:
      'Every render is kept as a version. Select which one a public URL serves, roll back to an earlier render, and understand per-language retention. Paid feature.',
    prev: 'docs/guides/screen-audio',
    next: 'docs/guides/organisation',
  },
  {
    source: 'organisation.md',
    slug: 'docs/guides/organisation',
    section: 'Guides',
    order: 8,
    navLabel: 'Organisation & SSO',
    title: 'Organisation & SSO',
    description:
      'Manage organisation members and roles, and enforce single sign-on with SAML through your own identity provider. SSO and member management are a Business feature.',
    prev: 'docs/guides/version-history',
    next: 'docs/guides/anonymous-trial',
  },
  {
    source: 'anonymous-trial.md',
    slug: 'docs/guides/anonymous-trial',
    section: 'Guides',
    order: 9,
    navLabel: 'Anonymous trial',
    title: 'Anonymous Trial',
    description:
      'Record, preview, and edit without an account: what the anonymous trial allows, its limits (preview-only, no exports), and how signing up claims the trial and unlocks exporting.',
    prev: 'docs/guides/organisation',
    next: 'docs/guides/signing-in',
  },
  {
    source: 'create-from-web-app.md',
    slug: 'docs/guides/create-from-web-app',
    section: 'Getting Started',
    order: 2,
    navLabel: 'Create from the web app',
    title: 'Create Videos from the Web App',
    description:
      'Make and change videos without a repository: the Add project, Add video, and Edit buttons hand your coding agent a one-time setup code, and the browser opens the result when the recording lands.',
    prev: 'docs',
    next: 'docs/agent-integration',
  },
  {
    source: 'ai-context.md',
    slug: 'docs/guides/ai-context',
    section: 'Getting Started',
    order: 5,
    navLabel: 'AI context',
    title: 'AI Context',
    description:
      'What coding agents learn about your product before they record: the repository, the site URL, whether they may start the app, whether it needs a sign-in, team notes, per-project overrides, and moving sources into the repository.',
    prev: 'docs/editor',
    next: 'docs/guides/branding',
  },
  {
    source: 'signing-in.md',
    slug: 'docs/guides/signing-in',
    section: 'Guides',
    order: 10,
    navLabel: 'Signing in',
    title: 'Signing In to Your App',
    description:
      'Record an app that needs a login: sign in once in a real browser, and every recording replays that session. Works with two-factor, single sign-on, passkeys, and magic links, and ScreenCI never receives your credentials.',
    prev: 'docs/guides/anonymous-trial',
    next: 'docs/manual-setup',
  },
  {
    source: 'branding.md',
    slug: 'docs/guides/branding',
    section: 'Getting Started',
    order: 6,
    navLabel: 'Branding',
    title: 'Branding',
    description:
      'The look and voice every new video starts from: background, output size, cursor and default narration voice per organisation, shared image and video assets referenced by name, per-project overrides, cloned voice samples, the ElevenLabs API key, and how coding agents apply the branding.',
    prev: 'docs/guides/ai-context',
    next: 'docs/guides/narration',
  },
  {
    source: 'cli.mdx',
    slug: 'docs/reference/cli',
    section: 'Reference',
    order: 1,
    navLabel: 'CLI',
    title: 'CLI',
    description:
      'Command reference for screenci start, context, login, logout, merge-complete, init, test, preview, export, project info, and public delivery commands.',
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

// The SCREENCI_ENABLE_AUDIO_VALUES_DOCS env flag used to gate the audio and
// values docs from the sidebar. Those docs are now removed from the manifest
// entirely (see docs/removed/ at the repo root), so every remaining doc is
// visible.
function isSidebarVisibleDoc(entry: (typeof docsManifest)[number]) {
  void entry
  return true
}

export const docsSections = [
  'Getting Started',
  'Fixtures',
  'Guides',
  // The code path: writing `.screenci.ts` by hand and running it from CI. It
  // sits after the product guides because the agent and web-app flows are how
  // most videos are made; this is for teams that want the scripts in the repo.
  'Code and CI',
  'Reference',
] as const

export function getDocBySlug(slug: string) {
  return docsManifest.find((entry) => entry.slug === slug)
}

export function getOutputPathFromSlug(slug: string) {
  const entry = getDocBySlug(slug)
  const video = getDocVideo(slug)

  // A page that embeds a published video or screenshot injects a React
  // component (DocVideoPlayer / DocScreenshot). Astro only renders component
  // imports and JSX in .mdx, so such a page must be emitted as .mdx even when
  // its source is plain .md. Without this, the embed silently renders as inert
  // text. Pages without a published embed stay .md (matching their source).
  const embedsComponent = video !== null && hasPublicId(video)
  const extension =
    entry?.source.endsWith('.mdx') || embedsComponent ? '.mdx' : '.md'

  if (slug === 'docs') return `index${extension}`
  return `${slug.replace(/^docs\//, '')}${extension}`
}

export function getGeneratedDocsManifest() {
  return docsManifest.map((entry) => ({
    ...entry,
    outputPath: getOutputPathFromSlug(entry.slug),
  }))
}

export function getVisibleDocsManifest() {
  return docsManifest.filter(isSidebarVisibleDoc)
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
      .filter(isSidebarVisibleDoc)
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
