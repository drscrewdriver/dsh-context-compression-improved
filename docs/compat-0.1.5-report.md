# dsh-context-compression-improved · DSH v0.1.5-rc.2 适配报告

> 分支：`compat/0.1.5`（基于 `feat/ctx-preset-v2`，2026-09-14 完成）
> 提交：`b5428cf`（依赖与代码适配）→ `4c11289`（测试与 CHANGELOG）→ `93e47c2`（e2e release-gate 适配）
> 参照：`dsh-docs-deliverables/plugin-framework`（v0.1.5-migration / compatibility-guide §十二 / upgrade-pitfalls §七 / distribution-strategy §1.1）

## 一、结论

compaction 深度插件（直接依赖 tokenMeter / session surface 写路径）从 0.1.1-rc.2 适配到 0.1.5-rc.2 完成。typecheck 0 错误、lint 0、unit 338/341（2 个 Windows 环境抖动）、built ✅、verify:release ✅、packed-e2e dev 模式全绿（release 模式需发布 npm 前版后执行）。

迁移指南逐章核对结果：Inbox / Permission Presets / Sidebar Slot / LLM Adapter 四个高危变更本插件均不涉及；实际工作量集中在 **客户端包重构、Session V3 surface 语义、cordis 启动语义、semver peer 规则** 四块——其中后两类是迁移指南未覆盖的实测新坑，已回填 framework 文档（pitfalls §7、compatibility-guide §十二）。

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

## 四、已知问题与后续项

1. **release 模式 e2e**：需先发布 `0.1.0-beta.2`（或调整脚本的前版基线）并把 official clone tag 改为 `dsh-v0.1.5-rc.2`；合回主线前应补一次完整 release 模式验证。
2. **stamp 窗口测试抖动**：Windows mtime 精度所致，可考虑在测试内跳过 win32 或提高窗口粒度。
3. **Minimal 门控降级**：待官方恢复浏览器侧 preset 暴露后恢复。
4. 0.1.1-rc.2 兼容 shim（session-events 双路径）仅保留在本分支，合主线时按主线支持的宿主范围决定去留。

## 五、经验回填

- `plugin-framework/upgrade-pitfalls.md` §七（7.1 cordis `.await()` 启动语义；7.2 firehose/seed-reopen；7.3 semver 预发布 peer 规则；7.4 autocrlf 资产损坏；7.5 workspace 向上吸收；7.6 Windows 环境差异；7.7 API 变更速查）
- `plugin-framework/compatibility-guide.md` §十二（客户端包迁移、类型换位、`ctx.slots` 自声明、`agentPreset` 降级、运行时 API 变更表、e2e 基建要点）
- `plugin-framework/distribution-strategy.md` §1.1/§1.2/§2.2（0.1.5 拆分闭包、本插件实证行、`-0` 上界规范）
