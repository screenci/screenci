import { autoZoom, createNarration, hide, video, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Sophie, style: 'Clear, friendly product walkthrough' },
  languages: {
    en: {
      cues: {
        docs: 'Here is where to find ScreenCI [pronounce: screen see eye] docs.',
      },
    },
    es: {
      cues: {
        docs: 'Aqui es donde encontrar la documentacion de ScreenCI [pronounce: screen see eye].',
      },
    },
  },
})

async function recordLandingTheme(theme: 'light' | 'dark') {
  video(`Landing ${theme}`, async ({ page }) => {
    await hide(async () => {
      await page.goto('https://screenci.com/')
      await page.waitForLoadState('networkidle')

      await page.evaluate((nextTheme) => {
        document.cookie = `themePreference=${nextTheme}; path=/`
        localStorage.setItem('starlight-theme', nextTheme)
        document.documentElement.classList.toggle('dark', nextTheme === 'dark')
        document.documentElement.setAttribute('data-theme', nextTheme)
      }, theme)

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
}

void recordLandingTheme('light')
void recordLandingTheme('dark')
