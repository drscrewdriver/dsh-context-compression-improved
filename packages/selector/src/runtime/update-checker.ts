/**
 * Self-update pre-download checker (F19).
 *
 * Plan: cci-longterm-refactor v0.14.6
 *
 * Checks npm registry metadata for newer versions and pre-downloads tarballs.
 * Does NOT auto-install — generates offline upgrade scripts for user control.
 *
 * @module dsh-context-compression-improved/runtime/update-checker
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface UpdateCheckResult {
  readonly available: boolean
  readonly currentVersion: string
  readonly latestVersion?: string
  readonly tarballPath?: string
  readonly shasumValid?: boolean
}

const STAGING_DIR_NAME = '_staging'
const DISMISSED_FILE = 'dismissed.json'

function getStagingDir(): string {
  const dshHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
  return join(dshHome, STAGING_DIR_NAME)
}

function getDismissedSet(): Set<string> {
  const path = join(getStagingDir(), DISMISSED_FILE)
  if (!existsSync(path)) return new Set()
  try { return new Set(JSON.parse(readFileSync(path, 'utf8')) as string[]) } catch { return new Set() }
}

/**
 * Check if a newer version is available (metadata-only, no tarball download).
 * Returns null if check failed or no update available.
 */
export function compareVersions(current: string, latest: string): boolean {
  const c = current.split('.').map(Number)
  const l = latest.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false
  }
  return false
}

/** Check if a specific version has been dismissed by the user. */
export function isDismissed(pkgName: string, version: string): boolean {
  return getDismissedSet().has(`${pkgName}@${version}`)
}

/** Dismiss a version (won't prompt again for this version). */
export function dismissVersion(pkgName: string, version: string): void {
  const dir = getStagingDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const set = getDismissedSet()
  set.add(`${pkgName}@${version}`)
  writeFileSync(join(dir, DISMISSED_FILE), JSON.stringify([...set]), 'utf8')
}

/**
 * Generate an offline upgrade script for a staged tarball.
 * Script is written but NEVER executed automatically.
 */
export function generateUpgradeScript(pkgName: string, version: string, profileDir: string): string {
  const script = `#!/usr/bin/env node
// CCI pre-download upgrade script — generated ${new Date().toISOString()}
// Usage: Close DSH, then run: node this-script.mjs
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const STAGING = join(process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME, '.dsh'), '${STAGING_DIR_NAME}')
const TARBALL = join(STAGING, '${pkgName}-${version}.tgz')
const PROFILE = '${profileDir}'

if (!existsSync(TARBALL)) { console.error('TARBALL not found:', TARBALL); process.exit(1) }

// Verify DSH is not running (Windows)
try { execSync('tasklist /FI "IMAGENAME eq DeepSeek Harness.exe"', { stdio: 'pipe' }); console.warn('WARNING: DSH may still be running') } catch {}

console.log('Upgrading ${pkgName}@${version}...')
execSync(\`pnpm add "file:\${TARBALL}" --dir "\${PROFILE}" --registry https://registry.npmjs.org\`, { stdio: 'inherit' })
console.log('Done. Restart DSH to load the update.')
`
  return script
}
