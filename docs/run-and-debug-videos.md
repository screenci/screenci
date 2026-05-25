# Run and Debug Videos

`screenci test` is the main iteration command for ScreenCI authors. Use it the
way Playwright users use `playwright test`: run the script locally, tighten the
flow, then switch to `record` only when the visible sequence is ready.

#### You will learn

- [how to run video scripts locally](#run-the-local-authoring-loop)
- [how to iterate before recording](#test-vs-record)
- [how to debug selector and timing issues](#debug-visible-pacing)
- [how to inspect failures and artifacts](#artifacts-and-traces)

## Run the local authoring loop

Use the default command first:

```bash
npx screenci test
```

ScreenCI resolves `screenci.config.ts`, discovers `*.video.ts` files, and runs
them without starting the full local capture and upload flow.

It also forwards normal Playwright arguments, so the Playwright docs for
[Running tests](https://playwright.dev/docs/running-tests) still apply to file
filters, `--grep`, projects, and UI mode.

## `test` vs `record`

Use `test` when you are still changing the script:

- it is faster
- animated recording-only pacing is skipped by default
- there is no final recording upload step

Use `record` when you want the final timing and rendered output.

If you need recording-like timing without starting the real recording pipeline,
use:

```bash
npx screenci test --mock-record
```

## Run one file or a subset

<!-- screenci-doc-video:docs/run-and-debug-videos -->

`screenci test` forwards normal Playwright arguments, so you can narrow the run
while iterating:

```bash
npx screenci test videos/onboarding.video.ts
npx screenci test --grep "billing"
npx screenci test --ui
```

That makes it practical to work on one video at a time in larger projects.

`--ui` uses Playwright UI Mode. See
[Playwright UI Mode](https://playwright.dev/docs/test-ui-mode).

## Debug visible pacing

For ScreenCI scripts, passing tests are not enough. The visible flow also needs
to look intentional.

Check for:

- clicks happening before the target is clearly visible
- loading states still on screen when narration begins
- typing or cursor movement that feels rushed
- setup steps leaking into the visible recording instead of staying in `hide()`

Prefer waiting for real UI state:

```ts
await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
```

Use `waitForTimeout()` only when you intentionally want visible breathing room
between steps.

## Common failure modes

- Bad selectors: switch to role-based or text-stable locators when possible.
- Navigation still loading: wait for the element the viewer should actually
  see, not only the URL change.
- Narration timing mismatch: use `await narration.key.start()` and
  `await narration.key.end()` when speech should overlap with motion.
- Hidden setup leaking into the final output: move authentication, cookie
  handling, and cleanup into `hide()`.

## Artifacts and traces

ScreenCI keeps Playwright behavior available for local debugging:

- use `--ui` when you want the Playwright UI
- set `use.trace` in config when you need deeper failure investigation
- inspect the generated `.screenci/` output after recording runs

When you have a trace, open it with Playwright's
[Trace Viewer](https://playwright.dev/docs/trace-viewer).

## What's next

- [Record and Publish](/docs/record-and-publish) when the local flow is ready.
- [CLI](/docs/reference/cli) for the full command reference.
