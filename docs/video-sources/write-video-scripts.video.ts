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
        'This video introduces the Write Video Scripts guide and its first working example.',
      source:
        'The page includes the full ScreenCI source so you can inspect the script while reading the guide.',
      pacing:
        'Further down, the pacing section explains how to balance waits, narration, and visible timing.',
      next: 'The guide then points you to running and debugging videos locally.',
    },
  },
})

video('Write video scripts guide', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/docs/write-video-scripts')
    await page.waitForLoadState('networkidle')
  })

  await narration.intro()
  await narration.source.start()
  await autoZoom(async () => {
    await page.getByText('Show source').first().click()
  })
  await narration.source.end()

  await narration.pacing()
  await zoomTo(page.getByRole('heading', { name: 'Control pacing' }))
  await page.waitForTimeout(700)
  await resetZoom()

  await narration.next()
  await autoZoom(async () => {
    await page
      .getByRole('link', { name: 'Run and debug videos', exact: true })
      .first()
      .click()
  })

  await page.waitForLoadState('networkidle')
})
