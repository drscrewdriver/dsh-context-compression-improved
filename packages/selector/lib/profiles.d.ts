//#region src/profiles.d.ts
/** Public context-compression choices shared by the Host schema and browser selector. */
declare const COMPRESSION_PROFILES: readonly ["off", "native", "balanced", "cache-strict", "savings", "adaptive", "tokenpilot-inspired", "custom"];
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
  /** Auto Compact trigger captured with `profile` when the runtime first observes a Session. */
  autoCompact: AutoCompactSettings;
  /** Code-skeleton reducer gate captured independently of `profile`. */
  codeSkeleton: CodeSkeletonSettings;
  /** Optional tokenpilot-inspired sub-capability overrides (presence-validated only). */
  presetOptions?: PresetOptionsSettings;
}
//#endregion
export { PresetOptionsSettings as i, ContextCompressionSettings as n, CustomCompressionPolicy as r, CompressionProfile as t };