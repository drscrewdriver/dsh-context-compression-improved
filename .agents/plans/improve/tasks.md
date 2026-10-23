# Tasks

路径缩写：`R/` = `packages/selector/src/runtime/`，`T/` = `packages/selector/tests/runtime`。每步验证默认 = `pnpm -C packages/selector exec vitest run <相关 spec>` + 末尾 `pnpm build`。

> **进度记录点**（2026-10-19 实证核验，非仅勾选）：
> - Wave 1（T1-T5, T7, T11-T14, T19, T22）：runtime 584 例 + host 58 例全绿，pnpm build 通过；node:sqlite 兜底路径实测走通（ExperimentalWarning 如期）。
> - Wave 2（T6, T8-T10, T18, T20, T23）：runtime+host 合计 664 例全绿零回归，build 通过；T21 按依赖图留在 Wave 3。
> - Wave 3（T15-T17, T21）：runtime+host 合计 677 例全绿零回归，build 通过。积分器落 pruner fresh 边界（recordUsage 同点）；调度器 chunk 游标 + 路由首命中/dispose 节流双触发 + pause/resume/status（/ccip T31 挂点就绪）；后端 B 补水位跳过（与后端 A 同形，T23 fail-soft 用例断言同步为 skipped=2 新语义）。
> - Wave 4（T24-T32）：全量 755 例绿。/savings/sessions 分页面板端点（/savings 与 /monitor 契约冻结不动，路由精确断言同步）、`/ccip` 六线安全命令（optional commands 注入，静默降级）、displayPrefs meta 表持久、卡片三行（存量/累计/省钱）+ 会话分页 + persisted 徽标、9 语新键与"重启归零"文案全量替换、flushNow 与 backfill 开关接线。
> - Phase 8（T33-T37）：errorMessage 首行+截断净化与统计库隐私守卫 spec；verify-release 白名单核对（零新依赖：better-sqlite3 为非字面量 opportunistic import 不进 tgz，node:sqlite 走 `node:` 前缀）；README.zh/en 统计口径三行段 + CHANGELOG Unreleased 条目；adaptation-reports/dsh-context-compression-improved-stats-persistence.md 落盘。**门禁修正**：HOST_PLANE_ENTRIES 清单过期（lib/config.js、lib/host-generation.js 是旧入口表遗留的入库产物，clean 构建不再产出）已更新为真实产物集。
> - **最终：37/37 完成。** 全量 vitest 70 文件 / 757 例绿 + built 产物 1 例绿 + verify-release: OK。

## Phase 1: 持久层基础设施
- [x] T1: 新建 `R/stats-db.ts`——双驱动缝：try-import better-sqlite3 → `node:sqlite` DatabaseSync → null（可见降级导出）；open：wal/NORMAL/busy_timeout=5000/temp_store=MEMORY；PRAGMA application_id+user_version 校验，拒他人库，版本不符 drop 重建。验证：单测打开/拒开/重建三例
- [x] T2: 新建 `R/stats-schema.ts`——meta/sessions/claims 三表 DDL（claims 含 kind='sample' 积分行；PK 见 spec），ensureSchema(migrate)；路径解析 `<dshHome>/storages/dsh-context-compression/stats.sqlite` + homedir 兜底。验证：空库建表、二次打开幂等
- [x] T3: `R/stats-db.ts` 增 recordClaims(sessionId, rows[])：BEGIN IMMEDIATE + INSERT OR IGNORE；聚合查询 perSessionAggregates/total；累计查询 sumSamples(sessionId)；get/setSessionWatermark。验证：幂等重放零新增、跨会话不覆盖两例
- [x] T4: 新建 `T/stats-db.spec.ts`——BC #2671 两断言 + 写后读回对账 + 双连接并发写（busy_timeout）用例
- [x] T5: 生命周期接线 `src/index.ts` apply 内 `void (async)`：recover→open→close 挂 ctx.effect；无驱动 warn 恰一次 + 导出 persisted 状态。验证：effect 卸载无泄漏 fd 用例

> Phase 1 完成注记（2026-10-19）：16 例全绿；全量 vitest 三 project 697 例绿 + pnpm build 绿 + test:built 绿。T1/T2/T3 的验证例统一收在 `T/stats-db.spec.ts`。better-sqlite3 的 optionalDependencies 声明未动（推迟到 T30 连同 verify-release 白名单一并核），当前实跑驱动=node:sqlite。附带基础设施变更：`vitest.config.ts` 给 runtime/selector-host 两 project 钉 `DSH_HOME` 到临时目录，host spec 调 apply 时不写真实 `~/.dsh`。

## Phase 2: live 写路径
- [x] T6: 新建 `R/stats-sync.ts`——薄封装：claimFromLand/reclaimFromTailTrim/claimOffset/usageFlush 四入口；pruner.ts:2578-2587、:2410-2421、retrieve 抵消点改为同步小事务落库（pruner.ts 仅加接线行）
- [x] T7: `R/retrieve.ts:164` 抵消键 exec.agent.id → session.id 统一，连同内存账本调用点。验证：retrieve 相关 spec 调整后绿
- [x] T8: usage claims：session 事件 `assistant/message.data.usage` 按 seq 求和（复用 session-events.ts），秒级 debounce flush，写 sessions.lastSeq 水位。验证：水位节流单测
- [x] T9: `session/disposed`（pruner.ts:325-339）处 flush 残量 + 标记 source=live；savings.ts 头注释口径更新为"存量仪表+累计积分+持久 claims 三层"
- [x] T10: `T/stats-sync.spec.ts`——land→落库→snapshot 对账一致；写失败（注入抛错）→warn 一次且不阻塞压缩主路径

> Phase 2 D 线完成注记（2026-10-19）：`R/stats-sync.ts` 四入口+6 处接线（pruner 四处纯加行：land/tail-trim/recordUsage 调度/dispose；retrieve 两处 claimOffset 叠于 Wave1-B 的 foldRecall 旁）。定键：saving claim 用替换事件绝对 seq，offset claim 用被召回源事件 seq（同源反复召回首次入账、重放 PK 去重，findings (sessionId,eventSeq) 口径）；usage 逐事件逐科目（input/output/cacheRead/cacheWrite，basis=''）；水位与回填共用 sessions.version。stats-sync.spec 9 例绿；全量 733 例绿 + build/typecheck/lint 绿。实跑驱动=node:sqlite。

## Phase 3: 记账口径修复（小改三件套）
- [x] T11: savings.ts offset 条目补 `sourceSeq`：recordOffset 签名扩展 + retrieve.ts:112/163、noteFullText（:171-178）三写入点传源；observeActive（:220-228）收敛规则扩展到带 sourceSeq 的 offset（按召回文本存活面收敛；无 sourceSeq 保持原样）。验证：离面停罚用例
- [x] T12: savings.ts 新增 `foldRecall(sourceSeq, recalledTokens, basis)`：同 basis 源条目贡献折叠 a−(b+R)（下限 −b）+ negative-effect 标记供分项显示；跨 basis 不折叠退化为收敛 offset；retrieve.ts 两处改调 foldRecall（R=boundCodePoints 实测值）。验证：全量召回 −b / 部分召回 a−(b+R) / 跨 basis 不混三例
- [x] T13: 环形缓冲驱逐策略（savings.ts:211）：优先淘汰离面/已消费条目，replacementSeq 在面上的 saving 绝不清；cap 400→800。验证：401+ 条目压力下活条目存活
- [x] T14: `T/savings-accounting.spec.ts` 集成三件套：收敛→翻负→驱逐全链数值断言 + 与 snapshot() 对账

## Phase 4: 积分器（真节省）
- [x] T15: 新建 `R/savings-integral.ts`——fresh 边界（pruner.ts:400-433 块，recordUsage 同点）采样 `{netExact, netEstimated, cachedInput, uncachedInput}`；经 stats-sync 落 claims kind='sample'（(session_id, boundarySeq) 幂等）
- [x] T16: 省钱加权：deepseek-official-pricing.ts 接入——money = cachedInput×cacheReadPrice + uncachedInput×inputPrice；无定价路由仅 token 口径。验证：加权数值用例
- [x] T17: `T/savings-integral.spec.ts`——无召回单调不减；召回后存量转负积分回落；重启后从 store 恢复累计不重复；sample 幂等重放

## Phase 5: 旧会话回填
- [x] T18: 新建 `R/stats-backfill.ts` 后端 A——sessionQuery listSessions/readSession + version 水位 diff（照 SI sync.ts:106-153），事件喂 projectSavingsCore + usage 求和；服务缺席 → 返回不可用标记
- [x] T19: 新建 `R/session-file-decode.ts`（叶子模块，零内部依赖）——SS generation.ts 代次契约 + decode.ts zstd 多帧/撕裂尾帧/打包行/provenance 移植；header.version 未知 → fail-soft 单会话跳过（实现注：模块内只分类不告警，`classifySessionHeader` 返回 verdict 交调用方裁决；D7 纪律——注释也不得逐字写被禁常量，历史代文件名拼接构造）
- [x] T20: `R/stats-backfill.ts` 后端 B——目录发现（scan.ts:62-102 判据，无固定文件名截断）→ decode → 同一 claims 提取核心；绝不写会话文件
- [x] T21: 回填调度——10-50 会话/chunk `void (async)`；触发=/savings|/monitor 首次命中 + dispose 后低频；幂等（水位+OR IGNORE）。旧会话不回填追溯积分（前向口径，见 findings 专项节）
- [x] T22: fixture——真实 v4 解包样本已转为测试资产 `tests/runtime/fixtures/session-v4-dump.jsonl`（284KB，源 `mine-dsh-plugins/_tmp-session-dump.jsonl`）；合成 v3/v4 代次样例与撕裂尾帧用例落 `T/session-file-decode.spec.ts`（21 例全绿，含 D7 字面量守卫与多帧/整体解码等价断言）
- [x] T23: `T/stats-backfill.spec.ts`——两后端同 feed 结果一致；二次回填零增量；live+backfill 同会话不双计；源文件 mtime/size 不变断言

> E 线完成注记（2026-10-19）：`R/stats-backfill.ts` 双后端共用 `extractBackfillClaims`（零 tokenizer：投影注入拒精确计数假计数器→chars/4 分列；usage 固定科目白名单 input/output/cacheRead/cacheWrite）。live 护栏 = `sessions.source='live'` 整段跳过（防 component 异名的双计）。fail-soft warn 接线自 T19 落地（进程级门闩，跨轮恰一条）。前置小改四处：`stats-schema.ts` 导出 `resolveStatsDshHome`；`stats-db.ts` 增 `StatsStore.getSessionRecord`；`savings-projection.ts` 的 `ProjectedOffset` 补绝对 `seq`（claims 主键需要，纯增量字段）；`session-file-decode.ts` 补明文（compression=none）分支——帧扫描零完整帧且偏移 0 非帧头时整段按 UTF-8 解，垃圾字节仍落入行解析失败 + header 缺失的 fail-soft 语义。`stats-backfill.spec.ts` 13 例；全量 724 例 + 双 typecheck + eslint + build 绿。

## Phase 6: 面板与契约
- [x] T24: 新增 `GET /savings/sessions?offset=&limit=` 路由（src/index.ts 注册器模式）：store 分页聚合 ⊕ live 残差合并视图 + persisted 标志 + 积分累计（N 次 call + 省钱估计）+ 降级标注；/savings 与 /monitor 零改动
- [x] T25: 更新 `T/estimator-route-registration.host.spec.ts:116/132/186-188` 路由精确断言（有意契约变更）；monitor.spec/savings.spec 全绿确认
- [x] T26: `client/savings-card.tsx`——会话列表分页（服务端 LIMIT/OFFSET）、每会话明细展开（组件分列含负效果骨架/usage/缓存命中）、"存量 + 累计（按 N 次 call）+ 省钱"三行、persisted 徽标与降级提示
- [x] T27: locale——locales.ts zh/en 新键 + 替换"重启归零"文案；de/es/fr/it/ja/ko/ru 七文件同步。验证：构建通过
- [x] T28: `tests/client` jsdom 用例：分页渲染、累计/省钱行、降级标注、空态

## Phase 7: /ccip 面板控制命令
- [x] T29: 新建 `R/panel-command.ts`——`/ccip` 注册照 summary-command.ts 形态（optional `commands` 注入 + dynamic brand import fallback）；子命令解析 `status|rows|mode|session|flush|backfill`。验证：解析单测 + 无 commands 服务宿主静默不挂载用例
- [x] T30: 显示偏好状态（进程级 + stats DB meta 表持久，跨重启恢复）；`/savings/sessions` payload 附 `displayPrefs`（/monitor 不动）；`session latest` 解析为账本最近活跃会话。验证：偏好持久化与恢复单测
- [x] T31: `R/stats-sync.ts` 暴露 `flushNow()`；backfill 调度器加 pause/resume/status 开关（T21 调度器预留挂点）
- [x] T32: client 应用——savings-card/FAB 轮询拾取 `displayPrefs`（行开关/聚焦会话/紧凑模式）；locale 9 语新增 `/ccip` 帮助与状态键。验证：jsdom 渲染开关切换用例

## Phase 8: 收尾与门禁
- [x] T33: pruner.ts:2808-2809 errorMessage 持久化前截断/归类；确认无自由文本进 DB 的守卫测试
- [x] T34: verify-release.mjs:40-78 白名单语义核对：better-sqlite3 仅 optionalDependencies（packages/selector/package.json）+ 两份 package.json 同步；`node:` 前缀路径确认跳过
- [x] T35: README.md/README.zh.md 统计口径段落更新（存量 vs 累计双口径、持久化+回填、`/ccip` 命令、残留路径与手动清理）；CHANGELOG.md 新条目
- [x] T36: adaptation-reports/ 记录：jsonl fallback 后端偏离 D7 的风险接受与 fail-soft 缓解（含 T19 实现注：verdict 交调用方裁决、历史代文件名拼接构造规避 D7 字面量）；记账口径变更说明；`/ccip` 命令面六线兼容说明；六线 peer 零变更确认
- [x] T37: 全量验证：`pnpm build` + vitest 三 project + vitest.built.config.ts + verify-release.mjs；对照 checklist.md 逐项勾验
