/**
 * Shared key-combo helpers for keyboard shortcut keycap overlays. The
 * recorder normalizes a `page.keyboard.press('Control+Shift+A')` call into
 * key parts (['Ctrl', 'Shift', 'A']); the renderer decides visibility per
 * combo using `renderOptions.shortcuts` (`show` for modifier combos,
 * `showSingle` for single-key presses).
 */

/**
 * Whether a normalized key-part list is a single-key press (e.g. ['A'] or
 * ['Enter']) rather than a modifier combo (e.g. ['Shift', 'A']). A press
 * always ends in exactly one non-modifier key, so a combo is anything with
 * more than one part.
 */
export function isSingleKeyCombo(keys: readonly string[]): boolean {
  return keys.length <= 1
}
