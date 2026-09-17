import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
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
import { mergePresetOptionsPatch, presetOptionsEqual } from './preset-options.ts'
import { renderReviewOverlay } from './ReviewOverlay.tsx'

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
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-context-compression: dictionaries')
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
  const injected = (): CompressionSelectorInjected => ({
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
      // The section root is replaced by whatever is written there, so merge the
      // patch over the stored document: writing the bare patch deleted
      // estimatorMode (and every other override) on the next field edit.
      const current = scope.getSnapshot().value?.presetOptions
      const next = mergePresetOptionsPatch(current, options)
      if (presetOptionsEqual(current, next)) return Promise.resolve()
      return writeAndConfirm(
        () => scope.set('presetOptions', next),
        settings => presetOptionsEqual(settings.presetOptions, next),
      )
    },
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'context-compression',
    order: 17,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: injected,
  }, ContextCompressionSettingsSection))

  // TokenPilot-inspired R4：审查浮窗挂在 shell.overlay（dsh-tidychat 先例：
  // 该层默认点击穿透，卡片自持指针事件）。reviewMode 关闭或无 pending 时组件
  // 渲染 null；注册失败不影响设置卡。0.1.2 宿主的 slot 名联合未收录该浮层，
  // 与既有 namespace 同款 `as never` 窄化。
  try {
    ctx.slots.inject('shell.overlay' as never, () => ctx.slots.register(
      { name: 'shell.overlay', id: 'context-compression-review' } as never,
      () => renderReviewOverlay(scope, ctx.locale.bind(NS) as (key: string) => string),
    ))
  } catch (error) {
    console.warn('[dsh-context-compression-improved] shell.overlay 注册失败(宿主无浮层或已收编):', error)
  }
}

export type {
  CompressionProfile, CompressionProfileSelectorProps, CompressionSelectorInjected,
  ContextCompressionSettings,
} from './CompressionProfileSelector.tsx'
