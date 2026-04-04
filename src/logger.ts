import pc from 'picocolors'

export const logger = {
  info: (...args: unknown[]) => {
    console.log(...args)
  },
  warn: (...args: unknown[]) => {
    console.warn(pc.yellow('WARNING'), ...args)
  },
  error: (...args: unknown[]) => {
    console.error(...args)
  },
}

export default logger
