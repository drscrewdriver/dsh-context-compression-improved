import { Context } from "@deepseek-ai/cordis";
import "@deepseek-ai/dsh-settings/types";
import { SettingsScope } from "@deepseek-ai/dsh-client-ui-settings/client";
import { InjectFace, PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
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
//#region src/client/preset-options.d.ts
/** One partial edit of `presetOptions`; `undefined` clears the named field. */
type PresetOptionsPatch = { readonly [K in keyof PresetOptionsSettings]?: PresetOptionsSettings[K] | undefined; };
//#endregion
//#region src/client/locales.d.ts
/** Simplified Chinese copy for the context-compression selector. */
declare const zh: {
  nav: string;
  'settings.title': string;
  'settings.description': string;
  label: string;
  'status.loading': string;
  'status.unavailable': string;
  'status.presetUnavailable': string;
  'status.minimalUnavailable': string;
  'status.saveFailed': string;
  'pricing.disclosure': string;
  'profile.balanced': string;
  'profile.cache-strict': string;
  'profile.savings': string;
  'profile.adaptive': string;
  'profile.tokenpilot-inspired': string;
  'estimator.title': string;
  'estimator.description': string;
  'estimator.mode': string;
  'estimator.mode.off': string;
  'estimator.mode.host': string;
  'estimator.mode.direct': string;
  'estimator.inactive': string;
  'estimator.provider': string;
  'estimator.provider.placeholder': string;
  'estimator.model.placeholder': string;
  'estimator.hostReuse': string;
  'estimator.hostRoute': string;
  'estimator.hostUnresolved': string;
  'estimator.baseUrl': string;
  'estimator.model': string;
  'estimator.apiKey': string;
  'estimator.apiKey.placeholder': string;
  'estimator.apiKey.set': string;
  'estimator.apiKey.clear': string;
  'estimator.apiKey.overwrite': string;
  'detail.tokenpilot-inspired': string;
  'profile.custom': string;
  'profile.native': string;
  'profile.off': string;
  'profile.current': string;
  'detail.balanced': string;
  'detail.cache-strict': string;
  'detail.savings': string;
  'detail.adaptive': string;
  'detail.custom': string;
  'detail.native': string;
  'detail.off': string;
  'autoCompact.title': string;
  'autoCompact.description': string;
  'autoCompact.inputLabel': string;
  'autoCompact.sliderLabel': string;
  'autoCompact.quick': string;
  'autoCompact.riskLow': string;
  'autoCompact.riskHigh': string;
  'autoCompact.invalid': string;
  'autoCompact.save': string;
  'autoCompact.summaryHint': string;
  'codeSkeleton.title': string;
  'codeSkeleton.description': string;
  'codeSkeleton.enabled': string;
  'codeSkeleton.enabled.on': string;
  'codeSkeleton.enabled.off': string;
  'custom.title': string;
  'custom.settingsHint': string;
  'custom.sessionScope': string;
  'custom.measurement': string;
  'custom.unit': string;
  'custom.unit.tokens': string;
  'custom.unit.contextPercent': string;
  'custom.enabled': string;
  'custom.enabled.on': string;
  'custom.enabled.off': string;
  'custom.fresh.enabled': string;
  'custom.fresh.trigger': string;
  'custom.fresh.target': string;
  'custom.aggregate.enabled': string;
  'custom.aggregate.trigger': string;
  'custom.aggregate.target': string;
  'custom.history.enabled': string;
  'custom.history.trigger': string;
  'custom.history.keepRecentToolCalls': string;
  'custom.history.keepRecentTokens': string;
  'custom.history.minReclaim': string;
  'custom.prefixPolicy': string;
  'custom.prefixPolicy.preserve': string;
  'custom.prefixPolicy.pressureBreak': string;
  'custom.experimental': string;
  'custom.tailTrim.enabled': string;
  'custom.tailTrim.trigger': string;
  'custom.tailTrim.warning': string;
  'custom.save': string;
  'custom.reset': string;
  'custom.invalid': string;
};
/** Locale keys that every context-compression selector dictionary must provide. */
type ContextCompressionLocaleKey = keyof typeof zh;
//#endregion
//#region src/client/CompressionProfileSelector.d.ts
interface CompressionSelectorInjected {
  hooks: {
    compression: SettingsScope<ContextCompressionSettings>;
  };
  select: (profile: CompressionProfile) => Promise<void>;
  saveCustom: (custom: CustomCompressionPolicy) => Promise<void>;
  resetCustom: () => Promise<void>;
  saveAutoCompact: (thresholdPercent: number) => Promise<void>;
  saveCodeSkeleton: (enabled: boolean) => Promise<void>;
  /** Patch of `presetOptions` members; an explicit `undefined` clears that field. */
  savePresetOptions: (options: PresetOptionsPatch) => Promise<void>;
}
/**
 * Owner-agnostic panel props: the same component registers under the 0.1.5
 * `settings.plugins.tab` card (no owner props) and the legacy
 * `settings.section` page (whose shell supplies `close`), so the section
 * owner share stays optional.
 */
type CompressionProfileSelectorProps = {
  close?: () => void;
} & PropsLocale<'context-compression'> & InjectFace<CompressionSelectorInjected>;
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'context-compression': ContextCompressionLocaleKey;
  }
}
//#endregion
//#region src/client/index.d.ts
/**
 * Harness 0.1.5 mounts the web core's `slots` service on the client context
 * but no longer ships a public type for it; declare the face this plugin
 * consumes (same shape dsh-thinking-levels and dsh-prime-memory rely on).
 * `inject` factories may be sync (return a disposer) or generator (yield the
 * registration); slot options are validated at runtime per slot kind, which
 * lets one entry supply both `id` (Desktop, list) and `key` (CLI, keyed).
 */
interface SlotsService {
  inject(slot: string, register: () => (() => void) | Generator<() => void>): () => void;
  register(options: Record<string, unknown>, component: unknown): () => void;
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: SlotsService;
  }
}
declare const inject: string[];
declare function apply(ctx: Context): void;
//#endregion
export { type CompressionProfile, type CompressionProfileSelectorProps, type CompressionSelectorInjected, type ContextCompressionSettings, apply, inject };