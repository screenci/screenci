import { hide, video, voices } from 'screenci'

video.use({
  renderOptions: {
    recording: {
      size: 0.85,
      shape: 'rounded',
      roundness: 0.05,
      dropShadow:
        'drop-shadow(0 22px 49px rgba(0,0,0,0.28)) drop-shadow(0 6px 15px rgba(0,0,0,0.17))',
    },
    narration: {
      voice: {
        name: voices.Nora,
        style: 'Clear and professional product narrator.',
      },
      size: 0.3,
      shape: 'rounded',
      roundness: 0,
      corner: 'bottom-right',
      padding: 0.04,
      dropShadow: 1,
    },
    output: {
      aspectRatio: '16:9',
      quality: '1080p',
      background: {
        backgroundCss: 'linear-gradient(313deg, #ffffff 0%, #d6d6d6 100%)',
      },
    },
  },
})

// Each cue carries its own style prompt, so the voice adapts its delivery per
// line without any audio editing.
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
      cue: 'You write a style prompt alongside the text. The same voice reads the line, but the delivery follows the prompt you wrote.',
      voice: {
        name: voices.Nora,
        style: 'Measured and instructional, making a point clearly.',
      },
    },
    reveal: {
      cue: 'One script can have a calm explainer, then shift to an excited reveal, all in the same render.',
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
    await page.goto('https://screenci.com/docs/guides/narration')
    await page.waitForLoadState('networkidle')
  })

  await narration.hook()
  await narration.explain()

  await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }))
  await page.waitForTimeout(1200)

  await narration.reveal()
  await narration.outro()
})
