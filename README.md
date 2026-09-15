# dsh-context-compression-improved

> An improved fork of [dsh-context-compression-selector](https://github.com/WilliamShi666/dsh-context-compression-selector) — an auditable tool-result context-compression selector for DeepSeek Harness — adding an orthogonal **code-skeleton compression gate**.

[中文说明](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Changelog](CHANGELOG.md) · [Installation guide](docs/installation.md)

> [!NOTE]
> **What this fork adds on top of upstream 0.1.0:**
>
> - An orthogonal **code-skeleton compression gate** (`codeSkeleton.enabled`, default off): the first exposure of an oversized fresh source-code tool result can keep a skeleton of imports and declarations — bodies elided, error lines kept — before the regular reducers run.
> - A settings toggle for that gate in the same selector settings section, independent of every compression profile.
> - An ESLint baseline wired into CI, a `test:watch` TDD loop, and documentation in English, Simplified Chinese, Japanese, and Korean.

> [!IMPORTANT]
> This project supports **DeepSeek models only**. Lossless measurement and lossy compression depend on the bundled official DeepSeek tokenizers (`deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp`). Everything else fails open and keeps original tool results. See the [upstream README](https://github.com/WilliamShi666/dsh-context-compression-selector#model-support-and-safety) for the full safety model.

## What it is

Long-running agent tasks accumulate a large amount of tool output. This community plugin adds selectable, auditable policies for reducing that tool-result context without modifying DeepSeek Harness core:

- **Fresh** pre-compresses a newly oversized tool-result segment before the model receives it.
- **Aggregate** pre-compresses fresh material again when it still grows beyond its budget.
- **History / micro-compact** replaces eligible old tool results while preserving recent working context.
- **TailTrim** is an optional Custom-only tail reduction path.
- **Native** preserves the Harness-style head/middle/tail trimming as one explicit profile.
- **Code skeleton (new, orthogonal gate)** — see below.

Every decision is recorded: stage, reducer, trigger, skip reason, and exact token counts where available.

## Code skeleton gate (new)

When the gate is enabled, an oversized **fresh source-code tool result** (for example a large `read_file`) first tries a skeleton reduction: imports and type/function/class declarations are kept, function bodies are elided with a marker, and error lines inside elided bodies are preserved. If the skeleton cannot be produced or verified, the result falls back to the original head pruning — the gate can never make context worse.

Properties:

- **Orthogonal**: independent of the selected profile (`balanced`, `savings`, `cache-strict`, `adaptive`, `custom`, `off`, `native`). All profiles get the gate.
- **Off by default**: `codeSkeleton: { enabled: false }` until you turn it on.
- **Measurement-gated**: requires the exact DeepSeek tokenizer; without it the plugin fails open.
- **Session-frozen**: like all selector settings, changes affect newly observed sessions only.
- **Strictly parsed**: `codeSkeleton` must be exactly `{ enabled: boolean }`; malformed values throw on the runtime side and show as unreadable in the browser UI.

## Settings UI

Choose a compression profile, set the Auto Compact trigger level, and toggle code-skeleton compression in the same settings section. The toggle saves on change and shows the saved state on reload.

![Context Compression Selector settings UI](docs/assets/context-compression-selector-settings.png)

## Install

Build and install from source (this fork is not yet published to npm; the internal package names intentionally stay upstream's):

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

Then pack the selector package and add it to a Harness profile — the full walkthrough, including verification and uninstall steps, is in the [installation guide](docs/installation.md).

## Development

```sh
pnpm install --frozen-lockfile
pnpm lint          # ESLint baseline (also enforced in CI)
pnpm typecheck     # runtime + selector + tests tsc, plus the bundle step
pnpm test          # full vitest suite
pnpm test:watch    # TDD loop: write the failing regression first, then make it pass
pnpm build
pnpm verify:release
```

Contributions follow the upstream discipline: add the failing regression first, keep every production change inside this repository, and explain “triggered”, “enabled but skipped”, and fail-open evidence separately. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Compatibility

- Verified against DeepSeek Harness `dsh-v0.1.1-rc.2` using public plugin and profile APIs only; compatible with the official `dsh-v0.1.2-alpha.5` release.
- Requires Node `^22.19.0 || >=24` and pnpm `11.7.0`.
- The plugin uses only public Harness extension APIs and does not modify Harness core code. Unofficial community project, not affiliated with or endorsed by DeepSeek.

## Credits and license

- Upstream project and all prior work: [WilliamShi666/dsh-context-compression-selector](https://github.com/WilliamShi666/dsh-context-compression-selector) by WilliamShi666 (MIT).
- Fork additions (code-skeleton gate, tooling, localized docs): drscrewdriver.
- MIT — see [LICENSE](LICENSE) (upstream copyright notice retained) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled tokenizer provenance.
