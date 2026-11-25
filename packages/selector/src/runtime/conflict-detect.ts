/**
 * Cross-plugin conflict detection (F11).
 *
 * Plan: cci-longterm-refactor v0.15.2
 *
 * Detects co-installed plugins at startup. Warns once, does NOT disable.
 * The plugins occupy independent multiplication zones:
 * - CCI: selector-level tool-result trimming (what/how to cut)
 * - live-compact: turn-end small cuts (when to cut, prefix cache)
 * - billion-context: model-driven fold (model decides what to compress)
 * - flash-presets: global threshold + tool schema pruning
 *
 * @module dsh-context-compression-improved/runtime/conflict-detect
 */

export interface PluginPresence {
  readonly name: string
  readonly version: string
}

/** Known compaction-adjacent plugins to detect. */
const WATCH_PLUGINS = [
  'dsh-live-compact',
  'dsh-live-compact-x',
  'billion-context',
  'billion-context-dsh',
  'dsh-flash-presets',
] as const

export interface CoexistenceReport {
  readonly detected: readonly PluginPresence[]
  readonly mode: 'solo' | 'coexist'
  readonly note: string
}

/**
 * Given a list of installed plugins (from ctx.plugin.list() or equivalent),
 * produce a coexistence report. Call once at startup.
 */
export function detectCoexistence(installed: readonly PluginPresence[]): CoexistenceReport {
  const detected = installed.filter(p =>
    (WATCH_PLUGINS as readonly string[]).includes(p.name),
  )
  if (detected.length === 0) {
    return { detected: [], mode: 'solo', note: '' }
  }
  const names = detected.map(p => `${p.name}@${p.version}`).join(', ')
  return {
    detected,
    mode: 'coexist',
    note: `Co-installed: ${names}. CCI handles selector-level trimming; these plugins handle other compaction layers. Independent multiplication zones — no conflict expected.`,
  }
}
