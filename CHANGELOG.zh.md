# 更新日志（fork 新增条目）

> 完整历史（含上游 0.1.0 及更早版本）见 [CHANGELOG.md](CHANGELOG.md)。本文件只翻译本 fork 的新增条目。 · [English](CHANGELOG.md) · [日本語](CHANGELOG.ja.md) · [한국어](CHANGELOG.ko.md)

## 0.1.1

### 新增

- `scripts/` 的 TypeScript 工具链：`verify-release`、`packed-components-smoke` 和 `packed-install-e2e` 现为 `.ts` 源文件，通过 `tsc` 编译至 `scripts-dist/`，消除仓库中最后三个非 TS 源文件。

### 变更

- `package.json` 脚本 `test:e2e:packed` 和 `verify:release` 现运行 `scripts-dist/` 中的编译产物。
- 估计器目录路由注册加固：`asWebServer` 直接返回 service 本身（D7 修复），估计器 UI 在未激活时保留区块标题而非隐藏（U1 修复）。
- 框架文档更正：行级 `inject: [webServer]` 非承载性（Y22）；DSH 中无 `isolate()` 实例。

### 修复

- 估计器目录路由自始至终从未注册，因 `asWebServer` 使 `register` 脱离 service（D7）。
- 非 TokenPilot Profile 下估计器区块静默消失，无任何启用提示（U1）。

## Unreleased（未发布）

### 新增

- 正交的代码骨架压缩门（`codeSkeleton.enabled`，默认关闭）：超大源码类工具结果首次曝光时，可保留导入与声明的骨架——省略函数体并保留错误行——失败时回退到原头部裁剪。这道门独立于所有 Profile，且以精确 tokenizer 测量为前提。
- 选择器设置区内新增该门的开关，附简体中文与英文文案。
- 新增段的浏览器/运行时解码对齐测试、`saveCodeSkeleton` 的 confirm-on-write 契约测试，以及全文档 parity 矩阵扩展。

### 变更

- 新增 ESLint 平铺配置基线（`pnpm lint`，CI 同步强制）与 `pnpm test:watch` TDD 环路；清理死导入，并修复 lint 基线暴露的两处错误处理路径。
- 本仓库现为 `WilliamShi666/dsh-context-compression-selector` 的改进版 fork；文档提供英、简中、日、韩四种语言。

### 修复

- 估计器卡片在 Harness 宿主通道上不再要求 API Key。选择宿主通道后只显示实时供应商/模型下拉框，并标出当前真正生效的路由（显式覆盖优先，否则跟随会话默认模型）；既不显示密钥输入框，也不再有第二个手填模型输入——端点地址、模型文本框与只写密钥均只属于直连端点通道。
- `presetOptions` 写入改为保留同级字段。`settingsScope.set('presetOptions', patch)` 会替换整个分节，导致再改动估计器的任何一个字段（供应商、模型、端点）都会删掉 `estimatorMode` 及其余全部覆盖值——估计器被静默关回关闭状态，而面板却报告保存成功。现在补丁会合并到已存分节之上，`undefined` 只清除指名的那一个字段，空改动不写盘，且 confirm-on-write 校验同一组字段而非仅校验通道。
- 新增回归覆盖：`packages/selector/tests/preset-options-write.client.spec.ts`（合并写入、保留同级字段、显式清除、空改动不写、未提交写入的报错）与 `packages/selector/tests/estimator-channel.client.spec.tsx`（各通道字段、目录下拉框、手填回退）。
