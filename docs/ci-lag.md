# CI Lag Hiding

On slow CI machines, there is often a visible pause between the cursor arriving at a target and the click animation beginning. This happens because Playwright waits for the element to be visible, stable, and enabled before interacting with it. On a fast dev machine this takes a few milliseconds; on CI it can take hundreds.

`hideLagThresholdMs` automatically hides this waiting period from the recording so the output looks smooth regardless of CI speed.

## How it works

Before every interaction (click, fill, type, check, hover, etc.), screenci calls `locator.waitFor({ state: 'visible' })` and wraps that wait in `hideStart`/`hideEnd` events. Those events become frame cuts in the final video, removing the dead time entirely.

If the wait exceeds the configured threshold, a warning is printed to the console pointing here.

## Configuration

Set `hideLagThresholdMs` in `screenci.config.ts` under `use.recordOptions`:

```typescript
use: {
  recordOptions: {
    hideLagThresholdMs: 500, // warn when lag exceeds 500ms
  },
},
```

Set to `0` to disable hiding entirely:

```typescript
hideLagThresholdMs: 0,
```

## Per-action override

Every instrumented action accepts a `hideLagThresholdMs` option that overrides the project default for that call:

```typescript
await page.locator('#submit').click({ hideLagThresholdMs: 0 }) // disable for this click

await page.locator('#slow-field').fill('text', { hideLagThresholdMs: 1000 }) // raise threshold
```

Setting it to `0` disables hiding for that action even when the project default is set.

## Warning message

When lag exceeds the threshold you will see:

```
[screenci] Slow UI response (312ms). The wait is hidden in the recording. See https://docs.screenci.com/guides/ci-lag
```

The recording is still hidden correctly regardless of whether the warning fires. The threshold only controls when the warning appears.

## Recommended setup

New projects initialize with `hideLagThresholdMs: 500`. This is a sensible default: hides lag silently on typical CI, warns only when something is unusually slow.

If your recordings still show gaps after enabling this, the element may not become `visible` until after the cursor moves. In that case check whether the element is rendered only after a preceding action completes.
