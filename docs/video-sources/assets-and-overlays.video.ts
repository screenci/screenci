import {
  autoZoom,
  createAssets,
  createNarration,
  hide,
  resetZoom,
  video,
  voices,
  zoomTo,
} from 'screenci'

const assets = createAssets({
  intro: { path: './assets/intro.mp4', audio: 0, fullScreen: true },
})

const narration = createNarration({
  voice: { name: voices.Sophie, style: 'Clear, structured docs walkthrough' },
  languages: {
    en: {
      cues: {
        intro:
          'This guide explains how to place intro clips and overlays directly on the ScreenCI timeline.',
        example:
          'The define assets section shows the same createAssets pattern used to insert the intro clip at the start of this video.',
        focus:
          'The full screen versus overlay section is where the guide explains when a clip should replace the frame and when it should sit on top of the recording.',
        next: 'The API overview linked at the end summarizes the exported createAssets helper.',
      },
    },
  },
})

video('Assets and overlays guide', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/docs/guides/assets-and-overlays')
    await page.waitForLoadState('networkidle')
  })

  await assets.intro()

  await narration.intro()
  await narration.example()
  await zoomTo(page.getByRole('heading', { name: 'Define assets' }))
  await page.waitForTimeout(700)
  await resetZoom()

  await narration.focus()
  await zoomTo(page.getByRole('heading', { name: 'Full-screen vs overlay' }))
  await page.waitForTimeout(700)
  await resetZoom()

  await narration.next()
  await autoZoom(async () => {
    await page
      .locator('.sl-markdown-content')
      .getByRole('link', { name: 'Video Authoring API Overview', exact: true })
      .first()
      .click()
  })

  await page.waitForLoadState('networkidle')
})
