import z from "@deepseek-ai/schemastery";
import { createHash } from "node:crypto";
//#region src/runtime/savings.ts
/**
* 节省统计账本(诚实口径)。
*
* 原则(与 dsh-token-optimizer 类功能对齐的需求口径):
*  1. **只记已实现**:抵扣来自真实落盘的 rewrite(published replacement)的
*     tokensBefore − tokensAfter,不按"本可以压多少"的最大值计;
*  2. **负节省(配对抵消)**:同一份原文先被压缩(代码骨架/历史老化/去重指针/
*     尾裁引用)后,模型又请求了全文——原声称的节省被抵消:全文读取本身
*     记为负项。净额因此可以为负(骨架 S + 全文 O,对比从未压缩的基线 O,
*     净 −S),这正是"先骨架再全文 = 负节省"的诚实口径;
*  3. **口径分列,不混算**:精确 tokenizer 与 chars/4 估算两个 basis 各自独立
*     汇总,永不合并成一个数。
*
* 存储:进程内 per-session 账本(条目环形缓冲 + hash 注册表)。不落盘——
* 节省统计是运行期面板数据,重启归零是可接受语义(审计日志里已有全量原始记录)。
*
* @module dsh-context-compression-improved/runtime/savings
*/
const MAX_ENTRIES_PER_SESSION = 400;
const MAX_REGISTRY = 2048;
var SavingsLedger = class {
	entries = /* @__PURE__ */ new Map();
	registry = /* @__PURE__ */ new Map();
	seenFullText = /* @__PURE__ */ new Set();
	usage = /* @__PURE__ */ new Map();
	startedAt = Date.now();
	/**
	* 累计一次官方 usage(request-boundary 读取上一已完成请求;末次请求在
	* dispose 汇总前未入账属可接受低估)。usage 字段缺省按 0 计。
	*/
	recordUsage(sessionId, usage) {
		let total = this.usage.get(sessionId);
		if (total === void 0) {
			total = {
				requests: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0
			};
			this.usage.set(sessionId, total);
		}
		total.requests += 1;
		total.inputTokens += positiveOrZero(usage.inputTokens);
		total.outputTokens += positiveOrZero(usage.outputTokens);
		total.cacheReadTokens += positiveOrZero(usage.cacheReadTokens);
		total.cacheWriteTokens += positiveOrZero(usage.cacheWriteTokens);
	}
	totalsFor(scope) {
		const sum = {
			requests: 0,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0
		};
		for (const sid of scope) {
			const t = this.usage.get(sid);
			if (t === void 0) continue;
			sum.requests += t.requests;
			sum.inputTokens += t.inputTokens;
			sum.outputTokens += t.outputTokens;
			sum.cacheReadTokens += t.cacheReadTokens;
			sum.cacheWriteTokens += t.cacheWriteTokens;
		}
		return sum;
	}
	/** 单行会话汇总(session/disposed 日志用)。 */
	sessionSummaryLine(sessionId) {
		const snap = this.snapshot(sessionId);
		const hit = snap.usage.cacheHitRate;
		return `net=${snap.net.exact}(exact)/${snap.net.estimated}(est) gross=${snap.gross.exact}/${snap.gross.estimated} offsets=${snap.offsets.exact}/${snap.offsets.estimated} requests=${snap.usage.requests} cacheHit=${hit === null ? "–" : `${Math.round(hit * 100)}%`}`;
	}
	/** 记录一次已落盘的压缩节省(land 成功后调用;tokensRemoved ≤ 0 忽略)。 */
	recordSaving(input) {
		const removed = input.tokensBefore - input.tokensAfter;
		if (!Number.isFinite(removed) || removed <= 0) return;
		this.push(input.sessionId, {
			kind: "saving",
			component: input.component,
			tokens: removed,
			basis: input.basis,
			at: Date.now()
		});
		if (typeof input.originalText === "string" && input.originalText.length > 0) {
			const hash = savingsHash(input.originalText);
			if (this.registry.size >= MAX_REGISTRY && !this.registry.has(hash)) {
				const oldest = this.registry.keys().next().value;
				if (oldest !== void 0) this.registry.delete(oldest);
			}
			this.registry.set(hash, {
				sessionId: input.sessionId,
				component: input.component,
				claimedTokens: removed,
				basis: input.basis,
				sourceSeq: input.sourceSeq,
				consumed: false
			});
		}
	}
	/**
	* 新的全文工具结果进入上下文(每个 (session, seq) 只看一次):若其原文哈希
	* 命中之前压缩过的条目且未消费过抵消 → 记负项并消费。
	* @param measure 返回 {tokens, basis}——全文按当前可用口径计量。
	*/
	noteFullText(input) {
		if (typeof input.text !== "string" || input.text.length === 0) return;
		const seenKey = `${input.sessionId}:${input.seq}`;
		if (this.seenFullText.has(seenKey)) return;
		this.seenFullText.add(seenKey);
		if (this.seenFullText.size > MAX_REGISTRY * 4) {
			this.seenFullText.clear();
			this.seenFullText.add(seenKey);
		}
		const hit = this.registry.get(savingsHash(input.text));
		if (hit === void 0 || hit.consumed || hit.sessionId !== input.sessionId) return;
		hit.consumed = true;
		const { tokens, basis } = input.measure(input.text);
		if (tokens <= 0) return;
		this.push(input.sessionId, {
			kind: "offset",
			component: "full-read",
			tokens,
			basis,
			at: Date.now(),
			note: `#${hit.sourceSeq} ${hit.component} 的原文被全文重读(原声称 −${hit.claimedTokens})`
		});
	}
	/** retrieve 回读(部分或全部)重新进入上下文:按返回内容计量记负项。 */
	recordOffset(input) {
		if (!Number.isFinite(input.tokens) || input.tokens <= 0) return;
		this.push(input.sessionId, {
			kind: "offset",
			component: input.component,
			tokens: input.tokens,
			basis: input.basis,
			at: Date.now(),
			...input.note === void 0 ? {} : { note: input.note }
		});
	}
	sourceSeqOf(item) {
		return item.sourceSeq;
	}
	push(sessionId, entry) {
		let list = this.entries.get(sessionId);
		if (list === void 0) {
			list = [];
			this.entries.set(sessionId, list);
		}
		list.push(entry);
		if (list.length > MAX_ENTRIES_PER_SESSION) list.splice(0, list.length - MAX_ENTRIES_PER_SESSION);
	}
	/** 汇总快照。sessionId 缺省 = 全会话聚合。两个 basis 分列,永不合并。 */
	snapshot(sessionId) {
		const scope = sessionId === void 0 ? [...this.entries.keys()] : [sessionId];
		const totals = {
			grossExact: 0,
			grossEstimated: 0,
			offsetExact: 0,
			offsetEstimated: 0
		};
		const perComponent = /* @__PURE__ */ new Map();
		const recentOffsets = [];
		for (const sid of scope) for (const entry of this.entries.get(sid) ?? []) {
			const exact = entry.basis === "exact-tokenizer";
			if (entry.kind === "saving") {
				if (exact) totals.grossExact += entry.tokens;
				else totals.grossEstimated += entry.tokens;
			} else {
				if (exact) totals.offsetExact += entry.tokens;
				else totals.offsetEstimated += entry.tokens;
				recentOffsets.push(entry);
			}
			const key = `${entry.kind}:${entry.component}:${entry.basis}`;
			const agg = perComponent.get(key);
			if (agg === void 0) perComponent.set(key, {
				component: entry.component,
				tokens: entry.tokens,
				basis: entry.basis,
				kind: entry.kind
			});
			else agg.tokens += entry.tokens;
		}
		recentOffsets.sort((a, b) => b.at - a.at);
		const usageTotals = this.totalsFor(scope);
		const perSession = sessionId === void 0 ? [.../* @__PURE__ */ new Set([...this.entries.keys(), ...this.usage.keys()])].map((sid) => {
			const s = this.snapshot(sid);
			return {
				sessionId: sid,
				gross: s.gross,
				offsets: s.offsets,
				net: s.net,
				requests: s.usage.requests,
				cacheHitRate: s.usage.cacheHitRate
			};
		}).sort((a, b) => b.net.exact - a.net.exact || b.net.estimated - a.net.estimated).slice(0, 8) : [];
		return {
			startedAt: new Date(this.startedAt).toISOString(),
			sessions: sessionId === void 0 ? this.entries.size : this.entries.has(sessionId) ? 1 : 0,
			gross: {
				exact: totals.grossExact,
				estimated: totals.grossEstimated
			},
			offsets: {
				exact: totals.offsetExact,
				estimated: totals.offsetEstimated
			},
			net: {
				exact: totals.grossExact - totals.offsetExact,
				estimated: totals.grossEstimated - totals.offsetEstimated
			},
			perComponent: [...perComponent.values()].sort((a, b) => b.tokens - a.tokens),
			recentOffsets: recentOffsets.slice(0, 8).map((e) => ({
				component: e.component,
				tokens: e.tokens,
				basis: e.basis,
				at: new Date(e.at).toISOString(),
				...e.note === void 0 ? {} : { note: e.note }
			})),
			usage: {
				...usageTotals,
				cacheHitRate: cacheHitRateOf(usageTotals)
			},
			perSession
		};
	}
	/** 测试与停机清理。 */
	clear() {
		this.entries.clear();
		this.registry.clear();
		this.seenFullText.clear();
		this.usage.clear();
		this.startedAt = Date.now();
	}
};
function cacheHitRateOf(t) {
	const denom = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens;
	return denom <= 0 ? null : Math.round(t.cacheReadTokens / denom * 1e3) / 1e3;
}
/** 原文配对哈希(规整行尾与首尾空白——同一文件两次读取的 innocuous 差异不配错)。 */
function savingsHash(text) {
	return createHash("sha256").update(text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/(^\s+)|(\s+$)/g, ""), "utf8").digest("hex");
}
function positiveOrZero(v) {
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}
const singleton = new SavingsLedger();
/** 模块级单例:pruner 与 retrieve 分处两文件,共享同一本账。 */
function getSavingsLedger() {
	return singleton;
}
//#endregion
//#region src/runtime/deepseek-official-pricing.ts
/** Checked-in DeepSeek official prices and fixed-point provider-usage accounting. */
const DEEPSEEK_OFFICIAL_PRICE_CATALOG_VERSION = "deepseek-official-2026-08-25";
/** Wall-clock time at which the checked-in official price pages were verified. */
const DEEPSEEK_OFFICIAL_PRICE_CHECKED_AT = "2026-08-25T00:10:20+08:00";
const PRICES = Object.freeze({
	"deepseek-v4-flash": modelPrices("DeepSeek-V4-Flash-0731", [
		"0.007",
		"0.22",
		"0.66"
	], [
		"0.014",
		"0.44",
		"1.32"
	], [
		"0.05",
		"1.5",
		"4.5"
	], [
		"0.10",
		"3.0",
		"9.0"
	]),
	"deepseek-v4-pro": modelPrices("DeepSeek-V4-Pro-0813", [
		"0.022",
		"0.66",
		"1.98"
	], [
		"0.044",
		"1.32",
		"3.96"
	], [
		"0.15",
		"4.5",
		"13.5"
	], [
		"0.30",
		"9.0",
		"27.0"
	]),
	"deepseek-v4-flash-vision-exp": modelPrices("DeepSeek-V4-Flash-Vision-Exp", [
		"0.007",
		"0.22",
		"0.66"
	], [
		"0.014",
		"0.44",
		"1.32"
	], [
		"0.05",
		"1.5",
		"4.5"
	], [
		"0.10",
		"3.0",
		"9.0"
	])
});
const PEAK_RULE = "Asia/Shanghai Mon-Fri 09:00-12:00,14:00-18:00";
const USD_SOURCE = "https://api-docs.deepseek.com/quick_start/pricing/";
const CNY_SOURCE = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
/**
* Resolve one immutable official price record; aliases and compatible gateways fail closed.
* @param input - exact provider, endpoint, route, model, currency, and timestamp applicability.
* @returns An immutable price record or an explicit unpriced reason.
*/
function resolveOfficialDeepSeekPrice(input) {
	if (input.provider !== "deepseek-official") return unpriced("unknown provider route");
	if (input.baseUrlClass !== "official-public") return unpriced("unknown base-url applicability");
	if (input.apiRoute !== "chat-completions" && input.apiRoute !== "responses") return unpriced("unknown API route");
	if (!isOfficialModel(input.modelId)) return unpriced("unknown model id");
	if (input.currency !== "USD" && input.currency !== "CNY") return unpriced("unknown currency");
	const band = priceBandAt(input.at);
	if (band === void 0) return unpriced("invalid price timestamp");
	const model = PRICES[input.modelId];
	const [inputCacheHit, inputCacheMiss, output] = model[input.currency][band];
	return {
		kind: "priced",
		record: Object.freeze({
			catalogVersion: DEEPSEEK_OFFICIAL_PRICE_CATALOG_VERSION,
			checkedAt: DEEPSEEK_OFFICIAL_PRICE_CHECKED_AT,
			provider: "deepseek-official",
			baseUrlClass: "official-public",
			apiRoute: input.apiRoute,
			modelId: input.modelId,
			modelVersion: model.version,
			currency: input.currency,
			unitTokens: 1e6,
			band,
			inputCacheHit,
			inputCacheMiss,
			output,
			sourceUrl: input.currency === "USD" ? USD_SOURCE : CNY_SOURCE,
			sourceLocale: input.currency === "USD" ? "en" : "zh-CN",
			peakRule: PEAK_RULE
		})
	};
}
/**
* Classify a timestamp under the published Beijing peak schedule.
* @param at - absolute request time to interpret in Asia/Shanghai.
* @returns Peak/off-peak, or undefined for an invalid timestamp.
*/
function priceBandAt(at) {
	if (!Number.isFinite(at.getTime())) return void 0;
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Shanghai",
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23"
	}).formatToParts(at);
	const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	const weekday = values.weekday;
	const hour = Number(values.hour);
	const minute = Number(values.minute);
	const second = Number(values.second);
	if (weekday === void 0 || !Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) return void 0;
	const workday = weekday !== "Sat" && weekday !== "Sun";
	const seconds = hour * 3600 + minute * 60 + second;
	return workday && (seconds >= 32400 && seconds < 43200 || seconds >= 50400 && seconds < 64800) ? "peak" : "off-peak";
}
/**
* Price one completed request, returning a range when it spans a published band boundary.
* @param input - exact applicability, request interval, and complete disjoint usage buckets.
* @returns Fixed-point exact/range cost or an explicit unpriced reason.
*/
function priceOfficialDeepSeekUsage(input) {
	for (const [name, value] of Object.entries(input.usage)) if (!Number.isSafeInteger(value) || value < 0) return unpriced(`invalid ${name}`);
	if (input.completedAt.getTime() < input.startedAt.getTime()) return unpriced("completion timestamp precedes request start");
	const start = resolveOfficialDeepSeekPrice({
		...input,
		at: input.startedAt
	});
	if (start.kind === "unpriced") return start;
	const end = resolveOfficialDeepSeekPrice({
		...input,
		at: input.completedAt
	});
	if (end.kind === "unpriced") return end;
	const startAmount = amountFor(start.record, input.usage);
	if (startAmount === void 0) return unpriced("invalid decimal price record");
	const crossesBoundary = spansPublishedPriceBoundary(input.startedAt, input.completedAt);
	if (start.record.band === end.record.band && !crossesBoundary) return {
		kind: "exact",
		currency: start.record.currency,
		band: start.record.band,
		...startAmount
	};
	const comparisonRecord = start.record.band === end.record.band ? priceRecordInBand(start.record, start.record.band === "peak" ? "off-peak" : "peak") : end.record;
	const endAmount = amountFor(comparisonRecord, input.usage);
	if (endAmount === void 0) return unpriced("invalid decimal price record");
	const startFemto = BigInt(startAmount.femtoUnits);
	const endFemto = BigInt(endAmount.femtoUnits);
	return {
		kind: "range",
		currency: start.record.currency,
		bands: [start.record.band, comparisonRecord.band],
		minimum: startFemto <= endFemto ? startAmount : endAmount,
		maximum: startFemto <= endFemto ? endAmount : startAmount
	};
}
/** Detect any published UTC band boundary, even when both endpoints share a band. */
function spansPublishedPriceBoundary(startedAt, completedAt) {
	const start = startedAt.getTime();
	const end = completedAt.getTime();
	if (end <= start) return false;
	const dayMs = 864e5;
	if (end - start >= 7 * dayMs) return true;
	const firstDay = Math.floor(start / dayMs) * dayMs;
	for (let day = firstDay; day <= end; day += dayMs) {
		const weekday = new Date(day).getUTCDay();
		if (weekday === 0 || weekday === 6) continue;
		for (const hour of [
			1,
			4,
			6,
			10
		]) {
			const boundary = day + hour * 60 * 60 * 1e3;
			if (boundary > start && boundary <= end) return true;
		}
	}
	return false;
}
function priceRecordInBand(record, band) {
	const [inputCacheHit, inputCacheMiss, output] = PRICES[record.modelId][record.currency][band];
	return Object.freeze({
		...record,
		band,
		inputCacheHit,
		inputCacheMiss,
		output
	});
}
/**
* Parse a non-negative decimal rate into nano-currency units, without Number arithmetic.
* @param value - canonical non-negative decimal with at most nine fractional digits.
* @returns Integer nano-units, or undefined when the decimal is invalid.
*/
function decimalRateNanoUnits(value) {
	const match = /^(0|[1-9]\d*)(?:\.(\d{1,9}))?$/u.exec(value);
	if (match === null) return void 0;
	const whole = match[1] ?? "0";
	const fraction = (match[2] ?? "").padEnd(9, "0");
	return BigInt(whole) * 1000000000n + BigInt(fraction || "0");
}
function amountFor(record, usage) {
	const hit = decimalRateNanoUnits(record.inputCacheHit);
	const miss = decimalRateNanoUnits(record.inputCacheMiss);
	const output = decimalRateNanoUnits(record.output);
	if (hit === void 0 || miss === void 0 || output === void 0) return void 0;
	const femtoUnits = BigInt(usage.cacheReadTokens) * hit + BigInt(usage.cacheMissTokens) * miss + BigInt(usage.outputTokens) * output;
	return {
		femtoUnits: femtoUnits.toString(),
		decimal: formatFemto(femtoUnits)
	};
}
function formatFemto(value) {
	const digits = value.toString().padStart(16, "0");
	const whole = digits.slice(0, -15);
	const fraction = digits.slice(-15).replace(/0+$/u, "");
	return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}
function modelPrices(version, usdOffPeak, usdPeak, cnyOffPeak, cnyPeak) {
	return Object.freeze({
		version,
		USD: Object.freeze({
			"off-peak": usdOffPeak,
			peak: usdPeak
		}),
		CNY: Object.freeze({
			"off-peak": cnyOffPeak,
			peak: cnyPeak
		})
	});
}
function isOfficialModel(value) {
	return Object.prototype.hasOwnProperty.call(PRICES, value);
}
function unpriced(reason) {
	return {
		kind: "unpriced",
		reason
	};
}
const advisorStates = /* @__PURE__ */ new WeakMap();
/**
* The per-session advisor state, created on first touch.
* @param session - the session to key the state on (by object identity).
*/
function getAdvisorState(session) {
	let state = advisorStates.get(session);
	if (state === void 0) {
		state = {
			todoVersion: void 0,
			summary: void 0,
			lastSummaryTurn: -1,
			watermarkSeq: 0,
			scores: /* @__PURE__ */ new Map(),
			recertified: /* @__PURE__ */ new Map(),
			failures: void 0,
			inFlight: false,
			lastDecay: void 0,
			lastAdvice: void 0
		};
		advisorStates.set(session, state);
	}
	return state;
}
/**
* Insert or refresh one score with LRU semantics: a re-touched seq moves to
* the newest position, and the oldest entry is evicted once the map exceeds
* {@link ADVISOR_SCORES_LIMIT}.
*/
function recordScore(state, seq, entry) {
	state.scores.delete(seq);
	state.scores.set(seq, entry);
	if (state.scores.size > 64) {
		const oldest = state.scores.keys().next();
		if (oldest.done !== true) state.scores.delete(oldest.value);
	}
}
/**
* Mark one seq as LLM-recertified low relevance (a suggestion for later
* history-aggressiveness decisions, consumed by nothing in this round).
* Bounded at {@link ADVISOR_RECERTIFIED_LIMIT} with the same LRU eviction.
*/
function recordRecertified(state, seq, turn) {
	state.recertified.delete(seq);
	state.recertified.set(seq, turn);
	if (state.recertified.size > 64) {
		const oldest = state.recertified.keys().next();
		if (oldest.done !== true) state.recertified.delete(oldest.value);
	}
}
/**
* Drop every cached artifact that depends on the task semantics: a changed
* todo version invalidates the summary and makes all eligible candidates
* rescore-worthy (the watermark alone would otherwise hide them).
*/
function invalidateOnTaskChange(state, todoVersion) {
	if (state.todoVersion === todoVersion) return false;
	state.todoVersion = todoVersion;
	state.summary = void 0;
	state.lastSummaryTurn = -1;
	return true;
}
/**
* `/ctx-summary off|on` overrides, keyed by session id (string). The command
* handler only sees `invocation.agent.session.id`, not the pruner's Session
* object, so these are id-keyed rather than WeakMap'd. Entries are two-char
* strings per session and cleared whenever the override is lifted.
*/
const summaryOverrides = /* @__PURE__ */ new Map();
/** Read the session's `/ctx-summary` override; `undefined` = default (settings-driven). */
function getSummaryOverride(sessionId) {
	return summaryOverrides.get(sessionId);
}
/** Set or clear (`undefined`) the session's `/ctx-summary` override. */
function setSummaryOverride(sessionId, value) {
	if (value === void 0) summaryOverrides.delete(sessionId);
	else summaryOverrides.set(sessionId, value);
}
/** Last observed `intentSummary.enabled` for a session, for `/ctx-summary status`. */
const lastObservedIntentEnabled = /* @__PURE__ */ new Map();
/** Record the gate input the pass last evaluated for this session. */
function observeIntentEnabled(sessionId, enabled) {
	lastObservedIntentEnabled.set(sessionId, enabled);
}
/** The settings-side enabled flag last observed for the session, if any. */
function getObservedIntentEnabled(sessionId) {
	return lastObservedIntentEnabled.get(sessionId);
}
const lastIntentFolds = /* @__PURE__ */ new Map();
/** Record a landed intent fold for the session (newest wins). */
function recordIntentFold(sessionId, record) {
	lastIntentFolds.set(sessionId, record);
}
/** The most recent landed intent fold for the session, if any. */
function getLastIntentFold(sessionId) {
	return lastIntentFolds.get(sessionId);
}
//#endregion
//#region src/runtime/tokenpilot/intent-gate.ts
/**
* Turn-tail intent-summary growth gate (TokenPilot-inspired E2).
*
* Pure decision helper evaluated at the turn-boundary postflight: it decides
* whether this turn may spend a summary-writer LLM call and stage a fold for
* the next pressure round. The gate is deliberately conservative — every
* unresolved input (unknown context window, non-finite counters) fails closed
* toward "do not run", because a skipped fold is free while a wasted summary
* call is not. Content safety is unaffected either way: fail-open semantics
* live in the fold landing path, not here.
*/
/** Floor: the live surface must exceed this fraction of the context window. */
const INTENT_GATE_FLOOR_FRACTION = .45;
/** Growth: the live surface must have grown by more than this since the last landed fold. */
const INTENT_GATE_GROWTH_TOKENS = 5e4;
function isUsableNumber(value) {
	return Number.isFinite(value) && value >= 0;
}
/** Same evaluation with the reason attached, for audits and `/ctx-summary status`. */
function evaluateIntentGate(input) {
	const snapshot = (decision, reason) => ({
		...input,
		decision,
		reason
	});
	if (!input.enabled) return snapshot(false, "disabled");
	if (input.override === "off") return snapshot(false, "override-off");
	if (!isUsableNumber(input.liveTokens)) return snapshot(false, "below-floor");
	if (input.contextWindow === void 0 || !isUsableNumber(input.contextWindow)) return snapshot(false, "no-window");
	if (!(input.liveTokens > input.contextWindow * .45)) return snapshot(false, "below-floor");
	if (!isUsableNumber(input.baselineTokens)) return snapshot(false, "below-growth");
	if (!(input.liveTokens - input.baselineTokens > 5e4)) return snapshot(false, "below-growth");
	return snapshot(true, "passed");
}
//#endregion
//#region src/runtime/monitor.ts
/**
* 灾难性遗忘区建议阈值:占用达到该比例即建议压缩/裁剪(DeepSeek 等长上下文
* 模型在高占用段对早期内容的召回显著退化)。有意低于宿主 Auto Compact 阈值
* (默认 80%)——提前一档给出人工干预窗口。
*/
const MONITOR_SUGGEST_PCT = .7;
/**
* Savings snapshot plus the intent-summary control block. Ledger is
* injectable so tests seed a private instance instead of the process
* singleton.
*/
function buildMonitorSnapshot(sessionId, ledger = getSavingsLedger()) {
	const scopeKey = sessionId ?? "";
	const override = getSummaryOverride(scopeKey);
	const observedContext = scopeKey.length > 0 ? getContextUsage(scopeKey) : latestObservedContextUsage();
	const contextBlock = observedContext === void 0 ? void 0 : {
		liveTokens: observedContext.liveTokens,
		contextWindow: observedContext.contextWindow,
		pct: observedContext.contextWindow !== void 0 && observedContext.contextWindow > 0 ? Math.round(observedContext.liveTokens / observedContext.contextWindow * 1e3) / 1e3 : null,
		sessionId: observedContext.sessionId
	};
	const suggestion = contextBlock === void 0 || contextBlock.pct === null ? void 0 : {
		suggest: contextBlock.pct >= MONITOR_SUGGEST_PCT,
		thresholdPct: MONITOR_SUGGEST_PCT,
		occupancyPct: contextBlock.pct
	};
	return {
		...ledger.snapshot(sessionId),
		...contextBlock === void 0 ? {} : { context: contextBlock },
		...suggestion === void 0 ? {} : { suggestion },
		intent: {
			override,
			observedEnabled: getObservedIntentEnabled(scopeKey),
			gate: {
				floorFraction: INTENT_GATE_FLOOR_FRACTION,
				growthTokens: INTENT_GATE_GROWTH_TOKENS
			},
			lastFold: getLastIntentFold(scopeKey)
		},
		sessionScope: sessionId ?? null
	};
}
/** 每会话最近一次上下文占用观测;上限 64 会话,超出淘汰最旧。 */
const contextUsageBySession = /* @__PURE__ */ new Map();
const CONTEXT_USAGE_CAP = 64;
/**
* 由 pruner 的 turn-tail postflight 调用:记录该会话最近的 liveTokens/
* contextWindow,供 monitor 快照的占用条消费。空会话 id 忽略。
*/
function observeContextUsage(sessionId, liveTokens, contextWindow) {
	if (sessionId.length === 0 || !Number.isFinite(liveTokens)) return;
	if (contextUsageBySession.size >= CONTEXT_USAGE_CAP) {
		const oldest = contextUsageBySession.keys().next().value;
		if (oldest !== void 0) contextUsageBySession.delete(oldest);
	}
	contextUsageBySession.set(sessionId, {
		liveTokens,
		contextWindow,
		at: Date.now(),
		seq: ++observeSeq
	});
}
function getContextUsage(sessionId) {
	const entry = contextUsageBySession.get(sessionId);
	return entry === void 0 ? void 0 : {
		liveTokens: entry.liveTokens,
		contextWindow: entry.contextWindow,
		sessionId
	};
}
let observeSeq = 0;
function latestObservedContextUsage() {
	let latest;
	for (const [sessionId, entry] of contextUsageBySession) if (latest === void 0 || entry.seq > latest.seq) latest = {
		sessionId,
		liveTokens: entry.liveTokens,
		contextWindow: entry.contextWindow,
		seq: entry.seq
	};
	return latest;
}
function isSessionOverrideAction(value) {
	return value === "on" || value === "off" || value === "clear";
}
/**
* Drive the `/ctx-summary` override state machine: `on`/`off` pin the
* session, `clear` returns it to settings-driven. The resulting override is
* handed back so the route can echo the post-action truth.
*/
function applySessionOverride(sessionId, action) {
	setSummaryOverride(sessionId, action === "clear" ? void 0 : action);
	return { override: getSummaryOverride(sessionId) };
}
/**
* 金额估算(monitor 口径的 token/金额估算,结合官方牌价):
*  - actualCost:本进程累计真实 usage 的官方牌价(exact/range);
*  - estimatedSavedCost:净节省(精确口径)按 cache-miss 输入价折算——
*    基线假设"这些 token 不压缩就要全价进上下文",标注估算。
* 仅官方 deepseek-official 路由可解;第三方/未知模型 fail-closed 为 undefined。
* (自入口迁入: savings 路由与 monitor 路由共享,避免 runtime → entry 回环。)
*/
function estimateSavingsPricing(readService, snapshot) {
	if (snapshot.usage.requests === 0 && snapshot.net.exact === 0) return void 0;
	const selection = readService("agentDefaultModel")?.currentSelection?.();
	const provider = typeof selection?.provider === "string" ? selection.provider : "";
	const modelId = typeof selection?.model === "string" ? selection.model : "";
	if (provider !== "deepseek-official") return void 0;
	const now = /* @__PURE__ */ new Date();
	const startedAt = new Date(snapshot.startedAt);
	const base = {
		provider,
		baseUrlClass: "official-public",
		apiRoute: "chat-completions",
		modelId,
		currency: "USD",
		startedAt,
		completedAt: now.getTime() > startedAt.getTime() ? now : new Date(startedAt.getTime() + 1)
	};
	const actual = priceOfficialDeepSeekUsage({
		...base,
		usage: {
			cacheReadTokens: Math.max(0, Math.round(snapshot.usage.cacheReadTokens)),
			cacheMissTokens: Math.max(0, Math.round(snapshot.usage.inputTokens)),
			outputTokens: Math.max(0, Math.round(snapshot.usage.outputTokens))
		}
	});
	const saved = snapshot.net.exact > 0 ? priceOfficialDeepSeekUsage({
		...base,
		usage: {
			cacheReadTokens: 0,
			cacheMissTokens: Math.round(snapshot.net.exact),
			outputTokens: 0
		}
	}) : void 0;
	const decimalOf = (cost) => cost.kind === "exact" ? cost.decimal : cost.kind === "range" ? cost.minimum.decimal : void 0;
	if (actual.kind === "unpriced" && (saved === void 0 || saved.kind === "unpriced")) return void 0;
	return {
		currency: "USD",
		...actual.kind === "unpriced" ? {} : { actualCost: decimalOf(actual) },
		...saved === void 0 || saved.kind === "unpriced" ? {} : { estimatedSavedCost: decimalOf(saved) }
	};
}
//#endregion
//#region src/runtime/types.ts
/** User-facing mixed strategy profile. */
const COMPRESSION_PROFILES = [
	"off",
	"native",
	"balanced",
	"cache-strict",
	"savings",
	"adaptive",
	"tokenpilot-inspired",
	"custom"
];
//#endregion
//#region src/runtime/value.ts
/** Version-neutral immutable-value and closed-union helpers for the plugin runtime. */
/**
* Freeze an object graph in place without relying on a Harness utility export.
* Live AbortSignals remain mutable so request cancellation continues to work.
* @param value - Value to freeze recursively.
* @returns The same deeply frozen value.
*/
function deepFreeze(value) {
	const seen = /* @__PURE__ */ new WeakSet();
	const pending = [{
		kind: "visit",
		node: value
	}];
	while (pending.length > 0) {
		const task = pending.pop();
		/* v8 ignore next -- the loop condition guarantees one pending task. */
		if (task === void 0) continue;
		if (task.kind === "property") {
			pending.push({
				kind: "visit",
				node: task.source[task.key]
			});
			continue;
		}
		const node = task.node;
		if (node === null || typeof node !== "object" || node instanceof AbortSignal || seen.has(node)) continue;
		seen.add(node);
		Object.freeze(node);
		const keys = Object.keys(node);
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) continue;
			pending.push({
				kind: "property",
				source: node,
				key
			});
		}
	}
	return value;
}
/**
* Throw for an impossible member of a closed discriminated union.
* @param value - Value that escaped its closed union type.
* @param context - Optional switch-site label.
* @returns Never returns.
*/
function assertNever(value, context) {
	const rendered = JSON.stringify(value) ?? String(value);
	throw new Error(`unreachable variant${context === void 0 ? "" : ` in ${context}`}: ${rendered}`);
}
//#endregion
//#region src/runtime/custom-policy.ts
/** Strict versioned Custom policy parsing and effective-token resolution. */
const budgetSchema = z.object({
	enabled: z.boolean().required(),
	trigger: z.number().required(),
	target: z.number().required()
}).required();
const legacyHistorySchema = z.object({
	enabled: z.boolean().required(),
	trigger: z.number().required(),
	keepRecentTurns: z.number().step(1).min(0).required(),
	keepRecent: z.number().required(),
	minReclaim: z.number().required()
}).required();
const historySchema = z.object({
	enabled: z.boolean().required(),
	trigger: z.number().required(),
	keepRecentToolCalls: z.number().step(1).min(0).required(),
	keepRecentTokens: z.number().required(),
	minReclaim: z.number().required()
}).required();
const tailTrimSchema = z.object({
	enabled: z.boolean().required(),
	trigger: z.number().required()
}).required();
const customCompressionPolicyV1InputSchema = z.object({
	version: z.const(1).required(),
	unit: z.union(["tokens", "context-percent"]).required(),
	fresh: budgetSchema,
	aggregate: budgetSchema,
	history: legacyHistorySchema,
	prefixPolicy: z.union(["preserve", "pressure-break"]).required()
}).required();
const customCompressionPolicyV2InputSchema = z.object({
	version: z.const(2).required(),
	unit: z.union(["tokens", "context-percent"]).required(),
	fresh: budgetSchema,
	aggregate: budgetSchema,
	history: legacyHistorySchema,
	prefixPolicy: z.union(["preserve", "pressure-break"]).required(),
	tailTrim: tailTrimSchema
}).required();
const customCompressionPolicyV3InputSchema = z.object({
	version: z.const(3).required(),
	unit: z.union(["tokens", "context-percent"]).required(),
	fresh: budgetSchema,
	aggregate: budgetSchema,
	history: historySchema,
	prefixPolicy: z.union(["preserve", "pressure-break"]).required(),
	tailTrim: tailTrimSchema
}).required();
/** Canonical Custom document accepted by Host settings and the runtime resolver. */
const CustomCompressionPolicySchema = z.transform(z.any().required(), (value) => {
	assertExactPolicyShape(value);
	const canonical = canonicalizeCustomPolicy(value.version === 1 ? customCompressionPolicyV1InputSchema(value) : value.version === 2 ? customCompressionPolicyV2InputSchema(value) : customCompressionPolicyV3InputSchema(value));
	assertCanonicalRelations(canonical);
	return deepFreeze(structuredClone(canonical));
});
/** Balanced-equivalent Custom policy stored as one token-canonical document. */
const DEFAULT_CUSTOM_COMPRESSION_POLICY = deepFreeze({
	version: 3,
	unit: "tokens",
	fresh: {
		enabled: true,
		trigger: 8192,
		target: 3072
	},
	aggregate: {
		enabled: true,
		trigger: 32768,
		target: 12288
	},
	history: {
		enabled: true,
		trigger: 5e5,
		keepRecentToolCalls: 10,
		keepRecentTokens: 64e3,
		minReclaim: 96e3
	},
	prefixPolicy: "pressure-break",
	tailTrim: {
		enabled: false,
		trigger: 7e5
	}
});
/**
* Resolve one validated Custom document to the same token policy used by public presets.
* @param value - untrusted or typed Custom settings value.
* @param options - routed model capacity for context-percent documents.
* @returns a detached deeply immutable effective token policy.
*/
function resolveCustomPolicy(value, options = {}) {
	const policy = canonicalizeCustomPolicy(CustomCompressionPolicySchema(value));
	const effective = (name, amount) => {
		if (policy.unit === "tokens") return amount;
		const contextWindow = options.contextWindowTokens;
		if (!Number.isSafeInteger(contextWindow) || contextWindow === void 0 || contextWindow <= 0) throw new Error("Custom context-percent policy requires a resolved positive model context window");
		const tokens = Math.floor(contextWindow * amount / 100);
		if (!Number.isSafeInteger(tokens) || amount > 0 && tokens <= 0) throw new Error(`Custom ${name} has no valid effective token value for this model`);
		return tokens;
	};
	const resolved = {
		profile: "custom",
		nativeToolResultEnabled: false,
		freshEnabled: policy.fresh.enabled,
		aggregateEnabled: policy.aggregate.enabled,
		historyMode: !policy.history.enabled ? "disabled" : policy.prefixPolicy === "preserve" ? "capacity-pressure" : "routine",
		nativeTriggerTokens: Number.MAX_SAFE_INTEGER,
		nativeTargetTokens: Number.MAX_SAFE_INTEGER,
		freshTriggerTokens: effective("Fresh trigger", policy.fresh.trigger),
		freshTargetTokens: effective("Fresh target", policy.fresh.target),
		aggregateTriggerTokens: effective("Aggregate trigger", policy.aggregate.trigger),
		aggregateTargetTokens: effective("Aggregate target", policy.aggregate.target),
		historyTriggerTokens: effective("History trigger", policy.history.trigger),
		historyKeepRecentToolCalls: policy.history.keepRecentToolCalls,
		historyKeepRecentTokens: effective("History recent token tail", policy.history.keepRecentTokens),
		historyMinReclaimTokens: effective("History min-reclaim", policy.history.minReclaim),
		tailTrim: {
			enabled: policy.tailTrim.enabled,
			triggerTokens: effective("TailTrim trigger", policy.tailTrim.trigger)
		}
	};
	assertEffectiveRelations(resolved);
	return deepFreeze(resolved);
}
function canonicalizeCustomPolicy(policy) {
	if (policy.version === 3) return policy;
	return {
		version: 3,
		unit: policy.unit,
		fresh: policy.fresh,
		aggregate: policy.aggregate,
		history: {
			enabled: policy.history.enabled,
			trigger: policy.history.trigger,
			keepRecentToolCalls: 10,
			keepRecentTokens: policy.history.keepRecent,
			minReclaim: policy.history.minReclaim
		},
		prefixPolicy: policy.prefixPolicy,
		tailTrim: policy.version === 1 ? {
			enabled: false,
			trigger: 7e5
		} : policy.tailTrim
	};
}
function measuredValues(policy) {
	return [
		policy.fresh.trigger,
		policy.fresh.target,
		policy.aggregate.trigger,
		policy.aggregate.target,
		policy.history.trigger,
		policy.history.keepRecentTokens,
		policy.history.minReclaim,
		policy.tailTrim.trigger
	];
}
function validMeasuredValues(policy) {
	const values = measuredValues(policy);
	if (![
		policy.fresh.trigger,
		policy.fresh.target,
		policy.aggregate.trigger,
		policy.aggregate.target,
		policy.history.trigger,
		policy.history.minReclaim,
		policy.tailTrim.trigger
	].every((value) => value > 0) || policy.history.keepRecentTokens < 0 || !Number.isSafeInteger(policy.history.keepRecentToolCalls) || policy.history.keepRecentToolCalls < 0) return false;
	return policy.unit === "tokens" ? values.every(Number.isSafeInteger) : values.every((value) => Number.isFinite(value) && value <= 100);
}
function assertCanonicalRelations(policy) {
	if (!validMeasuredValues(policy)) throw new TypeError("Custom measured values must use the selected canonical unit");
	if (policy.fresh.target >= policy.fresh.trigger) throw new TypeError("Custom Fresh target must be below trigger");
	if (policy.aggregate.target >= policy.aggregate.trigger) throw new TypeError("Custom Aggregate target must be below trigger");
	if (policy.history.minReclaim > policy.history.trigger) throw new TypeError("Custom History min-reclaim must not exceed its trigger");
}
function assertExactPolicyShape(value) {
	if (!isPlainRecord$1(value)) throw new TypeError("Custom must be a plain object");
	if (value.version !== 1 && value.version !== 2 && value.version !== 3) throw new TypeError("Custom version must be 1, 2, or 3");
	assertExactKeys(value, value.version === 1 ? [
		"version",
		"unit",
		"fresh",
		"aggregate",
		"history",
		"prefixPolicy"
	] : [
		"version",
		"unit",
		"fresh",
		"aggregate",
		"history",
		"prefixPolicy",
		"tailTrim"
	], "Custom");
	assertExactKeys(value.fresh, [
		"enabled",
		"trigger",
		"target"
	], "Custom Fresh");
	assertExactKeys(value.aggregate, [
		"enabled",
		"trigger",
		"target"
	], "Custom Aggregate");
	assertExactKeys(value.history, value.version === 3 ? [
		"enabled",
		"trigger",
		"keepRecentToolCalls",
		"keepRecentTokens",
		"minReclaim"
	] : [
		"enabled",
		"trigger",
		"keepRecentTurns",
		"keepRecent",
		"minReclaim"
	], "Custom History");
	if (value.version !== 1) assertExactKeys(value.tailTrim, ["enabled", "trigger"], "Custom TailTrim");
}
function assertExactKeys(value, allowed, label) {
	if (!isPlainRecord$1(value)) throw new TypeError(`${label} must be a plain object`);
	const allowedKeys = new Set(allowed);
	const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
	if (unknown !== void 0) throw new TypeError(`${label}: unknown key "${unknown}"`);
}
function isPlainRecord$1(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
function assertEffectiveRelations(policy) {
	if (policy.freshTargetTokens >= policy.freshTriggerTokens) throw new Error("Custom effective Fresh target must be below trigger");
	if (policy.aggregateTargetTokens >= policy.aggregateTriggerTokens) throw new Error("Custom effective Aggregate target must be below trigger");
	if (policy.historyMinReclaimTokens > policy.historyTriggerTokens) throw new Error("Custom effective History min-reclaim must not exceed its trigger");
}
//#endregion
//#region src/runtime/config.ts
/** Configuration resolution for the mixed deterministic context-compression selector. */
/** Settings namespace shared by the Host service and browser selector. */
const CONTEXT_COMPRESSION_SETTINGS_NAMESPACE = "context-compression";
/** Fixed native fallback marker. */
const PRUNE_MARKER = "\n\n[... tool result middle pruned ...]\n\n";
/**
* The one Auto Compact threshold contract shared by the settings UI, the
* persisted settings schema, and the runtime resolver. Every integer in the
* range is valid and entered directly in the UI.
*/
const AUTO_COMPACT_THRESHOLD_LIMITS = deepFreeze({
	min: 50,
	max: 90,
	step: 1,
	default: 80
});
/** Narrow one untrusted value to a valid Auto Compact threshold percent. */
function isValidAutoCompactThresholdPercent(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= AUTO_COMPACT_THRESHOLD_LIMITS.min && value <= AUTO_COMPACT_THRESHOLD_LIMITS.max;
}
const AUTO_COMPACT_DEFAULT = deepFreeze({ thresholdPercent: AUTO_COMPACT_THRESHOLD_LIMITS.default });
/** Accept JSON-object records while rejecting class instances and exotic prototypes. */
function isPlainRecord(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
/** Reject exotic prototypes anywhere in the JSON-like settings tree. */
function assertPlainDataTree(value, seen = /* @__PURE__ */ new WeakSet()) {
	if (value === null || typeof value !== "object") return;
	if (seen.has(value)) return;
	seen.add(value);
	if (Array.isArray(value)) {
		for (const entry of value) assertPlainDataTree(entry, seen);
		return;
	}
	if (!isPlainRecord(value)) throw new TypeError("Context-compression settings must contain only plain objects");
	for (const entry of Object.values(value)) assertPlainDataTree(entry, seen);
}
/**
* Strictly parse the persisted autoCompact section. Schemastery object
* defaults silently absorb null, empty, and extra-key sections, so this stays
* hand-validated beside the top-level unknown-key check.
*/
function parseAutoCompactSettings(value) {
	if (value === void 0) return AUTO_COMPACT_DEFAULT;
	if (!isPlainRecord(value)) throw new TypeError("Context-compression autoCompact must be a plain object");
	const keys = Object.keys(value);
	if (keys.length !== 1 || keys[0] !== "thresholdPercent") throw new TypeError(`Context-compression autoCompact: expected exactly "thresholdPercent", got "${keys.join("\", \"")}"`);
	const thresholdPercent = value.thresholdPercent;
	if (!isValidAutoCompactThresholdPercent(thresholdPercent)) throw new TypeError(`Context-compression autoCompact.thresholdPercent (${String(thresholdPercent)}) must be an integer between ${String(AUTO_COMPACT_THRESHOLD_LIMITS.min)} and ${String(AUTO_COMPACT_THRESHOLD_LIMITS.max)}`);
	return { thresholdPercent };
}
/**
* Strictly parse the persisted codeSkeleton section. The gate is orthogonal
* to every profile: absent inherits the lossless `false` default, while a
* present-but-invalid section is an explicitly invalid document.
*/
function parseCodeSkeletonSettings(value) {
	if (value === void 0) return { enabled: false };
	if (!isPlainRecord(value)) throw new TypeError("Context-compression codeSkeleton must be a plain object");
	const keys = Object.keys(value);
	if (keys.length !== 1 || keys[0] !== "enabled") throw new TypeError(`Context-compression codeSkeleton: expected exactly "enabled", got "${keys.join("\", \"")}"`);
	const enabled = value.enabled;
	if (typeof enabled !== "boolean") throw new TypeError("Context-compression codeSkeleton.enabled must be a boolean");
	return { enabled };
}
/**
* Strictly parse the persisted intentSummary section. Mirrors the codeSkeleton
* section semantics: absent inherits the lossless `false` default, while a
* present-but-invalid section is an explicitly invalid document.
*/
function parseIntentSummarySettings(value) {
	if (value === void 0) return { enabled: false };
	if (!isPlainRecord(value)) throw new TypeError("Context-compression intentSummary must be a plain object");
	const keys = Object.keys(value);
	if (keys.length !== 1 || keys[0] !== "enabled") throw new TypeError(`Context-compression intentSummary: expected exactly "enabled", got "${keys.join("\", \"")}"`);
	const enabled = value.enabled;
	if (typeof enabled !== "boolean") throw new TypeError("Context-compression intentSummary.enabled must be a boolean");
	return { enabled };
}
/**
* Strictly parse the persisted monitorPanel section. Mirrors the intentSummary
* section semantics: absent inherits the hidden default, while a
* present-but-invalid section is an explicitly invalid document.
*/
function parseMonitorPanelSettings(value) {
	if (value === void 0) return { enabled: false };
	if (!isPlainRecord(value)) throw new TypeError("Context-compression monitorPanel must be a plain object");
	const keys = Object.keys(value);
	if (keys.length !== 1 || keys[0] !== "enabled") throw new TypeError(`Context-compression monitorPanel: expected exactly "enabled", got "${keys.join("\", \"")}"`);
	const enabled = value.enabled;
	if (typeof enabled !== "boolean") throw new TypeError("Context-compression monitorPanel.enabled must be a boolean");
	return { enabled };
}
/**
* Parse the optional tokenpilot-inspired preset sub-capability section. Absent
* inherits the preset defaults; present-but-invalid is rejected, mirroring the
* codeSkeleton section semantics.
*/
function parsePresetOptionsSettings(value) {
	if (value === void 0) return void 0;
	if (!isPlainRecord(value)) throw new TypeError("Context-compression presetOptions must be a plain object");
	const allowed = /* @__PURE__ */ new Set([
		"dedupeToolResults",
		"summaryLocator",
		"prefixStabilizer",
		"readState",
		"estimatorMode",
		"estimatorProvider",
		"estimatorModel",
		"estimatorBaseUrl",
		"estimatorApiKey",
		"estimatorTimeoutMs",
		"reviewMode",
		"reviewTimeoutTurns",
		"cacheHitDiscountAlpha",
		"reviewHighImpactTokens",
		"advisorMode",
		"advisorTimeoutMs",
		"advisorRefreshTurns",
		"advisorScoreThreshold",
		"advisorSampleLimit",
		"advisorMinTokens"
	]);
	const unknown = Object.keys(value).find((key) => !allowed.has(key));
	if (unknown !== void 0) throw new TypeError(`Context-compression presetOptions: unknown key "${unknown}"`);
	for (const key of [
		"dedupeToolResults",
		"summaryLocator",
		"prefixStabilizer",
		"readState"
	]) {
		const entry = value[key];
		if (entry !== void 0 && typeof entry !== "boolean") throw new TypeError(`Context-compression presetOptions.${key} must be a boolean`);
	}
	const estimatorMode = value.estimatorMode;
	if (estimatorMode !== void 0 && estimatorMode !== "" && estimatorMode !== "host" && estimatorMode !== "direct") throw new TypeError("Context-compression presetOptions.estimatorMode must be \"\", \"host\", or \"direct\"");
	const advisorMode = value.advisorMode;
	if (advisorMode !== void 0 && advisorMode !== "" && advisorMode !== "host" && advisorMode !== "direct") throw new TypeError("Context-compression presetOptions.advisorMode must be \"\", \"host\", or \"direct\"");
	const advisorTimeoutMs = value.advisorTimeoutMs;
	if (advisorTimeoutMs !== void 0 && (typeof advisorTimeoutMs !== "number" || !Number.isSafeInteger(advisorTimeoutMs) || advisorTimeoutMs < 100 || advisorTimeoutMs > 6e4)) throw new TypeError("Context-compression presetOptions.advisorTimeoutMs must be an integer between 100 and 60000");
	const advisorRefreshTurns = value.advisorRefreshTurns;
	if (advisorRefreshTurns !== void 0 && (typeof advisorRefreshTurns !== "number" || !Number.isSafeInteger(advisorRefreshTurns) || advisorRefreshTurns < 1)) throw new TypeError("Context-compression presetOptions.advisorRefreshTurns must be an integer of at least 1");
	const advisorScoreThreshold = value.advisorScoreThreshold;
	if (advisorScoreThreshold !== void 0 && (typeof advisorScoreThreshold !== "number" || !Number.isFinite(advisorScoreThreshold) || advisorScoreThreshold <= 0 || advisorScoreThreshold >= 1)) throw new TypeError("Context-compression presetOptions.advisorScoreThreshold must be a number strictly between 0 and 1");
	const advisorSampleLimit = value.advisorSampleLimit;
	if (advisorSampleLimit !== void 0 && (typeof advisorSampleLimit !== "number" || !Number.isSafeInteger(advisorSampleLimit) || advisorSampleLimit < 1 || advisorSampleLimit > 64)) throw new TypeError("Context-compression presetOptions.advisorSampleLimit must be an integer between 1 and 64");
	const advisorMinTokens = value.advisorMinTokens;
	if (advisorMinTokens !== void 0 && (typeof advisorMinTokens !== "number" || !Number.isSafeInteger(advisorMinTokens) || advisorMinTokens < 1)) throw new TypeError("Context-compression presetOptions.advisorMinTokens must be a positive integer");
	const estimatorTimeoutMs = value.estimatorTimeoutMs;
	if (estimatorTimeoutMs !== void 0 && (typeof estimatorTimeoutMs !== "number" || !Number.isSafeInteger(estimatorTimeoutMs) || estimatorTimeoutMs < 100 || estimatorTimeoutMs > 6e4)) throw new TypeError("Context-compression presetOptions.estimatorTimeoutMs must be an integer between 100 and 60000");
	for (const key of [
		"estimatorProvider",
		"estimatorModel",
		"estimatorBaseUrl",
		"estimatorApiKey"
	]) {
		const entry = value[key];
		if (entry !== void 0 && typeof entry !== "string") throw new TypeError(`Context-compression presetOptions.${key} must be a string`);
	}
	const result = {};
	if (value.dedupeToolResults !== void 0) result.dedupeToolResults = value.dedupeToolResults;
	if (value.summaryLocator !== void 0) result.summaryLocator = value.summaryLocator;
	if (value.prefixStabilizer !== void 0) result.prefixStabilizer = value.prefixStabilizer;
	if (value.readState !== void 0) result.readState = value.readState;
	if (estimatorMode !== void 0) result.estimatorMode = estimatorMode;
	if (value.estimatorProvider !== void 0) result.estimatorProvider = value.estimatorProvider;
	if (value.estimatorModel !== void 0) result.estimatorModel = value.estimatorModel;
	if (value.estimatorBaseUrl !== void 0) result.estimatorBaseUrl = value.estimatorBaseUrl;
	if (value.estimatorApiKey !== void 0) result.estimatorApiKey = value.estimatorApiKey;
	if (estimatorTimeoutMs !== void 0) result.estimatorTimeoutMs = estimatorTimeoutMs;
	if (advisorMode !== void 0) result.advisorMode = advisorMode;
	if (advisorTimeoutMs !== void 0) result.advisorTimeoutMs = advisorTimeoutMs;
	if (advisorRefreshTurns !== void 0) result.advisorRefreshTurns = advisorRefreshTurns;
	if (advisorScoreThreshold !== void 0) result.advisorScoreThreshold = advisorScoreThreshold;
	if (advisorSampleLimit !== void 0) result.advisorSampleLimit = advisorSampleLimit;
	if (advisorMinTokens !== void 0) result.advisorMinTokens = advisorMinTokens;
	return result;
}
/** Settings schema used by the user-facing profile selector. */
const contextCompressionSettingsInputSchema = z.object({
	profile: z.union([...COMPRESSION_PROFILES]).default("balanced"),
	custom: CustomCompressionPolicySchema.default(DEFAULT_CUSTOM_COMPRESSION_POLICY)
});
/**
* Reject a section that is PRESENT but not a usable value. Schemastery
* `.default(...)` silently substitutes null and undefined, which would turn a
* hand-corrupted store into the (lossy) default policy; only genuinely absent
* keys may inherit defaults, and that distinction must be made before any
* default can fire.
*/
function assertPresentSection(candidate, key, valid) {
	if (!Object.hasOwn(candidate, key)) return;
	if (!valid(candidate[key])) throw new TypeError(`Context-compression settings: "${key}" is present but invalid (${String(candidate[key])})`);
}
const isSupportedProfile = (value) => typeof value === "string" && COMPRESSION_PROFILES.includes(value);
const isUsableCustomDocument = (value) => isPlainRecord(value);
const DEFAULT_CONTEXT_COMPRESSION_SETTINGS = {
	profile: "balanced",
	custom: structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY),
	autoCompact: { thresholdPercent: AUTO_COMPACT_THRESHOLD_LIMITS.default },
	codeSkeleton: { enabled: false },
	intentSummary: { enabled: false },
	monitorPanel: { enabled: false }
};
/**
* Parse one settings document with the persisted-section semantics: `undefined`
* inherits the defaults (an absent section), while `null` is an explicitly
* invalid document and must never silently become the default policy.
*/
function parseContextCompressionSettings(value) {
	if (!isPlainRecord(value)) throw new TypeError("Context-compression settings must be a plain object");
	const keys = Object.keys(value);
	if (keys.length === 0 || !keys.includes("profile") || !keys.includes("custom")) throw new TypeError("Context-compression settings document is missing its complete shape");
	return ContextCompressionSettingsSchema(value);
}
/** Settings schema used by the user-facing profile selector. */
const ContextCompressionSettingsSchema = z.transform(z.any().required(), (value) => {
	if (!isPlainRecord(value)) throw new TypeError("Context-compression settings must be a plain object");
	assertPlainDataTree(value);
	const candidate = structuredClone(value);
	const unknown = Object.keys(candidate).find((key) => key !== "profile" && key !== "custom" && key !== "autoCompact" && key !== "codeSkeleton" && key !== "intentSummary" && key !== "monitorPanel" && key !== "presetOptions");
	if (unknown !== void 0) throw new TypeError(`Context-compression settings: unknown key "${unknown}"`);
	assertPresentSection(candidate, "profile", isSupportedProfile);
	assertPresentSection(candidate, "custom", isUsableCustomDocument);
	const autoCompact = parseAutoCompactSettings(candidate.autoCompact);
	const codeSkeleton = parseCodeSkeletonSettings(candidate.codeSkeleton);
	const intentSummary = parseIntentSummarySettings(candidate.intentSummary);
	const monitorPanel = parseMonitorPanelSettings(candidate.monitorPanel);
	const presetOptions = parsePresetOptionsSettings(candidate.presetOptions);
	return {
		...contextCompressionSettingsInputSchema(candidate),
		autoCompact,
		codeSkeleton,
		intentSummary,
		monitorPanel,
		...presetOptions === void 0 ? {} : { presetOptions }
	};
}).default(DEFAULT_CONTEXT_COMPRESSION_SETTINGS);
/** Low-friction defaults; token budgets live in resolved profile policy. */
const DEFAULTS = deepFreeze({
	profile: "balanced",
	headChars: 4096,
	tailChars: 1024
});
const CONFIG_KEYS = /* @__PURE__ */ new Set([
	"profile",
	"headChars",
	"tailChars",
	"nativeTriggerTokens",
	"nativeTargetTokens",
	"freshTriggerTokens",
	"freshTargetTokens",
	"aggregateTriggerTokens",
	"aggregateTargetTokens",
	"historyTriggerTokens",
	"historyKeepRecentToolCalls",
	"historyKeepRecentTokens",
	"historyMinReclaimTokens",
	"readInputCapChars",
	"autoCompactThresholdPercent",
	"presetOptions"
]);
const LEGACY_GATE_REPLACEMENTS = Object.freeze({
	thresholdChars: "nativeTriggerTokens",
	freshThresholdChars: "freshTriggerTokens",
	freshTargetChars: "freshTargetTokens",
	freshBatchTriggerChars: "aggregateTriggerTokens",
	freshBatchTargetChars: "aggregateTargetTokens",
	historyTriggerChars: "historyTriggerTokens",
	historyKeepRecentChars: "historyKeepRecentTokens",
	historyMinReclaimChars: "historyMinReclaimTokens",
	historyKeepRecentTurns: "historyKeepRecentToolCalls"
});
/**
* Count Unicode code points without splitting surrogate pairs.
* @param text - text whose code points are counted.
* @returns the number of Unicode code points.
*/
function codePointLength(text) {
	let length = 0;
	for (const _point of text) length++;
	return length;
}
/** Express one token-named policy gate on the character basis. */
function charsForTokens(tokens) {
	return tokens * 4;
}
/** Derive the telemetry-only token figure from a character measurement. */
function charsToTokens(chars) {
	if (!Number.isFinite(chars) || chars <= 0) return 0;
	return Math.max(1, Math.round(chars / 4));
}
/**
* Test whether a settings value names a supported compression profile.
* @param value - untrusted settings value.
* @returns whether the value is a supported compression profile.
*/
function isCompressionProfile(value) {
	return typeof value === "string" && COMPRESSION_PROFILES.includes(value);
}
/**
* Resolve and validate plugin configuration.
* @param config - optional composition overrides.
* @returns a detached, deeply immutable configuration snapshot.
*/
function resolveConfig(config = {}) {
	for (const key of Object.keys(config)) {
		const replacement = LEGACY_GATE_REPLACEMENTS[key];
		if (replacement !== void 0) throw new Error(`ToolResultPruneConfig: legacy gate "${key}" is no longer accepted; choose "${replacement}" manually in tokens (no character conversion is applied)`);
		if (!CONFIG_KEYS.has(key)) throw new Error(`ToolResultPruneConfig: unknown key "${key}"`);
	}
	const resolved = {
		profile: config.profile ?? DEFAULTS.profile,
		headChars: config.headChars ?? DEFAULTS.headChars,
		tailChars: config.tailChars ?? DEFAULTS.tailChars,
		...config.nativeTriggerTokens === void 0 ? {} : { nativeTriggerTokens: config.nativeTriggerTokens },
		...config.nativeTargetTokens === void 0 ? {} : { nativeTargetTokens: config.nativeTargetTokens },
		...config.freshTriggerTokens === void 0 ? {} : { freshTriggerTokens: config.freshTriggerTokens },
		...config.freshTargetTokens === void 0 ? {} : { freshTargetTokens: config.freshTargetTokens },
		...config.aggregateTriggerTokens === void 0 ? {} : { aggregateTriggerTokens: config.aggregateTriggerTokens },
		...config.aggregateTargetTokens === void 0 ? {} : { aggregateTargetTokens: config.aggregateTargetTokens },
		...config.historyTriggerTokens === void 0 ? {} : { historyTriggerTokens: config.historyTriggerTokens },
		...config.historyKeepRecentToolCalls === void 0 ? {} : { historyKeepRecentToolCalls: config.historyKeepRecentToolCalls },
		...config.historyKeepRecentTokens === void 0 ? {} : { historyKeepRecentTokens: config.historyKeepRecentTokens },
		...config.historyMinReclaimTokens === void 0 ? {} : { historyMinReclaimTokens: config.historyMinReclaimTokens },
		...config.readInputCapChars === void 0 ? {} : { readInputCapChars: config.readInputCapChars },
		...config.autoCompactThresholdPercent === void 0 ? {} : { autoCompactThresholdPercent: config.autoCompactThresholdPercent },
		...config.presetOptions === void 0 ? {} : { presetOptions: config.presetOptions }
	};
	if (!isCompressionProfile(resolved.profile)) throw new Error(`ToolResultPruneConfig: unsupported profile "${String(resolved.profile)}"`);
	assertNonNegativeInteger("headChars", resolved.headChars);
	assertNonNegativeInteger("tailChars", resolved.tailChars);
	for (const key of [
		"nativeTriggerTokens",
		"nativeTargetTokens",
		"freshTriggerTokens",
		"freshTargetTokens",
		"aggregateTriggerTokens",
		"aggregateTargetTokens",
		"historyTriggerTokens",
		"historyMinReclaimTokens",
		"readInputCapChars"
	]) {
		const value = resolved[key];
		if (value !== void 0) assertPositiveInteger(key, value);
	}
	if (resolved.historyKeepRecentToolCalls !== void 0) assertNonNegativeInteger("historyKeepRecentToolCalls", resolved.historyKeepRecentToolCalls);
	if (resolved.historyKeepRecentTokens !== void 0) assertNonNegativeInteger("historyKeepRecentTokens", resolved.historyKeepRecentTokens);
	if (resolved.autoCompactThresholdPercent !== void 0 && !isValidAutoCompactThresholdPercent(resolved.autoCompactThresholdPercent)) throw new Error(`ToolResultPruneConfig: autoCompactThresholdPercent (${String(resolved.autoCompactThresholdPercent)}) must be an integer between ${String(AUTO_COMPACT_THRESHOLD_LIMITS.min)} and ${String(AUTO_COMPACT_THRESHOLD_LIMITS.max)}`);
	assertTargetBelowTrigger("native", resolved.nativeTargetTokens, resolved.nativeTriggerTokens);
	assertTargetBelowTrigger("fresh", resolved.freshTargetTokens, resolved.freshTriggerTokens);
	assertTargetBelowTrigger("aggregate", resolved.aggregateTargetTokens, resolved.aggregateTriggerTokens);
	return deepFreeze(structuredClone(resolved));
}
/** Per-profile History linkage ratios applied to the Auto Compact watermark. */
const AUTO_COMPACT_HISTORY_RATIOS = Object.freeze({
	balanced: Object.freeze({
		trigger: .625,
		minReclaim: .12,
		keepRecentTokens: .08
	}),
	savings: Object.freeze({
		trigger: .5,
		minReclaim: .16,
		keepRecentTokens: .08
	}),
	"cache-strict": Object.freeze({
		trigger: .75,
		minReclaim: .16,
		keepRecentTokens: .08
	}),
	adaptive: Object.freeze({
		trigger: .625,
		minReclaim: .12,
		keepRecentTokens: .08
	}),
	"tokenpilot-inspired": Object.freeze({
		trigger: .625,
		minReclaim: .12,
		keepRecentTokens: .08
	})
});
/** Micro-compact last-chance ratio: `D = floor(A × 0.875)`. */
const MICRO_DEADLINE_RATIO = .875;
/**
* TokenPilot-inspired sub-capability defaults. Every capability is on except
* the estimator, which requires an explicit endpoint channel (host or direct)
* before any consumer may leave its rule-only fallback.
*/
const PRESET_OPTION_DEFAULTS = deepFreeze({
	noNetSavingsGuard: true,
	skipReductionRecovery: true,
	dedupeToolResults: true,
	summaryLocator: true,
	prefixStabilizer: true,
	readState: true,
	estimator: { mode: "" },
	advisor: {
		mode: "",
		timeoutMs: 8e3,
		refreshTurns: 8,
		scoreThreshold: .35,
		sampleLimit: 16,
		minTokens: 250
	}
});
/**
* Merge persisted presetOptions overrides over the tokenpilot-inspired
* defaults. Persisted booleans are three-state (undefined = inherit); the
* estimator channel overrides the default empty mode wholesale.
*/
function mergePresetOptions(overrides) {
	if (overrides === void 0) return PRESET_OPTION_DEFAULTS;
	return deepFreeze({
		noNetSavingsGuard: true,
		skipReductionRecovery: true,
		dedupeToolResults: overrides.dedupeToolResults ?? PRESET_OPTION_DEFAULTS.dedupeToolResults,
		summaryLocator: overrides.summaryLocator ?? PRESET_OPTION_DEFAULTS.summaryLocator,
		prefixStabilizer: overrides.prefixStabilizer ?? PRESET_OPTION_DEFAULTS.prefixStabilizer,
		readState: overrides.readState ?? PRESET_OPTION_DEFAULTS.readState,
		estimator: { mode: overrides.estimatorMode ?? PRESET_OPTION_DEFAULTS.estimator.mode },
		advisor: {
			mode: overrides.advisorMode ?? PRESET_OPTION_DEFAULTS.advisor.mode,
			timeoutMs: overrides.advisorTimeoutMs ?? PRESET_OPTION_DEFAULTS.advisor.timeoutMs,
			refreshTurns: overrides.advisorRefreshTurns ?? PRESET_OPTION_DEFAULTS.advisor.refreshTurns,
			scoreThreshold: overrides.advisorScoreThreshold ?? PRESET_OPTION_DEFAULTS.advisor.scoreThreshold,
			sampleLimit: overrides.advisorSampleLimit ?? PRESET_OPTION_DEFAULTS.advisor.sampleLimit,
			minTokens: overrides.advisorMinTokens ?? PRESET_OPTION_DEFAULTS.advisor.minTokens
		}
	});
}
/**
* Resolve the Auto-Compact-linked History watermarks for one standard profile.
*
* `A = floor(C × a)` is the Auto Compact token watermark for the routed
* context window `C` and the user threshold `a = p / 100`; the History
* trigger, minimum reclaim, and recent-token tail scale with `A`, and the
* micro-compact last-chance deadline is `D = floor(A × 0.875)`. At the shipped
* defaults (`C = 1,000,000`, `p = 80`) the ratios reproduce the previous fixed
* preset numbers exactly. Custom stays manual and Off/Native run no History,
* so none of them link.
*/
function resolveAutoCompactLinkage(profile, options) {
	const ratios = profile === "custom" ? void 0 : AUTO_COMPACT_HISTORY_RATIOS[profile];
	const contextWindow = options.contextWindowTokens;
	const threshold = options.autoCompactThresholdPercent;
	if (ratios === void 0) return void 0;
	if (!isValidAutoCompactThresholdPercent(threshold)) return void 0;
	if (!Number.isSafeInteger(contextWindow) || contextWindow === void 0 || contextWindow <= 0) return void 0;
	const autoCompactTokens = Math.floor(contextWindow * (threshold / 100));
	if (!Number.isSafeInteger(autoCompactTokens) || autoCompactTokens <= 0) return void 0;
	const linked = {
		autoCompactTokens,
		microDeadlineTokens: Math.floor(autoCompactTokens * MICRO_DEADLINE_RATIO),
		historyTriggerTokens: Math.floor(ratios.trigger * autoCompactTokens),
		historyMinReclaimTokens: Math.floor(ratios.minReclaim * autoCompactTokens),
		historyKeepRecentTokens: Math.floor(ratios.keepRecentTokens * autoCompactTokens)
	};
	for (const value of Object.values(linked)) if (!Number.isSafeInteger(value) || value <= 0) return void 0;
	return linked;
}
/**
* Resolve one public profile into a complete mixed-strategy policy.
* @param config - validated composition configuration.
* @param profile - profile frozen for the target Session.
* @param custom - versioned Custom document used only by the `custom` profile.
* @param options - routed capacity and the frozen Auto Compact threshold used
* to resolve context-percent Custom values and standard-profile linkage.
* @returns the effective deterministic compression policy.
*/
function resolvePolicy(config, profile, custom = DEFAULT_CUSTOM_COMPRESSION_POLICY, options = {}) {
	if (profile === "custom") return resolveCustomPolicy(custom, options);
	const preset = {
		off: {
			nativeToolResultEnabled: false,
			freshEnabled: false,
			aggregateEnabled: false,
			historyMode: "disabled",
			nativeTriggerTokens: Number.MAX_SAFE_INTEGER,
			nativeTargetTokens: Number.MAX_SAFE_INTEGER,
			freshTriggerTokens: Number.MAX_SAFE_INTEGER,
			freshTargetTokens: Number.MAX_SAFE_INTEGER,
			aggregateTriggerTokens: Number.MAX_SAFE_INTEGER,
			aggregateTargetTokens: Number.MAX_SAFE_INTEGER,
			historyTriggerTokens: Number.MAX_SAFE_INTEGER,
			historyKeepRecentToolCalls: 10,
			historyKeepRecentTokens: 64e3,
			historyMinReclaimTokens: Number.MAX_SAFE_INTEGER
		},
		native: {
			nativeToolResultEnabled: true,
			freshEnabled: false,
			aggregateEnabled: false,
			historyMode: "disabled",
			nativeTriggerTokens: 4096,
			nativeTargetTokens: 2048,
			freshTriggerTokens: Number.MAX_SAFE_INTEGER,
			freshTargetTokens: Number.MAX_SAFE_INTEGER,
			aggregateTriggerTokens: Number.MAX_SAFE_INTEGER,
			aggregateTargetTokens: Number.MAX_SAFE_INTEGER,
			historyTriggerTokens: Number.MAX_SAFE_INTEGER,
			historyKeepRecentToolCalls: 10,
			historyKeepRecentTokens: 64e3,
			historyMinReclaimTokens: Number.MAX_SAFE_INTEGER
		},
		balanced: {
			nativeToolResultEnabled: false,
			freshEnabled: true,
			aggregateEnabled: true,
			historyMode: "routine",
			nativeTriggerTokens: Number.MAX_SAFE_INTEGER,
			nativeTargetTokens: Number.MAX_SAFE_INTEGER,
			freshTriggerTokens: 8192,
			freshTargetTokens: 3072,
			aggregateTriggerTokens: 32768,
			aggregateTargetTokens: 12288,
			historyTriggerTokens: 5e5,
			historyKeepRecentToolCalls: 10,
			historyKeepRecentTokens: 64e3,
			historyMinReclaimTokens: 96e3
		},
		"cache-strict": {
			nativeToolResultEnabled: false,
			freshEnabled: true,
			aggregateEnabled: true,
			historyMode: "capacity-pressure",
			nativeTriggerTokens: Number.MAX_SAFE_INTEGER,
			nativeTargetTokens: Number.MAX_SAFE_INTEGER,
			freshTriggerTokens: 8192,
			freshTargetTokens: 3072,
			aggregateTriggerTokens: 32768,
			aggregateTargetTokens: 12288,
			historyTriggerTokens: 6e5,
			historyKeepRecentToolCalls: 10,
			historyKeepRecentTokens: 64e3,
			historyMinReclaimTokens: 128e3
		},
		savings: {
			nativeToolResultEnabled: false,
			freshEnabled: true,
			aggregateEnabled: true,
			historyMode: "routine",
			nativeTriggerTokens: Number.MAX_SAFE_INTEGER,
			nativeTargetTokens: Number.MAX_SAFE_INTEGER,
			freshTriggerTokens: 4096,
			freshTargetTokens: 1536,
			aggregateTriggerTokens: 16384,
			aggregateTargetTokens: 4096,
			historyTriggerTokens: 4e5,
			historyKeepRecentToolCalls: 10,
			historyKeepRecentTokens: 64e3,
			historyMinReclaimTokens: 128e3
		},
		adaptive: {
			nativeToolResultEnabled: false,
			freshEnabled: true,
			aggregateEnabled: true,
			historyMode: "adaptive",
			nativeTriggerTokens: Number.MAX_SAFE_INTEGER,
			nativeTargetTokens: Number.MAX_SAFE_INTEGER,
			freshTriggerTokens: 8192,
			freshTargetTokens: 3072,
			aggregateTriggerTokens: 32768,
			aggregateTargetTokens: 12288,
			historyTriggerTokens: 5e5,
			historyKeepRecentToolCalls: 10,
			historyKeepRecentTokens: 64e3,
			historyMinReclaimTokens: 96e3
		},
		"tokenpilot-inspired": {
			nativeToolResultEnabled: false,
			freshEnabled: true,
			aggregateEnabled: true,
			historyMode: "routine",
			nativeTriggerTokens: Number.MAX_SAFE_INTEGER,
			nativeTargetTokens: Number.MAX_SAFE_INTEGER,
			freshTriggerTokens: 8192,
			freshTargetTokens: 3072,
			aggregateTriggerTokens: 32768,
			aggregateTargetTokens: 12288,
			historyTriggerTokens: 5e5,
			historyKeepRecentToolCalls: 10,
			historyKeepRecentTokens: 64e3,
			historyMinReclaimTokens: 96e3
		}
	}[profile];
	const linkage = resolveAutoCompactLinkage(profile, options);
	const policy = {
		profile,
		...preset,
		nativeTriggerTokens: config.nativeTriggerTokens ?? preset.nativeTriggerTokens,
		nativeTargetTokens: config.nativeTargetTokens ?? preset.nativeTargetTokens,
		freshTriggerTokens: config.freshTriggerTokens ?? preset.freshTriggerTokens,
		freshTargetTokens: config.freshTargetTokens ?? preset.freshTargetTokens,
		aggregateTriggerTokens: config.aggregateTriggerTokens ?? preset.aggregateTriggerTokens,
		aggregateTargetTokens: config.aggregateTargetTokens ?? preset.aggregateTargetTokens,
		historyTriggerTokens: config.historyTriggerTokens ?? linkage?.historyTriggerTokens ?? preset.historyTriggerTokens,
		historyKeepRecentToolCalls: config.historyKeepRecentToolCalls ?? preset.historyKeepRecentToolCalls,
		historyKeepRecentTokens: config.historyKeepRecentTokens ?? linkage?.historyKeepRecentTokens ?? preset.historyKeepRecentTokens,
		historyMinReclaimTokens: config.historyMinReclaimTokens ?? linkage?.historyMinReclaimTokens ?? preset.historyMinReclaimTokens,
		...config.readInputCapChars === void 0 ? {} : { readInputCapChars: config.readInputCapChars },
		...linkage === void 0 ? {} : {
			autoCompactTokens: linkage.autoCompactTokens,
			microDeadlineTokens: linkage.microDeadlineTokens
		},
		...profile === "tokenpilot-inspired" ? { presetOptions: mergePresetOptions(config.presetOptions) } : {}
	};
	if (policy.nativeTargetTokens >= policy.nativeTriggerTokens && profile === "native") throw new Error("context compression policy: native target must be below trigger");
	if (policy.freshTargetTokens >= policy.freshTriggerTokens && policy.freshEnabled) throw new Error("context compression policy: fresh target must be below trigger");
	if (policy.aggregateTargetTokens >= policy.aggregateTriggerTokens && policy.freshEnabled) throw new Error("context compression policy: aggregate target must be below trigger");
	if (policy.readInputCapChars !== void 0 && policy.readInputCapChars <= policy.freshTriggerTokens * 4) throw new Error("context compression policy: read input cap would silence the fresh path");
	return deepFreeze(policy);
}
function assertTargetBelowTrigger(label, target, trigger) {
	if (target === void 0 !== (trigger === void 0)) throw new Error(`ToolResultPruneConfig: ${label} target and trigger tokens must be provided together`);
	if (target !== void 0 && trigger !== void 0 && target >= trigger) throw new Error(`ToolResultPruneConfig: ${label} target tokens must be below trigger tokens`);
}
function assertPositiveInteger(name, value) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`ToolResultPruneConfig: ${name} (${String(value)}) must be a positive safe integer`);
}
function assertNonNegativeInteger(name, value) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`ToolResultPruneConfig: ${name} (${String(value)}) must be a non-negative safe integer`);
}
//#endregion
export { getObservedIntentEnabled as A, priceOfficialDeepSeekUsage as B, isSessionOverrideAction as C, evaluateIntentGate as D, INTENT_GATE_GROWTH_TOKENS as E, recordRecertified as F, getSavingsLedger as H, recordScore as I, setSummaryOverride as L, invalidateOnTaskChange as M, observeIntentEnabled as N, getAdvisorState as O, recordIntentFold as P, DEEPSEEK_OFFICIAL_PRICE_CATALOG_VERSION as R, estimateSavingsPricing as S, INTENT_GATE_FLOOR_FRACTION as T, resolveOfficialDeepSeekPrice as V, assertNever as _, PRUNE_MARKER as a, applySessionOverride as b, codePointLength as c, parseContextCompressionSettings as d, resolveConfig as f, resolveCustomPolicy as g, DEFAULT_CUSTOM_COMPRESSION_POLICY as h, DEFAULTS as i, getSummaryOverride as j, getLastIntentFold as k, isCompressionProfile as l, CustomCompressionPolicySchema as m, CONTEXT_COMPRESSION_SETTINGS_NAMESPACE as n, charsForTokens as o, resolvePolicy as p, ContextCompressionSettingsSchema as r, charsToTokens as s, AUTO_COMPACT_THRESHOLD_LIMITS as t, isValidAutoCompactThresholdPercent as u, deepFreeze as v, observeContextUsage as w, buildMonitorSnapshot as x, COMPRESSION_PROFILES as y, decimalRateNanoUnits as z };
