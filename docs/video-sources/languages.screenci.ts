import { hide, resetZoom, video, voices, zoomTo } from 'screenci'

video.use({
  renderOptions: {
    narration: {
      voice: { name: voices.Ava, style: 'Friendly product guide' },
    },
  },
})

const appUrl = process.env.SCREENCI_APP_URL ?? 'https://app.screenci.com/'

// Languages walkthrough recorded against the ScreenCI app (app.screenci.com) for
// the Languages guide. It shows the Editor Languages section where teammates add
// or remove recorded languages without touching code. The Editor requires auth
// to record, so set SCREENCI_APP_STORAGE_STATE (see screenci.config.ts). The
// navigation mirrors editor.screenci.ts.
//
// The logo intro (assets/logo.png) is gitignored: it is uploaded on the first
// record and reused on later runs (CI included).
video
  .overlays({
    logo: { path: './assets/logo.png', fill: 'recording', duration: 2000 },
  })
  .narration({
    en: {
      intro: 'One script records a separate version for each language.',
      editor: 'Manage the language set from the web editor.',
      add: 'Adding a language fills in its narration, then renders from the same capture.',
      outro: 'No translation drift: every language covers the same cues.',
    },
  })('Languages walkthrough', async ({ page, narration, overlays }) => {
  // The Editor requires auth (SCREENCI_APP_STORAGE_STATE, see screenci.config.ts).
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

  await overlays.logo.for(2000)
  await narration.intro()

  // Frame the Editor Languages section while explaining web-managed languages.
  await narration.editor.start()
  const languagesHeading = page
    .getByRole('heading', { name: /languages/i })
    .first()
  if (await languagesHeading.isVisible().catch(() => false)) {
    await zoomTo(languagesHeading)
    await page.waitForTimeout(900)
    await resetZoom()
  }
  await narration.editor.end()

  await narration.add()
  await narration.outro()
})
