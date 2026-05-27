import { autoZoom, createNarration, hide, video, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Sophie },
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

video('How to find docs', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/')
    await page.waitForLoadState('networkidle')
  })

  await narration.docs()

  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })
})
