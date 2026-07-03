import { autoZoom, hide, video, voices } from 'screenci'

video.use({
  renderOptions: {
    narration: {
      voice: { name: voices.Sophie, style: 'Friendly product guide' },
    },
  },
})

video.narration({
  docs: 'Here is where to find ScreenCI [pronounce: screen see eye] docs.',
})('Landing light', async ({ page, narration }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/')
    await page.waitForLoadState('networkidle')

    await page.evaluate(() => {
      document.cookie = 'themePreference=light; path=/'
      localStorage.setItem('starlight-theme', 'light')
      document.documentElement.classList.remove('dark')
      document.documentElement.setAttribute('data-theme', 'light')
    })

    await page.locator('[data-hero-video]').evaluate((element) => {
      if (!(element instanceof HTMLVideoElement)) {
        return
      }

      element.pause()
      element.currentTime = 0
    })
  })

  await narration.docs()

  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })
})
