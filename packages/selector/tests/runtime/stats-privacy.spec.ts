/**
 * T33：审计消息净化 + 统计库隐私守卫——errorMessage 首行/截断/控制字符折叠，
 * 以及 claims 表字段封闭性（component/kind 全部白名单枚举，自由文本无处落表）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { AUDIT_MESSAGE_MAX_CHARS, sanitizeAuditMessage } from '../../src/runtime/audit.ts'
import { STATS_CLAIM_KINDS } from '../../src/runtime/stats-schema.ts'
import { closeStatsStore, ensureStatsStore, getStatsStore } from '../../src/runtime/stats-db.ts'
import { claimFromLand } from '../../src/runtime/stats-sync.ts'

const dirs: string[] = []

afterEach(() => {
  closeStatsStore()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('sanitizeAuditMessage（T33）', () => {
  it('多行取首行、控制字符折叠、超长截断', () => {
    expect(sanitizeAuditMessage(new Error('boom at line1\n  at stack (file.ts:1)\n  at deeper'))).toBe('boom at line1')
    expect(sanitizeAuditMessage('a\tb\u0000c')).toBe('a b c')
    const long = 'x'.repeat(500)
    expect(sanitizeAuditMessage(long)).toHaveLength(AUDIT_MESSAGE_MAX_CHARS)
    expect(sanitizeAuditMessage(new Error('普通长度消息'))).toBe('普通长度消息')
    expect(sanitizeAuditMessage(42)).toBe('42')
  })
})

describe('统计库隐私守卫（自由文本无处落表）', () => {
  it('claims 表的 kind/component 恒为封闭枚举;无自由文本列', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cci-privacy-'))
    dirs.push(dir)
    const store = await ensureStatsStore(join(dir, 'stats.sqlite'))
    if (store === null || getStatsStore() === null) throw new Error('no sqlite driver')
    claimFromLand({ sessionId: 'sess-privacy', component: 'fresh', tokensBefore: 500, tokensAfter: 100, basis: 'exact-tokenizer', replacementSeq: 7 })
    const db = new DatabaseSync(join(dir, 'stats.sqlite'))
    try {
      const kinds = (db.prepare(`SELECT DISTINCT kind FROM claims`).all() as { kind: string }[]).map(row => row.kind)
      expect(kinds.every(kind => (STATS_CLAIM_KINDS as readonly string[]).includes(kind))).toBe(true)
      const components = (db.prepare(`SELECT DISTINCT component FROM claims`).all() as { component: string }[]).map(row => row.component)
      // component 全部是白名单枚举值（保存组件/科目/sample 字段名）,绝非任意文本
      const COMPONENT_WHITELIST = new Set(['fresh', 'aggregate', 'history', 'tail-trim', 'dedupe', 'native', 'projection', 'retrieve', 'tailtrim-retrieve', 'full-read', 'input', 'output', 'cacheRead', 'cacheWrite', 'netExact', 'netEstimated', 'cachedInput', 'uncachedInput'])
      expect(components.every(component => COMPONENT_WHITELIST.has(component))).toBe(true)
      // claims 表无 message/text/note 类列——自由文本没有落表位置
      const columns = (db.prepare(`PRAGMA table_info(claims)`).all() as { name: string }[]).map(row => row.name)
      expect(columns).toEqual(['session_id', 'seq', 'kind', 'component', 'basis', 'tokens', 'at'])
    } finally {
      db.close()
    }
  })
})
