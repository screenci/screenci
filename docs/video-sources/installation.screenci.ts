import { autoZoom, hide, video } from 'screenci'

video
  .overlays({
    logo: { path: './assets/logo.png', duration: 2000, overMouse: true },
  })
  .narration({
    docs: 'Here is where to find ScreenCI [pronounce: screen see eye] docs.',
  })('How to find docs', async ({ page, narration, overlays }) => {
  // Run setup without showing these actions in the final recording.
  await hide(async () => {
    await page.setContent(landingPageHtml())
  })

  // Open with a brief brand intro card before the walkthrough begins.
  await overlays.logo.for(2000)

  // Play the narration line for this step.
  await narration.docs()

  // Automatically zoom into interactions so they are easier to follow.
  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })
})

function landingPageHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>ScreenCI smoke page</title>
    <style>
      body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #111827; color: white; }
      main { min-height: 100vh; display: grid; place-items: center; text-align: center; }
      a { color: #111827; background: #fbbf24; padding: 14px 18px; border-radius: 8px; text-decoration: none; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <div>
        <h1>ScreenCI</h1>
        <p>Record docs, onboarding, and changelog walkthroughs from code.</p>
        <a href="https://screenci.com/docs">View Documentation</a>
      </div>
    </main>
  </body>
</html>`
}
