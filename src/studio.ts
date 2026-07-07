/**
 * The option axes editable in the ScreenCI web app, read by the recorder to
 * stamp `metadata.studio`. Every recording is web-editable, so
 * `renderOptions`/`recordOptions` are always true; `languages` is set when the
 * recording declares a language set (which the web app may extend).
 */
export type StudioOptionFlags = {
  renderOptions: boolean
  recordOptions: boolean
  /** Whether the language set was declared (the web app may add to it). */
  languages?: boolean
}
