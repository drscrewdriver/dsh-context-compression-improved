/** Estimator catalog projection: never throws, selection precedence, inline errors. */

import { describe, expect, it } from 'vitest'
import {
  buildEstimatorCatalog, resolveHostRoute,
  type EstimatorCatalogDeps,
} from '../src/estimator-catalog.ts'

describe('resolveHostRoute', () => {
  it('prefers explicit overrides over the host default selection', () => {
    expect(resolveHostRoute({
      overrideProvider: 'p1',
      overrideModel: 'm1',
      currentSelection: () => ({ provider: 'p2', model: 'm2' }),
    })).toEqual({ provider: 'p1', model: 'm1' })
  })

  it('falls back to the host default selection when overrides are empty', () => {
    expect(resolveHostRoute({
      overrideProvider: '',
      overrideModel: '',
      currentSelection: () => ({ provider: 'p2', model: 'm2' }),
    })).toEqual({ provider: 'p2', model: 'm2' })
  })

  it('fills missing override fields from the selection, per field', () => {
    expect(resolveHostRoute({ overrideProvider: 'p1', currentSelection: () => ({ model: 'm2' }) }))
      .toEqual({ provider: 'p1', model: 'm2' })
  })

  it('reports undefined when neither source yields a complete route', () => {
    expect(resolveHostRoute({ currentSelection: () => ({ provider: 'p' }) })).toBeUndefined()
    expect(resolveHostRoute({})).toBeUndefined()
  })
})

describe('buildEstimatorCatalog', () => {
  it('lists every provider with its models and never throws on one broken group', async () => {
    const llm = {
      listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }, { id: 'broken', name: 'Broken' }],
      listModels: async (providerId: string) => {
        if (providerId === 'broken') throw new Error('adapter offline')
        return [{ id: 'm1', name: 'Model 1' }]
      },
    }
    const catalog = await buildEstimatorCatalog({ llm })
    expect(catalog.providers).toHaveLength(2)
    expect(catalog.providers[0]).toEqual({ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'm1', name: 'Model 1' }] })
    expect(catalog.providers[1]?.error).toBe('adapter offline')
  })

  it('uses route discovery when listModels is absent or silent', async () => {
    const llm: NonNullable<EstimatorCatalogDeps['llm']> = {
      listProviders: () => [{ id: 'self-hosted', name: 'Self hosted' }],
      listConfigurableProviders: () => [{ provider: 'self-hosted', settingsNs: 'llm.self-hosted' }],
      discoverModels: async () => [{ id: 'm9' }],
    }
    const catalog = await buildEstimatorCatalog({ llm })
    expect(catalog.providers[0]?.models).toEqual([{ id: 'm9', name: 'm9' }])
    expect(catalog.providers[0]?.error).toBeUndefined()
  })

  it('returns the host selection even when the llm service is unavailable', async () => {
    const catalog = await buildEstimatorCatalog({
      currentSelection: () => ({ provider: 'p', model: 'm' }),
    })
    expect(catalog.providers).toEqual([])
    expect(catalog.selection).toEqual({ provider: 'p', model: 'm' })
  })
})
