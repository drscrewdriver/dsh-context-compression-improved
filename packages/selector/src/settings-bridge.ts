/**
 * Settings bridge — the old-line (0.1.0–0.1.5) data plane, plus a read-only
 * supplement everywhere else.
 *
 * Gate 0 verdicts this module implements (plan findings §B2.1/§B2.3):
 *   - the client `settingsScope.bind` data face never becomes ready on
 *     0.1.5 (status:"unavailable", writes rejected) → the webServer bridge is
 *     the ONLY working settings transport there;
 *   - on legacy hosts the document persists through a settings.register
 *     namespace lease (`acquireSettingsLease`); on modern hosts the entry
 *     config volatile field stays authoritative and this route only reads,
 *     because the client upgrades to the configForms scope there (B8 arm).
 *   - route registration must ride a Loader row carrying `inject: [webServer]`
 *     (the in-plugin ctx.inject never resolves on 0.1.x); the dual-channel
 *     guarded registration here covers the direct-arrival order as well.
 */
import type { Context } from '@deepseek-ai/cordis'
import { CONTEXT_COMPRESSION_SETTINGS_NAMESPACE, ContextCompressionSettingsSchema } from './runtime/config.ts'
import { detectHostGeneration, noteResolvedSettingsService, compatLog } from './compat/host-generation.ts'
import { acquireSettingsLease, type LeaseFace } from './compat/settings-lease.ts'

const ENTRY_ID = 'context-compression-improved-bundle'

interface WebServerLike {
	register(route: { kind: 'exact'; path: string; handler: (req: unknown, res: unknown) => unknown }): () => void
}

/** Hand back the service itself — the host reads route tables off `this`. */
function asWebServer(value: unknown): WebServerLike | undefined {
	if (typeof value !== 'object' || value === null) return undefined
	const candidate = value as { register?: unknown }
	return typeof candidate.register === 'function' ? (value as WebServerLike) : undefined
}

interface ResLike {
	writeHead: (code: number, headers?: Record<string, string>) => void
	end: (body?: string) => void
}

function jsonResponse(res: unknown, status: number, body: unknown): void {
	const typed = res as ResLike | undefined
	if (typeof typed?.writeHead !== 'function' || typeof typed?.end !== 'function') return
	typed.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
	typed.end(JSON.stringify(body))
}

/** Modern-host read: the entry config descriptor's resolved value (pruner parity). */
function readEntryDoc(settings: unknown): unknown {
	const host = settings as { describe?: () => Array<{ ns: unknown; value?: unknown }>; get?: (ns: string) => unknown } | undefined
	try {
		const described = host?.describe?.().find((d) => String(d.ns) === ENTRY_ID)?.value
		if (described !== undefined) {
			const record = described as { settings?: unknown }
			return record !== null && typeof record === 'object' && 'settings' in record ? record.settings : described
		}
	} catch {}
	return undefined
}

export function wireSettingsBridge(ctx: Context): void {
	const log = compatLog(ctx, 'warn')
	// Provisional at wire time: rows compose before host services, so the
	// probe usually sees no settings service here. The inject callback below
	// rewrites it from the resolved face — handlers read the variable lazily
	// per request, never a frozen snapshot.
	let generation = detectHostGeneration(ctx)

	// Lease the namespace on legacy hosts; no-op face on modern (register is
	// gone there — P1-13). Assigned inside the settings inject; handlers read
	// it lazily so arrival order never matters.
	let lease: LeaseFace | undefined
	try {
		ctx.inject(['settings'], (settingsCtx) => {
			lease = acquireSettingsLease(settingsCtx as Context, CONTEXT_COMPRESSION_SETTINGS_NAMESPACE, ContextCompressionSettingsSchema)
			const svc = (settingsCtx as { settings?: unknown }).settings
			generation = noteResolvedSettingsService(svc)
			compatLog(ctx, 'info')(`settings service resolved, generation=${generation}`)
		})
	} catch (error) {
		log('settings lease wiring failed:', error)
	}

	const readDoc = (): unknown => {
		const settings = (() => {
			try {
				return ctx.get('settings')
			} catch {
				return undefined
			}
		})()
		if (generation === 'legacy') {
			return lease?.get() ?? (settings as { get?: (ns: string) => unknown } | undefined)?.get?.(CONTEXT_COMPRESSION_SETTINGS_NAMESPACE)
		}
		return readEntryDoc(settings) ?? (settings as { get?: (ns: string) => unknown } | undefined)?.get?.(CONTEXT_COMPRESSION_SETTINGS_NAMESPACE)
	}

	const handleGet = (_req: unknown, res: unknown): void => {
		const doc = readDoc()
		jsonResponse(res, 200, { ok: true, doc: doc ?? null, generation })
	}

	const handlePost = (req: unknown, res: unknown): void => {
		if (generation !== 'legacy' || lease === undefined) {
			// Modern hosts: configForms owns writes (entry-config volatile field).
			jsonResponse(res, 409, { ok: false, error: 'modern-host: configForms is authoritative' })
			return
		}
		const chunks: Buffer[] = []
		const typed = req as { on?: (event: string, cb: (chunk?: Buffer) => void) => void }
		if (typeof typed?.on !== 'function') {
			jsonResponse(res, 400, { ok: false, error: 'unreadable request body' })
			return
		}
		typed.on('data', (chunk) => { if (chunk) chunks.push(chunk) })
		typed.on('end', async () => {
			try {
				const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { doc?: unknown }
				if (parsed.doc === undefined || parsed.doc === null || typeof parsed.doc !== 'object') {
					jsonResponse(res, 400, { ok: false, error: 'doc must be an object' })
					return
				}
				const written = await lease!.update(parsed.doc as Record<string, unknown>)
				if (!written) {
					jsonResponse(res, 502, { ok: false, error: 'settings update rejected by host' })
					return
				}
				jsonResponse(res, 200, { ok: true, doc: parsed.doc })
			} catch (error) {
				jsonResponse(res, 500, { ok: false, error: String((error as Error)?.message ?? error) })
			}
		})
	}

	let registered = false
	const register = (webServer: WebServerLike, channel: 'direct' | 'inject'): void => {
		if (registered) return
		try {
			const disposers = [
				`/endpoint/dsh-context-compression-improved/settings`,
				`/api/dsh-context-compression-improved/settings`,
			]
				.map((path) => webServer.register({
					kind: 'exact',
					path,
					handler: (req, res) => {
						if (String((req as { method?: string })?.method ?? 'GET').toUpperCase() === 'POST') return handlePost(req, res)
						return handleGet(req, res)
					},
				}))
				.filter((off): off is () => void => typeof off === 'function')
			registered = true
			ctx.effect(() => () => { for (const off of disposers) off() }, 'contextCompressionSelector.settings bridge route')
			compatLog(ctx, 'info')(`settings bridge registered (${channel}), generation=${generation}`)
		} catch (error) {
			log('settings bridge registration failed:', error)
		}
	}

	const active = asWebServer((() => {
		try {
			return ctx.get('webServer')
		} catch {
			return undefined
		}
	})())
	if (active !== undefined) {
		register(active, 'direct')
		if (registered) return
	}
	ctx.inject(['webServer'], (injected) => {
		const webServer = asWebServer((injected as { webServer?: unknown }).webServer)
		if (webServer === undefined) return
		register(webServer, 'inject')
	})
}
