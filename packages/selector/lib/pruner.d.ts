import z from "@deepseek-ai/schemastery";
import { Context, Service } from "@deepseek-ai/cordis";
import { ContentBlock, ToolCallId } from "@deepseek-ai/dsh-llm";
import { Session } from "@deepseek-ai/dsh-session";
import { TokenMeasurement } from "@deepseek-ai/dsh-token-meter";
//#region src/runtime/types.d.ts
/** User-facing mixed strategy profile. */
declare const COMPRESSION_PROFILES: readonly ["off", "native", "balanced", "cache-strict", "savings", "adaptive", "tokenpilot-inspired", "custom"];
/** Public compression strategy selected for one Session. */
type CompressionProfile = typeof COMPRESSION_PROFILES[number];
/** When historical tool results may be aged for one Session policy. */
type HistoryMode = 'disabled' | 'routine' | 'capacity-pressure' | 'adaptive';
/** Canonical unit stored by one versioned Custom policy. */
type CustomCompressionUnit = 'tokens' | 'context-percent';
/** Whether routine History may rewrite a previously sent Harness prefix. */
type CustomPrefixPolicy = 'preserve' | 'pressure-break';
/** One independently selectable Custom Fresh or Aggregate stage. */
interface CustomCompressionBudget {
  enabled: boolean;
  trigger: number;
  target: number;
}
/** Legacy Custom History gate and turn/token working-set protection. */
interface LegacyCustomHistoryPolicy {
  enabled: boolean;
  trigger: number;
  keepRecentTurns: number;
  keepRecent: number;
  minReclaim: number;
}
/** Custom History gate and recent tool-call/token working-set protection. */
interface CustomHistoryPolicy {
  enabled: boolean;
  trigger: number;
  keepRecentToolCalls: number;
  keepRecentTokens: number;
  minReclaim: number;
}
/** Custom-only experimental TailTrim gate. */
interface CustomTailTrimPolicy {
  enabled: boolean;
  trigger: number;
}
/** TokenPilot-inspired preset sub-capability switches (only injected for `tokenpilot-inspired`). */
interface PresetOptions {
  /** Reject replacements whose text is not smaller than the original (G1). */
  readonly noNetSavingsGuard: boolean;
  /** Permanently exempt recovery content from further reduction (G2). */
  readonly skipReductionRecovery: boolean;
  /** Replace byte-identical repeated tool results with first-occurrence pointers (A1). */
  readonly dedupeToolResults: boolean;
  /** Append Exact Sources locator blocks after Auto Compact completes (A2). */
  readonly summaryLocator: boolean;
  /** Volatile-line demotion, deterministic tool ordering, and prefix fingerprint audit (S1/S2). */
  readonly prefixStabilizer: boolean;
  /** Fresh/superseded read-state classification with clustered omission markers (R2/R3). */
  readonly readState: boolean;
  /** Optional estimator channel; `''` keeps every estimator consumer on rule-only fallbacks (E1/E2). */
  readonly estimator: {
    readonly mode: '' | 'host' | 'direct';
  };
}
/** Common user-authored Custom stages shared by persisted policy versions. */
interface CustomCompressionPolicyFields<HistoryPolicy> {
  unit: CustomCompressionUnit;
  fresh: CustomCompressionBudget;
  aggregate: CustomCompressionBudget;
  history: HistoryPolicy;
  prefixPolicy: CustomPrefixPolicy;
}
/** Legacy R4 Custom policy, accepted without migration. */
interface CustomCompressionPolicyV1 extends CustomCompressionPolicyFields<LegacyCustomHistoryPolicy> {
  version: 1;
}
/** R5 Custom policy with an explicit default-off TailTrim stage. */
interface CustomCompressionPolicyV2 extends CustomCompressionPolicyFields<LegacyCustomHistoryPolicy> {
  version: 2;
  tailTrim: CustomTailTrimPolicy;
}
/** Custom policy with tool-call working-set protection. */
interface CustomCompressionPolicyV3 extends CustomCompressionPolicyFields<CustomHistoryPolicy> {
  version: 3;
  tailTrim: CustomTailTrimPolicy;
}
/** Strict persisted Custom policy union. */
type CustomCompressionPolicy = CustomCompressionPolicyV1 | CustomCompressionPolicyV2 | CustomCompressionPolicyV3;
/** User-tunable Auto Compact coordination preferences. */
interface AutoCompactSettings {
  /** Routed-context percentage that triggers model-driven Auto Compact. */
  thresholdPercent: number;
}
/**
 * Orthogonal evidence-based code-skeleton reducer gate. Independent of every
 * profile: when enabled, fresh oversized source-code results may take the
 * `hypa-code-skeleton` reducer before the head/tail fallbacks.
 */
interface CodeSkeletonSettings {
  enabled: boolean;
}
/**
 * Persisted sub-capability overrides for the `tokenpilot-inspired` preset.
 * Absent fields inherit the preset defaults; the section is only meaningful
 * while the resolved profile is `tokenpilot-inspired`.
 */
interface PresetOptionsSettings {
  readonly dedupeToolResults?: boolean;
  readonly summaryLocator?: boolean;
  readonly prefixStabilizer?: boolean;
  readonly readState?: boolean;
  readonly estimatorMode?: '' | 'host' | 'direct';
  /**
   * Estimator endpoint fields. Persisted-settings only: they never enter the
   * frozen CompressionPolicy, which is emitted verbatim by policy-resolved
   * audits, so the API key cannot leak into logs.
   */
  readonly estimatorProvider?: string;
  readonly estimatorModel?: string;
  readonly estimatorBaseUrl?: string;
  readonly estimatorApiKey?: string;
  readonly estimatorTimeoutMs?: number;
}
/** Durable global preference exposed through `ctx.settings`. */
interface ContextCompressionSettings {
  /** Default strategy snapped when a Session first reaches the pruner. */
  profile: CompressionProfile;
  /** Versioned Custom policy snapped with `profile` for a newly observed Session. */
  custom: CustomCompressionPolicy;
  /** Auto Compact trigger preference snapped with `profile` for a newly observed Session. */
  autoCompact: AutoCompactSettings;
  /** Code-skeleton reducer gate snapped independently of `profile`. */
  codeSkeleton: CodeSkeletonSettings;
  /** Optional tokenpilot-inspired sub-capability overrides; absent inherits preset defaults. */
  presetOptions?: PresetOptionsSettings;
}
/** Token-gated policy with character fields limited to reducer candidate shape. */
interface ToolResultPruneConfig {
  /** Composition fallback when Host settings are unavailable. Defaults to `balanced`. */
  profile?: CompressionProfile;
  /** Native fallback leading Unicode code points. Defaults to `4096`. */
  headChars?: number;
  /** Native fallback trailing Unicode code points. Defaults to `1024`. */
  tailChars?: number;
  /** Native original-content token trigger. Profile default when omitted. */
  nativeTriggerTokens?: number;
  /** Native replacement token target. Profile default when omitted. */
  nativeTargetTokens?: number;
  /** Fresh-result exact-token trigger. Profile default when omitted. */
  freshTriggerTokens?: number;
  /** Maximum fresh-result exact-token replacement size. Profile default when omitted. */
  freshTargetTokens?: number;
  /** Combined completed-step token pressure that starts aggregate reduction. */
  aggregateTriggerTokens?: number;
  /** Aggregate token target after completed-step pressure exceeds its trigger. */
  aggregateTargetTokens?: number;
  /** Total live tool-result tokens that permit historical aging. Profile default when omitted. */
  historyTriggerTokens?: number;
  /** Recent completed agent tool calls protected from historical aging. Profile default when omitted. */
  historyKeepRecentToolCalls?: number;
  /** Recent tool-result token tail protected in addition to tool calls. Profile default when omitted. */
  historyKeepRecentTokens?: number;
  /** Minimum reclaim required before historical aging is worth a cache break. Profile default when omitted. */
  historyMinReclaimTokens?: number;
  /**
   * Auto Compact threshold percent frozen into this deployment by the preset
   * overlay generation (50–90 integer). When present it supersedes the live
   * Host setting so one generation never splits Auto Compact and micro
   * compact across two thresholds.
   */
  autoCompactThresholdPercent?: number;
  /** Optional tokenpilot-inspired sub-capability overrides (deploy-level). */
  presetOptions?: PresetOptionsSettings;
}
/** Resolved per-profile behavior. */
interface CompressionPolicy {
  readonly profile: CompressionProfile;
  /** Whether this Session may use the selector's native-style head/middle/tail reducer. */
  readonly nativeToolResultEnabled: boolean;
  readonly freshEnabled: boolean;
  readonly aggregateEnabled: boolean;
  readonly historyMode: HistoryMode;
  readonly nativeTriggerTokens: number;
  readonly nativeTargetTokens: number;
  readonly freshTriggerTokens: number;
  readonly freshTargetTokens: number;
  readonly aggregateTriggerTokens: number;
  readonly aggregateTargetTokens: number;
  readonly historyTriggerTokens: number;
  readonly historyKeepRecentToolCalls: number;
  readonly historyKeepRecentTokens: number;
  readonly historyMinReclaimTokens: number;
  /**
   * Auto Compact token watermark `A = floor(C × a)` when the standard-profile
   * History linkage resolved for this Session; absent for Custom, Off, Native,
   * or unresolved routed capacity.
   */
  readonly autoCompactTokens?: number;
  /**
   * Micro-compact last-chance watermark `D = floor(A × 0.875)`. Absent when
   * {@link autoCompactTokens} is absent; capacity-pressure gates fall back to
   * the fixed 0.7 routed-context ratio in that case.
   */
  readonly microDeadlineTokens?: number;
  /** Present for Custom v3; standard profiles and legacy Custom policies carry no TailTrim policy. */
  readonly tailTrim?: {
    readonly enabled: boolean;
    readonly triggerTokens: number;
  };
  /**
   * TokenPilot-inspired sub-capability switches. Present only for the
   * `tokenpilot-inspired` preset; every other profile stays byte-identical.
   */
  readonly presetOptions?: PresetOptions;
}
/** Validated, detached, deeply immutable configuration. */
interface ResolvedConfig {
  readonly profile: CompressionProfile;
  readonly headChars: number;
  readonly tailChars: number;
  readonly nativeTriggerTokens?: number;
  readonly nativeTargetTokens?: number;
  readonly freshTriggerTokens?: number;
  readonly freshTargetTokens?: number;
  readonly aggregateTriggerTokens?: number;
  readonly aggregateTargetTokens?: number;
  readonly historyTriggerTokens?: number;
  readonly historyKeepRecentToolCalls?: number;
  readonly historyKeepRecentTokens?: number;
  readonly historyMinReclaimTokens?: number;
  /**
   * Auto Compact threshold percent frozen into this deployment by the preset
   * overlay generation (50-90 integer). Supersedes the live Host setting.
   */
  readonly autoCompactThresholdPercent?: number;
  /** Optional tokenpilot-inspired sub-capability overrides resolved from the deployment config. */
  readonly presetOptions?: PresetOptionsSettings;
}
/** Why a pruning pass runs. */
type PruneStage = 'fresh' | 'pressure';
/** Optional control over one pruning pass. */
interface PruneSessionOptions {
  /** `fresh` only reduces never-before-seen oversized results; `pressure` may age older results too. */
  stage?: PruneStage;
  /** Routed model context capacity used only to resolve a context-percent Custom snapshot. */
  contextWindowTokens?: number;
  /** Proposed turn at the pre-step boundary. Used with `freshStep` to freeze keep/reduce decisions. */
  freshTurn?: number;
  /** The immediately preceding completed step whose tool results have not yet entered a model request. */
  freshStep?: number;
}
/** Cited source event and size accounting for one landed surface replacement. */
interface PrunedEntry {
  /** Current surface event shadowed by this replacement. */
  readonly originalSeq: number;
  /** Root full-fidelity source event used in the recovery reference. */
  readonly sourceSeq: number;
  /** Newly appended compressed tool-result event. */
  readonly replacementSeq: number;
  /** Tool call shared by the original and replacement. */
  readonly callId: ToolCallId;
  /** Reducer or aging strategy that produced the replacement. */
  readonly reducer: string;
  /** Pass stage that landed the replacement. */
  readonly stage: PruneStage;
  /** Original deterministic pressure cost. */
  readonly charsBefore: number;
  /** Replacement deterministic pressure cost. */
  readonly charsAfter: number;
  /** Authoritative exact canonical content tokens before replacement. */
  readonly tokensBefore: number;
  /** Authoritative exact canonical content tokens after replacement. */
  readonly tokensAfter: number;
}
/** Aggregate outcome of one stable-surface pruning pass. */
interface PruneResult {
  /** Replacements in landing order. */
  readonly pruned: readonly PrunedEntry[];
  /** Total deterministic pressure cost removed across replacements. */
  readonly charsRemoved: number;
  /** Authoritative exact canonical content tokens removed. */
  readonly tokensRemoved: number;
}
//#endregion
//#region src/runtime/custom-policy.d.ts
/** Canonical Custom document accepted by Host settings and the runtime resolver. */
declare const CustomCompressionPolicySchema: z<CustomCompressionPolicy>;
/** Balanced-equivalent Custom policy stored as one token-canonical document. */
declare const DEFAULT_CUSTOM_COMPRESSION_POLICY: CustomCompressionPolicyV3;
/** Routed model facts needed only by context-percent Custom documents. */
interface CustomPolicyResolutionOptions {
  /** Positive resolved shared model context capacity. */
  readonly contextWindowTokens?: number;
  /**
   * Frozen Auto Compact threshold percent. Standard profiles use it to link
   * History watermarks to the Auto Compact level; Custom resolution ignores it
   * because Custom stays explicit-token manual.
   */
  readonly autoCompactThresholdPercent?: number;
}
/**
 * Resolve one validated Custom document to the same token policy used by public presets.
 * @param value - untrusted or typed Custom settings value.
 * @param options - routed model capacity for context-percent documents.
 * @returns a detached deeply immutable effective token policy.
 */
declare function resolveCustomPolicy(value: CustomCompressionPolicy, options?: CustomPolicyResolutionOptions): CompressionPolicy;
//#endregion
//#region src/runtime/config.d.ts
/** Settings namespace shared by the Host service and browser selector. */
declare const CONTEXT_COMPRESSION_SETTINGS_NAMESPACE = "context-compression";
/** Fixed native fallback marker. */
declare const PRUNE_MARKER = "\n\n[... tool result middle pruned ...]\n\n";
/**
 * The one Auto Compact threshold contract shared by the settings UI, the
 * persisted settings schema, and the runtime resolver. Every integer in the
 * range is valid and entered directly in the UI.
 */
declare const AUTO_COMPACT_THRESHOLD_LIMITS: {
  readonly min: 50;
  readonly max: 90;
  readonly step: 1;
  readonly default: 80;
};
/** Narrow one untrusted value to a valid Auto Compact threshold percent. */
declare function isValidAutoCompactThresholdPercent(value: unknown): value is number;
/**
 * Parse one settings document with the persisted-section semantics: `undefined`
 * inherits the defaults (an absent section), while `null` is an explicitly
 * invalid document and must never silently become the default policy.
 */
declare function parseContextCompressionSettings(value: unknown): ContextCompressionSettings;
/** Settings schema used by the user-facing profile selector. */
declare const ContextCompressionSettingsSchema: z<ContextCompressionSettings>;
/** Low-friction defaults; token budgets live in resolved profile policy. */
declare const DEFAULTS: ResolvedConfig;
/**
 * Count Unicode code points without splitting surrogate pairs.
 * @param text - text whose code points are counted.
 * @returns the number of Unicode code points.
 */
declare function codePointLength(text: string): number;
/**
 * Test whether a settings value names a supported compression profile.
 * @param value - untrusted settings value.
 * @returns whether the value is a supported compression profile.
 */
declare function isCompressionProfile(value: unknown): value is CompressionProfile;
/**
 * Resolve and validate plugin configuration.
 * @param config - optional composition overrides.
 * @returns a detached, deeply immutable configuration snapshot.
 */
declare function resolveConfig(config?: ToolResultPruneConfig): ResolvedConfig;
/**
 * Resolve one public profile into a complete mixed-strategy policy.
 * @param config - validated composition configuration.
 * @param profile - profile frozen for the target Session.
 * @param custom - versioned Custom document used only by the `custom` profile.
 * @param options - routed capacity and the frozen Auto Compact threshold used
 * to resolve context-percent Custom values and standard-profile linkage.
 * @returns the effective deterministic compression policy.
 */
declare function resolvePolicy(config: ResolvedConfig, profile: CompressionProfile, custom?: CustomCompressionPolicy, options?: CustomPolicyResolutionOptions): CompressionPolicy;
//#endregion
//#region src/runtime/reducers.d.ts
/** Deterministic, evidence-backed reducers for fresh tool results. */
/** Input shared by every fresh-result reducer. */
interface ReducerInput {
  readonly toolName: string;
  readonly argumentsText: string;
  readonly text: string;
  readonly budgetChars: number;
  readonly sourceRef: string;
  readonly isError: boolean;
  /**
   * Orthogonal user gate for the `hypa-code-skeleton` candidate. Absent or
   * false keeps source-code content on its existing head/tail reducers.
   */
  readonly codeSkeleton?: boolean;
}
/** One verified reducer candidate. */
interface ReducerOutput {
  readonly text: string;
  readonly reducer: string;
  readonly lossy: boolean;
}
/**
 * Select a reducer from verified tool, command, and content evidence.
 * @param input - original result text, recovery source, and output budget.
 * @returns a verified candidate, or `null` when every reducer fails open.
 */
declare function reduceFreshToolResult(input: ReducerInput): ReducerOutput | null;
/**
 * Build a recoverable placeholder for an old tool result.
 * @param input - tool identity, source reference, size, status, and retained evidence.
 * @returns a lossy placeholder that cites the immutable source event.
 */
declare function historicalPlaceholder(input: {
  readonly toolName: string;
  readonly sourceRef: string;
  readonly charsBefore: number;
  readonly isError: boolean;
  readonly text: string;
  readonly compact?: boolean;
}): ReducerOutput;
/**
 * Validate shrinkage, budget, recovery, and error retention.
 * @param input - original reducer input and its safety requirements.
 * @param output - candidate reduced text and reducer metadata.
 * @returns whether the candidate is safe to land.
 */
declare function verifyReduction(input: ReducerInput, output: ReducerOutput): boolean;
/**
 * Strip ANSI, collapse carriage-return progress redraws, and fold exact repeats.
 * @param text - raw terminal output.
 * @returns normalized terminal text.
 */
declare function normalizeTerminalText(text: string): string;
//#endregion
//#region src/runtime/token-count.d.ts
/** Token counts owned by the standalone compression runtime. */
/** Exact count of one canonical value under a pinned tokenizer artifact. */
interface ExactTokenizerTokenCount {
  readonly kind: 'exact-tokenizer';
  readonly tokens: number;
  readonly tokenizerId: string;
  readonly tokenizerRevision: string;
}
/** A value that the bundled tokenizer cannot safely count. */
interface UnavailableTokenCount {
  readonly kind: 'unavailable';
  readonly reason: string;
}
/** Best-effort estimate carrying a conservative upper value when available. */
interface TokenizerEstimateTokenCount {
  readonly kind: 'tokenizer-estimate';
  readonly tokens: number;
  readonly upperBoundTokens: number;
  readonly estimatorId: string;
  readonly estimatorRevision: string;
  readonly calibration?: Readonly<{
    readonly sampleCount: number;
    readonly conservativeMarginTokens: number;
  }>;
}
/** Exact, conservative request estimate, or an explicit refusal. */
type TokenCount = ExactTokenizerTokenCount | TokenizerEstimateTokenCount | UnavailableTokenCount;
//#endregion
//#region src/runtime/measurement.d.ts
/** Request identity retained only when every dimension is publicly known. */
interface ProviderMeasurementKey {
  readonly provider: string;
  readonly baseUrlClass: string;
  readonly apiRoute: string;
  readonly modelId: string;
  readonly requestTemplateRevision: string;
  readonly tokenizerRevision: string;
  readonly modality: string;
}
/** Rich request observation used by Adaptive when a future public API supplies it. */
interface ObservedPromptUsage {
  readonly attemptId: string;
  readonly providerRequestOrdinal: number;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly measurement: TokenCount;
  readonly observedPromptTokens: number;
  readonly observedOutputTokens?: number;
  readonly responseModelId?: string;
  readonly cacheStatus?: 'complete' | 'unknown';
  readonly cacheReadTokens?: number;
  readonly cacheMissTokens?: number;
  readonly key?: ProviderMeasurementKey;
}
/**
 * Intrinsic-grid diagnostic attached to nodes whose count estimates images.
 * It reports ONLY the official block
 * arithmetic evaluated on the attachment's intrinsic dimensions at the two
 * alignment-padding extremes (compress-pad 0 and 3). It is NOT a request-token
 * bound: the adapter may still re-project the image (per-route pixel-budget
 * or image-detail overrides, byte-cap reprojection), which can move the real
 * count below the diagnostic minimum. It never participates in exact gates,
 * rewrite proofs, or any lossy decision.
 */
interface IntrinsicImageBlockDiagnostic {
  readonly paddingMinimumTokens: number;
  readonly paddingMaximumTokens: number;
}
/** One same-revision surface node with exact, estimated, or unavailable count. */
interface MeasuredTokenSurfaceNode {
  readonly seq: number;
  readonly count: TokenCount;
  /** Intrinsic-grid diagnostic when usable image dimensions were available. */
  readonly intrinsicImageBlockEstimate?: IntrinsicImageBlockDiagnostic;
}
/** Compression view derived only from published Session and TokenMeter methods. */
interface CompactionTokenView extends TokenMeasurement {
  readonly providerRoute?: string;
  readonly modelId?: string;
  readonly measuredNodes: readonly MeasuredTokenSurfaceNode[];
  readonly currentSurface: TokenCount;
  /** Sum of per-node intrinsic padding minima; a diagnostic, not a token bound. */
  readonly intrinsicImageBlockEstimateTokens: number;
  readonly latestEnvelopeKey?: ProviderMeasurementKey;
  readonly lastCompletedUsage?: ObservedPromptUsage;
  countCanonicalText(text: string): TokenCount;
}
/**
 * Capture one route-bound view without calling patched Harness methods.
 * Official `measure()` remains authoritative for request pressure; the bundled
 * tokenizer supplies exact canonical content counts used by safe rewrites.
 */
declare function measureForCompaction(ctx: Context, session: Session): CompactionTokenView;
//#endregion
//#region src/pruner.d.ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    toolResultPruner: ToolResultPruner;
  }
}
/** Mixed deterministic selector behind the existing `ctx.toolResultPruner` seam. */
declare class ToolResultPruner extends Service {
  static inject: string[];
  static Config: z<ToolResultPruneConfig>;
  /** Resolved immutable deployment configuration. */
  readonly config: ResolvedConfig;
  /** Complete canonical setting document frozen when each Session first reaches this root service. */
  private readonly sessionSettings;
  /** Original result seqs whose first-exposure KEEP/REDUCE decision has committed. */
  private readonly firstExposure;
  /** Result seqs permanently exempt from further reduction (recovery outputs and registered equivalents). */
  private readonly recoveryExemptions;
  /** Per-session canonical-content hash index backing tokenpilot-inspired dedupe. */
  private readonly dedupeTables;
  /** Advisory estimator verdicts consumed by the read-state classification. */
  private readonly estimatorVerdicts;
  /** Per-session estimator failure backoff state. */
  private readonly estimatorFailures;
  /** Runtime prerequisite warnings deduplicated per Session and failure key. */
  private readonly warnedFailures;
  /** Last Adaptive postflight attempt emitted per Session; keeps diagnostics bounded and independent. */
  private readonly postflightDiagnostics;
  /** Current pre-step chain identity, shared by this producer and downstream compaction-basic. */
  private readonly activeRequestBoundaries;
  /** Boundary identity that already attempted one fully preflighted TailTrim publication. */
  private readonly tailTrimBoundaryAttempts;
  /** Last effective policy audit key emitted for each Session. */
  private readonly policyResolutionAudits;
  /**
   * Native summary manifest seqs already audited per Session. 0.1.5 commits
   * Native auto-compact by reopening the Session with a seed log, and seed
   * events never reach the `session/event` firehose, so summaries are audited
   * from a snapshot scan instead of the live event alone.
   */
  private readonly auditedNativeSummaries;
  constructor(ctx: Context, config?: ToolResultPruneConfig);
  /**
   * Measure text content in Unicode code points; non-text blocks cost zero.
   * @param blocks - tool-result content to measure.
   * @returns total Unicode code points across text blocks.
   */
  measureContent(blocks: readonly ContentBlock[]): number;
  private pressureCost;
  /**
   * Apply the configured native head/middle/tail transform.
   * @param blocks - original tool-result content.
   * @returns reduced content, or `null` when no reduction is required.
   */
  pruneContent(blocks: readonly ContentBlock[]): ContentBlock[] | null;
  /**
   * Run one stable-surface pass. `fresh` is invoked before every request and
   * only reduces original oversized results. `pressure` is called by
   * compaction-basic and may additionally age old results at one high-water.
   * @param session - session whose current tool-result surface may be rewritten.
   * @param options - pass stage and optional completed-step coordinates.
   * @returns landed replacements and aggregate Unicode-code-point savings.
   */
  pruneSession(session: Session, options?: PruneSessionOptions): PruneResult;
  private activeSettings;
  /**
   * TokenPilot-inspired A2: replace the compaction summary checkpoint node
   * with the same summary plus an Exact Sources locator block. Fails open:
   * any unresolved shape (no trace, no checkpoint node, already annotated)
   * leaves the summary untouched.
   */
  private attachSummaryLocator;
  /**
   * TokenPilot-inspired E1: sample oversized historical reads and ask the
   * auxiliary estimator whether their file state is still likely to be
   * referenced. Fire-and-forget: never awaited on the pruning chain, failures
   * back off exponentially per Session, verdicts only extend the rule-only
   * superseded classification.
   */
  private postflightEstimatorPass;
  private activePolicy;
  /** Routed provider/model when the durable request header names one route. */
  private routeAuditFact;
  /** Bundled tokenizer identity for one route, when the route is eligible. */
  private tokenizerAuditFact;
  private contextWindowForRequest;
  private runRequestBoundary;
  /** Resolve historical-aging authority without accepting caller-supplied elevation. */
  private historyAllowed;
  /**
   * Match the compaction-basic pressure gate using public durable data. The
   * frozen Auto Compact deadline `D = floor(A x 0.875)` replaces the legacy
   * fixed 0.7 ratio once the standard-profile linkage resolved; without
   * linkage the 0.7 ratio is the documented fallback and reproduces the
   * previous behavior.
   */
  private capacityPressureActive;
  /** Emit one bounded, independently correlatable postflight cost diagnostic per completed attempt. */
  private logAdaptivePostflight;
  /** Decide one already-planned History batch from adjacent request-level facts only. */
  private adaptiveHistoryAllowed;
  private latestCompletedToolStep;
  private decisions;
  /**
   * TokenPilot-style skipReduction: recovery tool output is permanently exempt
   * from every reduction pass so retrieved content can never enter a
   * compress-restore-oscillation loop. A call-name match covers the built-in
   * recovery tool; the per-session set admits future recovery paths.
   */
  private isRecoveryExempt;
  /** Register a result seq as permanently exempt from further reduction. */
  private grantRecoveryExemption;
  private decideFreshStep;
  private snapshot;
  private planNative;
  /**
   * TokenPilot-inspired A1: replace a byte-identical repeat of an earlier
   * oversized tool result with a pointer to its first occurrence. The first
   * occurrence's hash is always recorded so later repeats can point at the
   * append-only original event even after the surface copy is reduced.
   */
  private planDedupe;
  private planFresh;
  private planAggregate;
  /** Preserve bounded diagnostic evidence whenever an all-text error is reduced. */
  private planErrorEvidence;
  private isError;
  private historyOutcome;
  private planHistoricalAging;
  private protectedHistoryResultSeqs;
  /** Select the newest completed tool calls and token tail for History-derived stages. */
  private protectedHistoryCandidateSeqs;
  /** Atomically replace at most one oldest safe completed tool-call group. */
  private landOldestTailTrimGroup;
  private reserveTailTrimBoundaryAttempt;
  private uniqueAppendRoot;
  private plan;
  private land;
  private landAll;
  private hasRecoveryTool;
  private auditHistoryEvaluation;
  private auditComponent;
  /** Emit the native-auto-compact audit for one summary manifest, once. */
  private emitNativeSummaryAudit;
  /**
   * 0.1.5 commits Native auto-compact by reopening the Session with a seed
   * log; seed events never reach the `session/event` firehose, so scan the
   * snapshot for summary manifests the live listener could not observe.
   */
  private scanForSeededNativeSummary;
  private auditFailure;
  private auditPublicationFailure;
  private warnExactUnavailable;
  private warnOnce;
  /** Surface replacements are durable turn work; reject before writing the audit half. */
  private hasOpenTurn;
  private rootToolResultSeq;
  private sourceRef;
  private nativePruneContent;
}
//#endregion
export { AUTO_COMPACT_THRESHOLD_LIMITS, type AutoCompactSettings, COMPRESSION_PROFILES, CONTEXT_COMPRESSION_SETTINGS_NAMESPACE, type CodeSkeletonSettings, type CompactionTokenView, type CompressionPolicy, type CompressionProfile, type ContextCompressionSettings, ContextCompressionSettingsSchema, type CustomCompressionBudget, type CustomCompressionPolicy, CustomCompressionPolicySchema, type CustomCompressionPolicyV1, type CustomCompressionPolicyV2, type CustomCompressionPolicyV3, type CustomCompressionUnit, type CustomHistoryPolicy, type CustomPolicyResolutionOptions, type CustomPrefixPolicy, type CustomTailTrimPolicy, DEFAULTS, DEFAULT_CUSTOM_COMPRESSION_POLICY, type HistoryMode, type MeasuredTokenSurfaceNode, PRUNE_MARKER, type PruneResult, type PruneSessionOptions, type PruneStage, type PrunedEntry, type ResolvedConfig, type ToolResultPruneConfig, ToolResultPruner, ToolResultPruner as default, codePointLength, historicalPlaceholder, isCompressionProfile, isValidAutoCompactThresholdPercent, measureForCompaction, normalizeTerminalText, parseContextCompressionSettings, reduceFreshToolResult, resolveConfig, resolveCustomPolicy, resolvePolicy, verifyReduction };