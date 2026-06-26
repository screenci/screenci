import { autoZoom, hide, video, voices } from 'screenci'

// The default voice (how narration is spoken) for every language.
video.use({ renderOptions: { narration: { voice: { name: voices.Sophie } } } })

// Localized narration cues by language. The fixture exposes them as markers.
video.narration({
  en: {
    docs: 'Here is where to find ScreenCI [pronounce: screen see eye] docs.',
  },
  es: {
    docs: 'Aqui es donde encontrar la documentacion de ScreenCI [pronounce: screen see eye].',
  },
})('How to find docs', async ({ page, narration }) => {
  // Run setup without showing these actions in the final recording.
  await hide(async () => {
    await page.goto('https://screenci.com/')
    await page.waitForLoadState('networkidle')
  })

  // Play the matching narration line for this step.
  await narration.docs()

  // Automatically zoom into interactions so they are easier to follow.
  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })
})
