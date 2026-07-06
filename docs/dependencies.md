# Render Dependencies

`selected(name, options?)` embeds the output of another ScreenCI render as an
overlay. This is a render dependency: instead of reading a local file, ScreenCI
looks up another named video or screenshot in the same project and embeds its
currently selected output.

Use it for reusable intros, outros, branded bumpers, localized screenshot
cards, or any other clip you want to maintain once and reuse across other
renders.

```ts
import { selected, video } from 'screenci'

video.overlays({
  intro: selected('Intro Clip'),
})('Product walkthrough', async ({ page, overlays }) => {
  await overlays.intro()
  await page.getByRole('link', { name: 'Dashboard' }).click()
})
```

## How `selected(...)` resolves

The `name` is the project-unique title of another ScreenCI video or screenshot.
At render time, ScreenCI resolves that target's output from the project data:

- If the target has a selected version, the dependency embeds that output.
- Otherwise it falls back to the target's latest finished render.
- When the target's selected version changes later, dependents automatically
  re-render so they embed the new output.

No local asset file is read, uploaded, or committed for a render dependency.

## What can embed what

- A **video** can embed another **video** or **screenshot**.
- A **screenshot** can embed only another **screenshot**.

Like other overlays, `selected(...)` goes inside `video.overlays(...)` or
`screenshot.overlays(...)`.

## Example: localized intro reused across videos

```ts
import { selected, video } from 'screenci'

video.overlays({
  intro: selected('Localized intro', {
    width: 720,
    x: 0,
    y: 0,
    inheritSubtitles: true,
  }),
})('Pricing demo', async ({ page, overlays, narration }) => {
  await overlays.intro()
  await narration.start()
  await page.getByRole('link', { name: 'Pricing' }).click()
})
```

## Options

`selected(name, options)` accepts the placement fields that apply to finished
render output, plus a few dependency-specific options:

- `start` / `end`: trim the embedded video to part of its duration. These apply
  only when the target resolves to a video.
- `language`: pin the dependency to a specific target language such as `'fi'`.
  If omitted, the dependency follows the surrounding render's language.
- `inheritSubtitles`: also carry the target video's narration subtitles into the
  surrounding video's subtitle track while the dependency plays.
- Placement fields like `x`, `y`, `width`, `height`, `fill`, `crop`,
  `pinToScreen`, and `overMouse` work the same way as on normal overlays.

```ts
video.overlays({
  intro: selected('Intro Clip', {
    start: '1.5s',
    end: '5s',
    language: 'fi',
    inheritSubtitles: true,
    fill: 'screen',
  }),
})
```

## Audio and subtitles

When the dependency resolves to a video, its audio always plays as part of the
embed. Subtitles are separate:

- Audio is inherited automatically.
- Subtitles are inherited only with `inheritSubtitles: true`.

This lets you reuse a narrated intro clip as-is, or reuse only its visuals and
audio while keeping the parent video's subtitles independent.

## When to use a render dependency instead of a file overlay

Use `selected(...)` when the reused content is itself a ScreenCI-managed render:

- it has its own version history or language variants
- non-developers may swap its selected output in the web app
- you want dependents to update automatically when the source render changes

Use a normal file overlay (`path: './intro.mp4'`, `./logo.png`, `.html`, `.tsx`)
when the asset is a repository file rather than another ScreenCI render.
