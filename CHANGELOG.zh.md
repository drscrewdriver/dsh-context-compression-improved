# 更新日志（fork 新增条目）

> 完整历史（含上游 0.1.0 及更早版本）见 [CHANGELOG.md](CHANGELOG.md)。本文件只翻译本 fork 的新增条目。 · [English](CHANGELOG.md) · [日本語](CHANGELOG.ja.md) · [한국어](CHANGELOG.ko.md)

## 0.5.4 - 2026-09-20

### Fixed

- 安装面现在把 `@deepseek-ai/schemastery` 声明为**运行时依赖**。打包后的运行时无条件导入它
  （`packages/selector/lib/index.js`、`lib/pruner.js`、`lib/advisor-state.js` 中的
  `import z from '@deepseek-ai/schemastery'`），但 0.5.3 在任何"消费者安装会读取"的位置都没有声明：
  发布用的根清单只列了 `@huggingface/tokenizers` 与 `js-yaml`，而 `packages/selector/package.json`
  把它列为 peer——对于它自己安装的嵌套包，包管理器根本不会去读该声明。于是能否解析取决于别的已装包是否
  恰好把 `@deepseek-ai/schemastery` 提升进 profile。干净安装时该导入会落到 Harness 安装自身的共享模块
  回退目录 `$DSH_HOME/profiles/node_modules`；当该回退处没有已构建的包时，每个插件入口都加载失败，
  宿主启动后就没有 Bundle 层。现在两份清单都钉死 `3.18.2`（本次发布构建与实测所用版本），selector 也
  不再声称一个它并不承担的 peer 义务。

### Added

- `verify:release` 改为**从打包运行时文件实际导入的裸标识符推导**安装面依赖，不再手工点名
  `@huggingface/tokenizers` 与 `js-yaml`。哪些随插件发布、哪些由 Harness 安装提供，这份分界是一份
  **经评审的清单**；一旦某个导入的提供方不在两份清单中，门禁就会带着缺失的包名失败。该门禁先以"未修复
  的清单"做了**阴性对照**，当时正是在 `@deepseek-ai/schemastery` 上失败。

## 0.5.3 - 2026-09-20

### Fixed

- Bundle patch 不再设置已退役的 review 路由开关。`reviewQueueRoute` 在 review gate 退役时已从插件的
  Config schema 删除，却仍留在 `packages/selector/cordis.patch.yml` 中，等于宣告了一条永远注册不了的
  路由。宿主对未知配置键宽容（插件加载与服务均正常，已在真机验证），故属**陈旧配置**而非故障；但任何
  严格校验插件配置的宿主都会失败。
- 生成产物钉死为 LF（`packages/selector/lib/** text eol=lf`）。此前在 `core.autocrlf=true` 下，每次
  检出都会把已提交的 `lib/**` 改写成 CRLF，于是任何分支切换或合并都会让整个产物目录以"仅行尾差异"
  显示为已修改。该状态从未被提交过，但它让每棵树看起来都是脏的，并且会掩盖真实的产物变更。

### Added

- Bundle patch 的**阴性对照**契约钉桩：patch 中一旦设置退役配置键即失败（按"键赋值行"判定，注释里
  仍可点名该键），并要求在线的 `estimatorCatalogRoute` 开关保持接线。

### Tests

- 客户端座位契约补充了老宿主降级钉桩：未声明该 seat 的宿主会在槽边界拒绝注册，`apply()` 必须吞掉该
  拒绝并告警，而不是把全部设置入口一起弄丢。

## 0.5.2 - 2026-09-20

### Changed

- **退役**人工审查管线（review gate，beta）。其语义由"建议"取代：收益模型仍按"整批一次
  mutation"定价，但它算出的分带（`profitable` / `high-impact` / `slow-payback` /
  `unpriceable` / `not-worth-it`）现在只作为 `reduction-advice` 审计记录发布，并在 advisor
  报告路由上留一份快照——绝不扣留、延迟或改写任何 reduction。该 gate 与本功能自身的要求
  （缩减不阻断自动处理）相矛盾，且在出厂默认下（`reviewMode` 开 + 4000 token 高影响阈值
  对 8192 token 的 fresh 门槛）会把整批 fresh 100% 改道进人审，等于让选择开启它的用户失去
  自动路径。建议阈值改为模块常量（α `0.1`、高影响 `4000` token）：没有任何路径依据它们
  行动，因此不再作为配置项。
- 随 gate 一并移除：审查队列及其 `storageDomain` 适配器、进程级注册表、
  `review-queue` / `review-decide` 两条 HTTP 路由与 `reviewQueueRoute` 部署开关、
  `shell.overlay` 客户端浮窗、`reviewMode` / `reviewTimeoutTurns` /
  `cacheHitDiscountAlpha` / `reviewHighImpactTokens` 四个 settings 键，以及
  `review-outcome` 审计类型。这四个键在**两个解码器**中仍被接受但被忽略——既有配置文档
  （线上即带 `reviewMode: false`）照常加载、设置卡照常渲染——且永不进入已解析的 policy。
  只读路由 `GET .../advisor-report` 额外提供 `lastAdvice`。

### Added

- 退役的回归钉桩：一条宿主集成测试用**当年会全量改道的那套配置**（`reviewMode: true`、
  `reviewHighImpactTokens: 1`）断言 fresh 批次**照常落地**并附带 `high-impact` 建议记录；
  另一条弃用契约测试在运行时解析器与浏览器解码器两侧钉死"接受但忽略"。

### Rollback

- 回退到仍带 gate 的最后一个版本：`npm dist-tag add
  dsh-context-compression-improved@0.5.1 dsh-0.1.5 --registry https://registry.npmjs.org/`，
  然后 `dsh plugin --profile web add dsh-context-compression-improved@0.5.1`。

## 0.5.1 - 2026-09-20

### Fixed

- 同一 identity 的并发 preset-overlay 组装在 Windows 上不再失败：发布改为按目标路径串行，
  且当原子 rename 仍然竞争失败时，会先确认目标文件已带有本 staging 文件的
  `{mtimeMs, size}` standing key 才判定发布成功。Windows 的 `MoveFileEx` 会把这种竞争
  失败报成 `EPERM`/`EBUSY`，而 POSIX `rename` 只是覆盖目标——这曾导致并发启动会话时
  `standingKeyFor()` 抛错。目标不匹配时仍会明确失败，静默复用世代依旧被禁止。
- 一并修复了长期掩盖该问题及其它预存红灯的发布门禁与测试：packed smoke 中陈旧的标识符与
  已退役的审计 reason、过期的客户端 inject 断言，以及仅 Windows 触发的 spawn 陷阱
  （`git` 与多行 `node -e` 脚本经 `cmd.exe` 转发会被改写参数）。

## 0.5.0 - 2026-09-20

### Added

- 建议型相关度 advisor（仅统计与建议，默认关闭）：每个 turn 边界以 fire-and-forget 方式
  运行一次 pass——从最近的 `todo/write` 事件总结尾部任务语义（无 todolist 时回退到最近
  用户文本）、对历史 tool-result 候选做"内容+注释语义 ↔ 当前任务"的增量相关度打分、并
  计算前缀腐化度（prefix-decay，按 characterPressure 加权的相关度均值取反）。低相关的
  旧段标记为 `recertified`，仅作为后续 history 激进化的建议输入——本轮没有任何决策路径
  消费它，且 advisor 输出绝不抑制、延迟或改写任何本应落地的 reduction（有专项不变量测试
  钉死）。经 `presetOptions.advisor*` settings 键配置（`advisorMode` `''|'host'|'direct'`，
  默认 `''`；direct 通道复用 estimator 端点；`SideChannel` 新增可选 overrides 参数，
  共享传输层而不共享配置）。可观测性：新增 `advisor-outcome` 审计记录（content-free，
  每阶段一条：summary / scoring / decay）与只读 HTTP 路由
  `GET .../advisor-report?sessionId=`（部署级 opt-in 开关 `advisorReportRoute`，与 review
  路由同骨架）。本轮刻意不提供客户端 UI。

## 0.4.0 - 2026-09-20

### Fixed

- 插件不再依赖路由 model id：全部规划闸门改按字符基准决策（Unicode code points，
  经 `characterPressure` / `pressureCost`），不再以 exact tokenizer 计数为前提，
  因此未内建 tokenizer 的路由（线上 `deepseek-flash`）重新能落地改写而不是静默跳过。
  token 阈值键名与数值全部保留（按既有 4.0 字符/token 约定换算，冻结 profile 基线零改动）；
  token 数值降级为遥测，由 rewrite 审计记录新增的 `measurementBasis` 字段如实区分
  （`exact-tokenizer` 与 `characters`，派生时写 `tokenizerId: 'characters'` /
  `tokenizerRevision: 'chars-per-token-4.0'`）。回滚：确认无后续改动依赖本提交后再执行
  `git revert 7a1972a` 整体恢复旧闸门。

### Changed

- runtime 包并入 selector 包：一次安装即可获得完整栈，仓库根目录即为安装面
  （`name`、`main`、`types`、`exports`（含 `./pruner`、`./invariant`）、`dependencies`、`dsh`），
  工具链、脚本与 CI 一并收敛为单包。已真机验证的 estimator-catalog 路由注册（双前缀、受保护的
  双通道激活、按请求解析服务、可检索的生命周期日志）重放到本线，并新增宿主侧守门；`ab2175a`
  降级为 `z.any()` 的 settings schema 已还原，每日 Custom 默认值重新下发。
- 在本分支适配官方 DeepSeek Harness `v0.1.5-rc.2`。全部 `@deepseek-ai/dsh-*` 开发依赖与 e2e 官方宿主清单从 `0.1.1-rc.2` 升至 `0.1.5-rc.2`（cordis `4.0.2`、schemastery `3.18.2`），含新的拆分包（`dsh-session-projection`、`dsh-session-persistence`、`dsh-atomic-write`、`dsh-home-paths`、`dsh-sandbox` 等）与 `dsh-client-store` 客户端栈。
- Surface 替换操作改用 v3 的 `startSeq`/`endSeq` 形状与品牌化 `SessionSeq`；`compaction/prune` 清单保留持久化的 `start`/`end` 字段。surface node 事件改为按 seq 查找而非数组下标。
- 客户端 bundle 不再引用已移除的 `@deepseek-ai/dsh-client-runtime`：settings 类型改自 `@deepseek-ai/dsh-client-ui-settings`，会话 hooks 合并自 `@deepseek-ai/dsh-client-ui-session`。两份 package manifest 与 `dsh.plugin.json` 声明 `engines.dsh >=0.1.5-alpha.1 <0.2.0-0`。
- Harness 0.1.5 不再向浏览器暴露会话 `agentPreset`，客户端无法再识别 Minimal 会话；选择器保持可选，旧的不可用横幅不再出现。
- 测试套件按 0.1.5 语义更新：cordis 插件启动需要 `.await()`，Token Meter 需要预先挂载 `SessionProjectionRegistry`，assistant 事件携带 `stream: []`，settings 命名空间为普通字符串。

### 修复

- 估计器卡片在 Harness 宿主通道上不再要求 API Key。选择宿主通道后只显示实时供应商/模型下拉框，并标出当前真正生效的路由（显式覆盖优先，否则跟随会话默认模型）；既不显示密钥输入框，也不再有第二个手填模型输入——端点地址、模型文本框与只写密钥均只属于直连端点通道。
- `presetOptions` 改为按路径写入。此前整段写入会替换整个分节，导致再改动估计器的任何一个字段（供应商、模型、端点）都会删掉 `estimatorMode` 及其余全部覆盖值——估计器被静默关回关闭状态，而面板却报告保存成功。现在每个字段只写自己，`undefined` 只清除指名的那一个字段，且 confirm-on-write 校验的是同一组字段而非仅校验通道。
- 新增回归覆盖：`packages/selector/tests/preset-options-write.client.spec.ts`（按路径写入、保留同级字段、显式清除、空改动不写、未提交写入的报错）与 `packages/selector/tests/estimator-channel.client.spec.tsx`（各通道字段、目录下拉框、手填回退）。


### 新增

- 正交的代码骨架压缩门（`codeSkeleton.enabled`，默认关闭）：超大源码类工具结果首次曝光时，可保留导入与声明的骨架——省略函数体并保留错误行——失败时回退到原头部裁剪。这道门独立于所有 Profile，且以精确 tokenizer 测量为前提。
- 选择器设置区内新增该门的开关，附简体中文与英文文案。
- 新增段的浏览器/运行时解码对齐测试、`saveCodeSkeleton` 的 confirm-on-write 契约测试，以及全文档 parity 矩阵扩展。

### 变更

- 新增 ESLint 平铺配置基线（`pnpm lint`，CI 同步强制）与 `pnpm test:watch` TDD 环路；清理死导入，并修复 lint 基线暴露的两处错误处理路径。
- 本仓库现为 `WilliamShi666/dsh-context-compression-selector` 的改进版 fork；文档提供英、简中、日、韩四种语言。
