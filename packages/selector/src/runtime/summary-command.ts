/**
 * `/ctx-summary off|on|status` — in-session temporary override for the
 * turn-tail intent-summary gate.
 *
 * The override is session-scoped by design: settings are session-frozen
 * (changes only affect newly observed sessions), so "temporarily disable and
 * resume" can only be expressed as runtime state. Overrides die with the
 * process and never leak across sessions. `off` wins over the settings gate;
 * `on` never bypasses the numeric growth gates — it only lifts the
 * settings/override veto.
 *
 * Registration mirrors the host's own `/compact` command: optional
 * `commands`-service injection (a host without the registry simply never
 * mounts the command), dynamic `CommandDefinitionId` brand import with a
 * plain fallback so a stripped host cannot break plugin load.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  getLastIntentFold,
  getObservedIntentEnabled,
  getSummaryOverride,
  setSummaryOverride,
} from './tokenpilot/advisor-state.ts'
import { INTENT_GATE_FLOOR_FRACTION, INTENT_GATE_GROWTH_TOKENS } from './tokenpilot/intent-gate.ts'

export const SUMMARY_COMMAND_NAME = 'ctx-summary'

const USAGE = 'Usage: /ctx-summary off|on|status'

export type SummaryCommandArgs = 'off' | 'on' | 'status'

/** Parse the raw argument string; `undefined` = unrecognized (usage error). */
export function parseSummaryCommandArgs(rawInput: string): SummaryCommandArgs | undefined {
  const token = rawInput.trim().toLowerCase()
  if (token === 'off' || token === 'on' || token === 'status') return token
  return undefined
}

function describeFold(sessionId: string): string {
  const fold = getLastIntentFold(sessionId)
  if (fold === undefined) return 'none'
  return `turn ${fold.turn}, seq ${fold.startSeq}..${fold.endSeq}`
}

/** Human-facing status line; observability only, never a decision input. */
export function formatSummaryStatus(sessionId: string): string {
  const override = getSummaryOverride(sessionId)
  const enabled = getObservedIntentEnabled(sessionId)
  const enabledText = enabled === undefined ? 'unknown (gate not evaluated yet)' : enabled ? 'yes' : 'no'
  return [
    `ctx-summary status:`,
    `  override: ${override ?? 'default (settings-driven)'}`,
    `  intentSummary enabled (settings): ${enabledText}`,
    `  gate: floor >${Math.round(INTENT_GATE_FLOOR_FRACTION * 100)}% of window AND growth >${INTENT_GATE_GROWTH_TOKENS} tokens since last fold`,
    `  last fold: ${describeFold(sessionId)}`,
  ].join('\n')
}

/** Resolve the invoking agent's session id (`''` when the host exposes none). */
function sessionIdOf(agent: unknown): string {
  const session = (agent as { session?: { id?: unknown } } | undefined)?.session
  if (session === undefined || session.id === undefined || session.id === null) return ''
  return String(session.id)
}

type CommandsServiceLike = {
  register: (definition: {
    definitionId?: unknown
    name: string
    description: string
    handler: (invocation: { agent?: unknown, rawInput?: unknown }) => Promise<{ kind: 'success' | 'error', text: string }>
  }) => unknown
}

/** Best-effort `CommandDefinitionId` brand; `undefined` on stripped hosts (registered without it). */
async function loadCommandDefinitionId(): Promise<((id: string) => unknown) | undefined> {
  try {
    const mod = (await import('@deepseek-ai/dsh-commands')) as { CommandDefinitionId?: (id: string) => unknown }
    return mod.CommandDefinitionId
  } catch {
    return undefined
  }
}

/**
 * Mount `/ctx-summary` for every composed human-command adapter. Never
 * throws: the command is a convenience surface, and a host without the
 * commands service (or with an incompatible registry shape) simply runs
 * without it.
 */
export function registerSummaryCommand(ctx: Context): void {
  ctx.inject(['commands'], (injected) => {
    const commands = (injected as { commands?: unknown }).commands as CommandsServiceLike | undefined
    if (commands === undefined || typeof commands.register !== 'function') return
    void (async () => {
      try {
        const definitionId = await loadCommandDefinitionId()
        await commands.register({
          name: SUMMARY_COMMAND_NAME,
          description: 'Turn-tail intent summary: temporarily disable/resume or inspect status',
          ...(definitionId === undefined ? {} : { definitionId: definitionId('dsh-context-compression-improved/ctx-summary') }),
          handler: async (invocation) => {
            const rawInput = typeof invocation.rawInput === 'string' ? invocation.rawInput : ''
            const args = parseSummaryCommandArgs(rawInput)
            if (args === undefined) return { kind: 'error' as const, text: USAGE }
            const sessionId = sessionIdOf(invocation.agent)
            if (args === 'status') {
              if (sessionId === '') return { kind: 'error' as const, text: 'ctx-summary: no session is attached to this invocation' }
              return { kind: 'success' as const, text: formatSummaryStatus(sessionId) }
            }
            if (sessionId === '') return { kind: 'error' as const, text: 'ctx-summary: no session is attached to this invocation' }
            setSummaryOverride(sessionId, args)
            return {
              kind: 'success' as const,
              text: args === 'off'
                ? 'ctx-summary: turn-tail intent summary paused for this session (until process restart or `/ctx-summary on`)'
                : 'ctx-summary: turn-tail intent summary resumed for this session (numeric gates still apply)',
            }
          },
        })
      } catch {
        // Registry rejected the definition (shape drift, closed union): the
        // plugin keeps working, only the convenience command is absent.
      }
    })()
  })
}
