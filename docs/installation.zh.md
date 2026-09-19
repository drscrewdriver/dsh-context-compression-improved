# 安装 dsh-context-compression-improved

> [English](installation.md) · [中文](installation.zh.md) · [日本語](installation.ja.md) · [한국어](installation.ko.md)

本教程从源码安装 fork。fork 亦已发布到 npm，dist-tag 为 `dsh-0.1.5`；包名有意与上游保持一致：
`dsh-context-compression-improved`（单一包 —— 原先独立发布的 runtime 包已并入其中）。

## 前置条件

- Node `^22.19.0 || >=24` 与 pnpm `11.7.0`（`corepack enable` 会按 `packageManager` 字段使用固定版本）。
- 兼容 `0.1.1-rc.2` peer 范围的 DeepSeek Harness（已针对官方 `dsh-v0.1.2-alpha.5` 验证）。
- DeepSeek 模型路由。有损压缩——包括代码骨架门——按字符基准决策，不再要求内建精确 tokenizer；存在内建 tokenizer 时其 exact 计数仅作遥测记录，其他路由 fail-open 并保留原始工具结果。
- Git。

## 1. 从源码构建

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` 会打包所有包的两套产物（`tsdown`）。如需在安装前先跑全量测试，可执行 `pnpm test`。

## 2. 打包 Bundle 入口包

selector 包是唯一的 Bundle 入口；runtime 作为其精确版本依赖自动随行：

```sh
cd packages/selector
pnpm pack
# → dsh-context-compression-improved-0.1.0.tgz
cd ../..
```

`pnpm pack` 会通过 `prepack` 钩子执行打包，因此 tarball 始终与你的检出内容一致。

## 3. 安装到 Harness Profile

selector 包声明了 Harness Bundle manifest 字段 `dsh.bundle.patch`，因此 `dsh plugin add` 是标准的树外 Bundle 安装方式：

```sh
dsh plugin --profile web add packages/selector/dsh-context-compression-improved-0.1.0.tgz
dsh --profile web --dump-config
```

安装后重启对应 Profile。配置导出中应显示 selector Bundle 已激活。**不要**分别安装或手动连接 selector 与 runtime 两个包——runtime 会自动安装。

## 4. 打开代码骨架门

打开 DeepSeek Harness 设置 → **上下文压缩选择器*：

1. 选择一个压缩 Profile（这道门与所有 Profile 正交）。
2. 按需调整 Auto Compact 触发水位（50–90%，默认 80%）。
3. 将**代码骨架压缩**设为**开**。开关即改即存。

与所有选择器设置一致，取值在会话首次观察时冻结——这道门只影响新观察的会话，不会改变正在运行的任务。

## 5. 可选：建议型相关度 advisor

插件可以对"会话历史还有多相关"做统计——仅建议性质，不做任何决策、也不阻断任何流程。默认关闭；本轮没有设置卡片，请直接编辑上下文压缩设置中的 `presetOptions` 段（settings JSON）：

```json
"presetOptions": {
  "advisorMode": "host",
  "advisorRefreshTurns": 8,
  "advisorScoreThreshold": 0.35,
  "advisorSampleLimit": 16,
  "advisorMinTokens": 250,
  "advisorTimeoutMs": 8000
}
```

`advisorMode: "host"` 走 harness `llm` 服务；`"direct"` 复用 estimator 的
`estimatorBaseUrl` / `estimatorApiKey` / `estimatorModel` 端点。每个 turn 边界，advisor
会：(1) 从最近的 `todo/write` 事件总结当前任务语义；(2) 对历史 tool result 做"内容+注释
语义 ↔ 当前任务"的增量相关度打分；(3) 记录前缀腐化度（prefix-decay）。结果以
`advisor-outcome` 审计记录呈现；部署配置打开 `advisorReportRoute: true` 后，还可经只读
HTTP 路由 `GET .../advisor-report?sessionId=` 读取。advisor 报告的任何内容都不会抑制、
延迟或改写任何本应落地的 reduction。

## 6. 更新或卸载

```sh
# 更新：拉取、重建、重新打包、再次添加新 tarball
git pull && pnpm install --frozen-lockfile && pnpm build
cd packages/selector && pnpm pack && cd ../..
dsh plugin --profile web add packages/selector/dsh-context-compression-improved-0.1.0.tgz

# 卸载
dsh plugin --profile web remove dsh-context-compression-improved
```

## 故障排除

- **配置导出中 Bundle 未激活**：重启 Profile；确认添加的是 selector 入口包（而非 runtime），且 Harness 版本在兼容的 peer 范围内。
- **工具结果从未被骨架化压缩**：该门默认关闭，请检查开关。压缩只作用于新鲜、超大、源码类的工具结果（决策按字符基准执行，无精确 tokenizer 路由要求），且每次跳过都会在审计记录中留有原因。
- **开关显示为不可读**：已存的 `codeSkeleton` 段未通过严格的浏览器解码（必须恰好是 `{ enabled: boolean }`）。删除畸形段即可恢复默认。
- **升级步骤失败**：插件遵循 npm 包语义；如果你的 Harness 构建拒绝 tarball 到 tarball 的升级，请先移除旧版本再安装。
