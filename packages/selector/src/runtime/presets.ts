/**
 * Preset tiers (F7) and update-checker (F19) stubs.
 *
 * Plan: cci-longterm-refactor v0.14.4 / v0.14.6
 *
 * @module dsh-context-compression-improved/runtime/presets
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface PresetTier {
  readonly name: string
  readonly description: string
  readonly settings: {
    readonly minNetGain?: number
    readonly autoCompact?: { readonly thresholdPercent: number }
    readonly codeSkeleton?: { readonly enabled: boolean }
    readonly cardMerge?: { readonly enabled: boolean }
    readonly zeroCopy?: boolean
  }
}

export const PRESET_RECOMMENDED: PresetTier = {
  name: 'recommended',
  description: '日常首选：小刀常开、中刀关、骨架开、大刀阈值 70%',
  settings: { minNetGain: 1000, autoCompact: { thresholdPercent: 70 }, codeSkeleton: { enabled: true }, cardMerge: { enabled: false } },
}

export const PRESET_SMALL_KNIFE: PresetTier = {
  name: 'small-knife-first',
  description: '小刀优先：多切少压、连续 4 刀、中刀冷却 10min',
  settings: { minNetGain: 500, autoCompact: { thresholdPercent: 80 }, codeSkeleton: { enabled: true }, cardMerge: { enabled: false } },
}

export const PRESET_BIG_KNIFE: PresetTier = {
  name: 'big-knife-first',
  description: '大刀优先：压住成本、少切快摘要、minNetGain=3000',
  settings: { minNetGain: 3000, autoCompact: { thresholdPercent: 50 }, codeSkeleton: { enabled: true }, cardMerge: { enabled: false } },
}

export const ALL_PRESETS: readonly PresetTier[] = [PRESET_RECOMMENDED, PRESET_SMALL_KNIFE, PRESET_BIG_KNIFE]

/** Preset storage file path. */
function presetsFilePath(): string {
  const dshHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
  return join(dshHome, 'storages', 'dsh-context-compression', 'presets.json')
}

export interface PresetDocument {
  [scope: string]: PresetTier['settings'] | undefined
}

/** Load the preset document, creating defaults if missing. */
export function loadPresets(): PresetDocument {
  const path = presetsFilePath()
  if (!existsSync(path)) return {}
  try { return JSON.parse(readFileSync(path, 'utf8')) as PresetDocument } catch { return {} }
}

/** Save a preset at the given scope. */
export function savePreset(scope: string, settings: PresetTier['settings']): void {
  const path = presetsFilePath()
  const dir = path.substring(0, path.lastIndexOf('\\') > -1 ? path.lastIndexOf('\\') : path.lastIndexOf('/'))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const doc = loadPresets()
  doc[scope] = settings
  writeFileSync(path, JSON.stringify(doc, null, 2), 'utf8')
}

/** Resolve effective preset: session > workspace > all > undefined. */
export function resolvePreset(sessionScope?: string, workspaceScope?: string): PresetTier['settings'] | undefined {
  const doc = loadPresets()
  if (sessionScope && doc[`session:${sessionScope}`]) return doc[`session:${sessionScope}`]
  if (workspaceScope && doc[`workspace:${workspaceScope}`]) return doc[`workspace:${workspaceScope}`]
  return doc.all
}
