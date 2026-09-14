# 更新日志（fork 新增条目）

> 完整历史（含上游 0.1.0 及更早版本）见 [CHANGELOG.md](CHANGELOG.md)。本文件只翻译本 fork 的新增条目。 · [English](CHANGELOG.md) · [日本語](CHANGELOG.ja.md) · [한국어](CHANGELOG.ko.md)

## Unreleased（compat/0.1.5 分支）

### Changed

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
