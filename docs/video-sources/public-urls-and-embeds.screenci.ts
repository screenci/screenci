import { hide, resetZoom, video, voices, zoomTo } from 'screenci'

video.use({
  renderOptions: {
    narration: {
      voice: { name: voices.Sophie, style: 'Friendly product guide' },
    },
  },
})

const appUrl = process.env.SCREENCI_APP_URL ?? 'https://app.screenci.com/'

// Public URLs walkthrough recorded against the ScreenCI app (app.screenci.com) for
// the Public URLs and Embeds guide. It opens a finished video and highlights the
// Enable public URL switch that mints stable, language-specific delivery URLs.
// Recording needs a logged-in session: set SCREENCI_APP_STORAGE_STATE (see
// screenci.config.ts). The navigation mirrors studio.screenci.ts up to the video
// page.
//
// The logo intro (assets/logo.png) is gitignored: it is uploaded on the first
// record and reused on later runs (CI included).
video
  .overlays({
    logo: { path: './assets/logo.png', fill: 'recording', duration: '2s' },
  })
  .narration({
    en: {
      intro: 'Public URLs give a finished video a stable delivery surface.',
      enable: 'Turn on Enable public URL to mint a route for each language.',
      auto: 'Auto-select keeps every language on its latest finished render.',
      outro: 'Embed the URL in docs, changelogs, or release pages.',
    },
  })('Public URLs and embeds', async ({ page, narration, overlays }) => {
  // The public-delivery switch lives behind auth (SCREENCI_APP_STORAGE_STATE).
  if (!process.env.SCREENCI_APP_STORAGE_STATE) {
    throw new Error(
      'Not logged in. Record via `scripts/screenci.sh docs <env> record` (it signs in first), or set SCREENCI_APP_STORAGE_STATE to a Playwright storageState.'
    )
  }

  // Open a finished video page without showing the navigation.
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
  })

  await overlays.logo.for('2s')
  await narration.intro()

  // Frame the public-delivery control, identified by its label text.
  await narration.enable.start()
  const enableControl = page.getByText(/enable public url/i).first()
  if (await enableControl.isVisible().catch(() => false)) {
    await zoomTo(enableControl)
    await page.waitForTimeout(900)
    await resetZoom()
  }
  await narration.enable.end()

  await narration.auto()
  await narration.outro()
})
