# Narration and Localization

ScreenCI narration is cue-based. You define named spoken lines, then place those cues into the visible flow where speech should start, overlap, and end. This keeps the script readable and makes multi-language output easier to maintain.

#### You will learn

- [how to define narration cues](#start-with-one-language)
- [how to overlap narration with visible motion](#timing-modes)
- [how to localize the same video](#add-localization)
- [how to keep translations consistent](#add-localization)

## Start with one language

```ts
import { createNarration, video, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Sophie },
  languages: {
    en: {
      cues: {
        intro: 'Open the settings page.',
        save: 'Save the changes when you are ready.',
      },
    },
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

That is the main tool for overlapping speech with UI motion without losing control of the timeline.

## Add localization

Add more languages by keeping the same cue keys:

```ts
const narration = createNarration({
  voice: { name: voices.Sophie },
  languages: {
    en: {
      cues: {
        intro: 'Open the settings page.',
      },
    },
    fi: {
      cues: {
        intro: 'Avaa asetussivu.',
      },
    },
  },
})
```

TypeScript helps here: every language must provide the same cue structure, which catches drift early.

## Available voices

ScreenCI ships with built-in voices that you can use across supported languages through the `voices` export.

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

Example:

```ts
import { createNarration, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Nora },
  languages: {
    en: { cues: { intro: "Let's get started." } },
  },
})
```

Pick the voice for clarity first. A polished walkthrough usually benefits more from consistency than from novelty.

## Available languages

The `languages` map accepts supported language codes as keys. ScreenCI's type system keeps all language variants aligned around the same cue keys, which is the main safeguard against translation drift inside the script.

| Code  | Language    | Code | Language           |
| ----- | ----------- | ---- | ------------------ |
| `ar`  | Arabic      | `lt` | Lithuanian         |
| `az`  | Azerbaijani | `lv` | Latvian            |
| `bg`  | Bulgarian   | `mk` | Macedonian         |
| `bn`  | Bengali     | `ml` | Malayalam          |
| `ca`  | Catalan     | `mn` | Mongolian          |
| `cs`  | Czech       | `mr` | Marathi            |
| `da`  | Danish      | `ms` | Malay              |
| `de`  | German      | `my` | Burmese            |
| `el`  | Greek       | `nb` | Norwegian Bokmål   |
| `en`  | English     | `ne` | Nepali             |
| `es`  | Spanish     | `nl` | Dutch              |
| `et`  | Estonian    | `pa` | Punjabi            |
| `eu`  | Basque      | `pl` | Polish             |
| `fa`  | Persian     | `pt` | Portuguese         |
| `fi`  | Finnish     | `ro` | Romanian           |
| `fil` | Filipino    | `ru` | Russian            |
| `fr`  | French      | `si` | Sinhala            |
| `gl`  | Galician    | `sk` | Slovak             |
| `gu`  | Gujarati    | `sl` | Slovenian          |
| `he`  | Hebrew      | `sq` | Albanian           |
| `hi`  | Hindi       | `sr` | Serbian            |
| `hr`  | Croatian    | `sv` | Swedish            |
| `hu`  | Hungarian   | `sw` | Swahili            |
| `hy`  | Armenian    | `ta` | Tamil              |
| `id`  | Indonesian  | `te` | Telugu             |
| `is`  | Icelandic   | `th` | Thai               |
| `it`  | Italian     | `tr` | Turkish            |
| `ja`  | Japanese    | `uk` | Ukrainian          |
| `ka`  | Georgian    | `ur` | Urdu               |
| `kn`  | Kannada     | `vi` | Vietnamese         |
| `ko`  | Korean      | `zh` | Chinese (Mandarin) |

## Region selection

When a language has multiple regional variants, set `region` explicitly so the synthesis matches the audience more closely.

```ts
import { createNarration, languageRegions, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Ava },
  languages: {
    en: {
      region: languageRegions.en.US,
      cues: { intro: 'Welcome.' },
    },
  },
})
```

Available regions per language:

| Language | Regions                            |
| -------- | ---------------------------------- |
| `ar`     | `ar-SA`, `ar-AE`, `ar-EG`          |
| `bn`     | `bn-BD`, `bn-IN`                   |
| `de`     | `de-DE`, `de-AT`, `de-CH`          |
| `en`     | `en-US`, `en-GB`, `en-AU`, `en-IN` |
| `es`     | `es-ES`, `es-MX`, `es-US`, `es-AR` |
| `fr`     | `fr-FR`, `fr-CA`, `fr-BE`, `fr-CH` |
| `nl`     | `nl-NL`, `nl-BE`                   |
| `pt`     | `pt-BR`, `pt-PT`                   |
| `sw`     | `sw-KE`, `sw-TZ`                   |
| `ta`     | `ta-IN`, `ta-LK`                   |
| `zh`     | `zh-CN`, `zh-TW`, `zh-HK`          |

Languages not listed above have a single region variant and do not require an explicit `region`.

## Per-language voice overrides

When a project needs different regional or voice choices, use language-specific settings instead of forcing one voice profile to fit every market.

Common cases:

- different English regions
- slower pacing for one language
- a different voice choice for accessibility or brand reasons

```ts
import { createNarration, languageRegions, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Ava },
  languages: {
    en: {
      region: languageRegions.en.US,
      cues: {
        intro: 'Welcome to the dashboard.',
      },
    },
    fi: {
      voice: { name: voices.Nora, pacing: 0.95 },
      cues: {
        intro: 'Tervetuloa hallintapaneeliin.',
      },
    },
    de: {
      voice: {
        name: voices.Julian,
        modelType: 'expressive',
        style: 'A friendly and energetic German speaker.',
      },
      cues: {
        intro: 'Willkommen im Dashboard.',
      },
    },
  },
})
```

Use the top-level `voice` as the default and override only the languages that genuinely need a different voice, region, or delivery profile.

## Model type

Use `modelType` when you need to choose between consistency and expressiveness.

- `consistent` is the safer default for docs and product walkthroughs
- `expressive` is useful when you want a more natural, less uniform delivery

In practice:

- use `consistent` when you want cues to sound more uniform throughout the video
- use `expressive` when you want to prompt the spoken style, get a more natural feel, and allow a bit more variance between cues

```ts
import { createNarration, voices } from 'screenci'

const narration = createNarration({
  voice: {
    name: voices.Ava,
    modelType: 'consistent',
    pacing: 0.9,
  },
  languages: {
    en: {
      cues: {
        intro: 'Welcome.',
      },
    },
  },
})
```

```ts
import { createNarration, voices } from 'screenci'

const narration = createNarration({
  voice: {
    name: voices.Ava,
    modelType: 'expressive',
    style: 'A warm and natural product guide.',
    pacing: 'Measured and deliberate, with brief pauses between key points.',
  },
  languages: {
    en: {
      cues: {
        intro: 'Welcome.',
      },
    },
  },
})
```

With `consistent`, `pacing` is a numeric speaking rate. With `expressive`, `pacing` becomes a natural-language direction for tempo and rhythm.

## Style, accent, and pacing

These controls matter once the base script is already good.

- `style` describes the speaker's persona or delivery style
- `accent` gives the model a more specific regional target
- `pacing` controls how quickly lines are spoken

Examples:

```ts
voice: {
  name: voices.Nora,
  style: 'A calm and confident product guide.',
  accent: 'Received Pronunciation British English',
}
```

```ts
voice: {
  name: voices.Nora,
  modelType: 'consistent',
  pacing: 1.1,
}
```

```ts
const narration = createNarration({
  voice: {
    name: voices.Nora,
    modelType: 'expressive',
    style:
      'A calm and confident product guide, speaking clearly and at a measured pace.',
    accent: 'Received Pronunciation British English',
    pacing: 'Steady and deliberate, with brief pauses between key points.',
  },
  languages: {
    en: {
      cues: {
        intro: "Let's walk through the settings page.",
      },
    },
  },
})
```

With `modelType: 'consistent'`, use `pacing` numbers around `1` and adjust modestly. With `modelType: 'expressive'`, `style`, `accent`, and text pacing notes work better than over-specifying every line.

Keep these settings modest. Over-directing the voice usually hurts more than it helps.
