/**
 * The studio axes deferred to the ScreenCI web app, read by the recorder to
 * stamp `metadata.studio`. `renderOptions`/`recordOptions` come from the
 * matching `'studio'` sentinel; `languages` is set when the recording's
 * language set is web-owned (`video.languages('studio')`).
 */
export type StudioOptionFlags = {
  renderOptions: boolean
  recordOptions: boolean
  /** Whether the language set is owned by the web app (`video.languages('studio')`). */
  languages?: boolean
}
