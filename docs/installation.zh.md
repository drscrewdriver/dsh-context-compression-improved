# 安装 dsh-context-compression-improved

> [English](installation.md) · [中文](installation.zh.md) · [日本語](installation.ja.md) · [한국어](installation.ko.md)

本教程从源码安装本 fork。fork 尚未发布 npm 包；内部包名有意保持与上游一致（`dsh-context-compression-selector` 及其精确版本依赖 `dsh-context-compression-selector-runtime`）。

## 前置条件

- Node `^22.19.0 || >=24` 与 pnpm `11.7.0`（`corepack enable` 会按 `packageManager` 字段使用固定版本）。
- 兼容 `0.1.1-rc.2` peer 范围的 DeepSeek Harness（已针对官方 `dsh-v0.1.2-alpha.5` 验证）。
- DeepSeek V4 模型路由（`deepseek-v4-flash`、`deepseek-v4-pro` 或 `deepseek-v4-flash-vision-exp`）。有损压缩——包括代码骨架门——依赖内置的精确 tokenizer；其他路由 fail-open 并保留原始工具结果。
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
# → dsh-context-compression-selector-0.1.0.tgz
cd ../..
```

`pnpm pack` 会通过 `prepack` 钩子执行打包，因此 tarball 始终与你的检出内容一致。

## 3. 安装到 Harness Profile

selector 包声明了 Harness Bundle manifest 字段 `dsh.bundle.patch`，因此 `dsh plugin add` 是标准的树外 Bundle 安装方式：

```sh
dsh plugin --profile web add packages/selector/dsh-context-compression-selector-0.1.0.tgz
dsh --profile web --dump-config
```

安装后重启对应 Profile。配置导出中应显示 selector Bundle 已激活。**不要**分别安装或手动连接 selector 与 runtime 两个包——runtime 会自动安装。

## 4. 打开代码骨架门

打开 DeepSeek Harness 设置 → **上下文压缩选择器**：

1. 选择一个压缩 Profile（这道门与所有 Profile 正交）。
2. 按需调整 Auto Compact 触发水位（50–90%，默认 80%）。
3. 将**代码骨架压缩**设为**开**。开关即改即存。

与所有选择器设置一致，取值在会话首次观察时冻结——这道门只影响新观察的会话，不会改变正在运行的任务。

## 5. 更新或卸载

```sh
# 更新：拉取、重建、重新打包、再次添加新 tarball
git pull && pnpm install --frozen-lockfile && pnpm build
cd packages/selector && pnpm pack && cd ../..
dsh plugin --profile web add packages/selector/dsh-context-compression-selector-0.1.0.tgz

# 卸载
dsh plugin --profile web remove dsh-context-compression-selector
```

## 故障排除

- **配置导出中 Bundle 未激活**：重启 Profile；确认添加的是 selector 入口包（而非 runtime），且 Harness 版本在兼容的 peer 范围内。
- **工具结果从未被骨架化压缩**：该门默认关闭，请检查开关。压缩只作用于精确 tokenizer 路由上新鲜、超大、源码类的工具结果，且每次跳过都会在审计记录中留有原因。
- **开关显示为不可读**：已存的 `codeSkeleton` 段未通过严格的浏览器解码（必须恰好是 `{ enabled: boolean }`）。删除畸形段即可恢复默认。
- **升级步骤失败**：插件遵循 npm 包语义；如果你的 Harness 构建拒绝 tarball 到 tarball 的升级，请先移除旧版本再安装。
