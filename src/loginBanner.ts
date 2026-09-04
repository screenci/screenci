/**
 * The card `screenci login` floats over the product while the person signs in.
 * It is the browser half of the finish signal: clicking "I'm signed in" calls
 * back into the CLI, which saves the session and closes the browser.
 *
 * It is a small draggable card near the top left, not a full-width bar: a bar
 * across the top covers exactly where products put their own sign-in and
 * account controls, so it blocked the button the person had to press. The left
 * corner is the quieter one, since those controls sit on the right far more
 * often than the left. It can be dragged anywhere if it still lands somewhere
 * awkward.
 *
 * It exists only during `screenci login`, never during a recording, so it can
 * never end up in a video. It lives in a shadow root under a fixed host so the
 * product's own CSS cannot restyle it and it cannot restyle the product.
 *
 * It shows only on the product's own origin, and only in the top-level
 * document. A sign-in that hops to an identity provider (a company SSO page,
 * an OAuth consent screen) must not get ScreenCI chrome drawn over it: that is
 * someone else's login form, and an overlay on it would read as phishing. The
 * card comes back when the person lands back on the product.
 */

/** The page-side function name `context.exposeBinding` installs. */
export const LOGIN_BANNER_BINDING = '__screenciLoginDone'

/** The host element id, also used to avoid installing the card twice. */
export const LOGIN_BANNER_HOST_ID = 'screenci-login-banner'

/**
 * Where the dragged position is remembered, so a multi-page sign-in does not
 * drop the card back over the form on every navigation.
 *
 * `sessionStorage` on purpose: Playwright's `storageState()` captures cookies
 * and localStorage, never sessionStorage, so this key cannot end up inside the
 * saved session. It is gone when the browser closes either way.
 */
export const LOGIN_BANNER_POSITION_KEY = 'screenci:login-card-position'

/** Keeps the card clear of the viewport edges, and of most sticky headers. */
export const LOGIN_BANNER_MARGIN_PX = 16

export type LoginBannerCopy = {
  title: string
  body: string
  button: string
  busy: string
  /** Tooltip on the card itself, since the drag affordance is cursor-only. */
  dragHint: string
}

/** The host of an origin, which fits the narrow card; the origin may not. */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

export function loginBannerCopy(origin: string | null): LoginBannerCopy {
  return {
    title: 'ScreenCI',
    body:
      origin === null
        ? 'Sign in as you normally would, then click below.'
        : `Sign in to ${hostOf(origin)} as you normally would, then click below.`,
    button: "I'm signed in",
    busy: 'Saving the session...',
    dragHint: 'Drag to move',
  }
}

/**
 * Build the init script. Everything variable is injected as JSON so page copy
 * can never break out of the string and become code.
 */
export function loginBannerScript(
  copy: LoginBannerCopy,
  /** Only paint on this origin; null paints everywhere (no target known). */
  origin: string | null
): string {
  const values = JSON.stringify({
    binding: LOGIN_BANNER_BINDING,
    hostId: LOGIN_BANNER_HOST_ID,
    positionKey: LOGIN_BANNER_POSITION_KEY,
    margin: LOGIN_BANNER_MARGIN_PX,
    origin,
    copy,
  })
  return `(() => {
  const config = ${values};

  const readPosition = () => {
    try {
      const raw = sessionStorage.getItem(config.positionKey);
      if (!raw) return null;
      const parts = raw.split(',');
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      return Number.isFinite(x) && Number.isFinite(y) ? { x: x, y: y } : null;
    } catch (err) {
      return null;
    }
  };
  const writePosition = (x, y) => {
    try {
      sessionStorage.setItem(config.positionKey, x + ',' + y);
    } catch (err) {
      // Private mode, or an app that blocks storage. Dragging still works for
      // this page; it just will not be remembered across a navigation.
    }
  };

  const install = () => {
    if (!document.body) return;
    // Top-level document only. A sign-in page routinely embeds third-party
    // frames (a captcha challenge, an OAuth or payment widget); a card at the
    // maximum z-index inside one of those covers the very control the person
    // has to click.
    if (window.top !== window) return;
    // Never overlay an identity provider's own page.
    if (config.origin !== null && location.origin !== config.origin) return;
    if (document.getElementById(config.hostId)) return;

    const host = document.createElement('div');
    host.id = config.hostId;
    host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = [
      '<style>',
      ':host{all:initial}',
      '.card{box-sizing:border-box;width:250px;display:flex;flex-direction:column;gap:8px;',
      'padding:11px 13px 12px;border-radius:10px;color:#fff;background:#18181b;',
      'border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 30px rgba(0,0,0,.45);',
      'cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;',
      'font:400 12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
      '.card.dragging{cursor:grabbing}',
      '.head{display:flex;align-items:center;gap:7px}',
      '.dot{width:6px;height:6px;border-radius:50%;background:#4ade80;flex:none}',
      '.title{font-weight:700;font-size:11px;letter-spacing:.06em;text-transform:uppercase}',
      '.grip{margin-left:auto;width:14px;height:10px;flex:none;opacity:.5;',
      'background-image:radial-gradient(currentColor 1px,transparent 1px);',
      'background-size:5px 5px}',
      '.body{color:#d4d4d8}',
      'button{font:inherit;font-weight:600;font-size:12px;color:#18181b;background:#fafafa;',
      'border:0;border-radius:7px;padding:8px 12px;cursor:pointer;width:100%}',
      'button:hover{background:#fff}',
      'button[disabled]{opacity:.6;cursor:default}',
      '</style>',
      '<div class="card">',
      '<div class="head">',
      '<span class="dot"></span>',
      '<span class="title"></span>',
      '<span class="grip"></span>',
      '</div>',
      '<div class="body"></div>',
      '<button type="button"></button>',
      '</div>',
    ].join('');

    const card = root.querySelector('.card');
    card.title = config.copy.dragHint;
    root.querySelector('.title').textContent = config.copy.title;
    root.querySelector('.body').textContent = config.copy.body;
    const button = root.querySelector('button');
    button.textContent = config.copy.button;
    button.addEventListener('click', () => {
      button.disabled = true;
      button.textContent = config.copy.busy;
      const done = window[config.binding];
      if (typeof done === 'function') done();
    });

    document.body.appendChild(host);

    // One positioning model throughout: explicit left/top in px, clamped to
    // the viewport, so dragging and re-clamping share the same path.
    const place = (x, y) => {
      const rect = host.getBoundingClientRect();
      const maxX = Math.max(0, window.innerWidth - rect.width - config.margin);
      const maxY = Math.max(0, window.innerHeight - rect.height - config.margin);
      const nx = Math.min(Math.max(config.margin, x), maxX);
      const ny = Math.min(Math.max(config.margin, y), maxY);
      host.style.left = nx + 'px';
      host.style.top = ny + 'px';
      return { x: nx, y: ny };
    };

    /**
     * Whether the card would sit on top of something the person can click.
     * Top right is where products put sign-in and account controls, which is
     * the whole reason the old full-width bar was in the way, so the first
     * placement steps down past anything interactive rather than covering it.
     *
     * Rect intersection, not point sampling: a probe grid coarse enough to be
     * cheap walks straight past a button that only occupies one corner of the
     * card. The card's own controls live in a shadow root, so a document query
     * cannot match them.
     */
    const INTERACTIVE = 'a,button,input,select,textarea,[role="button"],[role="link"]';
    const MAX_CANDIDATES = 400;
    const coversSomethingClickable = () => {
      const rect = host.getBoundingClientRect();
      const candidates = document.querySelectorAll(INTERACTIVE);
      const limit = Math.min(candidates.length, MAX_CANDIDATES);
      for (let index = 0; index < limit; index++) {
        const other = candidates[index].getBoundingClientRect();
        if (other.width === 0 || other.height === 0) continue;
        if (other.bottom < 0 || other.top > window.innerHeight) continue;
        if (other.right <= rect.left || other.left >= rect.right) continue;
        if (other.bottom <= rect.top || other.top >= rect.bottom) continue;
        return true;
      }
      return false;
    };

    const startRect = host.getBoundingClientRect();
    const saved = readPosition();
    const defaultX = config.margin;
    const defaultY = config.margin;
    let placed = place(saved ? saved.x : defaultX, saved ? saved.y : defaultY);
    // Once the person moves it, their choice stands: nothing below may
    // second-guess it.
    let personPlaced = saved !== null;

    /**
     * Re-run the placement from the default corner, stepping down past
     * anything clickable. Recomputing from the default each time keeps it
     * deterministic: repeated calls settle on the same spot instead of
     * drifting further down the page.
     *
     * Called again as the page fills in because installing happens at
     * DOMContentLoaded, before a single-page app has rendered its header, so
     * the first probe usually sees an empty document.
     */
    const settle = () => {
      if (personPlaced) return;
      placed = place(defaultX, defaultY);
      for (let attempt = 0; attempt < 3 && coversSomethingClickable(); attempt++) {
        const next = place(placed.x, placed.y + startRect.height + config.margin);
        if (next.y === placed.y) break;
        placed = next;
      }
    };
    settle();
    window.addEventListener('load', settle);
    setTimeout(settle, 600);
    setTimeout(settle, 1600);

    let pointerId = null;
    let grabX = 0;
    let grabY = 0;
    card.addEventListener('pointerdown', (event) => {
      // The button is the one thing that must stay clickable, not draggable.
      if (event.target.closest('button')) return;
      personPlaced = true;
      const rect = host.getBoundingClientRect();
      pointerId = event.pointerId;
      grabX = event.clientX - rect.left;
      grabY = event.clientY - rect.top;
      card.classList.add('dragging');
      try {
        card.setPointerCapture(event.pointerId);
      } catch (err) {
        // Capture is a nicety; the move listener still tracks the pointer.
      }
      event.preventDefault();
    });
    card.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return;
      place(event.clientX - grabX, event.clientY - grabY);
    });
    const endDrag = (event) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      card.classList.remove('dragging');
      try {
        card.releasePointerCapture(event.pointerId);
      } catch (err) {
        // Already released, or never captured.
      }
      const rect = host.getBoundingClientRect();
      writePosition(rect.left, rect.top);
    };
    card.addEventListener('pointerup', endDrag);
    card.addEventListener('pointercancel', endDrag);

    window.addEventListener('resize', () => {
      const rect = host.getBoundingClientRect();
      place(rect.left, rect.top);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }

  // Single-page apps routinely wipe the body, or replace it wholesale, on
  // navigation; put the card back either way. Watching from the root element
  // is what catches a replaced body. It only runs during sign-in, never during
  // a recording, so the breadth costs nothing that matters. The card can only
  // be installed once at a time, so a re-install keeps the dragged position
  // through the remembered one.
  const observe = () => {
    if (!document.documentElement) return;
    new MutationObserver(install).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe, { once: true });
  } else {
    observe();
  }
})();`
}
