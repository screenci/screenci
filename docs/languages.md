# Languages

ScreenCI supports multiple language versions of a video or screenshot
from a single script. You declare the languages once and ScreenCI records a
separate pass per language, setting the browser locale automatically so a
self-localizing app renders in the right language without extra work from you.

Narration, values, overlays, and audio each accept the same per-language object
form. The language set is inferred from the union of all feature keys, so adding
a language to any one of them is enough to produce a version. TypeScript validates
that every language covers the same cues, which catches drift early.

## Add languages

Add languages by keeping the same cue keys under each language code in
`video.narration(...)`:

```ts
video.narration({
  en: { intro: 'Open the settings page.' },
  fi: { intro: 'Avaa asetussivu.' },
})('Settings', async ({ page, narration }) => {
  await narration.intro()
})
```

Use bare language keys such as `en`, `fi`, `fr`, and `cmn`. You can also add a
`default` key as a shared fallback: any cue missing for a language falls back to
the `default` value, for example
`video.narration({ default: { intro: 'Hi' }, fr: { intro: 'Salut' } })`.

The same pattern applies to `video.values(...)`, `video.overlays(...)`, and
`video.audio(...)`: pass a language-major object and each language's assets are
realized in that language's recording pass while the body drives the same
controller name regardless of language:

```ts
video.overlays({
  en: { badge: { path: 'assets/badge.en.png', x: 1382, y: 65, width: 384 } },
  fi: { badge: { path: 'assets/badge.fi.png', x: 1382, y: 65, width: 384 } },
})('Landing', async ({ page, overlays }) => {
  await page.goto('/')
  await overlays.badge() // the active language's file in each pass
})
```

`video.audio({ en: {...}, fi: {...} })` works the same way. A `default` key
supplies a shared fallback for any language that omits a name:

```ts
video.overlays({
  default: { badge: { path: 'assets/badge.png', x: 1382, y: 65, width: 384 } },
  fi: { badge: { path: 'assets/badge.fi.png', x: 1382, y: 65, width: 384 } },
})('Landing', async ({ page, overlays }) => {
  await overlays.badge() // shared badge for en, the Finnish one for fi
})
```

> **Per-language overlays, audio, and injected values need per-language capture**
> (the default mode, below): they are baked into each language's own recording
> pass. In **shared capture mode** one recording is reused for every language and
> only narration is overdubbed, so overlays, audio, and `values` are identical
> across languages there.

## Localized recordings (per-language capture)

By default a localized video records a **separate pass per language**, setting
the browser locale from the language and exposing the active `language` to the
body. That is ideal when the UI itself differs per language: the app renders
translated text, you navigate to a localized route, or you want the browser
locale set.

```ts
import { video, voices } from 'screenci'

video.narration({
  en: { intro: 'Open the settings page.' },
  fi: { intro: 'Avaa asetussivu.' },
})('Tutorial', async ({ page, language, narration }) => {
  // `language` is the language being recorded in this pass ('en' or 'fi').
  // The browser locale is set automatically (en -> en-US, fi -> fi-FI), so a
  // self-localizing app renders in the right language. You can also navigate
  // per language.
  await page.goto('/' + language)
  await narration.intro()
})
```

Each declared language becomes its own recording pass, and the passes group into
a single video with one language version each. The declared languages are the
single source of truth: the narration map must cover exactly those languages, so
a forgotten translation fails loudly instead of silently drifting.

### Choosing the locale

Locales default from the language (`fi` -> `fi-FI`). Override per language with
`locales` on `video.languages(...)` when you need a specific region. The object
form of `video.languages(...)` takes the explicit `languages` set alongside its
options:

```ts
video
  .narration({
    en: { intro: 'Welcome.' },
    pt: { intro: 'Bem-vindo.' },
  })
  .languages({
    languages: ['en', 'pt'],
    locales: { en: 'en-GB', pt: 'pt-BR' },
  })('Pricing', async ({ page, language }) => {
  await page.goto('/' + language + '/pricing')
})
```

To skip setting the browser locale entirely, pass `browserLocale: false` to
`video.languages(...)`.

### Shared capture mode

To capture once and overdub narration per language at render (instead of a pass
per language), pass `mode: 'shared'` to `video.languages(...)`. This is ideal
when the visible UI is identical across languages. The body's `language` fixture
is then `undefined`:

```ts
video
  .narration({
    en: { intro: 'Welcome.' },
    fi: { intro: 'Tervetuloa.' },
  })
  .languages({ mode: 'shared' })('Tour', async ({ page, narration }) => {
  await page.goto('/')
  await narration.intro()
})
```

### Recording only some languages

To record (and render) a subset, pass `--languages` to `screenci record`:

```bash
screenci record --languages fi
screenci record --languages fi,en
```

Per-language videos record only the requested languages, so a run never produces
more than you asked for. A shared-mode recording is a single capture and is not
split by this filter.

### Localized screenshots

`screenshot.values` supports localized `values` (a still is silent, so it takes
no narration). Each language produces its own localized still:

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

### Variants with `each`

`video.each([...])` (and `screenshot.each([...])`) produce a **separate video
per variant**, for cases like viewport or theme. Each variant has its own
identity and history. It chains with the per-feature methods:

```ts
video
  .each([
    { key: 'mobile', recordOptions: { aspectRatio: '9:16' } },
    { key: 'desktop', recordOptions: { aspectRatio: '16:9' } },
  ])
  .narration({
    en: { intro: 'Welcome.' },
    fi: { intro: 'Tervetuloa.' },
  })('Landing', async ({ page, language, narration }) => {
  await page.goto('/' + language)
  await narration.intro()
})
```

This records `Landing mobile` and `Landing desktop` as separate videos, each
with `en` and `fi` language versions.

### Run modifiers

A localized video builder supports the usual run modifiers, chained before the
call: `.only(...)`, `.skip`, `.fixme`, and `.fail`. The in-body conditional
`video.skip(condition, reason)` still exists separately for skipping mid-test.

## Managing languages from Studio

Pass `'studio'` to `video.languages(...)` to let the web app own the recorded
language set. This is a Business tier feature managed on the Studio page.

```ts
import { video } from 'screenci'

video.narration(['intro']).languages('studio')(
  'Product tour',
  async ({ page, narration }) => {
    await narration.intro()
    await page.goto('/dashboard')
  }
)
```

The **Languages** section on the Studio page lists the current recorded
languages and lets you add or remove them. Adding a language triggers a
re-record: the section shows a **Re-record this video** button that queues a
fresh recording pass from the web when the project is connected to GitHub. The
new pass reuses the same Studio narration, overlays, and audio configuration.

To fix languages in code instead, pass an array or config object as shown in the
sections above. See [Studio](./studio.md) for the full Studio guide.

## Available languages

The language-major forms (`video.narration(...)`, `video.values(...)`) and
`video.languages(...)` accept the following supported language keys:

| Language          | Key   |
| ----------------- | ----- |
| Afrikaans         | `af`  |
| Amharic           | `am`  |
| Arabic            | `ar`  |
| Azerbaijani       | `az`  |
| Belarusian        | `be`  |
| Bulgarian         | `bg`  |
| Bengali           | `bn`  |
| Catalan           | `ca`  |
| Cebuano           | `ceb` |
| Mandarin          | `cmn` |
| Czech             | `cs`  |
| Danish            | `da`  |
| German            | `de`  |
| Greek             | `el`  |
| English           | `en`  |
| Spanish           | `es`  |
| Estonian          | `et`  |
| Basque            | `eu`  |
| Persian           | `fa`  |
| Finnish           | `fi`  |
| Filipino          | `fil` |
| French            | `fr`  |
| Galician          | `gl`  |
| Gujarati          | `gu`  |
| Hebrew            | `he`  |
| Hindi             | `hi`  |
| Croatian          | `hr`  |
| Haitian Creole    | `ht`  |
| Hungarian         | `hu`  |
| Armenian          | `hy`  |
| Indonesian        | `id`  |
| Icelandic         | `is`  |
| Italian           | `it`  |
| Japanese          | `ja`  |
| Javanese          | `jv`  |
| Georgian          | `ka`  |
| Kannada           | `kn`  |
| Korean            | `ko`  |
| Konkani           | `kok` |
| Latin             | `la`  |
| Luxembourgish     | `lb`  |
| Lao               | `lo`  |
| Lithuanian        | `lt`  |
| Latvian           | `lv`  |
| Maithili          | `mai` |
| Malagasy          | `mg`  |
| Macedonian        | `mk`  |
| Malayalam         | `ml`  |
| Mongolian         | `mn`  |
| Marathi           | `mr`  |
| Malay             | `ms`  |
| Burmese           | `my`  |
| Norwegian Bokmal  | `nb`  |
| Nepali            | `ne`  |
| Dutch             | `nl`  |
| Norwegian Nynorsk | `nn`  |
| Odia              | `or`  |
| Punjabi           | `pa`  |
| Polish            | `pl`  |
| Pashto            | `ps`  |
| Portuguese        | `pt`  |
| Romanian          | `ro`  |
| Russian           | `ru`  |
| Sindhi            | `sd`  |
| Sinhala           | `si`  |
| Slovak            | `sk`  |
| Slovenian         | `sl`  |
| Albanian          | `sq`  |
| Serbian           | `sr`  |
| Swedish           | `sv`  |
| Swahili           | `sw`  |
| Tamil             | `ta`  |
| Telugu            | `te`  |
| Thai              | `th`  |
| Turkish           | `tr`  |
| Ukrainian         | `uk`  |
| Urdu              | `ur`  |
| Vietnamese        | `vi`  |
