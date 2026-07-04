import { hide, resetZoom, video, voices, zoomTo } from 'screenci'

video.use({
  renderOptions: {
    narration: {
      voice: { name: voices.Sophie, style: 'Friendly product guide' },
    },
  },
})

const appUrl = process.env.SCREENCI_APP_URL ?? 'https://app.screenci.com/'

// Narration walkthrough recorded against the ScreenCI app (app.screenci.com) for
// the Narration guide. It explains cue-based narration out loud, then shows the
// Studio narration editor where teammates manage the spoken text without code.
// Studio lives behind auth, so recording this needs a logged-in session: set
// SCREENCI_APP_STORAGE_STATE to a Playwright storageState JSON (see
// screenci.config.ts). The navigation mirrors studio.screenci.ts.
//
// The logo intro (assets/logo.png) is gitignored: it is uploaded to the ScreenCI
// backend on the first record and reused on later runs (CI included).
video
  .overlays({
    logo: { path: './assets/logo.png', fill: 'recording', duration: '2s' },
  })
  .narration({
    en: {
      intro:
        'Narration is cue based: you attach a script, then mark where speech starts.',
      overlap:
        'A cue can start, run while the interface moves, and end on your mark.',
      studio:
        'On the Business tier, teammates manage the same narration in Studio.',
      outro: 'Change the words and re-render, with no re-recording required.',
    },
  })('Narration walkthrough', async ({ page, narration, overlays }) => {
  // Studio lives behind auth (SCREENCI_APP_STORAGE_STATE, see screenci.config.ts).
  // Skip rather than stall on the login page when the session is not configured.
  if (!process.env.SCREENCI_APP_STORAGE_STATE) {
    throw new Error(
      'Not logged in. Record via `scripts/screenci.sh docs <env> record` (it signs in first), or set SCREENCI_APP_STORAGE_STATE to a Playwright storageState.'
    )
  }

  // Open a finished video's Studio page without showing the navigation.
  await hide(async () => {
    await page.goto(appUrl)
    await page.waitForLoadState('networkidle')

    await page
      .getByRole('heading', { name: 'Projects' })
      .waitFor({ timeout: 30000 })
    await page.getByTestId('projects-list').getByRole('link').first().click()
    await page.locator('a[href*="/video/"]').first().click()
    await page
      .getByRole('heading', { name: /language versions/i })
      .waitFor({ timeout: 15000 })
    await page
      .getByRole('link', { name: /^open /i })
      .first()
      .click()
    await page
      .getByRole('heading', { name: /^studio$/i })
      .waitFor({ timeout: 30000 })
  })

  // Brand intro, then explain the cue model out loud.
  await overlays.logo.for('2s')
  await narration.intro()

  // Frame the Studio narration section while explaining overlap and Studio editing.
  await narration.overlap.start()
  const narrationHeading = page
    .getByRole('heading', { name: /narration/i })
    .first()
  if (await narrationHeading.isVisible().catch(() => false)) {
    await zoomTo(narrationHeading)
    await page.waitForTimeout(900)
    await resetZoom()
  }
  await narration.overlap.end()

  await narration.studio()
  await narration.outro()
})
