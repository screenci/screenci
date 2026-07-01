# Languages

ScreenCI supports multiple language versions of a video or screenshot
from a single script. You declare the languages once and ScreenCI records a
separate pass per language, setting the browser locale automatically so a
self-localizing app renders in the right language without extra work from you.

A plain video with no `.languages(...)` call records one round that stays
language-agnostic (no `[en]` tag), pinned to the `en-US` browser locale.

Narration, values, overlays, and audio each accept the same per-language object
form. The language set is inferred from the union of all feature keys, so adding
a language to any one of them is enough to produce a version. TypeScript validates
that every language covers the same cues, which catches drift early.

<!-- screenci-doc-video:docs/guides/languages -->

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

The filter only restricts which languages are recorded and rendered this run, not
which languages your video declares. Every recording still reports the full
code-defined language set, so the app keeps showing the languages you did not
render this time (rather than treating them as removed from code).

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

Pass keyless `studio()` to `video.languages(...)` to let the web app own the
recorded language set. This is a Business tier feature managed on the Studio
page.

```ts
import { video, studio } from 'screenci'

video.narration(studio(['intro'])).languages(studio())(
  'Product tour',
  async ({ page, narration }) => {
    await narration.intro()
    await page.goto('/dashboard')
  }
)
```

With keyless `studio()`, nothing is seeded, so rendering is held until the web
app selects a language set. To start from an initial set the web app can still
change, seed it: `video.languages(studio(['en', 'fi']))` renders en and fi until
the web app edits the set. To seed the capture options too, wrap a config in
`studio({ ... })`, for example
`video.languages(studio({ languages: ['en', 'fi'], mode: 'shared' }))`.

The web app can edit the language **set** but not `mode`, `locales`, or
`browserLocale` yet, so set those to their final values in code up front: they are
seeded once and used for every render until web editing of them ships.

The **Languages** section on the Studio page lists the current languages and
lets you add or remove them. Adding a language opens a short guided setup: fill
in that language's narration (a checklist tracks what is still missing), then
render. The render reuses the existing capture with the new narration, so you do
not have to re-record just to get a narrated version in another language.

On-screen text **values** for a newly added language start as a read-only copy
of an existing language (English if present, otherwise the first alphabetically)
because text is captured while the video records, not at render time. To
localize that text, edit the values and re-record the language version once it
exists. The re-record reuses the same Studio narration, overlays, and audio
configuration, and runs from the web when the project is connected to GitHub.

Adding languages from the web requires `video.languages(studio())` (or a seeded
`video.languages(studio(['en', 'fi']))`): a code-defined language set (a plain
array or config object, as shown in the sections above) is fixed by your test
code and cannot be changed from the app. See [Studio](./studio.md) for the full
Studio guide.

## Available languages

The language-major forms (`video.narration(...)`, `video.values(...)`) and
`video.languages(...)` accept the supported language keys below.

For the built-in voices, narration coverage depends on the voice's `modelType`
(see [Narration](./narration.md#model-type)). The **consistent** model (the
default) and the **expressive** model cover different language sets: most
languages work with either, some are available only with the expressive model,
and Cantonese (`yue`) is available only with the consistent model. Narrating a
language with a model that does not cover it fails at record time with a message
telling you which `modelType` to use.

The per-model split applies only to the built-in voices. Your own
[ElevenLabs voices](./narration.md#elevenlabs-voices) (including a voice you
record and clone from a sample) are multilingual and cover every key in either
table, so any language below works with them regardless of `modelType`.

(`values` and other non-narration features also work for every key regardless of
model, since they carry no synthesized speech.)

### Available with any model

These narrate with both the consistent (default) and expressive models:

| Language         | Key   |
| ---------------- | ----- |
| Arabic           | `ar`  |
| Bengali          | `bn`  |
| Bulgarian        | `bg`  |
| Croatian         | `hr`  |
| Czech            | `cs`  |
| Danish           | `da`  |
| Dutch            | `nl`  |
| English          | `en`  |
| Estonian         | `et`  |
| Finnish          | `fi`  |
| French           | `fr`  |
| German           | `de`  |
| Greek            | `el`  |
| Gujarati         | `gu`  |
| Hebrew           | `he`  |
| Hindi            | `hi`  |
| Hungarian        | `hu`  |
| Indonesian       | `id`  |
| Italian          | `it`  |
| Japanese         | `ja`  |
| Kannada          | `kn`  |
| Korean           | `ko`  |
| Latvian          | `lv`  |
| Lithuanian       | `lt`  |
| Malayalam        | `ml`  |
| Mandarin         | `cmn` |
| Marathi          | `mr`  |
| Norwegian Bokmal | `nb`  |
| Polish           | `pl`  |
| Portuguese       | `pt`  |
| Punjabi          | `pa`  |
| Romanian         | `ro`  |
| Russian          | `ru`  |
| Serbian          | `sr`  |
| Slovak           | `sk`  |
| Slovenian        | `sl`  |
| Spanish          | `es`  |
| Swahili          | `sw`  |
| Swedish          | `sv`  |
| Tamil            | `ta`  |
| Telugu           | `te`  |
| Thai             | `th`  |
| Turkish          | `tr`  |
| Ukrainian        | `uk`  |
| Urdu             | `ur`  |
| Vietnamese       | `vi`  |

### Expressive model only

With the built-in voices these narrate only with `modelType: 'expressive'`, so
they **require the Business tier** (the expressive model is a Business-tier
feature). On Free and Starter, recording one of these languages fails at record
time with a message to upgrade. They also work with your own ElevenLabs or
sample-cloned voice (which is multilingual, also Business-tier), and for
non-narration features (`values`, locale selection) they behave like any other
key.

| Language          | Key   |
| ----------------- | ----- |
| Afrikaans         | `af`  |
| Albanian          | `sq`  |
| Amharic           | `am`  |
| Armenian          | `hy`  |
| Azerbaijani       | `az`  |
| Basque            | `eu`  |
| Belarusian        | `be`  |
| Burmese           | `my`  |
| Catalan           | `ca`  |
| Cebuano           | `ceb` |
| Filipino          | `fil` |
| Galician          | `gl`  |
| Georgian          | `ka`  |
| Haitian Creole    | `ht`  |
| Icelandic         | `is`  |
| Javanese          | `jv`  |
| Konkani           | `kok` |
| Lao               | `lo`  |
| Latin             | `la`  |
| Luxembourgish     | `lb`  |
| Macedonian        | `mk`  |
| Maithili          | `mai` |
| Malagasy          | `mg`  |
| Malay             | `ms`  |
| Mongolian         | `mn`  |
| Nepali            | `ne`  |
| Norwegian Nynorsk | `nn`  |
| Odia              | `or`  |
| Pashto            | `ps`  |
| Persian           | `fa`  |
| Sindhi            | `sd`  |
| Sinhala           | `si`  |

### Consistent model only

Cantonese narrates only with the consistent (default) model. Selecting
`modelType: 'expressive'` for it fails at record time. It also works with your
own ElevenLabs or sample-cloned voice.

| Language  | Key   |
| --------- | ----- |
| Cantonese | `yue` |
