import { a as validatePublishedTailTrim, o as sessionEvents } from "./tail-trim.js";
//#region src/invariant.ts
const PACKAGE_NAME = "dsh-context-compression-improved-runtime";
/** Cordis companion plugin name. */
const name = "context-compression-selector-runtime-invariant";
/** Services required before the companion can register. */
const inject = ["invariants"];
/** Whether the next event claims the unresolved prune's replacement range. */
function resemblesCompanion(prune, event) {
	if (event.type !== "tool/result" && event.type !== "user/message" || typeof event.surfaceOp !== "object") return false;
	const sources = new Set(event.sourceEventSeqs ?? []);
	return event.surfaceOp.start === prune.data.shadowedRange.start && event.surfaceOp.end === prune.data.shadowedRange.end || prune.data.shadowedSeqs.some((seq) => sources.has(seq));
}
/** Validate one standard prune's immediately adjacent surface replacement. */
function validateCompanion(session, prune, event, fail) {
	if (event.type !== "tool/result" && event.type !== "user/message" || typeof event.surfaceOp !== "object") fail(`compaction/prune at seq ${prune.seq} must be immediately followed by a replacement surface event`);
	const { shadowedRange, shadowedSeqs } = prune.data;
	if (shadowedSeqs.length === 0 || shadowedSeqs[0] !== shadowedRange.start || shadowedSeqs.at(-1) !== shadowedRange.end) fail(`compaction/prune at seq ${prune.seq} has a shadowed range inconsistent with shadowedSeqs`);
	if (event.surfaceOp.start !== shadowedRange.start || event.surfaceOp.end !== shadowedRange.end) fail(`replacement at seq ${event.seq} does not replace compaction/prune range ${shadowedRange.start}-${shadowedRange.end}`);
	const sources = new Set(event.sourceEventSeqs ?? []);
	const missing = shadowedSeqs.filter((seq) => !sources.has(seq));
	if (missing.length > 0) fail(`replacement at seq ${event.seq} omits shadowed source seqs ${missing.join(", ")}`);
	if (event.type === "user/message" && validatePublishedTailTrim(session, prune.seq) === null) fail(`TailTrim publication at seq ${prune.seq} is invalid`);
}
/** Validate a replayed log and return its only legal unresolved tail. */
function seedPending(session, fail) {
	let pending;
	for (const event of sessionEvents(session)) {
		if (pending !== void 0) {
			if (resemblesCompanion(pending, event)) validateCompanion(session, pending, event, fail);
			pending = void 0;
		}
		if (event.type === "compaction/prune") pending = event;
	}
	return pending;
}
/** Install adjacency checks with pre-commit staging. */
const install = Object.assign((ctx, fail) => {
	const pending = /* @__PURE__ */ new WeakMap();
	const staged = /* @__PURE__ */ new WeakMap();
	const seed = (session) => {
		pending.set(session, seedPending(session, fail));
	};
	const current = (session) => {
		if (!pending.has(session)) seed(session);
		return pending.get(session);
	};
	for (const session of ctx.sessions.list()) seed(session);
	ctx.on("session/created", seed, { global: true });
	ctx.on("internal/dispatch", (_mode, eventName, args) => {
		if (eventName !== "session/event") return;
		const [session, event] = args;
		const open = current(session);
		if (open !== void 0 && resemblesCompanion(open, event)) validateCompanion(session, open, event, fail);
		staged.set(event, {
			session,
			next: event.type === "compaction/prune" ? event : void 0
		});
	}, { global: true });
	ctx.on("session/event", (session, event) => {
		const candidate = staged.get(event);
		if (candidate === void 0 || candidate.session !== session) return fail("session/event reached publication without matching pre-commit validation");
		staged.delete(event);
		pending.set(session, candidate.next);
	}, { global: true });
}, { inject: ["sessions"] });
/** Register this package's invariant companion. */
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
