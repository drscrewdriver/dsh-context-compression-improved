# dsh-context-compression-improved

> [dsh-context-compression-selector](https://github.com/WilliamShi666/dsh-context-compression-selector) 的改进版 fork——面向 DeepSeek Harness 的可审计工具结果上下文压缩选择器，新增正交的**代码骨架压缩门**。

[English](README.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [更新日志](CHANGELOG.zh.md) · [安装教程](docs/installation.zh.md)

> [!NOTE]
> **本 fork 在上游 0.1.0 之上新增：**
>
> - 正交的**代码骨架压缩门**（`codeSkeleton.enabled`，默认关闭）：超大源码类工具结果首次曝光时，可先保留导入与声明的骨架——省略函数体并保留错误行——再进入常规 reducer。
> - 同一选择器设置区内新增该门的开关，独立于所有压缩 Profile。
> - 接入 CI 的 ESLint 基线、`test:watch` TDD 环路，以及英/中/日/韩四语文档。

> [!IMPORTANT]
> 本项目仅支持 **DeepSeek 模型**。无损测量与有损压缩依赖内置的 DeepSeek 官方 tokenizer（`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp`）。其余模型一律 fail-open 并保留原始工具结果。完整安全模型见[上游 README](https://github.com/WilliamShi666/dsh-context-compression-selector#model-support-and-safety)。

## 它是什么

长时运行的 agent 任务会积累大量工具输出。本社区插件在不修改 DeepSeek Harness 核心的前提下，提供可选、可审计的工具结果上下文压缩策略：

- **Fresh**：在模型收到之前，预压缩新近超限的工具结果段。
- **Aggregate**：当 Fresh 压缩后仍超出预算时再次预压缩。
- **History / micro-compact**：在保护近期工作上下文的前提下替换符合条件的旧工具结果。
- **TailTrim**：仅在 Custom 下可选的尾窗收缩路径。
- **Native**：把 Harness 原生头/中/尾裁剪保留为一个显式 Profile。
- **代码骨架（新增，正交门）**——见下节。

每个决策都会留痕：阶段、reducer、触发原因、跳过原因，以及可得时的精确 token 数。

## 代码骨架门（新增）

开启后，超大**源码类新工具结果**（例如大型 `read_file`）会先尝试骨架化压缩：保留导入与类型/函数/类声明，省略函数体并加占位标记，被省略函数体内的错误行予以保留。若骨架无法生成或无法通过验证，则回退到原有的头部裁剪——这道门不会让上下文变得更差。

特性：

- **正交**：独立于所选 Profile（`balanced`、`savings`、`cache-strict`、`adaptive`、`custom`、`off`、`native`），所有 Profile 都能拿到这道门。
- **默认关闭**：`codeSkeleton: { enabled: false }`，需要显式开启。
- **测量前置**：需要精确 DeepSeek tokenizer；不可用时 fail-open。
- **会话冻结**：与所有选择器设置一致，修改只影响新观察的会话。
- **严格解析**：`codeSkeleton` 必须恰好是 `{ enabled: boolean }`；畸形输入在运行时侧抛错、浏览器侧显示不可读。

## 设置界面

在同一设置区内选择压缩 Profile、调整 Auto Compact 触发水位，并开关代码骨架压缩。开关即改即存，刷新后显示已保存状态。

![Context Compression Selector 设置界面](docs/assets/context-compression-selector-settings.png)

## 安装

从源码构建并安装（本 fork 尚未发布 npm 包；内部包名有意保持与上游一致）：

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

随后打包 selector 包并安装到某个 Harness Profile——完整步骤（含验证与卸载）见[安装教程](docs/installation.zh.md)。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm lint          # ESLint 基线（CI 同步强制）
pnpm typecheck     # runtime + selector + tests tsc，含 bundle 步
pnpm test          # vitest 全量
pnpm test:watch    # TDD 环路：先写失败的回归用例，再让它通过
pnpm build
pnpm verify:release
```

贡献遵循上游纪律：先写失败的回归用例；所有生产改动收敛在本仓库内；对“已触发”“已启用但跳过”“fail-open”分别给出证据。见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 兼容性

- 仅使用公开的插件与 Profile API，针对 DeepSeek Harness `dsh-v0.1.1-rc.2` 验证；兼容官方 `dsh-v0.1.2-alpha.5` 版本。
- 需要 Node `^22.19.0 || >=24` 与 pnpm `11.7.0`。
- 插件只使用 Harness 公开扩展 API，不修改 Harness 核心代码。非官方社区项目，与 DeepSeek 无隶属或背书关系。

## 致谢与许可

- 上游项目与全部既有工作：[WilliamShi666/dsh-context-compression-selector](https://github.com/WilliamShi666/dsh-context-compression-selector)，作者 WilliamShi666（MIT）。
- fork 新增内容（代码骨架门、工具链、多语文档）：drscrewdriver。
- MIT——见 [LICENSE](LICENSE)（保留上游版权声明）；内置 tokenizer 来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
