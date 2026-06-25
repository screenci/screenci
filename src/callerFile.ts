import { fileURLToPath } from 'url'

/** Normalize a V8 call-site filename (which may be a `file://` URL) to a path. */
function callSiteFile(frame: NodeJS.CallSite): string | null {
  const fileName = frame.getFileName()
  if (!fileName) return null
  return fileName.startsWith('file://') ? fileURLToPath(fileName) : fileName
}

/**
 * Capture the absolute path of the first stack frame outside {@link moduleUrl}
 * (the calling module's own `import.meta.url`). Used by `createOverlays` /
 * `createAudio` to attribute each registered asset to the user's `.screenci`
 * script, so up-front validation only checks the assets that script declared
 * (assets from other test files loaded in the same worker are skipped).
 *
 * Returns `null` when no outside frame is found, in which case the registration
 * is left unattributed and validated against every recording.
 */
export function captureCallerFile(moduleUrl: string): string | null {
  // Skip frames belonging to this helper and to the module that called it (the
  // SDK module doing the registration), so the first remaining frame is the
  // user's `.screenci` script.
  const selfPath = fileURLToPath(import.meta.url)
  const callerModulePath = fileURLToPath(moduleUrl)
  const originalPrepare = Error.prepareStackTrace
  const originalLimit = Error.stackTraceLimit
  try {
    Error.stackTraceLimit = 50
    Error.prepareStackTrace = (_error, stack) => stack
    const stack = new Error().stack as unknown as NodeJS.CallSite[]
    if (!Array.isArray(stack)) return null
    for (const frame of stack) {
      const file = callSiteFile(frame)
      if (file !== null && file !== selfPath && file !== callerModulePath) {
        return file
      }
    }
    return null
  } finally {
    Error.prepareStackTrace = originalPrepare
    Error.stackTraceLimit = originalLimit
  }
}
