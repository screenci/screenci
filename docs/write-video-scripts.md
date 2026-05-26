# Write Video Scripts

This page does the same job as Playwright's
[Writing tests](https://playwright.dev/docs/writing-tests), but for ScreenCI
videos instead of assertion-heavy tests. Video scripts are Playwright-style
files with ScreenCI-specific behavior around pacing, narration, and camera
direction.

#### You will learn

- [how to structure a `.video.ts` file](#anatomy-of-a-video-script)
- [how to navigate and interact](#author-with-locators)
- [how ScreenCI behavior differs from plain Playwright](#what-screenci-changes)
- [how to control visible pacing](#control-pacing)

## Minimal example

```ts
import { autoZoom, createNarration, hide, video, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Sophie },
  languages: {
    en: {
      cues: {
        intro:
          'This video shows how to get started with ScreenCI [pronounce: screen see eye].',
        docs: 'You can find the documentation linked right on the front page.',
      },
    },
  },
})

video('How to get started', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://screenci.com')
    await page.waitForLoadState('networkidle')
  })

  await narration.intro()
  await narration.docs()

  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })

  await page.waitForURL('**/docs/installation')
})
```

## Anatomy of a video script

Most ScreenCI files have the same building blocks:

- imports from `screenci`
- one or more `video()` calls
- Playwright-style `page` interactions
- a hidden setup block when the visible recording should start from a ready
  state

Each `video('Title', ...)` call defines one video, which can include multiple
language versions. Keep titles stable unless you intentionally want a new
video.

## Author with locators

Prefer the same locator style you would use in a reliable Playwright test:

```ts
await page.getByRole('button', { name: 'Invite teammate' }).click()
await page.getByLabel('Email').fill('jane@screenci.com')
```

Role-based and label-based locators usually age better than CSS selectors
copied from transient DOM structure. If you need a refresher, use Playwright's
[Locators](https://playwright.dev/docs/locators) guide.

## What ScreenCI changes

Inside `video()`, ScreenCI wraps the normal Playwright page and locators so
visible interactions look like a recording instead of a robotic test:

- cursor moves are animated
- typing is visible
- helper APIs such as `hide()`, `autoZoom()`, `zoomTo()`, and
  `createNarration()` integrate with the recording timeline

Most standard Playwright APIs still work as expected, including navigation,
locators, waiting, keyboard input, and assertions from `@playwright/test`.

## Setup vs visible sequence

Keep setup out of the final video when it does not help the viewer:

```ts
await hide(async () => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(process.env.DEMO_EMAIL!)
  await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
})
```

Then let the visible sequence begin where the viewer would want to start
watching.

## Control pacing

<!-- screenci-doc-video:docs/write-video-scripts -->

Visible pacing is part of authoring quality.

Prefer:

- waiting for the UI the viewer should actually see
- narration overlap when speech and motion should happen together
- short explicit pauses only when the viewer needs breathing room

Use `waitForTimeout()` deliberately, not as a substitute for state-based
synchronization. The same Playwright advice applies here:
[Auto-waiting](https://playwright.dev/docs/actionability) first, explicit pause
only when the pause is part of the video.

## Multiple videos per project

Create more than one `.video.ts` file when the flows are distinct:

```text
videos/
  onboarding.video.ts
  admin-billing.video.ts
  changelog.video.ts
```

That keeps each video focused and makes iteration easier.

## Relation to Playwright APIs

Use ScreenCI for the viewer-facing layer and Playwright for the browser
automation layer underneath. When you need a deeper method, check the standard
Playwright docs first, then add ScreenCI helpers only where the recording needs
them.

## What's next

- [Generating Videos](/docs/generating-videos) if you want a first draft
  faster.
- [Narration and Localization](/docs/guides/narration-and-localization) for
  spoken cues.
- [Camera and Zooming](/docs/guides/camera-and-zooming) for framing.
