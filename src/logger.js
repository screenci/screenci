import pc from 'picocolors'
export const logger = {
  info: (...args) => {
    console.log(...args)
  },
  warn: (...args) => {
    console.warn(pc.yellow('WARNING'), ...args)
  },
  error: (...args) => {
    console.error(...args)
  },
}
export default logger
