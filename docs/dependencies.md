# Render dependencies

A render dependency lets one render embed another render's output as an overlay. Use it to drop a separately-maintained intro clip into a larger demo, reuse a branded logo still across many videos, or compose a long walkthrough out of smaller, independently-maintained pieces, and have every dependent stay in sync automatically.

Unlike a file overlay, a dependency is a live link: when the target's selected render changes, every render that depends on it re-renders to embed the new output.

#### You will learn

- [how to declare a dependency with `selected(...)`](#declare-a-dependency)
- [which renders can depend on which](#what-can-depend-on-what)
- [how selection drives automatic re-renders](#selection-and-re-renders)
- [what happens before the target has a finished render](#waiting-on-a-dependency)

## Declare a dependency

Pass `selected(name)` as an overlay value. The `name` is the project-unique title of another video or screenshot. screenci embeds that target's currently selected render (for the matching language), so you never restate the target's file, medium, or output.

```ts
import { video, selected } from 'screenci'

video.overlays({ intro: selected('Intro Clip') })(
  'Full Demo',
  async ({ page, overlays }) => {
    await overlays.intro() // embeds the "Intro Clip" render
    await page.goto('/dashboard')
  }
)
```

A dependency overlay is driven exactly like any other overlay: call it for a blocking window (`await overlays.intro(1200)`), or drive a live window with `start()`/`end()`. It accepts the same placement options as a file overlay (`x`/`y`/`width`/`height`/`relativeTo`/`aspectRatio`/`fill`), so you can frame it anywhere in the output.

```ts
video.overlays({
  logo: selected('Logo Still', { x: 96, y: 96, width: 240 }),
})('Walkthrough', async ({ page, overlays }) => {
  await overlays.logo.start()
  await page.goto('/pricing')
  await overlays.logo.end()
})
```

Because no local file is involved, a blocking dependency overlay needs a duration (from the call or the config), just like an image overlay. A live `start()`/`end()` window needs none.

## What can depend on what

- A **video** may depend on any number of **videos and screenshots**.
- A **screenshot** may depend only on other **screenshots** (a still cannot embed a moving picture).
- Dependencies are **one level deep**. A target you embed must be a leaf: it cannot itself use `selected(...)`. This keeps the dependency graph simple and predictable.

Names are unique across both mediums within a project, so `selected('Intro Clip')` is unambiguous whether `Intro Clip` is a video or a screenshot. The medium is looked up for you.

These rules are checked when you record: if a target is missing, is not a leaf, or is the wrong medium, the error is reported in the record output right away, not as a silent dead render later.

## Selection and re-renders

The render that gets embedded is the target's **selected version** for the matching language. Before anything is selected, screenci falls back to the target's **latest finished** render.

When the target's selection changes, every dependent re-renders automatically to embed the new output:

- If the target has **auto-select** on, finishing a new render selects it, which triggers the dependents.
- If you **manually select** a different render, the app first tells you which videos and screenshots will re-render, then runs them. You can select a render this way even when the target has no public URL, as long as it has dependents.

Triggered re-renders show up on the render page like any other render.

## Waiting on a dependency

If you record a dependent before its target has any finished render, the dependent does not fail. It is held in a **waiting-on-dependency** state, shown in the render listing as a non-error, and dispatched automatically as soon as the target has an embeddable output.

## Language matching

A dependency embeds the target's output for the **same language** as the dependent render. The fallback is deliberately strict to avoid embedding the wrong language:

- If the target has a render for the dependent's language, that one is embedded.
- If it does not, but the target only has renders in a **single language**, that one is embedded (there is no ambiguity).
- If the target has renders in **multiple languages** and none match, the dependent render **fails** with a language-mismatch error. Render the target in the matching language, or keep it single-language.

## Edge cases

- **Target deleted**: the dependency link is dropped and the dependent re-renders without that overlay.
- **Multiple dependencies**: all are embedded, and the dependent re-renders when any one of their selections changes.
- **Invalid dependency reaching render**: shown distinctly in the listing with an actionable message (for example "not found in this project" or "only one level is supported"), not as a generic failure.
