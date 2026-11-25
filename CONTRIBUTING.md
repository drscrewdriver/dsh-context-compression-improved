# Contributing

Thank you for helping improve this community plugin.

## Three-Stage Refactor Pipeline (since v0.13.1)

All profile-default-value changes MUST follow this pipeline:

1. **Lock baseline** — Before touching implementation, add/update `tests/runtime/behavior-lock-*.spec.ts` asserting the CURRENT behavior verbatim. The test must pass against existing code.
2. **Add configuration** — Introduce the new setting (e.g., `minNetGain`, `cardMerge`, `flash-tuned` profile). Default must produce identical behavior to the locked baseline (backward-compatible).
3. **Matrix verification** — After merging the behavior change, update the behavior-lock to the new expected values and verify all profile × parameter combinations via the test matrix.

CI gate: PRs modifying `profiles.ts` defaults or `COMPRESSION_PROFILES` enumeration without a corresponding `behavior-lock` diff will fail the release check.

---
1. Open an issue before large behavior or compatibility changes.
2. Keep every production change inside this repository; do not require a DeepSeek Harness core patch.
3. Add a failing regression first for compression, surface/recovery, preset, tokenizer, or cache-prefix behavior.
4. Run:

   ```sh
   pnpm install --frozen-lockfile
   pnpm test
   pnpm typecheck
   pnpm build
   pnpm verify:release
   pnpm pack:dry-run
   ```

5. Never commit API keys, `.env` files, real Session logs, prompts/tool results, user paths, generated tarballs, or NPM tokens.
6. Read [`docs/repair-log.md`](docs/repair-log.md) before starting a new branch or version. It is the cross-version ledger of install/boot defects; a class recorded there must be re-checked on every new line instead of being rediscovered. Note in particular that `lib/` is committed, so a built chunk an entry imports must be committed in the same change — `pnpm verify:release` enforces it — and that the tokenizer assets are content-addressed, so a checkout that rewrites their line endings breaks every consumer (the release gate now fails on CR bytes).

Pull requests should explain the evidence for “triggered”, “enabled but skipped”, and fail-open behavior separately. A code path existing is not runtime proof. Changes to tokenizer/model compatibility require an official source, pinned revision, license, byte length, SHA-256, and negative tests.
