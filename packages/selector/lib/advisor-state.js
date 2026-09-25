import z from "@deepseek-ai/schemastery";
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
	codeSkeleton: { enabled: false }
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
	const unknown = Object.keys(candidate).find((key) => key !== "profile" && key !== "custom" && key !== "autoCompact" && key !== "codeSkeleton" && key !== "presetOptions");
	if (unknown !== void 0) throw new TypeError(`Context-compression settings: unknown key "${unknown}"`);
	assertPresentSection(candidate, "profile", isSupportedProfile);
	assertPresentSection(candidate, "custom", isUsableCustomDocument);
	const autoCompact = parseAutoCompactSettings(candidate.autoCompact);
	const codeSkeleton = parseCodeSkeletonSettings(candidate.codeSkeleton);
	const presetOptions = parsePresetOptionsSettings(candidate.presetOptions);
	return {
		...contextCompressionSettingsInputSchema(candidate),
		autoCompact,
		codeSkeleton,
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
//#endregion
export { deepFreeze as C, assertNever as S, resolveConfig as _, AUTO_COMPACT_THRESHOLD_LIMITS as a, DEFAULT_CUSTOM_COMPRESSION_POLICY as b, DEFAULTS as c, charsForTokens as d, charsToTokens as f, parseContextCompressionSettings as g, isValidAutoCompactThresholdPercent as h, recordScore as i, DEFAULT_CONTEXT_COMPRESSION_SETTINGS as l, isCompressionProfile as m, invalidateOnTaskChange as n, CONTEXT_COMPRESSION_SETTINGS_NAMESPACE as o, codePointLength as p, recordRecertified as r, ContextCompressionSettingsSchema as s, getAdvisorState as t, PRUNE_MARKER as u, resolvePolicy as v, COMPRESSION_PROFILES as w, resolveCustomPolicy as x, CustomCompressionPolicySchema as y };
