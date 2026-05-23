# Generating Videos

Use this page when you want help producing a first draft quickly, whether that draft comes from an AI agent working from source code, an AI agent working from a live URL, or Playwright codegen.

#### You will learn

- [how to generate a video from source code](#ai-generation-based-on-source-code)
- [how to generate a video from a live URL](#ai-generation-based-on-url-with-playwright-cli)
- [how to use Playwright codegen as a starter tool](#playwright-codegen)

## AI generation based on source code

This is usually the best path when the app you want to show already lives in the same repository.

The agent can inspect routes, labels, components, and state logic directly from source instead of guessing everything from browser behavior alone.

Good setup:

- initialize ScreenCI inside the existing repository
- accept the ScreenCI skill install during `screenci init`, or run `npx -y skills add screenci/screenci --skill screenci -y` later
- open the repository root in the editor, not just `screenci/`
- point the agent at the routes and components that define the flow
- ask it to write the final `videos/*.video.ts` script directly

Example prompt for a repo-based workflow:

```text
Create a ScreenCI video for the onboarding flow.

Inspect @src/routes/onboarding and @src/components/signup-form.tsx.
Write the final script in @screenci/videos/onboarding.video.ts.
Keep setup inside hide().
Add concise narration and iterate with npx screenci test.
```

This is usually faster and more reliable than URL-only exploration because the agent can inspect the real application structure before it writes selectors and narration.

## AI generation based on URL with `playwright-cli`

Use this path when you want to create a video from a live site and do not have the application source code in the same repo.

Here the agent should inspect the real site first, confirm the clean visible path, and only then write the ScreenCI script.

Good setup:

- initialize a standalone ScreenCI project
- accept the ScreenCI skill install during `screenci init`, or run `npx -y skills add screenci/screenci --skill screenci -y` later
- accept the optional `playwright-cli` install during `screenci init`, or run `npx -y skills add screenci/screenci --skill playwright-cli -y` and `npm install @playwright/cli` later
- inspect the live site before writing the script
- use `playwright-cli` to confirm selectors and visible flow
- keep cookie handling and other setup inside `hide()`

Example prompt for a deployed-site workflow:

```text
Create a ScreenCI video for https://screenci.com that shows how to export a report.

Inspect the live site first with playwright-cli, then write the final ScreenCI script in videos/export-report.video.ts.
Keep setup hidden and use narration only where it improves the walkthrough.
```

This works best when the prompt clearly names the URL to inspect, the output file to create, and what setup should stay hidden from the final video.

## Playwright codegen

This is the ScreenCI equivalent of Playwright's [Generating tests](https://playwright.dev/docs/codegen-intro). Use it when you want to inspect a live flow, capture the basic interactions, and harvest strong locators quickly.

Run it with:

```bash
npx playwright codegen https://screenci.com
```

Codegen opens a browser window and the Playwright Inspector. As you click, type, and navigate, it generates Playwright actions for the flow.

That is not a final ScreenCI video yet, but it is often the fastest way to get:

- a first pass at navigation and interactions
- role-based and text-based locators
- a concrete visible path through the app

Treat codegen output as raw material, not final authoring.

When you bring a generated flow into ScreenCI:

1. use Playwright codegen to inspect the real flow
2. move the useful actions into `videos/*.video.ts`
3. replace generic test framing with `video()`
4. hide setup and authentication with `hide()`
5. simplify noisy steps that do not help the viewer
6. add narration and pacing only after the interaction flow is correct

The goal is a clean viewer-facing sequence, not a literal copy of every interaction codegen captured.
