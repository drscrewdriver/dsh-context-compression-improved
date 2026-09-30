# dsh-context-compression-improved

这是可直接安装的非官方社区 DeepSeek Harness 上下文压缩选择器 Product Bundle。

**0.1.0 更新：**已加入 DeepSeek V4 Flash 视觉模型的官方 tokenizer；用户可选择模型驱动 Auto Compact 的触发阈值；标准 Profile 的水位与压缩参数会随该选择联动。

```sh
```sh
dsh plugin --profile web add dsh-context-compression-improved@dsh-0.1.5
# DSH 0.1.2 line:
# dsh plugin --profile web add dsh-context-compression-improved@dsh-0.1.2
dsh --profile web --dump-config
```
dsh --profile web --dump-config
```

这一条命令会安装 Bundle 及其固定版本的 `@huggingface/tokenizers` 依赖，不再需要单独的 runtime 包。Bundle 提供 Host 设置、Web UI 和可逆的 preset overlay。除 id 精确等于内置 `minimal` 的 preset 外，其他 preset 都会获得压缩能力；非 Minimal preset 之间切换时已保存设置保持不变。Minimal 只暂停插件压缩，不删除设置。

## 本包能力

本包提供确定性的 Fresh、Aggregate、History、Native 工具结果与 Custom TailTrim 压缩，插件自有的 `context_compression_retrieve` 恢复工具，结构化审计记录，以及固定版本的离线 DeepSeek V4 tokenizer。它只使用 DeepSeek Harness 的公开 API，兼容 `0.1.1-rc.2` 与 `0.1.2-alpha.5`，不修改 Harness 核心。

有损改写要求 replacement 前后取得同 revision 的 exact count。明确验证过的模型 id 为 `deepseek-v4-flash`、`deepseek-v4-pro` 与 `deepseek-v4-flash-vision-exp`。视觉模型的文本计数使用独立固定的 `deepseek-ai/DeepSeek-V4-Flash-Vision-Exp` tokenizer。图像 token 使用由官方 golden fixtures 逐项验证的官方图像处理算术，并以 `tokenizer-estimate` 上报：有效 intrinsic 尺寸的四种对齐位置取中值，每张图片保留 384 token 上限；尺寸畸形或无法计算时固定计为 256 token。由于绝对 prompt 位置与 adapter 最终图片投影不可公开观测，该数值不标记为 exact。含图片的工具结果候选仍不具备 exact 资格并保持原样；未知模型、tokenizer 资产不可用、不安全工具组或文本计量不完整时继续 fail-open。

审计日志以 `context-compression audit ` 开头，区分策略快照、组件关闭/跳过、已提交 rewrite、fail-open 错误和已观察到的核心 `compaction/summary`。审计记录不包含 prompt 或工具结果正文。

首次 `policy-frozen` 会携带完整 settings/deployment 快照。它通过 Harness logger 输出，因此保留期限由部署的日志 sink 决定；标准 prune/replacement Session event 仍是已提交 rewrite 的持久证据。本包不会在 `~/.dsh` 下硬编码私有路径。

已验证兼容：DeepSeek Harness `dsh-v0.1.1-rc.2` 与 `dsh-v0.1.2-alpha.5`，Node `^22.19.0 || >=24`。不需要修改 Harness 核心。

Profile、默认值、审计证据、Adaptive/cache 限制、升级/卸载与安全说明见[完整 README](https://github.com/WilliamShi666/dsh-context-compression-improved#readme)。Tokenizer 来源与校验和在 `assets/deepseek-v4/manifest.json`、`assets/deepseek-v4-vision-exp/manifest.json`，并汇总于 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本包与 DeepSeek 无隶属或背书关系。
