import { hide, video, voices } from 'screenci'

video.use({
  renderOptions: {
    recording: {
      size: 0.82,
      shape: 'rounded',
      roundness: 0.05,
      dropShadow:
        'drop-shadow(0 20px 44px rgba(0,0,0,0.30)) drop-shadow(0 5px 12px rgba(0,0,0,0.16))',
    },
    narration: {
      voice: {
        name: voices.Sophie,
        style: 'Calm and direct, presenting a product feature to developers.',
      },
      size: 0.26,
      shape: 'rounded',
      roundness: 0,
      corner: 'bottom-right',
      padding: 0.04,
      dropShadow: 1,
    },
    output: {
      aspectRatio: '9:16',
      quality: '1080p',
      background: {
        backgroundCss:
          'linear-gradient(170deg, #0f0c1e 0%, #1b1040 55%, #0d0b1a 100%)',
      },
    },
  },
  recordOptions: {
    aspectRatio: '9:16',
    // 720px wide viewport triggers mobile/responsive layout on the site.
    // The render output stays at 1080p (1080x1920) via renderOptions.output.
    quality: '720p',
  },
})

video.narration({
  en: {
    hook: 'Most product videos are built for landscape. But social, ads, and mobile all need vertical.',
    config:
      'ScreenCI handles vertical natively. Set the aspect ratio to nine-sixteen and the recorder opens a portrait viewport automatically.',
    demo: 'No cropping, no reframing. The whole walkthrough was captured vertically from frame one.',
    outro:
      'Same script, same narration, new format. One config change, re-render, done.',
  },
})('Vertical video output', async ({ page, narration }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/')
    await page.waitForLoadState('networkidle')
  })

  await narration.hook()
  await narration.config()

  await page.evaluate(() => window.scrollBy({ top: 320, behavior: 'smooth' }))
  await page.waitForTimeout(1600)

  await narration.demo()

  await page.evaluate(() => window.scrollBy({ top: 280, behavior: 'smooth' }))
  await page.waitForTimeout(1400)

  await narration.outro()
})
