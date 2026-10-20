//#region src/runtime/session-events.ts
/**
* Read one immutable Session event snapshot.
*
* Harness rc.2 exposed `events`; Alpha 5 replaced it with the public
* `snapshotEvents()` method. Prefer the new API when present and retain the
* old accessor as the compatibility fallback for already-supported hosts.
*/
function sessionEvents(session) {
	const snapshot = session.snapshotEvents;
	if (typeof snapshot === "function") return snapshot.call(session);
	return session.events ?? [];
}
/**
* Resolve one surface-node seq to its event. 0.1.5 surface nodes are
* positional and may replace earlier ranges, so a node's seq is not
* guaranteed to equal the snapshot array index: always resolve by seq.
*/
function eventBySeq(events, seq) {
	return events[Number(seq)];
}
//#endregion
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
//#region src/compat/tool-result.ts
/**
* Tool-result envelope adapter (audit N2: three-axis relocation, not a
* single-axis unwrap) + legacy message-source kind escape (audit B6).
*
* Three-axis mapping, main's own comment as evidence
* (pruner/session.ts: "0.1.7-rc.2: isError moved from the result block onto
* the message itself"):
*
*   semantics      Gen D (0.1.7-rc.2+ / 0.2.0)     Gen A/B/C (0.1.0–0.1.5)
*   content blocks  message.content                 message.content[0].content
*   error location  message.isError                 message.content[0].isError
*   call id         message.toolCallId              message.source.callId
*
* Every consumer must take the whole triple from viewToolResult(); touching
* a single axis inline is how the isError/callId axes get silently dropped.
* A strict legacy signature overrides the generation flag per message (the
* 0.1.7-rc.1 envelope shape was only load-verified, not session-verified —
* this makes a wrong flag self-correcting instead of silently misreading).
*/
/** Strict signature of the enveloped (0.1.x) tool/result message. */
function envelopedShape(content) {
	return Array.isArray(content) && content.length === 1 && typeof content[0] === "object" && content[0] !== null && content[0].type === "tool-result" && Array.isArray(content[0].content);
}
function viewToolResult(message, generation) {
	const gen = generation ?? hostGenerationSnapshot();
	const content = message.content;
	if (envelopedShape(content)) {
		const wrapper = content[0];
		return {
			blocks: wrapper.content,
			isError: wrapper.isError === true,
			callId: typeof message.source?.callId === "string" ? message.source.callId : void 0
		};
	}
	if (gen === "legacy") {
		const wrapper = Array.isArray(content) ? content[0] : void 0;
		if (wrapper && typeof wrapper === "object" && Array.isArray(wrapper.content)) return {
			blocks: wrapper.content,
			isError: wrapper.isError === true,
			callId: typeof message.source?.callId === "string" ? message.source.callId : void 0
		};
	}
	return {
		blocks: Array.isArray(content) ? content : [],
		isError: message.isError === true,
		callId: typeof message.toolCallId === "string" ? message.toolCallId : gen === "legacy" && typeof message.source?.callId === "string" ? message.source.callId : void 0
	};
}
/**
* Per-producer source kind, generation-gated. Modern hosts accept the
* producer-declared kind (declared in pruner.ts's `MessageSourceMap`
* augmentation); 0.1.x hosts only know the shared `{ kind: 'plugin' }` kind
* — the dev bed's dsh-llm@0.2.0-rc.1 type face has no such member (audit B6,
* empirically confirmed), so the legacy object escapes through `as never`
* HERE and nowhere else.
*/
const PLUGIN_ID = "dsh-context-compression-improved";
function compressionMessageSource(generation) {
	if ((generation ?? hostGenerationSnapshot()) === "legacy") return {
		kind: "plugin",
		plugin: PLUGIN_ID
	};
	return { kind: "dsh-context-compression" };
}
//#endregion
export { noteResolvedSettingsService as a, detectHostGeneration as i, viewToolResult as n, eventBySeq as o, compatLog as r, sessionEvents as s, compressionMessageSource as t };
