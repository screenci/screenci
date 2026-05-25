import type { CustomVoiceRef } from './voices.js'

export function isCustomVoiceRef(value: unknown): value is CustomVoiceRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof (value as Record<string, unknown>).path === 'string'
  )
}
