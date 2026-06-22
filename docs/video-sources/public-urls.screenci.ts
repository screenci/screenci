import { autoZoom, hide, resetZoom, video, voices } from 'screenci'

video.use({
  renderOptions: {
    narration: {
      voice: { name: voices.Sophie, style: 'Calm product guide' },
    },
  },
})

// Source of record for the "Public URLs and embeds" docs video. It walks the
// public-delivery explainer page: the stable base URL, the per-language
// outputs, and a live embed that switches languages. Recorded against the
// deployed demo so it runs without app authentication.
video.localize({
  narration: {
    en: {
      intro:
        'Turn on public delivery and your video gets a stable URL on the CDN.',
      langs: 'Each language has its own video, thumbnail, and subtitle URL.',
      embed:
        'Drop it into any site. It always resolves to the latest approved render.',
    },
  },
})('Public URLs and embeds', async ({ page, narration }) => {
  await hide(async () => {
    await page.goto('https://demo.screenci.com/pitch/embed.html')
    await page.waitForLoadState('networkidle')
  })

  await narration.intro()
  await narration.langs.start()
  await autoZoom(async () => {
    await page.locator('.urls').scrollIntoViewIfNeeded()
  })
  await narration.langs.end()
  await resetZoom()

  await narration.embed.start()
  await autoZoom(async () => {
    await page.getByRole('button', { name: 'ES' }).click()
    await page.getByRole('button', { name: 'EN' }).click()
  })
  await narration.embed.end()
  await resetZoom()
})
