/**
 * 面板显示偏好（spec T30）——`/ccip` 命令与 `/savings/sessions` 载荷共享的
 * 进程级状态，meta 表持久（跨重启恢复）。
 *
 * 设计：
 *  - 运行时单份内存状态，首次读取时从 stats meta 延迟加载（store 缺席 = 纯
 *    内存默认值，可见降级语义下偏好只是不持久，功能不受损）；
 *  - 写入走校验器（行开关布尔、mode 枚举、focusSessionId ≤512 或 null），
 *    非法输入静默忽略该字段——显示偏好绝不抛错打扰命令面；
 *  - session 级设置是冻结语义（savings.ts 惯例），面板偏好是进程级运行时
 *    状态（summary-command.ts 同款理由：实时开关无法走冻结设置）。
 *
 * @module dsh-context-compression-improved/runtime/display-prefs
 */
import { getStatsStore } from './stats-db.ts'

const META_KEY = 'displayPrefs'

export interface PanelDisplayPrefs {
  rows: { stock: boolean; total: boolean; money: boolean }
  mode: 'full' | 'compact'
  /** 面板聚焦会话；null = 不聚焦。`/ccip session <id|latest|off>` 的落点。 */
  focusSessionId: string | null
}

const DEFAULTS: PanelDisplayPrefs = {
  rows: { stock: true, total: true, money: true },
  mode: 'full',
  focusSessionId: null,
}

let current: PanelDisplayPrefs | undefined

function cloneDefaults(): PanelDisplayPrefs {
  return { rows: { ...DEFAULTS.rows }, mode: DEFAULTS.mode, focusSessionId: DEFAULTS.focusSessionId }
}

function parsePrefs(raw: string | undefined): PanelDisplayPrefs {
  if (typeof raw !== 'string' || raw === '') return cloneDefaults()
  try {
    const parsed = JSON.parse(raw) as Partial<PanelDisplayPrefs> | null
    if (parsed === null || typeof parsed !== 'object') return cloneDefaults()
    const prefs = cloneDefaults()
    if (parsed.rows !== undefined && typeof parsed.rows === 'object' && parsed.rows !== null) {
      for (const key of ['stock', 'total', 'money'] as const) {
        const value = (parsed.rows as Record<string, unknown>)[key]
        if (typeof value === 'boolean') prefs.rows[key] = value
      }
    }
    if (parsed.mode === 'full' || parsed.mode === 'compact') prefs.mode = parsed.mode
    if (parsed.focusSessionId === null) prefs.focusSessionId = null
    else if (typeof parsed.focusSessionId === 'string' && parsed.focusSessionId.length > 0 && parsed.focusSessionId.length <= 512) {
      prefs.focusSessionId = parsed.focusSessionId
    }
    return prefs
  } catch {
    return cloneDefaults()
  }
}

/** 当前偏好（首次调用从 meta 延迟加载；store 缺席 = 默认值）。 */
export function getDisplayPrefs(): PanelDisplayPrefs {
  if (current === undefined) {
    current = parsePrefs(getStatsStore()?.getMeta(META_KEY))
  }
  return current
}

/** 打补丁式更新：仅接受字段的合法值；成功即写 meta（store 缺席只改内存）。 */
export function setDisplayPrefs(patch: {
  rows?: { stock?: boolean; total?: boolean; money?: boolean }
  mode?: 'full' | 'compact'
  focusSessionId?: string | null
}): PanelDisplayPrefs {
  const prefs = getDisplayPrefs()
  if (patch.rows !== undefined && typeof patch.rows === 'object' && patch.rows !== null) {
    for (const key of ['stock', 'total', 'money'] as const) {
      const value = patch.rows[key]
      if (typeof value === 'boolean') prefs.rows[key] = value
    }
  }
  if (patch.mode === 'full' || patch.mode === 'compact') prefs.mode = patch.mode
  if (patch.focusSessionId === null) prefs.focusSessionId = null
  else if (typeof patch.focusSessionId === 'string' && patch.focusSessionId.length > 0 && patch.focusSessionId.length <= 512) {
    prefs.focusSessionId = patch.focusSessionId
  }
  try {
    getStatsStore()?.setMeta(META_KEY, JSON.stringify(prefs))
  } catch {
    /* 持久失败不抛：偏好保持内存态（下一次读取回退默认——可见降级口径） */
  }
  return prefs
}

/** 测试隔离：丢弃内存态（下次读取重新从 meta 加载）。 */
export function resetDisplayPrefsCache(): void {
  current = undefined
}
