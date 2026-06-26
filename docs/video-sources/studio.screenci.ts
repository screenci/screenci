import { hide, resetZoom, video, voices, zoomTo } from 'screenci'

video.use({
  renderOptions: {
    narration: {
      voice: { name: voices.Sophie, style: 'Friendly product guide' },
    },
  },
})

const appUrl = process.env.SCREENCI_APP_URL ?? 'https://app.screenci.com/'

// Studio walkthrough recorded against the ScreenCI app (app.screenci.com), for
// the "Remix in Studio on the web" tile on the landing page. Studio lives behind
// auth, so recording this needs a logged-in session: set SCREENCI_APP_STORAGE_STATE
// to a Playwright storageState JSON (see screenci.config.ts). The walkthrough is
// self-contained: it opens the first project and video, then enters Studio.
video.narration({
  en: {
    intro: 'Open any finished video in Studio to edit it right in the browser.',
    edit: 'Review render options in the Studio panel, then render a new version. No code, no re-recording.',
  },
  es: {
    intro:
      'Abre cualquier video terminado en Studio para editarlo directamente en el navegador.',
    edit: 'Revisa las opciones de render en el panel de Studio y genera una nueva version. Sin codigo y sin volver a grabar.',
  },
})('Studio web editing', async ({ page, narration }) => {
  // Studio lives behind auth, so this recording only works with a logged-in
  // session (SCREENCI_APP_STORAGE_STATE, see screenci.config.ts). When it is not
  // configured (e.g. CI without the session secret), skip instead of timing out
  // on the login page.
  video.skip(
    !process.env.SCREENCI_APP_STORAGE_STATE,
    'Requires SCREENCI_APP_STORAGE_STATE (a logged-in app session).'
  )

  // Navigate from the dashboard into Studio without showing it in the recording.
  await hide(async () => {
    await page.goto(appUrl)
    await page.waitForLoadState('networkidle')

    await page
      .getByRole('heading', { name: 'Projects' })
      .waitFor({ timeout: 30000 })
    await page.getByTestId('projects-list').getByRole('link').first().click()

    // Open the first video, then its first language page where Studio is shown
    // inline below the preview.
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

  await narration.intro()

  // Show the Studio panel without depending on a specific video having editable
  // narration cues in the seeded dev data.
  await narration.edit.start()
  await zoomTo(page.getByRole('heading', { name: /^studio$/i }))
  await page.waitForTimeout(900)
  await resetZoom()
  await narration.edit.end()

  const createOneOffButton = page.getByRole('button', {
    name: 'Create one-off version',
  })
  if (await createOneOffButton.isVisible().catch(() => false)) {
    // Highlight the render entry point without clicking it.
    await zoomTo(createOneOffButton)
    await page.waitForTimeout(900)
    await resetZoom()
  }
})
