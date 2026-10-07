/**
 * Host generation probe — the ONE narrow-waist version read in the server
 * plane. Capability-based, never reads plugin-local node_modules (family
 * rule, enum-peer INDEX §C): a settings service that still exposes
 * `register` is a pre-0.1.7 host (0.1.0–0.1.5 lines, dsh-settings pack
 * evidence); from 0.1.7-rc.1 the service drops register entirely (probe
 * roundtrip: methods all undefined) and settings live in the loader-managed
 * entry config.
 *
 * Client-side code must NOT use this module: per audit P1-9 the client picks
 * its data path by which scoped sub-inject resolves (configForms arm = Gen D
 * upgrade; bridge transport is the default that works everywhere).
 */

export type HostGeneration = 'legacy' | 'modern'

let cached: HostGeneration | undefined

/** Probe (and cache) the host generation from the settings service face. */
export function detectHostGeneration(ctx: { get(name: string): unknown }): HostGeneration {
	if (cached !== undefined) return cached
	try {
		const settings = ctx.get('settings') as { register?: unknown } | undefined
		cached = typeof settings?.register === 'function' ? 'legacy' : 'modern'
	} catch {
		cached = 'modern'
	}
	return cached
}

/** Test seam: reset the cached probe (unit tests only). */
export function resetHostGenerationCache(): void {
	cached = undefined
}

/**
 * Diagnostics sink by generation: measured on the 0.1.2 host the cordis
 * logger prints nothing in the `dsh web` terminal, so legacy lines report
 * through console; modern hosts keep the service logger.
 */
export interface CompatLog {
	(message: string, ...rest: unknown[]): void
}

export function compatLog(ctx: { get(name: string): unknown; logger?: Record<'info' | 'warn', (...rest: unknown[]) => void> }, level: 'info' | 'warn' = 'info'): CompatLog {
	if (detectHostGeneration(ctx) === 'legacy') {
		return (message, ...rest) => console[level](`[dsh-context-compression-improved] ${message}`, ...rest)
	}
	const sink = ctx.logger?.[level]?.bind(ctx.logger) ?? ((...rest: unknown[]) => console[level](...rest))
	return (message, ...rest) => sink(`[dsh-context-compression-improved] ${message}`, ...rest)
}
