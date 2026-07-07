import { hide, video } from 'screenci'

video
  .renderOptions({
    recording: { size: 0.96, roundness: 0.04 },
    output: {
      aspectRatio: '9:16',
      quality: '1080p',
      background: { backgroundCss: '#ffffff' },
    },
  })
  .recordOptions({ aspectRatio: '9:16', quality: '720p' })(
  'Vertical video',
  async ({ page }) => {
    await hide(async () => {
      await page.goto('https://screenci.com/', {
        waitUntil: 'domcontentloaded',
      })
      await page.getByRole('heading', { level: 1 }).first().waitFor()
    })

    await page.waitForTimeout(4500)
  }
)
