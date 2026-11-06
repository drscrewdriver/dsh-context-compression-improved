//#region src/profiles.d.ts
/** Public context-compression choices shared by the Host schema and browser selector. */
declare const COMPRESSION_PROFILES: readonly ["off", "native", "balanced", "cache-strict", "savings", "adaptive", "tokenpilot-inspired", "ptc", "custom"];
/** One supported context-compression profile. */
type CompressionProfile = typeof COMPRESSION_PROFILES[number];
/** Single canonical unit stored by a version-1 browser Custom document. */
type CustomCompressionUnit = 'tokens' | 'context-percent';
/** Whether Custom History may routinely rewrite an already-sent prefix. */
type CustomPrefixPolicy = 'preserve' | 'pressure-break';
/** Browser representation of one independently enabled Fresh or Aggregate budget. */
interface CustomCompressionBudget {
  enabled: boolean;
  trigger: number;
  target: number;
}
/** Legacy browser representation of the Custom History working set. */
interface LegacyCustomHistoryPolicy {
  enabled: boolean;
  trigger: number;
  keepRecentTurns: number;
  keepRecent: number;
  minReclaim: number;
}
/** Browser representation of Custom History tool-call and token-tail protection. */
interface CustomHistoryPolicy {
  enabled: boolean;
  trigger: number;
  keepRecentToolCalls: number;
  keepRecentTokens: number;
  minReclaim: number;
}
/** Browser representation of the Custom-only Experimental TailTrim gate. */
interface CustomTailTrimPolicy {
  enabled: boolean;
  trigger: number;
}
interface CustomCompressionPolicyCommon<HistoryPolicy> {
  unit: CustomCompressionUnit;
  fresh: CustomCompressionBudget;
  aggregate: CustomCompressionBudget;
  history: HistoryPolicy;
  prefixPolicy: CustomPrefixPolicy;
}
/** Legacy public Custom document; accepted and normalized before editing. */
interface CustomCompressionPolicyV1 extends CustomCompressionPolicyCommon<LegacyCustomHistoryPolicy> {
  version: 1;
}
/** Legacy Custom document with a default-disabled TailTrim stage. */
interface CustomCompressionPolicyV2 extends CustomCompressionPolicyCommon<LegacyCustomHistoryPolicy> {
  version: 2;
  tailTrim: CustomTailTrimPolicy;
}
/** Public Custom document with tool-call working-set protection. */
interface CustomCompressionPolicyV3 extends CustomCompressionPolicyCommon<CustomHistoryPolicy> {
  version: 3;
  tailTrim: CustomTailTrimPolicy;
}
/** Exact public Custom document accepted by the Host and browser boundary. */
type CustomCompressionPolicy = CustomCompressionPolicyV1 | CustomCompressionPolicyV2 | CustomCompressionPolicyV3;
/** User-tunable Auto Compact coordination preferences. */
interface AutoCompactSettings {
  thresholdPercent: number;
}
/**
 * Orthogonal code-skeleton reducer gate, mirrored browser-safe from the
 * runtime: independent of every profile, default off.
 */
interface CodeSkeletonSettings {
  enabled: boolean;
}
/**
 * Orthogonal turn-tail intent-summary gate, mirrored browser-safe from the
 * runtime: independent of every profile, default off.
 */
interface IntentSummarySettings {
  enabled: boolean;
}
/** Floating compression-monitor panel (FAB); visibility switch. */
interface MonitorPanelSettings {
  enabled: boolean;
}
/**
 * Orthogonal turn-tail sedimentation gate (plan cci-sedimentation-triage,
 * R1/R13): whole-turn atomic replacement primary, span as the oversized-turn
 * split and cache-strict fallback granularity. Default OFF; absent inherits
 * the off defaults exactly like `monitorPanel`. Session-frozen like every
 * selector setting: edits affect newly observed sessions only.
 */
interface SedimentSettings {
  enabled: boolean;
  /** Replacement granularity; `span` also serves as the cache-strict fallback. */
  granularity: 'turn' | 'span';
  /** Closing-summary qualification floor (tokens); below it the three-tier narrative fallback engages (R13). */
  minClosingTokens: number;
  /** Rewrite guard: a cut must save at least tail-rewrite × ratio (community 1:15 evidence, findings F2). */
  rewriteGuardRatio: number;
  /** Upper bound for one whole-turn replacement span before it splits (oversized turns). */
  maxTurnSpanTokens: number;
  /**
   * Append-only extra failure-signal patterns (R2 extension slot). Merging
   * NEVER replaces the built-in base set; invalid regex entries reject the
   * whole section (never silently dropped).
   */
  extraSignalPatterns?: string[];
}
/** Browser-safe mirror of the runtime presetOptions section. */
interface PresetOptionsSettings {
  readonly dedupeToolResults?: boolean;
  readonly summaryLocator?: boolean;
  readonly prefixStabilizer?: boolean;
  readonly readState?: boolean;
  readonly estimatorMode?: '' | 'host' | 'direct';
  readonly estimatorProvider?: string;
  readonly estimatorModel?: string;
  readonly estimatorBaseUrl?: string;
  readonly estimatorApiKey?: string;
  readonly estimatorTimeoutMs?: number;
  /** Advisory advisor channel; `''` (the default) keeps the advisor off. */
  readonly advisorMode?: '' | 'host' | 'direct';
  readonly advisorTimeoutMs?: number;
  readonly advisorRefreshTurns?: number;
  readonly advisorScoreThreshold?: number;
  readonly advisorSampleLimit?: number;
  readonly advisorMinTokens?: number;
}
/** Durable settings section owned by this package. */
interface ContextCompressionSettings {
  /** Default profile captured when each Session first reaches the pruner. */
  profile: CompressionProfile;
  /** Complete canonical policy captured with `profile` when the runtime first observes a Session. */
  custom: CustomCompressionPolicy;
  /** PTC profile's own editable policy, seeded from the ptc defaults; independent of `custom`. Optional like `monitorPanel`/`presetOptions`: schema-defaulted, always present after parse. */
  ptcCustom?: CustomCompressionPolicy;
  /** Auto Compact trigger captured with `profile` when the runtime first observes a Session. */
  autoCompact: AutoCompactSettings;
  /** Code-skeleton reducer gate captured independently of `profile`. */
  codeSkeleton: CodeSkeletonSettings;
  /** Turn-tail intent-summary gate captured independently of `profile`. */
  intentSummary: IntentSummarySettings;
  /** Floating compression-monitor panel (FAB); absent inherits hidden. */
  monitorPanel?: MonitorPanelSettings;
  /** Turn-tail sedimentation gate (plan cci-sedimentation-triage); absent inherits the off defaults. */
  sediment?: SedimentSettings;
  /** Optional tokenpilot-inspired sub-capability overrides (presence-validated only). */
  presetOptions?: PresetOptionsSettings;
}
//#endregion
export { PresetOptionsSettings as i, ContextCompressionSettings as n, CustomCompressionPolicy as r, CompressionProfile as t };