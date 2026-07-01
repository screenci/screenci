import pc from 'picocolors'

export const logger = {
  info: (...args: unknown[]) => {
    console.log(...args)
  },
  warn: (...args: unknown[]) => {
    console.warn(pc.yellow('WARNING'), ...args)
  },
  /**
   * Informational message printed in cyan. Use for non-error notices surfaced
   * to the author (for example, backend `notices` shown at record time).
   */
  notice: (message: string) => {
    console.log(pc.cyan(message))
  },
  error: (...args: unknown[]) => {
    console.error(...args)
  },
}

export default logger
