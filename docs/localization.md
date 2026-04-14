---
title: Narrations & Localization
description: Complete guide to createNarration — voices, languages, regions, model types, styles, per-language overrides, and file-based narration.
---

# Narrations & Localization

`createNarration()` is how you add narration to a ScreenCI video. You write the text; ScreenCI synthesizes the audio and syncs it to the recording at render time. Each key becomes a typed controller that you await directly to start it.

```ts
import { createNarration, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Aria },
  languages: {
    en: {
      cues: {
        intro: 'Welcome to the dashboard.',
        addButton: 'Click here to create a new project.',
      },
    },
  },
})
```

---

## Available voices

All built-in voices are language-agnostic — the same name works for any supported language. Pass a voice via `voices.<Name>`.

| Name       | Gender | Character                                                             |
| ---------- | ------ | --------------------------------------------------------------------- |
| `Adrian`   | Male   | Clear — Direct and structured, ideal for straightforward explanations |
| `Aria`     | Female | Soft — Calm and soothing, reduces friction                            |
| `Ava`      | Female | Bright — Fresh and optimistic, brings clarity                         |
| `Clara`    | Female | Bright — Cheerful and energetic, uplifts the user experience          |
| `Daniel`   | Male   | Informative — Clear and educational, focused on useful information    |
| `Elena`    | Female | Smooth — Graceful and composed, maintains consistent flow             |
| `Emma`     | Female | Youthful — Playful and fresh, appeals to a modern audience            |
| `Ethan`    | Male   | Friendly — Warm and approachable, makes interactions feel personal    |
| `Evan`     | Male   | Easy-going — Casual and relaxed, reduces stress                       |
| `Grace`    | Female | Gentle — Soft and caring, ideal for sensitive contexts                |
| `Hassan`   | Male   | Knowledgeable — Insightful and reliable, conveys expertise            |
| `Helena`   | Female | Mature — Experienced and composed, conveys trust and authority        |
| `Isabella` | Female | Forward — Proactive and confident, drives users toward action         |
| `Julian`   | Male   | Smooth — Polished and fluid, ideal for premium experiences            |
| `Layla`    | Female | Warm — Kind and empathetic, builds trust and comfort                  |
| `Leo`      | Male   | Excitable — High-energy and enthusiastic, great for motivation        |
| `Lily`     | Female | Breezy — Light and effortless, creates a relaxed interaction          |
| `Marcus`   | Male   | Firm — Confident and directive, suited for authority                  |
| `Max`      | Male   | Upbeat — Energetic and lively, keeps interactions engaging            |
| `Maya`     | Female | Easy-going — Relaxed and flexible, reduces pressure                   |
| `Miles`    | Male   | Firm — Grounded and assertive, ensures clarity and direction          |
| `Noah`     | Male   | Breathy — Soft and intimate, creates a close and attentive feel       |
| `Nora`     | Female | Firm — Strong and decisive, helps users stay on track                 |
| `Omar`     | Male   | Informative — Detailed and explanatory, ideal for complex information |
| `Ryan`     | Male   | Lively — Dynamic and spirited, adds energy to interactions            |
| `Sam`      | Male   | Casual — Relaxed and informal, perfect for conversational experiences |
| `Sophie`   | Female | Clear — Precise and easy to understand, minimizes confusion           |
| `Thomas`   | Male   | Even — Balanced and steady, provides a consistent experience          |
| `Victor`   | Male   | Gravelly — Deep and textured, conveys strength and seriousness        |
| `Zoe`      | Female | Upbeat — Positive and motivating, encourages continued interaction    |

```ts
import { createNarration, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Nora },
  languages: {
    en: { cues: { intro: "Let's get started." } },
  },
})
```

---

## Available languages

The `languages` map accepts any supported language code as a key. TypeScript enforces that all language entries share the same cue keys.

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

---

## Region selection

When a language has multiple regional variants (e.g. English US vs. British), use `region` together with `languageRegions` to pick the right locale for synthesis.

```ts
import { createNarration, voices, languageRegions } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Ava },
  languages: {
    en: {
      region: languageRegions.en.US, // 'en-US'
      cues: { intro: 'Welcome.' },
    },
  },
})
```

Available regions per language (BCP-47):

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

---

## Model type

`modelType` selects the synthesis engine for a voice.

| Value          | Character                                                              |
| -------------- | ---------------------------------------------------------------------- |
| `'consistent'` | High-quality, stable synthesis — same result on every render. Default. |
| `'expressive'` | More natural-sounding, dynamic delivery — slight variation per render. |

```ts
import { createNarration, voices, modelTypes } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Ava, modelType: modelTypes.consistent },
  languages: {
    en: { cues: { intro: 'Hello.' } },
  },
})
```

Use `modelTypes.expressive` when you want the narration to sound more human and less uniform. Use `modelTypes.consistent` (the default) when you need the audio to be identical across re-renders.

---

## Style, Accent, and Pacing

`style`, `accent`, and `pacing` are free-text director's notes that steer how the expressive model delivers the voice. They are only available with `modelType: 'expressive'` (or implied when `style` is set without `modelType`).

These map directly to the expressive synthesis prompt fields.

### Style

Sets the tone and character of the speaker — personality, energy, and emotional register.

```ts
const narration = createNarration({
  voice: {
    name: voices.Nora,
    style:
      'A calm and confident product guide, speaking clearly and at a measured pace.',
  },
  languages: {
    en: { cues: { intro: "Let's walk through the settings page." } },
  },
})
```

Tips:

- Describe the speaker's personality, not just the tone ("a confident product manager" rather than "confident").
- Keep it under two sentences — more does not help.

### Accent

Describes the desired accent for the voice. The more specific, the better the result.

Optional. When omitted, no accent instruction is sent to the model — the voice uses its natural default.

```ts
voice: {
  name: voices.Nora,
  style: 'A calm and confident product guide.',
  accent: 'Received Pronunciation British English',
}
```

Tips:

- Be specific: `'Southern American English'` beats `'American'`.
- For regional languages, name the dialect or region: `'Helsinki Finnish'`, `'Zürich German'`.

### Pacing

Describes the overall speed and tempo of the delivery. Controls how fast or slow the voice speaks and any rhythm patterns.

```ts
voice: {
  name: voices.Nora,
  style: 'A calm and confident product guide.',
  pacing: 'Measured and deliberate, with brief pauses between key points.',
}
```

Tips:

- Describe tempo and rhythm together: `'Brisk and energetic, with punchy delivery'`.
- For product demos, `'Steady and clear'` works well. For promos, try `'Upbeat with a bouncing cadence'`.

---

## Overriding voice per language

Set a `voice` inside any language entry to override the top-level voice for that language. This is the recommended approach for multi-language videos where different regions have different canonical voices.

```ts
import { createNarration, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Ava }, // default: all languages
  languages: {
    en: {
      cues: { intro: 'Welcome.', save: 'Hit save.' },
    },
    fi: {
      voice: { name: voices.Nora }, // overrides Ava for Finnish
      cues: { intro: 'Tervetuloa.', save: 'Tallenna.' },
    },
    de: {
      voice: {
        name: voices.Julian,
        modelType: 'expressive',
        style: 'A friendly and energetic German speaker.',
      },
      cues: { intro: 'Willkommen.', save: 'Speichern.' },
    },
  },
})
```

Per-language overrides also support `region`:

```ts
fi: {
  voice: { name: voices.Nora },
  region: languageRegions.fi.FI,
  cues: { intro: 'Tervetuloa.' },
},
```

### Seed

`seed` is an integer that is included in the audio cache key. Its exact effect depends on the TTS provider:

| Provider                     | Effect of `seed`                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| ElevenLabs (built-in voices) | Same seed + same inputs → same audio every time (deterministic)                            |
| Built-in model voice         | Seed support depends on model and provider behavior — audio may vary between regenerations |

For all providers, **changing the seed always forces a full regeneration** — the cached audio is discarded and a new synthesis request is made. Use this to get a fresh take without changing any other settings.

```ts
fi: {
  voice: { name: voices.Nora, seed: 42 },
  cues: { intro: 'Tervetuloa.' },
},
```

To regenerate, increment the seed:

```ts
fi: {
  voice: { name: voices.Nora, seed: 43 }, // forces new synthesis
  cues: { intro: 'Tervetuloa.' },
},
```

`seed` is only allowed inside per-language `voice` overrides, not at the top level.

---

## Using an ElevenLabs voice by ID

For voices not in the built-in library, pass an ElevenLabs voice ID using `voices.elevenlabs()`:

```ts
import { createNarration, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.elevenlabs({ voiceId: 'tMvyQtpCVQ0DkixuYm6J' }) },
  languages: {
    en: { cues: { intro: 'Hello from a custom ElevenLabs voice.' } },
  },
})
```

You can mix built-in and ElevenLabs voices across languages:

```ts
const narration = createNarration({
  voice: { name: voices.Aria },
  languages: {
    en: { cues: { intro: 'Welcome.' } },
    fi: {
      voice: { name: voices.elevenlabs({ voiceId: 'your-fi-voice-id' }) },
      cues: { intro: 'Tervetuloa.' },
    },
  },
})
```

---

## Cloning a voice from a file (ElevenLabs Instant Voice Cloning)

Pass a `CustomVoiceRef` — an object with a `path` to a local audio file — as the voice name to use ElevenLabs Instant Voice Cloning. ScreenCI uploads the file and synthesizes the narration using the cloned voice.

```ts
import { createNarration, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Ava }, // fallback for other languages
  languages: {
    en: {
      voice: { name: { path: './assets/my-voice-sample.mp3' } },
      cues: { intro: 'Hello — this is my own voice.' },
    },
  },
})
```

The file can be an MP3, WAV, or MP4. ElevenLabs requires at least a few seconds of clean speech for a good result; 30–60 seconds is ideal.

---

## Using a pre-recorded file as narration

Instead of synthesized text, you can supply a pre-recorded audio or video file for any cue key. Assign an object with a `path` instead of a plain string:

```ts
const narration = createNarration({
  voice: { name: voices.Aria },
  languages: {
    en: {
      cues: {
        intro: {
          media: './assets/intro-narration.mp3',
          subtitle: 'Welcome to the dashboard.',
        },
        addButton: 'Click here to create a new project.',
      },
    },
  },
})
```

`subtitle` is optional. When present, it is shown as the on-screen cue text instead of being synthesized.

### Narration video in the corner

When the `path` points to an `.mp4` file, ScreenCI plays it as a picture-in-picture overlay in the corner of the video (configured via `renderOptions.narration`). This is useful for presenter-style videos where a talking-head clip accompanies the screen recording:

```ts
const narration = createNarration({
  voice: { name: voices.Nora, modelType: 'consistent' },
  languages: {
    en: {
      cues: {
        intro: {
          media: './assets/intro-en.mp4', // PiP video shown in the corner
          subtitle: 'This is the introduction.',
        },
        nextStep: "Now let's look at the settings.", // synthesized TTS
      },
    },
  },
})
```

Configure the overlay position and size in `video.use()`:

```ts
video.use({
  renderOptions: {
    recording: {
      size: 0.7,
      dropShadow: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))',
    },
    narration: {
      size: 0.3, // fraction of the output frame
      corner: 'bottom-right',
      shape: 'rounded',
      roundness: 0.5,
      padding: 0.01,
      dropShadow: 'drop-shadow(rgba(0,0,0,0.5) 6px 6px 15px)',
    },
  },
})
```

You can mix file-based and synthesized entries within the same `createNarration()` call and across languages.

---

Voice settings are stored per cue entry, not per language for the whole file. You can use different speakers, `modelType` values, and expressive settings for different cues even when they share the same language code.
