# CI Lag Capping

On slow CI machines, there is often a visible pause between the cursor arriving at a target and the click animation beginning. This happens because Playwright waits for the element to be visible, stable, and enabled before interacting with it. On a fast dev machine this takes a few milliseconds; on CI it can take seconds.

`maxLagMs` caps that waiting period so the output looks smooth and consistent regardless of CI speed.

## How it works

Before every interaction (click, fill, type, check, hover, etc.), screenci measures the time spent waiting for the element to be ready. The threshold is treated as a cap on how long that wait is allowed to occupy the final video:

- A wait at or under the threshold plays back at its natural speed, so fast machines stay snappy.
- A wait that exceeds the threshold is compressed to play back over exactly the threshold. A 3s actionability stall with a 500ms threshold becomes a smooth 500ms beat instead of a 3s freeze.

For pointer interactions (click, tap, check, uncheck), screenci also caps Playwright's actionability wait (waiting for the element to be stable, enabled, and receiving events). This matters because an element can be visible while still animating in, disabled, or covered by an overlay; capping only the visibility wait would let that dead time show up as a gap in the recording. The actionability wait is measured right before the click, after the cursor has already moved into place, so Playwright's scroll-into-view during the checks does not interfere with screenci's own animated scroll. For other interactions screenci caps only the `locator.waitFor({ state: 'visible' })` wait.

Inside a `time()` or `speed()` block you control the pacing yourself, so an over-long wait is hidden (cut) rather than compressed (a compression block cannot nest inside those).

## Configuration

Set `maxLagMs` in `screenci.config.ts` under `use.recordOptions`:

```typescript
use: {
  recordOptions: {
    maxLagMs: 500, // cap waits at 500ms, warn when one is compressed
  },
},
```

Set to `0` to disable capping entirely (waits play back at their full real duration):

```typescript
maxLagMs: 0,
```

## Per-action override

Every instrumented action accepts a `maxLagMs` option that overrides the project default for that call:

```typescript
await page.locator('#submit').click({ maxLagMs: 0 }) // disable for this click

await page.locator('#slow-field').fill('text', { maxLagMs: 1000 }) // raise the cap
```

Setting it to `0` disables capping for that action even when the project default is set.

## Warning message

When a wait is compressed you will see:

```
[screenci] Slow UI response (3120ms) compressed to 500ms in the recording. See https://docs.screenci.com/guides/ci-lag
```

The recording is capped correctly regardless of whether the warning fires. The threshold both sets the cap and controls when the warning appears.

## Recommended setup

New projects initialize with `maxLagMs: 500`. This is a sensible default: keeps fast waits natural, caps slow ones to a consistent half-second beat, and warns only when something is unusually slow.

If your recordings still show long gaps after enabling this, the element may not be attached to the DOM until after the cursor moves. In that case check whether the element is rendered only after a preceding action completes.
