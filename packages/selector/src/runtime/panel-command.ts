/**
 * `/ccip` — context-compression-improved panel 实时控制命令（spec T29/T30/T31）。
 *
 * 子命令（`parsePanelCommandArgs` 为纯函数，单测钉死）：
 *  - `status` —— 面板状态总览（行开关/模式/聚焦、持久化状态、回填进度）
 *  - `rows stock|total|money on|off` —— 三行显示开关
 *  - `mode compact|full`
 *  - `session <id|latest|off>` —— 面板聚焦会话（latest = stats sessions 表
 *    updated_at 最新，usage 水位每秒 upsert 使活跃会话自然浮前）
 *  - `flush` —— 立即冲刷在途 usage debounce
 *  - `backfill pause|resume|status`
 *
 * 实时语义：命令改 server 端 displayPrefs（meta 表持久）→ 客户端下一轮询周期
 * （忙 2s/闲 5s）经 /savings/sessions 载荷拾取。不开推送通道（决策记录）。
 *
 * 注册形态与 `/ctx-summary` 完全同款：optional `commands` 服务注入 + 动态
 * `CommandDefinitionId` brand import 降级——无注册表宿主静默不挂载，插件加载
 * 零报错；registry 拒收也只吞掉命令面本身。
 *
 * @module dsh-context-compression-improved/runtime/panel-command
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  getDisplayPrefs,
  setDisplayPrefs,
} from './display-prefs.ts'
import {
  getStatsBackfillStatus,
  pauseStatsBackfill,
  resumeStatsBackfill,
} from './stats-backfill.ts'
import { statsPersistenceState } from './stats-db.ts'
import { flushPendingUsageNow } from './stats-sync.ts'
import { verifySessionSavingsLines } from './savings-verify.ts'
import { getStatsStore } from './stats-db.ts'

export const PANEL_COMMAND_NAME = 'ccip'

const USAGE = [
  'Usage: /ccip <subcommand>',
  '  status',
  '  rows stock|total|money on|off',
  '  mode compact|full',
  '  session <id|latest|off>',
  '  flush',
  '  backfill pause|resume|status',
].join('\n')

/** 一条已解析的 /ccip 子命令（纯数据，测试直接断言）。 */
export type PanelCommandArgs =
  | { op: 'status' }
  | { op: 'rows'; row: 'stock' | 'total' | 'money'; on: boolean }
  | { op: 'mode'; mode: 'full' | 'compact' }
  | { op: 'session'; target: { kind: 'id'; id: string } | { kind: 'latest' } | { kind: 'off' } }
  | { op: 'flush' }
  | { op: 'backfill'; action: 'pause' | 'resume' | 'status' }
  | { op: 'verify'; sessionId?: string }

/** 解析原始参数串；undefined = 无法识别（回 usage）。 */
export function parsePanelCommandArgs(rawInput: string): PanelCommandArgs | undefined {
  const tokens = rawInput.trim().toLowerCase().split(/\s+/u).filter(token => token !== '')
  if (tokens.length === 0) return undefined
  const [head, ...rest] = tokens
  if (head === 'status' && rest.length === 0) return { op: 'status' }
  if (head === 'flush' && rest.length === 0) return { op: 'flush' }
  if (head === 'rows' && rest.length === 2) {
    const row = rest[0]
    const on = rest[1]
    if ((row === 'stock' || row === 'total' || row === 'money') && (on === 'on' || on === 'off')) {
      return { op: 'rows', row, on: on === 'on' }
    }
    return undefined
  }
  if (head === 'mode' && rest.length === 1 && (rest[0] === 'compact' || rest[0] === 'full')) {
    return { op: 'mode', mode: rest[0] }
  }
  if (head === 'session' && rest.length === 1) {
    const target = rest[0]
    if (target === undefined) return undefined
    if (target === 'off') return { op: 'session', target: { kind: 'off' } }
    if (target === 'latest') return { op: 'session', target: { kind: 'latest' } }
    if (target.length <= 512) return { op: 'session', target: { kind: 'id', id: target } }
    return undefined
  }
  if (head === 'backfill' && rest.length === 1 && (rest[0] === 'pause' || rest[0] === 'resume' || rest[0] === 'status')) {
    return { op: 'backfill', action: rest[0] }
  }
  // verify [latest|<sessionId>]:无参 = 当前活跃会话;'latest' 视同无参
  if (head === 'verify' && rest.length <= 1) {
    const target = rest[0]
    if (target === undefined || target === 'latest') return { op: 'verify' }
    if (target.length <= 512) return { op: 'verify', sessionId: target }
    return undefined
  }
  return undefined
}

function persistedLine(): string {
  const state = statsPersistenceState()
  return state.persisted ? `persisted: yes (${state.driver})` : `persisted: no (${state.reason})`
}

function backfillLine(): string {
  const status = getStatsBackfillStatus()
  const summary = status.lastSummary === undefined
    ? 'no pass yet'
    : `${status.lastSummary.backend}: sessions=${String(status.lastSummary.sessions)} claims+${String(status.lastSummary.claimsAdded)}`
  return `backfill: ${status.paused ? 'paused' : status.running ? 'running' : 'idle'}, runs=${String(status.runs)}, last ${summary}`
}

function formatStatus(): string {
  const prefs = getDisplayPrefs()
  return [
    'ccip status:',
    `  rows: stock=${prefs.rows.stock ? 'on' : 'off'} total=${prefs.rows.total ? 'on' : 'off'} money=${prefs.rows.money ? 'on' : 'off'}`,
    `  mode: ${prefs.mode}`,
    `  focus session: ${prefs.focusSessionId ?? 'off'}`,
    `  ${persistedLine()}`,
    `  ${backfillLine()}`,
  ].join('\n')
}

/** `/ccip` 无会话依赖（与 /ctx-summary 不同：面板偏好是进程级而非会话级）。 */
export function executePanelCommand(args: PanelCommandArgs): { kind: 'success' | 'error'; text: string } {
  switch (args.op) {
    case 'status':
      return { kind: 'success', text: formatStatus() }
    case 'rows': {
      const prefs = setDisplayPrefs({ rows: { [args.row]: args.on } })
      return { kind: 'success', text: `ccip: ${args.row} row ${args.on ? 'on' : 'off'} (stock=${String(prefs.rows.stock)} total=${String(prefs.rows.total)} money=${String(prefs.rows.money)})` }
    }
    case 'mode': {
      setDisplayPrefs({ mode: args.mode })
      return { kind: 'success', text: `ccip: panel mode ${args.mode}` }
    }
    case 'session': {
      if (args.target.kind === 'off') {
        setDisplayPrefs({ focusSessionId: null })
        return { kind: 'success', text: 'ccip: panel focus off' }
      }
      if (args.target.kind === 'id') {
        setDisplayPrefs({ focusSessionId: args.target.id })
        return { kind: 'success', text: `ccip: panel focus ${args.target.id}` }
      }
      const latest = getStatsStore()?.recentSessionIds(1)[0]
      if (latest === undefined) return { kind: 'error', text: 'ccip: no known session yet (stats store empty)' }
      setDisplayPrefs({ focusSessionId: latest.sessionId })
      return { kind: 'success', text: `ccip: panel focus ${latest.sessionId} (latest)` }
    }
    case 'flush': {
      flushPendingUsageNow()
      return { kind: 'success', text: 'ccip: pending usage flushed to stats store' }
    }
    case 'backfill': {
      if (args.action === 'pause') { pauseStatsBackfill(); return { kind: 'success', text: 'ccip: backfill paused' } }
      if (args.action === 'resume') { resumeStatsBackfill(); return { kind: 'success', text: 'ccip: backfill resumed' } }
      return { kind: 'success', text: `ccip: ${backfillLine()}` }
    }
    case 'verify': {
      // 验算:jsonl 原文 × DS token 口径独立重算六值,与持久 claims 对账;
      // 缺省目标 = 当前活跃会话(运行时指针)。
      const text = args.sessionId === undefined
        ? verifySessionSavingsLines().join('\n')
        : verifySessionSavingsLines({ sessionId: args.sessionId }).join('\n')
      return { kind: 'success', text }
    }
  }
}

type CommandsServiceLike = {
  register: (definition: {
    definitionId?: unknown
    name: string
    description: string
    handler: (invocation: { agent?: unknown, rawInput?: unknown }) => Promise<{ kind: 'success' | 'error', text: string }>
  }) => unknown
}

/** Best-effort `CommandDefinitionId` brand；stripped 宿主返回 undefined（不带 definitionId 注册）。 */
async function loadCommandDefinitionId(): Promise<((id: string) => unknown) | undefined> {
  try {
    const mod = (await import('@deepseek-ai/dsh-commands')) as { CommandDefinitionId?: (id: string) => unknown }
    return mod.CommandDefinitionId
  } catch {
    return undefined
  }
}

/** 挂载 `/ccip`；永不抛错（无 commands 服务的宿主静默不挂载）。 */
export function registerPanelCommand(ctx: Context): void {
  ctx.inject(['commands'], (injected) => {
    const commands = (injected as { commands?: unknown }).commands as CommandsServiceLike | undefined
    if (commands === undefined || typeof commands.register !== 'function') return
    void (async () => {
      try {
        const definitionId = await loadCommandDefinitionId()
        await commands.register({
          name: PANEL_COMMAND_NAME,
          description: 'Context-compression panel: toggle rows/mode, focus a session, flush stats, pause backfill',
          ...(definitionId === undefined ? {} : { definitionId: definitionId('dsh-context-compression-improved/ccip') }),
          handler: async (invocation) => {
            const rawInput = typeof invocation.rawInput === 'string' ? invocation.rawInput : ''
            const args = parsePanelCommandArgs(rawInput)
            if (args === undefined) return { kind: 'error' as const, text: USAGE }
            return executePanelCommand(args)
          },
        })
      } catch {
        // Registry 拒收（形状漂移等）：插件照常工作，只缺席命令面。
      }
    })()
  })
}
