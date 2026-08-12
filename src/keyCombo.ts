/**
 * Parsing of Playwright key combo strings (e.g. `'Shift+A'`,
 * `'ControlOrMeta+K'`) into normalized key parts for keyboard shortcut
 * overlays.
 */

/** Modifier key names accepted by Playwright combos. */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta'])

/**
 * Splits a Playwright key combo into its parts. A `+` acts as a separator
 * between parts; an empty segment means the literal `+` key (e.g.
 * `'Control++'` is Control plus the plus key, and `'+'` alone is the plus
 * key).
 */
function splitCombo(key: string): string[] {
  if (key === '') return []
  const segments = key.split('+')
  const parts: string[] = []
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    if (segment !== '') {
      parts.push(segment)
    } else if (i === segments.length - 1 || segments[i + 1] === '') {
      // A trailing empty segment (or one followed by another empty segment)
      // came from a literal '+' key, e.g. 'Control++' or '+'.
      parts.push('+')
      i++
    }
  }
  return parts
}

/**
 * Parses a Playwright key combo string into normalized key parts.
 *
 * `ControlOrMeta` is resolved using `platform` (a `process.platform` value):
 * `Meta` on `darwin`, `Control` elsewhere, so the renderer never has to guess
 * which key was actually pressed.
 */
export function parseKeyCombo(key: string, platform: string): string[] {
  return splitCombo(key).map((part) =>
    part === 'ControlOrMeta'
      ? platform === 'darwin'
        ? 'Meta'
        : 'Control'
      : part
  )
}

/** True when the combo is a single key with no modifier (e.g. `['A']`). */
export function isSingleKeyCombo(keys: string[]): boolean {
  return keys.length === 1 && !MODIFIERS.has(keys[0]!)
}
