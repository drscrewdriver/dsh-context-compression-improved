# dsh-context-compression-improved · DSH v0.1.5-rc.2 适配报告

> 分支：`compat/0.1.5`（基于 `feat/ctx-preset-v2`，2026-09-14 完成）
> 提交：`b5428cf`（依赖与代码适配）→ `4c11289`（测试与 CHANGELOG）→ `93e47c2`（e2e release-gate 适配）
> 参照：`dsh-docs-deliverables/plugin-framework`（v0.1.5-migration / compatibility-guide §二十 / upgrade-pitfalls §七 / distribution-strategy §1.1）

## 一、结论

compaction 深度插件（直接依赖 tokenMeter / session surface 写路径）从 0.1.1-rc.2 适配到 0.1.5-rc.2 完成。typecheck 0 错误、lint 0、unit 338/341（2 个 Windows 环境抖动）、built ✅、verify:release ✅、packed-e2e dev 模式全绿（release 模式需发布 npm 前版后执行）。

迁移指南逐章核对结果：Inbox / Permission Presets / Sidebar Slot / LLM Adapter 四个高危变更本插件均不涉及；实际工作量集中在 **客户端包重构、Session V3 surface 语义、cordis 启动语义、semver peer 规则** 四块——其中后两类是迁移指南未覆盖的实测新坑，已回填 framework 文档（pitfalls §7、compatibility-guide §二十）。

## 二、适配清单

### 2.1 依赖与清单
- 全部 `@deepseek-ai/dsh-*` devDependencies `0.1.1-rc.2` → `0.1.5-rc.2`（cordis `4.0.2`、schemastery `3.18.2`）。
- 新增 0.1.5 拆分包 devDeps（session-projection、session-persistence、atomic-write、home-paths、sandbox、user-approval、llm-retry 等 13 个），pnpm overrides 钉版本（注意 pnpm 11 的 overrides 要写在 `pnpm-workspace.yaml`，package.json 的 `pnpm` 字段无效）。
- peer 范围 `>=0.1.1-rc.2 <0.2.0` → `>=0.1.5-rc.2 <0.2.0-0`。**根因**：strict semver 下 `0.1.5-rc.2` 不满足旧范围（预发布只匹配同元组），与官方包 `^0.1.5-rc.2` 求交为空导致 consumer 安装失败。
- `engines.dsh >=0.1.5-alpha.1 <0.2.0-0` 写入两份 package.json 与 `dsh.plugin.json`。
- CI workflow：Node 22 → 24，旧 fork 包名更正。

### 2.2 客户端（selector）
- `dsh-client-runtime`（已删除）→ `dsh-client-store`；inject/peer/import 三处迁移。
- 类型换位：`ClientContext` = cordis `Context`；`SettingsScope` 来自 `dsh-client-ui-settings/client`；`useSessions` 由 `dsh-client-ui-session` 模块扩充合并（type-only 引入 + inject 声明）。
- `ctx.slots` 无公开类型包，按官方模板自声明 `SlotsService`（`Pick<SlotCore,'register'>` + 手写 `inject`）。
- 行为降级：0.1.5 浏览器摘要不再带 `agentPreset`，Minimal 门控失效——选择器保持可选，横幅不可达，CHANGELOG 四语言记录。

### 2.3 运行时（runtime）
- surface 替换 → `{ op: 'replace', startSeq, endSeq }` + `SessionSeq()` 品牌化；`compaction/prune` 数据字段名不变（`start/end`）——两处不对称。
- surface node → 事件由数组下标 `events[node.seq]` 改为按 seq 查找（新增 `eventBySeq` 帮助函数，measurement + index 四处调用点）。
- `CallId` → `ToolCallId`；`session.events` → `snapshotEvents()`（保留 rc.2 双路径层，仅限本分支）。
- **Native auto-compact 审计**：0.1.5 通过会话 seed-reopen 落盘，seed 不进 firehose → 新增快照扫描（`pruneSession` 入口 + pre-step `next()` 之后），按 manifest seq 去重补发 `native-auto-compact` 审计。这是本次唯一的行为级适配。

### 2.4 测试与 e2e 基建
- 所有插件挂载 `.await()`；SessionProjectionRegistry 先于 TokenMeter（`mountAgentLoopTestDependencies` 已内置，勿重复）。
- assistant/message 事件补 `stream: []`；断言改 `startSeq/endSeq`、`firstLiveSeq`（数值 0 = 无 seed）。
- e2e：官方宿主清单从根 devDeps 动态生成（覆盖 0.1.5 peer 闭包）；consumer 写独立 `pnpm-workspace.yaml` 阻断祖先工作区吸收；`spawn` Windows 兼容；`settingsNamespace()` → 字符串。
- `.gitattributes` 标记 tokenizer 资产 `-text`（autocrlf 曾静默损坏 SHA-256 字节校验）。

## 三、验证结果

| 门禁 | 结果 |
|---|---|
| `pnpm typecheck` / `pnpm lint` | ✅ 0 错误 |
| `pnpm test:unit` | 338/341；2 个失败为 standing-stamp 窗口测试的 Windows mtime 抖动（基线同期同样失败，Linux CI 稳定） |
| `pnpm test:built` | ✅ |
| `pnpm verify:release` | ✅ OK |
| `pnpm test:e2e:packed`（dev） | ✅ EXIT=0；upgrade leg 与 official-clone leg 因 npm 前版未发布 / clone 不可达按设计跳过并输出标记 |

### 三补、本机 0.1.5 静态装载核查（2026-09-17，实测）

真机 0.1.5 宿主装载在本机**不可达**（本机宿主为 0.1.2-rc.1），故改为在源码层面取证：

| 检查项 | 结果 | 证据 |
|---|---|---|
| 提交的 `lib/**` 非陈旧 | ✅ | `pnpm run build` 后 `git status --porcelain` 为空；两次独立 `npm pack` 的 shasum 相同（`424bd137…`）→ 构建可复现 |
| `lib/*.js` 的依赖面 vs 0.1.5 提供的包 | ✅ 零缺失 | 实拉 0.1.5-rc.2 tarball 解包，从 `super(ctx,"…")` 提取服务名；插件注入/读取的 `settings`/`tokenMeter`/`invariants`/`sessions`/`tools`/`systemPrompt`/`llm`/`agentPresets`/`agents`/`webServer`/`settingsScope` 全部存在 |
| `dsh-client-runtime` 是否残留 | ✅ 0 次 | registry 上该包最新版止于 `0.1.1-rc.2`，0.1.5 确已移除 |
| `cordis.patch.yml` / `dsh.plugin.json` 引用的服务 | ✅ | `inject: [webServer]` 独立成行，`webServer` 缺席时只丢 HTTP 路由、压缩栈照常装载（刻意降级） |
| 全部 peer 区间在 registry 可解析 | ✅ | 19 个 `@deepseek-ai/dsh-*` 均解析到 `0.1.5-rc.2` |
| `pnpm test:built` | ✅ | `vitest.built.config.ts` 真正 `Function(code)()` 执行 `lib/client.js` |
| **真机 0.1.5 宿主装载** | **未验证** | 本机无 0.1.5 宿主 |

`pnpm test` 连跑 4 次：1 次全绿、3 次失败，**失败 100% 集中在 `standing-generation.host.spec.ts`**（`:333` 整秒 mtime 竞态、`:580`/`:595` 5s 超时、`EPERM rename`）——Windows 环境性竞态，非 0.1.5 适配引入。

## 四、已知问题与后续项

1. **release 模式 e2e**：official clone tag 与三连断言已改钉 `dsh-v0.1.5-rc.2`（commit `fb2c4b9e`、tree `bd7dd6d9`），客户端 peer 清单里的 `dsh-client-runtime` 已换成 `dsh-client-store`——此前这条腿**从未真正跑过**：它拿 `dsh-v0.1.1-rc.2` 宿主去验证一条声明只兼容 `>=0.1.5-rc.2` 的插件线，且 `proveBuiltClientPeersLoad()` 无条件解析已被移除的 `dsh-client-runtime`，必然抛错。仍需先发布一个前版（或调整脚本的前版基线）才能跑完 release 模式。
2. **stamp 窗口测试抖动**：Windows mtime 精度所致，可考虑在测试内跳过 win32 或提高窗口粒度。
3. **Minimal 门控降级**：待官方恢复浏览器侧 preset 暴露后恢复。
4. 0.1.1-rc.2 兼容 shim（session-events 双路径）仅保留在本分支，合主线时按主线支持的宿主范围决定去留。

## 五、经验回填

- `plugin-framework/upgrade-pitfalls.md` §七（7.1 cordis `.await()` 启动语义；7.2 firehose/seed-reopen；7.3 semver 预发布 peer 规则；7.4 autocrlf 资产损坏；7.5 workspace 向上吸收；7.6 Windows 环境差异；7.7 API 变更速查）
- `plugin-framework/compatibility-guide.md` §十二（客户端包迁移、类型换位、`ctx.slots` 自声明、`agentPreset` 降级、运行时 API 变更表、e2e 基建要点）
- `plugin-framework/distribution-strategy.md` §1.1/§1.2/§2.2（0.1.5 拆分闭包、本插件实证行、`-0` 上界规范）
