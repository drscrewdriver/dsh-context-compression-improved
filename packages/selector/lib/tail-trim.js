import { createUserMessage } from "@deepseek-ai/dsh-llm";
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
	return typeof snapshot === "function" ? snapshot.call(session) : session.events;
}
//#endregion
//#region src/runtime/tail-trim.ts
/** Plugin-owned TailTrim publication protocol over official Session events. */
const TAIL_TRIM_REF_PATTERN = /^session:\/\/([^/]+)\/tailtrim\/(\d+)$/;
const MAX_ROOTS = 64;
const MAX_STUB_CODE_POINTS = 1024;
/** Build a same-session reference keyed by the standard prune event. */
function tailTrimRef(sessionId, manifestSeq) {
	return `session://${sessionId}/tailtrim/${String(manifestSeq)}`;
}
/** Parse one exact TailTrim reference. */
function parseTailTrimRef(ref) {
	const match = TAIL_TRIM_REF_PATTERN.exec(ref);
	if (match === null) return null;
	const manifestSeq = Number(match[2]);
	if (!Number.isSafeInteger(manifestSeq) || manifestSeq < 0) return null;
	return {
		sessionId: match[1] ?? "",
		manifestSeq
	};
}
/** Build the fixed bounded model-visible TailTrim stub. */
function tailTrimStub(ref, toolNames, sourceEventSeqs) {
	const stub = [
		"[TailTrim: completed tool-call group]",
		`ref: ${ref}`,
		`tools: ${toolNames.join(", ")}`,
		`source_event_seqs: ${sourceEventSeqs.join(", ")}`,
		"use context_compression_retrieve with this TailTrim ref if needed"
	].join("\n");
	return Array.from(stub).length <= MAX_STUB_CODE_POINTS ? stub : null;
}
/** Wrap a TailTrim stub in the one user message used for range replacement. */
function tailTrimMessage(stub) {
	return createUserMessage({
		content: [{
			type: "text",
			text: stub
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-context-compression-improved-runtime"
		}
	});
}
/** Validate the standard prune, adjacent replacement, append roots and stub. */
function validatePublishedTailTrim(session, manifestSeq) {
	const events = sessionEvents(session);
	const manifest = events[manifestSeq];
	if (manifest?.type !== "compaction/prune" || manifest.data.shadowedSeqs.length < 2 || manifest.data.shadowedSeqs.length > MAX_ROOTS || manifest.data.shadowedSeqs[0] !== manifest.data.shadowedRange.start || manifest.data.shadowedSeqs.at(-1) !== manifest.data.shadowedRange.end || new Set(manifest.data.shadowedSeqs).size !== manifest.data.shadowedSeqs.length) return null;
	const replacement = events[manifestSeq + 1];
	if (replacement?.type !== "user/message" || replacement.seq !== manifest.seq + 1 || replacement.data.source.kind !== "plugin" || replacement.data.source.plugin !== "dsh-context-compression-improved-runtime" || replacement.surfaceOp === void 0 || replacement.surfaceOp === "append" || replacement.surfaceOp.start !== manifest.data.shadowedRange.start || replacement.surfaceOp.end !== manifest.data.shadowedRange.end || !sameNumbers(replacement.sourceEventSeqs, [manifest.seq, ...manifest.data.shadowedSeqs]) || replacement.data.content.length !== 1 || replacement.data.content[0]?.type !== "text") return null;
	const tracedRoots = manifest.data.shadowedSeqs.map((seq) => uniqueAppendRoot(session, seq, manifestSeq));
	if (tracedRoots.some((root) => root === null)) return null;
	const sourceEventSeqs = tracedRoots;
	if (new Set(sourceEventSeqs).size !== sourceEventSeqs.length) return null;
	const roots = sourceEventSeqs.map((seq) => events[seq]);
	if (roots.some((event) => event === void 0)) return null;
	const typedRoots = roots;
	if (!validRootGroup(typedRoots, manifestSeq)) return null;
	const assistant = typedRoots[0];
	if (assistant?.type !== "assistant/message") return null;
	const toolNames = assistant.data.message.content.map((block) => {
		if (block.type !== "tool-call") throw new Error("unreachable");
		return block.name;
	});
	const ref = tailTrimRef(String(session.id), manifestSeq);
	const stub = tailTrimStub(ref, toolNames, sourceEventSeqs);
	if (stub === null || replacement.data.content[0].text !== stub) return null;
	return {
		manifest,
		replacement,
		roots: typedRoots,
		toolNames,
		ref,
		stub
	};
}
function uniqueAppendRoot(session, seq, beforeSeq) {
	const events = sessionEvents(session);
	const pending = [{
		seq,
		depth: 0
	}];
	const visited = /* @__PURE__ */ new Set();
	const roots = /* @__PURE__ */ new Set();
	while (pending.length > 0) {
		const next = pending.pop();
		if (next === void 0 || next.depth > MAX_ROOTS || visited.has(next.seq)) continue;
		if (!Number.isSafeInteger(next.seq) || next.seq < 0 || next.seq >= beforeSeq) return null;
		visited.add(next.seq);
		if (visited.size > MAX_ROOTS) return null;
		const event = events[next.seq];
		if (event === void 0 || event.type !== "assistant/message" && event.type !== "tool/result") return null;
		if (event.surfaceOp === "append") roots.add(event.seq);
		else if (typeof event.surfaceOp === "object") {
			const sources = event.sourceEventSeqs;
			if (sources === void 0 || sources.length === 0) return null;
			for (const source of sources) pending.push({
				seq: source,
				depth: next.depth + 1
			});
		} else return null;
		if (roots.size > 1) return null;
	}
	return roots.size === 1 ? [...roots][0] ?? null : null;
}
function validRootGroup(roots, manifestSeq) {
	const assistant = roots[0];
	if (assistant?.type !== "assistant/message" || assistant.seq >= manifestSeq || assistant.surfaceOp !== "append" || assistant.data.interrupted === true || assistant.data.message.content.length === 0 || assistant.data.message.content.some((block) => block.type !== "tool-call")) return false;
	const callIds = assistant.data.message.content.map((call) => call.id);
	if (new Set(callIds).size !== callIds.length || roots.length !== callIds.length + 1) return false;
	for (const [index, root] of roots.slice(1).entries()) {
		if (root.type !== "tool/result" || root.seq >= manifestSeq || root.surfaceOp !== "append") return false;
		if (root.data.message.content[0].isError === true || root.data.error !== void 0 || root.data.turn !== assistant.data.turn || root.data.step !== assistant.data.step || String(root.data.message.source.callId) !== String(callIds[index])) return false;
	}
	return true;
}
function sameNumbers(left, right) {
	return left !== void 0 && left.length === right.length && left.every((value, index) => value === right[index]);
}
//#endregion
export { validatePublishedTailTrim as a, tailTrimStub as i, tailTrimMessage as n, sessionEvents as o, tailTrimRef as r, parseTailTrimRef as t };
