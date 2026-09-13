# dsh-context-compression-improved-runtime

这是非官方社�?Bundle [`dsh-context-compression-improved`](https://github.com/WilliamShi666/dsh-context-compression-improved) 的内部运行时包。普通用户应安装入口 Bundle，不需要直接安装本包�?

本包提供确定性的 Fresh、Aggregate、History、Native 工具结果�?Custom TailTrim 压缩，插件自有的 `context_compression_retrieve` 恢复工具，结构化审计记录，以及固定版本的离线 DeepSeek V4 tokenizer。它只使�?DeepSeek Harness 的公开 API，兼�?`0.1.1-rc.2` �?`0.1.2-alpha.5`，不修改 Harness 核心�?

有损改写要求 replacement 前后取得�?revision �?exact count。明确验证过的模�?id �?`deepseek-v4-flash`、`deepseek-v4-pro` �?`deepseek-v4-flash-vision-exp`。视觉模型的文本计数使用独立固定�?`deepseek-ai/DeepSeek-V4-Flash-Vision-Exp` tokenizer。图�?token 使用由官�?golden fixtures 逐项验证的官方图像处理算术，并以 `tokenizer-estimate` 上报：有�?intrinsic 尺寸的四种对齐位置取中值，每张图片保留 384 token 上限；尺寸畸形或无法计算时固定计�?256 token。由于绝�?prompt 位置�?adapter 最终图片投影不可公开观测，该数值不标记�?exact。含图片的工具结果候选仍不具�?exact 资格并保持原样；未知模型、tokenizer 资产不可用、不安全工具组或文本计量不完整时继续 fail-open�?

审计日志�?`context-compression audit ` 开头，区分策略快照、组件关�?跳过、已提交 rewrite、fail-open 错误和已观察到的核心 `compaction/summary`。审计记录不包含 prompt 或工具结果正文�?

首次 `policy-frozen` 会携带完�?settings/deployment 快照。它通过 Harness logger 输出，因此保留期限由部署的日�?sink 决定；标�?prune/replacement Session event 仍是已提�?rewrite 的持久证据。本包不会在 `~/.dsh` 下硬编码私有路径�?

安装、Profile、兼容性、Adaptive/cache 限制与发布证据见[仓库 README](https://github.com/WilliamShi666/dsh-context-compression-improved#readme)。Tokenizer 来源与校验和�?`assets/deepseek-v4/manifest.json`、`assets/deepseek-v4-vision-exp/manifest.json` �?[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)�?
