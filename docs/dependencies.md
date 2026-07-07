# Render dependencies

A render dependency lets one render embed another render's output as an overlay. Use it to drop a separately-maintained intro clip into a larger demo, reuse a branded logo still across many videos, or compose a long walkthrough out of smaller, independently-maintained pieces, and have every dependent stay in sync automatically.

This is what lets different teams own different parts of a video. One team can maintain the branded intro, another the product walkthrough, and a third a shared logo still, each as its own render in its own file. Whoever owns the full demo just references those pieces with `selected(...)`, and every dependent re-renders on its own whenever an embedded part is updated, so no team has to hand-assemble the others' work.

Unlike a file overlay, a dependency is a live link: when the target's selected render changes, every render that depends on it re-renders to embed the new output.

#### You will learn

- [how to declare a dependency with `selected(...)`](#declare-a-dependency)
- [how to carry an embedded target's subtitles up with `inheritSubtitles`](#inheriting-subtitles)
- [which renders can depend on which](#what-can-depend-on-what)
- [how selection drives automatic re-renders](#selection-and-re-renders)
- [what happens before the target has a finished render](#waiting-on-a-dependency)
- [how the embedded language is matched or pinned](#language-matching)
- [when to reach for a dependency instead of a file overlay](#when-to-use-a-render-dependency-instead-of-a-file-overlay)

## Declare a dependency

Pass `selected(name)` as an overlay value. The `name` is the project-unique title of another video or screenshot. screenci embeds that target's currently selected render (for the matching language), so you never restate the target's file, medium, or output. No local asset file is read, uploaded, or committed for a render dependency.

```ts
import { video, selected } from 'screenci'

// The target: a standalone clip, maintained on its own.
video('Intro Clip', async ({ page }) => {
  await page.goto('/welcome')
})

// The dependent: embeds whatever "Intro Clip" currently renders to.
video.overlays({ intro: selected('Intro Clip') })(
  'Full Demo',
  async ({ page, overlays }) => {
    await overlays.intro() // embeds the "Intro Clip" render
    await page.goto('/dashboard')
  }
)
```

A dependency overlay is driven exactly like any other overlay: call it for a blocking window (`await overlays.intro.for('1.2s')` or `await overlays.intro.for(1200)`), hold it until a position (`await overlays.intro.until('0:05')`), let a bare `await overlays.intro()` hold it for its natural length, or drive a live window with `start()`/`end()`. It accepts the same placement options as a file overlay (`x`/`y`/`width`/`height`/`relativeTo`/`aspectRatio`/`fill`/`pinToScreen`/`overMouse`), so you can frame it anywhere in the output.

```ts
video.overlays({
  logo: selected('Logo Still', { x: 96, y: 96, width: 240 }),
})('Walkthrough', async ({ page, overlays }) => {
  await overlays.logo.start()
  await page.goto('/pricing')
  await overlays.logo.end()
})
```

A blocking dependency overlay holds for its natural length with a bare `overlays.name()` when the target is a video; a screenshot target has no natural length, so give it a duration (`.for(...)`, `.until(...)`, or a `duration` config) or drive it with `start()`/`end()`. When the target is a video, a `start()`/`end()` window also plays the embedded render out to its natural end: if it is longer than the window, the remainder plays over a frozen frame rather than being cut, so `end()` lets it finish. Trim it (`start`/`end`) to embed only a slice.

A dependency also accepts `crop` (both video and screenshot targets) and `start`/`end` (video targets only), the same way a file overlay does:

```ts
video.overlays({
  // Reframe and trim an embedded video render.
  demo: selected('Full Demo', {
    crop: { x: 0, y: 0, width: 1280, height: 720 },
    start: '2s',
    end: '50%',
  }),
  // Crop a region of an embedded screenshot (no start/end: a screenshot has no timeline).
  shot: selected('Dashboard Shot', {
    crop: { x: 64, y: 64, width: 800, height: 600 },
  }),
})
```

Setting `start`/`end` on a dependency that resolves to a screenshot is rejected when the target medium is known.

## Inheriting subtitles

An embedded video always plays the target's audio. By default its narration subtitles stay with the target and are not shown in the surrounding video. Pass `inheritSubtitles: true` to also carry them up:

```ts
video.overlays({
  intro: selected('Intro Clip', { inheritSubtitles: true }),
})('Full Demo', async ({ page, overlays }) => {
  await overlays.intro() // plays the clip's audio and shows its subtitles
  await page.goto('/dashboard')
})
```

When on, the target's narration subtitles are added to the surrounding video's subtitle track (its VTT file) for the window the embed plays. This applies only where the surrounding video has no competing narration of its own during that window: if the dependent is narrating over the embed, its own subtitles win and the inherited ones are left out for that stretch. The subtitles are matched to the surrounding render's language the same way the embedded output is (see below). Off by default.

This split (audio always inherited, subtitles opt-in) lets you reuse a narrated intro clip as-is, or reuse only its visuals and audio while keeping the parent video's subtitles independent.

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

If you record a dependent before its target has any finished render, the dependent does not fail. It is held in a **waiting-on-dependency** state, shown in the render listing as a non-error, and dispatched automatically as soon as the target has an embeddable output. This also covers recording a dependent and its target together in one run: the target renders first, and the dependent follows on its own.

## Language matching

By default a dependency embeds the target's output for the **same language** as the dependent render. The fallback is deliberately strict to avoid embedding the wrong language:

- If the target has a render for the dependent's language, that one is embedded.
- If it does not, but the target only has renders in a **single language**, that one is embedded (there is no ambiguity).
- If the target has renders in **multiple languages** and none match, the dependent render **fails** with a language-mismatch error. Render the target in the matching language, or keep it single-language.

### Pinning a language

Pass a `language` to embed a **fixed** language of the target, regardless of which language the surrounding render is in. This is useful when a clip should always appear in one language (for example a shared intro), even inside videos rendered in other languages:

```ts
// Always embed the Finnish intro, whatever language the demo renders in.
video.overlays({ intro: selected('Intro Clip', { language: 'fi' }) })(
  'Full Demo',
  async ({ overlays }) => {
    await overlays.intro()
  }
)
```

A pinned language never falls back to another one: if the target has **no** finished render in the pinned language, the dependent render **fails explicitly** with an error listing the languages the target does have. Render the target in the pinned language to resolve it.

## When to use a render dependency instead of a file overlay

Use `selected(...)` when the reused content is itself a screenci-managed render:

- it has its own version history or language variants
- non-developers may swap its selected output in the web app
- you want dependents to update automatically when the source render changes

Use a normal file overlay (`path: './intro.mp4'`, `./logo.png`, `.html`, `.tsx`) when the asset is a repository file rather than another screenci render.

## Edge cases

- **Target deleted**: the dependency link is dropped and the dependent re-renders without that overlay.
- **Multiple dependencies**: all are embedded, and the dependent re-renders when any one of their selections changes.
- **Invalid dependency reaching render**: shown distinctly in the listing with an actionable message (for example "not found in this project" or "only one level is supported"), not as a generic failure.
