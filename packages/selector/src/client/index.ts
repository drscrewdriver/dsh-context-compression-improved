import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { createElement, useSyncExternalStore } from 'react'
import {
  isCustomCompressionPolicy,
  ContextCompressionSettingsSection,
  type CompressionSelectorInjected, type ContextCompressionSettings,
} from './CompressionProfileSelector.tsx'
import { DEFAULT_CUSTOM_COMPRESSION_POLICY } from '../profiles.ts'
import { decodeSettings } from './decode.ts'
import { initMonitorFab } from './monitor-fab.ts'
import { en, zh } from './locales.ts'
import { de } from './locales/de.ts'
import { es } from './locales/es.ts'
import { fr } from './locales/fr.ts'
import { it } from './locales/it.ts'
import { ja } from './locales/ja.ts'
import { ko } from './locales/ko.ts'
import { ru } from './locales/ru.ts'
import { planPresetOptionsOps, presetOptionsOpsAccepted } from './preset-options.ts'
import type { ScopeSnapshot, SettingsScope } from './scope-face.ts'
import { createBridgeScope, type BridgeScope } from './bridge-scope.ts'

/**
 * Harness 0.1.5 mounts the web core's `slots` service on the client context
 * but no longer ships a public type for it; declare the face this plugin
 * consumes (same shape dsh-thinking-levels and dsh-prime-memory rely on).
 * `inject` factories may be sync (return a disposer) or generator (yield the
 * registration); slot options are validated at runtime per slot kind, which
 * lets one entry supply both `id` (Desktop, list) and `key` (CLI, keyed).
 */
interface SlotsService {
  inject(slot: string, register: () => (() => void) | Generator<() => void>): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: SlotsService
  }
}

// compat-legacy 单版本（audit B8，实跑实证）：顶层 inject 只声明六线通用服务。
// 顶层放 `configForms` 会在 0.1.0–0.1.5 挂死激活（服务不存在），顶层放
// `settingsScope` 在 0.1.7-rc.1+ 同样挂死（0.1.7-rc.1 格 "waiting for service:
// settingsScope" 实证）。数据面选择改为双 scoped 臂：
//   - 桥传输（bridge-scope.ts）为默认——全代际可用的 HTTP 面；
//   - `configForms` scoped 臂在 0.1.7+ resolve 后把 scope 升级为原生
//     configForms 路径（volatile entry 字段的权威写）；
//   - `settingsScope` 臂已裁撤：Gate 0 实测 0.1.5 的 bind scope 永远
//     status:"unavailable"（写被拒），接了也是死代码。
export const inject = ['slots', 'locale']
const NS = 'context-compression'

/** 0.1.7: the profile entry whose config carries the compression settings doc. */
const ENTRY_ID = 'context-compression-improved-bundle'

function sameCustomPolicy(
  left: ContextCompressionSettings['custom'],
  right: ContextCompressionSettings['custom'],
): boolean {
  if (left.version !== 3 || right.version !== 3) return false
  return left.version === right.version
    && left.unit === right.unit
    && left.prefixPolicy === right.prefixPolicy
    && left.fresh.enabled === right.fresh.enabled
    && left.fresh.trigger === right.fresh.trigger
    && left.fresh.target === right.fresh.target
    && left.aggregate.enabled === right.aggregate.enabled
    && left.aggregate.trigger === right.aggregate.trigger
    && left.aggregate.target === right.aggregate.target
    && left.history.enabled === right.history.enabled
    && left.history.trigger === right.history.trigger
    && left.history.keepRecentToolCalls === right.history.keepRecentToolCalls
    && left.history.keepRecentTokens === right.history.keepRecentTokens
    && left.history.minReclaim === right.history.minReclaim
    && left.tailTrim.enabled === right.tailTrim.enabled
    && left.tailTrim.trigger === right.tailTrim.trigger
}

export function apply(ctx: ClientContext): void {
  ctx.locale.register(NS, { zh, en })
  // de/es/fr/it/ja/ko/ru are not host built-ins (`BuiltInLocaleId` is zh|en), so
  // their dictionaries ride the single-locale untyped register overload, and each
  // needs an `addLanguage` definition to become selectable — the catalog owns
  // setLocale and the Language settings row, and a definition's fallback chain
  // must end at English. Labels are self-described in their own language. One
  // occupied locale must not sink activation, hence the per-language guard (same
  // rationale as the slots.inject try/catch below).
  const languages = [
    { id: 'de', label: 'Deutsch', dict: de },
    { id: 'es', label: 'Español', dict: es },
    { id: 'fr', label: 'Français', dict: fr },
    { id: 'it', label: 'Italiano', dict: it },
    { id: 'ja', label: '日本語', dict: ja },
    { id: 'ko', label: '한국어', dict: ko },
    { id: 'ru', label: 'Русский', dict: ru },
  ] as const
  for (const language of languages) {
    try {
      ctx.locale.register(NS, language.id, language.dict)
      ctx.locale.addLanguage({ id: language.id, label: language.label, fallback: 'en' })
    } catch (error) {
      console.warn(`[dsh-context-compression-improved] locale "${language.id}" registration failed:`, error)
    }
  }
  // Section label translator, captured EAGERLY: the settings shell evaluates
  // `label()` during its own render; a lazy ctx.locale accessor inside the
  // thunk would throw there if `locale` ever left this module's inject list
  // (the search-index 0.5.3 family-tab incident). bind() returns a live
  // binder, so locale switches are still followed.
  const localeSvc = ctx.locale as { bind?: (n: string) => (key: string) => string } | undefined
  const tNav = localeSvc?.bind?.(NS) ?? ((key: string) => key)

/** Minimal configForms face (scoped sub-inject arm; 0.1.7+ hosts only). */
interface ConfigFormsHandle {
	get(entryId: string): { getSnapshot(): { status: string; value?: { settings?: unknown }; revision?: number | null; writable?: boolean; base?: unknown; user?: unknown; mode?: string }; subscribe(listener: () => void): () => void; set(field: string, value: unknown): Promise<boolean> }
	getSnapshot(): { status: string; value?: { settings?: unknown }; revision?: number | null; writable?: boolean; base?: unknown; user?: unknown; mode?: string }
	subscribe(listener: () => void): () => void
	set(field: string, value: unknown): Promise<boolean>
}
let configFormsHandle: ConfigFormsHandle | undefined

/** Last monitorPanel.enabled seen through whichever scope is current (FAB 读数缓存). */
let monitorPanelEnabledCache = false

/** 浮动监控面板(FAB): body 级幂等单例。enabled 读数走双臂 scope 的投影缓存。 */
let readMonitorPanelEnabled = (): boolean => monitorPanelEnabledCache
  // 浮动面板会话绑定:跟随输入栏座位的 inject 回调(裸 sessionId,pm longtask 同款)。
  let latestSessionId: string | undefined
  try {
    initMonitorFab({
    t: tNav,
    sessionIdOf: () => latestSessionId,
    enabledOf: () => readMonitorPanelEnabled(),
    fetchSnapshot: async (sessionId) => {
      const query = sessionId === undefined ? '' : `?sessionId=${encodeURIComponent(sessionId)}`
      const response = await fetch(`/api/dsh-context-compression-improved/monitor${query}`, { headers: { 'cache-control': 'no-cache' } })
      if (!response.ok) throw new Error(`monitor snapshot ${response.status}`)
      return await response.json() as Parameters<typeof initMonitorFab>[0]['fetchSnapshot'] extends (...args: never[]) => Promise<infer T> ? T : never
    },
    applyOverride: async (sessionId, action) => {
      const query = sessionId === undefined ? '' : `?sessionId=${encodeURIComponent(sessionId)}`
      await fetch(`/api/dsh-context-compression-improved/monitor${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
    },
    })
  } catch (error) {
    console.warn('[dsh-context-compression-improved] 监控浮动球挂载失败(不影响设置分节):', error)
  }
  // compat-legacy 双数据面（audit B8/Gate 0）：
  //   1) 桥 scope 立即建好并预热（全代际可用的 HTTP 面，apply 期即拉一次文档）；
  //   2) `configForms` scoped 臂在 0.1.7+ resolve 后接管为原生权威写路径。
  // 选择发生在 injected() 工厂调用时（宿主渲染期），届时两臂归属已定，无竞态。
  const bridgeScope = createBridgeScope()
  bridgeScope.refresh()
  const bridgeReadEnabled = (): boolean =>
    decodeSettings(bridgeScope.getSnapshot().value)?.monitorPanel?.enabled ?? false
  readMonitorPanelEnabled = (): boolean => (configFormsHandle === undefined ? bridgeReadEnabled() : monitorPanelEnabledCache)
  try {
    ctx.inject(['configForms'], (configFormsArg) => {
      // cordis passes the service's OWNER CONTEXT to inject callbacks (the
      // server-plane lease relies on the same convention: the service rides a
      // property of the delivered ctx). Taking the argument itself made
      // `get(ENTRY_ID)` a Context.get for an entry-shaped service name —
      // undefined, then `form.getSnapshot()` crashed and the host's slot
      // boundary abdicated the whole settings section (0.1.7 dead-cell,
      // measured). Resolve the service off the context; fall back to the raw
      // argument for test seams that hand the service directly.
      const svc = (configFormsArg as { configForms?: unknown } | undefined)?.configForms
      const face = (svc !== undefined && svc !== null ? svc : configFormsArg) as unknown as ConfigFormsHandle
      configFormsHandle = typeof face?.get === 'function' ? face : undefined
    })
  } catch (error) {
    console.warn('[dsh-context-compression-improved] configForms 臂挂载失败(桥面继续服务):', error)
  }

  /** configForms 原生 scope（0.1.7+）：volatile entry 字段权威写路径。 */
  const scopeFromConfigForms = (service: ConfigFormsHandle): SettingsScope<ContextCompressionSettings> => {
    // The arm receives the configForms SERVICE; the doc rides the entry form.
    const form = service.get(ENTRY_ID) as unknown as ConfigFormsHandle
    const readDoc = (): ContextCompressionSettings | undefined =>
      decodeSettings(form.getSnapshot().value?.settings)
    // useSyncExternalStore requires a getSnapshot that returns a STABLE
    // reference between changes — a fresh object per call is React error #185
    // (maximum update depth exceeded). Cache the projection keyed on the form
    // snapshot's identity: ConfigFormSnapshot is documented stable until the
    // next accepted change.
    let projectedSource: object | undefined
    let projected: ScopeSnapshot<ContextCompressionSettings> = {
      status: 'loading', value: undefined, revision: undefined,
      writable: false, base: undefined, user: undefined, mode: 'host',
    }
    return {
      getSnapshot() {
        const snap = form.getSnapshot()
        if (snap !== projectedSource) {
          projectedSource = snap
          projected = {
            status: (snap.status as ScopeSnapshot<ContextCompressionSettings>['status']) ?? 'loading',
            value: decodeSettings(snap.value?.settings),
            revision: snap.revision ?? undefined,
            writable: snap.writable ?? false,
            base: snap.base,
            user: snap.user,
            mode: (snap.mode as ScopeSnapshot<ContextCompressionSettings>['mode']) ?? 'host',
          }
        }
        monitorPanelEnabledCache = projected.value?.monitorPanel?.enabled ?? false
        return projected
      },
      subscribe: (listener) => form.subscribe(listener),
      set: async (field, value) => {
        const next = { ...(readDoc() ?? {}) } as Record<string, unknown>
        next[field] = value
        return form.set('settings', next)
      },
      unset: async (field) => {
        const next = { ...(readDoc() ?? {}) } as Record<string, unknown>
        delete next[field]
        return form.set('settings', next)
      },
      mutate: async (ops) => {
        const doc = { ...(readDoc() ?? {}) } as Record<string, unknown>
        for (const op of ops) {
          const [head, key] = op.path as [string, string]
          if (head !== 'presetOptions') return false
          const section = { ...((doc.presetOptions ?? {}) as Record<string, unknown>) }
          if (op.op === 'unset') delete section[key]
          else section[key] = (op as { value?: unknown }).value
          doc.presetOptions = section
        }
        return form.set('settings', doc)
      },
    }
  }

  const injected = (): CompressionSelectorInjected => {
    // 双臂选择：configForms 臂已 resolve（0.1.7+）→ 原生 scope；否则桥 scope
    // （0.1.0–0.1.5 的唯一活数据面，0.1.7+ resolve 前的过渡读也由它服务）。
    // 臂构建失败（宿主面漂移、entry 未服务等）回落桥面，绝不把分节炸成死格
    // —— 宿主槽边界的 abdicate 是整机退役，0.1.7 实测就是空白分节。
    let scope: SettingsScope<ContextCompressionSettings> = bridgeScope
    if (configFormsHandle !== undefined) {
      try {
        scope = scopeFromConfigForms(configFormsHandle)
      } catch (error) {
        console.warn('[dsh-context-compression-improved] configForms scope 构建失败(回落桥面):', error)
      }
    }
    const writeAndConfirm = async (
      write: () => Promise<unknown>,
      accepts: (settings: ContextCompressionSettings) => boolean,
    ): Promise<void> => {
      const beforeRevision = scope.getSnapshot().revision
      await write()
      const after = scope.getSnapshot()
      if (
        after.status !== 'ready'
        || after.value === undefined
        || after.revision === beforeRevision
        || !accepts(after.value)
      ) {
        throw new Error('Context compression settings were not saved.')
      }
    }
    return {
      hooks: { compression: scope },
      select: profile => writeAndConfirm(
        () => scope.set('profile', profile),
        settings => settings.profile === profile,
      ),
      saveCustom: custom => writeAndConfirm(
        () => scope.set('custom', custom),
        settings => isCustomCompressionPolicy(settings.custom)
          && sameCustomPolicy(settings.custom, custom),
      ),
      resetCustom: () => writeAndConfirm(
        () => scope.set('custom', structuredClone(DEFAULT_CUSTOM_COMPRESSION_POLICY)),
        settings => isCustomCompressionPolicy(settings.custom)
          && sameCustomPolicy(settings.custom, DEFAULT_CUSTOM_COMPRESSION_POLICY),
      ),
      saveAutoCompact: thresholdPercent => writeAndConfirm(
        () => scope.set('autoCompact', { thresholdPercent }),
        settings => settings.autoCompact.thresholdPercent === thresholdPercent,
      ),
      saveCodeSkeleton: enabled => writeAndConfirm(
        () => scope.set('codeSkeleton', { enabled }),
        settings => settings.codeSkeleton.enabled === enabled,
      ),
      saveIntentSummary: enabled => writeAndConfirm(
        () => scope.set('intentSummary', { enabled }),
        settings => settings.intentSummary.enabled === enabled,
      ),
      saveMonitorPanel: enabled => writeAndConfirm(
        () => scope.set('monitorPanel', { enabled }),
        settings => settings.monitorPanel?.enabled === enabled,
      ),
      savePresetOptions: options => {
        // Path-addressed so one field write cannot delete its siblings: the
        // previous whole-section set erased estimatorMode (and every other
        // override) whenever the user touched a second field.
        const ops = planPresetOptionsOps(scope.getSnapshot().value?.presetOptions, options)
        if (ops.length === 0) return Promise.resolve()
        return writeAndConfirm(
          () => scope.mutate?.(ops) ?? Promise.resolve(false),
          settings => presetOptionsOpsAccepted(settings.presetOptions, ops),
        )
      },
    }
  }
  // 设置 → 上下文压缩 直挂分节（0.1.1 契约；0.1.5 官方分节也注册在此，未声明槽
  // 的注册会在激活期抛错，故 try/catch 守卫 —— 同 dsh-prime-memory 的双槽冗余）。
  // 只挂这一处：再注册 `settings.plugins.tab` / `settings.plugin.item` 会在
  // 设置里同时出现独立分节和插件卡片，重复展示同一张面板。
  try {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'context-compression',
      order: 17,
      label: () => tNav('nav'),
      locale: NS,
      inject: injected,
    }, ContextCompressionSettingsSection))
  } catch (error) {
    console.warn('[dsh-context-compression-improved] settings.section 注册失败(新宿主已收编):', error)
  }

  // 输入栏左座(0.1.5+ 宿主):组件刻意空渲染——注册此座位只为接收宿主的
  // sessionId 注入回调,供浮动监控面板绑定会话(pm longtask 同款)。旧宿主
  // 未声明该槽时激活期会抛错,try/catch 守卫(同上双槽冗余先例)。
  try {
    ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
      name: 'conversation.input.left',
      id: 'context-compression-session-bind',
      order: 170,
      inject: (sessionId: string) => {
        latestSessionId = sessionId
        return {}
      },
    }, () => null))
  } catch (error) {
    console.warn('[dsh-context-compression-improved] conversation.input.left 注册失败(旧宿主无该槽,浮动面板保持聚合口径):', error)
  }

  // Bundle 详情页设置卡(0.1.7+):plugins.bundle.config keyed 槽,key=包名整卡平铺
  // (searxng compat-legacy 蓝本)。实测契约(0.1.7-rc.1 真机格):
  //   ①不能用 entry.inject —— 这条渲染链不带 hookContext,宿主不会把 inject 返回的
  //     hooks.compression 映射成组件的 useCompression,组件首帧
  //     `useCompression is not a function` 崩进 SlotErrorBoundary → entry 被
  //     abdicate 成 data-slot-error 死格,且 abdication 本会话粘滞不再重试;
  //   ②locale: NS 必须保留 —— 它是宿主标准包 t(localeSeat)的唯一来源;
  //   ③组件闭包自取 injected(),并把 hooks.compression 手工适配成 useCompression
  //     (useSyncExternalStore 包装)。读写仍走 configForms 原生臂(宿主桥)。
  // 老宿主无该槽 → 激活期抛错由 try/catch 吞掉,静默缺席。
  try {
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
      name: 'plugins.bundle.config',
      key: 'dsh-context-compression-improved',
      locale: NS,
    }, (props: { close?: () => void }) => {
      const inj = injected()
      const scope = inj.hooks?.compression
      const useCompression = <T,>(selector: (snapshot: ScopeSnapshot<ContextCompressionSettings>) => T): T => {
        if (!scope) return selector({ status: 'loading', value: undefined, revision: undefined, writable: false, base: undefined, user: undefined, mode: 'memory' })
        return useSyncExternalStore(
          scope.subscribe,
          () => selector(scope.getSnapshot()),
        )
      }
      return createElement(ContextCompressionSettingsSection, { ...inj, ...props, useCompression } as never)
    }))
  } catch (error) {
    console.warn('[dsh-context-compression-improved] plugins.bundle.config 注册失败(旧宿主无该槽,静默缺席):', error)
  }
}

export type {
  CompressionProfile, CompressionProfileSelectorProps, CompressionSelectorInjected,
  ContextCompressionSettings,
} from './CompressionProfileSelector.tsx'
