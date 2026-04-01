---
title: Localization & Voiceovers
description: Reach a global audience with automated multi-language product videos.
---

ScreenCI allows you to create localized versions of your product videos with minimal effort. By combining automated UI scripts with AI-powered narration, you can support dozens of languages from a single source of truth.

## Multi-Language UI Recording

Instead of recording separate videos for every language you support, you can use Playwright logic to toggle your application's locale during the recording phase.

```typescript
// Example recording script snippet
await page.goto('https://app.example.com/settings')
await page.click('[data-testid="language-selector"]')
await page.selectOption('select', 'fr') // Switch to French
```

ScreenCI detects these locale changes and can automatically generate separate video variants for each supported region.

## AI Narration (Voiceovers)

ScreenCI features built-in AI voice generation that syncs perfectly with your UI interactions.

1. **Define your script**: In the ScreenCI dashboard, enter the text you want the narrator to say for each step of the video.
2. **Select a voice**: Choose from 30+ high-quality, natural-sounding voices.
3. **Auto-sync**: Our engine automatically stretches or compresses the video frames to match the natural speed of the generated audio.

## Supported Languages

We currently support high-fidelity AI voices and localized text-to-speech in over 30 languages, including:

- English (US, UK, AU)
- Spanish (Spain, LATAM)
- French
- German
- Japanese
- Mandarin Chinese
- And many more...

## Localizing existing videos

If you have a video ready in English and want to launch in Japan, you don't need a new recording. Simply:

1. Duplicate the project.
2. Change the narration text to Japanese.
3. Ensure your recording script handles the locale switch (if showing the UI in Japanese).
4. Trigger a new render.
