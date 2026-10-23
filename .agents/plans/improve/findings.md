# Findings

> 隔离区：三个 Research agent 的调研输出（已压缩保留全部事实与锚点），未经 Phase 2 评审前不进入 spec.md。路径缩写：CCI=`packages/selector`；SI=`mine-dsh-plugins/dsh-search-index`；SS=`mine-dsh-plugins/dsh-session-steward`；BC=`reffer-dsh-plugins/refer-billion-context`。

## Agent A: 架构设计

**现有统计链路**
- 账本 `src/runtime/savings.ts`：模块级单例 `getSavingsLedger()`（savings.ts:412-417）；`Map<sessionId, SavingsEntry[]>`（400 条/会话 :45，registry 2048 :46）；头部注释明言"不落盘、重启归零"（:14-15）。API：`recordUsage`:59、`recordSaving`:106（原文哈希 registry :128-142）、`noteFullText`:150、`recordOffset`:182、`observeActive`:220（按存活 seq 收敛当前生效毛节省）、`seedProjected`:240、`snapshot(sessionId?)`:284（聚合带 perSession top-8 :312-327）、`savingsHash`:396-406。
- 写入方全在 `src/pruner.ts`：land 主路径 :2578-2587、tail-trim :2410-2421、noteFullText :1575-1591、recordUsage :479、observeActive 于 `agent/turn-stopping` :418-420；retrieve 抵消 `runtime/retrieve.ts:112,163`；`session/disposed` 一行账 :328-340；投影播种 `ensureSavingsProjection` :868-876（projectedSavings WeakSet 防重 :318）。
- 读取方：`/savings` 只读路由（index.ts:51-54, handler :363）+ `/monitor`（:481）；monitor 快照 = ledger.snapshot ⊕ 占用观测 ⊕ intent 门（runtime/monitor.ts:85-123，占用 LRU 64 会话 :131-146）。
- 面板桥：savings-card.tsx 5s 自轮询 :53，perSession 仅 top-5 :122-133；monitor-fab body 直挂幂等单例（:61-131），忙 2s/闲 5s 轮询（:306-328），会话绑定靠 `conversation.input.left` 槽 inject 拿裸 sessionId（client/index.ts:383-395）。设置桥双臂：bridge-scope HTTP 4s（bridge-scope.ts:17-18），0.1.7+ 原生 configForms 臂（client/index.ts:45-54,177-207）。
- audit（runtime/audit.ts:284-303）：单行 JSON 经 ctx.logger.info，不直接落盘，耐久性取决于宿主日志。
- 入口：dsh.plugin.json main=./lib/index.js、client.main=./lib/client.js；cordis.patch.yml 两行；apply（index.ts:583-631）无条件挂 savings/monitor 路由 :594-603；PrunerState 全 WeakMap（pruner.ts:301-322）。

**jsonl 格式与旧会话读取**
- SS 最完整：会话根 `<dshHome>/sessions/<project>/<sessionId>/`（SS host/health/scan.ts:46-49）；文件名契约 `session.jsonl.zstd`=代 0、`session.v<N>.jsonl.zstd`=当前代、`session.migration.<hex>.jsonl[.zstd].tmp`（generation.ts:6-11,43,51；逐字对齐宿主 dsh-session-format/filename.ts）；当前代=实测最高（:186）；zstd 多帧扫描+撕裂尾帧 `ZSTD_e_flush` 抢救（decode.ts:60-104,241-249）；首行 header type:'session'（:288-295）；provenance 区间展开（:107-131）；打包行解包（:160-216）；seq 连续性校验遇缺口按 prefix 停（:273-285）。软加载官方解码器实测 dsh-session@0.2.0-rc.1 只导出 decodeSeqRanges（dsh-session lib/index.js:1933），无 decodeStorageRecord。
- SI 不解析 jsonl：读宿主 `sessionQuery` 服务（SI src/index.ts:601），listSessions/readSession（:114-130,613-620）；readSession 返回裸事件 `{seq,type,time,ignorable,surfaceOp,data}`（host/extract.ts:15-22）——恰好覆盖 projectSavingsCore 所需面；增量=header.version 水位差（host/sync.ts:124-138）；归档集合从 workspaceRegistry 或 `~/.dsh/storages/workspace.json` global.archivedSessionIds（archive-source.ts:39-53）。
- 结论：自解析蓝本抄 SS；SI 服务面路线零解析成本但是可选服务；CCI 投影核心已是事件面纯函数（savings-projection.ts:151），两后端都能直接喂数。

**SI 的 SQLite 模式**
- better-sqlite3 可选优先 + node:sqlite 兜底（SI host/schema.ts:28-47）；pragma wal/NORMAL/MEMORY/cache -65536（:75-81），busy_timeout 未设；`~/.dsh-switch-search/index.sqlite`（rebuild.ts:351-353）；application_id 0x53574954+user_version=4（schema.ts:17-19），版本不符原地 drop 重建（:88-107），拒开官方库 0x44534851（:66-69）；表 meta/sessions/docs+fts5，docs 唯一键 (session_id,seq)（:109-141）；重建=影子+3 rename（rebuild.ts:1-9）；apply 内 open 常驻（index.ts:690-703），fiber 卸载 close（:704）。
- SS 无 SQLite：favorites 用 `~/.dsh/storages/session-steward-favorites.json` tmp+rename（favorites.ts:14,60-66）。

**宿主能力**
- dsh-atomic-write：writeFileAtomic（Windows EACCES/EBUSY/EPERM 有界重试）+ withFileLock 跨进程写锁（lib/types/index.d.ts）。
- dsh-session@0.2.0-rc.1：**无磁盘加载旧会话 API**（SessionStore 仅内存活会话）；旧会话只能 (a) sessionQuery 服务或 (b) 自解析 jsonl。dsh-home-paths 解析 `~/.dsh`。
- dsh-host-internals（digest-06/anchors:84-90）：sessionPersistence 是 Service 缝；`ctx.sessionQuery` 只读检索；SESSION_FORMAT_VERSION=4；"持久化搬运日志、查询读日志、压缩只改 surface 投影"。

**BC 可迁移要点**：复合键 messages PK(session_id,seq)、blocks PK(session_id,block_id)、"UPDATE is a bug"（BC src/storage/schema.ts:5-8,128-156）；内容去重 hash 主键（:120-121，CCI savingsHash 可作配对键）；soak 教训 seq 重基（store.ts:665-690）→ 持久行勿用投影 seq 作主键，用稳定键+水位；不得铸造不存在的键（ingest.ts:433-440）；schema version 门（schema.ts:31-46）；驱动缝 busy_timeout+BEGIN IMMEDIATE（driver.ts:5-8,86-88,223-225）；digest parity → 简化为写后读回校验+总额对账。

**模块草案**：savings-store（持久聚合）、savings-backfill（双后端）、面板桥读合并视图、账本不写穿、dispose+节流 upsert；重叠去重用 lastSeedVersion 水位。

## Agent B: 性能与维护

**真实存储形态**：`C:\Users\joshua\.dsh\sessions\<project-key>\session-<uuid>\session.v4.jsonl.zstd`（zstd 多帧，无裸 jsonl）。样例 43 会话：压缩 319B~2.0MB，p50 331KB，合计 19.9MB，压缩比 5.0x。本机 Node 22.22.1 实测：最大会话 decode+parse 84ms；43 会话合计 <1s。成本大头在计价不在 IO。

**回填计数——不要重跑 tokenizer**：事件里已有落盘 claims：`assistant/message.data.usage.{input,output,total}`（样例 356/358 条有，累计 1675 万 tokens 纯求和）；`compaction/prune.data.shadowedTokenCount`（CCI 自己的 manifest 事件）与 `compaction/summary.data.usage`。更细重定价用现成纯核心 projectSavingsCore(events, surfaceNodes, counter)（savings-projection.ts:151-213）+ seedProjected（savings.ts:240-281）。反面：tokenizer 6.37MB 资产懒加载（deepseek-v4-tokenizer.ts:84-91,113-137）且只认 deepseek 路由（measurement.ts:309-333）。audit 经宿主 logger **不保证落盘**（实测 .dsh/logs grep 无命中），不能作回填源。

**SQLite**：照 SI 双驱动；CCI engines `^22.19.0 || >=24`（package.json:68-69）→ node:sqlite 天然可用；宿主 desktop profile pnpm-workspace.yaml:38-42 已 allowBuilds better-sqlite3；批量写 BEGIN IMMEDIATE 嵌套 join（SI engine.ts:140-163），rebuild 每 50 会话一事务（rebuild.ts:133-134,186-234）；崩溃恢复=recoverIndex 处理半构建（:72-103）；写自己独立文件即安全。CCI 全仓无 setImmediate/worker 先例；现有 fire-and-forget 形态 `void this.postflight*Pass(...).catch()`（pruner.ts:395-433）；84ms/会话 → 10-50 会话 chunk 即可，无需 worker。

**面板**：响应=JSON.stringify（index.ts:363-366）；快照已含 perSession top-8（savings.ts:311-327），卡片 slice(0,5)（savings-card.tsx:122-133）。隐患：聚合 snapshot() 每会话递归 O(N×条目)（savings.ts:313-326）+ 内存环形缓冲历史会话本就不在。建议服务端排序+LIMIT/OFFSET 分页（SI 教训：全量 list 打爆 client 10s 超时，src/index.ts:315-319 注释）。每会话占用观测 64 LRU（monitor.ts:131-146）可复用 cap 语义。本地化：locales.ts zh/en + 7 语文件共 9 个需同步。

**可维护**：vitest 3 project（vitest.config.ts）；Session 构造先例 `Session.create(SessionId(...))+append`（tests/runtime/advisor-invariant.spec.ts:200-232）、mock-adapter（tests/support/mock-adapter.ts）；回填测试样板 savings-projection.spec.ts:6-25；zstd fixture 可用仓库根 `_tmp-session-dump.jsonl`（284KB 真实解包样本）。新模块平行新建于 runtime/，pruner.ts 不再加行；tsdown neverBundle 外置 node: 内置；dependencies 仅 3 项，node:sqlite 零声明、better-sqlite3 照 SI 声明 optionalDependencies。

**生命周期**：apply 挂路由（index.ts:583-631）；`session/disposed` 探测式注册（pruner.ts:325-339）是 flush 挂点；dispose 惯例 ctx.effect（index.ts:154-160,290-296,369-374,487-492）；SI 同缝 close（src/index.ts:701-705）；后台模式照 SI apply 内 `void (async)()`：recover→open→首轮回填→定时器（:684-699）。账本模块级单例（savings.ts:412-417）——DB 句柄必须 ctx.effect 关否则热重载泄 fd。savings.ts:14-16 "重启归零"文档化语义需同步更新；SS health/cache.ts:4-9 有"进程内不落盘 + YAGNI"权衡注释可对照。

## Agent C: 风险与回归

**宿主多版本**
- 兼容闸门读 package.json.peerDependencies 不读 dsh.plugin.json engines.dsh（peer-adapt SKILL §1，plugin-compatibility.ts:61-88）；六线枚举两处清单（package.json:90-114 与 dsh.plugin.json:7）必须同步；新增 peer 包漏枚举老线=整体拒载（VD-011-012-05）。
- compat 四文件：host-generation.ts:27-29 以 settings.register 判 legacy/modern（客户端代码不得用 :10-12）；settings-lease/tool-result:38-73/llm-messages 各挡一代际。新持久化必须走同一窄腰取 generation。
- session.id：全源无条件 `String(session.id)` 约 30 处，六线在售行为即证据；原始类型各线是否一致未验证[推测]→DB 键务必 String()。
- **jsonl 直读是最大红旗**：VD-016-017-10（version-delta-ledger.md:366-376）——session.jsonl V3→V4 断代，14 处直读点受害；处方=禁止直读、走会话服务面；静态闸 D7（gate-checklist.md:29）要求 `session\.jsonl|SESSION_FORMAT_VERSION|sessionFormatVersion` 源码命中 0（高危/runtime 阻断）。→ 方案直读 jsonl 与门禁正面冲突，必须 fail-soft 隔离。已开会话可回填；**未打开的历史会话无服务面 API**（agents.get 仅活会话，index.ts:66-68）。

**身份与一致性**
- CCI 无 fork/resume 后 id 变化处理（grep 零命中）；fork 复制日志会把同一逻辑会话计两条[推测]；id 复用未见证据[推测：低风险]。retrieve 抵消用 exec.agent.id（retrieve.ts:164）其余用 session.id——建议统一。
- 多实例共享 sessions 目录是受支持拓扑（BC CHANGELOG:224/#394）→ 必须复制 BEGIN IMMEDIATE 防 SQLITE_BUSY_SNAPSHOT（BC driver.ts:83-89, node:sqlite 臂 :107）+ busy_timeout。
- DB 侧防重播必须 (sessionId, seq) 幂等键：投影条目天然键 replacementSeq（savings-projection.ts:171-177），offset 是 (sessionId, eventSeq)。monitor.ts contextUsageBySession string 键（:139-158）迁移时口径对齐。

**隐私红线**
- 现状良好：原文只进 SHA-256 savingsHash（savings.ts:128-142,396-406），note 全固定模板+seq（:177, savings-projection.ts:208, retrieve.ts:117/168）。
- errorMessage 是自由文本（pruner.ts:2808-2809 直传 error.message）——落库前截断/归类。
- savingsHash 是内容衍生数据，有离线字典比对指纹风险[推测]→DB 只存 (sessionId, sourceSeq)，hash 留内存配对层。
- 回填必须只读（SS 红线先例 repair.ts:106）。DB 路径**绝不放宿主 sessions 目录**（steward purge 真删转录目录，client/history-panel.tsx:10、host/history/purge.ts:2）；SI 用插件自有目录、SS 用 `~/.dsh/storages/`。卸载清理无先例→DB 小、可随时删、README 写明残留路径。

**回归面**
- vitest.built.config.ts 只跑 tests/built/**，对 lib/client.js 产物做 CJS 工厂+依赖白名单断言（tests/built/client-artifact.spec.ts:7-31），未知 require 即红。
- 必红测试清单：estimator-route-registration.host.spec.ts:116/132 路由数组精确相等、:186-188 钉死常开只读路由恰好两条；monitor.spec.ts 钉 snapshot 形状（monitor.ts:19-21 注明 /savings 契约 frozen，新字段只能挂 intent/sessionScope 下）；savings.spec.ts 8 例（含跨会话不串账 :85）；savings-projection.spec.ts 6 例；audit.spec.ts content-free 断言。
- verify-release.mjs:40-78 依赖闸：runtime 裸导入须在白名单或声明 dependencies；`node:` 前缀跳过（:65）→ node:sqlite 零成本；better-sqlite3 要动两份 package.json+白名单语义。better-sqlite3 native 进不了 tgz（files 只含 lib+assets，selector package.json:27-38；V6a 要求逐字节一致）；BC 因 node-gyp 打红 CI 降为 optionalDependencies（BC CHANGELOG:239）。CI node 24.9.0（.github/workflows/ci.yml:27）；宿主内嵌 Node 六线是否都 ≥22.13 无记载[推测]→必须 try-import+可见降级。
- 9 语 UI 契约文案"账本为进程内口径（宿主重启归零）"（locales.ts:90/235 及 7 语种）需推翻更新。

**BC 前车之鉴→必进 checklist**
- #2671-2：全局主键跨会话覆盖（440 会话剩 249 行，静默）→ 主键必含 sessionId；同 DB 灌两会话互不覆盖测试。
- #2671-1：相对 seq 滑动窗口漂移→只写绝对 seq；(sessionId, seq) 幂等重放零新增；回填后与内存账本对账。
- digest drift shadow→持久层故障必须可见（warn+面板"持久化：降级"标注），禁静默吞。
- dsh-compaction-guard 教训（BC src/server/dsh-compaction-guard.ts:17-31,33-43）：失败方向不对称时 AND 链静默放行→CCI 同构故障="写失败但面板照常显示内存数"；flush-on-dispose 不可靠（老代际不发 session/disposed，pruner.ts:324-343）→必须边写边刷。
- 最危险三项：直读 jsonl 违 D7；主键/seq 设计违 #2671；better-sqlite3 native 进 tgz 过不了 V6a/CI。

## Phase 2 评审记录

**2a 规范合规**：三报告均只读、锚点完整、推测标注清晰；B 确认会话样例无指令类文本；无需用户确认的外部指令。通过。

**2b 质量综合与冲突裁决**：
1. **存储引擎**：A 荐 JSON+atomic-write（数据小、零依赖）vs 用户明示允许 sqlite。裁决：**SQLite**。claims 是事件级幂等行（(sessionId,seq) 键），需要增量 upsert；JSON 整文件重写随历史行数线性膨胀且热重载并发面更宽。JSON 方案列入 Rejected Alternatives。
2. **jsonl 直读 vs D7 门禁**：裁决：**双后端**。sessionQuery 服务面优先（可选服务，缺席降级）；SS 代次契约+decode 移植为 fallback，隔离在单一叶子模块，header.version 未知值 fail-soft（跳过该会话+一次性 warn），不硬编码裸 session.jsonl 路径字面量，fixture 钉死已知代次。接受残留风险并记入 adaptation 报告。
3. **flush 时机**：A 荐 dispose+节流 vs C 证明 dispose 不可靠。裁决：**claims 随写随刷**（land/offset 事件点同步小事务，BEGIN IMMEDIATE）；usage 按水位节流（秒级 debounce）；observeActive 仪表与 monitor 快照保持纯内存不落盘。
4. **驱动顺序**：照 SI——better-sqlite3 optional 优先、node:sqlite 兜底；无驱动时可见降级（warn 一次+面板 persisted:false）。verify-release 白名单语义核对列入任务。
5. **DB 路径**：`~/.dsh/storages/dsh-context-compression/stats.sqlite`（dsh-home-paths+homdir 兜底链）；绝不放 sessions 目录。
6. **契约**：/savings 冻结不动，新增 `/savings/sessions` 分页端点；estimator-route-registration 精确断言同步更新（有意契约变更）。
7. **计数口径**：回填零 tokenizer——usage/shadowedTokenCount claims 纯求和 + projectSavingsCore 注入假计数器；live 与 backfill 同键幂等去重（水位+INSERT OR IGNORE）。

## 会计口径专项核实（Phase 2 追加，用户带入的三缺陷分析）

逐点核实结论（全部与代码吻合，可直接作为实现依据）：
1. **存量口径确认**：observeActive（savings.ts:220-228）只保留 replacementSeq 仍在 liveSeqs 的 saving 条目（:223-226），调用点 pruner.ts:418-421 传 `session.surface.nodes`——面板净值是"当前 surface 生效节省"（stock），历史累计无处维护。
2. **offset 永不过期**：:223-226 filter 中 `entry.kind !== 'saving'` 短路保留一切 offset——召回/全文重读的 −N 永久压净值（stock/flow 混账）。noteFullText 注释明言"每次重读都罚：不再一次性消费"（:167-178）。
3. **召回记账巧合等值**：retrieve.ts:112-118（tailtrim）/163-169（retrieve）记返回文本 chars/4 为 offset，源条目 +(a−b) 持续计入毛节省；单次全量召回 +(a−b)−a=−b 与"翻负"数值巧合一致，但分项失真（毛节省虚计、抵消堆流水）。
4. **部分召回可实测**：retrieve 输出经 boundCodePoints(output, maxChars)（retrieve.ts:161）与 query 切片有界，R 在召回点可得——翻负折叠按 R 折算无需重扫原文。
5. **环形缓冲静默丢活**：push 溢出 `splice(0, …)`（savings.ts:211）驱逐最旧条目，不判 replacementSeq 是否仍在面上——可能丢掉生效中的 saving。
6. **积分采样点就位**：fresh 边界块 pruner.ts:400-433（runRequestBoundary→observeActive 同块），recordUsage 同边界入账——积分器同点采样 `{net 存量双 basis, cached/uncached}` 即可，无需新钩子。

**裁决**（记录进 spec 决策表）：本轮小改三件套（offset 收敛+翻负折叠+积分器）；投影归因重构延期为第二步（与持久化正交、风险不叠加）。**新增设计规则：跨 basis 禁折叠**——retrieve 抵消是 chars/4，源条目可能精确口径，折叠仅限同 basis，跨 basis 退化为带 sourceSeq 的收敛 offset（守住账本头号原则"口径分列永不合并"）。积分只前向累计，旧会话不回填追溯积分（追溯需要逐边界重放 surface，属投影路线范畴）。省钱加权：cached×cacheReadPrice + uncached×inputPrice（deepseek-official-pricing.ts 已有材料），无定价路由仅 token 口径。
