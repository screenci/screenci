# Write Video Scripts

ScreenCI videos use the same syntax as [Playwright tests](https://playwright.dev/docs/writing-tests),
but replace test assertions with video-specific behavior such as narration,
camera movement, and visible pacing.

#### You will learn

- [how to structure a `.video.ts` file](#anatomy-of-a-video-script)
- [how to navigate and interact](#author-with-locators)
- [how ScreenCI behavior differs from plain Playwright](#what-screenci-changes)
- [how to control visible pacing](#control-pacing)

## Generated starter video

This example is generated from [Installation](/docs) at
`videos/example.video.ts`.

<!-- screenci-doc-code-sample:starter-video:start -->

```ts
import { autoZoom, createNarration, hide, video, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Sophie },
  en: {
    docs: 'Here is where to find ScreenCI [pronounce: screen see eye] docs.',
  },
  es: {
    docs: 'Aqui es donde encontrar la documentacion de ScreenCI [pronounce: screen see eye].',
  },
})

video('How to find docs', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/')
    await page.waitForLoadState('networkidle')
  })

  await narration.docs()

  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })
})
```

<!-- screenci-doc-code-sample:starter-video:end -->

This script shows the main building blocks of a ScreenCI video:

- imports from `screenci`
- one or more `video()` calls
- Playwright-style `page` interactions
- narration created with `createNarration()`: in the starter example above,
  `en.docs` defines the English script and `es.docs` defines the Spanish
  translation. Calling `await narration.docs()` uses the matching cue text for
  whichever language version is currently being rendered, so the visible page
  flow stays the same while only the spoken and subtitle text changes.
- a hidden setup block when the visible recording should start from a ready
  state
- optional helpers such as `autoZoom()` to direct attention during visible
  interactions

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

Unlike a regular `playwright/test` test, `video()` gives you an instrumented
Playwright `page` so visible interactions look like a recording instead of a
robotic test:

- cursor moves are animated
- typing is visible

Most standard Playwright APIs still work as expected, including navigation,
locators, waiting, keyboard input, and assertions from `@playwright/test`.

## Helper APIs

### `hide()`

Use `hide()` to keep setup out of the visible recording. See [Setup vs visible
sequence](#setup-vs-visible-sequence) and [Generating
Videos](/docs/generating-videos).

### `autoZoom()`

Use `autoZoom()` when the camera should follow a visible interaction
automatically. See [Camera and Zooming](/docs/camera-and-zooming).

### `zoomTo()`

Use `zoomTo()` when you want exact manual framing. See [Camera and
Zooming](/docs/camera-and-zooming).

### `createNarration()`

Use `createNarration()` to define narration cues and language variants. See
[Narration and Localization](/docs/narration-and-localization).

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
