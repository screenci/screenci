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
      cues: {
        intro:
          'This video covers the point where local test runs become final ScreenCI recordings.',
        source:
          'The page also exposes the underlying ScreenCI source for this walkthrough.',
        focus:
          'One section explains what gets rendered after a successful recording run.',
        next: 'The next linked page covers the GitHub Actions workflow used for CI recording.',
      },
    },
  },
})

video('Record and publish guide', async ({ page }) => {
  await hide(async () => {
    await page.goto('/docs/record-and-publish')
    await page.waitForLoadState('networkidle')
  })

  await narration.intro()
  await narration.source.start()
  await autoZoom(async () => {
    await page.getByText('Show source').first().click()
  })
  await narration.source.end()

  await narration.focus()
  await zoomTo(page.getByRole('heading', { name: 'What gets rendered' }))
  await page.waitForTimeout(700)
  await resetZoom()

  await narration.next()
  await autoZoom(async () => {
    await page
      .locator('.sl-markdown-content')
      .getByRole('link', { name: 'CI Setup', exact: true })
      .first()
      .click()
  })

  await page.waitForLoadState('networkidle')
})
