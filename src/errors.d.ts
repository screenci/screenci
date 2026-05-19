export declare class ScreenciError extends Error {
  constructor(message: string)
}
export declare function invalidOptionError(params: {
  api: string
  option: string
  expectation: string
  value: unknown
}): ScreenciError
