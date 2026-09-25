import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import {
  SettingsProvider,
  type SettingsNamespace,
} from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'
import type { OverlayableAgentPresets } from '../src/preset-overlay.ts'
import { LegacyNamespaceRegistrar } from './helpers/legacy-namespace.ts'

// 0.1.5 removed the settingsNamespace() wrapper; namespaces are validated at runtime.
const nsBrand = (value: string): SettingsNamespace => value as unknown as SettingsNamespace

let root: string | undefined
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class MemorySettings extends SettingsProvider {
  readonly writable = true
  private readonly stored: Record<string, unknown> = {}

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.stored))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.stored[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

class FakeAgentPresets extends Service implements OverlayableAgentPresets {
  constructor(ctx: Context, readonly preset: AgentPreset) {
    super(ctx, 'agentPresets')
  }

  async resolve(): Promise<AgentPreset> {
    return this.preset
  }

  async mount(_agentCtx: unknown): Promise<AgentPreset> {
    return await this.resolve()
  }

  async recompose(_agentCtx: unknown, _id: string): Promise<AgentPreset> {
    return await this.resolve()
  }

  async standingKeyFor(): Promise<string> {
    return (await this.resolve()).path
  }
}

async function sourcePreset(): Promise<AgentPreset> {
  root = await mkdtemp(join(tmpdir(), 'dsh-selector-host-overlay-'))
  const path = join(root, 'standard', 'agent.cordis.yml')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, "- id: persona\n  name: '/opt/preset/persona.js'\n")
  return { id: 'standard', trust: 'system', path }
}

describe('context compression selector Host preset integration', () => {
  it('decorates native composition only for the lifetime of the selector fiber', async () => {
    const preset = await sourcePreset()
    ctx = new Context()
    await ctx.plugin(MemorySettings).await()
  await ctx.plugin(LegacyNamespaceRegistrar).await()
    await ctx.plugin(FakeAgentPresets, preset).await()

    const selector = ctx.plugin({ apply: (child) => {
      apply(child, { presetOverlay: true })
    } })
    await selector.await()

    const service = ctx.agentPresets as unknown as OverlayableAgentPresets
    const mounted = await service.mount({})
    expect(mounted.path).not.toBe(preset.path)
    expect(await readFile(mounted.path, 'utf8')).toContain('id: tool-result-pruner')
    expect((await service.resolve()).path).toBe(preset.path)

    await selector.dispose()
    expect((await service.mount({})).path).toBe(preset.path)
  })

  it('0.1.7: duplicate Host rows own independent entry configs — one row\u2019s disposal never disturbs the other', async () => {
    const preset = await sourcePreset()
    ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(FakeAgentPresets, preset).await()

    const builtIn = ctx.plugin({ apply })
    await builtIn.await()

    const service = ctx.agentPresets as unknown as OverlayableAgentPresets
    expect((await service.mount({})).path).toBe(preset.path)

    // 0.1.7: there is no shared settings registration to lease — each row
    // carries its own compression doc on its entry config, so duplicate rows
    // cannot disturb each other and disposal is purely per row.
    const bundle = ctx.plugin({ apply: (child) => {
      apply(child, { presetOverlay: true, settings: { profile: 'cache-strict' } } as never)
    } })
    await bundle.await()

    const mounted = await service.mount({})
    expect(mounted.path).not.toBe(preset.path)
    expect((await service.recompose({}, 'standard')).path).toBe(mounted.path)

    // Disposing the non-overlay row never touches the overlay row's decoration
    // or its entry config.
    await builtIn.dispose()
    expect((await service.mount({})).path).toBe(mounted.path)

    await bundle.dispose()
    expect((await service.mount({})).path).toBe(preset.path)
  })

  it('writes the saved Auto Compact threshold into the generated compaction-basic composition', async () => {
    const preset = await sourcePreset()
    ctx = new Context()
    await ctx.plugin(MemorySettings).await()
  await ctx.plugin(LegacyNamespaceRegistrar).await()
    await ctx.plugin(FakeAgentPresets, preset).await()
    // A settings-owning row must register the namespace before the update.
    await ctx.plugin({ apply }).await()
    const namespace = nsBrand('context-compression')
    await ctx.settings.update(namespace, { autoCompact: { thresholdPercent: 73 } })

    const bundle = ctx.plugin({ apply: (child) => {
      apply(child, { presetOverlay: true })
    } })
    await bundle.await()

    const service = ctx.agentPresets as unknown as OverlayableAgentPresets
    const mounted = await service.mount({})
    const rendered = await readFile(mounted.path, 'utf8')
    expect(rendered).toContain('id: compaction-basic')
    expect(rendered).toContain('thresholdRatio: 0.73')
    // First-release retention stays pinned at 0.16 next to the threshold.
    expect(rendered).toContain('retainRatio: 0.16')
    // The SAME read feeds the runtime deployment config, so one generation
    // cannot split Auto Compact and micro compact across two thresholds.
    expect(rendered).toContain('id: tool-result-pruner')
    expect(rendered).toContain('autoCompactThresholdPercent: 73')
    await bundle.dispose()
  })

  it('defaults the generated threshold to 0.8 and keeps it absent from settings until saved', async () => {
    const preset = await sourcePreset()
    ctx = new Context()
    await ctx.plugin(MemorySettings).await()
  await ctx.plugin(LegacyNamespaceRegistrar).await()
    await ctx.plugin(FakeAgentPresets, preset).await()

    const bundle = ctx.plugin({ apply: (child) => {
      apply(child, { presetOverlay: true })
    } })
    await bundle.await()

    const service = ctx.agentPresets as unknown as OverlayableAgentPresets
    const rendered = await readFile((await service.mount({})).path, 'utf8')
    expect(rendered).toContain('thresholdRatio: 0.8')
    await bundle.dispose()
  })

  it('moves the standing composition generation when an equal-length threshold changes', async () => {
    const preset = await sourcePreset()
    ctx = new Context()
    await ctx.plugin(MemorySettings).await()
  await ctx.plugin(LegacyNamespaceRegistrar).await()
    await ctx.plugin(FakeAgentPresets, preset).await()
    // A settings-owning row must register the namespace before the update.
    await ctx.plugin({ apply }).await()
    const namespace = nsBrand('context-compression')
    await ctx.settings.update(namespace, { autoCompact: { thresholdPercent: 70 } })

    const bundle = ctx.plugin({ apply: (child) => {
      apply(child, { presetOverlay: true })
    } })
    await bundle.await()

    const service = ctx.agentPresets as unknown as OverlayableAgentPresets
    const first = await service.mount({})
    expect(await readFile(first.path, 'utf8')).toContain('thresholdRatio: 0.7')
    expect(await service.standingKeyFor()).toBe(first.path)

    // Same character length, different content: the generated identity and
    // standing composition generation must both move to the new threshold.
    await ctx.settings.update(namespace, { autoCompact: { thresholdPercent: 80 } })
    const second = await service.mount({})
    expect(second.path).not.toBe(first.path)
    expect(await readFile(second.path, 'utf8')).toContain('thresholdRatio: 0.8')
    expect(await service.standingKeyFor()).toBe(second.path)
    await bundle.dispose()
  })
})
