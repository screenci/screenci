import {
  autoZoom,
  createNarration,
  hide,
  resetZoom,
  video,
  voices,
  zoomTo,
} from 'screenci'

// Studio walkthrough recorded against the ScreenCI app (app.screenci.com), for
// the "Remix in Studio on the web" tile on the landing page. Studio lives behind
// auth, so recording this needs a logged-in session: set SCREENCI_APP_STORAGE_STATE
// to a Playwright storageState JSON (see screenci.config.ts). The walkthrough is
// self-contained: it opens the first project and video, then enters Studio.
const narration = createNarration({
  voice: { name: voices.Sophie, style: 'Friendly product guide' },
  en: {
    intro: 'Open any finished video in Studio to edit it right in the browser.',
    edit: 'Change narration, add a language, or restyle render options, then render a new version. No code, no re-recording.',
  },
  es: {
    intro:
      'Abre cualquier video terminado en Studio para editarlo directamente en el navegador.',
    edit: 'Cambia la narracion, agrega un idioma o ajusta las opciones de render, y genera una nueva version. Sin codigo y sin volver a grabar.',
  },
})

video('Studio web editing', async ({ page }) => {
  // Navigate from the dashboard into Studio without showing it in the recording.
  await hide(async () => {
    await page.goto('https://app.screenci.com/')
    await page.waitForLoadState('networkidle')

    await page
      .getByRole('heading', { name: 'Projects' })
      .waitFor({ timeout: 30000 })
    await page.getByTestId('projects-list').getByRole('link').first().click()

    // Open the first video in the project, then enter Studio.
    await page.getByRole('link', { name: /video/i }).first().click()
    await page
      .getByRole('heading', { name: /languages/i })
      .waitFor({ timeout: 15000 })
    await page.getByRole('link', { name: /open in studio/i }).click()
    await page
      .getByRole('heading', { name: /^studio$/i })
      .waitFor({ timeout: 30000 })
  })

  await narration.intro()

  // Show adding a language: a visible edit that does not trigger a render.
  await narration.edit.start()
  await autoZoom(async () => {
    const addLanguage = page.getByPlaceholder(/add language/i)
    await addLanguage.scrollIntoViewIfNeeded()
    await addLanguage.click()
    await addLanguage.fill('French')
  })
  await narration.edit.end()

  // Highlight the Render action without clicking it (avoid kicking off a render).
  await zoomTo(page.getByRole('button', { name: /^render( [a-z-]+)?$/i }))
  await page.waitForTimeout(900)
  await resetZoom()
})
