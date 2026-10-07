//#region src/compat/host-generation.ts
let cached;
/**
* Pure classifier from a RESOLVED settings service face. A service that still
* exposes `register` is a pre-0.1.7 host (0.1.0–0.1.5 lines, dsh-settings pack
* evidence — verified on the real 0.1.0-rc.2 host: `register(ns, schema,
* options)` at dsh-settings/lib/index.js:311); from 0.1.7-rc.1 the service
* drops register entirely and settings live in the loader-managed entry
* config.
*/
function classifySettingsFace(settings) {
	return typeof settings?.register === "function" ? "legacy" : "modern";
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
function detectHostGeneration(ctx) {
	if (cached !== void 0) return cached;
	let settings;
	try {
		settings = ctx.get("settings");
	} catch {
		return "modern";
	}
	if (settings === null || typeof settings !== "object") return "modern";
	cached = classifySettingsFace(settings);
	return cached;
}
/**
* Definitive verdict from the resolved service (evidence observed, not
* guessed): the settings inject callback calls this once the service has
* actually composed. Always (re)writes the cache — a provisional earlier
* verdict must not survive real evidence.
*/
function noteResolvedSettingsService(settings) {
	cached = classifySettingsFace(settings);
	return cached;
}
/**
* Server-plane snapshot for code paths that hold no ctx (the tool-result
* adapters). The bridge's inject callback has already noted the resolved
* service by the time any session message flows, so this reads real evidence
* on every line; without it the only safe answer is the provisional default.
*/
function hostGenerationSnapshot() {
	return cached ?? "modern";
}
function compatLog(ctx, level = "info") {
	if (detectHostGeneration(ctx) === "legacy") return (message, ...rest) => console[level](`[dsh-context-compression-improved] ${message}`, ...rest);
	const sink = ctx.logger?.[level]?.bind(ctx.logger) ?? ((...rest) => console[level](...rest));
	return (message, ...rest) => sink(`[dsh-context-compression-improved] ${message}`, ...rest);
}
//#endregion
export { noteResolvedSettingsService as i, detectHostGeneration as n, hostGenerationSnapshot as r, compatLog as t };
