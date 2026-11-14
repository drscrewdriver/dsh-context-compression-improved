/**
 * tui-command.ts — `/compress`：上下文压缩策略的 dsh-tui 终端面。
 *
 * 背景：TUI 不加载设置卡/投影卡片，压缩策略（门限、保留轮数、开关）在终端里
 * 既看不到也调不了，而它直接决定长会话会不会崩。命令只读回显设置节。
 *
 * 契约：单行 <=100、总行 <=40、无 ANSI、--json 单行。
 */

import type { Context } from '@deepseek-ai/cordis'

export type CommandKind = 'success' | 'error'
export interface CommandResult { kind: CommandKind; text: string }

export interface CompressDeps {
  ns: string
  section(): Record<string, unknown> | undefined
}

const MAX_LINES = 40
const MAX_WIDTH = 100

export function clip(text: string, width = MAX_WIDTH): string {
  const value = String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+$/, '')
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`
}

export function renderLines(lines: string[], limit = MAX_LINES): string {
  const clipped = lines.map((line) => clip(line))
  if (clipped.length <= limit) return clipped.join('\n')
  const kept = clipped.slice(0, limit - 1)
  return [...kept, `… 还有 ${clipped.length - kept.length} 行，加 --all 查看`].join('\n')
}

export function sectionOf(ctx: Context, ns: string): Record<string, unknown> | undefined {
  const settings = (ctx as unknown as { get?: (name: string) => unknown }).get?.('settings') as
    | { describe?: () => unknown }
    | undefined
  const raw = settings?.describe?.()
  const list = Array.isArray(raw) ? raw : (raw as { namespaces?: unknown[] } | undefined)?.namespaces
  if (!Array.isArray(list)) return undefined
  for (const entry of list) {
    const row = entry as { ns?: unknown; value?: unknown } | null
    if (row?.ns === ns && row.value !== null && typeof row.value === 'object') return row.value as Record<string, unknown>
  }
  return undefined
}

export function runCompressCommand(rawInput: string, deps: CompressDeps): CommandResult {
  const argv = String(rawInput ?? '').trim().split(/\s+/).filter(Boolean)
  const json = argv.includes('--json')
  const sub = (argv.find((token) => !token.startsWith('--')) ?? 'status').toLowerCase()
  const wrap = (result: CommandResult, data: unknown): CommandResult => {
    if (!json) return result
    const body = result.kind === 'error'
      ? { ok: false, cmd: 'compress', error: { message: result.text.split('\n')[0] ?? result.text } }
      : { ok: true, cmd: 'compress', data }
    return { kind: result.kind, text: JSON.stringify(body) }
  }
  if (sub === 'help' || sub === '?') {
    return wrap({ kind: 'success', text: renderLines([
      'compress — 上下文压缩策略（只读回显）',
      '  /compress status   设置节内容（门限/保留轮数/开关）',
      '  /compress policy   同 status（别名）',
      '  flags              --json 单行 JSON',
      '  note               改策略走 Desktop 设置页；命令层只读',
    ]) }, { help: true })
  }
  if (sub !== 'status' && sub !== 'policy') {
    return wrap({ kind: 'error', text: renderLines([`compress: 未知子命令 "${sub}"`, '  next: /compress help']) }, {})
  }
  const section = deps.section()
  if (section === undefined) {
    return wrap({ kind: 'error', text: renderLines([
      `compress: 设置节 ${deps.ns} 不在 profile 文档里`,
      '  next 检查插件是否已进入 profile；或看 cordis.patch.yml',
    ]) }, {})
  }
  const keys = Object.keys(section)
  const lines = ['compress — 设置节（只读）']
  for (const key of keys.slice(0, 14)) {
    const value = section[key]
    lines.push(`  ${key.padEnd(20)}  ${clip(typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value), 60)}`)
  }
  if (keys.length > 14) lines.push(`  … 还有 ${keys.length - 14} 个字段`)
  return wrap({ kind: 'success', text: renderLines(lines) }, section)
}

export function registerCompressCommand(ctx: Context, deps: CompressDeps): void {
  const registry = (ctx as unknown as { commands?: { register(definition: unknown): unknown } }).commands
  if (!registry || typeof registry.register !== 'function') return
  registry.register({
    definitionId: 'dsh-context-compression-improved',
    name: 'compress',
    description: 'Context compression console: read-only echo of the strategy section',
    input: { hint: '[status|policy] [--json]' },
    handler: (invocation: { rawInput?: string }) => runCompressCommand(invocation?.rawInput ?? '', deps),
  })
}
