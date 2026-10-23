# Spec: CCI per-session 统计面板 + 持久化 + 旧会话 jsonl 统计

## 需求
1. **统计持久化**：SavingsLedger 现为进程内、重启归零（savings.ts:14-15）。把节省 claims（saving/offset）与 usage claims 落盘 SQLite，跨重启保留；仪表类瞬时值（observeActive/monitor）保持内存。
2. **Per-session 面板**：savings-card 从"全局快照+top-5"升级为完整按会话面板：服务端分页的会话列表、每会话毛节省/抵消/净额（exact/estimated 双口径分列）、usage 与缓存命中、组件分列、持久化状态徽标与降级提示。
3. **旧会话回填**：对磁盘历史会话按 jsonl 行为记录统计——零 tokenizer：`assistant/message.data.usage` 与 `compaction/prune.data.shadowedTokenCount` claims 纯求和 + `projectSavingsCore` 注入计数器；live 与回填同键幂等，绝不双计。
4. **记账口径修复（stock/flow 分离）**：现状面板显示的是 surface 存量（observeActive 收敛），召回抵消永不过期、环形缓冲可能静默丢在面生效条目——三缺陷已逐点核实（findings 专项节）。本轮落"小改三件套"：① offset 条目带 sourceSeq 进 observeActive 按面收敛；② 召回翻负折叠（源条目贡献从 +(a−b) 折到 a−(b+R)，分项显示负效果骨架）；③ 环形缓冲驱逐保护在面条目。
5. **按 call 积分（真节省）**：fresh 边界（recordUsage 同点，pruner.ts:400-422 块）采样当前存量 net 进积分器，经持久层落 sample claims——"累计（按 N 次 call）"是跨重启的历史累计口径；省钱估计按 cached/uncached 加权（deepseek-official-pricing.ts 材料），缓存读边际价 ≈1/10。
6. **`/ccip` 面板实时控制命令**：现状无此命令（CCI 唯一命令先例是 `/ctx-summary`，summary-command.ts，经宿主可选 `commands` 服务注入）。照该模式新增 `/ccip`：`status`（行开关/persisted/回填进度总览）、`rows stock|total|money on|off`、`mode compact|full`、`session <id|latest|off>`（面板聚焦会话）、`flush`（强制落库）、`backfill pause|resume|status`。实时语义 = 命令改 server 端显示偏好 → 卡片下一轮询周期（忙 2s/闲 5s）拾取；不开推送通道。
7. 遵守宿主六线兼容（peer 清单不变更）、隐私红线（不落原文/哈希/自由文本）、BC #2671 防御断言（见 checklist）。

## 技术方案

**模块布局**（全部新增于 `packages/selector/src/runtime/`，pruner.ts 只加接线行）：
- `stats-db.ts`：SQLite 双驱动缝（better-sqlite3 optional 优先 → `node:sqlite` 兜底 → 可见降级）。open 时 pragma：`journal_mode=wal, synchronous=NORMAL, busy_timeout=5000, temp_store=MEMORY`；`PRAGMA application_id=<CCI 专有值>` + `user_version=1`，拒开他人库；版本不符 drop 重建。写事务一律 `BEGIN IMMEDIATE`（防 SQLITE_BUSY_SNAPSHOT）。文件路径 `<dshHome>/storages/dsh-context-compression/stats.sqlite`（dsh-home-paths 解析 + homedir'.dsh' 兜底），绝不放 sessions 目录。
- `stats-schema.ts`：表 `meta(key,value)`；`sessions(session_id TEXT PK, project, version 水位, updated_at, source live|backfill)`；`claims(session_id, seq, kind saving|offset|usage, component, basis, tokens, at, PK(session_id,seq,kind,component,basis))`。所有主键含 sessionId；只存绝对 seq；INSERT OR IGNORE 幂等。不存原文、不存 savingsHash、不存自由文本。
- `stats-sync.ts`：live 写路径薄封装。pruner 两处 land（pruner.ts:2578-2587、2410-2421）与 retrieve 抵消点改调本模块同步落库（小事务随写随刷）；usage 由 session 事件按 seq 求和、秒级 debounce 节流 flush；每会话 lastSeq 水位记录已覆盖范围。retrieve.ts:164 的 `exec.agent.id` 统一改 session.id。
- `stats-backfill.ts`：回填调度器。后端 A=宿主 `sessionQuery.listSessions/readSession` + version 水位 diff（照 SI sync.ts 结构）；后端 B=SS generation/decode 移植（zstd 多帧 + 撕裂尾帧 + 打包行 + provenance，header.version 未知 → fail-soft 跳过该会话 + 一次性 warn）。10-50 会话/chunk 的 `void (async)` 分批，触发=/savings|/monitor 首次命中 + dispose 后低频；幂等重放零新增行。
- `runtime/` 内不动 `savings.ts` 内存账本职责；面板聚合 = store 查询 ⊕ 内存 live 残差（水位之后部分）合并视图。
- **记账口径（savings.ts 内改）**：`SavingsEntry` offset 侧新增 `sourceSeq`；`observeActive` 收敛规则扩展——带 sourceSeq 的 offset（retrieve/tailtrim-retrieve/full-read 三写入点补齐，retrieve.ts:112-118/163-169）按召回文本存活面收敛，离面即停罚；新方法 `foldRecall(sourceSeq, recalledTokens, basis)`：**同 basis** 源条目贡献折叠为 a−(b+R)（下限 −b），标记 negative-effect 供分项单独显示；**跨 basis 不折叠**（保持 offset 流水 + 收敛），守住"口径分列永不混算"原则。环形缓冲驱逐（savings.ts:211）改为优先淘汰离面/已消费条目，绝不清 live-surface 生效条目，cap 400 适度上调。
- **积分器（新 `runtime/savings-integral.ts`）**：fresh 边界采样 `{netExact, netEstimated, cachedInput, uncachedInput, basis}` → 经 stats-sync 落 claims `kind='sample'`（键 (session_id, boundarySeq) 幂等）；累计查询 = Σ samples，跨重启存活；省钱估计 = cachedInput×cacheReadPrice + uncachedInput×inputPrice（deepseek-official-pricing.ts，无定价路由仅 token 口径）。积分只前向累计：召回前 call 真省过钱保留，召回后存量转负积分自然回落；旧会话不回填追溯积分（列入投影路线延期项）。
- **`/ccip` 命令（新 `runtime/panel-command.ts`）**：完全照 summary-command.ts 的注册与降级形态（optional `commands` 注入 + dynamic `CommandDefinitionId` brand import fallback，无注册表宿主静默不挂载）。显示偏好 = 进程级运行时状态 + stats DB meta 表持久（跨重启）；经 `/savings/sessions` payload 附 `displayPrefs` 下发（新端点自由，/monitor 形状不动）；`flush`/`backfill` 子命令接 stats-sync/backfill 调度器的暂停开关。
- 面板：新增 `GET /savings/sessions?offset=&limit=` 分页端点（/savings 契约冻结不动）；savings-card.tsx 加会话列表分页、每会话明细展开、persisted 徽标、"累计（按 N 次 call）+ 省钱估计"行与负效果骨架分项、降级提示；9 语 locale 同步新增键并修正"重启归零"文案。

**生命周期**：apply 内 `void (async)`：recover→open→首轮 backfill→debounce 定时器（照 SI index.ts:684-699）；`ctx.effect(close)` 同缝清理，防热重载泄 fd。无驱动/写失败：warn 一次 + 面板 persisted:false，禁静默。

## 决策记录
| 选项 | 选择 | 理由 |
|------|------|------|
| 存储引擎 | SQLite 双驱动 | claims 事件级幂等行需增量 upsert；JSON 整文件重写随历史线性膨胀 |
| 驱动顺序 | better-sqlite3 optional → node:sqlite | native 进不了 tgz（V6a）；`node:` 前缀过 verify-release 零成本 |
| 旧会话读取 | sessionQuery 优先 + jsonl fallback | 服务面零格式风险；fallback 满足显式 jsonl 需求，隔离+fail-soft 化解 D7 断代风险 |
| flush 时机 | claims 随写随刷 + usage 节流 | 老代际不发 session/disposed，flush-on-dispose 会静默丢（BC guard 教训） |
| DB 路径 | ~/.dsh/storages/dsh-context-compression/ | SS favorites 先例；避开 sessions 目录（steward purge 连带删除） |
| 回填计数 | 落盘 claims 求和，禁 tokenizer | tokenizer 6.37MB+仅 deepseek 路由；事件 claims 已够口径 |
| 记账路线 | 本轮小改三件套（offset 收敛+翻负折叠+积分器），投影归因延期 | 小改风险面小、与持久化正交；投影重构正确但侵入 pruner/projection 主链，同轮叠加风险过大 |
| 显示口径 | 存量（当前生效）与累计（按 N 次 call）双行并存 | 存量回答"现在省多少"，积分回答"历史上省了多少"，语义不同不互替 |
| 跨 basis 折叠 | 禁止；退化为带 sourceSeq 的收敛 offset | 账本头号原则"口径分列永不合并"（savings.ts 头注释 3） |
| /ccip 实时语义 | 轮询周期拾取（2-5s），不开推送通道 | CCI 无推送面；WebSocket/SSE 超范围且六线兼容面大 |

## Rejected Alternatives
- **投影归因重构（本轮）**：每回合从 surface 现量"原文 vs 现文"直接投影（projectSessionSavings 已具雏形），retrieve 产物按 session://…/event/N 归因回源条目——offset 过期与 ring buffer 失真整体消失，条目降级流水审计。正确但需动 pruner 投影主链与事件解析，与持久化同轮风险叠加；列为第二步（其终态与 claims 流水审计store 天然衔接）。积分器两种路线下通用，不受影响。
- **JSON + dsh-atomic-write 单文件**（Agent A 初案）：实现最简，但 (sessionId,seq) claims 行随回填增长后每次全量重写成本失控，且无局部 upsert。
- **账本写穿落库**：observeActive 仪表值随 surface 涨落，写穿会用瞬时值覆盖累计值，且 land 高频 IO 放大。
- **仅 sessionQuery 单后端**：老线宿主无该可选服务时功能整体缺席，不满足"按 jsonl 统计旧会话"的显式需求。
- **全量 tokenizer 重计数**：贵且对非 deepseek 会话不可用（measurement.ts:309-333）。

## 约束
- peerDependencies 清单不变更（不加任何新 peer 包）；better-sqlite3 只进 optionalDependencies 且须核对 verify-release.mjs:40-78 白名单语义。
- /savings 契约冻结；/monitor snapshot 形状不变；新增字段只在新端点。
- estyimator-route-registration.host.spec.ts 路由精确断言为有意契约变更，需同步更新。
- compat 版本判定必须复用 host-generation.ts 窄腰，禁止自开版本判断；DB 键一律 String(session.id)。
- 隐私：DB 仅存计数/seq/会话 id/组件名/时间；errorMessage 类自由文本禁入。
