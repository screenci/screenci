import { hide, resetZoom, video, voices, zoomTo } from 'screenci'

video.use({
  renderOptions: {
    narration: {
      voice: { name: voices.Ava, style: 'Friendly product guide' },
    },
  },
})

const appUrl = process.env.SCREENCI_APP_URL ?? 'https://app.screenci.com/'

// Narration walkthrough recorded against the ScreenCI app (app.screenci.com) for
// the Narration guide. It explains cue-based narration out loud, then shows the
// web editor where teammates manage the spoken text without code. The Editor
// requires auth to record, so set
// SCREENCI_APP_STORAGE_STATE to a Playwright storageState JSON (see
// screenci.config.ts). The navigation mirrors editor.screenci.ts.
//
// The logo intro (assets/logo.png) is gitignored: it is uploaded to the ScreenCI
// backend on the first record and reused on later runs (CI included).
video
  .overlays({
    logo: { path: './assets/logo.png', fill: 'recording', duration: 2000 },
  })
  .narration({
    en: {
      intro:
        'Narration is cue based: you attach a script, then mark where speech starts.',
      overlap:
        'A cue can start, run while the interface moves, and end on your mark.',
      editor: 'Teammates manage the same narration in the web editor.',
      outro: 'Change the words and re-render, with no re-recording required.',
    },
  })('Narration walkthrough', async ({ page, narration, overlays }) => {
  // The Editor requires auth (SCREENCI_APP_STORAGE_STATE, see screenci.config.ts).
  // Fail before stalling on the login page when the session is not configured.
  if (!process.env.SCREENCI_APP_STORAGE_STATE) {
    throw new Error(
      'Not logged in. Record via `scripts/screenci.sh docs <env> record` (it signs in first), or set SCREENCI_APP_STORAGE_STATE to a Playwright storageState.'
    )
  }

  // Open a finished video's Editor page without showing the navigation.
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
      .getByRole('heading', { name: /^editor$/i })
      .waitFor({ timeout: 30000 })
  })

  // Brand intro, then explain the cue model out loud.
  await overlays.logo.for(2000)
  await narration.intro()

  // Frame the Editor narration section while explaining overlap and web editing.
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

  await narration.editor()
  await narration.outro()
})
