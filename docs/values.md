# Values

`video.values(...)` injects localized strings into the page through the `values`
fixture, for content the app does not localize itself. The values can be owned by
code or handed to [Editor](./editor.md) (the web app where non-developers edit
them); see [the three ways to declare values](#three-ways-to-declare-values)
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

## Three ways to declare values

There are three ways to declare values. The same three forms apply to
[`narration`](./narration.md), [`overlays`](./overlays.md), and
[`audio`](./audio.md). See the [Editor guide](./editor.md) for how the web editing
works.

**1. Code-owned.** You write the strings. Changing them re-records.

```ts
video.values({ en: { cta: 'Get started' }, fi: { cta: 'Aloita' } })
```

**2. Editor-owned (blank).** Wrap the field names in `editable([...])`: the names
exist in code (so the body can read `values.cta`), but [Editor](./editor.md) owns
the strings. An unset field is the empty string until set in Editor.

```ts
import { video, editable } from 'screenci'

video.values(editable(['heading', 'cta']))
```

**3. Editor-owned (seeded).** Pass values to `editable({...})`: Editor starts from
them but owns them, so an edit in Editor always wins over the seed.

```ts
video.values(editable({ cta: 'Get started' }))
```

## Editor-managed values

A field can instead be owned by ScreenCI Editor: wrap its names in `editable([...])`
(imported from `screenci`, field names only, no code value) and set its
per-language value from the web. This suits copy that non-developers maintain
without editing the test:

```ts
import { video, editable } from 'screenci'

video.values(editable(['heading', 'cta']))(
  'Landing',
  async ({ page, values }) => {
    await page.getByTestId('heading').fill(values.heading) // '' until set in Editor
    await page.getByTestId('cta').fill(values.cta) // '' until set in Editor
  }
)
```

To start the web app from seed copy instead of blank fields, pass an object to
`editable({...})` (content-major like `{ cta: 'Get started' }`, or language-major
like `{ en: { cta: 'Get started' }, fi: { cta: 'Aloita' } }`): the web app starts
from those values but owns them, so a seed is used only until the field is edited
in Editor.

The first recording reports the declared fields so Editor learns them. An unset
Editor field resolves to the empty string, so that first recording still
succeeds. Open the video's **Values** section in Editor, set each language's
value, then re-record: `screenci record` fetches the current values and injects
them before the run. Because on-screen values are captured into the recording
(not re-rendered), Editor values always take effect on the next record, never on
a one-off re-render.

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
