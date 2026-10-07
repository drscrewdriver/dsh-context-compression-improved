/**
 * compat narrow-waist unit tests: tool-result triple view, legacy source-kind
 * escape, generation probe, and the settings lease no-op on modern hosts.
 */
import { describe, expect, it } from 'vitest'
import { viewToolResult, compressionMessageSource } from '../../src/compat/tool-result.ts'
import { detectHostGeneration, resetHostGenerationCache, noteResolvedSettingsService, hostGenerationSnapshot } from '../../src/compat/host-generation.ts'
import { acquireSettingsLease } from '../../src/compat/settings-lease.ts'

const MODERN_TOOL_RESULT = {
	content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }],
	isError: true,
	toolCallId: 'call-modern',
}

const LEGACY_TOOL_RESULT = {
	content: [{
		type: 'tool-result',
		content: [{ type: 'text', text: 'legacy body' }],
		isError: true,
	}],
	source: { callId: 'call-legacy' },
}

describe('viewToolResult (three-axis envelope adapter)', () => {
	it('reads the flat modern shape', () => {
		const view = viewToolResult(MODERN_TOOL_RESULT, 'modern')
		expect(view.blocks).toHaveLength(2)
		expect(view.isError).toBe(true)
		expect(view.callId).toBe('call-modern')
	})

	it('reads the enveloped legacy shape (strict signature overrides the flag)', () => {
		const view = viewToolResult(LEGACY_TOOL_RESULT, 'modern')
		expect(view.blocks).toEqual([{ type: 'text', text: 'legacy body' }])
		expect(view.isError).toBe(true)
		expect(view.callId).toBe('call-legacy')
	})

	it('honors the legacy flag when the signature check is inconclusive', () => {
		const loose = {
			content: [{ something: 'else' }],
			source: { callId: 'call-loose' },
		}
		const view = viewToolResult(loose, 'legacy')
		expect(view.blocks).toEqual([{ something: 'else' }])
		expect(view.callId).toBe('call-loose')
	})

	it('keeps the modern axes on an inconclusive modern message', () => {
		const view = viewToolResult(MODERN_TOOL_RESULT, 'legacy')
		expect(view.blocks).toEqual(MODERN_TOOL_RESULT.content)
		expect(view.isError).toBe(true)
		expect(view.callId).toBe('call-modern')
	})

	it('never throws on absent fields', () => {
		const view = viewToolResult({}, 'modern')
		expect(view.blocks).toEqual([])
		expect(view.isError).toBe(false)
		expect(view.callId).toBeUndefined()
	})
})

describe('compressionMessageSource (legacy kind escape)', () => {
	it('returns the per-producer kind on modern hosts', () => {
		expect(compressionMessageSource('modern')).toEqual({ kind: 'dsh-context-compression' })
	})

	it('escapes to the shared plugin kind on legacy hosts', () => {
		const source = compressionMessageSource('legacy')
		expect(source.kind).toBe('plugin')
		expect((source as { plugin?: string }).plugin).toBe('dsh-context-compression-improved')
	})
})

describe('detectHostGeneration (capability probe)', () => {
	it('classifies a register-capable settings service as legacy', () => {
		resetHostGenerationCache()
		expect(detectHostGeneration({ get: (name) => (name === 'settings' ? { register: () => ({}) } : undefined) })).toBe('legacy')
	})

	it('classifies a register-less settings service as modern', () => {
		resetHostGenerationCache()
		expect(detectHostGeneration({ get: (name) => (name === 'settings' ? { describe: () => [] } : undefined) })).toBe('modern')
	})

	it('defaults to modern when the settings service is absent', () => {
		resetHostGenerationCache()
		expect(detectHostGeneration({ get: () => undefined })).toBe('modern')
		resetHostGenerationCache()
	})

	it('does not cache the provisional verdict taken while the service is absent', () => {
		// Measured on the real 0.1.0-rc.2 cell: rows compose before the host
		// settings service, and the old probe cached that absence as 'modern'
		// forever — the legacy lease arm went dead on the line it was built for.
		resetHostGenerationCache()
		expect(detectHostGeneration({ get: () => undefined })).toBe('modern')
		// Later evidence (the settings inject callback) must still flip it.
		expect(noteResolvedSettingsService({ register: () => ({}) })).toBe('legacy')
	})

	it('noteResolvedSettingsService overrides even a definitive earlier verdict', () => {
		resetHostGenerationCache()
		expect(detectHostGeneration({ get: () => ({ describe: () => [] }) })).toBe('modern')
		expect(noteResolvedSettingsService({ register: () => ({}) })).toBe('legacy')
		expect(hostGenerationSnapshot()).toBe('legacy')
	})

	it('hostGenerationSnapshot defaults to modern without any evidence', () => {
		resetHostGenerationCache()
		expect(hostGenerationSnapshot()).toBe('modern')
	})
})

describe('acquireSettingsLease', () => {
	it('is a no-op face on modern hosts (register absent, P1-13)', async () => {
		resetHostGenerationCache()
		const effects: Array<{ name?: string }> = []
		const ctx = {
			effect: (factory: () => unknown, name?: string) => { effects.push({ name }); void factory },
			settings: { describe: () => [] },
		} as unknown as Parameters<typeof acquireSettingsLease>[0]
		const face = acquireSettingsLease(ctx, 'context-compression', {})
		expect(face.get()).toBeUndefined()
		await expect(face.update({ marker: 1 })).resolves.toBe(false)
	})

	it('registers once and reads/writes through the host service on legacy hosts', async () => {
		const registrations: string[] = []
		const stored = new Map<string, Record<string, unknown>>()
		const settings = {
			register: (ns: string) => { registrations.push(ns); return { get: () => stored.get(ns) } },
			get: (ns: string) => stored.get(ns),
			update: async (ns: string, patch: Record<string, unknown>) => { stored.set(ns, patch) },
		}
		const effects: Array<() => void> = []
		const ctx = {
			effect: (factory: () => () => void) => { effects.push(factory()) },
			settings,
		} as unknown as Parameters<typeof acquireSettingsLease>[0]
		const face = acquireSettingsLease(ctx, 'context-compression', {})
		expect(registrations).toEqual(['context-compression'])
		await expect(face.update({ profile: 'balanced' })).resolves.toBe(true)
		expect(face.get()).toEqual({ profile: 'balanced' })
		// Disposal must not throw when this was the only owner.
		for (const dispose of effects) dispose()
	})
})
