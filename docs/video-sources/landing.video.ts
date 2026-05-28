import { autoZoom, createNarration, hide, video, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Sophie, style: 'Clear, friendly product walkthrough' },
  languages: {
    en: {
      docs: 'Here is where to find ScreenCI [pronounce: screen see eye] docs.',
    },
    es: {
      docs: 'Aqui es donde encontrar la documentacion de ScreenCI [pronounce: screen see eye].',
    },
  },
})

video('Landing light', async ({ page }) => {
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
