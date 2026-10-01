# Narration

Every video declares `video.narration({ ... })`, no exceptions. Pass a flat `cue -> text` object or one keyed by language (`en`, `es`, ...). Keep every declared language.

```ts
import { video, voices } from 'screenci'

video.renderOptions({ narration: { voice: { name: voices.Ava } } }).narration({
  en: {
    intro: "Let's update your billing details and save the changes.",
    form: 'On your billing page, you can change the company name and tax ID.',
    saving: 'Save the changes, and we confirm them right away.',
  },
})('Update billing details', async ({ page, narration }) => {
  await narration.intro()
  await narration.form()
  await narration.saving.start()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await narration.saving.end()
})
```

Voice is a render option, not part of the narration text.

## Writing the lines

- The opening line states the video's purpose, then the walkthrough follows.
- **Narrate the flow, not the clicks.** Describe what the user achieves ("Invite your teammates and set their roles"), never mechanics ("Now click the blue button"). A handful of broad cues beats one per action.
- **Speak as the company that makes the product.** "We"/"our" for the company, "you" for the viewer. Never describe the company or its product in the third person ("Acme lets you...", "their dashboard"). Naming the product is fine.
- **Present the demo as real.** Never say in narration, overlays, or titles that data is mock, sample, test, or fictitious, or that a form is not submitted. Refer to data as it appears ("Emma's order").
- **Use the product's own vocabulary** from its source and on-screen copy.

## Cues

- `await narration.key()` plays the full line before moving on.
- `await narration.key.start()` lets the line overlap the next actions; `await narration.key.end()` closes it, especially before visible navigation.

## Tags

- Pause tags (`[short pause]`, `[medium pause]`, `[long pause]`) are fine when a line needs a beat.
- Do not add `[pronounce: ...]` tags on your own. The voices say brand names and domains correctly. Add one only when the person says a word is spoken wrong, and only on that word.
