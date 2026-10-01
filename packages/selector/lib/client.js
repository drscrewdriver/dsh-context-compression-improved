window.__ModuleLoader__.load({
	id: "dsh-context-compression-improved",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/profiles.ts
		/** Public context-compression choices shared by the Host schema and browser selector. */
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
		/** Browser-safe mirror of the Host's Balanced-equivalent Custom default. */
		const DEFAULT_CUSTOM_COMPRESSION_POLICY = {
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
		};
		/**
		* Decode the persisted codeSkeleton section with exactly the runtime schema's
		* strictness: absent means the lossless off default; present values must be a
		* plain object carrying only a boolean `enabled`. Anything else is invalid,
		* never silently coerced.
		*/
		function decodeCodeSkeletonSettings(value) {
			if (value === void 0) return { enabled: false };
			if (!isPlainRecord(value)) return void 0;
			const keys = Object.keys(value);
			if (keys.length !== 1 || keys[0] !== "enabled") return void 0;
			const enabled = value.enabled;
			return typeof enabled === "boolean" ? { enabled } : void 0;
		}
		/** Browser-safe mirror of the runtime intentSummary section (absent inherits off). */
		function decodeIntentSummarySettings(value) {
			if (value === void 0) return { enabled: false };
			if (!isPlainRecord(value)) return void 0;
			const keys = Object.keys(value);
			if (keys.length !== 1 || keys[0] !== "enabled") return void 0;
			const enabled = value.enabled;
			return typeof enabled === "boolean" ? { enabled } : void 0;
		}
		/**
		* Browser mirror of the runtime presetOptions section: absent inherits the
		* preset defaults (decodes to `undefined`); present values must be a plain
		* object carrying only the known keys with valid types.
		*/
		function decodePresetOptionsSettings(value) {
			if (value === void 0) return void 0;
			if (!isPlainRecord(value)) return void 0;
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
			if (Object.keys(value).some((key) => !allowed.has(key))) return void 0;
			for (const key of [
				"dedupeToolResults",
				"summaryLocator",
				"prefixStabilizer",
				"readState"
			]) {
				const entry = value[key];
				if (entry !== void 0 && typeof entry !== "boolean") return void 0;
			}
			const estimatorMode = value.estimatorMode;
			if (estimatorMode !== void 0 && estimatorMode !== "" && estimatorMode !== "host" && estimatorMode !== "direct") return;
			const advisorMode = value.advisorMode;
			if (advisorMode !== void 0 && advisorMode !== "" && advisorMode !== "host" && advisorMode !== "direct") return;
			for (const key of [
				"estimatorProvider",
				"estimatorModel",
				"estimatorBaseUrl",
				"estimatorApiKey"
			]) {
				const entry = value[key];
				if (entry !== void 0 && typeof entry !== "string") return void 0;
			}
			const estimatorTimeoutMs = value.estimatorTimeoutMs;
			if (estimatorTimeoutMs !== void 0 && (typeof estimatorTimeoutMs !== "number" || !Number.isSafeInteger(estimatorTimeoutMs) || estimatorTimeoutMs < 100 || estimatorTimeoutMs > 6e4)) return;
			const advisorTimeoutMs = value.advisorTimeoutMs;
			if (advisorTimeoutMs !== void 0 && (typeof advisorTimeoutMs !== "number" || !Number.isSafeInteger(advisorTimeoutMs) || advisorTimeoutMs < 100 || advisorTimeoutMs > 6e4)) return;
			const advisorRefreshTurns = value.advisorRefreshTurns;
			if (advisorRefreshTurns !== void 0 && (typeof advisorRefreshTurns !== "number" || !Number.isSafeInteger(advisorRefreshTurns) || advisorRefreshTurns < 1)) return;
			const advisorScoreThreshold = value.advisorScoreThreshold;
			if (advisorScoreThreshold !== void 0 && (typeof advisorScoreThreshold !== "number" || !Number.isFinite(advisorScoreThreshold) || advisorScoreThreshold <= 0 || advisorScoreThreshold >= 1)) return;
			const advisorSampleLimit = value.advisorSampleLimit;
			if (advisorSampleLimit !== void 0 && (typeof advisorSampleLimit !== "number" || !Number.isSafeInteger(advisorSampleLimit) || advisorSampleLimit < 1 || advisorSampleLimit > 64)) return;
			const advisorMinTokens = value.advisorMinTokens;
			if (advisorMinTokens !== void 0 && (typeof advisorMinTokens !== "number" || !Number.isSafeInteger(advisorMinTokens) || advisorMinTokens < 1)) return;
			const decoded = {};
			if (value.dedupeToolResults !== void 0) decoded.dedupeToolResults = value.dedupeToolResults;
			if (value.summaryLocator !== void 0) decoded.summaryLocator = value.summaryLocator;
			if (value.prefixStabilizer !== void 0) decoded.prefixStabilizer = value.prefixStabilizer;
			if (value.readState !== void 0) decoded.readState = value.readState;
			if (estimatorMode !== void 0) decoded.estimatorMode = estimatorMode;
			if (value.estimatorProvider !== void 0) decoded.estimatorProvider = value.estimatorProvider;
			if (value.estimatorModel !== void 0) decoded.estimatorModel = value.estimatorModel;
			if (value.estimatorBaseUrl !== void 0) decoded.estimatorBaseUrl = value.estimatorBaseUrl;
			if (value.estimatorApiKey !== void 0) decoded.estimatorApiKey = value.estimatorApiKey;
			if (estimatorTimeoutMs !== void 0) decoded.estimatorTimeoutMs = estimatorTimeoutMs;
			if (advisorMode !== void 0) decoded.advisorMode = advisorMode;
			if (advisorTimeoutMs !== void 0) decoded.advisorTimeoutMs = advisorTimeoutMs;
			if (advisorRefreshTurns !== void 0) decoded.advisorRefreshTurns = advisorRefreshTurns;
			if (advisorScoreThreshold !== void 0) decoded.advisorScoreThreshold = advisorScoreThreshold;
			if (advisorSampleLimit !== void 0) decoded.advisorSampleLimit = advisorSampleLimit;
			if (advisorMinTokens !== void 0) decoded.advisorMinTokens = advisorMinTokens;
			return decoded;
		}
		/**
		* The one threshold contract shared by the UI, the persisted settings, and the
		* runtime resolver; mirrored browser-safe from the runtime package.
		*/
		const AUTO_COMPACT_THRESHOLD_LIMITS = Object.freeze({
			min: 50,
			max: 90,
			step: 1,
			default: 80
		});
		/** Narrow one unknown value to a valid Auto Compact threshold percent. */
		function isValidAutoCompactThresholdPercent(value) {
			return typeof value === "number" && Number.isSafeInteger(value) && value >= AUTO_COMPACT_THRESHOLD_LIMITS.min && value <= AUTO_COMPACT_THRESHOLD_LIMITS.max;
		}
		/** Accept JSON-object records while rejecting class instances and exotic prototypes. */
		function isPlainRecord(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
			const prototype = Object.getPrototypeOf(value);
			return prototype === Object.prototype || prototype === null;
		}
		/**
		* Decode the persisted autoCompact section with exactly the runtime schema's
		* strictness: absent means the 80% default; present values must be a plain
		* object carrying only a valid `thresholdPercent`. Anything else is invalid,
		* never silently coerced.
		*/
		function decodeAutoCompactSettings(value) {
			if (value === void 0) return { thresholdPercent: AUTO_COMPACT_THRESHOLD_LIMITS.default };
			if (!isPlainRecord(value)) return void 0;
			const keys = Object.keys(value);
			if (keys.length !== 1 || keys[0] !== "thresholdPercent") return void 0;
			const thresholdPercent = value.thresholdPercent;
			return isValidAutoCompactThresholdPercent(thresholdPercent) ? { thresholdPercent } : void 0;
		}
		/**
		* Narrow an unknown settings value to a complete supported Custom policy.
		* @param value - Candidate settings value received from the Host or edited locally.
		* @returns Whether the value is a relation-valid Custom policy.
		*/
		function isCustomCompressionPolicy(value) {
			if (!hasExactKeys(value, value !== null && typeof value === "object" && "version" in value && value.version === 1 ? [
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
			])) return false;
			if (value.version !== 1 && value.version !== 2 && value.version !== 3 || value.unit !== "tokens" && value.unit !== "context-percent") return false;
			if (value.prefixPolicy !== "preserve" && value.prefixPolicy !== "pressure-break") return false;
			if (!isBudget(value.fresh) || !isBudget(value.aggregate)) return false;
			const modernHistory = value.version === 3;
			if (!hasExactKeys(value.history, modernHistory ? [
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
			])) return false;
			if (typeof value.history.enabled !== "boolean" || typeof value.history.trigger !== "number" || typeof value.history.minReclaim !== "number") return false;
			const recent = modernHistory ? value.history.keepRecentTokens : value.history.keepRecent;
			const calls = modernHistory ? value.history.keepRecentToolCalls : value.history.keepRecentTurns;
			if (typeof recent !== "number" || typeof calls !== "number" || !Number.isSafeInteger(calls) || calls < 0) return false;
			let tailTrimTrigger;
			if (value.version !== 1) {
				const tailTrim = value.tailTrim;
				if (!hasExactKeys(tailTrim, ["enabled", "trigger"]) || typeof tailTrim.enabled !== "boolean" || typeof tailTrim.trigger !== "number") return false;
				tailTrimTrigger = tailTrim.trigger;
			}
			const measured = [
				value.fresh.trigger,
				value.fresh.target,
				value.aggregate.trigger,
				value.aggregate.target,
				value.history.trigger,
				recent,
				value.history.minReclaim,
				...tailTrimTrigger === void 0 ? [] : [tailTrimTrigger]
			];
			if (!measured.every((entry) => typeof entry === "number" && Number.isFinite(entry))) return false;
			if (value.fresh.trigger <= 0 || value.fresh.target <= 0 || value.aggregate.trigger <= 0 || value.aggregate.target <= 0 || value.history.trigger <= 0 || recent < 0 || value.history.minReclaim <= 0 || tailTrimTrigger !== void 0 && tailTrimTrigger <= 0) return false;
			if (value.unit === "tokens" && !measured.every(Number.isSafeInteger)) return false;
			if (value.unit === "context-percent" && !measured.every((entry) => entry <= 100)) return false;
			return value.fresh.target < value.fresh.trigger && value.aggregate.target < value.aggregate.trigger && value.history.minReclaim <= value.history.trigger;
		}
		function isBudget(value) {
			return hasExactKeys(value, [
				"enabled",
				"trigger",
				"target"
			]) && typeof value.enabled === "boolean" && typeof value.trigger === "number" && typeof value.target === "number";
		}
		/**
		* Canonicalize one validated Custom document to version 3, mirroring the
		* runtime's `canonicalizeCustomPolicy` exactly so the browser and runtime
		* boundaries hand the SAME complete document to the UI and the policy
		* resolver: legacy v1/v2 History working sets upgrade to the 10-call default,
		* and a v1 document gains the default-disabled TailTrim stage.
		*/
		function canonicalizeCustomPolicy(policy) {
			if (policy.version === 3) return structuredClone(policy);
			return {
				version: 3,
				unit: policy.unit,
				fresh: structuredClone(policy.fresh),
				aggregate: structuredClone(policy.aggregate),
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
				} : structuredClone(policy.tailTrim)
			};
		}
		function hasExactKeys(value, expected) {
			if (!isPlainRecord(value)) return false;
			const keys = Object.keys(value);
			return keys.length === expected.length && keys.every((key) => expected.includes(key));
		}
		//#endregion
		//#region \0dsh-context-compression-css:466eb745356d-CompressionProfileSelector.module.css.mjs
		const css = ".rLocJG_settingsSection{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}.rLocJG_settingsTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}.rLocJG_settingsDescription{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}.rLocJG_root{width:100%}.rLocJG_profileGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;display:grid}.rLocJG_profileCard{border:1px solid var(--dsw-alias-border-l2);min-height:112px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border-radius:10px;flex-direction:column;gap:8px;padding:14px;display:flex}.rLocJG_profileCard:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.rLocJG_profileCard[aria-pressed=true]{border-color:var(--dsw-alias-label-primary)}.rLocJG_profileCard:active:not(:disabled){transform:scale(.99)}.rLocJG_profileCard:disabled{cursor:default;opacity:.6}.rLocJG_profileCard:focus-visible{outline-offset:2px;outline:2px solid}.rLocJG_profileCardTop{align-items:center;gap:8px;display:flex}.rLocJG_profileCardTitle{font-size:14px;font-weight:500;line-height:20px}.rLocJG_profileCurrent{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-radius:999px;padding:1px 6px;font-size:10px;line-height:14px}.rLocJG_profileCardDetail{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.rLocJG_button{border:1px solid var(--dsw-alias-border-l2);width:100%;min-height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border-radius:10px;align-items:center;gap:8px;padding:6px 8px;display:flex}.rLocJG_button:hover{background:var(--dsw-alias-interactive-bg-hover)}.rLocJG_button:disabled{cursor:default;opacity:.6}.rLocJG_copy{flex:1;min-width:0}.rLocJG_label{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:14px}.rLocJG_value{text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:17px;overflow:hidden}.rLocJG_chevron{color:var(--dsw-alias-label-secondary);flex:none}.rLocJG_menuCopy{flex-direction:column;gap:2px;min-width:220px;display:flex}.rLocJG_menuTitle{font-size:13px;line-height:17px}.rLocJG_menuDetail{white-space:normal;max-width:290px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px}.rLocJG_error{color:var(--dsw-alias-state-error-primary);padding:4px 8px 0;font-size:11px;line-height:15px}.rLocJG_unavailable{color:var(--dsw-alias-label-tertiary);padding:4px 8px 0;font-size:11px;line-height:15px}.rLocJG_settingsHint{color:var(--dsw-alias-label-secondary);padding:4px 8px 0;font-size:11px;line-height:15px}.rLocJG_pricing{color:var(--dsw-alias-label-tertiary);padding:4px 8px 0;font-size:11px;line-height:15px}.rLocJG_custom{border-top:1px solid var(--dsw-alias-border-l2);margin-top:16px;padding:16px 0 0}.rLocJG_customTitle{margin:0 0 6px;font-size:13px;line-height:17px}.rLocJG_customNote{color:var(--dsw-alias-label-tertiary);margin:4px 0;font-size:11px;line-height:15px}.rLocJG_stage{border:0;border-top:1px solid var(--dsw-alias-border-l2);margin:12px 0 0;padding:12px 0 0}.rLocJG_stageToggle{align-items:center;gap:6px;font-size:12px;line-height:16px;display:inline-flex}.rLocJG_fieldGrid{grid-template-columns:1fr;gap:8px;display:grid}.rLocJG_field{min-width:0;color:var(--dsw-alias-label-secondary);flex-direction:column;gap:4px;margin-top:8px;font-size:11px;line-height:15px;display:flex}.rLocJG_field input,.rLocJG_field select{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);width:100%;min-width:0;min-height:30px;color:var(--dsw-alias-label-primary);border-radius:7px;padding:4px 6px}.rLocJG_field input:focus-visible,.rLocJG_field select:focus-visible,.rLocJG_actions button:focus-visible{outline-offset:2px;outline:2px solid}.rLocJG_actions{flex-wrap:wrap;gap:8px;margin-top:10px;display:flex}.rLocJG_actions button{border:1px solid var(--dsw-alias-border-l2);min-height:30px;color:var(--dsw-alias-label-primary);background:0 0;border-radius:7px;padding:4px 8px}.rLocJG_actions button:active:not(:disabled){transform:scale(.98)}.rLocJG_actions button:disabled{opacity:.6}@media (width<=560px){.rLocJG_profileGrid{grid-template-columns:1fr}}.rLocJG_autoCompact{border:1px solid #80808059;border-radius:8px;margin-top:24px;padding:16px}.rLocJG_autoCompactTitle{margin:0 0 8px;font-size:15px;font-weight:600}.rLocJG_autoCompactRisk{opacity:.9;margin:8px 0 0;font-size:12px}.rLocJG_savingsCard{border:1px solid #ffffff1a;border-radius:8px;flex-direction:column;gap:4px;margin-top:14px;padding:10px 12px;display:flex}.rLocJG_savingsRow{justify-content:space-between;align-items:baseline;gap:12px;display:flex}.rLocJG_savingsNetPositive strong{color:#30d158}.rLocJG_savingsNetNegative strong{color:#ff9f0a}.rLocJG_savingsMuted{opacity:.66;font-size:.92em}.rLocJG_savingsBreakdown{border-top:1px solid #ffffff14;margin-top:4px;padding-top:4px}.rLocJG_savingsNote{opacity:.5;margin-top:4px;font-size:.85em}";
		const tagId = "dsh-context-compression-improved/CompressionProfileSelector.module.css";
		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-context-compression-improved";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default = {
			"actions": "rLocJG_actions",
			"autoCompact": "rLocJG_autoCompact",
			"autoCompactRisk": "rLocJG_autoCompactRisk",
			"autoCompactTitle": "rLocJG_autoCompactTitle",
			"button": "rLocJG_button",
			"chevron": "rLocJG_chevron",
			"copy": "rLocJG_copy",
			"custom": "rLocJG_custom",
			"customNote": "rLocJG_customNote",
			"customTitle": "rLocJG_customTitle",
			"error": "rLocJG_error",
			"field": "rLocJG_field",
			"fieldGrid": "rLocJG_fieldGrid",
			"label": "rLocJG_label",
			"menuCopy": "rLocJG_menuCopy",
			"menuDetail": "rLocJG_menuDetail",
			"menuTitle": "rLocJG_menuTitle",
			"pricing": "rLocJG_pricing",
			"profileCard": "rLocJG_profileCard",
			"profileCardDetail": "rLocJG_profileCardDetail",
			"profileCardTitle": "rLocJG_profileCardTitle",
			"profileCardTop": "rLocJG_profileCardTop",
			"profileCurrent": "rLocJG_profileCurrent",
			"profileGrid": "rLocJG_profileGrid",
			"root": "rLocJG_root",
			"savingsBreakdown": "rLocJG_savingsBreakdown",
			"savingsCard": "rLocJG_savingsCard",
			"savingsMuted": "rLocJG_savingsMuted",
			"savingsNetNegative": "rLocJG_savingsNetNegative",
			"savingsNetPositive": "rLocJG_savingsNetPositive",
			"savingsNote": "rLocJG_savingsNote",
			"savingsRow": "rLocJG_savingsRow",
			"settingsDescription": "rLocJG_settingsDescription",
			"settingsHint": "rLocJG_settingsHint",
			"settingsSection": "rLocJG_settingsSection",
			"settingsTitle": "rLocJG_settingsTitle",
			"stage": "rLocJG_stage",
			"stageToggle": "rLocJG_stageToggle",
			"unavailable": "rLocJG_unavailable",
			"value": "rLocJG_value"
		};
		//#endregion
		//#region src/client/CustomPolicyEditor.tsx
		function CustomPolicyEditor({ value, disabled, setValue, save, reset, settle, t }) {
			const valid = isCustomCompressionPolicy(value);
			const unitStep = value.unit === "tokens" ? 1 : .01;
			const unitMax = value.unit === "tokens" ? void 0 : 100;
			const unitBounds = unitMax === void 0 ? {} : { max: unitMax };
			const setBudget = (stage, patch) => {
				setValue({
					...value,
					[stage]: {
						...value[stage],
						...patch
					}
				});
			};
			const setHistory = (patch) => {
				setValue({
					...value,
					history: {
						...value.history,
						...patch
					}
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.custom,
				"aria-labelledby": "context-compression-custom-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						id: "context-compression-custom-title",
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.customTitle,
						children: t("custom.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.customNote,
						children: t("custom.sessionScope")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.customNote,
						children: t("custom.measurement")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("custom.unit") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: value.unit,
							disabled,
							onChange: (event) => {
								setValue({
									...value,
									unit: event.currentTarget.value
								});
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "tokens",
								children: t("custom.unit.tokens")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "context-percent",
								children: t("custom.unit.contextPercent")
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StageFields, {
						t,
						title: t("custom.fresh.enabled"),
						enabled: value.fresh.enabled,
						disabled,
						onEnabled: (enabled) => {
							setBudget("fresh", { enabled });
						},
						fields: [{
							label: t("custom.fresh.trigger"),
							value: value.fresh.trigger,
							set: (trigger) => {
								setBudget("fresh", { trigger });
							},
							...unitBounds
						}, {
							label: t("custom.fresh.target"),
							value: value.fresh.target,
							set: (target) => {
								setBudget("fresh", { target });
							},
							...unitBounds
						}],
						step: unitStep
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StageFields, {
						t,
						title: t("custom.aggregate.enabled"),
						enabled: value.aggregate.enabled,
						disabled,
						onEnabled: (enabled) => {
							setBudget("aggregate", { enabled });
						},
						fields: [{
							label: t("custom.aggregate.trigger"),
							value: value.aggregate.trigger,
							set: (trigger) => {
								setBudget("aggregate", { trigger });
							},
							...unitBounds
						}, {
							label: t("custom.aggregate.target"),
							value: value.aggregate.target,
							set: (target) => {
								setBudget("aggregate", { target });
							},
							...unitBounds
						}],
						step: unitStep
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StageFields, {
						t,
						title: t("custom.history.enabled"),
						enabled: value.history.enabled,
						disabled,
						onEnabled: (enabled) => {
							setHistory({ enabled });
						},
						fields: [
							{
								label: t("custom.history.trigger"),
								value: value.history.trigger,
								set: (trigger) => {
									setHistory({ trigger });
								},
								...unitBounds
							},
							{
								label: t("custom.history.keepRecentToolCalls"),
								value: value.history.keepRecentToolCalls,
								set: (keepRecentToolCalls) => {
									setHistory({ keepRecentToolCalls });
								},
								integer: true,
								allowZero: true
							},
							{
								label: t("custom.history.keepRecentTokens"),
								value: value.history.keepRecentTokens,
								set: (keepRecentTokens) => {
									setHistory({ keepRecentTokens });
								},
								allowZero: true,
								...unitBounds
							},
							{
								label: t("custom.history.minReclaim"),
								value: value.history.minReclaim,
								set: (minReclaim) => {
									setHistory({ minReclaim });
								},
								...unitBounds
							}
						],
						step: unitStep,
						fieldsEnabled: value.history.enabled || value.tailTrim.enabled
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("custom.prefixPolicy") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: value.prefixPolicy,
							disabled: disabled || !value.history.enabled,
							onChange: (event) => {
								setValue({
									...value,
									prefixPolicy: event.currentTarget.value
								});
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "preserve",
								children: t("custom.prefixPolicy.preserve")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "pressure-break",
								children: t("custom.prefixPolicy.pressureBreak")
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.customNote,
						children: t("custom.experimental")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StageFields, {
						t,
						title: t("custom.tailTrim.enabled"),
						enabled: value.tailTrim.enabled,
						disabled,
						onEnabled: (enabled) => {
							setValue({
								...value,
								tailTrim: {
									...value.tailTrim,
									enabled
								}
							});
						},
						fields: [{
							label: t("custom.tailTrim.trigger"),
							value: value.tailTrim.trigger,
							set: (trigger) => {
								setValue({
									...value,
									tailTrim: {
										...value.tailTrim,
										trigger
									}
								});
							},
							...unitBounds
						}],
						step: unitStep
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.customNote,
						children: t("custom.tailTrim.warning")
					}),
					valid ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.error,
						role: "alert",
						children: t("custom.invalid")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.actions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: disabled || !valid,
							onClick: () => {
								settle(save);
							},
							children: t("custom.save")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled,
							onClick: () => {
								settle(reset);
							},
							children: t("custom.reset")
						})]
					})
				]
			});
		}
		function StageFields({ title, enabled, disabled, onEnabled, fields, step, fieldsEnabled = enabled, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
				className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.stage,
				disabled,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", { children: title }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("custom.enabled") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							"aria-label": title,
							value: enabled ? "on" : "off",
							onChange: (event) => {
								onEnabled(event.currentTarget.value === "on");
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "on",
								children: t("custom.enabled.on")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "off",
								children: t("custom.enabled.off")
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.fieldGrid,
						children: fields.map((field) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: field.label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "number",
								value: field.value,
								min: field.allowZero === true ? 0 : field.integer === true ? 1 : step,
								max: field.max,
								step: field.integer === true ? 1 : step,
								disabled: !fieldsEnabled || disabled,
								onChange: (event) => {
									field.set(Number(event.currentTarget.value));
								}
							})]
						}, field.label))
					})
				]
			});
		}
		/** Convert a legacy custom policy to V3 format. */
		function editableCustom(value) {
			if (value.version === 3) return structuredClone(value);
			return {
				version: 3,
				unit: value.unit,
				fresh: structuredClone(value.fresh),
				aggregate: structuredClone(value.aggregate),
				history: {
					enabled: value.history.enabled,
					trigger: value.history.trigger,
					keepRecentToolCalls: 10,
					keepRecentTokens: value.history.keepRecent,
					minReclaim: value.history.minReclaim
				},
				prefixPolicy: value.prefixPolicy,
				tailTrim: value.version === 1 ? {
					enabled: false,
					trigger: 7e5
				} : structuredClone(value.tailTrim)
			};
		}
		//#endregion
		//#region src/client/CompressionProfileControls.tsx
		/**
		* CompressionProfileControls: dropdown selector for compression profiles,
		* plus AutoCompactThresholdControls and CodeSkeletonControls sub-components.
		*
		* Extracted from CompressionProfileSelector.tsx to reduce god-module size.
		*
		* @module dsh-context-compression-improved/client/CompressionProfileControls
		*/
		/**
		* The authoritative Auto Compact threshold editor for the context-compression
		* section. A typed number input and its save path are kept deliberately simple;
		* values outside the recommended 70–85 band warn without blocking.
		*/
		function AutoCompactThresholdControls({ value, disabled, save, settle, t }) {
			const [draft, setDraft] = (0, react.useState)(String(value));
			(0, react.useEffect)(() => {
				setDraft(String(value));
			}, [value]);
			const parsed = Number(draft);
			const valid = isValidAutoCompactThresholdPercent(parsed);
			const risk = !valid ? "autoCompact.invalid" : parsed < 70 ? "autoCompact.riskLow" : parsed > 85 ? "autoCompact.riskHigh" : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.autoCompact,
				"aria-labelledby": "context-compression-autocompact-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						id: "context-compression-autocompact-title",
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.autoCompactTitle,
						children: t("autoCompact.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.customNote,
						children: t("autoCompact.description")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("autoCompact.inputLabel") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "number",
							value: draft,
							min: AUTO_COMPACT_THRESHOLD_LIMITS.min,
							max: AUTO_COMPACT_THRESHOLD_LIMITS.max,
							step: AUTO_COMPACT_THRESHOLD_LIMITS.step,
							disabled,
							"aria-invalid": !valid,
							onChange: (event) => {
								setDraft(event.currentTarget.value);
							}
						})]
					}),
					risk === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: risk === "autoCompact.invalid" ? _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.error : _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.autoCompactRisk,
						role: risk === "autoCompact.invalid" ? "alert" : "note",
						children: t(risk)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.actions,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: disabled || !valid || parsed === value,
							onClick: () => {
								settle(() => save(parsed));
							},
							children: t("autoCompact.save")
						})
					})
				]
			});
		}
		/**
		* The turn-tail intent summary fold gate. Same deliberately minimal shape as
		* the code-skeleton gate: an on/off select with its own save path; the fold
		* itself is gated by the growth constants and the per-session /ctx-summary
		* override, none of which belong in this card.
		*/
		function IntentSummaryControls({ value, disabled, save, settle, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.autoCompact,
				"aria-labelledby": "context-compression-intentsummary-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						id: "context-compression-intentsummary-title",
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.autoCompactTitle,
						children: t("intentSummary.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.customNote,
						children: t("intentSummary.description")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("intentSummary.enabled") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: value ? "on" : "off",
							disabled,
							onChange: (event) => {
								settle(() => save(event.currentTarget.value === "on"));
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "on",
								children: t("intentSummary.enabled.on")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "off",
								children: t("intentSummary.enabled.off")
							})]
						})]
					})
				]
			});
		}
		function CodeSkeletonControls({ value, disabled, save, settle, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.autoCompact,
				"aria-labelledby": "context-compression-codeskeleton-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						id: "context-compression-codeskeleton-title",
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.autoCompactTitle,
						children: t("codeSkeleton.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.customNote,
						children: t("codeSkeleton.description")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("codeSkeleton.enabled") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: value ? "on" : "off",
							disabled,
							onChange: (event) => {
								settle(() => save(event.currentTarget.value === "on"));
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "on",
								children: t("codeSkeleton.enabled.on")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "off",
								children: t("codeSkeleton.enabled.off")
							})]
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/EstimatorControls.tsx
		/**
		* TokenPilot-inspired estimator channel card components.
		*
		* Extracted from CompressionProfileSelector.tsx to reduce god-module size.
		*
		* @module dsh-context-compression-improved/client/EstimatorControls
		*/
		/**
		* The estimator card is gated on the tokenpilot-inspired profile, because
		* `presetOptions` is merged into that profile alone. A card that merely
		* disappears reads as a missing feature — the first real-machine report was
		* exactly that — so keep the heading and its anchor id in place and spend them
		* on the reason plus the profile that unlocks the card. The gate itself is
		* unchanged: no estimator control exists outside tokenpilot-inspired.
		*
		* Exported from the estimator card's own module so the gated card and its
		* explanation cannot drift apart.
		*/
		function EstimatorInactiveNotice({ profile, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.autoCompact,
				"aria-labelledby": "context-compression-estimator-title",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
					id: "context-compression-estimator-title",
					className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.autoCompactTitle,
					children: t("estimator.title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.customNote,
					children: t("estimator.inactive").replace("{profile}", profile)
				})]
			});
		}
		const ESTIMATOR_CATALOG_ROUTE = "/api/dsh-context-compression-improved/estimator-catalog";
		/**
		* TokenPilot-inspired estimator channel card. Shown only while the
		* tokenpilot-inspired profile is selected, and split by channel:
		*
		* - `host` reuses the providers and credentials the user already configured in
		*   DSH through the Harness `llm` service, so this card names a provider and a
		*   model and accepts NO API key — the key field belongs to the direct channel
		*   alone.
		* - `direct` talks to a native OpenAI-compatible endpoint, which is the only
		*   channel that carries its own base URL and write-only key.
		*
		* The whole card is advisory: an unconfigured or failing endpoint keeps every
		* consumer on its rule-only fallback.
		*/
		function EstimatorControls({ options, disabled, save, settle, t }) {
			const [keyDraft, setKeyDraft] = (0, react.useState)("");
			const [baseUrl, setBaseUrl] = (0, react.useState)(options.estimatorBaseUrl ?? "");
			const [model, setModel] = (0, react.useState)(options.estimatorModel ?? "");
			const [provider, setProvider] = (0, react.useState)(options.estimatorProvider ?? "");
			const mode = options.estimatorMode ?? "";
			const [catalog, setCatalog] = (0, react.useState)();
			(0, react.useEffect)(() => {
				if (mode !== "host") return;
				let alive = true;
				let attempts = 0;
				const load = async () => {
					try {
						const response = await fetch(ESTIMATOR_CATALOG_ROUTE, { headers: { "cache-control": "no-cache" } });
						return response.ok ? await response.json() : void 0;
					} catch {
						return;
					}
				};
				const tick = () => {
					attempts += 1;
					load().then((body) => {
						if (!alive) return;
						if (body !== void 0 && (body.providers?.length ?? 0) > 0) {
							setCatalog(body);
							return;
						}
						if (attempts < 10) setTimeout(tick, 3e3);
					});
				};
				tick();
				return () => {
					alive = false;
				};
			}, [mode]);
			const hostProviders = catalog?.providers ?? [];
			const providerDraft = provider;
			const hostModels = hostProviders.filter((entry) => providerDraft === "" || entry.id === providerDraft).flatMap((entry) => entry.models.map((model) => ({
				...model,
				provider: entry.id
			})));
			const hostProvider = hostProviders.find((entry) => entry.id === providerDraft) ?? hostProviders.find((entry) => entry.id === (options.estimatorProvider ?? ""));
			const hasKey = (options.estimatorApiKey ?? "") !== "";
			const commit = (patch) => {
				settle(() => save(patch));
			};
			const overrideProvider = options.estimatorProvider ?? "";
			const overrideModel = options.estimatorModel ?? "";
			const effectiveProvider = overrideProvider !== "" ? overrideProvider : catalog?.selection?.provider ?? "";
			const effectiveModel = overrideModel !== "" ? overrideModel : catalog?.selection?.model ?? "";
			const effectiveRoute = effectiveProvider !== "" && effectiveModel !== "" ? `${effectiveProvider} / ${effectiveModel}` : t("estimator.hostUnresolved");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.autoCompact,
				"aria-labelledby": "context-compression-estimator-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						id: "context-compression-estimator-title",
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.autoCompactTitle,
						children: t("estimator.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.customNote,
						children: t("estimator.description")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("estimator.mode") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: mode,
							disabled,
							onChange: (event) => {
								settle(() => save({ estimatorMode: event.currentTarget.value }));
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: t("estimator.mode.off")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "host",
									children: t("estimator.mode.host")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "direct",
									children: t("estimator.mode.direct")
								})
							]
						})]
					}),
					mode === "" ? null : mode === "host" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("estimator.provider") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "text",
								list: "estimator-provider-options",
								value: provider,
								disabled,
								placeholder: t("estimator.provider.placeholder"),
								onChange: (event) => {
									const next = event.currentTarget.value;
									setProvider(next);
									if (next !== "" && hostProviders.some((entry) => entry.id === next)) commit({ estimatorProvider: next });
								},
								onBlur: () => {
									if (provider !== (options.estimatorProvider ?? "")) commit({ estimatorProvider: provider });
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("datalist", {
							id: "estimator-provider-options",
							children: hostProviders.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
								value: entry.id,
								children: [entry.name === "" ? entry.id : entry.name, entry.error === void 0 ? "" : ` (${entry.error})`]
							}, entry.id))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("estimator.model") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "text",
								list: "estimator-model-options",
								value: model,
								disabled,
								placeholder: t("estimator.model.placeholder"),
								onChange: (event) => {
									const next = event.currentTarget.value;
									setModel(next);
									if (next !== "" && hostModels.some((entry) => entry.id === next)) commit({ estimatorModel: next });
								},
								onBlur: () => {
									if (model !== (options.estimatorModel ?? "")) commit({ estimatorModel: model });
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("datalist", {
							id: "estimator-model-options",
							children: hostModels.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: entry.id,
								children: entry.name
							}, `${entry.provider}\0${entry.id}`))
						}),
						hostProvider?.error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.customNote,
							children: String(hostProvider.error)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.customNote,
							children: t("estimator.hostReuse")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.customNote,
							children: t("estimator.hostRoute").replace("{route}", effectiveRoute)
						})
					] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("estimator.baseUrl") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "text",
								value: baseUrl,
								disabled,
								placeholder: "https://127.0.0.1:8000/v1",
								onChange: (event) => {
									setBaseUrl(event.currentTarget.value);
								},
								onBlur: () => {
									if (baseUrl !== (options.estimatorBaseUrl ?? "")) commit({ estimatorBaseUrl: baseUrl });
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("estimator.model") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "text",
								value: model,
								disabled,
								onChange: (event) => {
									setModel(event.currentTarget.value);
								},
								onBlur: () => {
									if (model !== (options.estimatorModel ?? "")) commit({ estimatorModel: model });
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.field,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("estimator.apiKey") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										gap: "6px"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "password",
										autoComplete: "off",
										spellCheck: false,
										value: keyDraft,
										disabled,
										placeholder: hasKey ? t("estimator.apiKey.set") : t("estimator.apiKey.placeholder"),
										onChange: (event) => {
											setKeyDraft(event.currentTarget.value);
										},
										onBlur: () => {
											const next = keyDraft.trim();
											if (next === "") return;
											settle(() => save({ estimatorApiKey: next }));
											setKeyDraft("");
										},
										onKeyDown: (event) => {
											if (event.key === "Enter") event.currentTarget.blur();
										}
									}), hasKey ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										disabled,
										onClick: () => {
											settle(() => save({ estimatorApiKey: void 0 }));
										},
										children: t("estimator.apiKey.clear")
									}) : null]
								}),
								hasKey ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.customNote,
									children: t("estimator.apiKey.overwrite")
								}) : null
							]
						})
					] })
				]
			});
		}
		//#endregion
		//#region src/client/savings-card.tsx
		/**
		* 节省统计卡片(设置分节内,只读):净/毛/抵消 + 分项条。
		* 数据源 = `/api/.../savings` 只读快照路由(忙 2s / 闲 5s 自调度轮询,
		* 失败静默——统计卡片永不打扰设置页主功能)。
		*
		* @module dsh-context-compression-improved/client/savings-card
		*/
		const SAVINGS_ROUTE = "/api/dsh-context-compression-improved/savings";
		function fmt(n) {
			return n.toLocaleString("en-US");
		}
		/** 节省统计卡片:口径分列(精确 tokenizer vs chars/4 估算),永不混算。 */
		function SavingsCard({ t }) {
			const [snap, setSnap] = (0, react.useState)(null);
			const stopped = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				stopped.current = false;
				const tick = async () => {
					try {
						const response = await fetch(SAVINGS_ROUTE, { headers: { "cache-control": "no-cache" } });
						if (response.ok) {
							const data = await response.json();
							if (data?.startedAt !== void 0 && !stopped.current) setSnap(data);
						}
					} catch {}
					if (!stopped.current) setTimeout(tick, 5e3);
				};
				tick();
				return () => {
					stopped.current = true;
				};
			}, []);
			if (snap === null || snap.gross.exact + snap.gross.estimated === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.pricing,
				children: t("savings.empty")
			});
			const hasExact = snap.gross.exact > 0 || snap.offsets.exact > 0;
			const hasEstimated = snap.gross.estimated > 0 || snap.offsets.estimated > 0;
			const netTone = snap.net.exact + snap.net.estimated >= 0 ? _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsNetPositive : _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsNetNegative;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${_dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsCard}`,
				"data-testid": "savings-card",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsRow,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("savings.title") })
					}),
					hasExact ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: `${_dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsRow} ${netTone}`,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("savings.netExact") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: fmt(snap.net.exact) })]
					}) : null,
					hasEstimated ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("savings.netEstimated") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: fmt(snap.net.estimated) })]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsMuted,
							children: t("savings.gross")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsMuted,
							children: [
								hasExact ? `✓ ${fmt(snap.gross.exact)}` : "",
								hasExact && hasEstimated ? " · " : "",
								hasEstimated ? `≈ ${fmt(snap.gross.estimated)}` : ""
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsMuted,
							children: t("savings.offsets")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsMuted,
							children: [
								hasExact ? `−${fmt(snap.offsets.exact)}` : "",
								hasExact && hasEstimated ? " · " : "",
								hasEstimated ? `−${fmt(snap.offsets.estimated)}` : ""
							]
						})]
					}),
					snap.perComponent.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsBreakdown,
						children: snap.perComponent.slice(0, 6).map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsMuted,
								children: [
									row.kind === "offset" ? "−" : "+",
									" ",
									row.component,
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
										" (",
										row.basis === "exact-tokenizer" ? t("savings.basisExact") : t("savings.basisEstimated"),
										")"
									] })
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsMuted,
								children: fmt(row.tokens)
							})]
						}, `${row.kind}:${row.component}:${row.basis}`))
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.savingsNote,
						children: t("savings.basisNote")
					})
				]
			});
		}
		//#endregion
		//#region src/client/settings-section.tsx
		/**
		* Full-page Settings surface backed by the same durable selector state.
		*
		* Extracted from CompressionProfileSelector.tsx to reduce god-module size.
		*
		* @module dsh-context-compression-improved/client/settings-section
		*/
		/** Full-page Settings surface backed by the same durable selector state. */
		function ContextCompressionSettingsSection(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsCompressionProfileControls, { ...props });
		}
		function SettingsCompressionProfileControls({ useCompression, select, saveCustom, resetCustom, saveAutoCompact, saveCodeSkeleton, saveIntentSummary, savePresetOptions, t }) {
			const state = useCompression((snapshot) => snapshot);
			const [saving, setSaving] = (0, react.useState)(false);
			const [saveError, setSaveError] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(null);
			const current = state.value?.profile ?? "balanced";
			(0, react.useEffect)(() => {
				const custom = state.value?.custom;
				setDraft(current === "custom" && custom !== void 0 ? editableCustom(custom) : null);
			}, [current, state.value?.custom]);
			if (state.status === "unavailable") return null;
			const busy = state.status === "loading" || saving;
			const selectProfile = (profile) => {
				if (!state.writable || profile === current) return;
				setSaveError(null);
				setSaving(true);
				select(profile).then(() => {
					setSaving(false);
				}, (error) => {
					setSaving(false);
					setSaveError(error instanceof Error && error.message !== "" ? error.message : t("status.saveFailed"));
				});
			};
			const settle = (operation) => {
				setSaveError(null);
				setSaving(true);
				operation().then(() => {
					setSaving(false);
				}, (error) => {
					setSaving(false);
					setSaveError(error instanceof Error && error.message !== "" ? error.message : t("status.saveFailed"));
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.settingsSection,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.settingsTitle,
						children: t("settings.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.settingsDescription,
						children: t("settings.description")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.profileGrid,
						"aria-label": t("label"),
						children: COMPRESSION_PROFILES.map((profile) => {
							const selected = profile === current;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.profileCard,
								"aria-pressed": selected,
								disabled: busy || !state.writable,
								onClick: () => {
									selectProfile(profile);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.profileCardTop,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.profileCardTitle,
										children: t(`profile.${profile}`)
									}), selected ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.profileCurrent,
										children: t("profile.current")
									}) : null]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.profileCardDetail,
									children: t(`detail.${profile}`)
								})]
							}, profile);
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AutoCompactThresholdControls, {
						value: state.value?.autoCompact?.thresholdPercent ?? AUTO_COMPACT_THRESHOLD_LIMITS.default,
						disabled: busy || !state.writable || false,
						save: saveAutoCompact,
						settle,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CodeSkeletonControls, {
						value: state.value?.codeSkeleton?.enabled ?? false,
						disabled: busy || !state.writable || false,
						save: saveCodeSkeleton,
						settle,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IntentSummaryControls, {
						value: state.value?.intentSummary?.enabled ?? false,
						disabled: busy || !state.writable || false,
						save: saveIntentSummary,
						settle,
						t
					}),
					current !== "tokenpilot-inspired" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EstimatorInactiveNotice, {
						profile: t(`profile.${current}`),
						t
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EstimatorControls, {
						options: state.value?.presetOptions ?? {},
						disabled: busy || !state.writable || false,
						save: savePresetOptions,
						settle,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SavingsCard, { t }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.pricing,
						children: t("pricing.disclosure")
					}),
					current !== "custom" || draft === null || false ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CustomPolicyEditor, {
						value: draft,
						disabled: busy || !state.writable,
						setValue: setDraft,
						save: () => saveCustom(structuredClone(draft)),
						reset: resetCustom,
						settle,
						t
					}),
					saveError === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: _dsh_context_compression_css_466eb745356d_CompressionProfileSelector_module_css_default.error,
						role: "alert",
						children: saveError
					})
				]
			});
		}
		//#endregion
		//#region src/client/decode.ts
		/** Browser-safe settings decoding shared by the client entry and node tests. */
		/**
		* Decode one stored context-compression settings document with exactly the
		* runtime schema's strictness: a plain object with only `profile`, `custom`,
		* `autoCompact`, `codeSkeleton`, and `intentSummary` keys, a supported profile, a valid Custom
		* document canonicalized to v3 exactly as the runtime resolver would, a
		* strictly-shaped autoCompact section (absent inherits the 80% default), and
		* a strictly-shaped codeSkeleton gate (absent inherits off). Anything else
		* decodes to `undefined` so the UI reports the document as unreadable instead
		* of silently disagreeing with the runtime.
		*/
		function decodeSettings(value) {
			if (!isPlainRecord(value)) return void 0;
			if (Object.keys(value).some((key) => key !== "profile" && key !== "custom" && key !== "autoCompact" && key !== "codeSkeleton" && key !== "intentSummary" && key !== "presetOptions")) return;
			const profile = value.profile;
			const custom = value.custom;
			const autoCompact = decodeAutoCompactSettings(value.autoCompact);
			const codeSkeleton = decodeCodeSkeletonSettings(value.codeSkeleton);
			const intentSummary = decodeIntentSummarySettings(value.intentSummary);
			const presetOptions = decodePresetOptionsSettings(value.presetOptions);
			return typeof profile === "string" && COMPRESSION_PROFILES.includes(profile) && isCustomCompressionPolicy(custom) && autoCompact !== void 0 && codeSkeleton !== void 0 && intentSummary !== void 0 ? {
				profile,
				custom: canonicalizeCustomPolicy(custom),
				autoCompact,
				codeSkeleton,
				intentSummary,
				...presetOptions === void 0 ? {} : { presetOptions }
			} : void 0;
		}
		//#endregion
		//#region src/client/locales.ts
		/** Simplified Chinese copy for the context-compression selector. */
		const zh = {
			"nav": "上下文压缩选择器",
			"settings.title": "上下文压缩选择器",
			"settings.description": "为当前会话选择压缩 Profile，并配置该 Profile 提供的参数。",
			"label": "上下文压缩",
			"status.loading": "加载中",
			"status.unavailable": "不可用",
			"status.presetUnavailable": "此会话的 preset 未提供上下文压缩，或能力尚未确认。",
			"status.minimalUnavailable": "极简模式不会为此会话加载上下文压缩能力，因此选择器在本会话中等效为关闭，仅保留 Harness 原生行为。切换到标准、PTC／Coding、创造模式，或支持该能力的自定义 preset 后即可配置。",
			"status.saveFailed": "保存失败，请重试",
			"pricing.disclosure": "DeepSeek 官方价格目录复核于 2026-08-25。Asia/Shanghai 周一至周五 09:00–12:00、14:00–18:00 为峰时，其余为谷时；跨边界请求按成本区间处理。",
			"profile.balanced": "平衡模式",
			"profile.cache-strict": "Cache Strict（前缀保护）",
			"profile.savings": "节省模式",
			"profile.adaptive": "Adaptive（保守成本）",
			"profile.tokenpilot-inspired": "TokenPilot 启发模式",
			"estimator.title": "估计器（可选）",
			"estimator.description": "辅助小模型零样本判断旧文件读取是否仍有引用价值，仅建议性加速历史清理；未配置或失败时自动退回纯规则通道，不影响主流程。",
			"estimator.mode": "通道",
			"estimator.mode.off": "关闭（纯规则）",
			"estimator.mode.host": "宿主模型（复用已配置供应商）",
			"estimator.mode.direct": "直连 OpenAI 兼容端点",
			"estimator.inactive": "估计器只随「TokenPilot 启发模式」提供：该模式的预设选项（去重指针、摘要定位块、读取状态语义与估计器通道）不会合并进其他 Profile，因此当前 Profile「{profile}」下没有可配置的估计器通道。选择「TokenPilot 启发模式」后，本区块会出现「通道」选择，可复用已配置供应商（宿主模型）或直连 OpenAI 兼容端点。",
			"estimator.provider": "供应商",
			"estimator.provider.placeholder": "留空则跟随会话默认模型，可从下拉选择或自定义输入",
			"estimator.model.placeholder": "留空则跟随会话默认模型，可从下拉选择或自定义输入",
			"estimator.hostReuse": "宿主通道直接复用你在 DSH 中已配置的供应商与凭据，无需填写 API Key；此通道也不接收 API Key。",
			"estimator.hostRoute": "当前生效路由：{route}。",
			"estimator.hostUnresolved": "尚未确定（请在 DSH 设置中选择默认模型，或在此指定供应商与模型）",
			"estimator.baseUrl": "端点地址（/v1）",
			"estimator.model": "模型",
			"estimator.apiKey": "API Key（仅写入，不回显）",
			"estimator.apiKey.placeholder": "输入端点密钥并失焦保存",
			"estimator.apiKey.set": "已设置 · 输入新值覆盖",
			"estimator.apiKey.clear": "清除",
			"estimator.apiKey.overwrite": "已设置保密值，输入新值并失焦即可覆盖。",
			"detail.tokenpilot-inspired": "在平衡模式之上叠加去重指针、恢复豁免、摘要定位块、前缀稳定与读取状态语义；估计器需另行配置端点",
			"profile.custom": "Custom／实验模式",
			"profile.native": "原生对照",
			"profile.off": "插件关闭",
			"profile.current": "当前选择",
			"detail.balanced": "确定性压缩新工具结果；高水位时老化旧结果",
			"detail.cache-strict": "仅在确认容量压力时老化已发送历史；服务端缓存命中仍是 best-effort",
			"detail.savings": "使用更小目标并更早清理旧工具结果；不保证每个请求更便宜",
			"detail.adaptive": "Fresh／Aggregate 与平衡模式一致；仅当紧邻官方 usage 与当前官方价格证明历史压缩明确更省钱时老化历史，否则保留",
			"detail.custom": "为新会话选择已实现的压缩阶段和计量阈值",
			"detail.native": "只使用 DeepSeek Harness 原生头尾裁剪",
			"detail.off": "关闭确定性选择器；原生 auto-compact 仍由 Harness 配置决定",
			"autoCompact.title": "Auto Compact 触发水位",
			"autoCompact.description": "模型驱动 Auto Compact 在请求占用达到该水位时触发。调整后，标准 Profile 的 History 触发值、最小回收量与近期尾窗随水位联动；修改只影响新会话。",
			"autoCompact.inputLabel": "Auto Compact 阈值（%）",
			"autoCompact.sliderLabel": "Auto Compact 阈值滑杆",
			"autoCompact.quick": "快捷值",
			"autoCompact.riskLow": "低于推荐范围：更早触发会增加摘要调用与前缀重建。",
			"autoCompact.riskHigh": "高于推荐范围：上下文容量为请求与输出共享，过晚触发会减少单次大输出、推理与工具 schema 的余量。",
			"autoCompact.invalid": "Auto Compact 阈值必须是 50–90 之间的整数。",
			"autoCompact.save": "保存 Auto Compact 阈值",
			"autoCompact.summaryHint": "Auto Compact 阈值：{percent}%。可在设置中修改。",
			"codeSkeleton.title": "代码骨架压缩（备选）",
			"codeSkeleton.description": "正交开关：独立于上方 Profile。开启后，首次曝光的超大源码类工具结果会先尝试保留导入与声明的骨架（省略函数体并保留错误行），失败时自动回退到原头部裁剪；需要精确 tokenizer，修改只影响新会话。",
			"codeSkeleton.enabled": "代码骨架压缩",
			"codeSkeleton.enabled.on": "开",
			"codeSkeleton.enabled.off": "关（默认）",
			"intentSummary.title": "回合末意图摘要（转向尾部压缩）",
			"intentSummary.description": "开启后，回合收尾阶段把本次消费的增量按语义角色折叠为意图摘要块：读类工具结果压成单行目标/规模记录，写类保留骨架头与逐字错误行，于下一次压力回合经既有折叠管线落地；仅当增长门控通过（活跃表面 >45% 且距上次折叠增长 >50K token）才触发。修改只影响新会话；当前会话可用 /ctx-summary off|on|status 临时覆盖。",
			"intentSummary.enabled": "回合末意图摘要",
			"intentSummary.enabled.on": "开",
			"intentSummary.enabled.off": "关（默认）",
			"custom.title": "Custom 策略",
			"custom.settingsHint": "具体参数请前往“设置 > 上下文压缩选择器”中编辑。",
			"custom.sessionScope": "保存后的修改会在当前压缩运行时随后首次观察某个 Session 时生效；已被该运行时观察的 Session 继续使用其冻结策略。",
			"custom.measurement": "首选 DeepSeek 精确 tokenizer；不可用时回退到带校准的 tokenizer estimate，绝不使用 chars/4。缓存归因仍未知。",
			"custom.unit": "规范单位",
			"custom.unit.tokens": "Tokens",
			"custom.unit.contextPercent": "上下文百分比",
			"custom.enabled": "是否启用",
			"custom.enabled.on": "开",
			"custom.enabled.off": "关",
			"custom.fresh.enabled": "启用 Fresh",
			"custom.fresh.trigger": "Fresh 触发值",
			"custom.fresh.target": "Fresh 目标值",
			"custom.aggregate.enabled": "启用 Aggregate",
			"custom.aggregate.trigger": "Aggregate 触发值",
			"custom.aggregate.target": "Aggregate 目标值",
			"custom.history.enabled": "启用 History",
			"custom.history.trigger": "History 触发值",
			"custom.history.keepRecentToolCalls": "保护近期工具调用数",
			"custom.history.keepRecentTokens": "保护近期工具结果尾窗",
			"custom.history.minReclaim": "最小回收量",
			"custom.prefixPolicy": "已发送前缀策略",
			"custom.prefixPolicy.preserve": "仅在容量压力时改写",
			"custom.prefixPolicy.pressureBreak": "允许常规历史老化",
			"custom.experimental": "Experimental：以下功能仅用于 Custom，不会加入标准 Profile。",
			"custom.tailTrim.enabled": "启用 TailTrim（实验）",
			"custom.tailTrim.trigger": "TailTrim 触发值",
			"custom.tailTrim.warning": "TailTrim 只在精确 tokenizer 可用时，把一个完整、已结束且非错误的纯工具组替换为可恢复引用；它与 History 共用近期工具调用数、工具结果尾窗和最小回收参数。它会改写已发送前缀，可能降低缓存命中。",
			"custom.save": "保存 Custom 策略",
			"custom.reset": "重置 Custom 策略",
			"custom.invalid": "Custom 策略参数无效。",
			"savings.title": "节省统计(本进程)",
			"savings.netExact": "净节省(精确口径)",
			"savings.netEstimated": "净节省(估算口径)",
			"savings.gross": "毛节省(压缩落盘时)",
			"savings.offsets": "负节省(压缩后再读全文的抵消)",
			"savings.empty": "尚无压缩记录——发生首次裁剪后这里会显示净节省。",
			"savings.basisExact": "精确",
			"savings.basisEstimated": "估算",
			"savings.basisNote": "口径分列不混算:精确 = DeepSeek tokenizer;估算 = chars/4。先取骨架后取全文会计负节省(净额可能为负)。"
		};
		/** English copy matching every simplified Chinese selector key. */
		const en = {
			"nav": "Context compression selector",
			"settings.title": "Context compression selector",
			"settings.description": "Choose a compression profile for the current session and configure the parameters it provides.",
			"label": "Context compression",
			"status.loading": "Loading",
			"status.unavailable": "Unavailable",
			"status.presetUnavailable": "This session’s preset does not provide context compression, or availability is not yet confirmed.",
			"status.minimalUnavailable": "Minimal mode does not load context compression for this session. The selector is effectively off and Harness native behavior remains. Switch to Standard, PTC / Coding, Creative, or a capable custom preset to configure it.",
			"status.saveFailed": "Save failed. Try again.",
			"pricing.disclosure": "DeepSeek official prices checked 2026-08-25. Peak Mon–Fri 09:00–12:00 and 14:00–18:00 Asia/Shanghai; otherwise off-peak. Cross-boundary requests use a cost range.",
			"profile.balanced": "Balanced",
			"profile.cache-strict": "Cache Strict (prefix protection)",
			"profile.savings": "Savings",
			"profile.adaptive": "Adaptive (conservative cost)",
			"profile.tokenpilot-inspired": "TokenPilot-inspired",
			"estimator.title": "Estimator (optional)",
			"estimator.description": "A small auxiliary model zero-shots whether old file reads are still likely referenced, advisory-only for history aging; unconfigured or failing endpoints fall back to rule-only behavior.",
			"estimator.mode": "Channel",
			"estimator.mode.off": "Off (rule-only)",
			"estimator.mode.host": "Host model (reuse configured providers)",
			"estimator.mode.direct": "Direct OpenAI-compatible endpoint",
			"estimator.inactive": "The estimator ships only with the TokenPilot-inspired profile: that profile’s preset options (dedupe pointers, summary locators, read-state semantics, and the estimator channel) are never merged into another profile, so the current profile “{profile}” has no estimator channel to configure. Select TokenPilot-inspired and this section gains a Channel choice — reuse configured providers (host model) or a direct OpenAI-compatible endpoint.",
			"estimator.provider": "Provider",
			"estimator.provider.placeholder": "Empty follows the session default model; pick from the dropdown or type a custom id",
			"estimator.model.placeholder": "Empty follows the session default model; pick from the dropdown or type a custom id",
			"estimator.hostReuse": "The host channel reuses the providers and credentials you already configured in DSH, so no API key is needed — and none is accepted here.",
			"estimator.hostRoute": "Effective route: {route}.",
			"estimator.hostUnresolved": "not determined yet (choose a default model in DSH settings, or name a provider and model here)",
			"estimator.baseUrl": "Endpoint base URL (/v1)",
			"estimator.model": "Model",
			"estimator.apiKey": "API key (write-only, never echoed)",
			"estimator.apiKey.placeholder": "Type the endpoint key; blur to save",
			"estimator.apiKey.set": "Set · type a new value to overwrite",
			"estimator.apiKey.clear": "Clear",
			"estimator.apiKey.overwrite": "A secret is stored; type a new value and blur to overwrite it.",
			"detail.tokenpilot-inspired": "Layered on Balanced: dedupe pointers, recovery exemption, summary locators, prefix stabilization, and read-state semantics; the estimator needs an endpoint configured separately",
			"profile.custom": "Custom / Experimental",
			"profile.native": "Native baseline",
			"profile.off": "Plugin off",
			"profile.current": "Current profile",
			"detail.balanced": "Reduce fresh tool results deterministically; age old results at high watermarks",
			"detail.cache-strict": "Age sent history only under confirmed capacity pressure; provider cache hits remain best-effort",
			"detail.savings": "Use smaller targets and age old tool results earlier; does not guarantee a cheaper request",
			"detail.adaptive": "Use Balanced Fresh/Aggregate; age history only when adjacent official usage and current official prices prove a clear saving",
			"detail.custom": "Choose implemented stages and measured thresholds for new sessions",
			"detail.native": "Use only the Harness native head/tail pruner",
			"detail.off": "Disable the deterministic selector; native auto-compact remains separately configured",
			"autoCompact.title": "Auto Compact trigger level",
			"autoCompact.description": "Model-driven Auto Compact triggers once request usage crosses this level. Standard-profile History triggers, minimum reclaim, and the recent tail follow the level; changes affect new sessions only.",
			"autoCompact.inputLabel": "Auto Compact threshold (%)",
			"autoCompact.sliderLabel": "Auto Compact threshold slider",
			"autoCompact.quick": "Quick values",
			"autoCompact.riskLow": "Below the recommended band: triggering earlier increases summarization calls and prefix rebuilds.",
			"autoCompact.riskHigh": "Above the recommended band: context capacity is shared by requests and output, so triggering later reduces headroom for single large outputs, reasoning, and tool schemas.",
			"autoCompact.invalid": "The Auto Compact threshold must be an integer between 50 and 90.",
			"autoCompact.save": "Save Auto Compact threshold",
			"autoCompact.summaryHint": "Auto Compact threshold: {percent}%. Change it in Settings.",
			"codeSkeleton.title": "Code skeleton compression (opt-in)",
			"codeSkeleton.description": "Orthogonal switch, independent of the profiles above. When enabled, an oversized fresh source-code tool result first tries a skeleton that keeps imports and declarations (bodies elided, error lines kept) and falls back to the original head pruning on failure. Requires the exact tokenizer; changes affect new sessions only.",
			"codeSkeleton.enabled": "Code skeleton compression",
			"codeSkeleton.enabled.on": "On",
			"codeSkeleton.enabled.off": "Off (default)",
			"intentSummary.title": "Turn-tail intent summary",
			"intentSummary.description": "When on, the turn-boundary postflight folds the consumed increment into intent-summary blocks by semantic role: read-class tool results become one-line target/scale records and write-class keep skeleton heads plus verbatim error lines, landing on the next pressure round through the ordinary fold pipeline. Only fires when the growth gate passes (live surface >45% and >50K tokens grown since the last fold). Applies to new sessions; override the current one with /ctx-summary off|on|status.",
			"intentSummary.enabled": "Turn-tail intent summary",
			"intentSummary.enabled.on": "On",
			"intentSummary.enabled.off": "Off (default)",
			"custom.title": "Custom policy",
			"custom.settingsHint": "Edit detailed parameters in Settings > Context compression selector.",
			"custom.sessionScope": "Saved changes apply when the current compression runtime next observes a Session for the first time. A Session already observed by that runtime keeps its frozen policy.",
			"custom.measurement": "Exact DeepSeek tokenizer first; tokenizer estimate with calibration fallback. Never chars/4. Cache attribution remains unknown.",
			"custom.unit": "Canonical unit",
			"custom.unit.tokens": "Tokens",
			"custom.unit.contextPercent": "Context percent",
			"custom.enabled": "Enabled",
			"custom.enabled.on": "On",
			"custom.enabled.off": "Off",
			"custom.fresh.enabled": "Enable Fresh",
			"custom.fresh.trigger": "Fresh trigger",
			"custom.fresh.target": "Fresh target",
			"custom.aggregate.enabled": "Enable Aggregate",
			"custom.aggregate.trigger": "Aggregate trigger",
			"custom.aggregate.target": "Aggregate target",
			"custom.history.enabled": "Enable History",
			"custom.history.trigger": "History trigger",
			"custom.history.keepRecentToolCalls": "Protected recent tool calls",
			"custom.history.keepRecentTokens": "Protected recent tool-result tail",
			"custom.history.minReclaim": "Minimum reclaim",
			"custom.prefixPolicy": "Sent-prefix policy",
			"custom.prefixPolicy.preserve": "Preserve until capacity pressure",
			"custom.prefixPolicy.pressureBreak": "Allow routine history aging",
			"custom.experimental": "Experimental: these controls are Custom-only and never added to standard profiles.",
			"custom.tailTrim.enabled": "Enable TailTrim (experimental)",
			"custom.tailTrim.trigger": "TailTrim trigger",
			"custom.tailTrim.warning": "TailTrim requires the exact tokenizer and replaces at most one complete, finished, non-error tool-only group with a recoverable reference. It shares Protected recent tool calls, Protected recent tool-result tail, and Minimum reclaim with History. It rewrites a sent prefix and may reduce cache hits.",
			"custom.save": "Save Custom policy",
			"custom.reset": "Reset Custom policy",
			"custom.invalid": "Custom policy values are invalid.",
			"savings.title": "Savings (this process)",
			"savings.netExact": "Net saved (exact basis)",
			"savings.netEstimated": "Net saved (estimated basis)",
			"savings.gross": "Gross saved (at publish time)",
			"savings.offsets": "Offsets (compressed content re-read in full)",
			"savings.empty": "No compression yet — net savings appear after the first reduction lands.",
			"savings.basisExact": "exact",
			"savings.basisEstimated": "estimated",
			"savings.basisNote": "Bases are reported separately, never merged: exact = DeepSeek tokenizer; estimated = chars/4. A skeleton followed by a full read counts as negative savings (net can go below zero)."
		};
		//#endregion
		//#region src/client/locales/de.ts
		/** German copy matching every simplified Chinese selector key. */
		const de = {
			"nav": "Kontextkomprimierung wählen",
			"settings.title": "Kontextkomprimierung wählen",
			"settings.description": "Wählen Sie ein Komprimierungsprofil für die aktuelle Sitzung und konfigurieren Sie dessen Parameter.",
			"label": "Kontextkomprimierung",
			"status.loading": "Wird geladen",
			"status.unavailable": "Nicht verfügbar",
			"status.presetUnavailable": "Das Preset dieser Sitzung bietet keine Kontextkomprimierung, oder die Verfügbarkeit ist noch nicht bestätigt.",
			"status.minimalUnavailable": "Der Minimalmodus lädt für diese Sitzung keine Kontextkomprimierung. Die Auswahl ist aus und das native Harness-Verhalten gilt. Wechseln Sie zu Standard, PTC / Coding, Kreativ oder zu einem kompatiblen eigenen Preset, um sie zu konfigurieren.",
			"status.saveFailed": "Speichern fehlgeschlagen. Bitte erneut versuchen.",
			"pricing.disclosure": "Offizielle DeepSeek-Preise, geprüft am 2026-08-25. Spitzenzeiten Mo–Fr 09:00–12:00 und 14:00–18:00 (Asia/Shanghai), sonst Nebenzeiten. Anfragen über eine Grenze hinweg verwenden eine Kostenspanne.",
			"profile.balanced": "Ausbalanciert",
			"profile.cache-strict": "Cache Strict (Präfixschutz)",
			"profile.savings": "Sparen",
			"profile.adaptive": "Adaptiv (kostenbewusst)",
			"profile.tokenpilot-inspired": "TokenPilot-inspiriert",
			"estimator.title": "Schätzer (optional)",
			"estimator.description": "Ein kleines Hilfsmodell schätzt ohne Beispiele, ob alte Datei-Lesevorgänge wahrscheinlich noch referenziert werden; nur beratend für das Altern des Verlaufs. Ohne Konfiguration oder bei Fehlern greift reines Regelverhalten.",
			"estimator.mode": "Kanal",
			"estimator.mode.off": "Aus (nur Regeln)",
			"estimator.mode.host": "Host-Modell (nutzt konfigurierte Anbieter)",
			"estimator.mode.direct": "Direkter OpenAI-kompatibler Endpunkt",
			"estimator.inactive": "Der Schätzer gehört nur zum Profil „TokenPilot-inspiriert“: dessen Preset-Optionen (Deduplizierungszeiger, Zusammenfassungsanker, Lesestatus-Semantik und der Schätzer-Kanal) werden nie in ein anderes Profil übernommen, daher hat das aktuelle Profil „{profile}“ keinen Schätzer-Kanal. Wählen Sie „TokenPilot-inspiriert“, dann erhält dieser Bereich eine Kanalwahl — konfigurierte Anbieter nutzen (Host-Modell) oder ein direkter OpenAI-kompatibler Endpunkt.",
			"estimator.provider": "Anbieter",
			"estimator.provider.placeholder": "Leer folgt dem Standardmodell der Sitzung; aus der Liste wählen oder eigene ID eingeben",
			"estimator.model.placeholder": "Leer folgt dem Standardmodell der Sitzung; aus der Liste wählen oder eigene ID eingeben",
			"estimator.hostReuse": "Der Host-Kanal nutzt die in DSH bereits konfigurierten Anbieter und Zugangsdaten — kein API-Schlüssel nötig, und hier wird keiner akzeptiert.",
			"estimator.hostRoute": "Aktuelle Route: {route}.",
			"estimator.hostUnresolved": "noch unbestimmt (wählen Sie ein Standardmodell in den DSH-Einstellungen oder geben Sie hier Anbieter und Modell an)",
			"estimator.baseUrl": "Basis-URL des Endpunkts (/v1)",
			"estimator.model": "Modell",
			"estimator.apiKey": "API-Schlüssel (nur schreiben, nie angezeigt)",
			"estimator.apiKey.placeholder": "Endpunkt-Schlüssel eingeben; Speichern beim Verlassen des Felds",
			"estimator.apiKey.set": "Gesetzt · neuen Wert eingeben, um ihn zu überschreiben",
			"estimator.apiKey.clear": "Löschen",
			"estimator.apiKey.overwrite": "Ein Geheimnis ist gespeichert; neuen Wert eingeben und das Feld verlassen, um ihn zu überschreiben.",
			"detail.tokenpilot-inspired": "Auf Ausbalanciert aufsetzend: Deduplizierungszeiger, Wiederherstellungs-Freistellung, Zusammenfassungsanker, Präfixstabilisierung und Lesestatus-Semantik; der Schätzer braucht einen separat konfigurierten Endpunkt",
			"profile.custom": "Eigene / Experimentell",
			"profile.native": "Native Referenz",
			"profile.off": "Plugin aus",
			"profile.current": "Aktuelles Profil",
			"detail.balanced": "Reduziert frische Tool-Ergebnisse deterministisch; altert alte Ergebnisse bei hohem Füllstand",
			"detail.cache-strict": "Altert den gesendeten Verlauf nur bei bestätigter Kapazitätslast; Anbieter-Cache-Treffer bleiben Best-Effort",
			"detail.savings": "Nutzt kleinere Ziele und altert alte Tool-Ergebnisse früher; günstigere Anfragen sind nicht garantiert",
			"detail.adaptive": "Nutzt Fresh/Aggregate von Ausbalanciert; altert den Verlauf nur, wenn benachbarte offizielle Nutzung und aktuelle offizielle Preise eine klare Ersparnis belegen",
			"detail.custom": "Wählen Sie umgesetzte Stufen und gemessene Schwellenwerte für neue Sitzungen",
			"detail.native": "Nutzt nur die native Kopf-/Schwanz-Kürzung von Harness",
			"detail.off": "Deaktiviert die deterministische Auswahl; natives Auto-Compact bleibt separat konfiguriert",
			"autoCompact.title": "Auto-Compact-Auslöseschwelle",
			"autoCompact.description": "Das modellgetriebene Auto Compact löst aus, sobald die Anfrage-Auslastung diese Schwelle überschreitet. History-Auslöser des Standardprofils, Mindest-Freigabe und das neue Ende folgen der Schwelle; Änderungen wirken nur auf neue Sitzungen.",
			"autoCompact.inputLabel": "Auto-Compact-Schwelle (%)",
			"autoCompact.sliderLabel": "Schieberegler für die Auto-Compact-Schwelle",
			"autoCompact.quick": "Schnellwerte",
			"autoCompact.riskLow": "Unter dem empfohlenen Bereich: früheres Auslösen erhöht Zusammenfassungsaufrufe und Präfix-Neuaufbauten.",
			"autoCompact.riskHigh": "Über dem empfohlenen Bereich: die Kontextkapazität teilen sich Anfragen und Ausgabe, späteres Auslösen verkleinert den Spielraum für einzelne große Ausgaben, Reasoning und Tool-Schemata.",
			"autoCompact.invalid": "Die Auto-Compact-Schwelle muss eine ganze Zahl zwischen 50 und 90 sein.",
			"autoCompact.save": "Auto-Compact-Schwelle speichern",
			"autoCompact.summaryHint": "Auto-Compact-Schwelle: {percent} %. In den Einstellungen änderbar.",
			"codeSkeleton.title": "Code-Skelettkomprimierung (opt-in)",
			"codeSkeleton.description": "Unabhängiger Schalter, losgelöst von den Profilen oben. Aktiviert versucht ein überdimensioniertes frisches Quellcode-Tool-Ergebnis zuerst ein Skelett, das Imports und Deklarationen hält (Rümpfe ausgelassen, Fehlerzeilen behalten), und fällt bei Scheitern auf die ursprüngliche Kopf-Kürzung zurück. Erfordert den exakten Tokenizer; wirkt nur auf neue Sitzungen.",
			"codeSkeleton.enabled": "Code-Skelettkomprimierung",
			"codeSkeleton.enabled.on": "Ein",
			"codeSkeleton.enabled.off": "Aus (Standard)",
			"intentSummary.title": "Abschluss-Zusammenfassung (Turn-Tail)",
			"intentSummary.description": "Aktiviert faltet der Turn-Abschluss den verbrauchten Zuwachs nach semantischen Rollen zu Intent-Zusammenfassungsblöcken: Lese-Tool-Ergebnisse werden zu Einzeilern mit Ziel/Umfang, die Schreibklasse behält Skelettköpfe plus wörtliche Fehlerzeilen; die Landung erfolgt in der nächsten Druckrunde über die gewöhnliche Falt-Pipeline. Zündet nur, wenn die Wachstumsschwelle passiert ist (live Oberfläche >45 % und >50K Token seit der letzten Faltung). Gilt für neue Sitzungen; die aktuelle lässt sich mit /ctx-summary off|on|status übersteuern.",
			"intentSummary.enabled": "Abschluss-Zusammenfassung",
			"intentSummary.enabled.on": "Ein",
			"intentSummary.enabled.off": "Aus (Standard)",
			"custom.title": "Eigene Strategie",
			"custom.settingsHint": "Detaillierte Parameter unter Einstellungen > Kontextkomprimierung wählen bearbeiten.",
			"custom.sessionScope": "Gespeicherte Änderungen greifen, wenn die aktuelle Compression-Runtime eine Sitzung zum ersten Mal beobachtet. Eine von dieser Runtime bereits beobachtete Sitzung behält ihre eingefrorene Strategie.",
			"custom.measurement": "Zuerst der exakte DeepSeek-Tokenizer; sonst Tokenizer-Schätzung mit Kalibrierung als Rückfallebene. Nie chars/4. Die Cache-Zuordnung bleibt unbekannt.",
			"custom.unit": "Kanonische Einheit",
			"custom.unit.tokens": "Token",
			"custom.unit.contextPercent": "Kontextprozent",
			"custom.enabled": "Aktiviert",
			"custom.enabled.on": "Ein",
			"custom.enabled.off": "Aus",
			"custom.fresh.enabled": "Fresh aktivieren",
			"custom.fresh.trigger": "Fresh-Auslöser",
			"custom.fresh.target": "Fresh-Ziel",
			"custom.aggregate.enabled": "Aggregate aktivieren",
			"custom.aggregate.trigger": "Aggregate-Auslöser",
			"custom.aggregate.target": "Aggregate-Ziel",
			"custom.history.enabled": "History aktivieren",
			"custom.history.trigger": "History-Auslöser",
			"custom.history.keepRecentToolCalls": "Geschützte letzte Tool-Aufrufe",
			"custom.history.keepRecentTokens": "Geschütztes neues Ende der Tool-Ergebnisse",
			"custom.history.minReclaim": "Mindest-Freigabe",
			"custom.prefixPolicy": "Richtlinie für gesendete Präfixe",
			"custom.prefixPolicy.preserve": "Bewahren bis Kapazitätsdruck",
			"custom.prefixPolicy.pressureBreak": "Reguläres Verlaufsaltern erlauben",
			"custom.experimental": "Experimentell: diese Regler gehören nur zum eigenen Profil und kommen nie in Standardprofile.",
			"custom.tailTrim.enabled": "TailTrim aktivieren (experimentell)",
			"custom.tailTrim.trigger": "TailTrim-Auslöser",
			"custom.tailTrim.warning": "TailTrim erfordert den exakten Tokenizer und ersetzt höchstens eine vollständige, abgeschlossene, fehlerfreie Gruppe nur aus Tools durch eine wiederherstellbare Referenz. Es teilt sich mit History die geschützten letzten Tool-Aufrufe, das geschützte neue Ende der Tool-Ergebnisse und die Mindest-Freigabe. Es schreibt ein gesendetes Präfix um und kann Cache-Treffer verringern.",
			"custom.save": "Eigene Strategie speichern",
			"custom.reset": "Eigene Strategie zurücksetzen",
			"custom.invalid": "Werte der eigenen Strategie sind ungültig.",
			"savings.title": "Einsparungen (dieser Prozess)",
			"savings.netExact": "Netto gespeichert (exakte Basis)",
			"savings.netEstimated": "Netto gespeichert (geschätzte Basis)",
			"savings.gross": "Brutto gespeichert (bei Veröffentlichung)",
			"savings.offsets": "Abschläge (komprimiert, später vollständig gelesen)",
			"savings.empty": "Noch keine Komprimierung — Nettoeinsparungen erscheinen nach der ersten Reduktion.",
			"savings.basisExact": "exakt",
			"savings.basisEstimated": "geschätzt",
			"savings.basisNote": "Basen werden getrennt ausgewiesen, nie gemischt: exakt = DeepSeek-Tokenizer; geschätzt = chars/4. Erst Skelett, dann Volltext zählt als negative Einsparung (Netto kann unter null fallen)."
		};
		//#endregion
		//#region src/client/locales/es.ts
		/** Spanish copy matching every simplified Chinese selector key. */
		const es = {
			"nav": "Selector de compresión de contexto",
			"settings.title": "Selector de compresión de contexto",
			"settings.description": "Elige un perfil de compresión para la sesión actual y configura los parámetros que ofrece.",
			"label": "Compresión de contexto",
			"status.loading": "Cargando",
			"status.unavailable": "No disponible",
			"status.presetUnavailable": "El preset de esta sesión no ofrece compresión de contexto, o su disponibilidad aún no está confirmada.",
			"status.minimalUnavailable": "El modo minimal no carga compresión de contexto en esta sesión: el selector queda apagado y se mantiene el comportamiento nativo de Harness. Cambia a Standard, PTC / Coding, Creative o a un preset personalizado compatible para configurarlo.",
			"status.saveFailed": "No se pudo guardar. Inténtalo de nuevo.",
			"pricing.disclosure": "Precios oficiales de DeepSeek verificados el 2026-08-25. Horas pico de lunes a viernes 09:00–12:00 y 14:00–18:00 (Asia/Shanghai); el resto, horas valle. Las solicitudes que cruzan el límite usan un rango de costo.",
			"profile.balanced": "Equilibrado",
			"profile.cache-strict": "Cache Strict (protección del prefijo)",
			"profile.savings": "Ahorro",
			"profile.adaptive": "Adaptativo (costo conservador)",
			"profile.tokenpilot-inspired": "Inspirado en TokenPilot",
			"estimator.title": "Estimador (opcional)",
			"estimator.description": "Un pequeño modelo auxiliar estima sin ejemplos si las lecturas antiguas de archivos probablemente aún se referencian; solo consultivo para el envejecimiento del historial. Sin configuración o ante fallos, se vuelve al comportamiento basado solo en reglas.",
			"estimator.mode": "Canal",
			"estimator.mode.off": "Desactivado (solo reglas)",
			"estimator.mode.host": "Modelo host (reutiliza los proveedores configurados)",
			"estimator.mode.direct": "Endpoint directo compatible con OpenAI",
			"estimator.inactive": "El estimador solo existe en el perfil Inspirado en TokenPilot: las opciones de preset de ese perfil (punteros de deduplicación, localizadores de resumen, semántica del estado de lectura y el canal del estimador) nunca se fusionan en otro perfil, así que el perfil actual «{profile}» no tiene canal de estimador que configurar. Elige Inspirado en TokenPilot y esta sección mostrará la elección de canal — reutilizar los proveedores configurados (modelo host) o un endpoint directo compatible con OpenAI.",
			"estimator.provider": "Proveedor",
			"estimator.provider.placeholder": "Vacío sigue el modelo predeterminado de la sesión; elige del menú o escribe un id personalizado",
			"estimator.model.placeholder": "Vacío sigue el modelo predeterminado de la sesión; elige del menú o escribe un id personalizado",
			"estimator.hostReuse": "El canal host reutiliza los proveedores y credenciales ya configurados en DSH: no hace falta clave de API — y aquí no se acepta ninguna.",
			"estimator.hostRoute": "Ruta efectiva: {route}.",
			"estimator.hostUnresolved": "aún sin determinar (elige un modelo predeterminado en los ajustes de DSH, o indica aquí un proveedor y un modelo)",
			"estimator.baseUrl": "URL base del endpoint (/v1)",
			"estimator.model": "Modelo",
			"estimator.apiKey": "Clave de API (solo escritura, nunca se muestra)",
			"estimator.apiKey.placeholder": "Escribe la clave del endpoint; sal del campo para guardar",
			"estimator.apiKey.set": "Configurada · escribe un valor nuevo para sobrescribirla",
			"estimator.apiKey.clear": "Borrar",
			"estimator.apiKey.overwrite": "Hay un secreto guardado; escribe un valor nuevo y sal del campo para sobrescribirlo.",
			"detail.tokenpilot-inspired": "Superpuesto a Equilibrado: punteros de deduplicación, exención de recuperación, localizadores de resumen, estabilización del prefijo y semántica del estado de lectura; el estimador requiere un endpoint configurado aparte",
			"profile.custom": "Personalizado / Experimental",
			"profile.native": "Referencia nativa",
			"profile.off": "Plugin desactivado",
			"profile.current": "Perfil actual",
			"detail.balanced": "Reduce de forma determinista los resultados frescos de las herramientas; envejece los antiguos en niveles altos",
			"detail.cache-strict": "Envejece el historial enviado solo bajo presión de capacidad confirmada; los aciertos de caché del proveedor siguen siendo best-effort",
			"detail.savings": "Usa objetivos más pequeños y envejece antes los resultados antiguos de las herramientas; una solicitud más barata no está garantizada",
			"detail.adaptive": "Usa Fresh/Aggregate de Equilibrado; envejece el historial solo si el uso oficial adyacente y los precios oficiales vigentes prueban un ahorro claro",
			"detail.custom": "Elige las etapas implementadas y los umbrales medidos para las nuevas sesiones",
			"detail.native": "Usa solo el recorte nativo de inicio/fin de Harness",
			"detail.off": "Desactiva el selector determinista; el auto-compact nativo se configura aparte",
			"autoCompact.title": "Nivel de activación de Auto Compact",
			"autoCompact.description": "El Auto Compact pilotado por el modelo se activa cuando la ocupación de la solicitud supera este nivel. Los disparadores History del perfil estándar, la recuperación mínima y la cola reciente siguen al nivel; los cambios afectan solo a sesiones nuevas.",
			"autoCompact.inputLabel": "Umbral de Auto Compact (%)",
			"autoCompact.sliderLabel": "Deslizador del umbral de Auto Compact",
			"autoCompact.quick": "Valores rápidos",
			"autoCompact.riskLow": "Por debajo del rango recomendado: activar antes aumenta las llamadas de resumen y las reconstrucciones del prefijo.",
			"autoCompact.riskHigh": "Por encima del rango recomendado: la capacidad del contexto se comparte entre solicitudes y salida, activar más tarde reduce el margen para salidas grandes individuales, razonamiento y esquemas de herramientas.",
			"autoCompact.invalid": "El umbral de Auto Compact debe ser un entero entre 50 y 90.",
			"autoCompact.save": "Guardar el umbral de Auto Compact",
			"autoCompact.summaryHint": "Umbral de Auto Compact: {percent}%. Se puede cambiar en Ajustes.",
			"codeSkeleton.title": "Compresión de esqueleto del código (opcional)",
			"codeSkeleton.description": "Interruptor ortogonal, independiente de los perfiles de arriba. Al activarlo, un resultado de herramienta de código fuente demasiado grande prueba primero un esqueleto que conserva imports y declaraciones (cuerpos omitidos, líneas de error conservadas) y, si falla, vuelve al recorte de cabeza original. Requiere el tokenizador exacto; afecta solo a sesiones nuevas.",
			"codeSkeleton.enabled": "Compresión de esqueleto del código",
			"codeSkeleton.enabled.on": "Activado",
			"codeSkeleton.enabled.off": "Desactivado (predeterminado)",
			"intentSummary.title": "Resumen de intención al cierre del turno",
			"intentSummary.description": "Al activarlo, el postflight de cierre de turno pliega el incremento consumido en bloques de resumen de intención por rol semántico: los resultados de herramientas de lectura se convierten en registros de una línea con objetivo/escala y los de escritura conservan la cabecera de esqueleto más las líneas de error textuales; aterriza en la siguiente ronda de presión por el conducto de plegado normal. Solo se dispara si se supera la puerta de crecimiento (superficie activa >45 % y >50K tokens desde el último plegado). Aplica a sesiones nuevas; la actual se gobierna con /ctx-summary off|on|status.",
			"intentSummary.enabled": "Resumen de intención al cierre",
			"intentSummary.enabled.on": "Sí",
			"intentSummary.enabled.off": "No (predeterminado)",
			"custom.title": "Política personalizada",
			"custom.settingsHint": "Edita los parámetros detallados en Ajustes > Selector de compresión de contexto.",
			"custom.sessionScope": "Los cambios guardados se aplican cuando el runtime de compresión actual observa una Session por primera vez. Una Session ya observada por ese runtime conserva su política congelada.",
			"custom.measurement": "Primero el tokenizador exacto de DeepSeek; si no, estimación del tokenizador con calibración de respaldo. Nunca chars/4. La atribución de caché sigue siendo desconocida.",
			"custom.unit": "Unidad canónica",
			"custom.unit.tokens": "Tokens",
			"custom.unit.contextPercent": "Porcentaje del contexto",
			"custom.enabled": "Activado",
			"custom.enabled.on": "Activado",
			"custom.enabled.off": "Desactivado",
			"custom.fresh.enabled": "Activar Fresh",
			"custom.fresh.trigger": "Disparador de Fresh",
			"custom.fresh.target": "Objetivo de Fresh",
			"custom.aggregate.enabled": "Activar Aggregate",
			"custom.aggregate.trigger": "Disparador de Aggregate",
			"custom.aggregate.target": "Objetivo de Aggregate",
			"custom.history.enabled": "Activar History",
			"custom.history.trigger": "Disparador de History",
			"custom.history.keepRecentToolCalls": "Llamadas a herramientas recientes protegidas",
			"custom.history.keepRecentTokens": "Cola reciente de resultados de herramientas protegida",
			"custom.history.minReclaim": "Recuperación mínima",
			"custom.prefixPolicy": "Política del prefijo enviado",
			"custom.prefixPolicy.preserve": "Conservar hasta presión de capacidad",
			"custom.prefixPolicy.pressureBreak": "Permitir el envejecimiento habitual del historial",
			"custom.experimental": "Experimental: estos controles sirven solo al perfil personalizado y nunca se añaden a los perfiles estándar.",
			"custom.tailTrim.enabled": "Activar TailTrim (experimental)",
			"custom.tailTrim.trigger": "Disparador de TailTrim",
			"custom.tailTrim.warning": "TailTrim requiere el tokenizador exacto y sustituye como máximo un grupo completo, terminado y sin errores compuesto solo por herramientas por una referencia recuperable. Comparte con History las llamadas a herramientas recientes protegidas, la cola reciente de resultados de herramientas protegida y la recuperación mínima. Reescribe un prefijo enviado y puede reducir los aciertos de caché.",
			"custom.save": "Guardar la política personalizada",
			"custom.reset": "Restablecer la política personalizada",
			"custom.invalid": "Los valores de la política personalizada no son válidos.",
			"savings.title": "Ahorro (este proceso)",
			"savings.netExact": "Ahorro neto (base exacta)",
			"savings.netEstimated": "Ahorro neto (base estimada)",
			"savings.gross": "Ahorro bruto (al publicar)",
			"savings.offsets": "Compensaciones (contenido comprimido y luego releído completo)",
			"savings.empty": "Aún sin compresión: el ahorro neto aparece tras la primera reducción.",
			"savings.basisExact": "exacta",
			"savings.basisEstimated": "estimada",
			"savings.basisNote": "Las bases se informan por separado, nunca mezcladas: exacta = tokenizador DeepSeek; estimada = chars/4. Esqueleto seguido de lectura completa cuenta como ahorro negativo (el neto puede ser negativo)."
		};
		//#endregion
		//#region src/client/locales/fr.ts
		/** French copy matching every simplified Chinese selector key. */
		const fr = {
			"nav": "Sélecteur de compression du contexte",
			"settings.title": "Sélecteur de compression du contexte",
			"settings.description": "Choisissez un profil de compression pour la session en cours et configurez ses paramètres.",
			"label": "Compression du contexte",
			"status.loading": "Chargement",
			"status.unavailable": "Indisponible",
			"status.presetUnavailable": "Le preset de cette session ne fournit pas de compression du contexte, ou sa disponibilité n’est pas encore confirmée.",
			"status.minimalUnavailable": "Le mode minimal ne charge pas la compression du contexte pour cette session : le sélecteur est éteint et le comportement natif de Harness s’applique. Passez à Standard, PTC / Coding, Créatif ou à un preset personnalisé compatible pour le configurer.",
			"status.saveFailed": "Échec de l’enregistrement. Réessayez.",
			"pricing.disclosure": "Tarifs officiels DeepSeek vérifiés le 2026-08-25. Heures pleines du lundi au vendredi 09:00–12:00 et 14:00–18:00 (Asia/Shanghai) ; heures creuses sinon. Les requêtes à cheval sur deux plages utilisent une fourchette de coût.",
			"profile.balanced": "Équilibré",
			"profile.cache-strict": "Cache Strict (protection du préfixe)",
			"profile.savings": "Économies",
			"profile.adaptive": "Adaptatif (coût prudent)",
			"profile.tokenpilot-inspired": "Inspiré de TokenPilot",
			"estimator.title": "Estimateur (optionnel)",
			"estimator.description": "Un petit modèle auxiliaire estime sans exemples si les anciennes lectures de fichiers ont encore des chances d’être référencées ; indicatif seulement, pour le vieillissement de l’historique. Sans configuration ou en cas d’échec, retour aux règles seules.",
			"estimator.mode": "Canal",
			"estimator.mode.off": "Désactivé (règles seules)",
			"estimator.mode.host": "Modèle hôte (réutilise les fournisseurs configurés)",
			"estimator.mode.direct": "Point de terminaison compatible OpenAI direct",
			"estimator.inactive": "L’estimateur n’existe qu’avec le profil Inspiré de TokenPilot : les options de preset de ce profil (pointeurs de déduplication, localisateurs de résumé, sémantique d’état de lecture et canal d’estimation) ne sont jamais fusionnées dans un autre profil, donc le profil actuel « {profile} » n’a aucun canal d’estimateur à configurer. Sélectionnez Inspiré de TokenPilot et cette section gagne un choix de canal — réutiliser les fournisseurs configurés (modèle hôte) ou un point de terminaison compatible OpenAI direct.",
			"estimator.provider": "Fournisseur",
			"estimator.provider.placeholder": "Vide : suit le modèle par défaut de la session ; choisissez dans la liste ou saisissez un identifiant personnalisé",
			"estimator.model.placeholder": "Vide : suit le modèle par défaut de la session ; choisissez dans la liste ou saisissez un identifiant personnalisé",
			"estimator.hostReuse": "Le canal hôte réutilise les fournisseurs et identifiants déjà configurés dans DSH : aucune clé d’API n’est nécessaire — et aucune n’est acceptée ici.",
			"estimator.hostRoute": "Route effective : {route}.",
			"estimator.hostUnresolved": "pas encore déterminé (choisissez un modèle par défaut dans les réglages DSH, ou indiquez ici un fournisseur et un modèle)",
			"estimator.baseUrl": "URL de base du point de terminaison (/v1)",
			"estimator.model": "Modèle",
			"estimator.apiKey": "Clé d’API (écriture seule, jamais renvoyée)",
			"estimator.apiKey.placeholder": "Saisissez la clé du point de terminaison ; quittez le champ pour enregistrer",
			"estimator.apiKey.set": "Définie · saisissez une nouvelle valeur pour la remplacer",
			"estimator.apiKey.clear": "Effacer",
			"estimator.apiKey.overwrite": "Un secret est enregistré ; saisissez une nouvelle valeur et quittez le champ pour la remplacer.",
			"detail.tokenpilot-inspired": "Superposé à Équilibré : pointeurs de déduplication, exemption de récupération, localisateurs de résumé, stabilisation du préfixe et sémantique d’état de lecture ; l’estimateur demande un point de terminaison configuré à part",
			"profile.custom": "Personnalisé / Expérimental",
			"profile.native": "Référence native",
			"profile.off": "Plugin désactivé",
			"profile.current": "Profil actuel",
			"detail.balanced": "Réduit de façon déterministe les résultats d’outils frais ; vieillit les anciens résultats aux seuils hauts",
			"detail.cache-strict": "Vieillit l’historique envoyé seulement sous pression de capacité confirmée ; les hits de cache du fournisseur restent non garantis",
			"detail.savings": "Vise des cibles plus petites et vieillit plus tôt les anciens résultats d’outils ; une requête moins chère n’est pas garantie",
			"detail.adaptive": "Utilise Fresh/Aggregate d’Équilibré ; ne vieillit l’historique que si l’usage officiel voisin et les prix officiels courants prouvent une économie nette",
			"detail.custom": "Choisissez les étapes implémentées et les seuils mesurés des nouvelles sessions",
			"detail.native": "Utilise uniquement l’élagage début/fin natif de Harness",
			"detail.off": "Désactive le sélecteur déterministe ; l’auto-compact natif reste configuré à part",
			"autoCompact.title": "Seuil de déclenchement d’Auto Compact",
			"autoCompact.description": "L’Auto Compact piloté par le modèle se déclenche dès que l’occupation de la requête dépasse ce niveau. Les déclenchements History du profil standard, la récupération minimale et la fenêtre récente suivent ce niveau ; les changements ne touchent que les nouvelles sessions.",
			"autoCompact.inputLabel": "Seuil Auto Compact (%)",
			"autoCompact.sliderLabel": "Curseur du seuil Auto Compact",
			"autoCompact.quick": "Valeurs rapides",
			"autoCompact.riskLow": "Sous la plage recommandée : déclencher plus tôt augmente les appels de résumé et les reconstructions de préfixe.",
			"autoCompact.riskHigh": "Au-dessus de la plage recommandée : la capacité du contexte est partagée entre requêtes et sortie, déclencher plus tard réduit la marge pour les grandes sorties, le raisonnement et les schémas d’outils.",
			"autoCompact.invalid": "Le seuil Auto Compact doit être un entier entre 50 et 90.",
			"autoCompact.save": "Enregistrer le seuil Auto Compact",
			"autoCompact.summaryHint": "Seuil Auto Compact : {percent} %. Modifiable dans les réglages.",
			"codeSkeleton.title": "Compression du code en squelette (opt-in)",
			"codeSkeleton.description": "Interrupteur orthogonal, indépendant des profils ci-dessus. Activé, un résultat d’outil code source surdimensionné tente d’abord un squelette gardant imports et déclarations (corps omis, lignes d’erreur conservées), puis revient à l’élagage de tête d’origine en cas d’échec. Exige le tokenizer exact ; ne touche que les nouvelles sessions.",
			"codeSkeleton.enabled": "Compression du code en squelette",
			"codeSkeleton.enabled.on": "Activé",
			"codeSkeleton.enabled.off": "Désactivé (par défaut)",
			"intentSummary.title": "Résumé d'intention en fin de tour",
			"intentSummary.description": "Activé, le postflight de fin de tour plie l'incrément consommé en blocs de résumé d'intention par rôle sémantique : les résultats d'outils de lecture deviennent des enregistrements une-ligne objectif/échelle, les écrits gardent la tête de squelette plus les lignes d'erreur verbatim ; l'atterrissage se fait au prochain tour de pression via le pipeline de pliage habituel. Ne se déclenche que si la porte de croissance passe (surface active >45 % et >50K tokens depuis le dernier pliage). S'applique aux nouvelles sessions ; la session courante se pilote avec /ctx-summary off|on|status.",
			"intentSummary.enabled": "Résumé d'intention en fin de tour",
			"intentSummary.enabled.on": "Activé",
			"intentSummary.enabled.off": "Désactivé (par défaut)",
			"custom.title": "Stratégie personnalisée",
			"custom.settingsHint": "Modifiez les paramètres détaillés dans Réglages > Sélecteur de compression du contexte.",
			"custom.sessionScope": "Les changements enregistrés s’appliquent quand le runtime de compression actuel observe une Session pour la première fois. Une Session déjà observée par ce runtime garde sa stratégie figée.",
			"custom.measurement": "Tokenizer DeepSeek exact d’abord ; sinon estimation par tokenizer avec calibration en repli. Jamais chars/4. L’attribution du cache reste inconnue.",
			"custom.unit": "Unité canonique",
			"custom.unit.tokens": "Tokens",
			"custom.unit.contextPercent": "Pourcentage du contexte",
			"custom.enabled": "Activé",
			"custom.enabled.on": "Activé",
			"custom.enabled.off": "Désactivé",
			"custom.fresh.enabled": "Activer Fresh",
			"custom.fresh.trigger": "Déclenchement Fresh",
			"custom.fresh.target": "Cible Fresh",
			"custom.aggregate.enabled": "Activer Aggregate",
			"custom.aggregate.trigger": "Déclenchement Aggregate",
			"custom.aggregate.target": "Cible Aggregate",
			"custom.history.enabled": "Activer History",
			"custom.history.trigger": "Déclenchement History",
			"custom.history.keepRecentToolCalls": "Appels d’outils récents protégés",
			"custom.history.keepRecentTokens": "Fin récente des résultats d’outils protégée",
			"custom.history.minReclaim": "Récupération minimale",
			"custom.prefixPolicy": "Politique du préfixe envoyé",
			"custom.prefixPolicy.preserve": "Préserver jusqu’à pression de capacité",
			"custom.prefixPolicy.pressureBreak": "Autoriser le vieillissement courant de l’historique",
			"custom.experimental": "Expérimental : ces réglages ne servent qu’au profil Personnalisé et ne sont jamais ajoutés aux profils standards.",
			"custom.tailTrim.enabled": "Activer TailTrim (expérimental)",
			"custom.tailTrim.trigger": "Déclenchement TailTrim",
			"custom.tailTrim.warning": "TailTrim exige le tokenizer exact et remplace au plus un groupe complet, terminé et sans erreur, composé uniquement d’outils, par une référence récupérable. Il partage avec History les appels d’outils récents protégés, la fin récente des résultats d’outils protégée et la récupération minimale. Il réécrit un préfixe envoyé et peut réduire les hits de cache.",
			"custom.save": "Enregistrer la stratégie personnalisée",
			"custom.reset": "Réinitialiser la stratégie personnalisée",
			"custom.invalid": "Valeurs de la stratégie personnalisée invalides.",
			"savings.title": "Économies (ce processus)",
			"savings.netExact": "Économie nette (base exacte)",
			"savings.netEstimated": "Économie nette (base estimée)",
			"savings.gross": "Économie brute (à la publication)",
			"savings.offsets": "Compensations (contenu compressé puis relu intégralement)",
			"savings.empty": "Aucune compression pour l’instant — l’économie nette apparaît après la première réduction.",
			"savings.basisExact": "exacte",
			"savings.basisEstimated": "estimée",
			"savings.basisNote": "Les bases sont présentées séparément, jamais mélangées : exacte = tokenizer DeepSeek ; estimée = chars/4. Un squelette suivi d’une lecture complète compte comme économie négative (le net peut être négatif)."
		};
		//#endregion
		//#region src/client/locales/it.ts
		/** Italian copy matching every simplified Chinese selector key. */
		const it = {
			"nav": "Selettore di compressione del contesto",
			"settings.title": "Selettore di compressione del contesto",
			"settings.description": "Scegli un profilo di compressione per la sessione corrente e configura i parametri che offre.",
			"label": "Compressione del contesto",
			"status.loading": "Caricamento",
			"status.unavailable": "Non disponibile",
			"status.presetUnavailable": "Il preset di questa sessione non fornisce la compressione del contesto, oppure la disponibilità non è ancora confermata.",
			"status.minimalUnavailable": "La modalità minima non carica la compressione del contesto per questa sessione: il selettore resta spento e vale il comportamento nativo di Harness. Passa a Standard, PTC / Coding, Creativa o a un preset personalizzato compatibile per configurarlo.",
			"status.saveFailed": "Salvataggio non riuscito. Riprova.",
			"pricing.disclosure": "Prezzi ufficiali DeepSeek verificati il 2026-08-25. Ore di picco lun–ven 09:00–12:00 e 14:00–18:00 (Asia/Shanghai); altrimenti ore non di picco. Le richieste a cavallo dei limiti usano un intervallo di costo.",
			"profile.balanced": "Bilanciato",
			"profile.cache-strict": "Cache Strict (protezione del prefisso)",
			"profile.savings": "Risparmio",
			"profile.adaptive": "Adattivo (costo prudente)",
			"profile.tokenpilot-inspired": "Ispirato a TokenPilot",
			"estimator.title": "Stimatore (opzionale)",
			"estimator.description": "Un piccolo modello ausiliario stima senza esempi se le vecchie letture di file sono probabilmente ancora referenziate; solo consultivo per l’invecchiamento della cronologia. Senza configurazione o in caso di errore si ripiega sul solo comportamento a regole.",
			"estimator.mode": "Canale",
			"estimator.mode.off": "Disattivato (solo regole)",
			"estimator.mode.host": "Modello host (riusa i provider configurati)",
			"estimator.mode.direct": "Endpoint compatibile OpenAI diretto",
			"estimator.inactive": "Lo stimatore esiste solo nel profilo Ispirato a TokenPilot: le opzioni di preset di quel profilo (puntatori di deduplica, localizzatori di riassunto, semantica dello stato di lettura e il canale dello stimatore) non vengono mai unite in un altro profilo, quindi il profilo attuale «{profile}» non ha un canale dello stimatore da configurare. Seleziona Ispirato a TokenPilot e questa sezione offrirà la scelta del canale — riutilizzare i provider configurati (modello host) o un endpoint compatibile OpenAI diretto.",
			"estimator.provider": "Provider",
			"estimator.provider.placeholder": "Vuoto segue il modello predefinito della sessione; scegli dal menu o digita un id personalizzato",
			"estimator.model.placeholder": "Vuoto segue il modello predefinito della sessione; scegli dal menu o digita un id personalizzato",
			"estimator.hostReuse": "Il canale host riusa i provider e le credenziali già configurati in DSH: nessuna chiave API necessaria — e qui non ne viene accettata alcuna.",
			"estimator.hostRoute": "Route effettiva: {route}.",
			"estimator.hostUnresolved": "non ancora determinato (scegli un modello predefinito nelle impostazioni DSH, o indica qui un provider e un modello)",
			"estimator.baseUrl": "URL di base dell’endpoint (/v1)",
			"estimator.model": "Modello",
			"estimator.apiKey": "Chiave API (sola scrittura, mai mostrata)",
			"estimator.apiKey.placeholder": "Digita la chiave dell’endpoint; esci dal campo per salvare",
			"estimator.apiKey.set": "Impostata · digita un nuovo valore per sovrascriverla",
			"estimator.apiKey.clear": "Cancella",
			"estimator.apiKey.overwrite": "Un segreto è salvato; digita un nuovo valore ed esci dal campo per sovrascriverlo.",
			"detail.tokenpilot-inspired": "Sovrapposto a Bilanciato: puntatori di deduplica, esenzione dal recupero, localizzatori di riassunto, stabilizzazione del prefisso e semantica dello stato di lettura; lo stimatore richiede un endpoint configurato a parte",
			"profile.custom": "Personalizzato / Sperimentale",
			"profile.native": "Riferimento nativo",
			"profile.off": "Plugin disattivato",
			"profile.current": "Profilo attuale",
			"detail.balanced": "Riduce in modo deterministico i risultati freschi dei tool; invecchia i risultati vecchi alle soglie alte",
			"detail.cache-strict": "Invecchia la cronologia inviata solo sotto pressione di capacità confermata; i hit della cache del provider restano best-effort",
			"detail.savings": "Usa obiettivi più piccoli e invecchia prima i vecchi risultati dei tool; una richiesta più economica non è garantita",
			"detail.adaptive": "Usa Fresh/Aggregate di Bilanciato; invecchia la cronologia solo se l’uso ufficiale adiacente e i prezzi ufficiali correnti provano un risparmio netto",
			"detail.custom": "Scegli le fasi implementate e le soglie misurate per le nuove sessioni",
			"detail.native": "Usa solo la potatura inizio/coda nativa di Harness",
			"detail.off": "Disattiva il selettore deterministico; l’auto-compact nativo resta configurato a parte",
			"autoCompact.title": "Soglia di attivazione di Auto Compact",
			"autoCompact.description": "L’Auto Compact pilotato dal modello si attiva quando l’occupazione della richiesta supera questa soglia. Gli attivatori History del profilo standard, il recupero minimo e la coda recente seguono la soglia; le modifiche valgono solo per le nuove sessioni.",
			"autoCompact.inputLabel": "Soglia Auto Compact (%)",
			"autoCompact.sliderLabel": "Cursore della soglia Auto Compact",
			"autoCompact.quick": "Valori rapidi",
			"autoCompact.riskLow": "Sotto la fascia consigliata: attivare prima aumenta le chiamate di riassunto e le ricostruzioni del prefisso.",
			"autoCompact.riskHigh": "Sopra la fascia consigliata: la capacità del contesto è condivisa da richieste e output, attivare dopo riduce il margine per singole grandi uscite, reasoning e schemi dei tool.",
			"autoCompact.invalid": "La soglia Auto Compact deve essere un intero tra 50 e 90.",
			"autoCompact.save": "Salva la soglia Auto Compact",
			"autoCompact.summaryHint": "Soglia Auto Compact: {percent}%. Modificabile nelle impostazioni.",
			"codeSkeleton.title": "Compressione a scheletro del codice (opt-in)",
			"codeSkeleton.description": "Interruttore ortogonale, indipendente dai profili sopra. Attivato, un risultato tool di codice sorgente sovradimensionato prova prima uno scheletro che conserva import e dichiarazioni (corpi omessi, righe di errore tenute) e, in caso di fallimento, ripiega sulla potatura della testa originale. Richiede il tokenizer esatto; vale solo per le nuove sessioni.",
			"codeSkeleton.enabled": "Compressione a scheletro del codice",
			"codeSkeleton.enabled.on": "Attivato",
			"codeSkeleton.enabled.off": "Disattivato (predefinito)",
			"intentSummary.title": "Riepilogo di intento a fine turno",
			"intentSummary.description": "Quando attivo, il postflight di fine turno piega l'incremento consumato in blocchi di riepilogo di intento per ruolo semantico: i risultati degli strumenti di lettura diventano record a riga singola obiettivo/scala, quelli di scrittura mantengono la testa dello scheletro più le righe di errore testuali; atterra al prossimo round di pressione tramite la pipeline di piegatura ordinaria. Si attiva solo se la soglia di crescita passa (superficie attiva >45% e >50K token dall'ultima piegatura). Vale per le nuove sessioni; quella corrente si governa con /ctx-summary off|on|status.",
			"intentSummary.enabled": "Riepilogo di intento a fine turno",
			"intentSummary.enabled.on": "On",
			"intentSummary.enabled.off": "Disattivato (predefinito)",
			"custom.title": "Politica personalizzata",
			"custom.settingsHint": "Modifica i parametri dettagliati in Impostazioni > Selettore di compressione del contesto.",
			"custom.sessionScope": "Le modifiche salvate si applicano quando l’attuale runtime di compressione osserva una Sessione per la prima volta. Una Sessione già osservata da quel runtime mantiene la sua politica congelata.",
			"custom.measurement": "Prima il tokenizer DeepSeek esatto; altrimenti stima del tokenizer con calibrazione di riserva. Mai chars/4. L’attribuzione della cache resta sconosciuta.",
			"custom.unit": "Unità canonica",
			"custom.unit.tokens": "Token",
			"custom.unit.contextPercent": "Percentuale del contesto",
			"custom.enabled": "Attivo",
			"custom.enabled.on": "Attivato",
			"custom.enabled.off": "Disattivato",
			"custom.fresh.enabled": "Attiva Fresh",
			"custom.fresh.trigger": "Trigger Fresh",
			"custom.fresh.target": "Obiettivo Fresh",
			"custom.aggregate.enabled": "Attiva Aggregate",
			"custom.aggregate.trigger": "Trigger Aggregate",
			"custom.aggregate.target": "Obiettivo Aggregate",
			"custom.history.enabled": "Attiva History",
			"custom.history.trigger": "Trigger History",
			"custom.history.keepRecentToolCalls": "Chiamate ai tool recenti protette",
			"custom.history.keepRecentTokens": "Coda recente dei risultati dei tool protetta",
			"custom.history.minReclaim": "Recupero minimo",
			"custom.prefixPolicy": "Politica del prefisso inviato",
			"custom.prefixPolicy.preserve": "Conserva finché non c’è pressione di capacità",
			"custom.prefixPolicy.pressureBreak": "Consenti l’invecchiamento ordinario della cronologia",
			"custom.experimental": "Sperimentale: questi controlli servono solo al profilo personalizzato e non vengono mai aggiunti ai profili standard.",
			"custom.tailTrim.enabled": "Attiva TailTrim (sperimentale)",
			"custom.tailTrim.trigger": "Trigger TailTrim",
			"custom.tailTrim.warning": "TailTrim richiede il tokenizer esatto e sostituisce al massimo un gruppo completo, concluso e senza errori composto solo da tool con un riferimento recuperabile. Condivide con History le chiamate ai tool recenti protette, la coda recente dei risultati dei tool protetta e il recupero minimo. Riscrive un prefisso inviato e può ridurre i hit della cache.",
			"custom.save": "Salva la politica personalizzata",
			"custom.reset": "Reimposta la politica personalizzata",
			"custom.invalid": "I valori della politica personalizzata non sono validi.",
			"savings.title": "Risparmi (questo processo)",
			"savings.netExact": "Risparmio netto (base esatta)",
			"savings.netEstimated": "Risparmio netto (base stimata)",
			"savings.gross": "Risparmio lordo (alla pubblicazione)",
			"savings.offsets": "Compensazioni (contenuto compresso e poi riletto per intero)",
			"savings.empty": "Nessuna compressione — il risparmio netto appare dopo la prima riduzione.",
			"savings.basisExact": "esatta",
			"savings.basisEstimated": "stimata",
			"savings.basisNote": "Le basi sono riportate separatamente, mai miste: esatta = tokenizer DeepSeek; stimata = chars/4. Uno scheletro seguito dalla lettura completa conta come risparmio negativo (il netto può scendere sotto zero)."
		};
		//#endregion
		//#region src/client/locales/ja.ts
		/** Japanese copy matching every simplified Chinese selector key. */
		const ja = {
			"nav": "コンテキスト圧縮セレクター",
			"settings.title": "コンテキスト圧縮セレクター",
			"settings.description": "現在のセッションの圧縮プロファイルを選択し、プロファイルが提供するパラメーターを設定します。",
			"label": "コンテキスト圧縮",
			"status.loading": "読み込み中",
			"status.unavailable": "利用不可",
			"status.presetUnavailable": "このセッションのプリセットはコンテキスト圧縮を提供していないか、対応状況が未確認です。",
			"status.minimalUnavailable": "ミニマルモードのセッションではコンテキスト圧縮が読み込まれず、セレクターは実質オフとして Harness のネイティブ動作のみが適用されます。スタンダード、PTC / Coding、クリエイティブ、または対応するカスタムプリセットに切り替えると設定できます。",
			"status.saveFailed": "保存に失敗しました。もう一度お試しください。",
			"pricing.disclosure": "DeepSeek 公式価格は 2026-08-25 時点で確認。Asia/Shanghai の月〜金 09:00–12:00 および 14:00–18:00 がピーク時間帯、それ以外はオフピーク。境界をまたぐリクエストはコスト範囲で計算されます。",
			"profile.balanced": "バランス",
			"profile.cache-strict": "Cache Strict(プレフィックス保護)",
			"profile.savings": "節約",
			"profile.adaptive": "Adaptive(コスト重視)",
			"profile.tokenpilot-inspired": "TokenPilot モード",
			"estimator.title": "エスティメーター(任意)",
			"estimator.description": "小規模な補助モデルが、古いファイル読み取りにまだ参照価値があるかをゼロショットで判定します。履歴エージングの補助 only で、未設定や障害時は自動的にルールのみの経路へ戻り、本流には影響しません。",
			"estimator.mode": "チャネル",
			"estimator.mode.off": "オフ(ルールのみ)",
			"estimator.mode.host": "ホストモデル(設定済みプロバイダーを再利用)",
			"estimator.mode.direct": "OpenAI 互換エンドポイントに直接接続",
			"estimator.inactive": "エスティメーターは「TokenPilot モード」プロファイル専用です。同プロファイルのプリセットオプション(重複排除ポインター、サマリーロケーター、読み取り状態セマンティクス、エスティメーターチャネル)は他のプロファイルにマージされないため、現在のプロファイル「{profile}」では設定できるエスティメーターチャネルがありません。「TokenPilot モード」を選ぶとこのセクションに「チャネル」選択が現れ、設定済みプロバイダーの再利用(ホストモデル)か OpenAI 互換エンドポイントへの直接接続を選べます。",
			"estimator.provider": "プロバイダー",
			"estimator.provider.placeholder": "空欄ならセッションの既定モデルに従います。ドロップダウンから選択するか任意の ID を入力",
			"estimator.model.placeholder": "空欄ならセッションの既定モデルに従います。ドロップダウンから選択するか任意の ID を入力",
			"estimator.hostReuse": "ホストチャネルは DSH で設定済みのプロバイダーと資格情報をそのまま再利用するため、API キーは不要です。このチャネルでは API キーを受け付けません。",
			"estimator.hostRoute": "現在の経路:{route}。",
			"estimator.hostUnresolved": "未確定(DSH 設定で既定モデルを選ぶか、ここでプロバイダーとモデルを指定してください)",
			"estimator.baseUrl": "エンドポイントベース URL(/v1)",
			"estimator.model": "モデル",
			"estimator.apiKey": "API キー(書き込み専用、表示されません)",
			"estimator.apiKey.placeholder": "エンドポイントキーを入力。フォーカスを外すと保存",
			"estimator.apiKey.set": "設定済み · 新しい値を入力すると上書き",
			"estimator.apiKey.clear": "クリア",
			"estimator.apiKey.overwrite": "シークレット値が保存されています。新しい値を入力してフォーカスを外すと上書きされます。",
			"detail.tokenpilot-inspired": "バランスに追加で:重複排除ポインター、リカバリー免除、サマリーロケーター、プレフィックス安定化、読み取り状態セマンティクス。エスティメーターは別途エンドポイント設定が必要",
			"profile.custom": "Custom / 実験モード",
			"profile.native": "ネイティブ比較",
			"profile.off": "プラグイン オフ",
			"profile.current": "現在の選択",
			"detail.balanced": "新しいツール結果を決定論的に削減。高水位で古い結果をエージング",
			"detail.cache-strict": "確認済みの容量プレッシャー時のみ送信済み履歴をエージング。プロバイダーキャッシュ命中は best-effort のまま",
			"detail.savings": "より小さい目標値を使い、古いツール結果を早めにエージング。毎回のリクエストが安くなる保証はありません",
			"detail.adaptive": "Fresh / Aggregate はバランスと同一。直前の公式 usage と現在の公式価格で履歴圧縮が明確に得になる場合のみ履歴をエージングし、それ以外は保持",
			"detail.custom": "新しいセッションについて、実装済みの圧縮段階と計測しきい値を選択",
			"detail.native": "Harness のネイティブ先頭/末尾プルーナーのみを使用",
			"detail.off": "決定論的セレクターを無効化。ネイティブ auto-compact は Harness の設定に従います",
			"autoCompact.title": "Auto Compact トリガー水位",
			"autoCompact.description": "モデル駆動の Auto Compact は、リクエスト使用量がこの水位を超えると発火します。調整すると、スタンダードプロファイルの History トリガー・最小回収量・直近テールが水位に連動します。変更は新しいセッションにのみ適用されます。",
			"autoCompact.inputLabel": "Auto Compact しきい値(%)",
			"autoCompact.sliderLabel": "Auto Compact しきい値スライダー",
			"autoCompact.quick": "クイック値",
			"autoCompact.riskLow": "推奨範囲未満:早い発火は要約呼び出しとプレフィックス再構築を増やします。",
			"autoCompact.riskHigh": "推奨範囲超:コンテキスト容量はリクエストと出力で共有されます。発火が遅いと単一の大出力・推論・ツールスキーマの余裕が減ります。",
			"autoCompact.invalid": "Auto Compact しきい値は 50〜90 の整数である必要があります。",
			"autoCompact.save": "Auto Compact しきい値を保存",
			"autoCompact.summaryHint": "Auto Compact しきい値:{percent}%。設定から変更できます。",
			"codeSkeleton.title": "コードスケルトン圧縮(オプトイン)",
			"codeSkeleton.description": "上のプロファイルとは独立したオーソゴナルなスイッチ。有効にすると、初回露出した超大サイズのソースコード系ツール結果は、まずインポートと宣言を残すスケルトン(関数本体を省略しエラー行を保持)を試み、失敗時は元のヘッド プルーニングへ自動フォールバックします。正確なトークナイザーが必要で、変更は新しいセッションにのみ適用されます。",
			"codeSkeleton.enabled": "コードスケルトン圧縮",
			"codeSkeleton.enabled.on": "オン",
			"codeSkeleton.enabled.off": "オフ(既定)",
			"intentSummary.title": "ターン末尾インテント要約",
			"intentSummary.description": "有効にすると、ターン境界のポストフライトが消費済み増分を意味役割ごとにインテント要約ブロックへ折り畳みます。読み系ツール結果は目標/規模の 1 行レコードに、書き系は骨格ヘッダーと逐語エラー行を保持し、次の圧力ラウンドで通常の折り畳みパイプラインを通じて着地します。成長ゲート（ライブ表面 >45%、前回の折り畳みから >50K トークン増）を通過したときだけ発火します。変更は新セッションに適用され、現セッションは /ctx-summary off|on|status で上書きできます。",
			"intentSummary.enabled": "ターン末尾インテント要約",
			"intentSummary.enabled.on": "オン",
			"intentSummary.enabled.off": "オフ(既定)",
			"custom.title": "カスタムポリシー",
			"custom.settingsHint": "詳細パラメーターは「設定 > コンテキスト圧縮セレクター」で編集してください。",
			"custom.sessionScope": "保存した変更は、現在の圧縮ランタイムが次に Session を初めて観測したときに適用されます。そのランタイムに既に観測された Session は凍結済みポリシーを使い続けます。",
			"custom.measurement": "まず正確な DeepSeek トークナイザーを使い、利用できない場合はキャリブレーション付き tokenizer estimate へフォールバックします。chars/4 は決して使用しません。キャッシュ帰属は依然不明です。",
			"custom.unit": "正規単位",
			"custom.unit.tokens": "Tokens",
			"custom.unit.contextPercent": "コンテキスト パーセント",
			"custom.enabled": "有効化",
			"custom.enabled.on": "オン",
			"custom.enabled.off": "オフ",
			"custom.fresh.enabled": "Fresh を有効化",
			"custom.fresh.trigger": "Fresh トリガー",
			"custom.fresh.target": "Fresh 目標値",
			"custom.aggregate.enabled": "Aggregate を有効化",
			"custom.aggregate.trigger": "Aggregate トリガー",
			"custom.aggregate.target": "Aggregate 目標値",
			"custom.history.enabled": "History を有効化",
			"custom.history.trigger": "History トリガー",
			"custom.history.keepRecentToolCalls": "保護する直近ツール呼び出し数",
			"custom.history.keepRecentTokens": "保護するツール結果テール",
			"custom.history.minReclaim": "最小回収量",
			"custom.prefixPolicy": "送信済みプレフィックスポリシー",
			"custom.prefixPolicy.preserve": "容量プレッシャー時のみ改変",
			"custom.prefixPolicy.pressureBreak": "通常の履歴エージングを許可",
			"custom.experimental": "実験的:以下の項目は Custom 専用で、標準プロファイルには決して追加されません。",
			"custom.tailTrim.enabled": "TailTrim を有効化(実験的)",
			"custom.tailTrim.trigger": "TailTrim トリガー",
			"custom.tailTrim.warning": "TailTrim は正確なトークナイザーが必要で、完全で終了済みかつエラーでないツールのみのグループを 1 つだけ回復可能な参照へ置き換えます。History と「保護する直近ツール呼び出し数」「保護するツール結果テール」「最小回収量」を共有します。送信済みプレフィックスを書き換えるため、キャッシュ命中が下がる可能性があります。",
			"custom.save": "カスタムポリシーを保存",
			"custom.reset": "カスタムポリシーをリセット",
			"custom.invalid": "カスタムポリシーの値が不正です。",
			"savings.title": "節約統計(このプロセス)",
			"savings.netExact": "純節約(正確口径)",
			"savings.netEstimated": "純節約(推定口径)",
			"savings.gross": "総節約(圧縮確定時)",
			"savings.offsets": "相殺(圧縮後に全文再読)",
			"savings.empty": "まだ圧縮がありません。最初の削減後に純節約が表示されます。",
			"savings.basisExact": "正確",
			"savings.basisEstimated": "推定",
			"savings.basisNote": "口径は分列し混算しません:正確 = DeepSeek トークナイザー、推定 = chars/4。スケルトン後に全文を読むと負の節約として計上されます(純額はマイナスになり得ます)。"
		};
		//#endregion
		//#region src/client/locales/ko.ts
		/** Korean copy matching every simplified Chinese selector key. */
		const ko = {
			"nav": "컨텍스트 압축 셀렉터",
			"settings.title": "컨텍스트 압축 셀렉터",
			"settings.description": "현재 세션의 압축 프로필을 선택하고 프로필이 제공하는 파라미터를 구성합니다.",
			"label": "컨텍스트 압축",
			"status.loading": "불러오는 중",
			"status.unavailable": "사용 불가",
			"status.presetUnavailable": "이 세션의 프리셋은 컨텍스트 압축을 제공하지 않거나, 아직 가용 여부가 확인되지 않았습니다.",
			"status.minimalUnavailable": "미니멀 모드의 세션에는 컨텍스트 압축이 로드되지 않아 셀렉터는 사실상 꺼진 것과 같으며, Harness 네이티브 동작만 유지됩니다. 스탠다드, PTC / Coding, 크리에이티브 또는 지원하는 커스텀 프리셋으로 전환하면 설정할 수 있습니다.",
			"status.saveFailed": "저장에 실패했습니다. 다시 시도해 주세요.",
			"pricing.disclosure": "DeepSeek 공식 가격표 기준일 2026-08-25. Asia/Shanghai 월–금 09:00–12:00, 14:00–18:00는 피크 시간대이며 그 외는 비피크입니다. 경계를 넘는 요청은 비용 범위로 처리됩니다.",
			"profile.balanced": "밸런스",
			"profile.cache-strict": "Cache Strict(접두사 보호)",
			"profile.savings": "절약",
			"profile.adaptive": "Adaptive(보수적 비용)",
			"profile.tokenpilot-inspired": "TokenPilot 모드",
			"estimator.title": "추정기(선택 사항)",
			"estimator.description": "소형 보조 모델이 오래된 파일 읽기에 아직 참조 가치가 있는지 제로샷으로 판단합니다. 이력 에이징을 돕는 자문 전용 채널이며, 미설정 또는 실패 시 자동으로 규칙 전용 경로로 되돌아가므로 본 흐름에 영향을 주지 않습니다.",
			"estimator.mode": "채널",
			"estimator.mode.off": "끔(규칙 전용)",
			"estimator.mode.host": "호스트 모델(구성된 공급자 재사용)",
			"estimator.mode.direct": "OpenAI 호환 엔드포인트 직접 연결",
			"estimator.inactive": "추정기는 「TokenPilot 모드」 프로필에만 포함됩니다. 해당 프로필의 프리셋 옵션(중복 제거 포인터, 요약 로케이터, 읽기 상태 시맨틱, 추정기 채널)은 다른 프로필에 병합되지 않으므로, 현재 프로필 “{profile}”에서는 설정할 추정기 채널이 없습니다. 「TokenPilot 모드」를 선택하면 이 섹션에 「채널」 선택이 나타나며, 구성된 공급자 재사용(호스트 모델) 또는 OpenAI 호환 엔드포인트 직접 연결 중 고를 수 있습니다.",
			"estimator.provider": "공급자",
			"estimator.provider.placeholder": "비워 두면 세션 기본 모델을 따릅니다. 드롭다운에서 선택하거나 임의 ID 입력",
			"estimator.model.placeholder": "비워 두면 세션 기본 모델을 따릅니다. 드롭다운에서 선택하거나 임의 ID 입력",
			"estimator.hostReuse": "호스트 채널은 DSH에서 이미 구성한 공급자와 자격 증명을 그대로 재사용하므로 API 키가 필요 없으며, 이 채널은 API 키를 받지 않습니다.",
			"estimator.hostRoute": "현재 경로: {route}.",
			"estimator.hostUnresolved": "미확정(DSH 설정에서 기본 모델을 선택하거나, 여기서 공급자와 모델을 지정하세요)",
			"estimator.baseUrl": "엔드포인트 베이스 URL(/v1)",
			"estimator.model": "모델",
			"estimator.apiKey": "API 키(쓰기 전용, 다시 표시되지 않음)",
			"estimator.apiKey.placeholder": "엔드포인트 키를 입력하고 포커스를 벗어나면 저장",
			"estimator.apiKey.set": "설정됨 · 새 값을 입력하면 덮어씀",
			"estimator.apiKey.clear": "지우기",
			"estimator.apiKey.overwrite": "시크릿 값이 저장되어 있습니다. 새 값을 입력하고 포커스를 벗어나면 덮어씁니다.",
			"detail.tokenpilot-inspired": "밸런스에 추가로: 중복 제거 포인터, 복구 면제, 요약 로케이터, 접두사 안정화, 읽기 상태 시맨틱. 추정기는 엔드포인트를 별도 구성해야 함",
			"profile.custom": "Custom / 실험 모드",
			"profile.native": "네이티브 대조",
			"profile.off": "플러그인 끔",
			"profile.current": "현재 선택",
			"detail.balanced": "새 도구 결과를 결정론적으로 줄이고, 높은 수위에서 오래된 결과를 에이징",
			"detail.cache-strict": "확인된 용량 압박 시에만 전송 이력을 에이징. 공급자 캐시 적중은 여전히 best-effort",
			"detail.savings": "더 작은 목표값을 쓰고 오래된 도구 결과를 일찍 에이징. 매 요청이 저렴해지는 것은 보장하지 않음",
			"detail.adaptive": "Fresh / Aggregate는 밸런스와 동일. 직전 공식 usage와 현재 공식 가격이 이력 압축이 명확히 이득임을 증명할 때만 이력을 에이징하고, 그 외에는 보존",
			"detail.custom": "새 세션에 대해 구현된 압축 단계와 계측 임계값을 선택",
			"detail.native": "Harness 네이티브 헤드/테일 프루너만 사용",
			"detail.off": "결정론적 셀렉터를 비활성화. 네이티브 auto-compact는 Harness 설정을 따름",
			"autoCompact.title": "Auto Compact 트리거 수위",
			"autoCompact.description": "모델 구동 Auto Compact는 요청 사용량이 이 수위를 넘으면 발동합니다. 조정하면 스탠다드 프로필의 History 트리거, 최소 회수량, 최근 테일이 수위에 연동됩니다. 변경은 새 세션에만 적용됩니다.",
			"autoCompact.inputLabel": "Auto Compact 임계값(%)",
			"autoCompact.sliderLabel": "Auto Compact 임계값 슬라이더",
			"autoCompact.quick": "퀵 값",
			"autoCompact.riskLow": "권장 범위 미만: 이르게 발동하면 요약 호출과 접두사 재구축이 늘어납니다.",
			"autoCompact.riskHigh": "권장 범위 초과: 컨텍스트 용량은 요청과 출력이 공유합니다. 늦게 발동하면 단일 대형 출력·추론·도구 스키마의 여유가 줄어듭니다.",
			"autoCompact.invalid": "Auto Compact 임계값은 50–90 사이의 정수여야 합니다.",
			"autoCompact.save": "Auto Compact 임계값 저장",
			"autoCompact.summaryHint": "Auto Compact 임계값: {percent}%. 설정에서 변경할 수 있습니다.",
			"codeSkeleton.title": "코드 스켈레톤 압축(옵트인)",
			"codeSkeleton.description": "위 프로필들과 독립인 오토고널 스위치. 활성화하면 처음 노출된 초대형 소스 코드 도구 결과는 먼저 임포트와 선언을 남기는 스켈레톤(본문 생략, 오류 행 유지)을 시도하고, 실패 시 기존 헤드 프루닝으로 자동 폴백합니다. 정확한 토크나이저가 필요하며 변경은 새 세션에만 적용됩니다.",
			"codeSkeleton.enabled": "코드 스켈레톤 압축",
			"codeSkeleton.enabled.on": "켬",
			"codeSkeleton.enabled.off": "끔(기본값)",
			"intentSummary.title": "턴 말머리 인텐트 요약",
			"intentSummary.description": "켜면 턴 경계 포스트플라이트가 소비된 증분을 의미 역할별 인텐트 요약 블록으로 접습니다. 읽기 도구 결과는 목표/규모 한 줄 레코드가 되고 쓰기는 골격 헤더와 원문 오류 줄을 유지하며, 다음 압력 라운드에서 기존 접기 파이프라인을 통해 착지합니다. 성장 게이트(라이브 표면 >45%, 마지막 접기 이후 >50K 토큰 증가)를 통과할 때만 발동합니다. 새 세션에 적용되며, 현재 세션은 /ctx-summary off|on|status 로 임시 전환할 수 있습니다.",
			"intentSummary.enabled": "턴 말머리 인텐트 요약",
			"intentSummary.enabled.on": "켜기",
			"intentSummary.enabled.off": "끔(기본값)",
			"custom.title": "커스텀 정책",
			"custom.settingsHint": "세부 파라미터는 「설정 > 컨텍스트 압축 셀렉터」에서 편집하세요.",
			"custom.sessionScope": "저장된 변경 사항은 현재 압축 런타임이 Session을 처음 관측하는 시점에 적용됩니다. 해당 런타임이 이미 관측한 Session은 동결된 정책을 계속 사용합니다.",
			"custom.measurement": "정확한 DeepSeek 토크나이저를 우선 사용하고, 불가 시 보정된 tokenizer estimate로 폴백합니다. chars/4는 절대 사용하지 않습니다. 캐시 귀속은 여전히 불명입니다.",
			"custom.unit": "정규 단위",
			"custom.unit.tokens": "Tokens",
			"custom.unit.contextPercent": "컨텍스트 백분율",
			"custom.enabled": "활성화",
			"custom.enabled.on": "켬",
			"custom.enabled.off": "끔",
			"custom.fresh.enabled": "Fresh 활성화",
			"custom.fresh.trigger": "Fresh 트리거",
			"custom.fresh.target": "Fresh 목표값",
			"custom.aggregate.enabled": "Aggregate 활성화",
			"custom.aggregate.trigger": "Aggregate 트리거",
			"custom.aggregate.target": "Aggregate 목표값",
			"custom.history.enabled": "History 활성화",
			"custom.history.trigger": "History 트리거",
			"custom.history.keepRecentToolCalls": "보호하는 최근 도구 호출 수",
			"custom.history.keepRecentTokens": "보호하는 도구 결과 테일",
			"custom.history.minReclaim": "최소 회수량",
			"custom.prefixPolicy": "전송 접두사 정책",
			"custom.prefixPolicy.preserve": "용량 압박 시에만 변경",
			"custom.prefixPolicy.pressureBreak": "일반 이력 에이징 허용",
			"custom.experimental": "실험적: 다음 항목은 Custom 전용이며 표준 프로필에는 절대 추가되지 않습니다.",
			"custom.tailTrim.enabled": "TailTrim 활성화(실험적)",
			"custom.tailTrim.trigger": "TailTrim 트리거",
			"custom.tailTrim.warning": "TailTrim은 정확한 토크나이저를 필요로 하며, 완결되고 오류 없는 도구 전용 그룹 하나를 복구 가능한 참조로 대체합니다. History와 「보호하는 최근 도구 호출 수」「보호하는 도구 결과 테일」「최소 회수량」을 공유합니다. 전송 접두사를 재작성하므로 캐시 적중이 낮아질 수 있습니다.",
			"custom.save": "커스텀 정책 저장",
			"custom.reset": "커스텀 정책 초기화",
			"custom.invalid": "커스텀 정책 값이 올바르지 않습니다.",
			"savings.title": "절감 통계(이 프로세스)",
			"savings.netExact": "순 절감(정확 기준)",
			"savings.netEstimated": "순 절감(추정 기준)",
			"savings.gross": "총 절감(게시 시점)",
			"savings.offsets": "상쇄(압축 후 전체 재판돈)",
			"savings.empty": "아직 압축이 없습니다. 첫 번째 축소 후 순 절감이 표시됩니다.",
			"savings.basisExact": "정확",
			"savings.basisEstimated": "추정",
			"savings.basisNote": "기준은 분리 표기하며 혼합하지 않습니다: 정확 = DeepSeek 토크나이저, 추정 = chars/4. 스켈레톤 후 전체 판독은 음의 절감으로 계산됩니다(순액은 마이너스 가능)."
		};
		//#endregion
		//#region src/client/locales/ru.ts
		/** Russian copy matching every simplified Chinese selector key. */
		const ru = {
			"nav": "Выбор сжатия контекста",
			"settings.title": "Выбор сжатия контекста",
			"settings.description": "Выберите профиль сжатия для текущей сессии и настройте его параметры.",
			"label": "Сжатие контекста",
			"status.loading": "Загрузка",
			"status.unavailable": "Недоступно",
			"status.presetUnavailable": "Пресет этой сессии не предоставляет сжатие контекста, либо доступность пока не подтверждена.",
			"status.minimalUnavailable": "Минимальный режим не загружает сжатие контекста для этой сессии: селектор фактически выключен, действует нативное поведение Harness. Переключитесь на Standard, PTC / Coding, Creative или на поддерживающий её пользовательский пресет, чтобы настроить сжатие.",
			"status.saveFailed": "Не удалось сохранить. Повторите попытку.",
			"pricing.disclosure": "Официальные цены DeepSeek проверены 2026-08-25. Пиковые часы пн–пт 09:00–12:00 и 14:00–18:00 (Asia/Shanghai), остальное — непиковые. Для запросов на границе интервалов используется диапазон стоимости.",
			"profile.balanced": "Сбалансированный",
			"profile.cache-strict": "Cache Strict (защита префикса)",
			"profile.savings": "Экономия",
			"profile.adaptive": "Адаптивный (консервативная цена)",
			"profile.tokenpilot-inspired": "По мотивам TokenPilot",
			"estimator.title": "Оценщик (опционально)",
			"estimator.description": "Небольшая вспомогательная модель без примеров оценивает, вероятно ли старое чтение файла всё ещё востребовано; только рекомендация для старения истории. Без настройки или при сбое — режим только правил.",
			"estimator.mode": "Канал",
			"estimator.mode.off": "Выключен (только правила)",
			"estimator.mode.host": "Модель хоста (повторно использует настроенных провайдеров)",
			"estimator.mode.direct": "Прямой OpenAI-совместимый эндпоинт",
			"estimator.inactive": "Оценщик есть только у профиля «По мотивам TokenPilot»: пресет-опции этого профиля (указатели дедупликации, якоря резюме, семантика состояния чтения и канал оценщика) никогда не переносятся в другой профиль, поэтому у текущего профиля «{profile}» нет канала оценщика. Выберите «По мотивам TokenPilot» — в этом разделе появится выбор канала: настроенные провайдеры (модель хоста) или прямой OpenAI-совместимый эндпоинт.",
			"estimator.provider": "Провайдер",
			"estimator.provider.placeholder": "Пусто — следует модели по умолчанию сессии; выберите из списка или введите свой id",
			"estimator.model.placeholder": "Пусто — следует модели по умолчанию сессии; выберите из списка или введите свой id",
			"estimator.hostReuse": "Канал хоста повторно использует провайдеров и учётные данные, уже настроенные в DSH: ключ API не нужен — и здесь он не принимается.",
			"estimator.hostRoute": "Действующий маршрут: {route}.",
			"estimator.hostUnresolved": "пока не определено (выберите модель по умолчанию в настройках DSH или укажите здесь провайдера и модель)",
			"estimator.baseUrl": "Базовый URL эндпоинта (/v1)",
			"estimator.model": "Модель",
			"estimator.apiKey": "Ключ API (только запись, никогда не показывается)",
			"estimator.apiKey.placeholder": "Введите ключ эндпоинта; сохранение при выходе из поля",
			"estimator.apiKey.set": "Задан · введите новое значение, чтобы перезаписать",
			"estimator.apiKey.clear": "Очистить",
			"estimator.apiKey.overwrite": "Секрет сохранён; введите новое значение и выйдите из поля, чтобы перезаписать его.",
			"detail.tokenpilot-inspired": "Поверх «Сбалансированного»: указатели дедупликации, освобождение от восстановления, якоря резюме, стабилизация префикса и семантика состояния чтения; оценщику нужен отдельно настроенный эндпоинт",
			"profile.custom": "Пользовательский / Экспериментальный",
			"profile.native": "Нативная база",
			"profile.off": "Плагин выключен",
			"profile.current": "Текущий профиль",
			"detail.balanced": "Детерминированно сокращает свежие результаты инструментов; старые устаревают при высоком уровне заполнения",
			"detail.cache-strict": "Устаревание отправленной истории только при подтверждённой нехватке ёмкости; попадания в кэш провайдера остаются best-effort",
			"detail.savings": "Меньшие целевые значения и более раннее устаревание старых результатов инструментов; более дешёвый запрос не гарантирован",
			"detail.adaptive": "Использует Fresh/Aggregate «Сбалансированного»; история устаревает, только если соседний официальный usage и текущие официальные цены доказывают явную экономию",
			"detail.custom": "Выберите реализованные этапы и измеренные пороги для новых сессий",
			"detail.native": "Только нативная обрезка начала/конца Harness",
			"detail.off": "Отключает детерминированный селектор; нативный auto-compact настраивается отдельно",
			"autoCompact.title": "Уровень срабатывания Auto Compact",
			"autoCompact.description": "Управляемый моделью Auto Compact срабатывает, когда занятость запроса превышает этот уровень. Пороги History стандартного профиля, минимальное освобождение и недавний хвост следуют за уровнем; изменения касаются только новых сессий.",
			"autoCompact.inputLabel": "Порог Auto Compact (%)",
			"autoCompact.sliderLabel": "Ползунок порога Auto Compact",
			"autoCompact.quick": "Быстрые значения",
			"autoCompact.riskLow": "Ниже рекомендуемого диапазона: раннее срабатывание увеличивает вызовы резюмирования и перестройки префикса.",
			"autoCompact.riskHigh": "Выше рекомендуемого диапазона: ёмкость контекста делится между запросами и выводом, позднее срабатывание сокращает запас для одиночных больших выводов, рассуждений и схем инструментов.",
			"autoCompact.invalid": "Порог Auto Compact должен быть целым числом от 50 до 90.",
			"autoCompact.save": "Сохранить порог Auto Compact",
			"autoCompact.summaryHint": "Порог Auto Compact: {percent}%. Можно изменить в настройках.",
			"codeSkeleton.title": "Скелетное сжатие кода (по включению)",
			"codeSkeleton.description": "Отдельный переключатель, независимый от профилей выше. Когда включено, слишком большой свежий результат инструмента с исходным кодом сначала пробует скелет, сохраняющий импорты и объявления (тела опущены, строки ошибок сохранены), а при неудаче возвращается к исходной обрезке головы. Нужен точный токенизатор; касается только новых сессий.",
			"codeSkeleton.enabled": "Скелетное сжатие кода",
			"codeSkeleton.enabled.on": "Вкл",
			"codeSkeleton.enabled.off": "Выкл (по умолчанию)",
			"intentSummary.title": "Итог намерения в конце хода",
			"intentSummary.description": "При включении постфлайт на границе хода сворачивает потреблённый прирост в блоки итогов намерения по семантическим ролям: результаты читающих инструментов становятся однострочными записями цель/масштаб, пишущие сохраняют заголовок скелета и дословные строки ошибок; приземляется в следующем раунде давления через обычный конвейер свёртки. Срабатывает только при прохождении шлюза роста (активная поверхность >45% и >50K токенов с последней свёртки). Действует на новые сессии; текущую можно переключить командой /ctx-summary off|on|status.",
			"intentSummary.enabled": "Итог намерения в конце хода",
			"intentSummary.enabled.on": "Вкл",
			"intentSummary.enabled.off": "Выкл (по умолчанию)",
			"custom.title": "Пользовательская стратегия",
			"custom.settingsHint": "Подробные параметры — в «Настройки > Выбор сжатия контекста».",
			"custom.sessionScope": "Сохранённые изменения применяются, когда текущий runtime сжатия впервые наблюдает Session. Session, уже наблюдаемая этим runtime, сохраняет свою замороженную стратегию.",
			"custom.measurement": "Сначала точный токенизатор DeepSeek; иначе оценка токенизатором с калибровкой как запасной вариант. Никогда chars/4. Атрибуция кэша остаётся неизвестной.",
			"custom.unit": "Каноническая единица",
			"custom.unit.tokens": "Токены",
			"custom.unit.contextPercent": "Проценты контекста",
			"custom.enabled": "Включено",
			"custom.enabled.on": "Вкл",
			"custom.enabled.off": "Выкл",
			"custom.fresh.enabled": "Включить Fresh",
			"custom.fresh.trigger": "Порог Fresh",
			"custom.fresh.target": "Цель Fresh",
			"custom.aggregate.enabled": "Включить Aggregate",
			"custom.aggregate.trigger": "Порог Aggregate",
			"custom.aggregate.target": "Цель Aggregate",
			"custom.history.enabled": "Включить History",
			"custom.history.trigger": "Порог History",
			"custom.history.keepRecentToolCalls": "Защищённые недавние вызовы инструментов",
			"custom.history.keepRecentTokens": "Защищённый недавний хвост результатов инструментов",
			"custom.history.minReclaim": "Минимальное освобождение",
			"custom.prefixPolicy": "Политика отправленного префикса",
			"custom.prefixPolicy.preserve": "Сохранять до нехватки ёмкости",
			"custom.prefixPolicy.pressureBreak": "Разрешить обычное старение истории",
			"custom.experimental": "Экспериментально: эти настройки только для пользовательского профиля и никогда не добавляются в стандартные.",
			"custom.tailTrim.enabled": "Включить TailTrim (экспериментально)",
			"custom.tailTrim.trigger": "Порог TailTrim",
			"custom.tailTrim.warning": "TailTrim требует точный токенизатор и заменяет максимум одну полную, завершённую, без ошибок группу только из инструментов на восстанавливаемую ссылку. Он использует общие с History защищённые недавние вызовы инструментов, защищённый недавний хвост результатов инструментов и минимальное освобождение. Он переписывает отправленный префикс и может снизить попадания в кэш.",
			"custom.save": "Сохранить пользовательскую стратегию",
			"custom.reset": "Сбросить пользовательскую стратегию",
			"custom.invalid": "Значения пользовательской стратегии недопустимы.",
			"savings.title": "Экономия (этот процесс)",
			"savings.netExact": "Чистая экономия (точная база)",
			"savings.netEstimated": "Чистая экономия (оценочная база)",
			"savings.gross": "Валовая экономия (при публикации)",
			"savings.offsets": "Компенсации (сжатый контент затем прочитан полностью)",
			"savings.empty": "Сжатия пока не было — чистая экономия появится после первого сокращения.",
			"savings.basisExact": "точно",
			"savings.basisEstimated": "оценка",
			"savings.basisNote": "Базы приводятся раздельно и не смешиваются: точно = токенизатор DeepSeek; оценка = chars/4. Скелет с последующим полным чтением учитывается как отрицательная экономия (чистая может уйти в минус)."
		};
		//#endregion
		//#region src/client/preset-options.ts
		/** The namespace key holding every tokenpilot-inspired sub-capability override. */
		const PRESET_OPTIONS_KEY = "presetOptions";
		/** Every field a patch may address, in the schema's own order. The retired
		*  review-gate keys are deliberately absent: nothing writes them any more, and
		*  a stored document that still carries them is tolerated by the decoders. */
		const PRESET_OPTION_KEYS = [
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
			"advisorMode",
			"advisorTimeoutMs",
			"advisorRefreshTurns",
			"advisorScoreThreshold",
			"advisorSampleLimit",
			"advisorMinTokens"
		];
		/**
		* Plan the path ops one patch needs against the section currently stored.
		*
		* Fields already at their requested value produce no op, so a re-selected
		* value neither rewrites the document nor reports a save the Host never
		* committed.
		*
		* @param current - the decoded `presetOptions` section, when one is stored.
		* @param patch - the fields to write or clear.
		* @returns the ordered ops, empty when the patch changes nothing.
		*/
		function planPresetOptionsOps(current, patch) {
			const stored = current;
			const ops = [];
			for (const key of PRESET_OPTION_KEYS) {
				if (!Object.hasOwn(patch, key)) continue;
				const value = patch[key];
				const path = [PRESET_OPTIONS_KEY, key];
				if (value === void 0) {
					if (stored?.[key] !== void 0) ops.push({
						op: "unset",
						path
					});
					continue;
				}
				if (stored?.[key] === value) continue;
				ops.push({
					op: "set",
					path,
					value
				});
			}
			return ops;
		}
		/**
		* Test whether one resolved settings document already carries every planned op.
		*
		* @param settings - the resolved namespace section after a write.
		* @param ops - the ops that write submitted.
		* @returns whether every named field holds its requested state.
		*/
		function presetOptionsOpsAccepted(presetOptions, ops) {
			if (ops.length === 0) return true;
			if (presetOptions === void 0) return false;
			const stored = presetOptions;
			return ops.every((op) => {
				const key = op.path[op.path.length - 1];
				if (key === void 0) return false;
				return op.op === "set" ? stored[key] === op.value : stored[key] === void 0;
			});
		}
		//#endregion
		//#region src/client/index.ts
		const inject = [
			"slots",
			"locale",
			"settingsScope"
		];
		const NS = "context-compression";
		function sameCustomPolicy(left, right) {
			if (left.version !== 3 || right.version !== 3) return false;
			return left.version === right.version && left.unit === right.unit && left.prefixPolicy === right.prefixPolicy && left.fresh.enabled === right.fresh.enabled && left.fresh.trigger === right.fresh.trigger && left.fresh.target === right.fresh.target && left.aggregate.enabled === right.aggregate.enabled && left.aggregate.trigger === right.aggregate.trigger && left.aggregate.target === right.aggregate.target && left.history.enabled === right.history.enabled && left.history.trigger === right.history.trigger && left.history.keepRecentToolCalls === right.history.keepRecentToolCalls && left.history.keepRecentTokens === right.history.keepRecentTokens && left.history.minReclaim === right.history.minReclaim && left.tailTrim.enabled === right.tailTrim.enabled && left.tailTrim.trigger === right.tailTrim.trigger;
		}
		function apply(ctx) {
			ctx.locale.register(NS, {
				zh,
				en
			});
			const languages = [
				{
					id: "de",
					label: "Deutsch",
					dict: de
				},
				{
					id: "es",
					label: "Español",
					dict: es
				},
				{
					id: "fr",
					label: "Français",
					dict: fr
				},
				{
					id: "it",
					label: "Italiano",
					dict: it
				},
				{
					id: "ja",
					label: "日本語",
					dict: ja
				},
				{
					id: "ko",
					label: "한국어",
					dict: ko
				},
				{
					id: "ru",
					label: "Русский",
					dict: ru
				}
			];
			for (const language of languages) try {
				ctx.locale.register(NS, language.id, language.dict);
				ctx.locale.addLanguage({
					id: language.id,
					label: language.label,
					fallback: "en"
				});
			} catch (error) {
				console.warn(`[dsh-context-compression-improved] locale "${language.id}" registration failed:`, error);
			}
			const injected = () => {
				const scope = ctx.settingsScope.bind({
					namespace: NS,
					decode: decodeSettings
				});
				const writeAndConfirm = async (write, accepts) => {
					const beforeRevision = scope.getSnapshot().revision;
					await write();
					const after = scope.getSnapshot();
					if (after.status !== "ready" || after.value === void 0 || after.revision === beforeRevision || !accepts(after.value)) throw new Error("Context compression settings were not saved.");
				};
				return {
					hooks: { compression: scope },
					select: (profile) => writeAndConfirm(() => scope.set("profile", profile), (settings) => settings.profile === profile),
					saveCustom: (custom) => writeAndConfirm(() => scope.set("custom", custom), (settings) => isCustomCompressionPolicy(settings.custom) && sameCustomPolicy(settings.custom, custom)),
					resetCustom: () => writeAndConfirm(() => scope.set("custom", structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY)), (settings) => isCustomCompressionPolicy(settings.custom) && sameCustomPolicy(settings.custom, DEFAULT_CUSTOM_COMPRESSION_POLICY)),
					saveAutoCompact: (thresholdPercent) => writeAndConfirm(() => scope.set("autoCompact", { thresholdPercent }), (settings) => settings.autoCompact.thresholdPercent === thresholdPercent),
					saveCodeSkeleton: (enabled) => writeAndConfirm(() => scope.set("codeSkeleton", { enabled }), (settings) => settings.codeSkeleton.enabled === enabled),
					saveIntentSummary: (enabled) => writeAndConfirm(() => scope.set("intentSummary", { enabled }), (settings) => settings.intentSummary.enabled === enabled),
					savePresetOptions: (options) => {
						const ops = planPresetOptionsOps(scope.getSnapshot().value?.presetOptions, options);
						if (ops.length === 0) return Promise.resolve();
						return writeAndConfirm(() => scope.mutate(ops), (settings) => presetOptionsOpsAccepted(settings.presetOptions, ops));
					}
				};
			};
			try {
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "context-compression",
					order: 17,
					label: () => ctx.locale.bind(NS)("nav"),
					locale: NS,
					inject: injected
				}, ContextCompressionSettingsSection));
			} catch (error) {
				console.warn("[dsh-context-compression-improved] settings.section 注册失败(新宿主已收编):", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
