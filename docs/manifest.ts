/**
 * Source of truth for ScreenCI docs information architecture.
 * Slugs are web-facing and stable even if source filenames change.
 */

import { getDocVideo, hasPublicId } from './videos'

export const docsManifest = [
  {
    source: 'overview.mdx',
    slug: 'docs',
    section: 'Start here',
    order: 1,
    navLabel: 'Overview',
    title: 'Overview',
    description:
      'How ScreenCI works for the whole team: anyone makes a product video with one prompt to a coding agent, edits it in the browser, and engineers keep it fresh from the repository and CI. The service never sees your source code, and the CLI is open source.',
    prev: null,
    next: 'docs/make-videos',
  },
  {
    source: 'make-videos.md',
    slug: 'docs/make-videos',
    section: 'Start here',
    order: 2,
    navLabel: 'Make videos by prompt',
    title: 'Make Videos by Prompt',
    description:
      'Make and change product videos without touching code: every button in the web app hands your coding agent a one-time setup code, and the browser opens the result when the recording lands.',
    prev: 'docs',
    next: 'docs/roles',
  },
  {
    source: 'roles.md',
    slug: 'docs/roles',
    section: 'Start here',
    order: 3,
    navLabel: 'Who does what',
    title: 'Who Does What',
    description:
      'Who does what with ScreenCI: product marketing, docs and support, and engineering each get their buttons, their outcomes, and the things they never have to do again.',
    prev: 'docs/make-videos',
    next: 'docs/prompt-cookbook',
  },
  {
    source: 'prompt-cookbook.md',
    slug: 'docs/prompt-cookbook',
    section: 'Start here',
    order: 4,
    navLabel: 'Prompt cookbook',
    title: 'Prompt Cookbook',
    description:
      'Example descriptions for every button, per role, plus what makes a description work: name the flow, the end state, the audience, and what to skip.',
    prev: 'docs/roles',
    next: 'docs/editor',
  },
  {
    source: 'editor.md',
    slug: 'docs/editor',
    section: 'For the team',
    order: 1,
    navLabel: 'Edit in the browser',
    title: 'Edit in the Browser',
    description:
      'Edit videos in the browser without touching code: live preview, timeline cuts and pacing, narration and voices, overlays, languages, and render options. Every plan includes the editor for the whole team.',
    prev: 'docs/prompt-cookbook',
    next: 'docs/guides/narration',
  },
  {
    source: 'narration.md',
    slug: 'docs/guides/narration',
    section: 'For the team',
    order: 2,
    navLabel: 'Narration and voices',
    title: 'Narration and Voices',
    description:
      'Attach spoken cues to a video, overlap narration with visible UI motion, choose voices, use speech markup, and connect ElevenLabs for custom voices.',
    prev: 'docs/editor',
    next: 'docs/guides/languages',
  },
  {
    source: 'languages.md',
    slug: 'docs/guides/languages',
    section: 'For the team',
    order: 3,
    navLabel: 'Languages',
    title: 'Languages',
    description:
      'Record per-language video versions from one script: set browser locale automatically, localize narration and overlays, and control the recording mode.',
    prev: 'docs/guides/narration',
    next: 'docs/guides/overlays',
  },
  {
    source: 'overlays.md',
    slug: 'docs/guides/overlays',
    section: 'For the team',
    order: 4,
    navLabel: 'Overlays',
    title: 'Overlays',
    description:
      'Add intro clips, corner logos, transitions, and timed overlays to ScreenCI recordings from files, HTML, or React.',
    prev: 'docs/guides/languages',
    next: 'docs/guides/branding',
  },
  {
    source: 'branding.md',
    slug: 'docs/guides/branding',
    section: 'For the team',
    order: 5,
    navLabel: 'Branding',
    title: 'Branding',
    description:
      'The look and voice every new video starts from: background, output size, cursor and default narration voice per organisation, shared image and video assets referenced by name, per-project overrides, cloned voice samples, the ElevenLabs API key, and how coding agents apply the branding.',
    prev: 'docs/guides/overlays',
    next: 'docs/guides/ai-context',
  },
  {
    source: 'ai-context.md',
    slug: 'docs/guides/ai-context',
    section: 'For the team',
    order: 6,
    navLabel: 'AI context',
    title: 'AI Context',
    description:
      'What coding agents learn about your product before they record: the repository, the site URL, whether they may start the app, whether it needs a sign-in, team notes, per-project overrides, and moving sources into the repository.',
    prev: 'docs/guides/branding',
    next: 'docs/guides/screenshots',
  },
  {
    source: 'screenshots.md',
    slug: 'docs/guides/screenshots',
    section: 'For the team',
    order: 7,
    navLabel: 'Screenshots',
    title: 'Screenshots',
    description:
      'Capture branded still screenshots with the screenshot() fixture: crop to a component, set quality and dark mode, and frame the shot on a background with overlays.',
    prev: 'docs/guides/ai-context',
    next: 'docs/guides/public-urls-and-embeds',
  },
  {
    source: 'public-urls-and-embeds.md',
    slug: 'docs/guides/public-urls-and-embeds',
    section: 'For the team',
    order: 8,
    navLabel: 'Public URLs and embeds',
    title: 'Public URLs and Embeds',
    description:
      'Enable public delivery for a video, understand stable language-specific URLs, and embed ScreenCI outputs in other sites.',
    prev: 'docs/guides/screenshots',
    next: 'docs/guides/version-history',
  },
  {
    source: 'version-history.md',
    slug: 'docs/guides/version-history',
    section: 'For the team',
    order: 9,
    navLabel: 'Version history',
    title: 'Version History',
    description:
      'Every render is kept as a version. Select which one a public URL serves, roll back to an earlier render, and understand per-language retention. Paid feature.',
    prev: 'docs/guides/public-urls-and-embeds',
    next: 'docs/guides/organisation',
  },
  {
    source: 'organisation.md',
    slug: 'docs/guides/organisation',
    section: 'For the team',
    order: 10,
    navLabel: 'Organisation and SSO',
    title: 'Organisation and SSO',
    description:
      'Manage organisation members and roles, and enforce single sign-on with SAML through your own identity provider. SSO and member management are a Business feature.',
    prev: 'docs/guides/version-history',
    next: 'docs/guides/signing-in',
  },
  {
    source: 'signing-in.md',
    slug: 'docs/guides/signing-in',
    section: 'For the team',
    order: 11,
    navLabel: 'Signing in to your app',
    title: 'Signing In to Your App',
    description:
      'Record an app that needs a login: sign in once in a real browser, and every recording replays that session. Works with two-factor, single sign-on, passkeys, and magic links, and ScreenCI never receives your credentials.',
    prev: 'docs/guides/organisation',
    next: 'docs/guides/anonymous-trial',
  },
  {
    source: 'anonymous-trial.md',
    slug: 'docs/guides/anonymous-trial',
    section: 'For the team',
    order: 12,
    navLabel: 'Free trial without an account',
    title: 'Free Trial Without an Account',
    description:
      'Record, preview, and edit without an account: what the anonymous trial allows, its limits (preview-only, no exports), and how signing up claims the trial and unlocks exporting.',
    prev: 'docs/guides/signing-in',
    next: 'docs/repository-and-ci',
  },
  {
    source: 'repository-and-ci.md',
    slug: 'docs/repository-and-ci',
    section: 'Code and CI',
    order: 1,
    navLabel: 'Repository and CI',
    title: 'Repository and CI',
    description:
      'Get the videos into the repository and CI: Add to repository commits the scripts, Add to CI records on every push, and a video whose flow broke fails the run before customers see it stale.',
    prev: 'docs/guides/anonymous-trial',
    next: 'docs/agent-integration',
  },
  {
    source: 'agent-integration.mdx',
    slug: 'docs/agent-integration',
    section: 'Code and CI',
    order: 2,
    navLabel: 'Start in a repository',
    title: 'Start in a Repository',
    description:
      'The engineer path: paste the integration prompt into a coding agent inside your repository so it scaffolds ScreenCI, authors a video for your flow, and records it.',
    prev: 'docs/repository-and-ci',
    next: 'docs/manual-setup',
  },
  {
    source: 'video-script-basics.md',
    slug: 'docs/video-script-basics',
    section: 'Code and CI',
    order: 4,
    navLabel: 'Video script basics',
    title: 'Video Script Basics',
    description:
      'Author .screenci.ts files with Playwright-like APIs, ScreenCI narration and camera helpers, and workflow-aware pacing.',
    prev: 'docs/manual-setup',
    next: 'docs/ci-setup',
  },
  {
    source: 'animated-interactions.md',
    slug: 'docs/guides/animated-interactions',
    section: 'Code and CI',
    order: 7,
    navLabel: 'Animated interactions',
    title: 'Animated Interactions',
    description:
      'Understand how ScreenCI instruments the Playwright page so visible actions like clicks, typing, mouse movement, and scrolling are animated.',
    prev: 'docs/pr-previews',
    next: 'docs/guides/camera-and-zooming',
  },
  {
    source: 'camera-and-zooming.md',
    slug: 'docs/guides/camera-and-zooming',
    section: 'Code and CI',
    order: 8,
    navLabel: 'Camera and zooming',
    title: 'Camera and Zooming',
    description:
      'Choose between autoZoom and manual framing, and use camera direction to guide attention without making the video frantic.',
    prev: 'docs/guides/animated-interactions',
    next: 'docs/guides/overlay-updates',
  },
  {
    source: 'overlay-updates.md',
    slug: 'docs/guides/overlay-updates',
    section: 'Code and CI',
    order: 9,
    navLabel: 'Mid-video overlay updates',
    title: 'Mid-Video Overlay Updates',
    description:
      'Resize, hide, and show the recording frame and narration bubble mid-video with animated transitions, and fade overlays in and out.',
    prev: 'docs/guides/camera-and-zooming',
    next: 'docs/guides/redact',
  },
  {
    source: 'redact.md',
    slug: 'docs/guides/redact',
    section: 'Code and CI',
    order: 10,
    navLabel: 'Redact sensitive content',
    title: 'Redact Sensitive Content',
    description:
      'Keep secrets out of a recording with redact: mask locators, typed values, and always-secret elements in the page before the frame is captured, so they are never uploaded.',
    prev: 'docs/guides/overlay-updates',
    next: 'docs/guides/screen-audio',
  },
  {
    source: 'screen-audio.md',
    slug: 'docs/guides/screen-audio',
    section: 'Code and CI',
    order: 11,
    navLabel: 'Screen audio',
    title: 'Screen Audio',
    description:
      'Capture system audio alongside the screen recording and mix it into the rendered video. Linux only, with an automatic, isolated per-worker capture sink.',
    prev: 'docs/guides/redact',
    next: 'docs/guides/update-screenci',
  },
  {
    source: 'ci-setup.md',
    slug: 'docs/ci-setup',
    section: 'Code and CI',
    order: 5,
    navLabel: 'CI setup',
    title: 'CI Setup',
    description:
      'Understand the generated GitHub Actions workflow, required secrets, and how to keep CI recordings deterministic.',
    prev: 'docs/video-script-basics',
    next: 'docs/pr-previews',
  },
  {
    source: 'pr-previews.md',
    slug: 'docs/pr-previews',
    section: 'Code and CI',
    order: 6,
    navLabel: 'Pull request previews',
    title: 'Pull Request Previews',
    description:
      'Every pull request re-records the videos and posts a check run and a comment with the previews. Approve in ScreenCI, and merging serves exactly the reviewed versions.',
    prev: 'docs/ci-setup',
    next: 'docs/guides/animated-interactions',
  },
  {
    source: 'manual-setup.mdx',
    slug: 'docs/manual-setup',
    section: 'Code and CI',
    order: 3,
    navLabel: 'Manual setup',
    title: 'Manual Setup',
    description:
      'Wire ScreenCI up by hand: initialize a project, run the starter video locally, and record your first final video.',
    prev: 'docs/agent-integration',
    next: 'docs/video-script-basics',
  },
  {
    source: 'update-screenci.mdx',
    slug: 'docs/guides/update-screenci',
    section: 'Code and CI',
    order: 12,
    navLabel: 'Update ScreenCI',
    title: 'Update ScreenCI',
    description:
      'Upgrade the screenci package, refresh Playwright when needed, and verify that existing videos still behave as expected.',
    prev: 'docs/guides/screen-audio',
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
  // Audience-based: anyone on the team starts here, the browser editing and
  // publishing guides follow, and the code path (scripts in the repository,
  // manual setup, CI recording) comes after because most videos are made by
  // prompt.
  'Start here',
  'For the team',
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
