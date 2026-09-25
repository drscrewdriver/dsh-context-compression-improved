import { i as PresetOptionsSettings, n as ContextCompressionSettings, r as CustomCompressionPolicy, t as CompressionProfile } from "./profiles.js";
import { Context } from "@deepseek-ai/cordis";
import "@deepseek-ai/dsh-settings/types";
import { InjectFace, PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
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
//#region src/client/scope-face.d.ts
/**
 * 0.1.7-rc.2 stopped exporting `SettingsScope` from
 * `@deepseek-ai/dsh-client-ui-settings/client`; the structural face the
 * selector consumes lives here instead (getSnapshot shape mirrors the 0.1.7
 * `ConfigFormSnapshot` minus the parts the components never read).
 */
interface SettingsScope<T> {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable';
    value: T | undefined;
    revision: number | undefined;
    writable: boolean;
    base: unknown;
    user: unknown;
    mode: 'host' | 'memory';
  };
  subscribe(listener: () => void): () => void;
  set(field: string, value: unknown): Promise<boolean>;
  unset(field: string): Promise<boolean>;
  mutate?(ops: readonly {
    path: readonly string[];
    op: string;
    value?: unknown;
  }[]): Promise<boolean>;
}
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