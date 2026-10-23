/**
 * CCI per-session 统计持久层的 SQLite schema 与 DB 路径解析(spec 持久层主干 T2)。
 *
 * 三表:
 *  - `meta(key,value)` —— 预留键值(口径版本号、迁移标记等);
 *  - `sessions` —— 会话行:`version` 即已覆盖的绝对 seq 水位(live/回填共用),
 *    `source` 记 live|backfill;
 *  - `claims` —— 事件级幂等流水行(saving|offset|usage|sample),
 *    PK **必含 session_id**(BC #2671-2 教训:全局主键会跨会话静默覆盖);
 *    `seq` 一律宿主日志**绝对 seq**(#2671-1:相对 seq 随窗口滑动漂移)。
 *
 * 隐私红线:只存计数/seq/会话 id/组件名/时间;原文、savingsHash、自由文本
 * (errorMessage 类)绝不入表。
 *
 * 库所有权用 `PRAGMA application_id` 标记("CCIS");版本不符就地 drop 重建,
 * 他人库(含官方 session-query 派生库 0x44534851)拒开。
 *
 * @module dsh-context-compression-improved/runtime/stats-schema
 */
import type { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 当前统计库 schema 版本;不兼容版本就地重建(数据可从事件日志回填)。 */
export const STATS_SCHEMA_VERSION = 1

/** 标记本插件统计库所有权的 application id(ASCII "CCIS")。 */
export const CCI_STATS_APPLICATION_ID = 0x43434953

/** 官方 session-query 派生索引的 application id —— 本模块绝不触碰该库。 */
export const OFFICIAL_SESSION_QUERY_APPLICATION_ID = 0x44534851

/** 宿主一方 switch-search 索引的 application id(同样属于"他人库",拒开)。 */
export const SWITCH_SEARCH_APPLICATION_ID = 0x53574954

/** 统计库相对 DSH home 的路径段;刻意避开 sessions 目录(steward purge 会连带真删)。 */
export const STATS_DB_PATH_SEGMENTS = ['storages', 'dsh-context-compression', 'stats.sqlite'] as const

/**
 * claims.kind 的封闭枚举:`sample` 是按 call 积分行的组件采样(spec 积分器),
 * usage 行按事件 seq 求和入账。
 */
export type StatsClaimKind = 'saving' | 'offset' | 'usage' | 'sample'
export const STATS_CLAIM_KINDS: readonly StatsClaimKind[] = ['saving', 'offset', 'usage', 'sample']

/**
 * 路径解析选项(全部可注入,测试用):
 *  - `dbPath` 最高优先(整段覆盖);
 *  - `dshHome` 次之;
 *  - `env` 缺省 `process.env`,读 `DSH_HOME`(空串/全空白按未设置处理——
 *    镜像宿主 dsh-home-paths resolveDshHome 的语义;运行时不 value-import
 *    该宿主包,peer 清单冻结不变更)。
 */
export interface StatsDbPathOptions {
  dbPath?: string
  dshHome?: string
  env?: Record<string, string | undefined>
}

/** 解析 DSH home:显式 dshHome > $DSH_HOME > `~/.dsh`(宿主同名优先级)。 */
export function resolveStatsDshHome(options: StatsDbPathOptions = {}): string {
  if (typeof options.dshHome === 'string' && options.dshHome.trim() !== '') return options.dshHome
  const env = options.env ?? process.env
  const fromEnv = env['DSH_HOME']
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  return join(homedir(), '.dsh')
}

/**
 * 统计库绝对路径:`<dshHome>/storages/dsh-context-compression/stats.sqlite`
 * + homedir 兜底。返回值总是绝对路径形态的各段拼接。
 */
export function resolveStatsDbPath(options: StatsDbPathOptions = {}): string {
  if (typeof options.dbPath === 'string' && options.dbPath.trim() !== '') return options.dbPath
  return join(resolveStatsDshHome(options), ...STATS_DB_PATH_SEGMENTS)
}

/**
 * 建表(幂等)并把 application_id/user_version 盖章到当前版本。
 * 二次打开同一文件时 CREATE IF NOT EXISTS 全部空转,数据原样保留。
 */
export function ensureStatsSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      project TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'live'
    );
    CREATE TABLE IF NOT EXISTS claims (
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      component TEXT NOT NULL DEFAULT '',
      basis TEXT NOT NULL DEFAULT '',
      tokens INTEGER NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (session_id, seq, kind, component, basis)
    );
    CREATE INDEX IF NOT EXISTS claims_session_kind ON claims(session_id, kind);
  `)
  db.exec(`PRAGMA application_id = ${CCI_STATS_APPLICATION_ID}`)
  db.exec(`PRAGMA user_version = ${STATS_SCHEMA_VERSION}`)
}

/**
 * 版本不符时的就地重置:删掉全部自建表(含索引随表消失)、清 user_version,
 * 保留文件本身;application_id 由随后的 ensureStatsSchema 重新盖章。
 * 数据丢失是可接受语义——claims 全部可从宿主事件日志幂等重放。
 */
export function resetStatsSchema(db: DatabaseSync): void {
  for (const row of db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all() as { name: string }[]) {
    db.exec(`DROP TABLE IF EXISTS "${row.name.replace(/"/g, '""')}"`)
  }
  db.exec(`PRAGMA user_version = 0`)
}
