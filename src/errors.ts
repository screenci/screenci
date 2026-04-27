function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export class ScreenciError extends Error {
  constructor(message: string) {
    super(`[screenci] ${message}`)
    this.name = 'ScreenciError'
  }
}

export function invalidOptionError(params: {
  api: string
  option: string
  expectation: string
  value: unknown
}): ScreenciError {
  return new ScreenciError(
    `Invalid ${params.api} option '${params.option}': ${params.expectation}; received ${formatValue(params.value)}.`
  )
}
