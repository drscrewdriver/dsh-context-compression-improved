/**
 * Settings namespace lease (ported from the compat/0.1.5 line, where it ran
 * in production as v0.5.8): on legacy hosts (0.1.0–0.1.5) the compression
 * document lives in a settings-service namespace, and BOTH Loader rows
 * (bundle + routes) execute apply() — two fibers must not race
 * `settings.register`. The lease is keyed through a Symbol property on the
 * service itself, so every cordis proxy of the same service shares it.
 *
 * The lease effect is registered BEFORE settings.register(): cordis disposes
 * effects in reverse order, so on teardown the native registration is
 * released first and this disposer can transfer the namespace to another
 * live owner without a duplicate-registration window.
 *
 * On modern hosts (0.1.7+) this is a no-op: dsh-settings dropped `register`
 * entirely (audit P1-13 — API does not exist, not a probe-skip), and the
 * document lives in the entry-config volatile field. Type isolation stays
 * inside this file: callers never see register-typed faces.
 */
import type { Context } from '@deepseek-ai/cordis'

const SHARED_LEASE = Symbol.for('dsh-context-compression-improved/settings-lease')

export interface LeaseFace {
	/** Read the resolved namespace document (settings.get semantics). */
	get(): unknown
	/** Merge-write the namespace document; false when the host rejected it. */
	update(patch: Record<string, unknown>): Promise<boolean>
}

interface SettingsOwner {
	settings: LeaseCarrier
}

interface SharedLease {
	owners: Set<SettingsOwner>
	registrationOwner: SettingsOwner
}

interface LeaseCarrier {
	register?: (ns: string, schema: unknown) => { get?: () => unknown; update?: (ns: string, patch: Record<string, unknown>) => Promise<unknown> }
	get?: (ns: string) => unknown
	update?: (ns: string, patch: Record<string, unknown>) => Promise<unknown>
	replace?: (ns: string, section: Record<string, unknown>) => Promise<unknown>
	[SHARED_LEASE]?: SharedLease
}

/**
 * Lease the namespace. No-op on modern hosts (register absent). Returns a
 * read/update face; both are undefined-safe on modern hosts so callers can
 * hold the face unconditionally and stay on the entry-config path there.
 */
export function acquireSettingsLease(
	ctx: Context,
	namespace: string,
	schema: unknown,
): LeaseFace {
	const settings = (ctx as unknown as { settings?: LeaseCarrier }).settings
	if (settings === undefined || typeof settings.register !== 'function') {
		return { get: () => undefined, update: async () => false }
	}
	const owner: SettingsOwner = { settings }
	let shared = settings[SHARED_LEASE]
	if (shared === undefined) {
		shared = { owners: new Set(), registrationOwner: owner }
		Object.defineProperty(settings, SHARED_LEASE, {
			configurable: true,
			enumerable: false,
			writable: false,
			value: shared,
		})
	}
	shared.owners.add(owner)
	const state = shared

	ctx.effect(() => () => {
		state.owners.delete(owner)
		if (state.registrationOwner === owner && state.owners.size > 0) {
			const next = state.owners.values().next().value as SettingsOwner
			state.registrationOwner = next
			next.settings.register!(namespace, schema)
		}
		if (state.owners.size === 0 && settings[SHARED_LEASE] === state) {
			Reflect.deleteProperty(settings, SHARED_LEASE)
		}
	}, 'contextCompressionSelector.settingsLease()')

	if (state.owners.size === 1) {
		settings.register(namespace, schema)
	}

	return {
		get: () => {
			try {
				return settings.get?.(namespace)
			} catch {
				return undefined
			}
		},
		update: async (patch) => {
			try {
				await settings.update?.(namespace, patch)
				return true
			} catch {
				return false
			}
		},
	}
}
