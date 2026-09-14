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
      .toBe('>=0.1.5-rc.2 <0.2.0-0')
    expect(selector.peerDependencies?.['@deepseek-ai/dsh-command-compact'])
      .toBe('>=0.1.5-rc.2 <0.2.0-0')
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
    expect(rootManifest.dependencies?.['js-yaml']).toBe('^4.2.0')
    expect(rootManifest.dsh?.bundle?.patch).toBe('./packages/selector/cordis.patch.yml')
    expect(rootManifest.dsh?.client?.inject).toEqual([
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-settings',
    ])
    expect(rootManifest.engines?.dsh).toBe('>=0.1.5-alpha.1 <0.2.0-0')
  })

  it('uses the community package in the one Bundle patch', () => {
    const patch = readFileSync(resolve(root, 'selector/cordis.patch.yml'), 'utf8')
    expect(patch).toContain("name: 'dsh-context-compression-improved'")
    expect(patch).not.toContain('@deepseek-ai/dsh-client-ui-context-compression-selector')
  })
})
