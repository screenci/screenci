# Narration and Localization

ScreenCI narration is cue-based. You define named spoken lines, then place
those cues into the visible flow where speech should start, overlap, and end.
The same cue map can render as multiple language versions without duplicating
the visible browser workflow.

`style` prompts and `modelType: 'expressive'` require the Business tier. Free
and Starter users should stay with the default consistent narration flow.

#### You will learn

- [how to define narration cues](#start-with-one-language)
- [how to overlap narration with visible motion](#timing-modes)
- [how to localize the same video](#add-localization)
- [how to override voices per language](#per-language-voice-overrides)

## Start with one language

```ts
import { createNarration, video, voices } from 'screenci'

const narration = createNarration({
  // Default voice settings for all languages.
  voice: { name: voices.Sophie },
  // Localized narration cues by language.
  en: {
    intro: 'Open the settings page.',
    save: 'Save the changes when you are ready.',
  },
})

video('Settings', async ({ page }) => {
  await narration.intro()
  await page.goto('/settings')

  await narration.save.start()
  await page.getByRole('button', { name: 'Save' }).click()
  await narration.save.end()
})
```

## Timing modes

Use the cue methods intentionally:

- `await narration.key()` waits for the full spoken line to finish.
- `await narration.key.start()` begins the cue and keeps the script moving.
- `await narration.key.end()` closes the same cue later.

That is the main tool for overlapping speech with UI motion without losing
control of the timeline.

Keep cues small. In practice, one sentence per cue is the safest default for
timing, overlap control, and subtitle readability.

If only one file needs a different narration layout, pair your cue definitions
with `video.use()` instead of changing the whole project:

```ts
import { createNarration, video, voices } from 'screenci'

video.use({
  renderOptions: {
    narration: {
      corner: 'top-right',
    },
  },
})

const narration = createNarration({
  voice: { name: voices.Sophie },
  en: {
    intro: 'Open the analytics tab.',
    summary: 'Review the latest numbers.',
  },
})

video('Analytics walkthrough', async ({ page }) => {
  await narration.intro.start()
  await page.getByRole('tab', { name: 'Analytics' }).click()
  await narration.intro.end()

  await narration.summary()
})
```

## Add localization

Add more languages by keeping the same cue keys:

```ts
const narration = createNarration({
  // Default voice settings for all languages.
  voice: { name: voices.Sophie },
  // Localized narration cues by language.
  en: {
    intro: 'Open the settings page.',
  },
  fi: {
    intro: 'Avaa asetussivu.',
  },
})
```

TypeScript helps here: every language must provide the same cue structure, which
catches drift early.

Use bare language keys such as `en`, `fi`, `fr`, and `cmn`. ScreenCI treats
those as the public language versions for narration, rendering, and public URLs.

## Per-language voice overrides

When a project needs different voice choices, use language-specific settings
instead of forcing one voice profile to fit every market.

```ts
import { createNarration, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Ava },
  en: {
    intro: 'Welcome to the dashboard.',
  },
  fi: {
    voice: { name: voices.Nora, pacing: 0.95 },
    intro: 'Tervetuloa hallintapaneeliin.',
  },
  de: {
    voice: {
      name: voices.Julian,
      modelType: 'expressive',
      style: 'A friendly and energetic German speaker.',
    },
    intro: 'Willkommen im Dashboard.',
  },
})
```

The German override above is a Business-tier example because it uses expressive
narration.

Use the top-level `voice` as the default and override only the languages that
genuinely need a different voice or delivery profile.

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

Top-level language entries accept the following supported language keys:

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

Use `modelType` when you need to choose between consistency and expressiveness.

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
ElevenLabs voice from your own account:

```ts
import { createNarration, video, voices } from 'screenci'

const narration = createNarration({
  en: {
    voice: {
      name: voices.elevenlabs({ voiceId: 'tMvyQtpCVQ0DkixuYm6J' }),
    },
    intro: 'Welcome to the dashboard.',
    details: 'Open settings to review billing details.',
  },
})

video('Billing walkthrough', async ({ page }) => {
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
const narration = createNarration({
  voice: {
    name: voices.elevenlabs({ voiceId: 'tMvyQtpCVQ0DkixuYm6J' }),
    stability: 0.45,
    similarityBoost: 0.8,
    style: 0.2,
    speed: 0.9,
    useSpeakerBoost: true,
  },
  en: {
    intro: 'Welcome to the dashboard.',
  },
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

## Manage narration from Studio

On the Business tier you can manage narration from the web app instead of
code: declare cue keys with `createStudioNarration('intro', 'outro')` and fill
in text, languages, and voices on the Studio page. Existing
`createNarration` videos can also be remixed in Studio without code changes.
See [Studio](/docs/guides/studio).
