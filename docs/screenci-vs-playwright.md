# ScreenCI vs Playwright

ScreenCI keeps the Playwright mental model and changes the goal. You are still automating a browser with locators, navigation, and page interactions, but the output is a polished video for viewers rather than an assertion-heavy verification suite.

#### You will learn

- [what stays the same from Playwright](#what-stays-the-same)
- [what ScreenCI adds for video authoring](#what-changes)
- [when to use Playwright alone](#when-to-use-playwright-alone)
- [how to move a Playwright flow into `.video.ts`](#migrating-a-playwright-flow)

## What stays the same

If you already know Playwright, most of the scripting model transfers directly:

- `page.goto()`
- `page.getByRole()`
- `locator.click()`
- `locator.fill()`
- waiting for visible UI state

ScreenCI builds on Playwright instead of replacing it.

Useful Playwright references:

- [Writing tests](https://playwright.dev/docs/writing-tests)
- [Locators](https://playwright.dev/docs/locators)
- [Codegen](https://playwright.dev/docs/codegen)

## What changes

ScreenCI adds authoring behavior around the same interactions:

- `video()` instead of `test()`
- visible pacing matters
- cursor movement and typing are animation-aware
- narration, zooming, subtitles, and assets are first-class tools
- `hide()` lets you remove setup from the viewer-facing output

## When to use Playwright alone

Stay with Playwright when your goal is:

- product verification
- assertions and regression coverage
- browser automation with no viewer-facing recording output

## When to use ScreenCI

Use ScreenCI when your goal is:

- a reusable product demo
- onboarding or documentation videos
- release and support walkthroughs
- published videos that should stay current with the app

## When to combine them

Many teams keep both in the same repository:

- Playwright tests for correctness
- ScreenCI videos for customer-facing communication

That is usually the cleanest setup when the same user flows need both validation and presentation.

## Migrating a Playwright flow

Start with a test that already demonstrates a user flow, then:

1. move it into `videos/*.video.ts`
2. replace `test()` with `video()`
3. remove assertion-heavy steps that are not part of the viewer narrative
4. hide setup with `hide()`
5. add narration and camera direction only after the visible flow works
