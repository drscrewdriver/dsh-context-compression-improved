import z from "@deepseek-ai/schemastery";
import "@deepseek-ai/dsh-settings";
import { CONTEXT_COMPRESSION_SETTINGS_NAMESPACE, ContextCompressionSettingsSchema } from "dsh-context-compression-improved-runtime";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEntryPatches, entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import { dump, load } from "js-yaml";
//#region src/estimator-catalog.ts
function str(value) {
	return typeof value === "string" ? value : "";
}
/** Resolve the effective host model route (override → session default). */
function resolveHostRoute(deps) {
	const overrideProvider = str(deps.overrideProvider);
	const overrideModel = str(deps.overrideModel);
	const selected = deps.currentSelection?.();
	const selectedProvider = str(selected?.provider);
	const selectedModel = str(selected?.model);
	const provider = overrideProvider !== "" ? overrideProvider : selectedProvider;
	const model = overrideModel !== "" ? overrideModel : selectedModel;
	if (provider === "" || model === "") return void 0;
	return {
		provider,
		model
	};
}
/** Build the catalog projection. Never throws. */
async function buildEstimatorCatalog(deps) {
	if (deps.llm?.listProviders === void 0) {
		const selection = resolveHostRoute(deps);
		return selection === void 0 ? { providers: [] } : {
			providers: [],
			selection
		};
	}
	const selection = resolveHostRoute(deps);
	const raw = deps.llm.listProviders();
	return {
		providers: await Promise.all(raw.map(async (p) => {
			let models = [];
			let error;
			try {
				models = (await deps.llm?.listModels?.(p.id) ?? []).map((m) => ({
					id: m.id,
					name: m.name
				}));
			} catch (e) {
				error = String(e?.message ?? e);
			}
			if (models.length === 0) try {
				const entry = deps.llm?.listConfigurableProviders?.().find((c) => c.provider === p.id);
				if (entry !== void 0 && deps.llm?.discoverModels !== void 0) {
					const discovered = await deps.llm.discoverModels(entry.settingsNs, { provider: p.id });
					if (discovered.length > 0) {
						models = discovered.map((m) => ({
							id: m.id,
							name: m.name ?? m.id
						}));
						error = void 0;
					}
				}
			} catch {}
			if (models.length === 0 && error === void 0) error = "no models advertised";
			return {
				id: p.id,
				name: p.name,
				models,
				...error === void 0 ? {} : { error }
			};
		})),
		...selection === void 0 ? {} : { selection }
	};
}
//#endregion
//#region src/preset-overlay.ts
/** Plugin-owned, reversible compression overlays for native agent presets. */
/**
* Fixed base for deterministic standing mtimes. The stamp is derived from the
* FULL content identity (source + modules + threshold), not from the write
* clock: identical identities always republish to the same stamp (no
* generation flapping).
*
* The seconds component carries an 8-hex identity window directly. Most
* identities therefore separate even when a filesystem truncates mtimes to
* whole seconds; identities that share that 32-bit window deliberately collide
* first, are detected from the staging file's observed {mtimeMs, size}, and
* escalate to later hash windows before publication. The prefix keeps the
* latest possible stamp around year 2162, inside the nanosecond range every
* supported filesystem can store; the next 3 hex digits set sub-second
* milliseconds on filesystems that preserve them.
*/
const STANDING_MTIME_EPOCH_SECONDS = Math.floor(Date.UTC(2026, 0, 1) / 1e3);
const STANDING_MTIME_WINDOW_HEX = 11;
const DEFAULT_METADATA_IO = Object.freeze({
	async setTimes(path, stamp) {
		await utimes(path, stamp, stamp);
	},
	async read(path) {
		const observed = await stat(path);
		return {
			mtimeMs: observed.mtimeMs,
			size: observed.size
		};
	}
});
/**
* Deterministic standing stamp for one full generation identity, read from
* hash window `windowIndex` (0 = identity prefix). Exported for the
* collision-fixture tests; production code uses {@link standingStampMs}.
*/
function standingStampMsAtWindow(identity, windowIndex) {
	const start = windowIndex * STANDING_MTIME_WINDOW_HEX;
	const seconds = STANDING_MTIME_EPOCH_SECONDS + parseInt(identity.slice(start, start + 8).padEnd(8, "0"), 16);
	const subSecond = parseInt(identity.slice(start + 8, start + STANDING_MTIME_WINDOW_HEX).padEnd(3, "0"), 16) % 1e3;
	return seconds * 1e3 + subSecond;
}
const COMPRESSION_IDS = /* @__PURE__ */ new Set([
	"compaction",
	"compaction-basic",
	"command-compact",
	"tool-result-pruner"
]);
const COMPRESSION_PACKAGES = /* @__PURE__ */ new Set([
	"@deepseek-ai/dsh-compaction-basic",
	"@deepseek-ai/dsh-command-compact",
	"@deepseek-ai/dsh-compaction-tool-result-pruner",
	"dsh-context-compression-improved-runtime"
]);
/**
* Resolve the three compression package entries once from this package.
* @returns Absolute entry paths for the canonical compression layer.
*/
function resolveCompressionModulePaths() {
	return {
		compactionBasic: modulePath("@deepseek-ai/dsh-compaction-basic", import.meta.resolve("@deepseek-ai/dsh-compaction-basic")),
		commandCompact: modulePath("@deepseek-ai/dsh-command-compact", import.meta.resolve("@deepseek-ai/dsh-command-compact")),
		toolResultPruner: modulePath("dsh-context-compression-improved-runtime", import.meta.resolve("dsh-context-compression-improved-runtime"))
	};
}
/** Convert one package resolution into the absolute path preset mounting accepts. */
function modulePath(specifier, resolved) {
	if (!resolved.startsWith("file:")) throw new Error(`context-compression selector: ${specifier} resolved outside the filesystem (${resolved})`);
	return fileURLToPath(resolved);
}
/** Generated composition storage owned by one decorator installation. */
var PresetOverlayStore = class {
	options;
	rootTask;
	disposed = false;
	metadataIo;
	constructor(options) {
		this.options = options;
		this.metadataIo = options.metadataIo ?? DEFAULT_METADATA_IO;
		const paths = Object.entries(options.modules);
		for (const [name, path] of paths) if (!isAbsolute(path)) throw new TypeError(`context-compression selector: module path ${name} is not absolute: ${path}`);
	}
	/** Return a detached preset record whose path names the canonical overlay. */
	async overlay(preset) {
		if (this.disposed) throw new Error("context-compression selector: preset overlay is disposed");
		if (preset.broken !== void 0) return preset;
		const source = await readFile(preset.path, "utf8");
		const rows = parseRows(source, preset.path);
		const thresholdPercent = this.options.autoCompactThresholdPercent?.();
		if (thresholdPercent !== void 0 && !Number.isFinite(thresholdPercent)) throw new Error(`context-compression selector: Auto Compact threshold percent must be finite, got ${String(thresholdPercent)}`);
		const patched = applyEntryPatches(stripCompressionRows(rows), [{ insert: canonicalCompressionRows(this.options.modules, thresholdPercent) }], (message, ...args) => {
			throw new Error(renderPatchWarning(message, args));
		});
		const rendered = dump(patched, {
			schema: entryListSchema,
			noRefs: true,
			lineWidth: -1,
			sortKeys: false
		});
		const identity = createHash("sha256").update(preset.id).update("\0").update(source).update("\0").update(JSON.stringify({
			modules: this.options.modules,
			autoCompactThresholdPercent: thresholdPercent ?? null
		})).digest("hex").slice(0, 24);
		const root = await this.root();
		const path = join(root, `${preset.id}-${identity}.agent.cordis.yml`);
		const staging = join(root, `${preset.id}-${identity}.${String(process.pid)}-${String(Math.random()).slice(2)}.tmp`);
		try {
			await writeFile(staging, rendered, {
				encoding: "utf8",
				mode: 384
			});
			await chmod(staging, 384);
			await this.disambiguateStamp(staging, identity);
			await rename(staging, path);
		} catch (error) {
			try {
				await rm(staging, { force: true });
			} catch {}
			throw error;
		}
		return {
			...preset,
			path
		};
	}
	/** Observed {mtimeMs,size} keys published by this store, per identity. */
	standingKeys = /* @__PURE__ */ new Map();
	/**
	* Ensure an unpublished staging file's observed {mtimeMs, size} is not
	* shared with a different identity. Escalation rewrites the mtime from later
	* hash windows before atomic publication, and fails loudly if no window
	* separates them (better a loud error than a silently reused generation).
	*/
	async disambiguateStamp(path, identity) {
		for (let window = 0; window < 3; window += 1) {
			const stamp = new Date(standingStampMsAtWindow(identity, window));
			await this.metadataIo.setTimes(path, stamp);
			const observed = await this.metadataIo.read(path);
			const key = `${String(observed.mtimeMs)}:${String(observed.size)}`;
			const owner = this.standingKeys.get(key);
			if (owner === void 0 || owner === identity) {
				this.standingKeys.set(key, identity);
				return;
			}
		}
		throw new Error(`context-compression selector: standing stamp collision for identity ${identity} across all hash windows`);
	}
	/** Remove all generated files without touching any source preset. */
	async dispose() {
		if (this.disposed) return;
		this.disposed = true;
		if (this.rootTask === void 0) return;
		const root = await this.rootTask;
		await rm(root, {
			recursive: true,
			force: true
		});
	}
	/** Lazily create the one owner-only directory for this installation. */
	async root() {
		if (this.rootTask === void 0) {
			const parent = this.options.tempParent ?? tmpdir();
			this.rootTask = mkdtemp(join(parent, "dsh-context-compression-presets-")).then(async (root) => {
				await chmod(root, 448);
				return root;
			});
		}
		return await this.rootTask;
	}
};
/** Parse one native preset with exactly the Loader's YAML dialect. */
function parseRows(source, path) {
	const parsed = load(source, { schema: entryListSchema });
	if (!Array.isArray(parsed)) throw new TypeError(`context-compression selector: preset ${path} is not a top-level entry list`);
	return parsed;
}
/** Remove any prior compression implementation before adding the canonical one. */
function stripCompressionRows(rows) {
	const kept = [];
	for (const row of rows) {
		if (COMPRESSION_IDS.has(row.id) || COMPRESSION_PACKAGES.has(row.name)) continue;
		if (row.group === true && Array.isArray(row.config)) {
			const nested = row.config;
			kept.push({
				...row,
				config: stripCompressionRows(nested)
			});
		} else kept.push(row);
	}
	return kept;
}
/**
* Complete, same-realm compression stack added to every applicable preset.
* When the Host settings expose an Auto Compact threshold, one read feeds both
* the compaction-basic `thresholdRatio` (beside the pinned first-release
* `retainRatio`) and the runtime deployment config, so plugin History and
* native Auto Compact share one watermark for this whole generation.
*/
function canonicalCompressionRows(modules, thresholdPercent) {
	return [{
		id: "compaction",
		name: "cordis:group",
		group: true,
		isolate: {
			compaction: true,
			toolResultPruner: true
		},
		config: [
			{
				id: "compaction-basic",
				name: modules.compactionBasic,
				...thresholdPercent === void 0 ? {} : { config: {
					thresholdRatio: thresholdPercent / 100,
					retainRatio: .16
				} }
			},
			{
				id: "command-compact",
				name: modules.commandCompact
			},
			{
				id: "tool-result-pruner",
				name: modules.toolResultPruner,
				config: {
					headChars: 4096,
					tailChars: 1024,
					...thresholdPercent === void 0 ? {} : { autoCompactThresholdPercent: thresholdPercent }
				}
			}
		]
	}];
}
/** Render include's printf-style warning without silently losing its target. */
function renderPatchWarning(message, args) {
	let index = 0;
	return `context-compression selector: ${message.replace(/%C/g, () => JSON.stringify(args[index++]))}`;
}
/**
* Cordis can hand two callers different traceable proxies for one service.
* Symbol properties forward to the shared target, unlike proxy identity.
*/
const SHARED_DECORATION = Symbol.for("dsh-context-compression-improved/preset-overlay");
/** Object-identity keys keep test metadata policies from sharing one store. */
const METADATA_IO_KEYS = /* @__PURE__ */ new WeakMap();
let nextMetadataIoKey = 1;
function metadataIoKey(metadataIo) {
	const existing = METADATA_IO_KEYS.get(metadataIo);
	if (existing !== void 0) return existing;
	const key = nextMetadataIoKey;
	nextMetadataIoKey += 1;
	METADATA_IO_KEYS.set(metadataIo, key);
	return key;
}
/**
* Reversibly decorate native AgentPresets composition calls.
*
* Duplicate Host rows share one physical decoration. This matters while an
* installation migrates from a Harness-bundled selector row to the standalone
* Bundle: either row can unload first without double-compressing or disposing
* the generated files still used by the other.
* @param presets Native AgentPresets service to decorate during composition.
* @param options Canonical module paths, exclusions, and optional test directory.
* @returns A reference-counted handle that restores the native service on final disposal.
*/
function decorateAgentPresets(presets, options) {
	const optionsKey = overlayOptionsKey(options);
	const carrier = presets;
	let shared = carrier[SHARED_DECORATION];
	if (shared === void 0) {
		shared = {
			optionsKey,
			references: 0,
			installation: installAgentPresetsDecoration(presets, options)
		};
		Object.defineProperty(carrier, SHARED_DECORATION, {
			configurable: true,
			enumerable: false,
			writable: false,
			value: shared
		});
	} else if (shared.optionsKey !== optionsKey) throw new Error("context-compression selector: AgentPresets already has a different compression overlay");
	const lease = shared;
	lease.references += 1;
	let disposed = false;
	return { async dispose() {
		if (disposed) return;
		disposed = true;
		lease.references -= 1;
		if (lease.references !== 0) return;
		if (carrier[SHARED_DECORATION] === lease) Reflect.deleteProperty(carrier, SHARED_DECORATION);
		await lease.installation.dispose();
	} };
}
/** Stable equality for two rows asking to share one physical overlay. */
function overlayOptionsKey(options) {
	return JSON.stringify({
		modules: options.modules,
		excludedPresetIds: [...options.excludedPresetIds ?? ["minimal"]].sort(),
		tempParent: options.tempParent,
		metadataIo: metadataIoKey(options.metadataIo ?? DEFAULT_METADATA_IO)
	});
}
/**
* Install the one physical method decoration leased by public callers.
*
* Direct resolution and authoring stay source-preserving. AsyncLocalStorage
* scopes the overlay to the async call tree of mount/recompose/standingKeyFor,
* so an unrelated resolve racing the mount cannot inherit its generated path.
*/
function installAgentPresetsDecoration(presets, options) {
	const excluded = new Set(options.excludedPresetIds ?? ["minimal"]);
	const operations = new AsyncLocalStorage();
	const store = new PresetOverlayStore(options);
	const snapshots = snapshotMethods(presets);
	const resolveSnapshot = snapshotFor(snapshots, "resolve");
	const resolveWrapped = async (id) => {
		const preset = await Reflect.apply(resolveSnapshot.original, presets, [id]);
		if (operations.getStore()?.composing !== true || excluded.has(preset.id)) return preset;
		return await store.overlay(preset);
	};
	installMethod(presets, resolveSnapshot, resolveWrapped);
	for (const method of [
		"mount",
		"recompose",
		"standingKeyFor"
	]) {
		const snapshot = snapshotFor(snapshots, method);
		const wrapped = (...args) => operations.run({ composing: true }, () => Reflect.apply(snapshot.original, presets, args));
		installMethod(presets, snapshot, wrapped);
	}
	let disposed = false;
	return { async dispose() {
		if (disposed) return;
		disposed = true;
		for (const snapshot of [...snapshots].reverse()) restoreMethod(presets, snapshot);
		await store.dispose();
	} };
}
/** Capture callable methods and whether each was inherited or owned. */
function snapshotMethods(presets) {
	return [
		"resolve",
		"mount",
		"recompose",
		"standingKeyFor"
	].map((name) => {
		const original = presets[name];
		if (typeof original !== "function") throw new TypeError(`context-compression selector: AgentPresets.${name} is unavailable`);
		return {
			name,
			own: Object.getOwnPropertyDescriptor(presets, name),
			original
		};
	});
}
/** Return the captured method or fail loudly if the snapshot set is corrupt. */
function snapshotFor(snapshots, name) {
	const snapshot = snapshots.find((candidate) => candidate.name === name);
	if (snapshot === void 0) throw new Error(`context-compression selector: missing method snapshot for ${name}`);
	return snapshot;
}
/** Install one own method while retaining its identity for safe disposal. */
function installMethod(presets, snapshot, wrapped) {
	snapshot.wrapped = wrapped;
	Object.defineProperty(presets, snapshot.name, {
		configurable: true,
		writable: true,
		value: wrapped
	});
}
/** Restore the captured own/prototype state after the final shared lease. */
function restoreMethod(presets, snapshot) {
	if (snapshot.own === void 0) Reflect.deleteProperty(presets, snapshot.name);
	else Object.defineProperty(presets, snapshot.name, snapshot.own);
}
//#endregion
//#region src/index.ts
const ESTIMATOR_CATALOG_ROUTES = ["/endpoint/dsh-context-compression-improved/estimator-catalog", "/api/dsh-context-compression-improved/estimator-catalog"];
function asWebServer(value) {
	const register = value?.register;
	if (typeof register !== "function") return void 0;
	return { register };
}
/**
* Serve `GET /api/dsh-context-compression-improved/estimator-catalog` — the
* settings card's host-route dropdowns (live provider/model groups from the DSH
* `llm` service plus the effective selection). This lives on the top-level
* plugin context, NOT inside the isolated toolResultPruner service: a route
* registered there can never reach the `webServer` service across the
* isolation boundary, and the dropdowns answer 401. `ctx.inject` also fixes
* the late-activation problem the old polling loop worked around — the handler
* is installed the moment `webServer` appears. Best effort: without the
* service the plugin keeps working, only the HTTP API is missing.
*/
function registerEstimatorCatalogRoute(ctx) {
	ctx.inject([
		"webServer",
		"llm",
		"agentDefaultModel"
	], (injected) => {
		const rctx = injected;
		const webServer = asWebServer(rctx.webServer);
		if (webServer === void 0) return;
		const handler = (_req, res) => {
			const resTyped = res;
			if (typeof resTyped?.writeHead !== "function" || typeof resTyped?.end !== "function") return;
			const defaults = rctx.agentDefaultModel;
			buildEstimatorCatalog({
				...rctx.llm === void 0 ? {} : { llm: rctx.llm },
				...typeof defaults?.currentSelection === "function" ? { currentSelection: () => defaults.currentSelection?.() } : {}
			}).then((catalog) => {
				resTyped.writeHead(200, {
					"content-type": "application/json; charset=utf-8",
					"cache-control": "no-cache"
				});
				resTyped.end(JSON.stringify({
					ok: true,
					...catalog
				}));
			}, (error) => {
				resTyped.writeHead(500, { "content-type": "application/json; charset=utf-8" });
				resTyped.end(JSON.stringify({
					ok: false,
					error: String(error?.message ?? error)
				}));
			});
		};
		const disposers = ESTIMATOR_CATALOG_ROUTES.map((path) => webServer.register({
			kind: "exact",
			path,
			handler
		})).filter((off) => typeof off === "function");
		rctx.effect(() => () => {
			for (const off of disposers) off();
		}, "contextCompressionSelector.estimator-catalog route");
	});
}
const CONTEXT_COMPRESSION_NAMESPACE = CONTEXT_COMPRESSION_SETTINGS_NAMESPACE;
/** Symbol properties reach the shared service target through Cordis proxies. */
const SHARED_SETTINGS = Symbol.for("dsh-context-compression-improved/settings-registration");
/** Loader validation for the standalone Bundle opt-in. */
const Config = z.object({ presetOverlay: z.boolean().default(false) });
/** Register the persisted default read by the currently mounted root pruner. */
function apply(ctx, config = {}) {
	ctx.inject(["settings"], (settingsCtx) => {
		acquireSettingsRegistration(settingsCtx);
	});
	registerEstimatorCatalogRoute(ctx);
	if (config.presetOverlay !== true) return;
	ctx.inject(["agentPresets"], (presetsCtx) => {
		const installation = decorateAgentPresets(presetsCtx.agentPresets, {
			modules: resolveCompressionModulePaths(),
			excludedPresetIds: ["minimal"],
			autoCompactThresholdPercent: () => resolveAutoCompactThresholdPercent(presetsCtx)
		});
		presetsCtx.effect(() => () => installation.dispose(), "contextCompressionSelector.agentPresets()");
	});
}
/**
* Read the current Auto Compact threshold ratio at composition time. Settings
* values are revalidated here, and any unreadable value falls back to the 80%
* default rather than blocking preset composition.
*/
function resolveAutoCompactThresholdPercent(presetsCtx) {
	const raw = presetsCtx.get("settings")?.get(CONTEXT_COMPRESSION_NAMESPACE);
	try {
		return ContextCompressionSettingsSchema(structuredClone(raw)).autoCompact.thresholdPercent;
	} catch {
		return 80;
	}
}
/**
* Lease one native settings registration across duplicate Host rows.
*
* The lease effect is intentionally registered before settings.register().
* Cordis disposes effects in reverse order, so the native registration first
* releases the namespace; this disposer can then transfer it to another live
* owner without a duplicate-registration window.
*/
function acquireSettingsRegistration(ctx) {
	const settings = ctx.settings;
	const owner = { settings };
	let shared = settings[SHARED_SETTINGS];
	if (shared === void 0) {
		shared = {
			owners: /* @__PURE__ */ new Set(),
			registrationOwner: owner,
			scope: void 0
		};
		Object.defineProperty(settings, SHARED_SETTINGS, {
			configurable: true,
			enumerable: false,
			writable: false,
			value: shared
		});
	}
	shared.owners.add(owner);
	const state = shared;
	ctx.effect(() => () => {
		state.owners.delete(owner);
		if (state.registrationOwner === owner && state.owners.size > 0) {
			const next = state.owners.values().next().value;
			state.registrationOwner = next;
			state.scope = next.settings.register(CONTEXT_COMPRESSION_NAMESPACE, ContextCompressionSettingsSchema);
		}
		if (state.owners.size === 0 && settings[SHARED_SETTINGS] === state) Reflect.deleteProperty(settings, SHARED_SETTINGS);
	}, "contextCompressionSelector.settingsLease()");
	if (state.owners.size === 1) state.scope = settings.register(CONTEXT_COMPRESSION_NAMESPACE, ContextCompressionSettingsSchema);
}
//#endregion
export { Config, apply };
