import {
  autoZoom,
  createNarration,
  hide,
  resetZoom,
  video,
  voices,
  zoomTo,
} from 'screenci'

const narration = createNarration({
  voice: { name: voices.Sophie },
  languages: {
    en: {
      intro:
        'This video shows how the Generating Videos guide covers source based, URL based, and codegen driven starting points.',
      source:
        'The embedded source shows the exact ScreenCI script behind this documentation walkthrough.',
      section:
        'One of the core sections focuses on generating videos directly from source code in the same repository.',
      next: 'From here, the next step is learning how to run and debug the draft locally.',
    },
  },
})

video('Generating videos guide', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/docs/generating-videos')
    await page.waitForLoadState('networkidle')
  })

  await narration.intro()
  await narration.source.start()
  await autoZoom(async () => {
    await page.getByText('Show source').first().click()
  })
  await narration.source.end()

  await narration.section()
  await zoomTo(
    page.getByRole('heading', { name: 'AI generation based on source code' })
  )
  await page.waitForTimeout(700)
  await resetZoom()

  await narration.next()
  await autoZoom(async () => {
    await page
      .locator('.sl-markdown-content')
      .getByRole('link', { name: 'Run and Debug Videos', exact: true })
      .first()
      .click()
  })

  await page.waitForLoadState('networkidle')
})
