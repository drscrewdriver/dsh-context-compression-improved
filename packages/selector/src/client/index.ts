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
  // 设置 → 插件 → 上下文压缩卡片。槽名随宿主版本演变：0.1.5-rc.2 的 SlotMap
  // 声明 `settings.plugins.tab`，0.1.2/0.1.3 叫 `settings.plugin.item`。未声明槽
  // 的注册会在激活期抛错，故 inject 调用与工厂体都各自 try/catch，任一失败不
  // 影响另一处（双槽冗余同 dsh-prime-memory；id+key 双写兼容 Desktop list 与
  // CLI keyed 两种槽声明，同 dsh-thinking-levels）。
  const registerSettingsCard = (slotName: 'settings.plugins.tab' | 'settings.plugin.item'): void => {
    try {
      ctx.slots.inject(slotName, () => {
        try {
          return ctx.slots.register({
            name: slotName,
            id: NS,
            key: NS,
            order: 17,
            label: () => ctx.locale.bind(NS)('nav'),
            locale: NS,
            inject: injected,
          }, ContextCompressionSettingsSection)
        } catch (error) {
          console.warn(`[dsh-context-compression-improved] ${slotName} 注册失败(宿主未声明该槽):`, error)
          return () => {}
        }
      })
    } catch (error) {
      console.warn(`[dsh-context-compression-improved] ${slotName} 注入失败(宿主未声明该槽):`, error)
    }
  }
  registerSettingsCard('settings.plugins.tab')
  registerSettingsCard('settings.plugin.item')

  // 设置 → 上下文压缩 直挂分节（0.1.1 契约；0.1.5 官方分节也注册在此，未声明槽
  // 的注册会在激活期抛错，故 try/catch 守卫 —— 同 dsh-prime-memory 的双槽冗余）
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
}

export type {
  CompressionProfile, CompressionProfileSelectorProps, CompressionSelectorInjected,
  ContextCompressionSettings,
} from './CompressionProfileSelector.tsx'
