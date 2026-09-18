# Changelog

All notable changes use this file. The project follows semantic versioning after `0.1.0`.

## Unreleased (feat/ctx-compression-v2-compat015)

### Added

- Batch-level benefit pricing (R1): a review pass is priced as ONE merged mutation — the
  tail KV-cache refill penalty is paid once per batch instead of per candidate, so real
  batches (5×50k with a 64k tail) reach the auto band instead of all dropping.
- Original-event line mapping (R9a): terminal normalization returns folded lines that each
  carry their 1-based original-event line number; `retrieve` reads raw events, so printed
  ranges resolve to the right lines.
- Document skeleton and universal prose keep (R8/R8b): structured documents keep headings,
  section first/last lines, list starts and table headers; every other non-code text keeps
  head AND tail with an R9 line-range marker (prose was previously head-only truncated).
- Two-tier search folding (R10, fixes D8): a lossless per-file L1 locator plus a
  water-filled L2 content quota.
- Non-adjacent frequency folding (R11): separated exact repeats (up to 8.37% of large
  results) fold to first occurrence plus one counted marker.
- Long-string placeholders (R12): base64/hex/UUID blobs become length summaries with a
  16-char recognition prefix.
- Two-stage HTML reduction (R13, fixes D9): `html-slim` then `html-skeleton`, line-aligned
  so original line numbers survive.
- R9b anchors: contiguous masks cite original line ranges, scatter masks report
  `lines 1-N scanned, K kept`, and every retrieve hint carries a pasteable
  `{"ref":…,"start_line":N,"max_lines":80}`.
- Document census: omitted-document summaries list section headings instead of a constant
  `0 error, 0 warn, N info` histogram.

## Unreleased (compat/0.1.5)

### Changed

- The runtime package is merged into the selector package: one install brings the whole
  stack, the repository root is the install surface (`name`, `main`, `types`, `exports` with
  `./pruner` and `./invariant`, `dependencies`, `dsh`), and the toolchain, scripts and CI were
  swept to the single package. The verified estimator-catalog registration (dual prefix, guarded
  two-channel activation, per-request service resolution, visible lifecycle lines) was replayed
  onto this line with a host-side guard; the settings schema that `ab2175a` had downgraded to
  `z.any()` is restored, so the daily Custom defaults are published again.
- Adapt to the official DeepSeek Harness `v0.1.5-rc.2` on this branch. All `@deepseek-ai/dsh-*` dev dependencies and the pinned e2e host set move from `0.1.1-rc.2` to `0.1.5-rc.2` (cordis `4.0.2`, schemastery `3.18.2`), including the new split packages (`dsh-session-projection`, `dsh-session-persistence`, `dsh-atomic-write`, `dsh-home-paths`, `dsh-sandbox`, and related) and the `dsh-client-store` client stack.
- Surface replace operations now use the v3 `startSeq`/`endSeq` shape with branded `SessionSeq` values; `compaction/prune` manifests keep the durable `start`/`end` fields. Events are resolved from surface nodes by seq lookup instead of array indexing.
- The client bundle no longer imports the removed `@deepseek-ai/dsh-client-runtime`: settings types now come from `@deepseek-ai/dsh-client-ui-settings` and the session hooks merge from `@deepseek-ai/dsh-client-ui-session`. `engines.dsh >=0.1.5-alpha.1 <0.2.0-0` is declared in both package manifests and `dsh.plugin.json`.
- Harness 0.1.5 no longer exposes the session `agentPreset` to the browser, so the client can no longer detect Minimal-only sessions; the selector stays selectable and the old unavailable banner is unreachable.
- Test batteries updated for 0.1.5 semantics: cordis plugin starts require `.await()`, the Token Meter requires a mounted `SessionProjectionRegistry`, assistant events carry `stream: []`, and settings namespaces are plain strings.

### Fixed

- The estimator card no longer demands an API key on the Harness host channel. Selecting the host channel shows the live provider/model dropdowns, names the route that would actually run (explicit override, else the session default), and renders neither a key field nor a second manual model input: the base URL, the model text field, and the write-only key belong to the direct endpoint channel alone.
- `presetOptions` writes are path-addressed. Writing the whole section replaced it, so touching any second estimator field (a provider, a model, an endpoint) deleted `estimatorMode` and every sibling override — silently switching the estimator back off while the panel still reported a successful save. Each field now writes only itself, `undefined` clears exactly the field it names, and the confirmation read validates the same field set instead of the mode alone.
- New coverage: `packages/selector/tests/preset-options-write.client.spec.ts` (path-scoped writes, sibling preservation, explicit clears, no-op patches, uncommitted-write reporting) and `packages/selector/tests/estimator-channel.client.spec.tsx` (per-channel fields, catalog dropdowns, manual fallback).


### Added

- New `tokenpilot-inspired` profile: a TokenPilot-paper-inspired capability matrix layered on the Balanced thresholds, selected explicitly from the settings UI; every pre-existing profile keeps a byte-identical resolved policy (enforced by a captured-baseline golden test).
- Byte-identical repeated tool-result dedup: an oversized repeat is replaced with a pointer to the first occurrence's append-only original event (`dedupe-pointer`), with a per-session SHA-256 index (2,048-entry insertion-order eviction, hash+seq metadata only).
- No-net-savings guard: replacements whose text is not smaller than the original are rejected even when the exact tokenizer reports a token saving.
- Recovery exemption: recovery-tool output is permanently exempt from every reduction pass via a unified per-session exemption set, preventing compress-restore oscillation.
- Auto Compact summary locator: after `compaction/end`, the landed summary checkpoint gains an Exact Sources block (shadowed seq range, spill files, touched files) so summarized-away details stay recoverable; skipped when it would locate nothing concrete.
- Read-state semantics: a historical read whose file was later mutated is `superseded` and takes the small whole-result placeholder; optional error/warn/info clustering of omitted lines is appended to historical placeholders.
- Optional residual-utility estimator (three channels: off / Harness host model / direct OpenAI-compatible endpoint) with per-session exponential backoff, strict timeout, advisory-only verdicts consumed by the next pressure pass, and numeric-only `estimator-outcome` audits. The estimator card appears only while the new profile is selected; the API key is write-only in settings and never enters the frozen policy, audits, or logs.
- New audit records: `summary-locator` and `estimator-outcome`; the rewrite record covers dedup via the `dedupe-pointer` reducer. Audit field allowlists are unchanged.
- Simplified Chinese and English copy for the new profile and estimator card; unit and golden coverage under `packages/runtime/tests/tokenpilot/`.

- Orthogonal code-skeleton compression gate (`codeSkeleton.enabled`, default off): the first exposure of an oversized fresh source-code tool result can keep an imports-and-declarations skeleton with bodies elided and error lines preserved, falling back to the original head pruning. The gate is independent of every profile and gated on exact tokenizer measurement.
- Settings-UI toggle for the gate in the selector settings section, with Simplified Chinese and English copy.
- Browser/runtime decode parity for the new section, confirm-on-write contract tests for `saveCodeSkeleton`, and a full-document parity matrix extension.

### Changed

- Added an ESLint flat-config baseline (`pnpm lint`, enforced in CI) and a `pnpm test:watch` TDD loop; removed dead imports and hardened two error paths surfaced by the lint baseline.
- This repository is now maintained as an improved fork of `WilliamShi666/dsh-context-compression-selector`; documentation ships in English, Simplified Chinese, Japanese, and Korean.

## 0.1.0 - 2026-09-03

### Added

- Stable release of DeepSeek V4 Flash Vision tokenizer integration for `deepseek-v4-flash-vision-exp`, including exact text counting and bounded image-token estimates.
- User-configurable model-driven Auto Compact threshold in the selector settings section.
- Auto Compact threshold linkage for each standard profile's History / micro-compact watermarks and related compression parameters.

### Changed

- The threshold editor now uses one direct numeric input; the slider and fixed quick-value buttons were removed.
- Runtime session-event access supports both the established Harness `events` accessor and the newer `snapshotEvents()` public API.

## 0.1.0-beta.4 - 2026-09-02

### Fixed

- Support the official DeepSeek Harness `dsh-v0.1.2-alpha.5` public API while retaining compatibility with the existing `0.1.1-rc.2` peer range. The plugin now owns the two small immutable-value helpers that the newer Harness no longer exports, and uses the same public `context-compression` namespace literal accepted by both Settings implementations. No Harness core code is modified.

## 0.1.0-beta.3 - 2026-09-01

### Scope

This is a staged release. Exact **text-class** token counting for `deepseek-v4-flash-vision-exp`, best-effort bounded **vision-class image** estimates, and the Auto Compact threshold/UI/audit work are delivered. Exact image measurement remains **BLOCKED upstream**: the current measurement seam exposes neither the adapter's projected request-image dimensions nor the absolute serialized position, so estimates cannot be promoted to `exact-tokenizer`.

### Added

- DeepSeek V4 Flash Vision support for `deepseek-v4-flash-vision-exp` via a separately bundled official tokenizer pinned at `deepseek-ai/DeepSeek-V4-Flash-Vision-Exp` revision `6821d6ad3681a4b137b066b76094fa82ebd0a380`. Text, reasoning, tool-call arguments, and pure-text tool results are counted exactly; image-bearing tool-result candidates stay fail-open.
- Vision image-token arithmetic ported line-by-line from the official `inference/image_processor.py` (patch size 14, downsample 3, 384-token cap, min pixels 147456, 8:1 aspect clamp, and position-dependent alignment padding), validated against golden fixtures generated by executing the official Python implementation. Valid intrinsic dimensions now produce `tokenizer-estimate` at the midpoint of all four alignment residues with a 384-token per-image upper bound; malformed or unevaluable dimensions use a documented 256-token fallback. Mixed text/image surfaces aggregate exact text and estimated images without promoting them to exact.
- `autoCompact.thresholdPercent` setting (default 80, integer 50–90, step 1) with one shared validation contract across the settings UI, the persisted schema, and the runtime resolver. The editor lives inside the context-compression selector settings section.
- Standard-profile History linkage to the Auto Compact watermark: `A = floor(C × a)` rescales the History trigger, minimum reclaim, and recent-token tail; `D = floor(A × 0.875)` replaces the fixed 0.7 capacity-pressure ratio as the micro-compact last-chance gate; one batch must justify its cache break by pulling the complete request back below the deadline. Defaults at 80% reproduce the previous numbers exactly.
- The preset overlay writes the saved threshold into the generated `compaction-basic` composition as `thresholdRatio` (with `retainRatio` pinned at 0.16) and, from the same read, into the plugin runtime's deployment config as `autoCompactThresholdPercent`, so one standing generation never runs Auto Compact and micro compact on two different thresholds. Any generation-identity change — threshold, source, or module paths, including equal-length ones — produces a new standing composition generation. Deterministic identity-derived stamps use an 8-hex whole-second window; equal-prefix identities can collide in that first window on a coarse filesystem, so the overlay observes the staging file's real `mtimeMs+size` key and escalates to later hash windows before the atomic rename. Content, permissions, and the final unique stamp are complete before publication; already-running sessions keep their frozen policy.
- `policy-resolved` audits now record the Auto Compact coordination facts (threshold percent, `A`, `D`, parameter source — including `deployment-override`/`mixed` when deployment config replaces linked History watermarks), the routed provider/model, and the bundled tokenizer identity.
- Persisted settings reject present-but-invalid sections (`profile: null`, `custom: null`, own-property `undefined`) before any schema default can absorb them; a malformed stored document freezes the session losslessly (`profile: off`, audited as `settingsInvalidFallback: lossless-off`) instead of silently enabling the lossy Balanced default. The browser decoder applies the same rule and canonicalizes legacy Custom v1/v2 documents to the same v3 document the runtime resolver produces.
- The History planner returns a discriminated outcome, and `component-evaluation` audits distinguish the full skip taxonomy: `below-profile-trigger`, `below-micro-deadline`, `exact-tokenizer-unavailable`, `no-safe-candidates` (only recovery-tool output or already-cleared results), `protected-working-set` (everything inside the protected tail), `insufficient-reclaim` and `cannot-reach-deadline-target` (with the reached/required token numbers), `adaptive-cost-rejected`, and `recovery-tool-unavailable`.

### Known limitations

- Images never claim exact counts. The official expansion depends on the absolute prompt position (system prompt, chat-template framing, adapter image handles) and on the adapter's final request-image projection (including per-route `imagePixelBudget`/`imageDetail` overrides and byte-cap reprojection), none of which is exposed through the current measurement seam. Intrinsic/default estimates may therefore differ materially from provider accounting. Upstream capability requests remain projected request-image dimensions and the absolute serialized position exposed to token-meter extensions.
- History skips the whole batch whenever any tool-result candidate lacks an exact count, including image-bearing candidates, even though sibling text candidates are individually exact.
- Custom remains manual token mode; its History parameters do not follow the Auto Compact watermark.
- A vision token breakdown UI is not shipped; image estimates and the intrinsic alignment diagnostic are available on the measured token view, while lossy rewrite proofs still require exact counts.

### Deferred

- Audit `modality` field and the tokenizer artifact SHA-256 inside audit records (the audits already carry the routed provider/model and tokenizer identity).
- Publishing the (now complete) runtime skip-reason taxonomy as a user-facing documentation table.
- Custom-profile display of the A/D watermarks and an above-D warning; Custom remains fully manual.
- Vision token breakdown UI and promotion of image estimates to exact measurement.

## 0.1.0-beta.2 - 2026-08-28

### Fixed

- Resolve the official DeepSeek V4 Flash tokenizer route so Fresh and Aggregate can evaluate tool results for the supported V4 models.
- Run Cache Strict History at the real request boundary once its configured capacity-pressure condition is met; trigger the capacity condition at 70% routed-context utilization.
- Disable Harness-native head/middle/tail tool-result pruning whenever a selector profile is active, leaving the selector as the sole tool-result compactor.

### Changed

- Protect the newest 10 agent tool calls and a 64,000-token tool-result tail window before History/microcompact rewrites older results.

## 0.1.0-beta.1 - 2026-08-27

### Added

- One-install DeepSeek Harness Product Bundle backed by a separate exact-version runtime package.
- Web profile selector with preset-stable settings and an explicit built-in Minimal exception.
- Fresh, Aggregate, routine/capacity-aware History, Native tool-result pruning, and default-off Custom TailTrim.
- Standard-event TailTrim protocol using `compaction/prune` plus recoverable `user/message` replacement.
- Plugin-owned `context_compression_retrieve` recovery tool.
- Structured, content-free policy, evaluation, rewrite, failure, and Native auto-compact audit records.
- Pinned official DeepSeek V4 tokenizer assets with runtime SHA-256 validation and upstream license.
- Public-API component E2E, preset/Minimal, and parent/fork/spawn cache-prefix regression tests.

### Compatibility

- Verified against DeepSeek Harness `dsh-v0.1.1-rc.2` public packages.
- Exact tokenizer mapping is currently limited to `deepseek-v4-flash` and `deepseek-v4-pro`.

### Known limitations

- Adaptive ordinary History fails closed when public request-level route/cache evidence is incomplete; capacity pressure remains a separate safety override.
- Cache-prefix tests prove native fork inheritance and identical serialized prefixes, not a provider-specific cache allocation or a guaranteed DeepSeek cache hit.
- Settings snapshots and first-exposure decisions are process-local to the mounted runtime.
