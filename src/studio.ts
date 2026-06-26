/**
 * The studio option groups deferred to the ScreenCI web app at render/record
 * time. Set per recording from the `renderOptions`/`recordOptions` `'studio'`
 * sentinel; read by the recorder to stamp `metadata.studio`.
 */
export type StudioOptionFlags = {
  renderOptions: boolean
  recordOptions: boolean
}
