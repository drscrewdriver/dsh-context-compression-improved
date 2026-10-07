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

/**
 * Pure classifier from a RESOLVED settings service face. A service that still
 * exposes `register` is a pre-0.1.7 host (0.1.0–0.1.5 lines, dsh-settings pack
 * evidence — verified on the real 0.1.0-rc.2 host: `register(ns, schema,
 * options)` at dsh-settings/lib/index.js:311); from 0.1.7-rc.1 the service
 * drops register entirely and settings live in the loader-managed entry
 * config.
 */
export function classifySettingsFace(settings: unknown): HostGeneration {
	return typeof (settings as { register?: unknown } | null)?.register === 'function' ? 'legacy' : 'modern'
}

/**
 * Probe the host generation from the settings service face.
 *
 * A verdict is only CACHED from a resolved service object. Rows compose
 * before host services on every line (measured: the wire-time probe on a real
 * 0.1.0-rc.2 cell saw no settings service yet and the old code cached
 * 'modern' forever — the legacy lease arm went dead on the exact line it was
 * built for). While the service is absent the answer is a provisional
 * 'modern' and deliberately uncached, so the definitive
 * `noteResolvedSettingsService` evidence can still flip it.
 */
export function detectHostGeneration(ctx: { get(name: string): unknown }): HostGeneration {
	if (cached !== undefined) return cached
	let settings: unknown
	try {
		settings = ctx.get('settings')
	} catch {
		return 'modern'
	}
	if (settings === null || typeof settings !== 'object') return 'modern'
	cached = classifySettingsFace(settings)
	return cached
}

/**
 * Definitive verdict from the resolved service (evidence observed, not
 * guessed): the settings inject callback calls this once the service has
 * actually composed. Always (re)writes the cache — a provisional earlier
 * verdict must not survive real evidence.
 */
export function noteResolvedSettingsService(settings: unknown): HostGeneration {
	cached = classifySettingsFace(settings)
	return cached
}

/**
 * Server-plane snapshot for code paths that hold no ctx (the tool-result
 * adapters). The bridge's inject callback has already noted the resolved
 * service by the time any session message flows, so this reads real evidence
 * on every line; without it the only safe answer is the provisional default.
 */
export function hostGenerationSnapshot(): HostGeneration {
	return cached ?? 'modern'
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
