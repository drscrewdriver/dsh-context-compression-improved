import { n as viewToolResult, s as sessionEvents } from "./tool-result.js";
import z from "@deepseek-ai/schemastery";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Tokenizer } from "@huggingface/tokenizers";
import zlib from "node:zlib";
import * as dshSessionNamespace from "@deepseek-ai/dsh-session";
import { mkdir } from "node:fs/promises";
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
* 存储:本账本是**存量仪表**层(进程内 per-session,环形缓冲 + hash 注册表,
* 重启归零——重进会话由投影播种重建)。统计口径共三层:
*  1. 存量仪表(本账本):当前 surface 生效的毛节省/抵消/净额,随内容进出涨落;
*  2. 持久 claims 流水(stats-sync → stats-db):land/retrieve/usage 事件级幂等
*     行落库,跨重启保留,作审计与面板累计数据源;
*  3. 累计积分(savings-integral,fresh 边界按 call 采样存量净额入库):回答
*     "历史上省了多少",随 T15 积分器落地。
*
* 存量/流量分离(记账口径三件套):
*  - offset 条目可带 sourceSeq,observeActive 按"召回文本存活面"收敛,离面即停罚;
*  - 同 basis 召回经 foldRecall 折叠进源条目(贡献 a−(b+R),下限 −b,翻负后带
*    negative-effect 标记供分项显示);跨 basis 禁折叠,退化为带 sourceSeq 的
*    收敛 offset,守住"口径分列永不合并"原则;
*  - 环形缓冲溢出优先淘汰离面/无源条目,replacementSeq 仍在面上的 saving 绝不清。
*
* @module dsh-context-compression-improved/runtime/savings
*/
const MAX_ENTRIES_PER_SESSION = 800;
const MAX_REGISTRY = 2048;
var SavingsLedger = class {
	entries = /* @__PURE__ */ new Map();
	registry = /* @__PURE__ */ new Map();
	seenFullText = /* @__PURE__ */ new Set();
	/** 最近一次 observeActive 传入的存活 seq(驱逐保护判据;缺省 = 保守保护)。 */
	lastLiveSeqs = /* @__PURE__ */ new Map();
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
	/**
	* 记录一次已落盘的压缩节省(land 成功后调用;tokensRemoved ≤ 0 忽略)。
	*
	* 仪表口径:该条目在替换事件离开当前 surface 前一直计入"当前生效毛节省"
	* (由 {@link observeActive} 每回合收敛),不再一次性永久累加。
	*/
	recordSaving(input) {
		const removed = input.tokensBefore - input.tokensAfter;
		if (!Number.isFinite(removed) || removed <= 0) return;
		this.push(input.sessionId, {
			kind: "saving",
			component: input.component,
			tokens: removed,
			basis: input.basis,
			at: Date.now(),
			sourceSeq: input.sourceSeq,
			foldFloor: -Math.max(0, input.tokensAfter),
			...input.replacementSeq === void 0 ? {} : { replacementSeq: input.replacementSeq }
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
		if (hit === void 0 || hit.sessionId !== input.sessionId) return;
		const { tokens, basis } = input.measure(input.text);
		if (tokens <= 0) return;
		this.push(input.sessionId, {
			kind: "offset",
			component: "full-read",
			tokens,
			basis,
			at: Date.now(),
			sourceSeq: input.seq,
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
			...input.sourceSeq === void 0 ? {} : { sourceSeq: input.sourceSeq },
			...input.note === void 0 ? {} : { note: input.note }
		});
	}
	/**
	* 召回翻负折叠:把一次召回(实测 R)折进同 (sessionId, sourceSeq, basis) 的源
	* saving 条目:贡献 a−(b+R),下限 −b(多次召回累计不再下探)。翻负后条目带
	* negative-effect 标记,snapshot 分项里以负值呈现,净额与旧行为(毛节省 +(a−b)
	* 叠加流水 −R)等值。
	*
	* 跨 basis 不折叠(口径分列永不合并):退化为带 sourceSeq 的收敛 offset,
	* 下一次 observeActive 即离面停罚。未找到源条目(已离面/投影播种无配对键)同路。
	*
	* @returns 是否折进了源条目(false = 走了退化 offset 流水或无效入参)。
	*/
	foldRecall(sessionId, sourceSeq, recalledTokens, basis, fallback) {
		if (!Number.isFinite(recalledTokens) || recalledTokens <= 0) return false;
		const list = this.entries.get(sessionId);
		if (list !== void 0) for (let i = list.length - 1; i >= 0; i--) {
			const entry = list[i];
			if (entry.kind !== "saving" || entry.sourceSeq !== sourceSeq || entry.basis !== basis) continue;
			entry.tokens = Math.max(entry.tokens - recalledTokens, entry.foldFloor ?? 0);
			if (entry.tokens < 0) entry.negativeEffect = true;
			return true;
		}
		this.push(sessionId, {
			kind: "offset",
			component: fallback?.component ?? "retrieve",
			tokens: recalledTokens,
			basis,
			at: Date.now(),
			sourceSeq,
			...fallback?.note === void 0 ? {} : { note: fallback.note }
		});
		return false;
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
		if (list.length <= MAX_ENTRIES_PER_SESSION) return;
		const live = this.lastLiveSeqs.get(sessionId);
		while (list.length > MAX_ENTRIES_PER_SESSION) {
			const idx = list.findIndex((candidate) => !isSurfaceProtected(candidate, live));
			if (idx === -1) break;
			list.splice(idx, 1);
		}
	}
	/**
	* 仪表口径收敛:
	*  - 'saving' 条目只在其替换事件仍位于当前 surface 时计为"当前生效毛节省",
	*    离开 surface 即从毛节省中扣除;无 replacementSeq 的保持原样(无法追踪者不收敛)。
	*  - 带 sourceSeq 的 'offset' 条目按"召回文本存活面"收敛:sourceSeq 离面即停罚
	*    (full-read = 重读事件自身);无 sourceSeq 的 offset 保持原样(永久流水)。
	*/
	observeActive(sessionId, liveSeqs) {
		this.lastLiveSeqs.set(sessionId, liveSeqs);
		const list = this.entries.get(sessionId);
		if (list === void 0) return;
		const kept = list.filter((entry) => {
			if (entry.kind === "saving") return entry.replacementSeq === void 0 || liveSeqs.has(entry.replacementSeq);
			return entry.sourceSeq === void 0 || liveSeqs.has(entry.sourceSeq);
		});
		if (kept.length !== list.length) this.entries.set(sessionId, kept);
	}
	/** 该会话是否已有账本条目(重进会话时用于避免投影与实时叠加)。 */
	hasSession(sessionId) {
		return this.entries.has(sessionId);
	}
	/**
	* 用会话日志投影播种一个会话的账本(重进/重启会话时调用一次)。写入
	* savings/offsets 条目及其原文配对 registry,后续实时增量(observeActive /
	* noteFullText)在同一条目集合上继续工作。调用方负责只播种一次。
	*/
	seedProjected(sessionId, projection) {
		for (const entry of projection.savings) {
			if (!Number.isFinite(entry.tokens) || entry.tokens <= 0) continue;
			this.push(sessionId, {
				kind: "saving",
				component: entry.component,
				tokens: entry.tokens,
				basis: entry.basis,
				at: entry.at,
				replacementSeq: entry.replacementSeq
			});
		}
		for (const entry of projection.offsets) {
			if (!Number.isFinite(entry.tokens) || entry.tokens <= 0) continue;
			this.push(sessionId, {
				kind: "offset",
				component: entry.component,
				tokens: entry.tokens,
				basis: entry.basis,
				at: entry.at,
				...entry.note === void 0 ? {} : { note: entry.note }
			});
		}
		for (const item of projection.registry) {
			if (this.registry.size >= MAX_REGISTRY && !this.registry.has(item.hash)) {
				const oldest = this.registry.keys().next().value;
				if (oldest !== void 0) this.registry.delete(oldest);
			}
			this.registry.set(item.hash, {
				sessionId,
				component: "projection",
				claimedTokens: item.claimedTokens,
				basis: item.basis,
				sourceSeq: item.sourceSeq,
				consumed: false
			});
		}
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
			if (entry.kind === "saving" && entry.tokens >= 0) {
				if (exact) totals.grossExact += entry.tokens;
				else totals.grossEstimated += entry.tokens;
			} else if (entry.kind === "saving") {
				if (exact) totals.offsetExact += -entry.tokens;
				else totals.offsetEstimated += -entry.tokens;
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
		this.lastLiveSeqs.clear();
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
/**
* 驱逐保护判据:'saving' 条目的 replacementSeq 仍在当前面上(或面信息未知时
* 保守视为在面)则绝不清;其余(离面/无追踪键的 saving、一切 offset)可驱逐。
*/
function isSurfaceProtected(entry, live) {
	return entry.kind === "saving" && entry.replacementSeq !== void 0 && (live === void 0 || live.has(entry.replacementSeq));
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
* 组成按压缩路径去重合并:同路径跨口径(mixed = 精确+估算混合)一行,
* tokens 降序。重复行是口径拆分的产物,不是两条不同路径。
*/
function mergeCompositionByComponent(rows) {
	const byComponent = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const found = byComponent.get(row.component);
		if (found === void 0) byComponent.set(row.component, { ...row });
		else {
			found.tokens += row.tokens;
			found.events += row.events;
			if (found.basis !== row.basis) found.basis = "mixed";
		}
	}
	return [...byComponent.values()].sort((a, b) => b.tokens - a.tokens);
}
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
/**
* 「每次从头开始计算」(用户定标):三值与最后 Δ 全量重导自 DRS 投影替换对——
* 毛 = Σ(a−b) 仅压缩对(不含回吐);抵消 = Σb 仅召回对;净 = 毛 − 抵消(含回吐,
* 有召回时净必异于毛)。basis=ds-token 落 exact 臂;chars/4 落 estimated 臂
* (浮窗 est 标注如实)。同会话同对子,输出确定——单一来源,不再与 claims 残账分裂。
*/
function drsTotalsFragment(index) {
	let gross = 0;
	let recall = 0;
	let saving;
	let offset;
	for (const pair of index.pairs) if (pair.kind === "compress") {
		gross += pair.aTokens - pair.bTokens;
		if (saving === void 0 || pair.seq > saving.seq) saving = {
			tokens: pair.aTokens - pair.bTokens,
			seq: pair.seq
		};
	} else {
		recall += pair.bTokens;
		if (offset === void 0 || pair.seq > offset.seq) offset = {
			tokens: pair.bTokens,
			seq: pair.seq
		};
	}
	const exact = index.basis === "ds-token";
	const arm = (value) => exact ? {
		exact: value,
		estimated: 0
	} : {
		exact: 0,
		estimated: value
	};
	const lastDelta = saving === void 0 && offset === void 0 ? void 0 : {
		...saving === void 0 ? {} : { saving },
		...offset === void 0 ? {} : { offset }
	};
	return {
		sessionTotals: {
			gross: arm(gross),
			offsets: arm(recall),
			net: arm(gross - recall)
		},
		...lastDelta === void 0 ? {} : { lastDelta }
	};
}
//#endregion
//#region src/deepseek-v4-tokenizer.ts
/** Offline DeepSeek tokenizers backed by pinned official Hugging Face assets. */
const TOKENIZER_ID = "deepseek-ai/DeepSeek-V4-Pro";
const TOKENIZER_REVISION = "0e1a0e5e52aea73055f50fef6f2423db370265b6";
const TOKENIZER_SHA256 = "8f9f37ca37fdc4f5fd36d5cf4d3b0e8392edb4e894fd10cc0d70b4957c8633cf";
const CONFIG_SHA256 = "6ac8c8dc065ed118161d02dd532749ae3f52c243deac27872134fae2f50d8547";
const VISION_TOKENIZER_ID = "deepseek-ai/DeepSeek-V4-Flash-Vision-Exp";
const VISION_TOKENIZER_REVISION = "6821d6ad3681a4b137b066b76094fa82ebd0a380";
const VISION_TOKENIZER_SHA256 = "c90dfa01249db1be4245780a052ede752e1361c612ac6d08e2bdada7d599476b";
const VISION_CONFIG_SHA256 = "6ac8c8dc065ed118161d02dd532749ae3f52c243deac27872134fae2f50d8547";
/** Auditable origin and compatibility mapping for the bundled V4 Pro tokenizer. */
const DEEPSEEK_V4_TOKENIZER_ARTIFACT = Object.freeze({
	repository: TOKENIZER_ID,
	revision: TOKENIZER_REVISION,
	license: "MIT",
	tokenizerSha256: TOKENIZER_SHA256,
	tokenizerConfigSha256: CONFIG_SHA256,
	modelIds: Object.freeze(["deepseek-v4-flash", "deepseek-v4-pro"])
});
/**
* Auditable origin and compatibility mapping for the bundled V4 Flash Vision
* tokenizer. The vision repository ships a distinct `tokenizer.json` (it adds
* the `<｜deepseek_image｜>` special token), so the vision model must never be
* mapped onto the V4 Pro tokenizer as an alias.
*/
const DEEPSEEK_VISION_TOKENIZER_ARTIFACT = Object.freeze({
	repository: VISION_TOKENIZER_ID,
	revision: VISION_TOKENIZER_REVISION,
	license: "MIT",
	tokenizerSha256: VISION_TOKENIZER_SHA256,
	tokenizerConfigSha256: VISION_CONFIG_SHA256,
	modelIds: Object.freeze(["deepseek-v4-flash-vision-exp"])
});
/**
* Every bundled artifact is registered with independent asset roots, integrity
* manifests, and cache entries: one corrupted artifact must never disable the
* tokenizer serving the other model family.
*/
const ARTIFACTS = Object.freeze([Object.freeze({
	origin: DEEPSEEK_V4_TOKENIZER_ARTIFACT,
	assetRoot: new URL("../assets/deepseek-v4/", import.meta.url),
	integrity: Object.freeze({
		tokenizer: Object.freeze({
			bytes: 6367146,
			sha256: TOKENIZER_SHA256
		}),
		config: Object.freeze({
			bytes: 801,
			sha256: CONFIG_SHA256
		})
	})
}), Object.freeze({
	origin: DEEPSEEK_VISION_TOKENIZER_ARTIFACT,
	assetRoot: new URL("../assets/deepseek-v4-vision-exp/", import.meta.url),
	integrity: Object.freeze({
		tokenizer: Object.freeze({
			bytes: 6367257,
			sha256: VISION_TOKENIZER_SHA256
		}),
		config: Object.freeze({
			bytes: 801,
			sha256: VISION_CONFIG_SHA256
		})
	})
})]);
const registryCache = /* @__PURE__ */ new Map();
function artifactForModel(modelId) {
	return ARTIFACTS.find((artifact) => artifact.origin.modelIds.includes(modelId));
}
/**
* Resolve the shared offline tokenizer for one compatible API model.
* Unknown models and a cached asset/runtime failure return `undefined`; callers
* must report unavailable instead of manufacturing a character estimate.
* @param modelId - exact DeepSeek API wire model id.
* @returns the shared verified tokenizer, or undefined when unsupported/unavailable.
*/
function deepSeekV4TokenizerForModel(modelId) {
	const artifact = artifactForModel(modelId);
	if (artifact === void 0) return void 0;
	const cached = registryCache.get(artifact.origin);
	if (cached !== void 0) return cached.tokenizer;
	let entry;
	try {
		entry = { tokenizer: createDeepSeekV4TokenizerFromAssets(artifact.assetRoot, artifact.integrity, artifact.origin) };
	} catch (error) {
		entry = { failure: error instanceof Error ? error.message : String(error) };
	}
	registryCache.set(artifact.origin, entry);
	return entry.tokenizer;
}
/**
* Build a tokenizer from one local asset directory after byte/hash validation.
* This provider-private seam exists so tests can prove every failure branch
* without mutating the committed artifact.
* @param assetRoot - local URL containing tokenizer.json and tokenizer_config.json.
* @param integrity - expected byte length and SHA-256 for both files.
* @param origin - auditable identity recorded on every returned count.
* @returns a synchronous exact text counter.
* @internal
*/
function createDeepSeekV4TokenizerFromAssets(assetRoot, integrity, origin = DEEPSEEK_V4_TOKENIZER_ARTIFACT) {
	const tokenizerJson = readVerifiedJson(assetRoot, "tokenizer.json", integrity.tokenizer);
	const tokenizerConfig = readVerifiedJson(assetRoot, "tokenizer_config.json", integrity.config);
	const runtime = new Tokenizer(tokenizerJson, tokenizerConfig);
	return Object.freeze({ countText(text) {
		const tokens = runtime.encode(text, { add_special_tokens: false }).ids.length;
		return Object.freeze({
			kind: "exact-tokenizer",
			tokens,
			tokenizerId: origin.repository,
			tokenizerRevision: origin.revision
		});
	} });
}
function readVerifiedJson(assetRoot, name, descriptor) {
	const bytes = readFileSync(new URL(name, assetRoot));
	if (bytes.byteLength !== descriptor.bytes) throw new Error(`DeepSeek tokenizer asset ${name} has ${String(bytes.byteLength)} bytes; expected ${String(descriptor.bytes)}`);
	if (createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256) throw new Error(`DeepSeek tokenizer asset ${name} failed SHA-256 verification`);
	const parsed = JSON.parse(bytes.toString("utf8"));
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`DeepSeek tokenizer asset ${name} must contain a JSON object`);
	return parsed;
}
//#endregion
//#region src/runtime/session-file-decode.ts
/**
* 会话日志文件的只读解码叶子模块（回填后端 B 的格式底座，T19）。
*
* **零内部依赖**：只 import `node:*` 内置模块，不引用本插件任何其他 runtime 模块，
* 供 `stats-backfill.ts`（后端 B）与测试直接消费；断代风险被隔离在本文件内。
*
* 移植自 dsh-session-steward 的 `host/health/generation.ts` + `decode.ts`
* （代次文件名契约 + zstd 多帧/撕裂尾帧/打包行/provenance 解码链），
* 并按本仓 D7 静态门做纪律适配：
* - 源码（含注释）不得出现「session+裸点+jsonl」的连续字面量，也不得以任何
*   大小写/驼峰形态写出宿主的格式版本常量名（检查器扫 src/lib/dist 三类命中，
*   本注释自身就是最后一个命中点，所以只能用描述式写法）；
*   历史代文件名一律拼接构造（与 SS 生产代码同技巧），正则内转义点不触发。
* - **header 代次未知 → fail-soft**：本模块只解码不裁决，提供
*   `classifySessionHeader`；调用方（回填）据此跳过该会话 + 一次性 warn，
*   绝不整体抛。
*
* 只读纪律：本模块绝不写会话文件（SS 红线先例）。
*/
/**
* 规范日志名的语法（不含压缩后缀），与宿主 session-format 的 filename 检查器
* 逐字一致：代次 0 不带版本号，后续代次必须是小写数字且无前导零；
* `.v0`、`.v01`、`.V1`、`session.v1.backup` 变体都不识别为规范代次。
*/
const CANONICAL_LOG_BASENAME = /^session(?:\.v([1-9][0-9]*))?\.jsonl$/u;
/**
* 迁移暂存名的语法（宿主发布路径的暂存形状 `session.migration.<hex>.jsonl[.zstd].tmp`，
* token 位数是宿主内部细节，这里只固定形状，宿主换 token 长度时不失明）。
*/
const MIGRATION_STAGING_NAME = /^session\.migration\.[0-9a-f]+\.jsonl(?:\.zstd)?\.tmp$/u;
function compressionSuffix(compression) {
	return compression === "zstd" ? ".zstd" : "";
}
/**
* 把一个规范日志名解析回代次；与宿主同语义：非规范名（临时、大写、前导零、
* `.v0`、别的压缩后缀）一律返回 undefined，**不猜**。
* @param filename - 会话目录里的一个文件名。
* @param compression - 该目录使用的物理编码（缺省 zstd）。
* @returns 其格式代次，或名字不构成规范代次时的 undefined。
*/
function parseGenerationLogFilename(filename, compression = "zstd") {
	const suffix = compressionSuffix(compression);
	if (!filename.endsWith(suffix)) return void 0;
	const match = CANONICAL_LOG_BASENAME.exec(filename.slice(0, filename.length - suffix.length));
	if (match === null) return void 0;
	if (match[1] === void 0) return 0;
	const version = Number(match[1]);
	return Number.isSafeInteger(version) ? version : void 0;
}
/**
* 两种压缩编码都试一遍，判定该名字是不是某代的规范产物。
* 发现路径不假设部署的压缩配置（配置在 profile 侧，插件读不到），按名字本身分类。
* @param filename - 会话目录里的一个文件名。
* @returns 代次与编码，或该名字不是规范代次时的 undefined。
*/
function classifyGenerationFilename(filename) {
	const zstd = parseGenerationLogFilename(filename, "zstd");
	if (zstd !== void 0) return {
		version: zstd,
		compression: "zstd"
	};
	const none = parseGenerationLogFilename(filename, "none");
	if (none !== void 0) return {
		version: none,
		compression: "none"
	};
}
/**
* 该文件名是否是迁移暂存（当前代的发布源）。
* @param filename - 会话目录里的一个文件名。
* @returns 是否形如 `session.migration.<token>.jsonl[.zstd].tmp`。
*/
function isMigrationStagingFilename(filename) {
	return MIGRATION_STAGING_NAME.test(filename);
}
/**
* 读取一个会话目录的代次事实（只读，不碰任何文件内容）。
* 目录在枚举与读取之间消失（宿主正在删会话）时如实返回「没有产物」，不抛。
* @param dir - 会话目录的绝对路径。
* @returns 规范产物（按代次升序）、当前代、历史代与暂存残留。
*/
function readSessionGenerations(dir) {
	const canonical = [];
	const staging = [];
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return {
			canonical: [],
			staging: [],
			legacyOnly: false
		};
	}
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const path = join(dir, entry.name);
		let bytes;
		let mtimeMs;
		try {
			const stat = statSync(path);
			bytes = stat.size;
			mtimeMs = stat.mtimeMs;
		} catch {
			continue;
		}
		const artifact = {
			name: entry.name,
			path,
			bytes,
			mtimeMs
		};
		const generation = classifyGenerationFilename(entry.name);
		if (generation !== void 0) {
			canonical.push({
				...artifact,
				version: generation.version,
				compression: generation.compression
			});
			continue;
		}
		if (isMigrationStagingFilename(entry.name)) staging.push(artifact);
	}
	canonical.sort((left, right) => left.version - right.version || left.mtimeMs - right.mtimeMs);
	staging.sort((left, right) => left.mtimeMs - right.mtimeMs);
	const current = canonical.at(-1);
	const legacy = canonical.find((artifact) => artifact.version === 0);
	return {
		canonical,
		staging,
		...current === void 0 ? {} : { current },
		...legacy === void 0 ? {} : { legacy },
		legacyOnly: canonical.length > 0 && current?.version === 0
	};
}
/** zstd 帧魔数（0xFD2FB528 的小端读取值）。 */
const ZSTD_MAGIC = 4247762216;
/** 打包行类型（读路径必须解包）。 */
const PACKED_ROWS = /* @__PURE__ */ new Set([
	"text-chunks",
	"reasoning-chunks",
	"tool-call-chunks"
]);
/** 扫描拼接的 zstd 多帧；返回完整帧范围与撕裂尾帧起点。 */
function scanZstdFrames(buffer) {
	const frames = [];
	let offset = 0;
	while (offset < buffer.length) {
		const start = offset;
		if (buffer.length - offset < 4) return {
			frames,
			tornStart: start
		};
		if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return {
			frames,
			tornStart: start
		};
		offset += 4;
		if (offset === buffer.length) return {
			frames,
			tornStart: start
		};
		const descriptor = buffer.readUInt8(offset);
		offset += 1;
		if ((descriptor & 24) !== 0) return {
			frames,
			tornStart: start
		};
		const contentSizeFlag = descriptor >>> 6;
		const singleSegment = (descriptor & 32) !== 0;
		const checksum = (descriptor & 4) !== 0;
		const dictionaryFlag = descriptor & 3;
		const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
		const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag;
		const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
		if (buffer.length - offset < remainingHeaderBytes) return {
			frames,
			tornStart: start
		};
		offset += remainingHeaderBytes;
		for (;;) {
			if (buffer.length - offset < 3) return {
				frames,
				tornStart: start
			};
			const blockHeader = buffer.readUIntLE(offset, 3);
			offset += 3;
			const lastBlock = (blockHeader & 1) !== 0;
			const blockType = blockHeader >>> 1 & 3;
			const blockSize = blockHeader >>> 3;
			if (blockType === 3) return {
				frames,
				tornStart: start
			};
			const payloadBytes = blockType === 1 ? 1 : blockSize;
			if (buffer.length - offset < payloadBytes) return {
				frames,
				tornStart: start
			};
			offset += payloadBytes;
			if (lastBlock) break;
		}
		if (checksum) {
			if (buffer.length - offset < 4) return {
				frames,
				tornStart: start
			};
			offset += 4;
		}
		frames.push({
			start,
			end: offset
		});
	}
	return { frames };
}
/** 存储形态的 provenance（`[[start,end],…]` 区间编码或直接 seq 数组）展开为递增 seq 列表。 */
function decodeSeqRangesStorage(value, currentSeq) {
	if (!Array.isArray(value)) throw new Error("sourceEventSeqs must be an array when present");
	const out = [];
	for (const entry of value) {
		if (typeof entry === "number") {
			out.push(entry);
			continue;
		}
		if (Array.isArray(entry) && entry.length === 2) {
			const [start, end] = entry;
			if (typeof start !== "number" || typeof end !== "number" || end < start) throw new Error("sourceEventSeqs range is malformed");
			for (let seq = start; seq <= end; seq += 1) out.push(seq);
			continue;
		}
		throw new Error("sourceEventSeqs entry is neither a seq nor a [start,end] range");
	}
	for (const seq of out) if (!Number.isSafeInteger(seq) || seq < 0 || seq >= currentSeq) throw new Error(`sourceEventSeqs must reference earlier events: ${seq} >= ${currentSeq}`);
	return out;
}
/**
* 按需软加载宿主的官方解码器；不可用（未安装/版本不符）时返回 undefined。
* 插件不 value-import 官方包，这里只做运行时可选加载。
*/
async function loadOfficialDecoders() {
	try {
		const mod = await import(
			/* @vite-ignore */
			"@deepseek-ai/dsh-session"
);
		if (typeof mod.decodeStorageRecord !== "function" || typeof mod.decodeSeqRanges !== "function") return void 0;
		return {
			decodeStorageRecord: mod.decodeStorageRecord,
			decodeSeqRanges: mod.decodeSeqRanges
		};
	} catch {
		return;
	}
}
/** 本地等价实现：把一行存储记录解包为事件（打包行展开为 assistant/chunk）。 */
function decodeRecordLocal(value) {
	if (typeof value !== "object" || value === null) return [value];
	const record = value;
	const type = record["type"];
	if (typeof type !== "string" || !PACKED_ROWS.has(type)) {
		const seq = record["seq"];
		if (typeof seq === "number" && (!Number.isSafeInteger(seq) || seq < 0)) throw new Error(`session event seq ${String(seq)} is not a non-negative safe integer`);
		return [record];
	}
	const data = record["data"];
	if (data === void 0) throw new Error(`malformed ${type} storage row: data must be an object`);
	const members = type === "tool-call-chunks" ? data["args"] : data["texts"];
	if (!Array.isArray(members) || members.length === 0 || members.some((entry) => typeof entry !== "string")) throw new Error(`malformed ${type} storage row: payload must be a non-empty string array`);
	const dt = data["dt"];
	if (!Array.isArray(dt) || dt.some((gap) => !Number.isSafeInteger(gap))) throw new Error(`malformed ${type} storage row: dt must be an array of safe integers`);
	if (dt.length !== members.length - 1) throw new Error(`malformed ${type} storage row: dt length ${dt.length} does not match ${members.length} members`);
	const seq0 = record["seq0"];
	const time0 = record["time0"];
	if (typeof seq0 !== "number" || typeof time0 !== "number") throw new Error(`malformed ${type} storage row: seq0/time0 must be numbers`);
	const turn = data["turn"];
	const step = data["step"];
	const index = data["index"];
	const out = [];
	let time = time0;
	for (let k = 0; k < members.length; k += 1) {
		if (k > 0) time += dt[k - 1];
		let chunk;
		if (type === "text-chunks") chunk = {
			type: "text-delta",
			index,
			text: members[k]
		};
		else if (type === "reasoning-chunks") chunk = {
			type: "reasoning-delta",
			index,
			text: members[k]
		};
		else chunk = {
			type: "tool-call-delta",
			index,
			id: typeof data["id"] === "string" ? data["id"] : "",
			...typeof data["name"] === "string" ? { name: data["name"] } : {},
			argumentsDelta: members[k]
		};
		out.push({
			type: "assistant/chunk",
			seq: seq0 + k,
			time,
			data: {
				turn,
				step,
				chunk
			}
		});
	}
	return out;
}
/**
* 解码一个会话日志（zstd 帧扫描 + 撕裂尾帧抢救 + 解包 + seq 连续性）。
* @param bytes - 文件内容（调用方读取，便于测试注入与 mtime/size 只读断言）。
* @param decoders - 可选官方解码器（缺省用本地等价实现；差异记入 decoder 字段，禁止静默回退）。
* @returns 事件、统计与问题清单。
*/
function decodeSessionLogBytes(bytes, decoders) {
	const { frames, tornStart } = scanZstdFrames(bytes);
	const parts = [];
	const frameIssues = [];
	for (const frame of frames) try {
		parts.push(zlib.zstdDecompressSync(bytes.subarray(frame.start, frame.end)));
	} catch (err) {
		frameIssues.push(`frame@${frame.start}: ${String(err instanceof Error ? err.message : err)}`);
	}
	let recoveredFromTorn = 0;
	if (tornStart !== void 0) try {
		const recovered = zlib.zstdDecompressSync(bytes.subarray(tornStart), { finishFlush: zlib.constants.ZSTD_e_flush });
		recoveredFromTorn = recovered.length;
		parts.push(recovered);
	} catch {}
	const lines = (() => {
		const payload = Buffer.concat(parts);
		if (payload.length === 0 && frames.length === 0 && bytes.length > 0) return bytes.toString("utf8");
		return payload.toString("utf8");
	})().split("\n").filter((line) => line.trim() !== "");
	const issues = frameIssues.map((why, index) => ({
		line: index + 1,
		why
	}));
	const decodeRecord = decoders?.decodeStorageRecord ?? decodeRecordLocal;
	const events = [];
	for (let index = 1; index < lines.length; index += 1) {
		const line = lines[index];
		let decoded;
		try {
			const parsed = JSON.parse(line);
			decoded = decodeRecord(parsed["sourceEventSeqs"] === void 0 ? parsed : {
				...parsed,
				sourceEventSeqs: decoders?.decodeSeqRanges !== void 0 && typeof parsed["seq"] === "number" ? decoders.decodeSeqRanges(parsed["sourceEventSeqs"], parsed["seq"]) : decodeSeqRangesStorage(parsed["sourceEventSeqs"], Number(parsed["seq"] ?? 0))
			});
		} catch (err) {
			issues.push({
				line: index + 1,
				why: `decode failed: ${String(err instanceof Error ? err.message : err)}`
			});
			break;
		}
		const rowStart = events.length;
		let gapped = false;
		for (const event of decoded) {
			if (event.seq !== events.length) {
				issues.push({
					line: index + 1,
					why: `seq gap (expected ${events.length}, got ${event.seq})`
				});
				events.length = rowStart;
				gapped = true;
				break;
			}
			events.push(event);
		}
		if (gapped) break;
	}
	const openStep = findOpenStep(events);
	let header;
	const headerLine = lines[0];
	if (headerLine !== void 0) try {
		const parsed = JSON.parse(headerLine);
		if (typeof parsed === "object" && parsed !== null) header = parsed;
	} catch {}
	return {
		events,
		frames: frames.length,
		...tornStart === void 0 ? {} : { tornStart },
		recoveredFromTorn,
		issues,
		decoder: decoders === void 0 ? "local" : "official",
		...openStep === void 0 ? {} : { openStep },
		...header === void 0 ? {} : { header }
	};
}
/** 尾部未收尾的 open step（有 step/start 无对应 step/end）。 */
function findOpenStep(events) {
	let open;
	for (const event of events) {
		const data = event.data;
		if (event.type === "step/start" && typeof data?.turn === "number" && typeof data?.step === "number") {
			open = {
				turn: data.turn,
				step: data.step
			};
			continue;
		}
		if (event.type === "step/end") open = void 0;
	}
	return open;
}
/** 本插件已实证认得的格式代次集合（v3/v4 线；其余一律按未知处理）。 */
const KNOWN_SESSION_FORMAT_GENERATIONS = /* @__PURE__ */ new Set([3, 4]);
/**
* 从解码结果的 header 判定格式代次是否可回填。
*
* 本模块只分类不告警——「跳过该会话 + 恰一条 warn」的裁决属于调用方
* （stats-backfill）的责任面，保证叶子模块无副作用。
* @param header - decodeSessionLog 结果里的 header（首行不是 JSON 时 undefined）。
* @param known - 已知代次集合（缺省 {@link KNOWN_SESSION_FORMAT_GENERATIONS}）。
*/
function classifySessionHeader(header, known = KNOWN_SESSION_FORMAT_GENERATIONS) {
	if (header === void 0) return { state: "missing-header" };
	if (header["type"] !== "session") return { state: "not-session" };
	const version = header["version"];
	if (typeof version === "number" && known.has(version)) return {
		state: "known",
		version
	};
	return {
		state: "unknown-version",
		version
	};
}
//#endregion
//#region src/runtime/token-count.ts
/** Build an explicit unavailable result without inventing an estimate. */
function unavailableTokenCount(reason) {
	if (reason.length === 0) throw new TypeError("unavailable token count requires a reason");
	return Object.freeze({
		kind: "unavailable",
		reason
	});
}
/** Sum independent canonical fields only when every count has one identity. */
function countExactCanonicalTextFields(fields, counter, subject) {
	if (subject.length === 0) throw new TypeError("canonical text field count requires a subject");
	const values = fields.length === 0 ? [""] : fields;
	let identity;
	let tokens = 0;
	for (const value of values) {
		const count = counter(value);
		if (count.kind !== "exact-tokenizer") return unavailableTokenCount(`${subject}: ${count.kind === "unavailable" ? count.reason : "canonical content requires an exact tokenizer count"}`);
		if (identity !== void 0 && (identity.tokenizerId !== count.tokenizerId || identity.tokenizerRevision !== count.tokenizerRevision)) return unavailableTokenCount(`${subject}: tokenizer identity changed within one measurement`);
		identity ??= count;
		tokens += count.tokens;
		if (!Number.isSafeInteger(tokens) || tokens < 0) return unavailableTokenCount(`${subject}: token sum is outside the safe integer range`);
	}
	if (identity === void 0) return unavailableTokenCount(`${subject}: no tokenizer identity`);
	return Object.freeze({
		...identity,
		tokens
	});
}
//#endregion
//#region src/runtime/deepseek-v4-vision-tokens.ts
/**
* Exact DeepSeek V4 Flash Vision image-token arithmetic.
*
* Every rule in this module is a line-by-line port of the official
* `inference/image_processor.py` published by
* `deepseek-ai/DeepSeek-V4-Flash-Vision-Exp` at the pinned immutable revision
* recorded below. The golden fixtures in `tests/fixtures/vision-golden.json`
* are generated by executing that official implementation, so any change here
* must keep the Node counts byte-identical to the reference output.
*
* These arithmetic results back intrinsic-grid estimates, never exact counts
* of the final request. The official expansion
* depends on the absolute serialized prompt position (system prompt,
* chat-template framing, adapter image handles) and on the adapter's final
* request-image projection — including per-route pixel-budget or image-detail
* overrides and byte-cap reprojection — none of which is published through a
* public API, and a projected image can count FEWER tokens than its intrinsic
* grid suggests. The measurement layer therefore labels image-bearing nodes
* as estimates and keeps them outside exact rewrite proofs; the 640,000-pixel
* budget below documents the adapter default rather than establishing
* exactness.
*/
/** Official projection parameters pinned from the model repository config. */
const DEEPSEEK_VISION_PROJECTION = Object.freeze({
	sourceRepository: "deepseek-ai/DeepSeek-V4-Flash-Vision-Exp",
	sourceRevision: "6821d6ad3681a4b137b066b76094fa82ebd0a380",
	/** `vision_patch_size` from the official config. */
	visionPatchSize: 14,
	/** `vision_downsample_ratio` from the official config. */
	visionDownsampleRatio: 3,
	/** `vision_max_n_token`: post-preprocessing cap per image, not a fixed value. */
	visionMaxNTokens: 384,
	/** `vision_min_pixels`: tiny images are upscaled before patching. */
	visionMinPixels: 147456,
	/** `vision_max_wh_ratio`: wider-than-ratio images are width-clamped. */
	visionMaxWhRatio: 8,
	/**
	* Default per-image pixel budget used by the DeepSeek adapter's normal
	* attachment projection (`DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET` in
	* `@deepseek-ai/dsh-llm-deepseek`). Route overrides remain unobservable to
	* this estimator.
	*/
	requestImagePixelBudget: 64e4
});
/** Stable identity for the deliberately approximate image-token counter. */
const DEEPSEEK_VISION_IMAGE_ESTIMATOR = Object.freeze({
	id: `${DEEPSEEK_VISION_PROJECTION.sourceRepository}/image-token-estimate`,
	revision: `${DEEPSEEK_VISION_PROJECTION.sourceRevision}:v1`
});
/** Official `COMPRESS_PAD_TO` alignment constant from image_processor.py. */
const COMPRESS_PAD_TO = 4;
/**
* Estimate one image without claiming an exact serialized position or final
* adapter projection. Valid intrinsic dimensions use the midpoint of the four
* possible alignment residues. Invalid or unsafe metadata uses the documented
* fixed fallback. In both cases the official per-image budget is retained as
* a conservative upper bound.
*/
function estimateDeepSeekVisionImageTokens(width, height) {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || !Number.isSafeInteger(width * height)) return Object.freeze({
		tokens: 256,
		upperBoundTokens: DEEPSEEK_VISION_PROJECTION.visionMaxNTokens,
		source: "default"
	});
	try {
		const grid = deepSeekVisionImageGrid(width, height);
		const counts = [
			0,
			1,
			2,
			3
		].map((position) => deepSeekVisionImageBlockTokens(grid.nLlmH, grid.nLlmW, position));
		const paddingMinimumTokens = Math.min(...counts);
		const paddingMaximumTokens = Math.max(...counts);
		return Object.freeze({
			tokens: Math.round((paddingMinimumTokens + paddingMaximumTokens) / 2),
			upperBoundTokens: DEEPSEEK_VISION_PROJECTION.visionMaxNTokens,
			source: "intrinsic-grid",
			paddingMinimumTokens,
			paddingMaximumTokens
		});
	} catch {
		return Object.freeze({
			tokens: 256,
			upperBoundTokens: DEEPSEEK_VISION_PROJECTION.visionMaxNTokens,
			source: "default"
		});
	}
}
/**
* Resolve the aligner grid for one image's intrinsic dimensions.
*
* Port of the arithmetic path of the official `load_image`: aspect-ratio
* clamp, minimum-pixel upscale, patch-grid ceiling, and the `safe_resize`
* budget loop.
*/
function deepSeekVisionImageGrid(width, height) {
	const { visionPatchSize: patch, visionMaxWhRatio, visionMinPixels } = DEEPSEEK_VISION_PROJECTION;
	let effectiveWidth = width;
	let effectiveHeight = height;
	if (visionMaxWhRatio !== void 0 && effectiveWidth > effectiveHeight * visionMaxWhRatio) effectiveWidth = effectiveHeight * visionMaxWhRatio;
	if (effectiveWidth * effectiveHeight > 0 && effectiveWidth * effectiveHeight < visionMinPixels) {
		const ratio = (visionMinPixels / (effectiveWidth * effectiveHeight)) ** .5;
		effectiveWidth = Math.trunc(effectiveWidth * ratio);
		effectiveHeight = Math.trunc(effectiveHeight * ratio);
	}
	const bestWidth = Math.ceil(effectiveWidth / patch) * patch;
	const bestHeight = Math.ceil(effectiveHeight / patch) * patch;
	const resolved = safeResize(effectiveHeight, effectiveWidth, bestHeight, bestWidth);
	return Object.freeze({ ...resolved });
}
/**
* Token count of one expanded image block, port of `build_image_block` length.
* @internal exported for direct golden-fixture comparison.
*/
function deepSeekVisionImageBlockTokens(nLlmH, nLlmW, startTokenPos) {
	const compressPad = 3 - startTokenPos % COMPRESS_PAD_TO;
	const rows = nLlmH + nLlmH % 2;
	const rowLen = nLlmW + 1;
	const padLast = Math.floor(rows / 2) * rowLen % 2 * 2;
	return compressPad + 1 + rows * rowLen + padLast + 1;
}
/** Port of the official `grid_tokens` N-layout occupancy check. */
function gridTokens(bestHeight, bestWidth) {
	const { visionPatchSize: patch, visionDownsampleRatio: downsample } = DEEPSEEK_VISION_PROJECTION;
	const nLlmH = Math.ceil(Math.floor(bestHeight / patch) / downsample);
	const nLlmW = Math.ceil(Math.floor(bestWidth / patch) / downsample);
	let numTokens = nLlmH * (nLlmW + 1) + 2;
	if (nLlmH % 2 === 1) numTokens += nLlmW + 1;
	numTokens += Math.floor((nLlmH + 1) / 2) * (nLlmW + 1) % 2 * 2;
	return {
		nLlmH,
		nLlmW,
		numTokens
	};
}
/** Port of the official `solve_resize_ratio` budget solver. */
function solveResizeRatio(height, width, maxNTokens) {
	const { visionPatchSize: patch, visionDownsampleRatio: downsample } = DEEPSEEK_VISION_PROJECTION;
	const ratio = height / width;
	const maxWFloat = Math.sqrt((maxNTokens - 2) / ratio + .25) - .5;
	const maxHFloat = maxWFloat * ratio;
	let bestWidth;
	let bestHeight;
	if (maxWFloat < 1) {
		const maxW = 1;
		let maxH = Math.floor((maxNTokens - 2) / 2);
		if (maxH % 2 === 1) maxH -= 1;
		bestWidth = maxW * patch * downsample;
		bestHeight = maxH * patch * downsample;
	} else if (maxHFloat < 2) {
		const maxH = 2;
		const maxW = Math.floor((maxNTokens - 2) / maxH) - 1;
		if (maxW <= 1) throw new Error("DeepSeek vision resize solver produced an invalid width");
		bestWidth = maxW * patch * downsample;
		bestHeight = maxH * patch * downsample;
	} else {
		const maxW = Math.floor(maxWFloat);
		let maxH = Math.floor(maxHFloat);
		if (maxH % 2 === 1) maxH -= 1;
		const beta = Math.min(maxW * patch * downsample / width, maxH * patch * downsample / height);
		bestWidth = Math.floor(width * beta / patch) * patch;
		bestHeight = Math.floor(height * beta / patch) * patch;
	}
	const grid = gridTokens(bestHeight, bestWidth);
	return {
		nLlmH: grid.nLlmH,
		nLlmW: grid.nLlmW,
		bestHeight,
		bestWidth
	};
}
/** Port of the official `safe_resize` loop with the compress-pad budget. */
function safeResize(height, width, initialBestHeight, initialBestWidth) {
	const { visionMaxNTokens } = DEEPSEEK_VISION_PROJECTION;
	let budget = visionMaxNTokens - 3;
	let grid = gridTokens(initialBestHeight, initialBestWidth);
	let bestHeight = initialBestHeight;
	let bestWidth = initialBestWidth;
	while (grid.numTokens > budget) {
		const solved = solveResizeRatio(height, width, budget);
		grid = gridTokens(solved.bestHeight, solved.bestWidth);
		bestHeight = solved.bestHeight;
		bestWidth = solved.bestWidth;
		budget -= 1;
	}
	return {
		nLlmH: grid.nLlmH,
		nLlmW: grid.nLlmW,
		bestHeight,
		bestWidth
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
			freshTriggerTokens: 4096,
			freshTargetTokens: 1536,
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
/** Count the lines present in the original but absent from the replacement. */
function countOmittedLines(original, replacement) {
	const omitted = original.split("\n").length - replacement.split("\n").length;
	return omitted > 0 ? omitted : void 0;
}
/** Routed-context utilization required before capacity-pressure History may age sent history. */
const CAPACITY_PRESSURE_RATIO = .7;
//#endregion
//#region src/pruner/content.ts
function onlyTextBlock(blocks) {
	return blocks.length === 1 && blocks[0]?.type === "text" ? blocks[0] : null;
}
function onlyTextBlocks(blocks) {
	return blocks.every((block) => block.type === "text") ? blocks : null;
}
function countToolContent(blocks, view) {
	const text = onlyTextBlocks(blocks);
	if (text === null) return unavailableCount("tool result contains unsupported rich content");
	return countExactCanonicalTextFields(text.map((block) => block.text), (candidate) => view.countCanonicalText(candidate), "tool result replacement");
}
function sameProviderMeasurementKey(left, right) {
	return left.provider === right.provider && left.baseUrlClass === right.baseUrlClass && left.apiRoute === right.apiRoute && left.modelId === right.modelId && left.requestTemplateRevision === right.requestTemplateRevision && left.tokenizerRevision === right.tokenizerRevision && left.modality === right.modality;
}
function unavailableCount(reason) {
	return Object.freeze({
		kind: "unavailable",
		reason
	});
}
function recoveryMarker(sourceRef, label, startLine) {
	return `\n\n[... ${label}; source=${sourceRef}; ${startLine === void 0 ? "use context_compression_retrieve with a query or narrow start_line/max_lines if needed (avoid re-reading the whole result)" : `retrieve with context_compression_retrieve({"ref":"${sourceRef}","start_line":${String(startLine)},"max_lines":80})`} ...]\n\n`;
}
/**
* Measure text content in Unicode code points; non-text blocks cost zero.
* @param blocks - tool-result content to measure.
* @returns total Unicode code points across text blocks.
*/
function measureContent(blocks) {
	let chars = 0;
	for (const block of blocks) if (block.type === "text") chars += codePointLength(block.text);
	return chars;
}
function pressureCost(blocks) {
	let cost = 0;
	for (const block of blocks) switch (block.type) {
		case "text":
		case "reasoning":
			cost += codePointLength(block.text);
			break;
		case "tool-call":
			cost += 256 + codePointLength(block.name) + codePointLength(block.arguments);
			break;
		default: {
			const serialized = JSON.stringify(block);
			cost += Math.max(256, codePointLength(serialized));
		}
	}
	return cost;
}
function nativePruneContent(blocks, thresholdChars, headChars, tailChars, marker = PRUNE_MARKER) {
	const totalChars = measureContent(blocks);
	if (totalChars <= thresholdChars) return null;
	const markerChars = codePointLength(typeof marker === "function" ? marker(1) : marker);
	const safeHead = Math.max(0, Math.min(headChars, thresholdChars - markerChars));
	const safeTail = Math.max(0, Math.min(tailChars, thresholdChars - markerChars - safeHead));
	const removedStart = safeHead;
	const removedEnd = totalChars - safeTail;
	const pruned = [];
	let consumed = 0;
	let markerInserted = false;
	let newlinesBefore = 0;
	for (const block of blocks) {
		if (block.type !== "text") {
			pruned.push(block);
			newlinesBefore += 1;
			continue;
		}
		const points = Array.from(block.text);
		const blockStart = consumed;
		const blockEnd = blockStart + points.length;
		const headEnd = Math.min(points.length, Math.max(0, removedStart - blockStart));
		const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart));
		const intersectsRemoved = blockStart < removedEnd && blockEnd > removedStart;
		const headText = points.slice(0, headEnd).join("");
		const insertion = intersectsRemoved && !markerInserted && typeof marker === "function" ? marker(1 + newlinesBefore + headText.split("\n").length - 1) : intersectsRemoved && !markerInserted ? marker : "";
		if (insertion !== "") markerInserted = true;
		const text = points.slice(0, headEnd).join("") + insertion + points.slice(tailStart).join("");
		if (text !== "") pruned.push({
			...block,
			text
		});
		newlinesBefore += block.text.split("\n").length - 1 + 1;
		consumed = blockEnd;
	}
	if (!markerInserted) return null;
	const charsAfter = measureContent(pruned);
	return charsAfter <= thresholdChars && charsAfter < totalChars ? pruned : null;
}
function summarize(entries) {
	return {
		pruned: entries,
		charsRemoved: entries.reduce((sum, entry) => sum + entry.charsBefore - entry.charsAfter, 0),
		tokensRemoved: entries.reduce((sum, entry) => sum + entry.tokensBefore - entry.tokensAfter, 0)
	};
}
function emptyResult() {
	return {
		pruned: [],
		charsRemoved: 0,
		tokensRemoved: 0
	};
}
//#endregion
//#region src/runtime/measurement.ts
const dshSessionSoft = dshSessionNamespace;
const deriveEventMessage = dshSessionSoft.deriveEventMessage ?? dshSessionSoft.default?.deriveEventMessage ?? (() => null);
/**
* Character pressure of one model-visible content array, measured on the same
* level `SnapshotCandidate.characterPressure` uses: a tool/result message is
* measured by its inner tool-result content, never by the wrapper block, so the
* node-level and candidate-level figures stay directly comparable.
* @param content - the node's model-visible content blocks.
* @returns character pressure in Unicode code points, plus rich-block costs.
*/
function nodeCharacterPressure(content) {
	return pressureCost(content);
}
const VISION_MODEL_ID = DEEPSEEK_VISION_TOKENIZER_ARTIFACT.modelIds[0];
/**
* Capture one route-bound view without calling patched Harness methods.
* Official `measure()` remains authoritative for request pressure; the bundled
* tokenizer supplies exact canonical content counts used by safe rewrites.
*/
function measureForCompaction(ctx, session) {
	const header = session.requestHeader();
	const measurement = ctx.tokenMeter.measure(session, header);
	const target = header?.config;
	const counter = bindCounter(target?.provider, target?.model);
	const events = sessionEvents(session);
	const eventsBySeq = new Map(events.map((event) => [Number(event.seq), event]));
	const measuredNodes = measurement.nodes.map((node) => {
		const event = eventsBySeq.get(Number(node.seq));
		if (event === void 0) return {
			seq: node.seq,
			count: unavailableTokenCount(`surface node ${String(node.seq)} is missing`),
			characterPressure: 0
		};
		const message = deriveEventMessage(event);
		if (message === null) return {
			seq: node.seq,
			count: unavailableTokenCount(`surface node ${String(node.seq)} is not model-visible`),
			characterPressure: 0
		};
		const count = countCanonicalContent(message.content, counter, `surface node ${String(node.seq)}`);
		const intrinsicImageBlockEstimate = count.kind === "tokenizer-estimate" ? intrinsicImageDiagnostic(message.content, target) : void 0;
		return {
			seq: node.seq,
			count,
			characterPressure: nodeCharacterPressure(message.content),
			...intrinsicImageBlockEstimate === void 0 ? {} : { intrinsicImageBlockEstimate }
		};
	});
	const currentSurface = countSurfaceCounts(measuredNodes.map((node) => node.count), "current surface");
	const currentSurfaceChars = measuredNodes.reduce((sum, node) => sum + node.characterPressure, 0);
	const intrinsicImageBlockEstimateTokens = measuredNodes.reduce((sum, node) => sum + (node.intrinsicImageBlockEstimate?.paddingMinimumTokens ?? 0), 0);
	return Object.freeze({
		...measurement,
		...target === void 0 ? {} : {
			providerRoute: target.provider,
			modelId: target.model
		},
		measuredNodes: Object.freeze(measuredNodes),
		currentSurface,
		currentSurfaceChars,
		intrinsicImageBlockEstimateTokens,
		countCanonicalText: counter.countText
	});
}
/** Request-level usage exposed by official TokenMeter, without invented route attribution. */
function officialRequestUsage(view) {
	return view.baseline.kind === "usage" ? view.baseline.usage : void 0;
}
/**
* Count one canonical content walk in canonical field order.
*
* Text, reasoning, tool-call names/arguments, and nested text tool results are
* counted exactly with one tokenizer identity. Image blocks produce a bounded
* estimate because the absolute prompt position and the adapter's final
* projection are not publicly observable. A mixed text/image node is therefore
* an estimate and never qualifies for an exact rewrite proof.
*/
function countCanonicalContent(blocks, counter, subject) {
	let identity;
	let estimateIdentity;
	let tokens = 0;
	let upperBoundTokens = 0;
	let firstRefusal;
	const absorb = (count) => {
		if (count.kind === "unavailable") {
			firstRefusal ??= count;
			return false;
		}
		if (count.kind === "exact-tokenizer") {
			if (identity !== void 0 && (identity.tokenizerId !== count.tokenizerId || identity.tokenizerRevision !== count.tokenizerRevision)) {
				firstRefusal ??= unavailableTokenCount(`${subject}: tokenizer identity changed within one measurement`);
				return false;
			}
			identity ??= count;
			tokens += count.tokens;
			upperBoundTokens += count.tokens;
		} else {
			if (estimateIdentity !== void 0 && (estimateIdentity.estimatorId !== count.estimatorId || estimateIdentity.estimatorRevision !== count.estimatorRevision)) {
				firstRefusal ??= unavailableTokenCount(`${subject}: image estimator identity changed within one measurement`);
				return false;
			}
			estimateIdentity ??= {
				estimatorId: count.estimatorId,
				estimatorRevision: count.estimatorRevision
			};
			tokens += count.tokens;
			upperBoundTokens += count.upperBoundTokens;
		}
		return Number.isSafeInteger(tokens) && tokens >= 0 && Number.isSafeInteger(upperBoundTokens) && upperBoundTokens >= tokens;
	};
	const walk = (content) => {
		for (const block of content) switch (block.type) {
			case "text":
			case "reasoning":
				if (!absorb(counter.countText(block.text))) return false;
				break;
			case "tool-call":
				if (!absorb(counter.countText(block.name))) return false;
				if (!absorb(counter.countText(block.arguments))) return false;
				break;
			case "image":
				if (!absorb(counter.countImage(block.attachment))) return false;
				break;
			default:
				firstRefusal ??= unavailableTokenCount(`${subject}: contains an unsupported content block`);
				return false;
		}
		return true;
	};
	if (!walk(blocks)) {
		if (firstRefusal?.kind === "unavailable") return unavailableTokenCount(`${subject}: ${firstRefusal.reason}`);
		return unavailableTokenCount(`${subject}: contains content the canonical counter cannot count exactly`);
	}
	if (identity === void 0 && estimateIdentity === void 0) {
		const empty = counter.countText("");
		if (empty.kind !== "exact-tokenizer") return empty;
		return empty;
	}
	if (!Number.isSafeInteger(tokens) || tokens < 0) return unavailableTokenCount(`${subject}: invalid token sum`);
	if (estimateIdentity !== void 0) return Object.freeze({
		kind: "tokenizer-estimate",
		...estimateIdentity,
		tokens,
		upperBoundTokens
	});
	if (identity === void 0) return unavailableTokenCount(`${subject}: no tokenizer identity`);
	return Object.freeze({
		...identity,
		tokens
	});
}
function bindCounter(provider, model) {
	if (provider === void 0 || model === void 0) {
		const unavailable = () => unavailableTokenCount("canonical text: no durable provider/model request header");
		return {
			countText: unavailable,
			countImage: () => unavailableTokenCount("canonical image: no durable provider/model request header")
		};
	}
	if (provider !== "deepseek" && provider !== "deepseek-official") {
		const reason = `canonical text: provider "${provider}" is not the supported DeepSeek route`;
		return {
			countText: () => unavailableTokenCount(reason),
			countImage: () => unavailableTokenCount(`canonical image: provider "${provider}" is not the supported DeepSeek route`)
		};
	}
	const tokenizer = deepSeekV4TokenizerForModel(model);
	if (tokenizer === void 0) {
		const reason = `canonical text: no verified bundled tokenizer for model "${model}"`;
		return {
			countText: () => unavailableTokenCount(reason),
			countImage: (attachment) => countCanonicalImage(model, attachment)
		};
	}
	return {
		countText: (text) => tokenizer.countText(text),
		countImage: (attachment) => countCanonicalImage(model, attachment)
	};
}
/**
* Images never claim an exact count. The official expansion depends on the
* absolute prompt position (system prompt, chat-template framing, adapter
* image handles) and on the adapter's final request-image projection, neither
* of which is exposed through a public API; a route may even override the
* pixel budget or re-project under the byte cap. Valid dimensions therefore
* use the midpoint of the four alignment residues as a bounded estimate;
* malformed dimensions use a fixed default. Estimate-bearing nodes remain
* ineligible for exact rewrite proofs.
*/
function countCanonicalImage(model, attachment) {
	if (model !== VISION_MODEL_ID) return unavailableTokenCount(`canonical image: model "${model}" has no vision image counter`);
	const estimate = estimateDeepSeekVisionImageTokens(attachment.width, attachment.height);
	return Object.freeze({
		kind: "tokenizer-estimate",
		tokens: estimate.tokens,
		upperBoundTokens: estimate.upperBoundTokens,
		estimatorId: DEEPSEEK_VISION_IMAGE_ESTIMATOR.id,
		estimatorRevision: DEEPSEEK_VISION_IMAGE_ESTIMATOR.revision
	});
}
/**
* Intrinsic-grid diagnostic for one content walk: the official block
* arithmetic on intrinsic dimensions at both alignment extremes. Only images
* on the pinned DeepSeek vision route with usable metadata contribute.
*/
function intrinsicImageDiagnostic(blocks, target) {
	if (target === void 0 || target.provider !== "deepseek" && target.provider !== "deepseek-official" || target.model !== VISION_MODEL_ID) return void 0;
	let paddingMinimumTokens = 0;
	let paddingMaximumTokens = 0;
	let seen = false;
	const walk = (content) => {
		for (const block of content) if (block.type === "image") {
			const { width, height } = block.attachment;
			const estimate = estimateDeepSeekVisionImageTokens(width, height);
			if (estimate.source !== "intrinsic-grid" || estimate.paddingMinimumTokens === void 0 || estimate.paddingMaximumTokens === void 0) continue;
			paddingMinimumTokens += estimate.paddingMinimumTokens;
			paddingMaximumTokens += estimate.paddingMaximumTokens;
			seen = true;
		}
	};
	walk(blocks);
	return seen ? Object.freeze({
		paddingMinimumTokens,
		paddingMaximumTokens
	}) : void 0;
}
function countSurfaceCounts(counts, subject) {
	if (counts.length === 0) return unavailableTokenCount(`${subject}: no surface nodes`);
	let identity;
	let estimateIdentity;
	let tokens = 0;
	let upperBoundTokens = 0;
	for (const count of counts) {
		if (count.kind === "unavailable") return unavailableTokenCount(`${subject}: ${count.reason}`);
		if (count.kind === "exact-tokenizer") {
			if (identity !== void 0 && (identity.tokenizerId !== count.tokenizerId || identity.tokenizerRevision !== count.tokenizerRevision)) return unavailableTokenCount(`${subject}: tokenizer identity changed within one measurement`);
			identity ??= count;
			tokens += count.tokens;
			upperBoundTokens += count.tokens;
		} else {
			if (estimateIdentity !== void 0 && (estimateIdentity.estimatorId !== count.estimatorId || estimateIdentity.estimatorRevision !== count.estimatorRevision)) return unavailableTokenCount(`${subject}: image estimator identity changed within one measurement`);
			estimateIdentity ??= {
				estimatorId: count.estimatorId,
				estimatorRevision: count.estimatorRevision
			};
			tokens += count.tokens;
			upperBoundTokens += count.upperBoundTokens;
		}
	}
	if (!Number.isSafeInteger(tokens) || tokens < 0 || !Number.isSafeInteger(upperBoundTokens) || upperBoundTokens < tokens) return unavailableTokenCount(`${subject}: invalid token sum`);
	if (estimateIdentity !== void 0) return Object.freeze({
		kind: "tokenizer-estimate",
		...estimateIdentity,
		tokens,
		upperBoundTokens
	});
	if (identity === void 0) return unavailableTokenCount(`${subject}: no tokenizer identity`);
	return Object.freeze({
		...identity,
		tokens
	});
}
//#endregion
//#region src/runtime/tokenpilot/dedup.ts
/**
* TokenPilot-inspired A1: byte-identical repeated tool-result dedup.
*
* Pure helpers behind the ToolResultPruner fresh pass. The per-session table
* maps a canonical-content SHA-256 to the first surface seq that produced it;
* later identical results may be replaced with a pointer placeholder that the
* recovery tool can resolve back to the original full text via the append-only
* session log. Only hash+seq metadata is stored — never content.
*/
/** Per-session dedup index with insertion-order eviction. */
var DedupeTable = class {
	maxEntries;
	entries = /* @__PURE__ */ new Map();
	constructor(maxEntries = 2048) {
		this.maxEntries = maxEntries;
	}
	/** Look up the first occurrence for one canonical hash, if any. */
	get(hash) {
		return this.entries.get(hash);
	}
	/** Record a first occurrence; existing hashes only refresh insertion order. */
	record(hash, entry) {
		if (this.entries.has(hash)) return;
		while (this.entries.size >= this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest === void 0) break;
			this.entries.delete(oldest);
		}
		this.entries.set(hash, entry);
	}
};
/** Canonicalize tool-result text for hashing. */
function canonicalizeForDedupe(text, mode) {
	if (mode === "exact") return text;
	return text.replace(/[ \t]+\r?\n/g, "\n").replace(/(^\s+)|(\s+$)/g, "");
}
/** SHA-256 hex of the canonicalized text. */
function dedupeHash(text, mode) {
	return createHash("sha256").update(canonicalizeForDedupe(text, mode), "utf8").digest("hex");
}
/** Concatenated text of an all-text content block list; null when rich. */
function flattenPlainText(content) {
	let text = "";
	for (const block of content) {
		if (block.type !== "text") return void 0;
		text += block.text;
	}
	return text;
}
/** Pointer placeholder pointing at the first occurrence's original event. */
function dedupePlaceholder(entry, originalChars) {
	return [
		`[... identical to the earlier ${entry.toolName} result; first seen at ${entry.sourceRef};`,
		`original_chars=${String(originalChars)};`,
		"retrieve with context_compression_retrieve({\"ref\":\"" + entry.sourceRef + "\",\"start_line\":1}) if the omitted evidence is necessary.]"
	].join(" ");
}
//#endregion
//#region src/runtime/savings-projection.ts
const EMPTY = Object.freeze({
	savings: [],
	offsets: [],
	registry: []
});
function blocksOf(event) {
	if (event.type !== "tool/result") return void 0;
	return viewToolResult(event.data.message).blocks;
}
function textOf(event) {
	const blocks = blocksOf(event);
	return blocks === void 0 ? void 0 : flattenPlainText(blocks);
}
/** 与 pruner 的 `plan()` 同口径定价：全文本块可精确，否则字符口径。 */
function priceEvent(event, countText) {
	const blocks = blocksOf(event);
	if (blocks === void 0) return void 0;
	const chars = pressureCost(blocks);
	if (chars <= 0) return void 0;
	const texts = blocks.map((block) => block.type === "text" ? block.text : void 0);
	if (texts.every((text) => text !== void 0)) {
		const count = countExactCanonicalTextFields(texts, countText, "savings projection");
		if (count.kind === "exact-tokenizer") return {
			tokens: count.tokens,
			basis: "exact-tokenizer",
			chars
		};
	}
	return {
		tokens: Math.max(1, charsToTokens(chars)),
		basis: "characters",
		chars
	};
}
/** 替换事件的被替换 span；非替换节点（或畸形 op）返回 undefined。 */
function replacedSpan(event) {
	const op = event.surfaceOp;
	if (typeof op !== "object" || op === null || op.op !== "replace") return void 0;
	const start = Number(op.startSeq);
	const end = Number(op.endSeq);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return void 0;
	return {
		start,
		end
	};
}
function originalText(bySeq, span) {
	const parts = [];
	for (let seq = span.start; seq <= span.end; seq++) {
		const event = bySeq.get(seq);
		const text = event === void 0 ? void 0 : textOf(event);
		if (text !== void 0 && text.length > 0) parts.push(text);
	}
	return parts.join("\n");
}
/**
* 一个替换节点"压掉了多少"（与实时 `plan()` 同口径：差额>0 才算）。
* 原始价 = span 内原始事件之和；替换价 = 替换事件。
*/
function computeDelta(bySeq, replacement, span, counter) {
	const after = priceEvent(replacement, counter);
	if (after === void 0) return void 0;
	let beforeChars = 0;
	let beforeExactTokens = 0;
	let beforeExact = true;
	let any = false;
	for (let seq = span.start; seq <= span.end; seq++) {
		const original = bySeq.get(seq);
		const priced = original === void 0 ? void 0 : priceEvent(original, counter);
		if (priced === void 0) continue;
		any = true;
		beforeChars += priced.chars;
		beforeExactTokens += priced.tokens;
		if (priced.basis !== "exact-tokenizer") beforeExact = false;
	}
	if (!any) return void 0;
	const exact = after.basis === "exact-tokenizer" && beforeExact;
	const basis = exact ? "exact-tokenizer" : "characters";
	const delta = (exact ? beforeExactTokens : charsToTokens(beforeChars)) - (exact ? after.tokens : charsToTokens(after.chars));
	if (delta <= 0) return void 0;
	return {
		tokens: delta,
		basis
	};
}
/**
* 纯核心：给定事件流、当前 surface 节点与计价计数器，重算节省投影。
* @param input - events/surfaceNodes/counter，均为实时路径的只读快照。
* @returns savings（当前生效毛节省）/ offsets（每次重读惩罚）/ registry（原文配对键）。
*/
function projectSavingsCore(input) {
	const { events, surfaceNodes, counter } = input;
	if (events.length === 0) return EMPTY;
	const bySeq = /* @__PURE__ */ new Map();
	for (const event of events) bySeq.set(Number(event.seq), event);
	const savings = [];
	for (const rawSeq of surfaceNodes) {
		const seq = Number(rawSeq);
		const replacement = bySeq.get(seq);
		if (replacement === void 0) continue;
		const span = replacedSpan(replacement);
		if (span === void 0) continue;
		const delta = computeDelta(bySeq, replacement, span, counter);
		if (delta === void 0) continue;
		savings.push({
			component: "projection",
			tokens: delta.tokens,
			basis: delta.basis,
			at: Number(replacement.time) || 0,
			replacementSeq: seq
		});
	}
	const offsets = [];
	const registry = [];
	const owned = /* @__PURE__ */ new Map();
	for (const event of events) {
		if (event.type !== "tool/result") continue;
		const span = replacedSpan(event);
		if (span !== void 0) {
			const groupText = originalText(bySeq, span);
			if (groupText.length === 0) continue;
			const delta = computeDelta(bySeq, event, span, counter);
			if (delta === void 0) continue;
			const hash = savingsHash(groupText);
			owned.set(hash, {
				claimedTokens: delta.tokens,
				basis: delta.basis,
				sourceSeq: span.start
			});
			registry.push({
				hash,
				claimedTokens: delta.tokens,
				basis: delta.basis,
				sourceSeq: span.start
			});
			continue;
		}
		const text = textOf(event);
		if (text === void 0 || text.length === 0) continue;
		const hit = owned.get(savingsHash(text));
		if (hit === void 0) continue;
		const priced = priceEvent(event, counter);
		if (priced === void 0) continue;
		offsets.push({
			component: "full-read",
			tokens: priced.tokens,
			basis: priced.basis,
			at: Number(event.time) || 0,
			seq: Number(event.seq),
			note: `#${hit.sourceSeq} 的原文被全文重读(投影重建)`
		});
	}
	return {
		savings,
		offsets,
		registry
	};
}
/**
* 从会话快照投影节省账。`measureForCompaction` 提供与实时同口径的 tokenizer
* 计数器；失败时向上抛，由调用方 fail-open。
*/
function projectSessionSavings(ctx, session) {
	const view = measureForCompaction(ctx, session);
	return projectSavingsCore({
		events: sessionEvents(session),
		surfaceNodes: session.surface.nodes,
		counter: (candidate) => view.countCanonicalText(candidate)
	});
}
/** 标记本插件统计库所有权的 application id(ASCII "CCIS")。 */
const CCI_STATS_APPLICATION_ID = 1128483155;
/** 统计库相对 DSH home 的路径段;刻意避开 sessions 目录(steward purge 会连带真删)。 */
const STATS_DB_PATH_SEGMENTS = [
	"storages",
	"dsh-context-compression",
	"stats.sqlite"
];
const STATS_CLAIM_KINDS = [
	"saving",
	"offset",
	"usage",
	"sample"
];
/** 解析 DSH home:显式 dshHome > $DSH_HOME > `~/.dsh`(宿主同名优先级)。 */
function resolveStatsDshHome(options = {}) {
	if (typeof options.dshHome === "string" && options.dshHome.trim() !== "") return options.dshHome;
	const fromEnv = (options.env ?? process.env)["DSH_HOME"];
	if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv;
	return join(homedir(), ".dsh");
}
/**
* 统计库绝对路径:`<dshHome>/storages/dsh-context-compression/stats.sqlite`
* + homedir 兜底。返回值总是绝对路径形态的各段拼接。
*/
function resolveStatsDbPath(options = {}) {
	if (typeof options.dbPath === "string" && options.dbPath.trim() !== "") return options.dbPath;
	return join(resolveStatsDshHome(options), ...STATS_DB_PATH_SEGMENTS);
}
/**
* 建表(幂等)并把 application_id/user_version 盖章到当前版本。
* 二次打开同一文件时 CREATE IF NOT EXISTS 全部空转,数据原样保留。
*/
function ensureStatsSchema(db) {
	db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      project TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'live'
    );
    CREATE TABLE IF NOT EXISTS claims (
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      component TEXT NOT NULL DEFAULT '',
      basis TEXT NOT NULL DEFAULT '',
      tokens INTEGER NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (session_id, seq, kind, component, basis)
    );
    CREATE INDEX IF NOT EXISTS claims_session_kind ON claims(session_id, kind);
  `);
	db.exec(`PRAGMA application_id = ${CCI_STATS_APPLICATION_ID}`);
	db.exec(`PRAGMA user_version = 1`);
}
/**
* 版本不符时的就地重置:删掉全部自建表(含索引随表消失)、清 user_version,
* 保留文件本身;application_id 由随后的 ensureStatsSchema 重新盖章。
* 数据丢失是可接受语义——claims 全部可从宿主事件日志幂等重放。
*/
function resetStatsSchema(db) {
	for (const row of db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all()) db.exec(`DROP TABLE IF EXISTS "${row.name.replace(/"/g, "\"\"")}"`);
	db.exec(`PRAGMA user_version = 0`);
}
//#endregion
//#region src/runtime/stats-db.ts
/**
* 驱动探测顺序打开裸句柄。非字面量 specifier 让 optional 原生依赖缺席时
* typecheck/build 全绿(tsdown neverBundle 也不会把它打进产物);
* `node:sqlite` 带前缀,verify-release 依赖闸对其零成本跳过。
*/
async function openRawHandle(actual) {
	try {
		const mod = await import("better-sqlite3");
		return {
			db: new (mod.default ?? mod)(actual),
			driver: "better-sqlite3"
		};
	} catch {
		try {
			const { DatabaseSync: NodeDatabaseSync } = await import("node:sqlite");
			return {
				db: new NodeDatabaseSync(actual),
				driver: "node:sqlite"
			};
		} catch {
			return null;
		}
	}
}
/**
* 打开(必要时创建并初始化)统计库文件。缺目录建目录;他人库抛错拒开;
* 自家库版本不符先 drop 重建。返回 null 表示无可用驱动(降级,非错误)。
*/
async function openStatsDatabase(path) {
	const actual = resolve(path);
	await mkdir(dirname(actual), { recursive: true });
	const opened = await openRawHandle(actual);
	if (opened === null) return null;
	const { db } = opened;
	try {
		const { application_id: applicationId } = db.prepare("PRAGMA application_id").get();
		const { user_version: version } = db.prepare("PRAGMA user_version").get();
		if (applicationId === 1146308689) throw new Error(`stats-db: "${actual}" is the official session-query index, refusing to open it`);
		if (applicationId === 1398229332) throw new Error(`stats-db: "${actual}" belongs to switch-search, refusing to open it`);
		if (applicationId !== 0 && applicationId !== 1128483155) throw new Error(`stats-db: database at "${actual}" belongs to another application (id 0x${applicationId.toString(16)})`);
		if (applicationId === 1128483155 && version !== 1) resetStatsSchema(db);
		db.exec(`PRAGMA journal_mode = wal`);
		ensureStatsSchema(db);
		db.exec(`PRAGMA synchronous = NORMAL`);
		db.exec(`PRAGMA busy_timeout = 5000`);
		db.exec(`PRAGMA temp_store = MEMORY`);
		return opened;
	} catch (error) {
		db.close();
		throw error;
	}
}
/**
* 一个打开的统计库句柄的读写面。写路径同步小事务(随写随刷,BEGIN
* IMMEDIATE),读路径无锁(WAL 允许读并发)。句柄关闭后调用即抛——生命周期
* 由 ensureStatsStore/closeStatsStore 统一管,调用方不持有裸 db。
*/
var StatsStore = class {
	driver;
	db;
	inWriteTx = false;
	constructor(db, driver) {
		this.driver = driver;
		this.db = db;
	}
	get isOpen() {
		return this.db !== void 0;
	}
	close() {
		this.db?.close();
		this.db = void 0;
	}
	requireDb() {
		if (this.db === void 0) throw new Error("stats-db: handle closed");
		return this.db;
	}
	/**
	* 外层已开写事务时直接并入(嵌套 join),否则自开一个 BEGIN IMMEDIATE
	* 小事务并提交;异常一律 ROLLBACK 后原样上抛。
	*/
	withWriteTx(fn) {
		const db = this.requireDb();
		if (this.inWriteTx) return fn();
		db.exec("BEGIN IMMEDIATE");
		this.inWriteTx = true;
		try {
			const result = fn();
			db.exec("COMMIT");
			return result;
		} catch (error) {
			try {
				db.exec("ROLLBACK");
			} catch {}
			throw error;
		} finally {
			this.inWriteTx = false;
		}
	}
	/**
	* claims 批量幂等落库:BEGIN IMMEDIATE + INSERT OR IGNORE,返回**实际新增**
	* 行数(重放 = 0)。非有限数/未知 kind 的行拒收(抛错=编程错误,静默跳行
	* =对账黑洞,取前者)。
	*/
	recordClaims(sessionId, rows) {
		if (rows.length === 0) return 0;
		const db = this.requireDb();
		const sid = String(sessionId);
		for (const row of rows) {
			if (!STATS_CLAIM_KINDS.includes(row.kind)) throw new Error(`stats-db: unsupported claim kind "${String(row.kind)}"`);
			if (!Number.isFinite(row.seq) || !Number.isFinite(row.tokens) || !Number.isFinite(row.at)) throw new Error(`stats-db: claim row for session "${sid}" carries non-finite seq/tokens/at`);
		}
		const insert = db.prepare(`INSERT OR IGNORE INTO claims (session_id, seq, kind, component, basis, tokens, at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
		return this.withWriteTx(() => {
			let added = 0;
			for (const row of rows) {
				const result = insert.run(sid, Math.trunc(row.seq), row.kind, row.component, row.basis, Math.trunc(row.tokens), Math.trunc(row.at));
				added += Number(result.changes);
			}
			return added;
		});
	}
	/**
	* 按会话聚合 saving/offset 双 basis 合计,净额精确口径降序(内存账本
	* snapshot.perSession 的持久层对应物;分页在 T24 路由层做)。
	*/
	perSessionAggregates() {
		const rows = this.requireDb().prepare(`
      SELECT session_id AS sessionId, kind, basis, SUM(tokens) AS tokens
      FROM claims WHERE kind IN ('saving', 'offset')
      GROUP BY session_id, kind, basis
    `).all();
		const bySession = /* @__PURE__ */ new Map();
		for (const row of rows) {
			let agg = bySession.get(row.sessionId);
			if (agg === void 0) {
				agg = {
					sessionId: row.sessionId,
					gross: {
						exact: 0,
						estimated: 0
					},
					offsets: {
						exact: 0,
						estimated: 0
					},
					net: {
						exact: 0,
						estimated: 0
					}
				};
				bySession.set(row.sessionId, agg);
			}
			const column = row.basis === "exact-tokenizer" ? "exact" : "estimated";
			const bucket = row.kind === "saving" ? agg.gross : agg.offsets;
			bucket[column] += Number(row.tokens);
		}
		const list = [...bySession.values()];
		for (const agg of list) {
			agg.net.exact = agg.gross.exact - agg.offsets.exact;
			agg.net.estimated = agg.gross.estimated - agg.offsets.estimated;
		}
		return list.sort((a, b) => b.net.exact - a.net.exact || b.net.estimated - a.net.estimated);
	}
	/** 全会话聚合(不带 perSession 列表的 total)。 */
	total() {
		const rows = this.requireDb().prepare(`
      SELECT kind, basis, SUM(tokens) AS tokens
      FROM claims WHERE kind IN ('saving', 'offset')
      GROUP BY kind, basis
    `).all();
		const gross = {
			exact: 0,
			estimated: 0
		};
		const offsets = {
			exact: 0,
			estimated: 0
		};
		for (const row of rows) {
			const column = row.basis === "exact-tokenizer" ? "exact" : "estimated";
			const bucket = row.kind === "saving" ? gross : offsets;
			bucket[column] += Number(row.tokens);
		}
		return {
			gross,
			offsets,
			net: {
				exact: gross.exact - offsets.exact,
				estimated: gross.estimated - offsets.estimated
			}
		};
	}
	/**
	* 累计积分查询:Σ samples(按 call 边界采样的存量净快照)。calls = 已覆盖的
	*  distinct 边界 seq 数——面板"累计(按 N 次 call)"的 N。
	*/
	sumSamples(sessionId) {
		const db = this.requireDb();
		const sid = String(sessionId);
		const sums = db.prepare(`SELECT component, SUM(tokens) AS tokens FROM claims WHERE session_id = ? AND kind = 'sample' GROUP BY component`).all(sid);
		const { calls } = db.prepare(`SELECT COUNT(DISTINCT seq) AS calls FROM claims WHERE session_id = ? AND kind = 'sample'`).get(sid);
		const totals = {
			netExact: 0,
			netEstimated: 0,
			cachedInput: 0,
			uncachedInput: 0,
			calls: Number(calls)
		};
		for (const row of sums) if (row.component === "netExact") totals.netExact += Number(row.tokens);
		else if (row.component === "netEstimated") totals.netEstimated += Number(row.tokens);
		else if (row.component === "cachedInput") totals.cachedInput += Number(row.tokens);
		else if (row.component === "uncachedInput") totals.uncachedInput += Number(row.tokens);
		return totals;
	}
	/** 全会话积分累计（面板"累计"总行的数据源）；calls = distinct (session, seq)。 */
	sumSamplesAll() {
		const db = this.requireDb();
		const sums = db.prepare(`SELECT component, SUM(tokens) AS tokens FROM claims WHERE kind = 'sample' GROUP BY component`).all();
		const { calls } = db.prepare(`SELECT COUNT(DISTINCT session_id || ':' || seq) AS calls FROM claims WHERE kind = 'sample'`).get();
		const totals = {
			netExact: 0,
			netEstimated: 0,
			cachedInput: 0,
			uncachedInput: 0,
			calls: Number(calls)
		};
		for (const row of sums) if (row.component === "netExact") totals.netExact += Number(row.tokens);
		else if (row.component === "netEstimated") totals.netEstimated += Number(row.tokens);
		else if (row.component === "cachedInput") totals.cachedInput += Number(row.tokens);
		else if (row.component === "uncachedInput") totals.uncachedInput += Number(row.tokens);
		return totals;
	}
	/** 「怎么省的」组成:saving claims 按压缩路径×口径聚合(可聚焦单会话);浮窗组成块数据源。 */
	/**
	* 最近有压缩活动的会话(claims.at 最大者,回填保留原始事件时间)——浮窗
	* 「怎么省的」的"当前会话"解析基准。sessions.updated_at 会被回填统一盖章,
	* 不能作活跃判据。
	*/
	latestActiveSessionId() {
		return this.requireDb().prepare("SELECT session_id FROM claims GROUP BY session_id ORDER BY MAX(at) DESC LIMIT 1").get()?.session_id;
	}
	sessionComponents(sessionId) {
		const db = this.requireDb();
		return (sessionId === void 0 ? db.prepare(`SELECT component, basis, SUM(tokens) AS tokens, COUNT(*) AS events
         FROM claims WHERE kind = 'saving' GROUP BY component, basis ORDER BY tokens DESC LIMIT 8`).all() : db.prepare(`SELECT component, basis, SUM(tokens) AS tokens, COUNT(*) AS events
         FROM claims WHERE kind = 'saving' AND session_id = ? GROUP BY component, basis ORDER BY tokens DESC LIMIT 8`).all(sessionId)).map((row) => ({
			component: row.component,
			basis: row.basis,
			tokens: Number(row.tokens),
			events: Number(row.events)
		}));
	}
	/** 会话已覆盖水位(绝对 seq);未知会话 = 0。 */
	getSessionWatermark(sessionId) {
		const row = this.requireDb().prepare(`SELECT version FROM sessions WHERE session_id = ?`).get(String(sessionId));
		return row === void 0 ? 0 : Number(row.version);
	}
	/**
	* 会话行全容（回填器用来判 source=live 护栏与水位 diff）；未知会话 = undefined。
	*/
	getSessionRecord(sessionId) {
		const row = this.requireDb().prepare(`SELECT version, project, source, updated_at AS updatedAt FROM sessions WHERE session_id = ?`).get(String(sessionId));
		if (row === void 0) return void 0;
		return {
			version: Number(row.version),
			project: row.project,
			source: row.source,
			updatedAt: Number(row.updatedAt)
		};
	}
	/**
	* 最近活跃会话（updated_at 降序；/ccip `session latest` 与面板聚焦的解析源
	* ——usage 水位每秒 upsert 刷 updated_at，活跃会话自然浮到最前）。
	*/
	recentSessionIds(limit) {
		const db = this.requireDb();
		const capped = Math.max(1, Math.min(100, Math.trunc(limit)));
		return db.prepare(`SELECT session_id AS sessionId, updated_at AS updatedAt, source FROM sessions ORDER BY updated_at DESC, session_id ASC LIMIT ?`).all(capped).map((row) => ({
			sessionId: row.sessionId,
			updatedAt: Number(row.updatedAt),
			source: row.source
		}));
	}
	/** meta 键值读（displayPrefs 等）；缺键 = undefined。 */
	getMeta(key) {
		const row = this.requireDb().prepare(`SELECT value FROM meta WHERE key = ?`).get(String(key));
		return row === void 0 ? void 0 : row.value;
	}
	/** meta 键值写（upsert；值必须是调用方已序列化的字符串）。 */
	setMeta(key, value) {
		const db = this.requireDb();
		this.withWriteTx(() => {
			db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).run(String(key), String(value));
		});
	}
	/**
	* upsert 会话水位:单调不减(重放/回填旧值不倒退现有水位);
	* source 一旦为 live 不被 backfill 降级。
	*/
	setSessionWatermark(sessionId, version, options = {}) {
		if (!Number.isFinite(version) || version < 0) throw new Error(`stats-db: watermark for session "${String(sessionId)}" must be a non-negative finite number`);
		const db = this.requireDb();
		this.withWriteTx(() => {
			db.prepare(`
        INSERT INTO sessions (session_id, project, version, updated_at, source)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (session_id) DO UPDATE SET
          version = MAX(sessions.version, excluded.version),
          updated_at = MAX(sessions.updated_at, excluded.updated_at),
          project = CASE WHEN excluded.project <> '' THEN excluded.project ELSE sessions.project END,
          source = CASE WHEN sessions.source = 'live' THEN 'live' ELSE excluded.source END
      `).run(String(sessionId), options.project ?? "", Math.trunc(version), Date.now(), options.source ?? "live");
		});
	}
};
let activeStore = null;
let lastState = {
	persisted: false,
	reason: "not-opened",
	driver: null
};
let degradedWarned = false;
function warnStatsDegradedOnce(message) {
	if (degradedWarned) return;
	degradedWarned = true;
	console.warn("context-compression stats persistence degraded: %s", message);
}
/** 当前持久化状态(同步读,不触发打开)。 */
function statsPersistenceState() {
	return lastState;
}
/** 活动句柄;未开/已关 = null。 */
function getStatsStore() {
	return activeStore;
}
/**
* 幂等打开生命周期句柄(apply 后台 arm 与测试用):已开直接复用;无驱动 →
* state no-driver + warn 恰一次;拒开/损坏 → state open-failed + warn 恰一次,
* **不抛**——统计持久化故障绝不阻塞压缩主路径(dsh-compaction-guard 教训)。
*/
async function ensureStatsStore(dbPath) {
	if (activeStore !== null) return activeStore;
	const path = resolveStatsDbPath(dbPath === void 0 ? {} : { dbPath });
	try {
		const opened = await openStatsDatabase(path);
		if (opened === null) {
			lastState = {
				persisted: false,
				reason: "no-driver",
				driver: null
			};
			warnStatsDegradedOnce("no SQLite driver available (better-sqlite3 absent and node:sqlite unsupported)");
			return null;
		}
		activeStore = new StatsStore(opened.db, opened.driver);
		lastState = {
			persisted: true,
			driver: opened.driver
		};
		return activeStore;
	} catch (error) {
		const message = String(error?.message ?? error);
		lastState = {
			persisted: false,
			reason: "open-failed",
			driver: null,
			error: message
		};
		warnStatsDegradedOnce(`open failed: ${message}`);
		return null;
	}
}
/** 幂等关闭(ctx.effect 卸载缝调用,防热重载泄 fd)。状态回落 not-opened。 */
function closeStatsStore() {
	if (activeStore === null) return;
	activeStore.close();
	activeStore = null;
	lastState = {
		persisted: false,
		reason: "not-opened",
		driver: null
	};
}
//#endregion
//#region src/runtime/stats-sync.ts
/** usage 逐科目枚举:claims.component 的封闭取值(进主键,禁自由文本)。 */
const USAGE_COMPONENTS = [
	{
		field: "inputTokens",
		component: "input"
	},
	{
		field: "outputTokens",
		component: "output"
	},
	{
		field: "cacheReadTokens",
		component: "cacheRead"
	},
	{
		field: "cacheWriteTokens",
		component: "cacheWrite"
	}
];
/** usage flush 的 debounce 窗口(秒级,spec T8)。 */
const USAGE_FLUSH_DEBOUNCE_MS = 1e3;
let writeFailureWarned = false;
function warnWriteFailureOnce(error) {
	if (writeFailureWarned) return;
	writeFailureWarned = true;
	const message = String(error?.message ?? error);
	console.warn("context-compression stats persistence write failed (claims fall back to in-memory only): %s", message);
}
let livePathBusy = false;
/** 标记前台压缩窗口开/关(pruner fresh 段 try/finally 驱动)。 */
function setStatsLivePathBusy(busy) {
	livePathBusy = busy;
}
/** 前台压缩是否进行中(回填让路判据;查询零开销)。 */
function isStatsLivePathBusy() {
	return livePathBusy;
}
let activeRuntimeSessionId;
/** 请求边界处记下活跃会话(pruner/stats-sync 调用;幂等写字符串)。 */
function noteStatsSessionActive(sessionId) {
	activeRuntimeSessionId = sessionId;
}
/** 当前活跃会话指针(浮窗六值的解析基准;无请求活动 = undefined)。 */
function getStatsActiveSessionId() {
	return activeRuntimeSessionId;
}
/** store 在场才执行写体;缺席空转,异常一律门闩 warn,绝不上抛。 */
function withStoreWrite(label, fn) {
	const store = getStatsStore();
	if (store === null) return;
	try {
		fn(store);
	} catch (error) {
		warnWriteFailureOnce(`${label}: ${String(error?.message ?? error)}`);
	}
}
/** 单条 saving claim(land 成功点与内存账本同位同值)。 */
function claimSaving(input) {
	if (!Number.isFinite(input.tokensRemoved) || input.tokensRemoved <= 0) return;
	const row = {
		seq: Math.trunc(input.replacementSeq),
		kind: "saving",
		component: input.component,
		basis: input.basis,
		tokens: Math.trunc(input.tokensRemoved),
		at: Date.now()
	};
	withStoreWrite("claim saving", (store) => {
		store.recordClaims(input.sessionId, [row]);
	});
}
/** 主 land(pruner land() recordSaving 同点):已落盘削减的 saving claim。 */
function claimFromLand(input) {
	claimSaving({
		sessionId: input.sessionId,
		component: input.component,
		tokensRemoved: input.tokensBefore - input.tokensAfter,
		basis: input.basis,
		replacementSeq: input.replacementSeq
	});
}
/** tail-trim 组回收(同 land 纪律,component 固定 'tail-trim')。 */
function reclaimFromTailTrim(input) {
	claimSaving({
		sessionId: input.sessionId,
		component: "tail-trim",
		tokensRemoved: input.tokensBefore - input.tokensAfter,
		basis: input.basis,
		replacementSeq: input.replacementSeq
	});
}
/** retrieve 回读抵消的 offset claim;seq = 被召回源事件绝对 seq(定键见头注)。 */
function claimOffset(input) {
	if (!Number.isFinite(input.tokens) || input.tokens <= 0) return;
	const row = {
		seq: Math.trunc(input.sourceSeq),
		kind: "offset",
		component: input.component,
		basis: input.basis,
		tokens: Math.trunc(input.tokens),
		at: Date.now()
	};
	withStoreWrite("claim offset", (store) => {
		store.recordClaims(input.sessionId, [row]);
	});
}
/**
* 立即扫描事件日志并把水位之后的 usage 逐科目落库;sessions.version 水位
* 单调前推(source=live,即便本轮零新增也 upsert 会话行——dispose 的
* "标记 source=live" 出口)。无 store 时空转。
*/
function flushUsage(session) {
	withStoreWrite("usage flush", (store) => {
		const sid = String(session.id);
		const watermark = store.getSessionWatermark(sid);
		const rows = [];
		let covered = watermark;
		for (const event of sessionEvents(session)) {
			const seq = Number(event.seq);
			if (!Number.isFinite(seq) || seq <= watermark) continue;
			if (seq > covered) covered = seq;
			if (event.type !== "assistant/message") continue;
			const usage = event.data.usage;
			if (usage === void 0) continue;
			const at = Number(event.time) || Date.now();
			for (const { field, component } of USAGE_COMPONENTS) {
				const tokens = usage[field];
				if (typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0) rows.push({
					seq,
					kind: "usage",
					component,
					basis: "",
					tokens: Math.trunc(tokens),
					at
				});
			}
		}
		if (rows.length > 0) store.recordClaims(sid, rows);
		if (covered > 0) store.setSessionWatermark(sid, covered, { source: "live" });
	});
}
const pendingUsageFlushes = /* @__PURE__ */ new Map();
/** 秒级 debounce 的 usage flush 入口(fresh 边界 recordUsage 同点调度)。 */
function scheduleUsageFlush(session) {
	const sid = String(session.id);
	noteStatsSessionActive(sid);
	const existing = pendingUsageFlushes.get(sid);
	if (existing !== void 0) {
		existing.session = session;
		return;
	}
	const timer = setTimeout(() => {
		const entry = pendingUsageFlushes.get(sid);
		if (entry === void 0) return;
		pendingUsageFlushes.delete(sid);
		flushUsage(entry.session);
	}, USAGE_FLUSH_DEBOUNCE_MS);
	timer.unref?.();
	pendingUsageFlushes.set(sid, {
		session,
		timer
	});
}
/**
* session/disposed 残量出口(T9):取消在途 debounce、立即 flush 全部未落库
* usage,并 upsert 会话行标记 source=live。老代际不发该事件时本函数只是
* 不被调用——随写随刷路径不受影响(不依赖 dispose 的可靠性)。
*/
function flushUsageOnDispose(session) {
	const sid = String(session.id);
	const entry = pendingUsageFlushes.get(sid);
	if (entry !== void 0) {
		clearTimeout(entry.timer);
		entry.timer.unref?.();
		pendingUsageFlushes.delete(sid);
	}
	flushUsage(session);
	withStoreWrite("dispose session row", (store) => {
		store.setSessionWatermark(sid, store.getSessionWatermark(sid), { source: "live" });
	});
}
/**
* 积分器采样落库（spec T15）：fresh 边界的存量净快照 + 该次调用 usage 拆分。
* 行形 kind='sample'、basis=''、component ∈ {netExact, netEstimated,
* cachedInput, uncachedInput}（与 StatsStore.sumSamples 的读取面一致），幂等键
* (session_id, boundarySeq, 'sample', component, '')——同一边界重放零新增，
* calls（distinct seq 数）不涨。零值行不写（无信息量）；负净额照写（召回后
* 存量转负正是积分回落的语义）。sample 不前推 sessions 水位——覆盖语义归
* flushUsage 的 usage 行。
*/
function recordIntegralSample(input) {
	if (!Number.isFinite(input.boundarySeq) || input.boundarySeq < 0) return;
	const candidates = [
		["netExact", input.netExact],
		["netEstimated", input.netEstimated],
		["cachedInput", input.cachedInput],
		["uncachedInput", input.uncachedInput]
	];
	const rows = [];
	for (const [component, tokens] of candidates) {
		if (!Number.isFinite(tokens) || tokens === 0) continue;
		rows.push({
			seq: Math.trunc(input.boundarySeq),
			kind: "sample",
			component,
			basis: "",
			tokens: Math.trunc(tokens),
			at: Date.now()
		});
	}
	if (rows.length === 0) return;
	withStoreWrite("integral sample", (store) => {
		store.recordClaims(input.sessionId, rows);
	});
}
/**
* /ccip `flush` 的抓手（spec T31）：立即冲刷全部在途 usage debounce（等价于
* 对每个挂起会话跑一次 dispose 出口,但不 upsert source——活跃会话的归属不变）。
*/
function flushPendingUsageNow() {
	const entries = [...pendingUsageFlushes.values()];
	pendingUsageFlushes.clear();
	for (const entry of entries) {
		clearTimeout(entry.timer);
		entry.timer.unref?.();
	}
	for (const entry of entries) flushUsage(entry.session);
}
/** 测试/卸载清理:丢弃全部在途 debounce(已落库数据不回滚)。 */
function cancelPendingUsageFlushes() {
	for (const entry of pendingUsageFlushes.values()) {
		clearTimeout(entry.timer);
		entry.timer.unref?.();
	}
	pendingUsageFlushes.clear();
}
//#endregion
//#region src/runtime/stats-backfill.ts
/**
* 旧会话回填主体（spec 持久层主干 T18/T20）——双后端共用同一 claims 提取核心。
*
* **后端 A**（优先）：宿主 `sessionQuery` 服务的 listSessions/readSession +
* version 水位 diff（结构照 SI sync.ts:106-153）。服务面零格式风险；服务缺席
* 返回 `available:false` 标记，不抛。
*
* **后端 B**（fallback，满足"按磁盘行为记录统计旧会话"的显式需求）：
* `<dshHome>/sessions/**` 目录发现（判据 = 目录里有规范代次产物或迁移暂存，
* 不要求任何具体文件名，照 SS scan.ts:62-102）→ T19 叶子模块解码 → 同一提取
* 核心。**绝不写会话文件**（SS 红线先例）。
*
* fail-soft 接线（T19 留的裁决位）：header 代次未知/缺失/非会话头 → 跳过该
* 会话 + 整进程恰一条聚合 warn（门闩在模块级，测试 resetModules 隔离）。
*
* 计数口径（裁决 7）：零 tokenizer——savings/offsets 由 projectSavingsCore
* 注入"拒绝精确计数"的假计数器得到 chars/4 口径行；usage 从
* `assistant/message.data.usage` 的固定科目白名单逐事件求和。所有行以
* (sessionId, 绝对 seq, kind, component, basis) 主键 INSERT OR IGNORE 幂等。
*
* live 护栏：会话行 `source='live'` 即整段跳过——live 路径的组件名
* (fresh/history/…)与投影行 ('projection') 主键不同，若两边都写会双计。
*
* @module dsh-context-compression-improved/runtime/stats-backfill
*/
/** 回填计数口径的注入计数器：恒拒绝精确计数 → 投影全部落 chars/4 分列。 */
const BACKFILL_COUNTER = () => unavailableTokenCount("stats backfill counts without tokenizer by design");
/** usage 落库科目白名单：字段名(磁盘) → claim component(固定模板，无自由文本)。 */
const USAGE_FIELDS = [
	["inputTokens", "input"],
	["outputTokens", "output"],
	["cacheReadTokens", "cacheRead"],
	["cacheWriteTokens", "cacheWrite"]
];
/** 语料枚举上限——SS 实测教训：这是防无界遍历的边界而非策略，取宽量级。 */
const DISCOVERY_LIMIT = 1e5;
/**
* 从事件流重建当前 surface 节点集合：顺序走 append/replace 语义
* （replace 事件把 [start,end] 移出 surface、自身入 surface）。
* 两后端共用——同 feed 必同 surface，这是"双后端结果一致"的前提。
*/
function replaySurfaceNodes(events) {
	const surface = /* @__PURE__ */ new Set();
	for (const event of events) {
		const op = event.surfaceOp;
		if (op !== null && typeof op === "object" && op.op === "replace") {
			const start = Number(op.startSeq);
			const end = Number(op.endSeq);
			if (Number.isFinite(start) && Number.isFinite(end)) for (let seq = start; seq <= end; seq += 1) surface.delete(seq);
		}
		surface.add(Number(event.seq));
	}
	return [...surface];
}
/**
* 同一 claims 提取核心（后端 A/B 共用，T23 的一致性对象）：
* 投影 savings/offsets + `assistant/message` 的 usage 固定科目求和。
* 纯函数：不落库、不告警、不抛事件形状问题（坏行走投影内部 fail-open）。
*/
function extractBackfillClaims(events) {
	if (events.length === 0) return {
		rows: [],
		maxSeq: 0
	};
	let maxSeq = 0;
	for (const event of events) maxSeq = Math.max(maxSeq, Number(event.seq));
	const projection = projectSavingsCore({
		events,
		surfaceNodes: replaySurfaceNodes(events),
		counter: BACKFILL_COUNTER
	});
	const rows = [];
	for (const saving of projection.savings) rows.push({
		seq: saving.replacementSeq,
		kind: "saving",
		component: "projection",
		basis: saving.basis,
		tokens: saving.tokens,
		at: saving.at
	});
	for (const offset of projection.offsets) rows.push({
		seq: offset.seq,
		kind: "offset",
		component: offset.component,
		basis: offset.basis,
		tokens: offset.tokens,
		at: offset.at
	});
	for (const event of events) {
		if (event.type !== "assistant/message") continue;
		const usage = event.data?.["usage"];
		if (usage === void 0 || typeof usage !== "object") continue;
		for (const [field, component] of USAGE_FIELDS) {
			const value = usage[field];
			if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
			rows.push({
				seq: Number(event.seq),
				kind: "usage",
				component,
				basis: "",
				tokens: Math.round(value),
				at: Number(event.time) || 0
			});
		}
	}
	return {
		rows,
		maxSeq
	};
}
function newPassResult(backend, available) {
	return {
		backend,
		available,
		sessions: 0,
		skipped: 0,
		claimsAdded: 0,
		failures: []
	};
}
/** live 护栏：会话行已被 live 路径认领 → 回填整段跳过（防双计）。 */
function isLiveOwned(store, sessionId) {
	return store.getSessionRecord(sessionId)?.source === "live";
}
/**
* 后端 A 一轮：listSessions → 与 sessions.version 水位 diff → 新/变更会话
* readSession → 提取核心落库 → 写回 version 水位。
* 服务缺席（老线宿主无该可选服务）→ available:false，调用方应退后端 B。
*/
async function backfillViaSessionQuery(store, sessionQuery, options = {}) {
	const result = newPassResult("sessionQuery", sessionQuery !== void 0);
	if (sessionQuery === void 0) return result;
	let records;
	try {
		records = await sessionQuery.listSessions();
	} catch (error) {
		result.available = false;
		result.failures.push({
			sessionId: "*",
			error: String(error?.message ?? error)
		});
		return result;
	}
	const limit = options.maxSessions ?? records.length;
	for (const record of records.slice(0, Math.max(0, limit))) {
		const sessionId = String(record.header.id);
		if (isLiveOwned(store, sessionId)) {
			result.skipped += 1;
			continue;
		}
		const existing = store.getSessionRecord(sessionId);
		if (existing !== void 0 && existing.version === record.header.version) {
			result.skipped += 1;
			continue;
		}
		try {
			const log = await sessionQuery.readSession(sessionId);
			const { rows } = extractBackfillClaims(log.events);
			result.claimsAdded += store.recordClaims(sessionId, rows);
			const version = Number.isFinite(log.session.version) ? log.session.version : record.header.version;
			store.setSessionWatermark(sessionId, version, {
				project: log.session.cwd ?? record.header.cwd ?? "",
				source: "backfill"
			});
			result.sessions += 1;
		} catch (error) {
			result.failures.push({
				sessionId,
				error: String(error?.message ?? error)
			});
		}
	}
	return result;
}
/**
* `<dshHome>/sessions/**` 递归发现：判据 = 目录内有规范代次产物或迁移暂存
* （不要求具体文件名，照 SS scan 的栈遍历）。仅暂存（迁移进行中）的目录
* 不构成可解码产物，跳过。
*/
function discoverBackfillSessionLogs(dshHome, limit = DISCOVERY_LIMIT) {
	const root = join(dshHome, "sessions");
	const out = [];
	if (!existsSync(root)) return out;
	const stack = [root];
	while (stack.length > 0 && out.length < limit) {
		const dir = stack.pop();
		if (dir === void 0) continue;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const path = join(dir, entry.name);
			const generations = readSessionGenerations(path);
			if (generations.canonical.length === 0 && generations.staging.length === 0) {
				stack.push(path);
				continue;
			}
			const current = generations.current;
			if (current === void 0) continue;
			if (out.length >= limit) break;
			out.push({
				dirSessionId: entry.name,
				dir: path,
				artifact: current
			});
		}
	}
	return out;
}
let unknownGenerationWarned = false;
function emitFailSoftWarnOnce(sink, skipped) {
	if (unknownGenerationWarned || skipped.length === 0) return;
	unknownGenerationWarned = true;
	const sample = skipped.slice(0, 3).map((entry) => `${entry.sessionId}(${entry.state})`).join(", ");
	sink(`${skipped.length} session log(s) skipped: header generation unknown (${sample}${skipped.length > 3 ? ", …" : ""})`);
}
/**
* 后端 B 一轮：目录发现 → 当前代产物只读解码 → fail-soft 代次裁决 →
* 提取核心落库（source=backfill，水位 = 观测 maxSeq）。
* 绝不写会话文件；单会话失败隔离进 failures。
*/
async function backfillViaSessionFiles(store, options = {}) {
	const result = newPassResult("files", true);
	const dshHome = options.dshHome ?? resolveStatsDshHome(options);
	const decoders = options.decoders !== void 0 ? options.decoders : await loadOfficialDecoders();
	const sink = options.warn ?? ((message) => {
		console.warn("context-compression stats backfill: %s", message);
	});
	const softSkipped = [];
	const discovered = discoverBackfillSessionLogs(dshHome, options.maxSessions ?? DISCOVERY_LIMIT);
	result.totalDiscovered = discovered.length;
	const offset = Math.max(0, options.slice?.offset ?? 0);
	const windowLimit = Math.max(0, options.slice?.limit ?? discovered.length);
	const windowed = discovered.slice(offset, offset + windowLimit);
	for (const found of windowed) {
		if (isLiveOwned(store, found.dirSessionId)) {
			result.skipped += 1;
			continue;
		}
		let log;
		try {
			log = decodeSessionLogBytes(readFileSync(found.artifact.path), decoders);
		} catch (error) {
			result.failures.push({
				sessionId: found.dirSessionId,
				error: String(error?.message ?? error)
			});
			continue;
		}
		const verdict = classifySessionHeader(log.header);
		if (verdict.state !== "known") {
			softSkipped.push({
				sessionId: found.dirSessionId,
				state: verdict.state
			});
			result.skipped += 1;
			continue;
		}
		const headerId = log.header?.["id"];
		const sessionId = typeof headerId === "string" && headerId.trim() !== "" ? headerId.trim() : found.dirSessionId;
		if (isLiveOwned(store, sessionId)) {
			result.skipped += 1;
			continue;
		}
		const { rows, maxSeq } = extractBackfillClaims(log.events);
		const existingRecord = store.getSessionRecord(sessionId);
		if (existingRecord !== void 0 && existingRecord.source === "backfill" && existingRecord.version >= maxSeq) {
			result.skipped += 1;
			continue;
		}
		try {
			result.claimsAdded += store.recordClaims(sessionId, rows);
			const headerCwd = log.header?.["cwd"];
			store.setSessionWatermark(sessionId, maxSeq, {
				project: typeof headerCwd === "string" ? headerCwd : "",
				source: "backfill"
			});
			result.sessions += 1;
		} catch (error) {
			result.failures.push({
				sessionId,
				error: String(error?.message ?? error)
			});
		}
	}
	emitFailSoftWarnOnce(sink, softSkipped);
	return result;
}
/**
* 回填调度器：把双后端包成分块、可暂停、有触发源的进程级单例。
*
* 触发源（spec T21）：
*  - `/savings|/monitor` 路由首次命中（`kickStatsBackfillOnRouteHit`，一次性
*    闸——面板轮询每 2-5s 打一次路由，闸保证只播一轮）；
*  - dispose 后低频（`kickStatsBackfillOnDispose`，10 分钟节流——老代际不发
*    session/disposed 时该源静默闲置，与 T9 同一宽容语义）。
*
* 分块：后端 A 本就是逐会话 await（服务面 IO 天然让出）；后端 B 的 decode 是
* 同步 CPU（实测 ~84ms/会话），按 chunk 切片、chunk 间 setImmediate 让出事件
* 循环，一轮 pass 至多完整扫一遍发现列表（游标跨 pass 记忆，wrap 后归零——
* 水位让重扫幂等零新增）。
*
* 暂停面（/ccip T31 的预留挂点）：`pauseStatsBackfill` 后所有 kick 与直接
* `runStatsBackfillPass` 都空转；status 面板/命令读 `getStatsBackfillStatus`。
* 调度器绝不抛错到触发源——所有失败进 pass.failures / lastSummary。
*/
const DISPOSE_KICK_MIN_INTERVAL_MS = 6e5;
/** 每 chunk 处理的会话数（10-50 区间中点；25×84ms ≈ 2.1s CPU/chunk，间隙让出）。 */
const FILES_CHUNK_SIZE = 25;
/** 后端 A 单轮服务的会话上限（listSessions 全量但 readSession 逐个 await；防御性封顶）。 */
const SESSION_QUERY_PASS_CAP = 500;
const schedulerState = {
	sessionQuery: void 0,
	routeKickArmed: false,
	lastDisposeKickAt: 0,
	running: false,
	paused: false,
	filesCursor: 0,
	runs: 0,
	lastRunAt: 0,
	lastSummary: void 0
};
/** 注入触发源依赖（index.ts apply 时调用一次）：sessionQuery 服务的惰性解析器。 */
function configureStatsBackfillTrigger(input = {}) {
	schedulerState.sessionQuery = input.sessionQuery;
}
/** 路由首次命中触发（一次性闸；面板轮询重复命中零开销）。 */
function kickStatsBackfillOnRouteHit() {
	if (schedulerState.routeKickArmed) return;
	schedulerState.routeKickArmed = true;
	runStatsBackfillPass().catch(() => void 0);
}
/** dispose 后低频触发（10 分钟节流）；paused/running 时不消耗节流窗口。 */
function kickStatsBackfillOnDispose() {
	if (schedulerState.paused || schedulerState.running) return;
	const now = Date.now();
	if (now - schedulerState.lastDisposeKickAt < DISPOSE_KICK_MIN_INTERVAL_MS) return;
	schedulerState.lastDisposeKickAt = now;
	runStatsBackfillPass().catch(() => void 0);
}
/** /ccip T31 预留：暂停后所有 kick 与直接 pass 空转（在途 chunk 完成本轮即止）。 */
function pauseStatsBackfill() {
	schedulerState.paused = true;
}
function resumeStatsBackfill() {
	schedulerState.paused = false;
}
function getStatsBackfillStatus() {
	return {
		running: schedulerState.running,
		paused: schedulerState.paused,
		runs: schedulerState.runs,
		lastRunAt: schedulerState.lastRunAt,
		...schedulerState.lastSummary === void 0 ? {} : { lastSummary: schedulerState.lastSummary }
	};
}
/** chunk 间让出事件循环（setImmediate 不吊进程退出）。 */
function yieldToEventLoop() {
	return new Promise((resolve) => {
		setImmediate(() => resolve()).unref?.();
	});
}
function mergeFileChunk(merged, chunk) {
	merged.sessions += chunk.sessions;
	merged.skipped += chunk.skipped;
	merged.claimsAdded += chunk.claimsAdded;
	for (const failure of chunk.failures) {
		if (merged.failures.length >= 50) break;
		merged.failures.push(failure);
	}
}
/** 前台活跃压缩期间回填让路(轮询 busy 旗标);上限防旗标异常悬挂饿死回填。 */
const LIVE_PATH_POLL_MS = 800;
const LIVE_PATH_MAX_WAIT_MS = 12e4;
async function yieldToLivePath() {
	const start = Date.now();
	while (isStatsLivePathBusy() && Date.now() - start < LIVE_PATH_MAX_WAIT_MS) await new Promise((resolve) => setTimeout(resolve, LIVE_PATH_POLL_MS));
}
/**
* 跑一轮回填（后端 A 优先，缺席降级后端 B 分块全扫）。running/paused/无 store
* 时返回 undefined（触发源丢弃即可）；异常一律吞进返回值语义,绝不上抛到触发源。
* 前台优先纪律:pass 开始与后端 B 每个 chunk 前都先让路活跃压缩窗口。
*/
async function runStatsBackfillPass(options = {}) {
	const store = options.store ?? getStatsStore();
	if (store === null || schedulerState.running || schedulerState.paused) return void 0;
	schedulerState.running = true;
	try {
		await yieldToLivePath();
		const passA = await backfillViaSessionQuery(store, options.sessionQuery ?? schedulerState.sessionQuery?.(), { maxSessions: Math.min(options.maxSessionsPerBackend ?? SESSION_QUERY_PASS_CAP, SESSION_QUERY_PASS_CAP) });
		if (passA.available) {
			schedulerState.runs += 1;
			schedulerState.lastRunAt = Date.now();
			schedulerState.lastSummary = {
				backend: passA.backend,
				sessions: passA.sessions,
				skipped: passA.skipped,
				claimsAdded: passA.claimsAdded,
				failures: passA.failures.length
			};
			return passA;
		}
		const merged = newPassResult("files", true);
		const chunkLimit = Math.max(1, options.maxSessionsPerBackend ?? FILES_CHUNK_SIZE);
		let sweepOffset = schedulerState.filesCursor;
		for (;;) {
			await yieldToLivePath();
			const chunk = await backfillViaSessionFiles(store, {
				...options.dshHome === void 0 ? {} : { dshHome: options.dshHome },
				...options.warn === void 0 ? {} : { warn: options.warn },
				slice: {
					offset: sweepOffset,
					limit: chunkLimit
				}
			});
			const total = chunk.totalDiscovered ?? 0;
			mergeFileChunk(merged, chunk);
			if (total === 0) {
				sweepOffset = 0;
				break;
			}
			sweepOffset += chunkLimit;
			if (sweepOffset >= total) {
				sweepOffset = 0;
				break;
			}
			await yieldToEventLoop();
		}
		schedulerState.filesCursor = sweepOffset;
		schedulerState.runs += 1;
		schedulerState.lastRunAt = Date.now();
		schedulerState.lastSummary = {
			backend: merged.backend,
			sessions: merged.sessions,
			skipped: merged.skipped,
			claimsAdded: merged.claimsAdded,
			failures: merged.failures.length
		};
		return merged;
	} finally {
		schedulerState.running = false;
	}
}
//#endregion
//#region src/runtime/savings-integral.ts
/** 采样时刻事件日志的最大绝对 seq;空日志(无从定键)返回 undefined。 */
function latestEventSeq(session) {
	let max;
	for (const event of sessionEvents(session)) {
		const seq = Number(event.seq);
		if (Number.isFinite(seq)) max = max === void 0 ? seq : Math.max(max, seq);
	}
	return max;
}
/** usage 拆分:cacheRead = 命中;uncached = input − cacheRead(负截 0);非法值记 0。 */
function splitCachedUncached(usage) {
	const cached = typeof usage?.cacheReadTokens === "number" && Number.isFinite(usage.cacheReadTokens) && usage.cacheReadTokens > 0 ? Math.trunc(usage.cacheReadTokens) : 0;
	const input = typeof usage?.inputTokens === "number" && Number.isFinite(usage.inputTokens) && usage.inputTokens > 0 ? Math.trunc(usage.inputTokens) : 0;
	return {
		cachedInput: cached,
		uncachedInput: Math.max(0, input - cached)
	};
}
/** fresh 边界采样入口:定键 → 拆分 → 经 stats-sync 幂等落库;空日志静默跳过。 */
function sampleIntegralBoundary(input) {
	const boundarySeq = latestEventSeq(input.session);
	if (boundarySeq === void 0) return;
	const { cachedInput, uncachedInput } = splitCachedUncached(input.usage);
	recordIntegralSample({
		sessionId: input.sessionId,
		boundarySeq,
		netExact: input.net.exact,
		netEstimated: input.net.estimated,
		cachedInput,
		uncachedInput
	});
}
/**
* 省钱估计(T16):cached 走 inputCacheHit、uncached 走 inputCacheMiss,
* femto = tokens × nanoRate(与定价模块 amountFor 同构,输出侧不计——
* 积分口径只对输入省钱)。费率不可解析(理论上目录内不会)返回 null。
*/
function estimateIntegralMoney(input) {
	const hit = decimalRateNanoUnits(input.record.inputCacheHit);
	const miss = decimalRateNanoUnits(input.record.inputCacheMiss);
	if (hit === void 0 || miss === void 0) return null;
	const cached = Number.isFinite(input.cachedInput) && input.cachedInput > 0 ? BigInt(Math.trunc(input.cachedInput)) : 0n;
	const uncached = Number.isFinite(input.uncachedInput) && input.uncachedInput > 0 ? BigInt(Math.trunc(input.uncachedInput)) : 0n;
	if (cached === 0n && uncached === 0n) return null;
	const femtoUnits = cached * hit + uncached * miss;
	return {
		decimal: formatFemtoUnits(femtoUnits),
		femtoUnits: femtoUnits.toString(),
		currency: input.record.currency,
		band: input.record.band
	};
}
/** femto(1e-15)整数 → 十进制串;与定价模块的 femto 渲染同构(模块内私有,此处独立实现)。 */
function formatFemtoUnits(value) {
	const digits = value.toString().padStart(16, "0");
	const whole = digits.slice(0, -15);
	const fraction = digits.slice(-15).replace(/0+$/u, "");
	return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}
//#endregion
export { isValidAutoCompactThresholdPercent as $, officialRequestUsage as A, recordRecertified as At, unavailableCount as B, resolveStatsDshHome as C, getAdvisorState as Ct, dedupePlaceholder as D, invalidateOnTaskChange as Dt, dedupeHash as E, getSummaryOverride as Et, onlyTextBlocks as F, priceOfficialDeepSeekUsage as Ft, ContextCompressionSettingsSchema as G, countOmittedLines as H, pressureCost as I, resolveOfficialDeepSeekPrice as It, PRUNE_MARKER as J, DEFAULTS as K, recoveryMarker as L, getSavingsLedger as Lt, emptyResult as M, setSummaryOverride as Mt, nativePruneContent as N, DEEPSEEK_OFFICIAL_PRICE_CATALOG_VERSION as Nt, flattenPlainText as O, observeIntentEnabled as Ot, onlyTextBlock as P, decimalRateNanoUnits as Pt, isCompressionProfile as Q, sameProviderMeasurementKey as R, statsPersistenceState as S, evaluateIntentGate as St, DedupeTable as T, getObservedIntentEnabled as Tt, AUTO_COMPACT_THRESHOLD_LIMITS as U, CAPACITY_PRESSURE_RATIO as V, CONTEXT_COMPRESSION_SETTINGS_NAMESPACE as W, charsToTokens as X, charsForTokens as Y, codePointLength as Z, scheduleUsageFlush as _, isSessionOverrideAction as _t, getStatsBackfillStatus as a, resolveCustomPolicy as at, ensureStatsStore as b, INTENT_GATE_FLOOR_FRACTION as bt, pauseStatsBackfill as c, COMPRESSION_PROFILES as ct, claimFromLand as d, decodeSessionLogBytes as dt, parseContextCompressionSettings as et, claimOffset as f, deepSeekV4TokenizerForModel as ft, reclaimFromTailTrim as g, estimateSavingsPricing as gt, getStatsActiveSessionId as h, drsTotalsFragment as ht, discoverBackfillSessionLogs as i, DEFAULT_CUSTOM_COMPRESSION_POLICY as it, countToolContent as j, recordScore as jt, measureForCompaction as k, recordIntentFold as kt, resumeStatsBackfill as l, countExactCanonicalTextFields as lt, flushUsageOnDispose as m, buildMonitorSnapshot as mt, sampleIntegralBoundary as n, resolvePolicy as nt, kickStatsBackfillOnDispose as o, assertNever as ot, flushPendingUsageNow as p, applySessionOverride as pt, DEFAULT_CONTEXT_COMPRESSION_SETTINGS as q, configureStatsBackfillTrigger as r, CustomCompressionPolicySchema as rt, kickStatsBackfillOnRouteHit as s, deepFreeze as st, estimateIntegralMoney as t, resolveConfig as tt, cancelPendingUsageFlushes as u, unavailableTokenCount as ut, setStatsLivePathBusy as v, mergeCompositionByComponent as vt, projectSessionSavings as w, getLastIntentFold as wt, getStatsStore as x, INTENT_GATE_GROWTH_TOKENS as xt, closeStatsStore as y, observeContextUsage as yt, summarize as z };
