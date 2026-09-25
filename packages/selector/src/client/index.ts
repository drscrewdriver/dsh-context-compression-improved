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
import type { SettingsScope } from './scope-face.ts'

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
// apply until `locale` / `configForms` are provided, so registration can use
// them directly. Resolving them lazily via ctx.get() instead races the settings
// client's activation — on a loss the apply early-returned and EVERY settings
// entry silently vanished.
export const inject = ['slots', 'locale', 'configForms']
const NS = 'context-compression'

/** 0.1.7: the profile entry whose config carries the compression settings doc. */
const ENTRY_ID = 'context-compression-improved-bundle'

/** The configForms face this client consumes (structural; 0.1.7 ui-settings). */
interface ConfigFormsFace {
  get<T>(entryId: string): {
    getSnapshot(): {
      status: 'loading' | 'ready' | 'unavailable'
      value: T | undefined
      revision: number | undefined
      writable: boolean
      base: unknown
      user: unknown
      mode: 'host' | 'memory'
    }
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<boolean>
    unset(field: string): Promise<boolean>
  }
}


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
    // 0.1.7: the compression document rides the selector row's entry config as
    // the volatile `settings` field. The form handle is fetched per factory
    // call on the caller's fiber (same activation rule as the old bind); the
    // wrapper below decodes the stored doc and converts per-field writes into
    // whole-doc commits (a volatile object replaces as one snapshot).
    const form = ctx.configForms.get<Record<string, unknown>>(ENTRY_ID)
    const readDoc = (): ContextCompressionSettings | undefined =>
      decodeSettings(form.getSnapshot().value?.settings)
    const scope: SettingsScope<ContextCompressionSettings> = {
      getSnapshot() {
        const snap = form.getSnapshot()
        return {
          status: snap.status,
          value: readDoc(),
          revision: snap.revision,
          writable: snap.writable,
          base: snap.base,
          user: snap.user,
          mode: snap.mode,
        }
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
