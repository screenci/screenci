import { hide, modelTypes, video, voices } from 'screenci'

// Each cue carries its own style prompt, so the same voice adapts its delivery
// per line without any audio editing. Write the direction in plain English,
// however far out you want to go: the expressive model takes styles from a
// straight product guide all the way to a swashbuckling pirate. The style prompt
// for each line is overlaid on screen as a text card (one named overlay per
// style, so each renders its own asset).
function styleCard(text: string) {
  return {
    html:
      '<div class="ss-card">' +
      '<span class="ss-kicker">Speaking style</span>' +
      `<span class="ss-text">${text}</span>` +
      '</div>',
    css: `
      .ss-card {
        display: inline-flex;
        flex-direction: column;
        gap: 6px;
        box-sizing: border-box;
        padding: 18px 28px;
        border-radius: 18px;
        font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
        color: #ffffff;
        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 55%, #ec4899 100%);
        border: 1px solid rgba(255, 255, 255, 0.28);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
      }
      .ss-kicker {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        opacity: 0.85;
      }
      .ss-text { font-size: 30px; font-weight: 700; letter-spacing: -0.01em; }
    `,
    x: 96,
    y: 880,
    width: 1000,
  }
}

video
  .overlays({
    sHook: styleCard('Warm and intriguing'),
    sPirate: styleCard('🏴‍☠️ Boisterous pirate captain'),
    sSports: styleCard('🎙️ Breathless sportscaster'),
    sWhisper: styleCard('🤫 Hushed, conspiratorial whisper'),
    sOutro: styleCard('Confident and conclusive'),
  })
  .narration({
    en: {
      hook: {
        cue: 'Every narration line can have its own speaking style.',
        voice: {
          name: voices.Nora,
          modelType: modelTypes.expressive,
          style: 'Warm and intriguing, drawing the viewer in.',
        },
      },
      pirate: {
        cue: 'Arr! Even a swashbuckling pirate can guide the tour, if that be the style ye prompt.',
        voice: {
          name: voices.Nora,
          modelType: modelTypes.expressive,
          style:
            'A boisterous pirate captain, gravelly and full of swagger, rolling every R.',
        },
      },
      sportscaster: {
        cue: 'And the feature ships, the crowd goes wild, what a release this has been!',
        voice: {
          name: voices.Nora,
          modelType: modelTypes.expressive,
          style:
            'A breathless sportscaster calling a last-second play-by-play.',
        },
      },
      whisper: {
        cue: 'Or lean right in, because the best part is a little secret.',
        voice: {
          name: voices.Nora,
          modelType: modelTypes.expressive,
          style: 'A hushed, conspiratorial whisper, close to the mic.',
        },
      },
      outro: {
        cue: 'Write the style in plain English. The voice does the rest.',
        voice: {
          name: voices.Nora,
          modelType: modelTypes.expressive,
          style: 'Confident and conclusive, landing the final thought.',
        },
      },
    },
  })('Per-cue speaking style', async ({ page, narration, overlays }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/docs/guides/narration', {
      waitUntil: 'domcontentloaded',
    })
    await page.getByRole('heading').first().waitFor()
  })

  // Hold each cue's style card up while that line is spoken.
  async function line(
    card: { start: () => Promise<void>; end: () => Promise<void> },
    cue: () => Promise<void>
  ) {
    await card.start()
    await cue()
    await card.end()
  }

  await line(overlays.sHook, narration.hook)
  await line(overlays.sPirate, narration.pirate)

  await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }))
  await page.waitForTimeout(1200)

  await line(overlays.sSports, narration.sportscaster)
  await line(overlays.sWhisper, narration.whisper)
  await line(overlays.sOutro, narration.outro)
})
