import { hide, video, voices } from 'screenci'

// Each cue carries its own style prompt, so the same voice adapts its delivery
// per line without any audio editing.
video.narration({
  en: {
    hook: {
      cue: 'Every narration line can have its own speaking style.',
      voice: {
        name: voices.Nora,
        style: 'Warm and intriguing, drawing the viewer in.',
      },
    },
    explain: {
      cue: 'You write a style prompt alongside the text, and the delivery follows it.',
      voice: {
        name: voices.Nora,
        style: 'Measured and instructional, making a point clearly.',
      },
    },
    reveal: {
      cue: 'One script can shift from a calm explainer to an excited reveal, in the same render.',
      voice: {
        name: voices.Nora,
        style: 'Energetic and enthusiastic, building into a reveal.',
      },
    },
    outro: {
      cue: 'Write the style in plain English. The voice does the rest.',
      voice: {
        name: voices.Nora,
        style: 'Confident and conclusive, landing the final thought.',
      },
    },
  },
})('Per-cue speaking style', async ({ page, narration }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/docs/guides/narration', {
      waitUntil: 'domcontentloaded',
    })
    await page.getByRole('heading').first().waitFor()
  })

  await narration.hook()
  await narration.explain()

  await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }))
  await page.waitForTimeout(1200)

  await narration.reveal()
  await narration.outro()
})
