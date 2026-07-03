import { hide, video } from 'screenci'

video.use({
  renderOptions: {
    recording: { size: 0.82, shape: 'rounded', roundness: 0.05 },
    output: {
      aspectRatio: '9:16',
      quality: '1080p',
      background: { backgroundCss: '#ffffff' },
    },
  },
  recordOptions: { aspectRatio: '9:16', quality: '720p' },
})

video('Vertical video', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/')
    await page.waitForLoadState('networkidle')
  })

  await page.waitForTimeout(4500)
})
