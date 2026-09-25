/**
 * 0.1.7-rc.2 stopped exporting `SettingsScope` from
 * `@deepseek-ai/dsh-client-ui-settings/client`; the structural face the
 * selector consumes lives here instead (getSnapshot shape mirrors the 0.1.7
 * `ConfigFormSnapshot` minus the parts the components never read).
 */
/** The projected snapshot shape (identity-stable between changes — React #185). */
export interface ScopeSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  revision: number | undefined
  writable: boolean
  base: unknown
  user: unknown
  mode: 'host' | 'memory'
}

export interface SettingsScope<T> {
  getSnapshot(): ScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
  mutate?(ops: readonly { path: readonly string[]; op: string; value?: unknown }[]): Promise<boolean>
}
