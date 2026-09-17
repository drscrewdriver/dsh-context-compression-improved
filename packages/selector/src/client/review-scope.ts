/**
 * The minimal face of the bound settings scope the review overlay consumes —
 * structural, so tests can stub it without the settings transport.
 */

export interface SettingsScopeLike {
  getSnapshot(): {
    status: string
    value?: {
      presetOptions?: {
        reviewMode?: boolean | undefined
      } | undefined
    } | undefined
  }
  subscribe(listener: () => void): () => void
}
