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
      'This video shows how the Public URLs and Embeds guide explains stable published delivery links.',
    source:
      'The source details make it easy to compare the written guide with the authored walkthrough.',
    focus:
      'The embed example is the core section when you want to place a public ScreenCI video into another site.',
    next: 'The page links directly to the endpoint level Public Delivery API reference.',
  },
})

video('Public URLs and embeds guide', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/docs/guides/public-urls-and-embeds')
    await page.waitForLoadState('networkidle')
  })

  await narration.intro()
  await narration.source.start()
  await autoZoom(async () => {
    await page.getByText('Show source').first().click()
  })
  await narration.source.end()

  await narration.focus()
  await zoomTo(page.getByRole('heading', { name: 'Typical embed' }))
  await page.waitForTimeout(700)
  await resetZoom()

  await narration.next()
  await autoZoom(async () => {
    await page
      .locator('.sl-markdown-content')
      .getByRole('link', { name: 'Public Delivery API', exact: true })
      .first()
      .click()
  })

  await page.waitForLoadState('networkidle')
})
