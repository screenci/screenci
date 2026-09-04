import { describe, it, expect } from 'vitest'
import {
  LOGIN_BANNER_BINDING,
  LOGIN_BANNER_HOST_ID,
  LOGIN_BANNER_POSITION_KEY,
  loginBannerCopy,
  loginBannerScript,
} from './loginBanner.js'

describe('loginBannerCopy', () => {
  it('names the host, which fits the narrow card', () => {
    // The full origin would wrap or overflow a 250px card on a long domain.
    expect(loginBannerCopy('https://app.example.com').body).toContain(
      'app.example.com'
    )
    expect(loginBannerCopy('https://app.example.com').body).not.toContain(
      'https://'
    )
  })

  it('keeps a port, which distinguishes one local app from another', () => {
    expect(loginBannerCopy('http://localhost:3000').body).toContain(
      'localhost:3000'
    )
  })

  it('stays generic when the origin is unknown', () => {
    expect(loginBannerCopy(null).body).toBe(
      'Sign in as you normally would, then click below.'
    )
  })
})

describe('loginBannerScript', () => {
  it('wires the button to the exposed binding under a stable host id', () => {
    const script = loginBannerScript(loginBannerCopy(null), null)
    expect(script).toContain(JSON.stringify(LOGIN_BANNER_BINDING))
    expect(script).toContain(JSON.stringify(LOGIN_BANNER_HOST_ID))
    expect(script).toContain('attachShadow')
  })

  it('injects copy as JSON so a quote or newline in it cannot become code', () => {
    const script = loginBannerScript(
      {
        title: 'ScreenCI',
        body: 'say "hi";\nalert(1)',
        button: 'ok',
        busy: 'busy',
      },
      null
    )
    // The payload survives only inside the JSON string literal: the quotes and
    // the newline are escaped, so nothing of it is ever parsed as code.
    expect(script).toContain('say \\"hi\\";\\nalert(1)')
    expect(script).not.toContain('\nalert(1)')
  })

  it('sets copy as text, never as markup', () => {
    const script = loginBannerScript(loginBannerCopy(null), null)
    expect(script).toContain('.textContent = config.copy.title')
    expect(script).toContain('.textContent = config.copy.body')
  })

  it('paints only on the product, never over an identity provider', () => {
    const script = loginBannerScript(
      loginBannerCopy('https://app.example.com'),
      'https://app.example.com'
    )
    expect(script).toContain('"origin":"https://app.example.com"')
    expect(script).toContain(
      'if (config.origin !== null && location.origin !== config.origin) return;'
    )
  })

  it('paints everywhere when no target origin is known', () => {
    expect(loginBannerScript(loginBannerCopy(null), null)).toContain(
      '"origin":null'
    )
  })

  it('floats in the top left corner rather than spanning the top', () => {
    const script = loginBannerScript(loginBannerCopy(null), null)
    // A full-width bar across the top sits exactly where products put their
    // own sign-in and account controls, and covered the button the person had
    // to press. The left corner is the quieter one.
    expect(script).toContain('width:250px')
    expect(script).not.toContain('right:0')
    expect(script).toContain('const defaultX = config.margin;')
  })

  it('is draggable, but never by its button', () => {
    const script = loginBannerScript(loginBannerCopy(null), null)
    expect(script).toContain("card.addEventListener('pointerdown'")
    expect(script).toContain("event.target.closest('button')")
    expect(script).toContain('cursor:grab')
  })

  it('clamps to the viewport so it can never be dragged out of reach', () => {
    const script = loginBannerScript(loginBannerCopy(null), null)
    expect(script).toContain('window.innerWidth - rect.width - config.margin')
    expect(script).toContain("window.addEventListener('resize'")
  })

  it('remembers the position in sessionStorage, which the session never captures', () => {
    const script = loginBannerScript(loginBannerCopy(null), null)
    expect(script).toContain(JSON.stringify(LOGIN_BANNER_POSITION_KEY))
    expect(script).toContain('sessionStorage.setItem')
    // localStorage IS captured by storageState: writing there would put a
    // ScreenCI key inside the saved session.
    expect(script).not.toContain('localStorage')
  })

  it('reinstalls itself when a single-page app wipes or replaces the body', () => {
    const script = loginBannerScript(loginBannerCopy(null), null)
    expect(script).toContain('new MutationObserver(install)')
    // From the root element, so a replaced <body> is caught too.
    expect(script).toContain('observe(document.documentElement')
  })
})
