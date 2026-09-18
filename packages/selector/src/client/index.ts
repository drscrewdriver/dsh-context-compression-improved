import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  isCustomCompressionPolicy,
  ContextCompressionSettingsSection,
  type CompressionSelectorInjected, type ContextCompressionSettings,
} from './CompressionProfileSelector.tsx'
import { DEFAULT_CUSTOM_COMPRESSION_POLICY } from '../profiles.ts'
import { decodeSettings } from './decode.ts'
import { en, zh } from './locales.ts'
import { planPresetOptionsOps, presetOptionsOpsAccepted } from './preset-options.ts'
import { renderReviewOverlay } from './ReviewOverlay.tsx'

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

// Declare all consumed services (the official client-plugin pattern, and the
// shape dsh-thinking-levels proves on this same 0.1.5 host line): cordis holds
// apply until `locale` / `settingsScope` are provided, so registration can use
// them directly. Resolving them lazily via ctx.get() instead races the settings
// client's activation — on a loss the apply early-returned and EVERY settings
// entry (the standalone section, the plugins-tab card, the item card) silently
// vanished.
export const inject = ['slots', 'locale', 'settingsScope']
const NS = 'context-compression'


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
  const injected = (): CompressionSelectorInjected => {
    // Bind per factory call on the caller's fiber (0.1.5: activation must
    // never block on the settings transport; the scope disposer belongs to
    // the calling registration's lifecycle).
    const scope = ctx.settingsScope.bind<ContextCompressionSettings>({ namespace: NS, decode: decodeSettings })
    const writeAndConfirm = async (
      write: () => Promise<void>,
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
      savePresetOptions: options => {
        // Path-addressed so one field write cannot delete its siblings: the
        // previous whole-section set erased estimatorMode (and every other
        // override) whenever the user touched a second field.
        const ops = planPresetOptionsOps(scope.getSnapshot().value?.presetOptions, options)
        if (ops.length === 0) return Promise.resolve()
        return writeAndConfirm(
          () => scope.mutate(ops),
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
      label: () => ctx.locale.bind(NS)('nav'),
      locale: NS,
      inject: injected,
    }, ContextCompressionSettingsSection))
  } catch (error) {
    console.warn('[dsh-context-compression-improved] settings.section 注册失败(新宿主已收编):', error)
  }

  // TokenPilot-inspired R4：审查浮窗挂在 shell.overlay（dsh-tidychat 先例：
  // 该层默认点击穿透，卡片自持指针事件）。reviewMode 关闭或无 pending 时组件
  // 渲染 null —— 与 0.1.2 宿主（无此 slot）同构的降级语义：注册失败不影响设置卡。
  // （本文件是 .ts：元素构造在 ReviewOverlay.renderReviewOverlay，不能内联 JSX。）
  try {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register(
      { name: 'shell.overlay', id: 'context-compression-review' },
      () => {
        const scope = ctx.settingsScope.bind<ContextCompressionSettings>({ namespace: NS, decode: decodeSettings })
        return renderReviewOverlay(scope, ctx.locale.bind(NS) as (key: string) => string)
      },
    ))
  } catch (error) {
    console.warn('[dsh-context-compression-improved] shell.overlay 注册失败(宿主无浮层或已收编):', error)
  }
}

export type {
  CompressionProfile, CompressionProfileSelectorProps, CompressionSelectorInjected,
  ContextCompressionSettings,
} from './CompressionProfileSelector.tsx'
