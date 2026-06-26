# Values

`video.values(...)` injects localized strings into the page through the `values`
fixture, for content the app does not localize itself. Declare a `values` map per
language, then read `values.<field>` in the body:

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

## Studio-managed values

A field can instead be owned by ScreenCI Studio: declare it with the **array**
form of `video.values([...])` (field names only, no code value) and set its
per-language value from the web. This suits copy that non-developers maintain
without editing the test:

```ts
video.values(['heading', 'cta'])('Landing', async ({ page, values }) => {
  await page.getByTestId('heading').fill(values.heading) // '' until set in Studio
  await page.getByTestId('cta').fill(values.cta) // '' until set in Studio
})
```

The first recording reports the declared fields so Studio learns them. An unset
Studio field resolves to the empty string, so that first recording still
succeeds. Open the video's **Values** section in Studio, set each language's
value, then re-record: `screenci record` fetches the current values and injects
them before the run. Because on-screen values are captured into the recording
(not re-rendered), Studio values always take effect on the next record, never on
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
