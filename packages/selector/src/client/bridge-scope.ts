/**
 * Bridge-backed settings scope — the default data plane on legacy hosts
 * (0.1.0–0.1.5), where the client `settingsScope.bind` face never becomes
 * ready (Gate 0: status "unavailable", writes rejected) and configForms does
 * not exist. Speaks HTTP to the settings bridge route (settings-bridge.ts)
 * and implements the same `SettingsScope` face the configForms scope builds,
 * so the selector components stay generation-agnostic.
 *
 * Detection-free by design (audit P1-9): no property probing, no timeouts —
 * the bridge works on every line, and on 0.1.7+ the configForms scoped
 * sub-inject resolves and replaces this scope with the native one.
 */
import type { ScopeSnapshot, SettingsScope } from './scope-face.ts'
import { decodeSettings } from './decode.ts'
import type { ContextCompressionSettings } from './CompressionProfileSelector.tsx'

const SETTINGS_ROUTE = '/api/dsh-context-compression-improved/settings'
const POLL_MS = 4000

export interface BridgeScope extends SettingsScope<ContextCompressionSettings> {
	/** Kick an immediate refresh (called once at apply). */
	refresh(): void
}

export function createBridgeScope(): BridgeScope {
	let snapshot: ScopeSnapshot<ContextCompressionSettings> = {
		status: 'loading', value: undefined, revision: undefined,
		writable: true, base: undefined, user: undefined, mode: 'host',
	}
	const listeners = new Set<() => void>()
	let pollTimer: ReturnType<typeof setInterval> | undefined

	const emit = () => { for (const listener of listeners) listener() }

	const applyDoc = (doc: unknown, revision: number | undefined): void => {
		const value = decodeSettings(doc)
		const next: ScopeSnapshot<ContextCompressionSettings> = {
			status: value === undefined ? 'unavailable' : 'ready',
			value,
			revision,
			writable: true,
			base: undefined,
			user: undefined,
			mode: 'host',
		}
		if (JSON.stringify(next) !== JSON.stringify(snapshot)) {
			snapshot = next
			emit()
		}
	}

	async function refresh(): Promise<void> {
		try {
			const response = await fetch(SETTINGS_ROUTE, { headers: { 'cache-control': 'no-cache' } })
			if (!response.ok) throw new Error(`settings bridge ${response.status}`)
			const body = await response.json() as { doc?: unknown; revision?: number | null }
			applyDoc(body.doc, body.revision ?? undefined)
		} catch {
			if (snapshot.status !== 'unavailable') {
				snapshot = { ...snapshot, status: 'unavailable' }
				emit()
			}
		}
	}

	async function writeDoc(next: ContextCompressionSettings): Promise<boolean> {
		const response = await fetch(SETTINGS_ROUTE, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ doc: next }),
		})
		if (!response.ok) return false
		const body = await response.json() as { ok?: boolean; doc?: unknown }
		if (body.ok !== true) return false
		applyDoc(body.doc ?? next, (snapshot.revision ?? 0) + 1)
		return true
	}

	const cloneDoc = (): ContextCompressionSettings => {
		const value = snapshot.value
		return (value === undefined ? {} : structuredClone(value)) as ContextCompressionSettings
	}

	const scope: BridgeScope = {
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener)
			if (listeners.size === 1) {
				void refresh()
				pollTimer = setInterval(() => { void refresh() }, POLL_MS)
			}
			return () => {
				listeners.delete(listener)
				if (listeners.size === 0 && pollTimer !== undefined) {
					clearInterval(pollTimer)
					pollTimer = undefined
				}
			}
		},
		set: async (field, value) => {
			const next = cloneDoc() as unknown as Record<string, unknown>
			next[field] = value
			return writeDoc(next as unknown as ContextCompressionSettings)
		},
		unset: async (field) => {
			const next = cloneDoc() as unknown as Record<string, unknown>
			delete next[field]
			return writeDoc(next as unknown as ContextCompressionSettings)
		},
		mutate: async (ops) => {
			const doc = cloneDoc() as unknown as Record<string, unknown>
			for (const op of ops) {
				const [head, key] = op.path as [string, string]
				if (head !== 'presetOptions') return false
				const section = { ...((doc.presetOptions ?? {}) as Record<string, unknown>) }
				if (op.op === 'unset') delete section[key]
				else section[key] = (op as { value?: unknown }).value
				doc.presetOptions = section
			}
			return writeDoc(doc as unknown as ContextCompressionSettings)
		},
		refresh: () => { void refresh() },
	}
	return scope
}
