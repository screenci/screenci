import { invalidOptionError, ScreenciError } from './errors.js'
import type {
  BackgroundUpdateEvent,
  IEventRecorder,
  NarrationUpdateEvent,
  UpdateTransition,
} from './events.js'
import { getActiveHideRecorder } from './timelineBlock.js'
import { getScreenCIRuntimeContext } from './runtimeContext.js'
import { assetCandidatePaths, hashAssetFile } from './assetHash.js'
import type { Easing, NarrationCorner } from './types.js'
import { EASING_NAMES } from './types.js'

/**
 * Animation options shared by every mid-video overlay update. Omit `duration`
 * (or pass 0) for an instant change.
 */
export type OverlayTransitionOptions = {
  /** Animation length in milliseconds. */
  duration?: number
  /** Defaults to `'ease-in-out'`. */
  easing?: Easing
}

export type MoveNarrationOptions = OverlayTransitionOptions & {
  /**
   * Per-axis inset from the anchor corner as a fraction of the shorter output
   * side. Overrides the global `renderOptions.narration.padding` for the set
   * axis from this point on; an omitted axis keeps its current effective
   * value. Range [-1, 1]; negative pushes the tile past the edge.
   */
  padding?: { x?: number; y?: number }
  /**
   * Tile size as a fraction of the shorter output side, (0, 1]. Set together
   * with the move to animate both in one synchronized transition.
   */
  size?: number
}

export type SetBackgroundInput =
  | { assetPath: string }
  | { backgroundCss: string }

const NARRATION_CORNERS: readonly NarrationCorner[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]

function assertFiniteInRange(
  api: string,
  option: string,
  value: number,
  min: number,
  max: number,
  expectation: string
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw invalidOptionError({ api, option, expectation, value })
  }
}

/** Validates and normalizes transition options. Returns undefined for instant. */
export function validateTransition(
  api: string,
  options: OverlayTransitionOptions | undefined
): UpdateTransition | undefined {
  if (options?.duration === undefined) {
    if (options?.easing !== undefined) {
      throw invalidOptionError({
        api,
        option: 'easing',
        expectation: 'easing requires duration to be set',
        value: options.easing,
      })
    }
    return undefined
  }
  const { duration } = options
  if (!Number.isInteger(duration) || duration < 0) {
    throw invalidOptionError({
      api,
      option: 'duration',
      expectation: 'an integer >= 0 (milliseconds)',
      value: duration,
    })
  }
  const easing = options.easing ?? 'ease-in-out'
  if (!EASING_NAMES.includes(easing)) {
    throw invalidOptionError({
      api,
      option: 'easing',
      expectation: `one of ${EASING_NAMES.join(', ')}`,
      value: easing,
    })
  }
  if (duration === 0) return undefined
  return { durationMs: duration, easing }
}

/** Validates a narration corner name (exhaustive against {@link NarrationCorner}). */
export function validateCorner(api: string, corner: NarrationCorner): void {
  switch (corner) {
    case 'top-left':
    case 'top-right':
    case 'bottom-left':
    case 'bottom-right':
      return
    default: {
      const _: never = corner
      throw invalidOptionError({
        api,
        option: 'corner',
        expectation: `one of ${NARRATION_CORNERS.join(', ')}`,
        value: _,
      })
    }
  }
}

/** Validates the payload of a `moveNarration()` call. */
export function validateMoveNarration(
  corner: NarrationCorner,
  options: MoveNarrationOptions | undefined
): Omit<NarrationUpdateEvent, 'type' | 'timeMs'> {
  const api = 'moveNarration'
  validateCorner(api, corner)
  if (options?.padding !== undefined) {
    const { x, y } = options.padding
    if (x === undefined && y === undefined) {
      throw invalidOptionError({
        api,
        option: 'padding',
        expectation: 'at least one of padding.x / padding.y',
        value: options.padding,
      })
    }
    if (x !== undefined)
      assertFiniteInRange(api, 'padding.x', x, -1, 1, 'a number in [-1, 1]')
    if (y !== undefined)
      assertFiniteInRange(api, 'padding.y', y, -1, 1, 'a number in [-1, 1]')
  }
  if (options?.size !== undefined) {
    validateNarrationSize(api, options.size)
  }
  const transition = validateTransition(api, options)
  return {
    corner,
    ...(options?.padding !== undefined && { padding: options.padding }),
    ...(options?.size !== undefined && { size: options.size }),
    ...(transition !== undefined && { transition }),
  }
}

/** Validates a narration tile size, (0, 1]. */
export function validateNarrationSize(api: string, size: number): void {
  if (!Number.isFinite(size) || size <= 0 || size > 1) {
    throw invalidOptionError({
      api,
      option: 'size',
      expectation: 'a number in (0, 1]',
      value: size,
    })
  }
}

/** Validates a recording size, [0, 1]. */
export function validateRecordingSize(api: string, size: number): void {
  if (!Number.isFinite(size) || size < 0 || size > 1) {
    throw invalidOptionError({
      api,
      option: 'size',
      expectation: 'a number in [0, 1]',
      value: size,
    })
  }
}

/** Validates the payload of a `setBackground()` call (path resolution excluded). */
export function validateSetBackground(
  background: SetBackgroundInput
): SetBackgroundInput {
  const api = 'setBackground'
  if ('backgroundCss' in background) {
    if (
      typeof background.backgroundCss !== 'string' ||
      background.backgroundCss.trim() === ''
    ) {
      throw invalidOptionError({
        api,
        option: 'backgroundCss',
        expectation: 'a non-empty CSS background string',
        value: background.backgroundCss,
      })
    }
    return { backgroundCss: background.backgroundCss }
  }
  if (typeof background.assetPath !== 'string' || background.assetPath === '') {
    throw invalidOptionError({
      api,
      option: 'assetPath',
      expectation: 'a non-empty file path',
      value: background.assetPath,
    })
  }
  return { assetPath: background.assetPath }
}

/**
 * Moves the narration (camera PIP) overlay to another corner, optionally with
 * per-axis padding and a new size, animated when a `duration` is given.
 *
 * @example
 * ```ts
 * await moveNarration('top-left', {
 *   padding: { x: 0.02, y: 0.06 },
 *   size: 0.2,
 *   duration: 600,
 *   easing: 'ease-in-out',
 * })
 * ```
 */
export async function moveNarration(
  corner: NarrationCorner,
  options?: MoveNarrationOptions,
  recorder: IEventRecorder = getActiveHideRecorder()
): Promise<void> {
  recorder.addNarrationUpdate(validateMoveNarration(corner, options))
}

/**
 * Resizes the narration (camera PIP) overlay mid-video, animated when a
 * `duration` is given. `size` is a fraction of the shorter output side.
 */
export async function resizeNarration(
  size: number,
  options?: OverlayTransitionOptions,
  recorder: IEventRecorder = getActiveHideRecorder()
): Promise<void> {
  validateNarrationSize('resizeNarration', size)
  const transition = validateTransition('resizeNarration', options)
  recorder.addNarrationUpdate({
    size,
    ...(transition !== undefined && { transition }),
  })
}

/**
 * Resizes the recording (browser capture) overlay mid-video, animated when a
 * `duration` is given. `size` uses the same 0-1 fraction as
 * `renderOptions.recording.size`.
 */
export async function resizeRecording(
  size: number,
  options?: OverlayTransitionOptions,
  recorder: IEventRecorder = getActiveHideRecorder()
): Promise<void> {
  validateRecordingSize('resizeRecording', size)
  const transition = validateTransition('resizeRecording', options)
  recorder.addRecordingUpdate({
    size,
    ...(transition !== undefined && { transition }),
  })
}

/**
 * Hides the recording (browser capture) overlay from this point on, with an
 * optional fade. Only the overlay disappears: the background, narration, and
 * the timeline keep running. To cut footage out of the video entirely, use
 * `hide()` instead.
 */
export async function hideRecording(
  options?: OverlayTransitionOptions,
  recorder: IEventRecorder = getActiveHideRecorder()
): Promise<void> {
  const transition = validateTransition('hideRecording', options)
  recorder.addRecordingUpdate({
    visible: false,
    ...(transition !== undefined && { transition }),
  })
}

/**
 * Shows the recording (browser capture) overlay after {@link hideRecording},
 * with an optional fade.
 */
export async function showRecording(
  options?: OverlayTransitionOptions,
  recorder: IEventRecorder = getActiveHideRecorder()
): Promise<void> {
  const transition = validateTransition('showRecording', options)
  recorder.addRecordingUpdate({
    visible: true,
    ...(transition !== undefined && { transition }),
  })
}

/**
 * Changes the video background mid-video. Pass a `duration` for a crossfade
 * to the new background; omit it for an instant cut.
 *
 * @example
 * ```ts
 * await setBackground({ backgroundCss: '#101014' }, { duration: 500 })
 * await setBackground({ assetPath: './assets/space.png' })
 * ```
 */
export async function setBackground(
  background: SetBackgroundInput,
  options?: OverlayTransitionOptions,
  recorder: IEventRecorder = getActiveHideRecorder()
): Promise<void> {
  const validated = validateSetBackground(background)
  const transition = validateTransition('setBackground', options)
  let resolved: BackgroundUpdateEvent['background']
  if ('assetPath' in validated) {
    const testFilePath = getScreenCIRuntimeContext().testFilePath
    const fileHash = await hashAssetFile(
      assetCandidatePaths(validated.assetPath, testFilePath)
    )
    if (fileHash === undefined) {
      throw new ScreenciError(
        `setBackground: background asset not found: ${validated.assetPath}`
      )
    }
    resolved = { assetPath: validated.assetPath, fileHash }
  } else {
    resolved = validated
  }
  recorder.addBackgroundUpdate({
    background: resolved,
    ...(transition !== undefined && { transition }),
  })
}

/** @internal Shared by narrationVisibility.ts for fade-capable hide/show. */
export function narrationVisibilityUpdate(
  api: 'hideNarration' | 'showNarration',
  visible: boolean,
  options: OverlayTransitionOptions | undefined,
  recorder: IEventRecorder
): void {
  const transition = validateTransition(api, options)
  if (transition === undefined) {
    // Instant hide/show keeps emitting the legacy events so existing renders
    // stay byte-identical.
    if (visible) {
      recorder.addNarrationShow()
    } else {
      recorder.addNarrationHide()
    }
    return
  }
  recorder.addNarrationUpdate({ visible, transition })
}
