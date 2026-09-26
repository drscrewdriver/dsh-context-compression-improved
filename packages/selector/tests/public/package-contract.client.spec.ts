import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')

describe('standalone package contract', () => {
  it('ships one install-facing package with no intra-repo dependency edge', () => {
    const selector = JSON.parse(readFileSync(resolve(root, 'selector/package.json'), 'utf8')) as {
      name: string
      version: string
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      publishConfig?: { tag?: string }
    }
    expect(selector.name).toBe('dsh-context-compression-improved')
    expect(selector.dependencies?.['@huggingface/tokenizers']).toBe('0.1.3')
    expect(Object.keys(selector.dependencies ?? {})).not.toContain('dsh-context-compression-improved-runtime')
    expect(Object.keys(selector.peerDependencies ?? {})).not.toContain('dsh-context-compression-improved-runtime')
    expect(Object.keys(selector.peerDependencies ?? {})).not.toContain('@deepseek-ai/dsh-compaction-tool-result-pruner')
    expect(selector.peerDependencies?.['@deepseek-ai/dsh-compaction-basic'])
      .toBe('>=0.1.7-rc.1 <0.2.0-0')
    expect(selector.peerDependencies?.['@deepseek-ai/dsh-command-compact'])
      .toBe('>=0.1.7-rc.1 <0.2.0-0')
    expect(selector.publishConfig?.tag).toBe('latest')
    expect(existsSync(resolve(root, '../runtime/package.json'))).toBe(false)
  })

  it('makes the repository root the one git install surface', () => {
    const rootManifest = JSON.parse(readFileSync(resolve(root, '../package.json'), 'utf8')) as {
      name: string
      exports?: Record<string, unknown>
      dependencies?: Record<string, string>
      engines?: Record<string, string>
      dsh?: { bundle?: { patch?: string }, client?: { inject?: string[] } }
    }
    expect(rootManifest.name).toBe('dsh-context-compression-improved')
    for (const specifier of ['.', './invariant', './pruner', './client']) {
      expect(rootManifest.exports?.[specifier]).toBeDefined()
    }
    expect(rootManifest.dependencies?.['@huggingface/tokenizers']).toBe('0.1.3')
    expect(rootManifest.dependencies?.['js-yaml']).toBe('^4.3.2')
    expect(rootManifest.dsh?.bundle?.patch).toBe('./packages/selector/cordis.patch.yml')
    expect(rootManifest.dsh?.client?.inject).toEqual([
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-settings',
    ])
    expect(rootManifest.engines?.dsh).toBe('>=0.1.7-rc.1 <0.1.8-0')
  })

  it('uses the community package in the one Bundle patch', () => {
    const patch = readFileSync(resolve(root, 'selector/cordis.patch.yml'), 'utf8')
    expect(patch).toContain("name: 'dsh-context-compression-improved'")
    expect(patch).not.toContain('@deepseek-ai/dsh-client-ui-context-compression-selector')
  })

  it('never ships a retired plugin config key in the Bundle patch', () => {
    // Negative control: the patch is loaded by the host and validated against
    // the plugin's own Config schema, but nothing tied the two together — so
    // the retired review gate's `reviewQueueRoute` survived in this file after
    // the key was removed from the schema, advertising a route that can never
    // register. A retired key must fail here instead of shipping quietly.
    //
    // The pin is on KEY-SETTING lines, not on the whole document: the comments
    // above the rows deliberately name the retired key while explaining why it
    // is gone, and prose must not be mistaken for configuration.
    const patch = readFileSync(resolve(root, 'selector/cordis.patch.yml'), 'utf8')
    const lines = patch.split('\n')
    for (const retired of ['reviewQueueRoute', 'reviewMode', 'reviewTimeoutTurns', 'reviewHighImpactTokens']) {
      const setsRetired = lines.find(line => new RegExp(`^\\s*${retired}\\s*:`).test(line))
      expect(setsRetired, `${retired} is still set in the Bundle patch`).toBeUndefined()
    }
    // And the live flag the routes row exists for is still wired.
    expect(patch).toContain('estimatorCatalogRoute: true')
  })
})
