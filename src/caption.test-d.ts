import { describe, it, assertType } from 'vitest'
import { createCaptions } from './caption.js'
import { voices } from './voices.js'
import type { VoiceForLang } from './voices.js'

describe('createCaptions type constraints', () => {
  it('accepts matching keys across all languages', () => {
    createCaptions({
      en: {
        voice: voices.en.Jude,
        captions: { intro: 'Hello', outro: 'Bye' },
      },
      fi: {
        voice: voices.fi.Martti,
        captions: { intro: 'Hei', outro: 'Näkemiin' },
      },
    })
  })

  it('accepts mixed value types (string vs file object) for the same key', () => {
    createCaptions({
      en: {
        voice: voices.en.Jude,
        captions: {
          intro: 'Hello',
          clip: { path: '/clip.mp4', subtitle: 'Watch' },
        },
      },
      fi: {
        voice: voices.fi.Martti,
        captions: { intro: 'Hei', clip: 'Katso' },
      },
    })
  })

  it('rejects a language with a missing caption key', () => {
    createCaptions({
      en: {
        voice: voices.en.Jude,
        captions: { intro: 'Hello', outro: 'Bye' },
      },
      fi: {
        voice: voices.fi.Martti,
        // @ts-expect-error — 'outro' is missing
        captions: { intro: 'Hei' },
      },
    })
  })

  it('rejects a wrong-language voice', () => {
    // @ts-expect-error — fi voice is not assignable to VoiceForLang<'en'>
    assertType<VoiceForLang<'en'>>(voices.fi.Martti)
  })
})
