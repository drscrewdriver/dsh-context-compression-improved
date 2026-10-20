import { C as resolveStatsDshHome, Ct as getAdvisorState, Et as getSummaryOverride, G as ContextCompressionSettingsSchema, It as resolveOfficialDeepSeekPrice, Lt as getSavingsLedger, Mt as setSummaryOverride, S as statsPersistenceState, Tt as getObservedIntentEnabled, W as CONTEXT_COMPRESSION_SETTINGS_NAMESPACE, _t as isSessionOverrideAction, a as getStatsBackfillStatus, b as ensureStatsStore, bt as INTENT_GATE_FLOOR_FRACTION, c as pauseStatsBackfill, dt as decodeSessionLogBytes, ft as deepSeekV4TokenizerForModel, gt as estimateSavingsPricing, h as getStatsActiveSessionId, ht as drsTotalsFragment, i as discoverBackfillSessionLogs, l as resumeStatsBackfill, mt as buildMonitorSnapshot, p as flushPendingUsageNow, pt as applySessionOverride, q as DEFAULT_CONTEXT_COMPRESSION_SETTINGS, r as configureStatsBackfillTrigger, s as kickStatsBackfillOnRouteHit, t as estimateIntegralMoney, u as cancelPendingUsageFlushes, ut as unavailableTokenCount, vt as mergeCompositionByComponent, wt as getLastIntentFold, x as getStatsStore, xt as INTENT_GATE_GROWTH_TOKENS, y as closeStatsStore } from "./savings-integral.js";
import { a as noteResolvedSettingsService, i as detectHostGeneration, r as compatLog } from "./tool-result.js";
import z from "@deepseek-ai/schemastery";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chmod, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
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
//#region src/runtime/savings-verify.ts
/**
* /ccip verify 验算核心:按会话 jsonl 原文独立重算节省六值,与持久 claims 对账。
*
* 口径纪律(用户定标):长度 = DeepSeek V4 词表 token,不是字符;tokenizer 资产
* 不可用时报 unavailable 退化 chars/4 并在 basis 如实标注,绝不冒充精确值。
* 索引:session uuid × turn/step × token 长度(原始事件与替换事件成对)。
* 公式:毛 = a−b(原文−替换);全文读回时净 = −b(foldRecall a−(b+R) 下限);
* 没有小裁剪 = 0。投影核心与 live 路径同一引擎(projectSavingsCore)。
* 只读纪律:与回填同款,绝不写会话文件。
*
* @module dsh-context-compression-improved/runtime/savings-verify
*/
const CHARS_PER_TOKEN = 4;
/** 投影库目录:与 DRS 插件同约定(env DSH_REFERENCE_SESSION_COLLECTOR_DIR > ~/.dsh-reference-session-collector)。 */
function resolveDrsIndexDir(env = process.env) {
	const fromEnv = env["DSH_REFERENCE_SESSION_COLLECTOR_DIR"];
	return fromEnv !== void 0 && fromEnv !== "" ? fromEnv : join(homedir(), ".dsh-reference-session-collector");
}
/**
* 只读探一个会话的 DRS 投影对账值。纪律:DatabaseSync 只读打开,绝不写;
* 库缺席/表不在/该会话未同步(无 sessions 行)一律 undefined,绝不抛——
* DRS 未装/未同步时 verify 如实降级为无此行,不冒充数据。
*/
function readDrsProjectionTotals(input) {
	let db;
	try {
		db = new DatabaseSync(join(input.indexDir ?? resolveDrsIndexDir(), "projection.db"), { readOnly: true });
	} catch {
		return;
	}
	try {
		const session = db.prepare("SELECT basis, synced_at FROM sessions WHERE session_id = ?").get(input.sessionId);
		if (session === void 0) return void 0;
		const agg = db.prepare(`SELECT
         COALESCE(SUM(CASE WHEN kind <> 'recall' AND live = 1 THEN a_tokens - b_tokens END), 0) AS gross_saved,
         COALESCE(SUM(CASE WHEN kind = 'recall' THEN b_tokens END), 0) AS recall_tokens,
         COALESCE(SUM(CASE WHEN kind <> 'recall' THEN 1 ELSE 0 END), 0) AS compress_pairs,
         COALESCE(SUM(CASE WHEN kind = 'recall' THEN 1 ELSE 0 END), 0) AS recall_pairs
       FROM replaces WHERE session_id = ?`).get(input.sessionId);
		const grossSaved = typeof agg.gross_saved === "number" ? agg.gross_saved : Number(agg.gross_saved ?? 0);
		const recallTokens = typeof agg.recall_tokens === "number" ? agg.recall_tokens : Number(agg.recall_tokens ?? 0);
		return {
			grossSaved,
			recallTokens,
			net: grossSaved - recallTokens,
			compressPairs: Number(agg.compress_pairs ?? 0),
			recallPairs: Number(agg.recall_pairs ?? 0),
			basis: typeof session.basis === "string" && session.basis !== "" ? session.basis : "chars/4",
			syncedAt: typeof session.synced_at === "string" ? session.synced_at : "?"
		};
	} catch {
		return;
	} finally {
		db.close();
	}
}
/** chars/4 兜底计数器(tokenizer 资产缺席时的如实降级)。 */
function charsCounter() {
	return () => unavailableTokenCount("chars/4 fallback (tokenizer asset unavailable)");
}
/** 解析 DS V4 tokenizer:flash → pro 逐个试,全缺席返回 undefined。 */
function resolveDsTokenizer() {
	for (const modelId of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
		const tokenizer = deepSeekV4TokenizerForModel(modelId);
		if (tokenizer !== void 0) return (text) => tokenizer.countText(text);
	}
}
/**
* 单条事件的模型可见文本长度（DS token；富块按 0 计，与投影同款视界）。
* 双臂视界（horizon v4，与 DRS modelTextBlocks 同形）：data.message.content[]
* 缺席时退 data.content[]（user/message 与宿主 compact-checkpoint 替身形状；
* 旧单臂把 checkpoint 摘要全计 0，b 侧漏记）。
*/
function eventTextTokens(event, counter) {
	const data = event.data;
	const messageContent = data?.message?.content;
	const content = Array.isArray(messageContent) ? messageContent : Array.isArray(data?.content) ? data.content : void 0;
	if (!Array.isArray(content)) return 0;
	let total = 0;
	for (const block of content) {
		const text = block?.text;
		if (typeof text === "string" && text !== "") {
			const count = counter(text);
			if (count.kind === "exact-tokenizer") total += count.tokens;
			else total += Math.ceil(text.length / CHARS_PER_TOKEN);
		}
	}
	return total;
}
/** 从目录发现里找目标会话的当前代产物并解码(只读)。 */
function readTargetSessionEvents(dshHome, sessionId) {
	const found = discoverBackfillSessionLogs(dshHome).find((entry) => entry.dirSessionId === sessionId);
	if (found === void 0) return void 0;
	try {
		return decodeSessionLogBytes(readFileSync(found.artifact.path)).events;
	} catch {
		return;
	}
}
/**
* 直读一个会话的 DRS 结构索引(T6 深接:CCI 取 turn/step 结构与 token 量的
* 主源)。纪律同 {@link readDrsProjectionTotals}:只读、库/会话缺席一律
* undefined 绝不抛,调用方落 jsonl 兜底。
*/
function readDrsSessionIndex(input) {
	let db;
	try {
		db = new DatabaseSync(join(input.indexDir ?? resolveDrsIndexDir(), "projection.db"), { readOnly: true });
	} catch {
		return;
	}
	try {
		const session = db.prepare("SELECT basis, synced_at, max_seq, turn_count FROM sessions WHERE session_id = ?").get(input.sessionId);
		if (session === void 0) return void 0;
		const turnRows = db.prepare(`SELECT turn, COUNT(DISTINCT step) AS steps, SUM(tokens) AS tokens, COUNT(*) AS segments
       FROM segments WHERE session_id = ? GROUP BY turn ORDER BY turn`).all(input.sessionId);
		const pairRows = db.prepare("SELECT seq, start_seq, end_seq, a_tokens, b_tokens, kind, turn, step, live FROM replaces WHERE session_id = ? ORDER BY seq").all(input.sessionId);
		const num = (value) => typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : 0;
		return {
			sessionId: input.sessionId,
			basis: typeof session.basis === "string" && session.basis !== "" ? session.basis : "chars/4",
			syncedAt: typeof session.synced_at === "string" ? session.synced_at : "?",
			maxSeq: num(session.max_seq),
			turnCount: num(session.turn_count),
			segments: turnRows.reduce((sum, row) => sum + num(row.segments), 0),
			turns: turnRows.map((row) => ({
				turn: num(row.turn),
				steps: num(row.steps),
				tokens: num(row.tokens),
				segments: num(row.segments)
			})),
			pairs: pairRows.map((row) => ({
				seq: num(row.seq),
				startSeq: num(row.start_seq),
				endSeq: num(row.end_seq),
				aTokens: num(row.a_tokens),
				bTokens: num(row.b_tokens),
				kind: row.kind === "recall" ? "recall" : "compress",
				turn: num(row.turn),
				step: num(row.step),
				live: num(row.live) === 1 ? 1 : 0
			}))
		};
	} catch {
		return;
	} finally {
		db.close();
	}
}
/**
* 验算一个会话:jsonl 原文 × DS token 口径独立重算,与 claims 对账。
* @param input.sessionId - 显式指定;缺省 = 运行时活跃指针,再退 store 最近压缩。
*/
function verifySessionSavings(input = {}) {
	const store = getStatsStore();
	const source = input.sessionId !== void 0 ? "explicit" : getStatsActiveSessionId() !== void 0 ? "runtime-active" : "unresolved";
	const sessionId = input.sessionId ?? getStatsActiveSessionId() ?? store?.latestActiveSessionId();
	const empty = {
		sessionId,
		source,
		turns: 0,
		indexedEvents: 0,
		pairs: [],
		indexSource: "jsonl",
		formulaGross: 0,
		formulaOffsets: 0,
		formulaNet: 0,
		formulaBasis: "n/a",
		claimsGross: 0,
		claimsOffsets: 0,
		claimsNet: 0,
		claimsBasis: "n/a",
		verdict: sessionId === void 0 ? "no-session" : "no-jsonl"
	};
	if (sessionId === void 0) return empty;
	const drsIndex = readDrsSessionIndex({ sessionId });
	const pairs = [];
	let formulaGross = 0;
	let formulaOffsets = 0;
	let turns = 0;
	let indexedEvents;
	let formulaBasis;
	let indexSource;
	let turnStructure;
	let drsTotals;
	if (drsIndex !== void 0) {
		indexSource = "drs";
		formulaBasis = drsIndex.basis;
		turns = drsIndex.turnCount;
		indexedEvents = drsIndex.segments;
		turnStructure = drsIndex.turns;
		for (const pair of drsIndex.pairs) {
			pairs.push({
				turn: pair.turn,
				step: pair.step,
				seq: pair.seq,
				originalTokens: pair.aTokens,
				replacementTokens: pair.bTokens,
				gross: pair.aTokens - pair.bTokens
			});
			if (pair.kind === "compress") {
				if (pair.live === 1) formulaGross += pair.aTokens - pair.bTokens;
			} else formulaOffsets += pair.bTokens;
		}
		drsTotals = {
			grossSaved: formulaGross,
			recallTokens: formulaOffsets,
			net: formulaGross - formulaOffsets,
			compressPairs: drsIndex.pairs.filter((pair) => pair.kind === "compress").length,
			recallPairs: drsIndex.pairs.filter((pair) => pair.kind === "recall").length,
			basis: drsIndex.basis,
			syncedAt: drsIndex.syncedAt
		};
	} else {
		indexSource = "jsonl";
		const dshHome = resolveStatsDshHome(input);
		const events = existsSync(dshHome) ? readTargetSessionEvents(dshHome, sessionId) : void 0;
		if (events === void 0 || events.length === 0) return {
			...empty,
			verdict: "no-jsonl"
		};
		indexedEvents = events.length;
		const tokenizer = resolveDsTokenizer();
		const counter = tokenizer ?? charsCounter();
		formulaBasis = tokenizer !== void 0 ? "ds-token" : "chars/4";
		const tokensBySeq = /* @__PURE__ */ new Map();
		let turn = 0;
		let step = 0;
		for (const event of events) {
			const data = event.data;
			if (event.type === "step/start" && data !== void 0) {
				if (typeof data.turn === "number") turn = data.turn;
				if (typeof data.step === "number") step = data.step;
				turns = Math.max(turns, turn);
			}
			tokensBySeq.set(Number(event.seq), eventTextTokens(event, counter));
		}
		const covered = /* @__PURE__ */ new Set();
		const rawPairs = [];
		for (const event of events) {
			const op = event.surfaceOp;
			if (op === null || typeof op !== "object" || op.op !== "replace") continue;
			const start = Number(op.startSeq);
			const end = Number(op.endSeq);
			if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
			let a = 0;
			for (let seq = start; seq <= end; seq += 1) a += tokensBySeq.get(seq) ?? 0;
			const b = tokensBySeq.get(Number(event.seq)) ?? 0;
			rawPairs.push({
				seq: Number(event.seq),
				a,
				b
			});
			for (let seq = start; seq <= end; seq += 1) covered.add(seq);
		}
		for (const { seq, a, b } of rawPairs) {
			if (b <= a) {
				if (!covered.has(seq)) formulaGross += a - b;
			} else formulaOffsets += b;
			pairs.push({
				turn,
				step,
				seq,
				originalTokens: a,
				replacementTokens: b,
				gross: a - b
			});
		}
	}
	let claimsGross = 0;
	let claimsOffsets = 0;
	let claimsBasis = "n/a";
	if (store !== null) {
		const agg = store.perSessionAggregates().find((row) => row.sessionId === sessionId);
		if (agg !== void 0) {
			claimsGross = agg.gross.exact + agg.gross.estimated;
			claimsOffsets = agg.offsets.exact + agg.offsets.estimated;
			claimsBasis = agg.gross.exact > 0 ? "exact-tokenizer" : "chars/4";
		}
	}
	const drs = drsTotals ?? readDrsProjectionTotals({ sessionId });
	const verdict = claimsGross === 0 && claimsOffsets === 0 ? "no-claims" : formulaBasis === "chars/4" ? "cross-basis" : "match";
	return {
		sessionId,
		source,
		turns,
		indexedEvents,
		pairs,
		indexSource,
		formulaGross,
		formulaOffsets,
		formulaNet: formulaGross - formulaOffsets,
		formulaBasis,
		claimsGross,
		claimsOffsets,
		claimsNet: claimsGross - claimsOffsets,
		claimsBasis,
		...drs === void 0 ? {} : { drs },
		...turnStructure === void 0 ? {} : { turnStructure },
		verdict
	};
}
/** 验算报告 → /ccip 文本行(紧凑,面板命令直接回显)。 */
function formatVerifyReport(report) {
	if (report.verdict === "no-session") return ["ccip verify: no session to verify"];
	if (report.verdict === "no-jsonl") return [`ccip verify: session ${report.sessionId ?? "?"} jsonl not found/readable`];
	const lines = [
		`ccip verify ${report.sessionId ?? "?"} (${report.source})`,
		`index(${report.indexSource}): ${report.indexedEvents} events · ${report.turns} turns · ${report.pairs.length} replacement pair(s)`,
		...report.turnStructure === void 0 ? [] : [`drs turns: ${report.turnStructure.slice(0, 4).map((row) => `t${row.turn}·${row.tokens}tk·${row.steps}s`).join(" · ")}${report.turnStructure.length > 4 ? " · …" : ""}`],
		...report.pairs.slice(0, 6).map((row) => `  t${row.turn}/s${row.step} seq${row.seq}: a=${row.originalTokens} − b=${row.replacementTokens} = +${row.gross} (${report.formulaBasis})`),
		`formula(${report.formulaBasis}): gross=${report.formulaGross} recall-offset=${report.formulaOffsets} net=${report.formulaNet}`,
		`claims(${report.claimsBasis}): gross=${report.claimsGross} recall-offset=${report.claimsOffsets} net=${report.claimsNet}`,
		...report.drs === void 0 ? ["drs(projection): unavailable (projection.db absent or session not synced)"] : [`drs(projection): gross=${report.drs.grossSaved} recall-offset=${report.drs.recallTokens} net=${report.drs.net} (${report.drs.basis}, synced ${report.drs.syncedAt})`]
	];
	if (report.verdict === "no-claims") lines.push("verdict: claims empty for this session (nothing persisted yet)");
	else if (report.verdict === "cross-basis") lines.push("verdict: tokenizer unavailable — formula fell back to chars/4; compare basis-by-basis only");
	else {
		const drift = Math.abs(report.formulaGross - report.claimsGross);
		const tolerance = Math.max(8, Math.ceil(Math.max(report.formulaGross, 1) * .35));
		lines.push(drift <= tolerance ? `verdict: match (drift ${drift} within cross-basis tolerance ±${tolerance})` : `verdict: cross-basis drift ${drift} (ds-token vs ${report.claimsBasis}; different metrics, both shown)`);
	}
	return lines;
}
/** 面板命令入口:解析 + 执行 + 文本化。 */
function verifySessionSavingsLines(input = {}) {
	return formatVerifyReport(verifySessionSavings(input));
}
//#endregion
//#region src/runtime/summary-command.ts
const SUMMARY_COMMAND_NAME = "ctx-summary";
const USAGE$1 = "Usage: /ctx-summary off|on|status";
/** Parse the raw argument string; `undefined` = unrecognized (usage error). */
function parseSummaryCommandArgs(rawInput) {
	const token = rawInput.trim().toLowerCase();
	if (token === "off" || token === "on" || token === "status") return token;
}
function describeFold(sessionId) {
	const fold = getLastIntentFold(sessionId);
	if (fold === void 0) return "none";
	return `turn ${fold.turn}, seq ${fold.startSeq}..${fold.endSeq}`;
}
/** Human-facing status line; observability only, never a decision input. */
function formatSummaryStatus(sessionId) {
	const override = getSummaryOverride(sessionId);
	const enabled = getObservedIntentEnabled(sessionId);
	const enabledText = enabled === void 0 ? "unknown (gate not evaluated yet)" : enabled ? "yes" : "no";
	return [
		`ctx-summary status:`,
		`  override: ${override ?? "default (settings-driven)"}`,
		`  intentSummary enabled (settings): ${enabledText}`,
		`  gate: floor >${Math.round(INTENT_GATE_FLOOR_FRACTION * 100)}% of window AND growth >${INTENT_GATE_GROWTH_TOKENS} tokens since last fold`,
		`  last fold: ${describeFold(sessionId)}`
	].join("\n");
}
/** Resolve the invoking agent's session id (`''` when the host exposes none). */
function sessionIdOf(agent) {
	const session = agent?.session;
	if (session === void 0 || session.id === void 0 || session.id === null) return "";
	return String(session.id);
}
/** Best-effort `CommandDefinitionId` brand; `undefined` on stripped hosts (registered without it). */
async function loadCommandDefinitionId$1() {
	try {
		return (await import("@deepseek-ai/dsh-commands")).CommandDefinitionId;
	} catch {
		return;
	}
}
/**
* Mount `/ctx-summary` for every composed human-command adapter. Never
* throws: the command is a convenience surface, and a host without the
* commands service (or with an incompatible registry shape) simply runs
* without it.
*/
function registerSummaryCommand(ctx) {
	ctx.inject(["commands"], (injected) => {
		const commands = injected.commands;
		if (commands === void 0 || typeof commands.register !== "function") return;
		(async () => {
			try {
				const definitionId = await loadCommandDefinitionId$1();
				await commands.register({
					name: SUMMARY_COMMAND_NAME,
					description: "Turn-tail intent summary: temporarily disable/resume or inspect status",
					...definitionId === void 0 ? {} : { definitionId: definitionId("dsh-context-compression-improved/ctx-summary") },
					handler: async (invocation) => {
						const args = parseSummaryCommandArgs(typeof invocation.rawInput === "string" ? invocation.rawInput : "");
						if (args === void 0) return {
							kind: "error",
							text: USAGE$1
						};
						const sessionId = sessionIdOf(invocation.agent);
						if (args === "status") {
							if (sessionId === "") return {
								kind: "error",
								text: "ctx-summary: no session is attached to this invocation"
							};
							return {
								kind: "success",
								text: formatSummaryStatus(sessionId)
							};
						}
						if (sessionId === "") return {
							kind: "error",
							text: "ctx-summary: no session is attached to this invocation"
						};
						setSummaryOverride(sessionId, args);
						return {
							kind: "success",
							text: args === "off" ? "ctx-summary: turn-tail intent summary paused for this session (until process restart or `/ctx-summary on`)" : "ctx-summary: turn-tail intent summary resumed for this session (numeric gates still apply)"
						};
					}
				});
			} catch {}
		})();
	});
}
//#endregion
//#region src/compat/settings-lease.ts
const SHARED_LEASE = Symbol.for("dsh-context-compression-improved/settings-lease");
/**
* Lease the namespace. No-op on modern hosts (register absent). Returns a
* read/update face; both are undefined-safe on modern hosts so callers can
* hold the face unconditionally and stay on the entry-config path there.
*/
function acquireSettingsLease(ctx, namespace, schema) {
	const settings = ctx.settings;
	if (settings === void 0 || typeof settings.register !== "function") return {
		get: () => void 0,
		update: async () => false
	};
	const owner = { settings };
	let shared = settings[SHARED_LEASE];
	if (shared === void 0) {
		shared = {
			owners: /* @__PURE__ */ new Set(),
			registrationOwner: owner
		};
		Object.defineProperty(settings, SHARED_LEASE, {
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
			next.settings.register(namespace, schema);
		}
		if (state.owners.size === 0 && settings[SHARED_LEASE] === state) Reflect.deleteProperty(settings, SHARED_LEASE);
	}, "contextCompressionSelector.settingsLease()");
	if (state.owners.size === 1) settings.register(namespace, schema);
	return {
		get: () => {
			try {
				return settings.get?.(namespace);
			} catch {
				return;
			}
		},
		update: async (patch) => {
			try {
				await settings.update?.(namespace, patch);
				return true;
			} catch {
				return false;
			}
		}
	};
}
//#endregion
//#region src/settings-bridge.ts
const ENTRY_ID = "context-compression-improved-bundle";
/** Hand back the service itself — the host reads route tables off `this`. */
function asWebServer$1(value) {
	if (typeof value !== "object" || value === null) return void 0;
	return typeof value.register === "function" ? value : void 0;
}
function jsonResponse$1(res, status, body) {
	const typed = res;
	if (typeof typed?.writeHead !== "function" || typeof typed?.end !== "function") return;
	typed.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-cache"
	});
	typed.end(JSON.stringify(body));
}
/** Modern-host read: the entry config descriptor's resolved value (pruner parity). */
function readEntryDoc(settings) {
	const host = settings;
	try {
		const described = host?.describe?.().find((d) => String(d.ns) === ENTRY_ID)?.value;
		if (described !== void 0) {
			const record = described;
			return record !== null && typeof record === "object" && "settings" in record ? record.settings : described;
		}
	} catch {}
}
function wireSettingsBridge(ctx) {
	const log = compatLog(ctx, "warn");
	let generation = detectHostGeneration(ctx);
	let lease;
	try {
		ctx.inject(["settings"], (settingsCtx) => {
			lease = acquireSettingsLease(settingsCtx, CONTEXT_COMPRESSION_SETTINGS_NAMESPACE, ContextCompressionSettingsSchema);
			const svc = settingsCtx.settings;
			generation = noteResolvedSettingsService(svc);
			compatLog(ctx, "info")(`settings service resolved, generation=${generation}`);
		});
	} catch (error) {
		log("settings lease wiring failed:", error);
	}
	const readDoc = () => {
		const settings = (() => {
			try {
				return ctx.get("settings");
			} catch {
				return;
			}
		})();
		if (generation === "legacy") return lease?.get() ?? settings?.get?.("context-compression");
		return readEntryDoc(settings) ?? settings?.get?.("context-compression");
	};
	const handleGet = (_req, res) => {
		jsonResponse$1(res, 200, {
			ok: true,
			doc: readDoc() ?? null,
			generation
		});
	};
	const handlePost = (req, res) => {
		if (generation !== "legacy" || lease === void 0) {
			jsonResponse$1(res, 409, {
				ok: false,
				error: "modern-host: configForms is authoritative"
			});
			return;
		}
		const chunks = [];
		const typed = req;
		if (typeof typed?.on !== "function") {
			jsonResponse$1(res, 400, {
				ok: false,
				error: "unreadable request body"
			});
			return;
		}
		typed.on("data", (chunk) => {
			if (chunk) chunks.push(chunk);
		});
		typed.on("end", async () => {
			try {
				const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				if (parsed.doc === void 0 || parsed.doc === null || typeof parsed.doc !== "object") {
					jsonResponse$1(res, 400, {
						ok: false,
						error: "doc must be an object"
					});
					return;
				}
				if (!await lease.update(parsed.doc)) {
					jsonResponse$1(res, 502, {
						ok: false,
						error: "settings update rejected by host"
					});
					return;
				}
				jsonResponse$1(res, 200, {
					ok: true,
					doc: parsed.doc
				});
			} catch (error) {
				jsonResponse$1(res, 500, {
					ok: false,
					error: String(error?.message ?? error)
				});
			}
		});
	};
	let registered = false;
	const register = (webServer, channel) => {
		if (registered) return;
		try {
			const disposers = [`/endpoint/dsh-context-compression-improved/settings`, `/api/dsh-context-compression-improved/settings`].map((path) => webServer.register({
				kind: "exact",
				path,
				handler: (req, res) => {
					if (String(req?.method ?? "GET").toUpperCase() === "POST") return handlePost(req, res);
					return handleGet(req, res);
				}
			})).filter((off) => typeof off === "function");
			registered = true;
			ctx.effect(() => () => {
				for (const off of disposers) off();
			}, "contextCompressionSelector.settings bridge route");
			compatLog(ctx, "info")(`settings bridge registered (${channel}), generation=${generation}`);
		} catch (error) {
			log("settings bridge registration failed:", error);
		}
	};
	const active = asWebServer$1((() => {
		try {
			return ctx.get("webServer");
		} catch {
			return;
		}
	})());
	if (active !== void 0) {
		register(active, "direct");
		if (registered) return;
	}
	ctx.inject(["webServer"], (injected) => {
		const webServer = asWebServer$1(injected.webServer);
		if (webServer === void 0) return;
		register(webServer, "inject");
	});
}
//#endregion
//#region src/runtime/display-prefs.ts
/**
* 面板显示偏好（spec T30）——`/ccip` 命令与 `/savings/sessions` 载荷共享的
* 进程级状态，meta 表持久（跨重启恢复）。
*
* 设计：
*  - 运行时单份内存状态，首次读取时从 stats meta 延迟加载（store 缺席 = 纯
*    内存默认值，可见降级语义下偏好只是不持久，功能不受损）；
*  - 写入走校验器（行开关布尔、mode 枚举、focusSessionId ≤512 或 null），
*    非法输入静默忽略该字段——显示偏好绝不抛错打扰命令面；
*  - session 级设置是冻结语义（savings.ts 惯例），面板偏好是进程级运行时
*    状态（summary-command.ts 同款理由：实时开关无法走冻结设置）。
*
* @module dsh-context-compression-improved/runtime/display-prefs
*/
const META_KEY = "displayPrefs";
const DEFAULTS = {
	rows: {
		stock: true,
		total: true,
		money: true
	},
	mode: "full",
	focusSessionId: null
};
let current;
function cloneDefaults() {
	return {
		rows: { ...DEFAULTS.rows },
		mode: DEFAULTS.mode,
		focusSessionId: DEFAULTS.focusSessionId
	};
}
function parsePrefs(raw) {
	if (typeof raw !== "string" || raw === "") return cloneDefaults();
	try {
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object") return cloneDefaults();
		const prefs = cloneDefaults();
		if (parsed.rows !== void 0 && typeof parsed.rows === "object" && parsed.rows !== null) for (const key of [
			"stock",
			"total",
			"money"
		]) {
			const value = parsed.rows[key];
			if (typeof value === "boolean") prefs.rows[key] = value;
		}
		if (parsed.mode === "full" || parsed.mode === "compact") prefs.mode = parsed.mode;
		if (parsed.focusSessionId === null) prefs.focusSessionId = null;
		else if (typeof parsed.focusSessionId === "string" && parsed.focusSessionId.length > 0 && parsed.focusSessionId.length <= 512) prefs.focusSessionId = parsed.focusSessionId;
		return prefs;
	} catch {
		return cloneDefaults();
	}
}
/** 当前偏好（首次调用从 meta 延迟加载；store 缺席 = 默认值）。 */
function getDisplayPrefs() {
	if (current === void 0) current = parsePrefs(getStatsStore()?.getMeta(META_KEY));
	return current;
}
/** 打补丁式更新：仅接受字段的合法值；成功即写 meta（store 缺席只改内存）。 */
function setDisplayPrefs(patch) {
	const prefs = getDisplayPrefs();
	if (patch.rows !== void 0 && typeof patch.rows === "object" && patch.rows !== null) for (const key of [
		"stock",
		"total",
		"money"
	]) {
		const value = patch.rows[key];
		if (typeof value === "boolean") prefs.rows[key] = value;
	}
	if (patch.mode === "full" || patch.mode === "compact") prefs.mode = patch.mode;
	if (patch.focusSessionId === null) prefs.focusSessionId = null;
	else if (typeof patch.focusSessionId === "string" && patch.focusSessionId.length > 0 && patch.focusSessionId.length <= 512) prefs.focusSessionId = patch.focusSessionId;
	try {
		getStatsStore()?.setMeta(META_KEY, JSON.stringify(prefs));
	} catch {}
	return prefs;
}
//#endregion
//#region src/runtime/panel-command.ts
const PANEL_COMMAND_NAME = "ccip";
const USAGE = [
	"Usage: /ccip <subcommand>",
	"  status",
	"  rows stock|total|money on|off",
	"  mode compact|full",
	"  session <id|latest|off>",
	"  flush",
	"  backfill pause|resume|status"
].join("\n");
/** 解析原始参数串；undefined = 无法识别（回 usage）。 */
function parsePanelCommandArgs(rawInput) {
	const tokens = rawInput.trim().toLowerCase().split(/\s+/u).filter((token) => token !== "");
	if (tokens.length === 0) return void 0;
	const [head, ...rest] = tokens;
	if (head === "status" && rest.length === 0) return { op: "status" };
	if (head === "flush" && rest.length === 0) return { op: "flush" };
	if (head === "rows" && rest.length === 2) {
		const row = rest[0];
		const on = rest[1];
		if ((row === "stock" || row === "total" || row === "money") && (on === "on" || on === "off")) return {
			op: "rows",
			row,
			on: on === "on"
		};
		return;
	}
	if (head === "mode" && rest.length === 1 && (rest[0] === "compact" || rest[0] === "full")) return {
		op: "mode",
		mode: rest[0]
	};
	if (head === "session" && rest.length === 1) {
		const target = rest[0];
		if (target === void 0) return void 0;
		if (target === "off") return {
			op: "session",
			target: { kind: "off" }
		};
		if (target === "latest") return {
			op: "session",
			target: { kind: "latest" }
		};
		if (target.length <= 512) return {
			op: "session",
			target: {
				kind: "id",
				id: target
			}
		};
		return;
	}
	if (head === "backfill" && rest.length === 1 && (rest[0] === "pause" || rest[0] === "resume" || rest[0] === "status")) return {
		op: "backfill",
		action: rest[0]
	};
	if (head === "verify" && rest.length <= 1) {
		const target = rest[0];
		if (target === void 0 || target === "latest") return { op: "verify" };
		if (target.length <= 512) return {
			op: "verify",
			sessionId: target
		};
		return;
	}
}
function persistedLine() {
	const state = statsPersistenceState();
	return state.persisted ? `persisted: yes (${state.driver})` : `persisted: no (${state.reason})`;
}
function backfillLine() {
	const status = getStatsBackfillStatus();
	const summary = status.lastSummary === void 0 ? "no pass yet" : `${status.lastSummary.backend}: sessions=${String(status.lastSummary.sessions)} claims+${String(status.lastSummary.claimsAdded)}`;
	return `backfill: ${status.paused ? "paused" : status.running ? "running" : "idle"}, runs=${String(status.runs)}, last ${summary}`;
}
function formatStatus() {
	const prefs = getDisplayPrefs();
	return [
		"ccip status:",
		`  rows: stock=${prefs.rows.stock ? "on" : "off"} total=${prefs.rows.total ? "on" : "off"} money=${prefs.rows.money ? "on" : "off"}`,
		`  mode: ${prefs.mode}`,
		`  focus session: ${prefs.focusSessionId ?? "off"}`,
		`  ${persistedLine()}`,
		`  ${backfillLine()}`
	].join("\n");
}
/** `/ccip` 无会话依赖（与 /ctx-summary 不同：面板偏好是进程级而非会话级）。 */
function executePanelCommand(args) {
	switch (args.op) {
		case "status": return {
			kind: "success",
			text: formatStatus()
		};
		case "rows": {
			const prefs = setDisplayPrefs({ rows: { [args.row]: args.on } });
			return {
				kind: "success",
				text: `ccip: ${args.row} row ${args.on ? "on" : "off"} (stock=${String(prefs.rows.stock)} total=${String(prefs.rows.total)} money=${String(prefs.rows.money)})`
			};
		}
		case "mode":
			setDisplayPrefs({ mode: args.mode });
			return {
				kind: "success",
				text: `ccip: panel mode ${args.mode}`
			};
		case "session": {
			if (args.target.kind === "off") {
				setDisplayPrefs({ focusSessionId: null });
				return {
					kind: "success",
					text: "ccip: panel focus off"
				};
			}
			if (args.target.kind === "id") {
				setDisplayPrefs({ focusSessionId: args.target.id });
				return {
					kind: "success",
					text: `ccip: panel focus ${args.target.id}`
				};
			}
			const latest = getStatsStore()?.recentSessionIds(1)[0];
			if (latest === void 0) return {
				kind: "error",
				text: "ccip: no known session yet (stats store empty)"
			};
			setDisplayPrefs({ focusSessionId: latest.sessionId });
			return {
				kind: "success",
				text: `ccip: panel focus ${latest.sessionId} (latest)`
			};
		}
		case "flush":
			flushPendingUsageNow();
			return {
				kind: "success",
				text: "ccip: pending usage flushed to stats store"
			};
		case "backfill":
			if (args.action === "pause") {
				pauseStatsBackfill();
				return {
					kind: "success",
					text: "ccip: backfill paused"
				};
			}
			if (args.action === "resume") {
				resumeStatsBackfill();
				return {
					kind: "success",
					text: "ccip: backfill resumed"
				};
			}
			return {
				kind: "success",
				text: `ccip: ${backfillLine()}`
			};
		case "verify": return {
			kind: "success",
			text: args.sessionId === void 0 ? verifySessionSavingsLines().join("\n") : verifySessionSavingsLines({ sessionId: args.sessionId }).join("\n")
		};
	}
}
/** Best-effort `CommandDefinitionId` brand；stripped 宿主返回 undefined（不带 definitionId 注册）。 */
async function loadCommandDefinitionId() {
	try {
		return (await import("@deepseek-ai/dsh-commands")).CommandDefinitionId;
	} catch {
		return;
	}
}
/** 挂载 `/ccip`；永不抛错（无 commands 服务的宿主静默不挂载）。 */
function registerPanelCommand(ctx) {
	ctx.inject(["commands"], (injected) => {
		const commands = injected.commands;
		if (commands === void 0 || typeof commands.register !== "function") return;
		(async () => {
			try {
				const definitionId = await loadCommandDefinitionId();
				await commands.register({
					name: PANEL_COMMAND_NAME,
					description: "Context-compression panel: toggle rows/mode, focus a session, flush stats, pause backfill",
					...definitionId === void 0 ? {} : { definitionId: definitionId("dsh-context-compression-improved/ccip") },
					handler: async (invocation) => {
						const args = parsePanelCommandArgs(typeof invocation.rawInput === "string" ? invocation.rawInput : "");
						if (args === void 0) return {
							kind: "error",
							text: USAGE
						};
						return executePanelCommand(args);
					}
				});
			} catch {}
		})();
	});
}
//#endregion
//#region src/preset-overlay.ts
/** Plugin-owned, reversible compression overlays for native agent presets. */
/** Cordis 把未被代理的原始 service 暴露在该 symbol 下(见 cordis createTraceable 的 get 陷阱)。 */
const CORDIS_ORIGINAL = Symbol.for("cordis.original");
/**
* 取得 Cordis traceable 代理背后的原始 service。原始对象是宿主内部调用
* (`this.resolveMountable → this.resolve`) 时的接收者;只有装饰它,压缩栈补丁才能
* 真正注入(实证:装饰代理/原型代理均失败)。
*/
function rawService(presets) {
	const raw = presets[CORDIS_ORIGINAL];
	return raw !== null && typeof raw === "object" ? raw : presets;
}
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
/**
* True for the filesystem errors a concurrent publish can raise on Windows:
* `MoveFileEx` reports a lost race — or a reader holding the destination open —
* as EPERM/EBUSY/EACCES, where POSIX `rename` simply replaces the destination.
*/
function isPublishRace(error) {
	const code = error?.code;
	return code === "EPERM" || code === "EBUSY" || code === "EACCES" || code === "EEXIST";
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
	"dsh-context-compression-improved-runtime",
	"dsh-context-compression-improved",
	"dsh-context-compression-improved/pruner"
]);
/**
* Resolve the three compression package entries once from this package.
* @returns Absolute entry paths for the canonical compression layer.
*/
function resolveCompressionModulePaths() {
	return {
		compactionBasic: modulePath("@deepseek-ai/dsh-compaction-basic", import.meta.resolve("@deepseek-ai/dsh-compaction-basic")),
		commandCompact: modulePath("@deepseek-ai/dsh-command-compact", import.meta.resolve("@deepseek-ai/dsh-command-compact")),
		toolResultPruner: modulePath("dsh-context-compression-improved/pruner", import.meta.resolve("dsh-context-compression-improved/pruner"))
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
			await this.publish(staging, path);
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
	/** In-flight publish chains, one per destination path. */
	publishChains = /* @__PURE__ */ new Map();
	/**
	* Publish one stamped staging file to its final path, serialized per path.
	*
	* POSIX `rename` replaces an existing destination atomically, so concurrent
	* composers of one identity are naturally idempotent there. Windows
	* `MoveFileEx` instead fails the loser of that race with EPERM/EBUSY, which
	* surfaced as `standingKeyFor()` throwing during concurrent composition.
	* Every composer of one identity writes identical bytes and re-derives the
	* same deterministic identity stamp, so a destination that already observes
	* this staging file's {mtimeMs, size} key IS the intended end state: confirm
	* it and treat the lost race as success. Every other outcome still throws, so
	* a silently reused generation stays forbidden, and the caller still removes
	* the staging file when this rejects.
	*/
	publish(staging, path) {
		const tracked = (this.publishChains.get(path) ?? Promise.resolve()).catch(() => void 0).then(async () => {
			try {
				await rename(staging, path);
				return;
			} catch (error) {
				if (!isPublishRace(error)) throw error;
				try {
					const intended = await this.metadataIo.read(staging);
					const published = await this.metadataIo.read(path);
					if (published.size === intended.size && Math.abs(published.mtimeMs - intended.mtimeMs) < 2) {
						await rm(staging, { force: true });
						return;
					}
				} catch {}
				throw error;
			}
		}).finally(() => {
			if (this.publishChains.get(path) === tracked) this.publishChains.delete(path);
		});
		this.publishChains.set(path, tracked);
		return tracked;
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
/** Read a definition's preset id when the shape is a plain object. */
function readDefinitionId(definition) {
	if (typeof definition !== "object" || definition === null) return void 0;
	const id = definition.id;
	return typeof id === "string" ? id : void 0;
}
/**
* Inject the canonical compression stack into one preset definition's rows.
*
* The 0.2.0 `dsh-agent-preset-registry` PRE-BUILDS a generation per definition
* (`activate` → `mountPreset(ctx, id, definition.plugins)`) and `mount` only
* `retain`s it; the composition never calls `resolve`. So the stack must land in
* the definition's own `plugins` before activation, not in a resolved preset
* file. Best-effort: a failed injection leaves the original rows untouched.
*/
function injectCompressionRows(definition, options, excluded) {
	const id = readDefinitionId(definition);
	if (id === void 0 || excluded.has(id)) return;
	const plugins = definition.plugins;
	if (!Array.isArray(plugins)) return;
	try {
		const thresholdPercent = options.autoCompactThresholdPercent?.();
		definition.plugins = applyEntryPatches(stripCompressionRows(plugins), [{ insert: compressionRowsBySpecifier(thresholdPercent) }], (message, ...args) => {
			throw new Error(renderPatchWarning(message, args));
		});
	} catch {}
}
/**
* The canonical compression stack addressed by BARE SPECIFIERS. The 0.2.0
* `dsh-agent-preset-registry` preset files declare this exact group by package
* name, and its loader resolves bare specifiers (`@deepseek-ai/...`,
* `dsh-context-compression-improved/pruner`) — absolute filesystem paths from
* {@link resolveCompressionModulePaths} are NOT accepted there (empirically:
* every injected row reports "never started").
*/
function compressionRowsBySpecifier(thresholdPercent) {
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
				name: "@deepseek-ai/dsh-compaction-basic",
				...thresholdPercent === void 0 ? {} : { config: {
					thresholdRatio: thresholdPercent / 100,
					retainRatio: .16
				} }
			},
			{
				id: "command-compact",
				name: "@deepseek-ai/dsh-command-compact"
			},
			{
				id: "tool-result-pruner",
				name: "dsh-context-compression-improved/pruner",
				config: {
					headChars: 4096,
					tailChars: 1024,
					...thresholdPercent === void 0 ? {} : { autoCompactThresholdPercent: thresholdPercent }
				}
			}
		]
	}];
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
	const raw = rawService(presets);
	const snapshots = snapshotMethods(presets);
	const resolveSnapshot = snapshotFor(snapshots, "resolve");
	const resolveWrapped = async (id) => {
		const preset = await Reflect.apply(resolveSnapshot.original, raw, [id]);
		if (!(operations.getStore()?.composing === true) || excluded.has(preset.id)) return preset;
		return await store.overlay(preset);
	};
	installMethod(resolveSnapshot, resolveWrapped);
	for (const method of [
		"mount",
		"recompose",
		"standingKeyFor"
	]) {
		const snapshot = snapshots.find((candidate) => candidate.name === method);
		if (snapshot === void 0) continue;
		const wrapped = (...args) => {
			return operations.run({ composing: true }, () => Reflect.apply(snapshot.original, raw, args));
		};
		installMethod(snapshot, wrapped);
	}
	const registerSnapshot = snapshots.find((candidate) => candidate.name === "register");
	if (registerSnapshot !== void 0) {
		const registerWrapped = async (definition) => {
			injectCompressionRows(definition, options, excluded);
			return await Reflect.apply(registerSnapshot.original, raw, [definition]);
		};
		installMethod(registerSnapshot, registerWrapped);
	}
	let disposed = false;
	return { async dispose() {
		if (disposed) return;
		disposed = true;
		for (const snapshot of [...snapshots].reverse()) restoreMethod(snapshot);
		await store.dispose();
	} };
}
/** Capture callable methods and whether each was inherited or owned. */
function snapshotMethods(presets) {
	const methods = [];
	for (const name of [
		"resolve",
		"mount",
		"recompose",
		"standingKeyFor",
		"register"
	]) {
		const original = presets[name];
		if (typeof original !== "function") {
			if (name === "resolve") throw new TypeError(`context-compression selector: AgentPresets.${name} is unavailable`);
			continue;
		}
		const home = rawService(presets);
		methods.push({
			name,
			home,
			own: Object.getOwnPropertyDescriptor(home, name),
			original
		});
	}
	return methods;
}
/** Return the captured method or fail loudly if the snapshot set is corrupt. */
function snapshotFor(snapshots, name) {
	const snapshot = snapshots.find((candidate) => candidate.name === name);
	if (snapshot === void 0) throw new Error(`context-compression selector: missing method snapshot for ${name}`);
	return snapshot;
}
/** Install one own method while retaining its identity for safe disposal. */
function installMethod(snapshot, wrapped) {
	snapshot.wrapped = wrapped;
	Object.defineProperty(snapshot.home, snapshot.name, {
		configurable: true,
		writable: true,
		value: wrapped
	});
}
/** Restore the captured own/prototype state after the final shared lease. */
function restoreMethod(snapshot) {
	if (snapshot.own === void 0) Reflect.deleteProperty(snapshot.home, snapshot.name);
	else Object.defineProperty(snapshot.home, snapshot.name, snapshot.own);
}
//#endregion
//#region src/index.ts
const ESTIMATOR_CATALOG_ROUTES = ["/endpoint/dsh-context-compression-improved/estimator-catalog", "/api/dsh-context-compression-improved/estimator-catalog"];
const ADVISOR_REPORT_ROUTES = ["/endpoint/dsh-context-compression-improved/advisor-report", "/api/dsh-context-compression-improved/advisor-report"];
const SAVINGS_ROUTES = ["/endpoint/dsh-context-compression-improved/savings", "/api/dsh-context-compression-improved/savings"];
const MONITOR_ROUTES = ["/endpoint/dsh-context-compression-improved/monitor", "/api/dsh-context-compression-improved/monitor"];
const SAVINGS_SESSIONS_ROUTES = ["/endpoint/dsh-context-compression-improved/savings/sessions", "/api/dsh-context-compression-improved/savings/sessions"];
function sessionFor(readService, sessionId) {
	const agents = readService("agents");
	return typeof agents?.get === "function" ? agents.get(sessionId)?.session : void 0;
}
function jsonResponse(res, status, body) {
	const resTyped = res;
	resTyped.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-cache"
	});
	resTyped.end(JSON.stringify(body));
}
/**
* Serve the advisory advisor's read-only report route (same registration
* skeleton as the estimator-catalog route):
*
* `GET .../advisor-report?sessionId=…` → the session's prefix-decay figure,
* the todolist-bound task summary, and the score distribution. Content-free
* by construction: task semantics are LLM-derived summaries, never message
* text, and no score reason or candidate preview is ever returned.
* Unknown session → 404; no agents service → 503. A session whose advisor
* never ran reports nulls and empty arrays, not an error.
*/
function registerAdvisorReportRoute(ctx) {
	const readService = (name) => {
		try {
			return ctx.get(name);
		} catch {
			return;
		}
	};
	const log = (level, message, ...args) => {
		console[level](message, ...args);
	};
	const getHandler = (req, res) => {
		if (typeof readService("agents")?.get !== "function") {
			jsonResponse(res, 503, {
				ok: false,
				error: "advisor report unavailable"
			});
			return;
		}
		let sessionId = "";
		try {
			sessionId = new URL(String(req.url ?? ""), "http://localhost").searchParams.get("sessionId") ?? "";
		} catch {}
		if (sessionId === "") {
			jsonResponse(res, 400, {
				ok: false,
				error: "sessionId is required"
			});
			return;
		}
		const session = sessionFor(readService, sessionId);
		if (session === void 0) {
			jsonResponse(res, 404, {
				ok: false,
				error: "unknown session"
			});
			return;
		}
		const state = getAdvisorState(session);
		jsonResponse(res, 200, {
			ok: true,
			sessionId,
			advisor: {
				summary: state.summary ?? null,
				decay: state.lastDecay?.decay ?? null,
				weightedChars: state.lastDecay?.weightedChars ?? null,
				decayTurn: state.lastDecay?.turn ?? null,
				scores: [...state.scores].map(([seq, entry]) => ({
					seq,
					score: entry.score,
					turn: entry.turn
				})),
				lowRelevanceSeqs: [...state.recertified.keys()],
				lastAdvice: state.lastAdvice === void 0 ? null : {
					band: state.lastAdvice.band,
					turn: state.lastAdvice.turn,
					itemSeqs: state.lastAdvice.itemSeqs,
					recoveredTokens: state.lastAdvice.recoveredTokens,
					penaltyTokens: state.lastAdvice.penaltyTokens,
					paybackTurns: state.lastAdvice.paybackTurns ?? null
				}
			}
		});
	};
	const register = (webServer) => {
		const disposers = [...ADVISOR_REPORT_ROUTES].map((path) => ({
			path,
			handler: getHandler
		})).map((entry) => webServer.register({
			kind: "exact",
			path: entry.path,
			handler: entry.handler
		})).filter((off) => typeof off === "function");
		ctx.effect(() => () => {
			for (const off of disposers) off();
		}, "contextCompressionSelector.advisor report route");
		log("info", "context-compression advisor report route registered: %s", ADVISOR_REPORT_ROUTES.join(", "));
	};
	const active = asWebServer(readService("webServer"));
	if (active !== void 0) {
		register(active);
		return;
	}
	ctx.inject(["webServer"], (injected) => {
		const webServer = asWebServer(injected.webServer);
		if (webServer === void 0) {
			log("warn", "context-compression webServer exposes no register() — advisor report route not registered");
			return;
		}
		register(webServer);
	});
	log("warn", "context-compression webServer not active yet — advisor report route pending: %s", ADVISOR_REPORT_ROUTES.join(", "));
}
/**
* The one service the catalog route actually needs. `llm` and
* `agentDefaultModel` are payload enrichment the handler resolves per request,
* never reasons to withhold the route.
*/
const ESTIMATOR_CATALOG_ROUTE_DEPS = ["webServer"];
/** The estimator-side service the catalog handler enriches its response with. */
function asWebServer(value) {
	if (typeof value !== "object" || value === null) return void 0;
	return typeof value.register === "function" ? value : void 0;
}
/**
* `webServer.register` throws `duplicate exact route` when the same lib is
* mounted twice by the host (two plugin ids resolving to one module: the
* package-root manifest and the nested selector manifest). The other mount
* already owns every path in the batch, so the collision is a success from
* the plugin's point of view — without this, the losing arm logs a stack-
* heavy warn pair on every boot (observed 0.9.5 on 0.2.0-rc.2, savings and
* monitor).
*/
const isDuplicateRouteError = (error) => String(error?.message ?? error).includes("duplicate exact route");
/**
* Serve `GET /api/dsh-context-compression-improved/estimator-catalog` — the
* settings card's host-route dropdowns (live provider/model groups from the DSH
* `llm` service plus the effective selection). Best effort: without the
* `webServer` service the plugin keeps working, only the HTTP API is missing.
*
* The route gates on `webServer` **alone**. `llm` and `agentDefaultModel` only
* enrich the response and are resolved per request, so listing them here would
* let an estimator-side service the handler never needs keep the route
* unregistered. That failure is silent by construction — an unsatisfied
* `ctx.inject` callback never runs, so the plugin simply has no HTTP API and
* every request falls through to the host 404.
*
* Two channels cover the two arrival orders: a direct lookup catches a
* `webServer` that is already active when the plugin loads, and `ctx.inject`
* catches one that activates later. Both funnel into a single guarded
* registration, because a late-arriving service must not re-register a
* `(kind, path)` the host treats as a composition-contract violation.
*/
function registerEstimatorCatalogRoute(ctx) {
	const readService = (name) => {
		try {
			return ctx.get(name);
		} catch {
			return;
		}
	};
	const log = (level, message, ...args) => {
		console[level](message, ...args);
	};
	let registered = false;
	const register = (webServer, channel) => {
		if (registered) return;
		const handler = (_req, res) => {
			const resTyped = res;
			if (typeof resTyped?.writeHead !== "function" || typeof resTyped?.end !== "function") return;
			const llm = readService("llm");
			const defaults = readService("agentDefaultModel");
			buildEstimatorCatalog({
				...llm === void 0 ? {} : { llm },
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
		try {
			const disposers = ESTIMATOR_CATALOG_ROUTES.map((path) => webServer.register({
				kind: "exact",
				path,
				handler
			})).filter((off) => typeof off === "function");
			registered = true;
			ctx.effect(() => () => {
				for (const off of disposers) off();
			}, "contextCompressionSelector.estimator-catalog route");
			log("info", "context-compression estimator catalog route registered (%s): %s", channel, ESTIMATOR_CATALOG_ROUTES.join(", "));
		} catch (error) {
			if (isDuplicateRouteError(error)) {
				registered = true;
				log("info", "context-compression estimator catalog route already registered by another mount (%s)", channel);
				return;
			}
			log("warn", "context-compression estimator catalog route registration failed (%s): %o", channel, error);
		}
	};
	const active = asWebServer(readService("webServer"));
	if (active !== void 0) {
		register(active, "direct");
		if (registered) return;
	}
	ctx.inject([...ESTIMATOR_CATALOG_ROUTE_DEPS], (injected) => {
		const webServer = asWebServer(injected.webServer);
		if (webServer === void 0) {
			log("warn", "context-compression webServer exposes no register() — estimator catalog route not registered");
			return;
		}
		register(webServer, "inject");
	});
	log("warn", "context-compression webServer not active yet — estimator catalog route pending: %s", ESTIMATOR_CATALOG_ROUTES.join(", "));
}
/**
* Read-only savings snapshot route (`GET .../savings?sessionId=…`): gross saved,
* offsets (negative savings — compressed content later re-read in full), and net,
* with exact-tokenizer and chars/4 bases reported separately and never merged.
* Registration mirrors the estimator-catalog route (webServer gate alone, dual
* channels for both service arrival orders, single guarded registration).
*/
function registerSavingsRoute(ctx) {
	const readService = (name) => {
		try {
			return ctx.get(name);
		} catch {
			return;
		}
	};
	const log = (level, message, ...args) => {
		console[level](message, ...args);
	};
	let registered = false;
	const register = (webServer, channel) => {
		if (registered) return;
		const handler = (req, res) => {
			const resTyped = res;
			if (typeof resTyped?.writeHead !== "function" || typeof resTyped?.end !== "function") return;
			kickStatsBackfillOnRouteHit();
			let sessionId;
			try {
				const raw = new URL(String(req?.url ?? "/"), "http://localhost").searchParams.get("sessionId");
				if (typeof raw === "string" && raw.length > 0 && raw.length <= 512) sessionId = raw;
			} catch {}
			const snapshot = getSavingsLedger().snapshot(sessionId);
			const pricing = estimateSavingsPricing(readService, snapshot);
			resTyped.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-cache"
			});
			resTyped.end(JSON.stringify({
				ok: true,
				...snapshot,
				...pricing === void 0 ? {} : { pricing }
			}));
		};
		try {
			const disposers = SAVINGS_ROUTES.map((path) => webServer.register({
				kind: "exact",
				path,
				handler
			})).filter((off) => typeof off === "function");
			registered = true;
			ctx.effect(() => () => {
				for (const off of disposers) off();
			}, "contextCompressionSelector.savings route");
			log("info", "context-compression savings route registered (%s): %s", channel, SAVINGS_ROUTES.join(", "));
		} catch (error) {
			if (isDuplicateRouteError(error)) {
				registered = true;
				log("info", "context-compression savings route already registered by another mount (%s)", channel);
				return;
			}
			log("warn", "context-compression savings route registration failed (%s): %o", channel, error);
		}
	};
	const active = asWebServer(readService("webServer"));
	if (active !== void 0) {
		register(active, "direct");
		if (registered) return;
	}
	ctx.inject(["webServer"], (injected) => {
		const webServer = asWebServer(injected.webServer);
		if (webServer === void 0) {
			log("warn", "context-compression webServer exposes no register() — savings route not registered");
			return;
		}
		register(webServer, "inject");
	});
}
/**
* Per-session savings ledger route (`GET .../savings/sessions?offset=&limit=&sessionId=…`)
* — spec T24: paginated store aggregates ⊕ live residual merge + per-session
* integral (Σ samples: "累计按 N 次 call") + cache-weighted money estimate +
* persistence state and display prefs (T30) for `/ccip`'s real-time toggles.
* The frozen `/savings` and `/monitor` contracts are untouched; everything new
* lives on this endpoint only.
*/
function registerSavingsSessionsRoute(ctx) {
	const readService = (name) => {
		try {
			return ctx.get(name);
		} catch {
			return;
		}
	};
	const log = (level, message, ...args) => {
		console[level](message, ...args);
	};
	let registered = false;
	const register = (webServer, channel) => {
		if (registered) return;
		const handler = (req, res) => {
			const resTyped = res;
			if (typeof resTyped?.writeHead !== "function" || typeof resTyped?.end !== "function") return;
			kickStatsBackfillOnRouteHit();
			let offset = 0;
			let limit = 20;
			let sessionId;
			try {
				const url = new URL(String(req?.url ?? "/"), "http://localhost");
				const rawOffset = Number(url.searchParams.get("offset") ?? "0");
				if (Number.isFinite(rawOffset) && rawOffset >= 0) offset = Math.trunc(rawOffset);
				const rawLimit = Number(url.searchParams.get("limit") ?? "20");
				if (Number.isFinite(rawLimit)) limit = Math.min(100, Math.max(1, Math.trunc(rawLimit)));
				const raw = url.searchParams.get("sessionId");
				if (typeof raw === "string" && raw.length > 0 && raw.length <= 512) sessionId = raw;
			} catch {}
			const store = getStatsStore();
			const ledger = getSavingsLedger();
			const priceRecord = resolvePanelPriceRecord(readService);
			const buildRow = (agg) => {
				const integral = store === null ? {
					netExact: 0,
					netEstimated: 0,
					cachedInput: 0,
					uncachedInput: 0,
					calls: 0
				} : store.sumSamples(agg.sessionId);
				const money = priceRecord === void 0 || integral.calls === 0 ? void 0 : estimateIntegralMoney({
					cachedInput: integral.cachedInput,
					uncachedInput: integral.uncachedInput,
					record: priceRecord
				});
				const liveSnapshot = ledger.snapshot(agg.sessionId);
				return {
					sessionId: agg.sessionId,
					gross: agg.gross,
					offsets: agg.offsets,
					net: agg.net,
					source: store?.getSessionRecord(agg.sessionId)?.source ?? "live",
					integral,
					...money === void 0 ? {} : { money },
					liveStock: liveSnapshot.sessions === 1 ? liveSnapshot.net : void 0
				};
			};
			let total = 0;
			const sessions = [];
			if (store !== null) {
				const all = store.perSessionAggregates();
				const filtered = sessionId === void 0 ? all : all.filter((agg) => agg.sessionId === sessionId);
				total = filtered.length;
				for (const agg of filtered.slice(offset, offset + limit)) sessions.push(buildRow(agg));
			}
			const integralTotal = store === null ? {
				netExact: 0,
				netEstimated: 0,
				cachedInput: 0,
				uncachedInput: 0,
				calls: 0
			} : store.sumSamplesAll();
			const integralMoney = priceRecord === void 0 || integralTotal.calls === 0 ? void 0 : estimateIntegralMoney({
				cachedInput: integralTotal.cachedInput,
				uncachedInput: integralTotal.uncachedInput,
				record: priceRecord
			});
			const known = new Set(sessions.map((row) => row.sessionId));
			const liveOnly = ledger.snapshot(void 0).perSession.filter((row) => !known.has(row.sessionId) && (sessionId === void 0 || row.sessionId === sessionId)).map((row) => ({
				sessionId: row.sessionId,
				net: row.net,
				requests: row.requests,
				cacheHitRate: row.cacheHitRate
			}));
			resTyped.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-cache"
			});
			resTyped.end(JSON.stringify({
				ok: true,
				persisted: statsPersistenceState(),
				displayPrefs: getDisplayPrefs(),
				total,
				offset,
				limit,
				integralTotal,
				...integralMoney === void 0 ? {} : { integralMoney },
				sessions,
				liveOnly
			}));
		};
		try {
			const disposers = SAVINGS_SESSIONS_ROUTES.map((path) => webServer.register({
				kind: "exact",
				path,
				handler
			})).filter((off) => typeof off === "function");
			registered = true;
			ctx.effect(() => () => {
				for (const off of disposers) off();
			}, "contextCompressionSelector.savings sessions route");
			log("info", "context-compression savings sessions route registered (%s): %s", channel, SAVINGS_SESSIONS_ROUTES.join(", "));
		} catch (error) {
			if (isDuplicateRouteError(error)) {
				registered = true;
				log("info", "context-compression savings sessions route already registered by another mount (%s)", channel);
				return;
			}
			log("warn", "context-compression savings sessions route registration failed (%s): %o", channel, error);
		}
	};
	const active = asWebServer(readService("webServer"));
	if (active !== void 0) {
		register(active, "direct");
		if (registered) return;
	}
	ctx.inject(["webServer"], (injected) => {
		const webServer = asWebServer(injected.webServer);
		if (webServer === void 0) {
			log("warn", "context-compression webServer exposes no register() — savings sessions route not registered");
			return;
		}
		register(webServer, "inject");
	});
}
/** 官方 deepseek-official 路由的现行定价记录（/ccip 面板省钱加权用）；fail-closed。 */
function resolvePanelPriceRecord(readService) {
	const selection = readService("agentDefaultModel")?.currentSelection?.();
	const provider = typeof selection?.provider === "string" ? selection.provider : "";
	const modelId = typeof selection?.model === "string" ? selection.model : "";
	if (provider !== "deepseek-official") return void 0;
	const resolution = resolveOfficialDeepSeekPrice({
		provider,
		baseUrlClass: "official-public",
		apiRoute: "chat-completions",
		modelId,
		currency: "USD",
		at: /* @__PURE__ */ new Date()
	});
	return resolution.kind === "priced" ? resolution.record : void 0;
}
/**
* 浮窗统计块（/monitor 载荷附加字段，既有字段零改动）：只带最近压缩会话口径——
* 宿主不给"正在查看的会话"（输入栏注入只在页面加载时发生，切会话不重注入，
* 实测陈旧），所以服务端按 claims.at 最大者解析最近压缩会话并显式回带 id。
* 全部会话/生命周期的聚合刻意不上浮窗（设置页账本负责）。
* store 缺席 = 只剩 persisted，快照主结构不受影响。
*/
function monitorStatsBlock(viewSessionId) {
	const store = getStatsStore();
	if (store === null) return { persisted: statsPersistenceState() };
	const currentSessionId = viewSessionId ?? getStatsActiveSessionId() ?? store.latestActiveSessionId();
	const composition = currentSessionId === void 0 ? [] : mergeCompositionByComponent(store.sessionComponents(currentSessionId));
	const drsIndex = currentSessionId === void 0 ? void 0 : readDrsSessionIndex({ sessionId: currentSessionId });
	const drsFragment = drsIndex === void 0 ? void 0 : drsTotalsFragment(drsIndex);
	const sessionTotals = drsFragment?.sessionTotals;
	const lastDelta = drsFragment?.lastDelta;
	const hasLastDelta = lastDelta !== void 0 && (lastDelta.saving !== void 0 || lastDelta.offset !== void 0);
	return {
		persisted: statsPersistenceState(),
		...sessionTotals === void 0 ? {} : { sessionTotals: {
			gross: sessionTotals.gross,
			offsets: sessionTotals.offsets,
			net: sessionTotals.net
		} },
		...hasLastDelta ? { lastDelta } : {},
		...composition.length > 0 ? {
			composition,
			compositionSession: currentSessionId
		} : {}
	};
}
/**
* Floating-panel monitor route (`GET|POST .../monitor?sessionId=…`):
*  - GET → the monitor snapshot (savings aggregate + intent control block +
*    pricing) — the payload shape the panel polls;
*  - POST → session override action (`{"action":"on"|"off"|"clear"}`),
*    driving the exact state machine `/ctx-summary` drives.
* Registration mirrors the savings route (webServer gate alone, dual channels,
* single guarded registration); the handler branches on `req.method` because
* the registration surface is method-agnostic.
*/
/** Exported for the runtime monitor spec; the entry owns all webServer wiring. */
function registerMonitorRoute(ctx) {
	const readService = (name) => {
		try {
			return ctx.get(name);
		} catch {
			return;
		}
	};
	const log = (level, message, ...args) => {
		console[level](message, ...args);
	};
	let registered = false;
	const register = (webServer, channel) => {
		if (registered) return;
		const handler = (req, res) => {
			const resTyped = res;
			if (typeof resTyped?.writeHead !== "function" || typeof resTyped?.end !== "function") return;
			kickStatsBackfillOnRouteHit();
			let sessionId;
			try {
				const raw = new URL(String(req?.url ?? "/"), "http://localhost").searchParams.get("sessionId");
				if (typeof raw === "string" && raw.length > 0 && raw.length <= 512) sessionId = raw;
			} catch {}
			if (String(req?.method ?? "GET").toUpperCase() === "POST") {
				const chunks = [];
				let size = 0;
				let done = false;
				const respond = (status, body) => {
					if (done) return;
					done = true;
					resTyped.writeHead(status, {
						"content-type": "application/json; charset=utf-8",
						"cache-control": "no-cache"
					});
					resTyped.end(JSON.stringify(body));
				};
				const reqTyped = req;
				if (typeof reqTyped?.on !== "function") {
					respond(400, {
						ok: false,
						error: "unreadable request body"
					});
					return;
				}
				reqTyped.on("data", (chunk) => {
					size += chunk?.length ?? 0;
					if (size <= 4096) chunks.push(Buffer.from(chunk ?? /* @__PURE__ */ new Uint8Array()));
				});
				reqTyped.on("end", () => {
					let action;
					try {
						action = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}").action;
					} catch {
						respond(400, {
							ok: false,
							error: "monitor override action must be JSON"
						});
						return;
					}
					if (!isSessionOverrideAction(action)) {
						respond(400, {
							ok: false,
							error: "monitor override action must be \"on\" | \"off\" | \"clear\""
						});
						return;
					}
					const { override } = applySessionOverride(sessionId ?? "", action);
					respond(200, {
						ok: true,
						override: override ?? null,
						sessionScope: sessionId ?? null
					});
				});
				return;
			}
			const snapshot = buildMonitorSnapshot(sessionId);
			const pricing = estimateSavingsPricing(readService, snapshot);
			resTyped.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-cache"
			});
			resTyped.end(JSON.stringify({
				ok: true,
				...snapshot,
				...pricing === void 0 ? {} : { pricing },
				...monitorStatsBlock(sessionId)
			}));
		};
		try {
			const disposers = MONITOR_ROUTES.map((path) => webServer.register({
				kind: "exact",
				path,
				handler
			})).filter((off) => typeof off === "function");
			registered = true;
			ctx.effect(() => () => {
				for (const off of disposers) off();
			}, "contextCompressionSelector.monitor route");
			log("info", "context-compression monitor route registered (%s): %s", channel, MONITOR_ROUTES.join(", "));
		} catch (error) {
			if (isDuplicateRouteError(error)) {
				registered = true;
				log("info", "context-compression monitor route already registered by another mount (%s)", channel);
				return;
			}
			log("warn", "context-compression monitor route registration failed (%s): %o", channel, error);
		}
	};
	const active = asWebServer(readService("webServer"));
	if (active !== void 0) {
		register(active, "direct");
		if (registered) return;
	}
	ctx.inject(["webServer"], (injected) => {
		const webServer = asWebServer(injected.webServer);
		if (webServer === void 0) {
			log("warn", "context-compression webServer exposes no register() — monitor route not registered");
			return;
		}
		register(webServer, "inject");
	});
}
/**
* Resolve one possibly-volatile field: a live ref on 0.1.7+, a plain value
* otherwise (0.1.7 hands `.volatile()` fields to `apply()` as live refs).
*/
function readVolatileValue(value) {
	if (value !== null && typeof value === "object" && typeof value.get === "function") return value.get();
	return value;
}
/** The compression settings document carried by this row's composition entry. */
function readCompressionDoc(config) {
	return readVolatileValue(config?.settings);
}
/** Loader validation for the standalone Bundle opt-in. */
const Config = z.object({
	presetOverlay: z.boolean().default(false),
	estimatorCatalogRoute: z.boolean().default(false),
	advisorReportRoute: z.boolean().default(false),
	settings: z.any().default(DEFAULT_CONTEXT_COMPRESSION_SETTINGS).volatile()
});
/** Register the persisted default read by the currently mounted root pruner. */
function apply(ctx, config = {}) {
	try {
		if (config.estimatorCatalogRoute === true) registerEstimatorCatalogRoute(ctx);
		registerSavingsRoute(ctx);
		registerMonitorRoute(ctx);
		registerSavingsSessionsRoute(ctx);
		registerPanelCommand(ctx);
		ctx.effect(() => () => {
			cancelPendingUsageFlushes();
			closeStatsStore();
		}, "contextCompressionSelector.stats db");
		ensureStatsStore().catch(() => {});
		configureStatsBackfillTrigger({ sessionQuery: () => {
			try {
				const face = ctx.get("sessionQuery");
				return typeof face?.listSessions === "function" && typeof face?.readSession === "function" ? face : void 0;
			} catch {
				return;
			}
		} });
		wireSettingsBridge(ctx);
		if (config.advisorReportRoute === true) registerAdvisorReportRoute(ctx);
		registerSummaryCommand(ctx);
		if (config.presetOverlay !== true) return;
		ctx.inject(["agentPresets"], (presetsCtx) => {
			const installation = decorateAgentPresets(presetsCtx.agentPresets, {
				modules: resolveCompressionModulePaths(),
				excludedPresetIds: ["minimal"],
				autoCompactThresholdPercent: () => resolveAutoCompactThresholdPercent(config, presetsCtx)
			});
			presetsCtx.effect(() => () => installation.dispose(), "contextCompressionSelector.agentPresets()");
		});
	} catch (error) {
		console.error("context-compression selector apply failed: %o", error);
		throw error;
	}
}
/**
* Read the current Auto Compact threshold ratio at composition time. Settings
* values are revalidated here, and any unreadable value falls back to the 80%
* default rather than blocking preset composition.
*/
function resolveAutoCompactThresholdPercent(config, presetsCtx) {
	const raw = readCompressionDoc(config) ?? (presetsCtx?.get("settings"))?.get?.("context-compression");
	try {
		const threshold = structuredClone(raw)?.autoCompact;
		const value = typeof threshold?.thresholdPercent === "number" ? threshold.thresholdPercent : 80;
		return Number.isFinite(value) && value >= 50 && value <= 90 ? value : 80;
	} catch {
		return 80;
	}
}
//#endregion
export { Config, apply, registerMonitorRoute };
