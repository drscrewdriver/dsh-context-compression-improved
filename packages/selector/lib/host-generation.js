//#region src/compat/host-generation.ts
let cached;
/** Probe (and cache) the host generation from the settings service face. */
function detectHostGeneration(ctx) {
	if (cached !== void 0) return cached;
	try {
		cached = typeof ctx.get("settings")?.register === "function" ? "legacy" : "modern";
	} catch {
		cached = "modern";
	}
	return cached;
}
function compatLog(ctx, level = "info") {
	if (detectHostGeneration(ctx) === "legacy") return (message, ...rest) => console[level](`[dsh-context-compression-improved] ${message}`, ...rest);
	const sink = ctx.logger?.[level]?.bind(ctx.logger) ?? ((...rest) => console[level](...rest));
	return (message, ...rest) => sink(`[dsh-context-compression-improved] ${message}`, ...rest);
}
//#endregion
export { detectHostGeneration as n, compatLog as t };
