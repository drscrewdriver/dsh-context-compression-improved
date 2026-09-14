# dsh-context-compression-improved

The installable Product Bundle for the unofficial community DeepSeek Harness context-compression selector.

**0.1.0 highlights:** DeepSeek V4 Flash Vision's official tokenizer is included; users can choose the model-driven Auto Compact threshold; standard profile watermarks and compression parameters follow that choice.

```sh
dsh plugin --profile web add dsh-context-compression-improved@latest
dsh --profile web --dump-config
```

This one command installs the Bundle and its pinned `@huggingface/tokenizers` dependency; there is no separate runtime package. The Bundle contributes Host settings, the Web UI, and a reversible preset overlay. All presets except the exact built-in `minimal` id receive the compression stack; switching non-Minimal presets preserves the saved selector settings. Minimal pauses plugin compression without deleting the setting.

## What it provides

It provides deterministic Fresh, Aggregate, History, Native tool-result, and Custom TailTrim compression; a plugin-owned `context_compression_retrieve` recovery tool; structured audit records; and a pinned offline DeepSeek V4 tokenizer. It uses only public DeepSeek Harness APIs and supports both `0.1.1-rc.2` and `0.1.2-alpha.5`; it does not patch Harness core.

Lossy rewrites require exact same-revision counts before and after replacement. Verified model ids are `deepseek-v4-flash`, `deepseek-v4-pro`, and `deepseek-v4-flash-vision-exp`. Vision text counting uses the separately pinned `deepseek-ai/DeepSeek-V4-Flash-Vision-Exp` tokenizer. Vision images use the official image-processor arithmetic validated against official golden fixtures and are reported as `tokenizer-estimate`: the four alignment residues over valid intrinsic dimensions are collapsed to their midpoint, with 384 tokens retained as the per-image upper bound; malformed or unevaluable dimensions use a fixed 256-token fallback. The estimate is not exact because the absolute prompt position and the adapter's final image projection are not publicly observable. Image-bearing tool-result candidates remain exact-ineligible and intact; unknown models, unavailable tokenizer assets, unsafe tool groups, and incomplete text measurements still fail open.

Audit log records use the prefix `context-compression audit ` and distinguish policy snapshots, skipped/disabled components, committed rewrites, fail-open errors, and observed core `compaction/summary` events. No audit record contains prompt or tool-result content.

The first `policy-frozen` record carries the complete settings/deployment snapshot. It is emitted through the Harness logger, so its retention follows the configured log sink; standard prune/replacement Session events remain the durable proof of committed rewrites. This package does not hard-code a private path below `~/.dsh`.

Verified compatibility: DeepSeek Harness `dsh-v0.1.1-rc.2` and `dsh-v0.1.2-alpha.5`, Node `^22.19.0 || >=24`. No Harness core patch is required.

See the [full README](https://github.com/WilliamShi666/dsh-context-compression-improved#readme) for profiles, defaults, audit evidence, Adaptive/cache limitations, upgrade/removal, and security guidance. Tokenizer provenance and checksums are in `assets/deepseek-v4/manifest.json` and `assets/deepseek-v4-vision-exp/manifest.json`, summarized in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). This package is not affiliated with or endorsed by DeepSeek.
