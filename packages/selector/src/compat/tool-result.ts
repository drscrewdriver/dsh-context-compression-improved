/**
 * Tool-result envelope adapter (audit N2: three-axis relocation, not a
 * single-axis unwrap) + legacy message-source kind escape (audit B6).
 *
 * Three-axis mapping, main's own comment as evidence
 * (pruner/session.ts: "0.1.7-rc.2: isError moved from the result block onto
 * the message itself"):
 *
 *   semantics      Gen D (0.1.7-rc.2+ / 0.2.0)     Gen A/B/C (0.1.0–0.1.5)
 *   content blocks  message.content                 message.content[0].content
 *   error location  message.isError                 message.content[0].isError
 *   call id         message.toolCallId              message.source.callId
 *
 * Every consumer must take the whole triple from viewToolResult(); touching
 * a single axis inline is how the isError/callId axes get silently dropped.
 * A strict legacy signature overrides the generation flag per message (the
 * 0.1.7-rc.1 envelope shape was only load-verified, not session-verified —
 * this makes a wrong flag self-correcting instead of silently misreading).
 */
import { detectHostGeneration, type HostGeneration } from './host-generation.ts'

/** Strict signature of the enveloped (0.1.x) tool/result message. */
function envelopedShape(content: unknown): content is [{ type: 'tool-result'; content: unknown[]; isError?: boolean }] {
	return Array.isArray(content)
		&& content.length === 1
		&& typeof content[0] === 'object'
		&& content[0] !== null
		&& (content[0] as { type?: unknown }).type === 'tool-result'
		&& Array.isArray((content[0] as { content?: unknown }).content)
}

export interface ToolResultView {
	blocks: unknown[]
	isError: boolean
	callId: string | undefined
}

export function viewToolResult(
	message: { content?: unknown; isError?: unknown; toolCallId?: unknown; source?: { callId?: unknown } },
	generation?: HostGeneration,
): ToolResultView {
	const gen = generation ?? detectHostGeneration({ get: () => undefined })
	const content = message.content
	if (envelopedShape(content)) {
		const wrapper = content[0]
		return {
			blocks: wrapper.content,
			isError: wrapper.isError === true,
			callId: typeof message.source?.callId === 'string' ? message.source.callId : undefined,
		}
	}
	if (gen === 'legacy') {
		// Flagged legacy without the strict signature: still prefer the
		// legacy axes over misreading a flat message as an empty block set.
		const wrapper = Array.isArray(content) ? content[0] as { content?: unknown[]; isError?: boolean } | undefined : undefined
		if (wrapper && typeof wrapper === 'object' && Array.isArray(wrapper.content)) {
			return {
				blocks: wrapper.content,
				isError: wrapper.isError === true,
				callId: typeof message.source?.callId === 'string' ? message.source.callId : undefined,
			}
		}
	}
	return {
		blocks: Array.isArray(content) ? content : [],
		isError: message.isError === true,
		callId: typeof message.toolCallId === 'string'
			? message.toolCallId
			: gen === 'legacy' && typeof message.source?.callId === 'string'
				? message.source.callId
				: undefined,
	}
}

/**
 * Per-producer source kind, generation-gated. Modern hosts accept the
 * producer-declared kind (declared in pruner.ts's `MessageSourceMap`
 * augmentation); 0.1.x hosts only know the shared `{ kind: 'plugin' }` kind
 * — the dev bed's dsh-llm@0.2.0-rc.1 type face has no such member (audit B6,
 * empirically confirmed), so the legacy object escapes through `as never`
 * HERE and nowhere else.
 */
const PLUGIN_ID = 'dsh-context-compression-improved'

export function compressionMessageSource(generation?: HostGeneration): { kind: string; plugin?: string } {
	const gen = generation ?? detectHostGeneration({ get: () => undefined })
	if (gen === 'legacy') {
		return { kind: 'plugin', plugin: PLUGIN_ID } as never
	}
	return { kind: 'dsh-context-compression' }
}
