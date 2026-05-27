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
          'This video introduces the CLI reference and the most common ScreenCI commands.',
        source:
          'The page includes the ScreenCI source used to walk through the reference.',
        focus:
          'One of the key command sections covers screenci test and the normal local iteration loop.',
        next: 'When the guide is done, it links back to the Record and Publish workflow.',
      },
    },
  },
})

video('CLI reference walkthrough', async ({ page }) => {
  await hide(async () => {
    await page.goto('/docs/reference/cli')
    await page.waitForLoadState('networkidle')
  })

  await narration.intro()
  await narration.source.start()
  await autoZoom(async () => {
    await page.getByText('Show source').first().click()
  })
  await narration.source.end()

  await narration.focus()
  await zoomTo(
    page.getByRole('heading', { name: /screenci test \[playwrightArgs/ })
  )
  await page.waitForTimeout(700)
  await resetZoom()

  await narration.next()
  await autoZoom(async () => {
    await page
      .locator('.sl-markdown-content')
      .getByRole('link', { name: 'Record and Publish', exact: true })
      .first()
      .click()
  })

  await page.waitForLoadState('networkidle')
})
