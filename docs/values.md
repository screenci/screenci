# Values

`video.values(...)` injects localized strings into the page through the `values`
fixture, for content the app does not localize itself. The values can be owned by
code or handed to [Editor](./editor.md) (the web app where non-developers edit
them); see [the two ways to declare values](#two-ways-to-declare-values)
below. Declare a `values` map per language, then read `values.<field>` in the
body:

```ts
video.values({
  en: { heading: 'Dashboard', cta: 'Get started' },
  fi: { heading: 'Hallinta', cta: 'Aloita' },
})('Landing', async ({ page, values }) => {
  await page.goto('/')
  await page.getByTestId('heading').fill(values.heading)
  await page.getByTestId('cta').fill(values.cta)
})
```

`values` and `narration` can be combined by chaining the two feature methods:
`video.narration({...}).values({...})('Landing', async ({ page, narration, values }) => {...})`.
The language set is the union of both. Unlike voice (which only re-renders),
changing injected `values` changes what is captured, so it re-records.

## Two ways to declare values

There are two ways to declare values, and both are editable in the web app. The
same two forms apply to [`narration`](./narration.md),
[`overlays`](./overlays.md), and [`audio`](./audio.md). See the
[Editor guide](./editor.md) for how the web editing works.

**1. Code values.** You write the strings; they are used at record time.
Changing them re-records. They stay editable in Editor, and an Editor edit wins
over the code value from then on.

```ts
video.values({ en: { cta: 'Get started' }, fi: { cta: 'Aloita' } })
```

**2. Editor-owned (blank).** Pass a bare array of field names: the names exist
in code (so the body can read `values.cta`), but [Editor](./editor.md) owns the
strings. An unset field is the empty string until set in Editor.

```ts
import { video } from 'screenci'

video.values(['heading', 'cta'])
```

Either way the field stays editable in Editor: a code value is used at record
time until it is edited in the web app, and from then on the Editor value wins.

## Editor-managed values

A field can instead start blank and be filled in from ScreenCI Editor: pass a
bare array of field names (no code value) and set its per-language value from
the web. This suits copy that non-developers maintain without editing the test:

```ts
import { video } from 'screenci'

video.values(['heading', 'cta'])('Landing', async ({ page, values }) => {
  await page.getByTestId('heading').fill(values.heading) // '' until set in Editor
  await page.getByTestId('cta').fill(values.cta) // '' until set in Editor
})
```

To start the web app from code copy instead of blank fields, pass a plain
object (content-major like `{ cta: 'Get started' }`, or language-major like
`{ en: { cta: 'Get started' }, fi: { cta: 'Aloita' } }`): the code values are
used until the field is edited in Editor, and from then on the Editor value
wins.

The first recording reports the declared fields so Editor learns them. Because a
blank field has no value yet and on-screen values are captured into the frames,
the video's **first render is held** until you set the values, just like blank
[narration](./narration.md), [overlays](./overlays.md), and [audio](./audio.md).
The CLI prints the hold with a direct link to Editor. Open the video's
**Values** section in Editor, set each language's value, then re-record:
`screenci record` fetches the current values and injects them before the run.
Because on-screen values are captured into the recording (not re-rendered),
Editor values always take effect on the next record, never on a one-off
re-render.

A field declared with a code value (the object form below) carries its text, so
it is **not** held: the recording renders straight away from the code value
while staying editable in Editor.

## Values in screenshots

`screenshot.values` supports the same localized `values` form. Each language
produces its own localized still:

```ts
import { screenshot } from 'screenci'

screenshot.values({
  en: { heading: 'Dashboard' },
  fi: { heading: 'Hallinta' },
})('Dashboard hero', async ({ page, language, values, crop }) => {
  await page.goto('/' + language + '/dashboard')
  await page.getByTestId('heading').fill(values.heading)
  await crop(page.getByTestId('revenue-card'), { padding: 0.06 })
})
```

For how values interact with multi-language recording passes, see
[Languages](/docs/guides/languages).
