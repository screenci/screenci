import { autoZoom, hide, video, voices } from 'screenci'

// The default voice (how narration is spoken) for every language.
video.use({ renderOptions: { narration: { voice: { name: voices.Sophie } } } })

// Localized narration cues by language, plus a brand intro overlay. The fixture
// exposes narration markers and overlay controllers to the body.
//
// The logo image (recordings/assets/logo.png) is gitignored: it is uploaded to
// the ScreenCI backend on the first record and reused on later runs (CI
// included), so the binary does not need to be committed.
video
  .overlays({
    logo: { path: './assets/logo.png', fill: 'recording', durationMs: 2000 },
  })
  .narration({
    en: {
      docs: 'Here is where to find ScreenCI [pronounce: screen see eye] docs.',
    },
    es: {
      docs: 'Aqui es donde encontrar la documentacion de ScreenCI [pronounce: screen see eye].',
    },
  })('How to find docs', async ({ page, narration, overlays }) => {
  // Run setup without showing these actions in the final recording.
  await hide(async () => {
    await page.goto('https://screenci.com/')
    await page.waitForLoadState('networkidle')
  })

  // Open with a brief brand intro card before the walkthrough begins.
  await overlays.logo(2000)

  // Play the matching narration line for this step.
  await narration.docs()

  // Automatically zoom into interactions so they are easier to follow.
  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })
})
