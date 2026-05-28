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
  en: {
    intro:
      'This video walks through the two camera styles covered in the Camera and Zooming guide.',
    source:
      'The page includes the complete ScreenCI script used for this walkthrough.',
    focus:
      'The manual zoom section shows when to take exact control over framing instead of following the interaction automatically.',
    next: 'The related reference page for authoring helpers is linked from the end of the guide.',
  },
})

video('Camera and zooming guide', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/docs/guides/camera-and-zooming')
    await page.waitForLoadState('networkidle')
  })

  await narration.intro()
  await narration.source.start()
  await autoZoom(async () => {
    await page.getByText('Show source').first().click()
  })
  await narration.source.end()

  await narration.focus()
  await zoomTo(page.getByRole('heading', { name: 'Manual zoom' }))
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
