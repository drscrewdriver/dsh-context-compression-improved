/**
 * Multi-plugin watchlist (F20).
 *
 * Plan: cci-longterm-refactor v0.15.3
 *
 * Tracks actively-updated plugins, pre-stages their tarballs,
 * and generates unified upgrade-all.mjs scripts.
 *
 * @module dsh-context-compression-improved/runtime/watchlist
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Default watchlist: plugins that benefit from pre-download + offline apply. */
export const DEFAULT_WATCHLIST: readonly string[] = [
  'dsh-context-compression-improved',
  'dsh-prime-memory',
  'dsh-browser-cdp',
  'dsh-thinking-levels',
]

export interface WatchlistEntry {
  readonly pkgName: string
  readonly currentVersion: string
  readonly latestVersion?: string
  readonly staged?: boolean
  readonly dismissed?: boolean
}

function watchlistPath(): string {
  const dshHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
  return join(dshHome, '_staging', 'watchlist.json')
}

export function loadWatchlist(): string[] {
  const path = watchlistPath()
  if (!existsSync(path)) return [...DEFAULT_WATCHLIST]
  try { return JSON.parse(readFileSync(path, 'utf8')) as string[] } catch { return [...DEFAULT_WATCHLIST] }
}

export function saveWatchlist(pkgs: string[]): void {
  const path = watchlistPath()
  const dir = join(path, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(pkgs, null, 2), 'utf8')
}

/** Generate a batch upgrade script for all staged packages. */
export function generateUpgradeAllScript(entries: readonly WatchlistEntry[]): string {
  const lines = [
    '#!/usr/bin/env node',
    `// CCI upgrade-all — generated ${new Date().toISOString()}`,
    `// Packages: ${entries.length}`,
    'import { execSync } from "node:child_process"',
    'import { existsSync } from "node:fs"',
    'import { join } from "node:path"',
    '',
    'const STAGING = join(process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME, ".dsh"), "_staging")',
    'const PROFILE = process.argv[2] || process.env.DSH_PROFILE',
    'if (!PROFILE) { console.error("Usage: node upgrade-all.mjs <profile-dir>"); process.exit(1) }',
    '',
    'const packages = [',
  ]
  for (const e of entries) {
    lines.push(`  { name: "${e.pkgName}", version: "${e.latestVersion ?? e.currentVersion}" },`)
  }
  lines.push(
    ']',
    '',
    'let failed = false',
    'for (const pkg of packages) {',
    '  const tgz = join(STAGING, `${pkg.name}-${pkg.version}.tgz`)',
    '  if (!existsSync(tgz)) { console.warn(`SKIP ${pkg.name}@${pkg.version} (not staged)`); continue }',
    '  console.log(`UPGRADING ${pkg.name}@${pkg.version}...`)',
    '  try {',
    '    execSync(`pnpm add "file:${"\\$"}{tgz}" --dir "${"\\$"}{PROFILE}" --registry https://registry.npmjs.org`, { stdio: "inherit" })',
    '  } catch { console.error(`FAILED: ${pkg.name}`); failed = true; break }',
    '}',
    'console.log(failed ? "Some upgrades failed." : "All upgrades complete. Restart DSH.")',
  )
  return lines.join('\n')
}
