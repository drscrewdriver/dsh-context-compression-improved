import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')

describe('standalone package contract', () => {
  it('ships one install-facing package with no intra-repo dependency edge', () => {
    const selector = JSON.parse(readFileSync(resolve(root, 'selector/package.json'), 'utf8')) as {
      name: string
      version: string
      private?: boolean
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      publishConfig?: { tag?: string }
    }
    expect(selector.name).toBe('dsh-context-compression-improved')
    // Two directories carry this package name. Only the repository root may ever
    // be published: `publishConfig.tag: latest` still sits here (the release gate
    // reads it), so without `private` a publish from packages/selector would
    // silently take over the real dist-tag of the installed package.
    expect(selector.private).toBe(true)
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
      files?: string[]
      exports?: Record<string, unknown>
      dependencies?: Record<string, string>
      engines?: Record<string, string>
      dsh?: { bundle?: { patch?: string }, client?: { inject?: string[] } }
    }
    expect(rootManifest.name).toBe('dsh-context-compression-improved')
    // The packed surface is the install surface for every git install. With no
    // `files` field npm shipped the whole checkout — src/, tests/, .githooks/,
    // CI workflows, the dev scripts and the nested duplicate manifest — inside
    // the plugin the Host actually loads.
    expect(rootManifest.files).toBeDefined()
    for (const pattern of [
      'packages/selector/lib',
      'packages/selector/assets',
      'packages/selector/cordis.patch.yml',
    ]) {
      expect(rootManifest.files).toContain(pattern)
    }
    for (const pattern of ['src', 'tests', '.githooks', '.github', 'scripts']) {
      expect(
        rootManifest.files?.some(entry => entry === pattern || entry.startsWith(`${pattern}/`)),
      ).toBe(false)
    }
    for (const specifier of ['.', './invariant', './pruner', './client']) {
      expect(rootManifest.exports?.[specifier]).toBeDefined()
    }
    expect(rootManifest.dependencies?.['@huggingface/tokenizers']).toBe('0.1.3')
    expect(rootManifest.dependencies?.['js-yaml']).toBe('^4.3.2')
    expect(rootManifest.dsh?.bundle?.patch).toBe('./packages/selector/cordis.patch.yml')
    // `ui-primitives` joined the list in 9871de1 (the browser bundle requires
    // it); this assertion kept the pre-change shape.
    expect(rootManifest.dsh?.client?.inject).toEqual([
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-settings',
    ])
    // Tightened to rc.1 in 7b89621 (release 0.3.1), after this assertion was
    // written; the manifest is the owner, so the expectation follows it.
    expect(rootManifest.engines?.dsh).toBe('>=0.1.5-rc.1 <0.2.0-0')
  })

  it('uses the community package in the one Bundle patch', () => {
    const patch = readFileSync(resolve(root, 'selector/cordis.patch.yml'), 'utf8')
    expect(patch).toContain("name: 'dsh-context-compression-improved'")
    expect(patch).not.toContain('@deepseek-ai/dsh-client-ui-context-compression-selector')
  })

  it('keeps the two manifests that share this package name in step', () => {
    const selector = JSON.parse(readFileSync(resolve(root, 'selector/package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string }, client?: { inject?: string[] } }
    }
    const rootManifest = JSON.parse(readFileSync(resolve(root, '../package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string }, client?: { inject?: string[] } }
    }
    // The packed release E2E installs the SELECTOR tarball, so its `dsh` block is
    // load-bearing too — and it had drifted one entry behind the built client
    // bundle, which requires @deepseek-ai/dsh-client-ui-primitives.
    expect(selector.dsh?.client?.inject).toEqual(rootManifest.dsh?.client?.inject)
    expect(selector.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(rootManifest.dsh?.bundle?.patch).toBe('./packages/selector/cordis.patch.yml')
  })
})
