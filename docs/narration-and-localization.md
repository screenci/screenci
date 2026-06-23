# Narration and Localization

ScreenCI narration is cue-based. You attach a localized script to a video with
`video.localize(...)`, then place named cue markers into the visible flow where
speech should start, overlap, and end. The same script renders as multiple
language versions without duplicating the visible browser workflow.

The spoken text lives in the localize spec: `narration` carries the text. The
default voice that speaks every language is set once with
`renderOptions.narration.voice`, in `screenci.config.ts` or `video.use(...)`. The
localize `voice` is a per-language map that overrides that default for specific
languages only (there is no all-languages form here, that is what `use` is for),
and a per-cue `voice` is the most specific override. Changing the voice re-renders
without re-recording; changing the spoken text re-records.

`style` prompts and `modelType: 'expressive'` require the Business tier. Free
and Starter users should stay with the default consistent narration flow.

#### You will learn

- [how to define a localized narration script](#start-with-one-language)
- [how to overlap narration with visible motion](#timing-modes)
- [how to add more languages](#add-more-languages)
- [how to inject localized page text](#inject-localized-text)
- [how to record a separate pass per language](#localized-recordings-per-language-capture)
- [how to set the voice per language and per cue](#voice-per-language-and-per-cue)

## Start with one language

Attach the narration script with `video.localize(...)`. The body receives a
`narration` object whose markers (`narration.intro()`, `.start()`, `.end()`)
carry timing only: the text comes from the localize spec, the voice from your
config or `video.use(...)` default.

```ts
import { video, voices } from 'screenci'

// The default voice for every language (how the narration is spoken).
video.use({ renderOptions: { narration: { voice: { name: voices.Sophie } } } })

video.localize({
  // Localized narration cues by language. The body gets timing markers.
  narration: {
    en: {
      intro: 'Open the settings page.',
      save: 'Save the changes when you are ready.',
    },
  },
})('Settings', async ({ page, narration }) => {
  await narration.intro()
  await page.goto('/settings')

  await narration.save.start()
  await page.getByRole('button', { name: 'Save' }).click()
  await narration.save.end()
})
```

A single-language video still uses `video.localize`: it just declares one
language. The set of languages is inferred from the narration (and text) keys.

## Timing modes

Use the cue markers intentionally:

- `await narration.key()` waits for the full spoken line to finish.
- `await narration.key.start()` begins the cue and keeps the script moving.
- `await narration.key.end()` closes the same cue later.

That is the main tool for overlapping speech with UI motion without losing
control of the timeline.

Keep cues small. In practice, one sentence per cue is the safest default for
timing, overlap control, and subtitle readability.

If only one file needs a different narration layout, pair `video.localize(...)`
with `video.use()` instead of changing the whole project:

```ts
import { video, voices } from 'screenci'

// `corner` is a visual render option; `voice` is the default voice for every
// language. Both are render options set with `use`.
video.use({
  renderOptions: {
    narration: { corner: 'top-right', voice: { name: voices.Sophie } },
  },
})

video.localize({
  narration: {
    en: {
      intro: 'Open the analytics tab.',
      summary: 'Review the latest numbers.',
    },
  },
})('Analytics walkthrough', async ({ page, narration }) => {
  await narration.intro.start()
  await page.getByRole('tab', { name: 'Analytics' }).click()
  await narration.intro.end()

  await narration.summary()
})
```

## Balance narration volume

Set a per-cue `volume` to balance a spoken line against the recording and any
background audio. Use the object form of a cue and add `volume`:

```ts
video.localize({
  narration: {
    en: {
      // Quieter than natural, e.g. to sit under a louder moment in the recording.
      intro: { cue: 'Open the settings page.', volume: 0.6 },
      // Natural level (the default); the same as `summary: 'Review the numbers.'`.
      summary: { cue: 'Review the numbers.', volume: 1 },
    },
  },
})('Settings', async ({ page, narration }) => {
  /* ... */
})
```

`volume` is a linear gain: `1` is the natural level (the default), `0` is silent,
and values above `1` boost the line (capped at `4`). It is a per-cue setting, so a
file-based cue accepts it too:

```ts
clip: { media: '/walkthrough.mp4', volume: 0.5 }
```

Volume is applied when the narration is mixed into the final video, not when the
speech is generated. Changing it never regenerates the audio, and it is not a
per-language setting: when more than one language sets a volume for the same cue,
the first one wins.

## Add more languages

Add more languages by keeping the same cue keys under each language:

```ts
video.localize({
  narration: {
    en: { intro: 'Open the settings page.' },
    fi: { intro: 'Avaa asetussivu.' },
  },
})('Settings', async ({ page, narration }) => {
  await narration.intro()
})
```

The language set is inferred from the union of the narration (and text) keys, so
adding `fi` above is all it takes to produce an `en` and an `fi` version.
TypeScript helps here: each cue marker is keyed by name, and ScreenCI validates
that every language covers the same cues, which catches drift early.

Use bare language keys such as `en`, `fi`, `fr`, and `cmn`. ScreenCI treats
those as the public language versions for narration, rendering, and public URLs.

## Inject localized text

`video.localize` can also inject localized strings into the page through the
`text` fixture, for content the app does not localize itself. Declare a `text`
map per language, then read `text.<field>` in the body:

```ts
video.localize({
  text: {
    en: { heading: 'Dashboard', cta: 'Get started' },
    fi: { heading: 'Hallinta', cta: 'Aloita' },
  },
})('Landing', async ({ page, text }) => {
  await page.goto('/')
  await page.getByTestId('heading').fill(text.heading)
  await page.getByTestId('cta').fill(text.cta)
})
```

`text` and `narration` can be combined in the same spec. The language set is the
union of both. Unlike voice (which only re-renders), changing injected `text`
changes what is captured, so it re-records.

### Studio-managed text

A field can instead be owned by ScreenCI Studio: declare it under
`video.studio({ text: [...] })` (with no code value) and set its per-language
value from the web. This suits copy that non-developers maintain without editing
the test.

```ts
video
  .studio({ text: ['cta'] }) // value lives in Studio
  .localize({
    text: { en: { heading: 'Dashboard' }, fi: { heading: 'Hallinta' } },
  })('Landing', async ({ page, text }) => {
  await page.getByTestId('heading').fill(text.heading)
  await page.getByTestId('cta').fill(text.cta) // '' until set in Studio
})
```

The first recording reports the declared fields so Studio learns them. An unset
Studio field resolves to the empty string, so that first recording still
succeeds. Open the video's **Text** section in Studio, set each language's value,
then re-record: `screenci record` fetches the current values and injects them
before the run, with the code-declared values as the fallback. A seeded field can
also be overridden per language in Studio; clearing the override falls back to the
code value. Because on-screen text is captured into the recording (not
re-rendered), Studio text always takes effect on the next record, never on a
one-off re-render.

## Localized recordings (per-language capture)

By default `video.localize` records a **separate pass per language**, setting the
browser locale from the language and exposing the active `language` to the body.
That is ideal when the UI itself differs per language: the app renders translated
text, you navigate to a localized route, or you want the browser locale set.

```ts
import { video, voices } from 'screenci'

video.localize({
  narration: {
    en: { intro: 'Open the settings page.' },
    fi: { intro: 'Avaa asetussivu.' },
  },
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
`locales` when you need a specific region:

```ts
video.localize({
  narration: {
    en: { intro: 'Welcome.' },
    pt: { intro: 'Bem-vindo.' },
  },
  locales: { en: 'en-GB', pt: 'pt-BR' },
})('Pricing', async ({ page, language }) => {
  await page.goto('/' + language + '/pricing')
})
```

To skip setting the browser locale entirely, pass `browserLocale: false`.

### Shared capture mode

To capture once and overdub narration per language at render (instead of a pass
per language), pass `mode: 'shared'`. This is ideal when the visible UI is
identical across languages. The body's `language` fixture is then `undefined`:

```ts
video.localize({
  narration: {
    en: { intro: 'Welcome.' },
    fi: { intro: 'Tervetuloa.' },
  },
  mode: 'shared',
})('Tour', async ({ page, narration }) => {
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

`screenshot.localize` supports localized `text` (a still is silent, so it takes
no narration). Each language produces its own localized still:

```ts
import { screenshot } from 'screenci'

screenshot.localize({
  text: {
    en: { heading: 'Dashboard' },
    fi: { heading: 'Hallinta' },
  },
})('Dashboard hero', async ({ page, language, text, crop }) => {
  await page.goto('/' + language + '/dashboard')
  await page.getByTestId('heading').fill(text.heading)
  await crop(page.getByTestId('revenue-card'), { padding: 0.06 })
})
```

### Variants with `each`

`video.each([...])` (and `screenshot.each([...])`) produce a **separate video
per variant**, for cases like viewport or theme. Each variant has its own
identity and history. It chains with `.localize(...)`:

```ts
video
  .each([
    { key: 'mobile', recordOptions: { aspectRatio: '9:16' } },
    { key: 'desktop', recordOptions: { aspectRatio: '16:9' } },
  ])
  .localize({
    narration: {
      en: { intro: 'Welcome.' },
      fi: { intro: 'Tervetuloa.' },
    },
  })('Landing', async ({ page, language, narration }) => {
  await page.goto('/' + language)
  await narration.intro()
})
```

This records `Landing mobile` and `Landing desktop` as separate videos, each
with `en` and `fi` language versions.

### Run modifiers

`video.localize({...})` supports the usual run modifiers, chained before the
call: `.only(...)`, `.skip`, `.fixme`, and `.fail`. The in-body conditional
`video.skip(condition, reason)` still exists separately for skipping mid-test.

## Voice per language and per cue

The default voice for every language is set once with `renderOptions.narration.voice`
(in your config or `video.use(...)`). The localize `voice` is a per-language map
that overrides that default; it may be partial, and any language you omit keeps
the default. Use it when a language needs a different voice or delivery profile:

```ts
import { video, voices } from 'screenci'

video.localize({
  voice: {
    en: { name: voices.Ava },
    fi: { name: voices.Nora, pacing: 0.95 },
    de: {
      name: voices.Julian,
      modelType: 'expressive',
      style: 'A friendly and energetic German speaker.',
    },
  },
  narration: {
    en: { intro: 'Welcome to the dashboard.' },
    fi: { intro: 'Tervetuloa hallintapaneeliin.' },
    de: { intro: 'Willkommen im Dashboard.' },
  },
})('Dashboard tour', async ({ page, narration }) => {
  await narration.intro()
})
```

The German entry above is a Business-tier example because it uses expressive
narration. A per-language voice can also carry a `seed` (an integer mixed into
the audio cache key) to force regeneration or pin a specific take.

To override a single cue, use the object form of the cue value and pass its own
`voice`. This is the most specific level of the cascade:

```ts
video.localize({
  voice: { en: { name: voices.Ava } }, // this language's voice; a cue can still override it
  narration: {
    en: {
      intro: 'Welcome to the dashboard.',
      // This one line is read by a different voice.
      alert: {
        cue: 'Heads up: billing is overdue.',
        voice: { name: voices.Marcus },
      },
    },
  },
})('Dashboard tour', async ({ page, narration }) => {
  await narration.intro()
  await narration.alert()
})
```

The voice is resolved per cue and language, first defined wins: the per-cue
`voice` overrides the localize `voice` (this language's map entry), which
overrides the `renderOptions.narration.voice` default set with `use`, which falls
back to a built-in voice. Because voice is never captured, you can change it at
any level and re-render without re-recording the browser.

### Speak a cue in a different language

A cue object can also set `language`, the locale its text is spoken in. It
defaults to the version language, so you only set it when a single line should be
pronounced in another language: a brand name, a quoted phrase, or a line you keep
in a base language on purpose. The text is always present (subtitles show that
exact text); `language` only changes the synthesis locale, not the version.

```ts
video.localize({
  narration: {
    en: { intro: 'Welcome.', tagline: 'Just do it' },
    fi: {
      intro: 'Tervetuloa.',
      // Spoken in English inside the Finnish version (e.g. a brand tagline).
      tagline: { cue: 'Just do it', language: 'en' },
    },
  },
})('Landing', async ({ narration }) => {
  await narration.intro()
  await narration.tagline()
})
```

`language` applies only to spoken (text) cues, not to file-based `media` cues
(those carry their own audio). It is part of the audio cache key, so changing it
regenerates just that cue.

When you use ElevenLabs-specific voices or custom voice assets, keep each cue as
its own sentence-sized unit. That makes re-recording cheaper and avoids paying
to regenerate long blocks when only one line changes.

## Available voices

ScreenCI ships with built-in voices that you can use across supported languages
through the `voices` export.

| Name       | Gender | Character                      |
| ---------- | ------ | ------------------------------ |
| `Adrian`   | Male   | Clear, direct, and structured  |
| `Aria`     | Female | Soft and calm                  |
| `Ava`      | Female | Bright and optimistic          |
| `Clara`    | Female | Cheerful and energetic         |
| `Daniel`   | Male   | Clear and educational          |
| `Elena`    | Female | Smooth and composed            |
| `Emma`     | Female | Youthful and playful           |
| `Ethan`    | Male   | Warm and approachable          |
| `Evan`     | Male   | Casual and relaxed             |
| `Grace`    | Female | Gentle and caring              |
| `Hassan`   | Male   | Insightful and reliable        |
| `Helena`   | Female | Mature and authoritative       |
| `Isabella` | Female | Confident and proactive        |
| `Julian`   | Male   | Polished and fluid             |
| `Layla`    | Female | Warm and empathetic            |
| `Leo`      | Male   | High-energy and enthusiastic   |
| `Lily`     | Female | Light and effortless           |
| `Marcus`   | Male   | Firm and directive             |
| `Max`      | Male   | Upbeat and lively              |
| `Maya`     | Female | Relaxed and flexible           |
| `Miles`    | Male   | Grounded and assertive         |
| `Noah`     | Male   | Soft and intimate              |
| `Nora`     | Female | Strong and decisive            |
| `Omar`     | Male   | Detailed and explanatory       |
| `Ryan`     | Male   | Dynamic and spirited           |
| `Sam`      | Male   | Relaxed and conversational     |
| `Sophie`   | Female | Precise and easy to understand |
| `Thomas`   | Male   | Balanced and steady            |
| `Victor`   | Male   | Deep and serious               |
| `Zoe`      | Female | Positive and motivating        |

## Available languages

`video.localize` accepts the following supported language keys:

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

## Model type

Use `modelType` (on the localize `voice`) when you need to choose between
consistency and expressiveness.

- `consistent` is the safer default for docs and product walkthroughs
- `expressive` is useful when you want a more natural, less uniform delivery
- `expressive` and `style` prompts require the Business tier

## ElevenLabs voices

ElevenLabs voices require the ScreenCI Business tier and use your own
ElevenLabs API key. Keep `ELEVENLABS_API_KEY` in your configured `envFile` or
project `.env`. See [Configuration](/docs/reference/configuration). ScreenCI
loads that file automatically for local commands, and ScreenCI does not store
the raw API key or use it for anything except synthesizing narration for your
videos.

For example, your project `.env` can contain:

```dotenv
SCREENCI_SECRET=added_by_npx_screenci_record
ELEVENLABS_API_KEY=your_elevenlabs_api_key
```

Use `voices.elevenlabs({ voiceId })` when you want to target a specific
ElevenLabs voice from your own account. Set it as the localize `voice`:

```ts
import { video, voices } from 'screenci'

video.localize({
  voice: {
    en: { name: voices.elevenlabs({ voiceId: 'tMvyQtpCVQ0DkixuYm6J' }) },
  },
  narration: {
    en: {
      intro: 'Welcome to the dashboard.',
      details: 'Open settings to review billing details.',
    },
  },
})('Billing walkthrough', async ({ page, narration }) => {
  await narration.intro()

  await narration.details.start()
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Open billing' }).click()
  await narration.details.end()
})
```

Replace the `voiceId` with the voice from your ElevenLabs account. For the
env-file setup, see [Configuration](/docs/reference/configuration).

ScreenCI supports the ElevenLabs `eleven_multilingual_v2` model only. Its
supported per-voice controls are `stability` (`0`–`1`), `similarityBoost`
(`0`–`1`), numeric `style` exaggeration (`0`–`1`), `speed` (`0.7`–`1.2`),
and `useSpeakerBoost`. These fields are accepted only for
`voices.elevenlabs(...)` and custom cloned voices:

```ts
video.localize({
  voice: {
    en: {
      name: voices.elevenlabs({ voiceId: 'tMvyQtpCVQ0DkixuYm6J' }),
      stability: 0.45,
      similarityBoost: 0.8,
      style: 0.2,
      speed: 0.9,
      useSpeakerBoost: true,
    },
  },
  narration: { en: { intro: 'Welcome to the dashboard.' } },
})('Billing walkthrough', async ({ narration }) => {
  await narration.intro()
})
```

See the ElevenLabs
[Create speech with timing API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)
for the upstream request fields. ElevenLabs `style` is a numeric exaggeration
control. It is not the free-form style prompt available to ScreenCI expressive
model voices.

Author cues sparingly, one sentence at a time, instead of large paragraphs.
ScreenCI also uses the ElevenLabs API sparingly: generated narration is cached
per cue, so unchanged cues are reused and only changed narration is synthesized
again. Smaller cues keep the timeline easier to control and further reduce API
cost when you revise only part of the script.

### Clone a voice from an audio sample

Instead of a `voiceId` from your account, you can clone a voice from a local
audio or video sample using ElevenLabs Instant Voice Cloning. This also requires
the Business tier and your own `ELEVENLABS_API_KEY` (see the setup above).

Use the same `voices.elevenlabs(...)` helper, but pass `{ path }` instead of
`{ voiceId }`:

```ts
video.localize({
  voice: { en: { name: voices.elevenlabs({ path: './my-voice.mp3' }) } },
  narration: {
    en: {
      intro: 'Welcome to the dashboard.',
      details: 'Open settings to review billing details.',
    },
  },
})('Billing walkthrough', async ({ page, narration }) => {
  await narration.intro()

  await narration.details.start()
  await page.goto('/settings')
  await narration.details.end()
})
```

The `path` is resolved relative to your video script. The sample can be an
`.mp3` audio file or an `.mp4` video file. ScreenCI uploads the sample and
creates the cloned voice once, then reuses it: the clone is keyed by the sample
and language, so the same file does not get re-cloned on later runs.

A cloned voice is an ElevenLabs voice, so it accepts the same
`eleven_multilingual_v2` controls as `voices.elevenlabs(...)`, and can be set as
the default voice in `use` or as an entry in the per-language `voice` map:

```ts
video.localize({
  voice: {
    en: {
      name: voices.elevenlabs({ path: './my-voice.mp3' }),
      stability: 0.45,
      similarityBoost: 0.8,
      speed: 0.95,
    },
    // A different sample (or a built-in voice) for another language.
    fi: { name: voices.elevenlabs({ path: './my-voice-fi.mp3' }) },
  },
  narration: {
    en: { intro: 'Welcome to the dashboard.' },
    fi: { intro: 'Tervetuloa hallintapaneeliin.' },
  },
})('Billing walkthrough', async ({ narration }) => {
  await narration.intro()
})
```

Only clone voices you have the right to use. Use samples of your own voice, or
voices you are licensed to reproduce, in line with the ElevenLabs
[voice cloning terms](https://elevenlabs.io/docs/product-guides/voices/voice-cloning).

> **Note:** Your ElevenLabs account has a limit on how many custom voices it can
> hold (the cap depends on your plan). When that limit is reached, cloning a new
> voice fails and the render fails with it. If a render fails for this reason,
> open the [Voices page](https://elevenlabs.io/app/voice-lab) in your ElevenLabs
> account, delete custom voices you no longer need to free up slots, then re-run
> the render. ScreenCI names cloned voices `ScreenCI:<language>:<file>` (for
> example `ScreenCI:en:my-voice.mp3`), so they are easy to spot in the list.

## Manage narration from Studio

On the Business tier you can manage narration text from the web app instead of
code. Declare the cue names under `video.studio({ narration: [...] })` and let
Studio own the spoken text per language:

```ts
import { video } from 'screenci'

video
  // Studio fills in the text per language for these cue names.
  .studio({ narration: ['intro', 'save'] })
  .localize({ languages: ['en', 'fi'] })(
  'Settings',
  async ({ page, narration }) => {
    await narration.intro()
    await page.goto('/settings')
    await narration.save()
  }
)
```

Studio names are language-agnostic (declared once) and must be disjoint from the
seeded `narration` map. You can also mix the two: seed some cues in
`localize({ narration })` and list the Studio-managed ones in
`video.studio({ narration: [...] })`. When everything is Studio-managed, pass
`languages` explicitly via `.localize({ languages: [...] })`, since there is no
seeded text to infer them from. The same applies to text via
`video.studio({ text: [...] })`. The markers still carry timing the same way;
only the text lives in Studio. See [Studio](/docs/guides/studio).
