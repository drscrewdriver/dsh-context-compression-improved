# Repair log

Cross-version ledger of defects that break the **install / boot** path. Every branch and
version must leave its verdict here (affected / unaffected / fixed) before it ships.

Read this file before starting a new line (see `CONTRIBUTING.md`). A defect class already
recorded here is expected to be *re-checked*, not re-discovered.

- One defect, one `D#` id.
- One entry must contain: symptom / root cause / evidence / affected surface / fix / verification.
- Evidence means a command and its observed output, not a description of the code.

---

## D1 — Host plugin entry statically imports a sibling package

**Symptom.** `dsh web` aborts while loading the plugin tree:

```text
failed to import loader entry context-compression-improved-bundle
(dsh-context-compression-improved): Cannot find package
'dsh-context-compression-improved-runtime' imported from
<profile>/node_modules/dsh-context-compression-improved/packages/selector/lib/index.js
code: 'ERR_MODULE_NOT_FOUND'
```

**Root cause.** The repository was installed whole via a git dependency, so pnpm only
installs what the **root** manifest declares. The root manifest declared no
`dependencies`, so the sibling package was never materialized — and
`packages/selector/lib/index.js:3` uses a top-level static `import` of it, which throws
during module evaluation.

**Cascade.** The Host entry never loads → `settings.register('context-compression', …)`
never runs → the browser `SettingsScopeSnapshot.writable` stays at its initial `false` →
every control in the settings panel renders `disabled`. The panel itself is still visible
because the client bundle is resolved from `dsh.client` metadata and is unaffected by this
failure.

**Evidence (committed artifacts, not a working tree).**

| Branch | `packages/selector/lib/index.js` |
| --- | --- |
| `feat/ctx-preset-v2` @ `455f74f` | `L3: import { … } from "dsh-context-compression-improved-runtime";` — the crash site |
| `compat/0.1.5` @ `d7c592d` | no top-level import; only `modulePath("…-runtime", import.meta.resolve("…-runtime"))` |

**Affected.** `feat/ctx-preset-v2` (the crash itself).

**Fix.** Merge into a single package: the entry imports `./runtime/config.ts` from inside
its own package.

**Verification.** `grep` over `lib/**/*.js` must find no
`from "dsh-context-compression-improved-runtime"`. The frozen provenance literal (D5 note
below) is the only remaining occurrence and is required.

**Status.** Fixed on the merge branch.

---

## D2 — Root manifest missing the install contract

**Symptom.** `dsh plugin add github:<owner>/<repo>` completes, yet the profile gains no
usable plugin: no bundle row, no resolvable entry.

**Root cause.** A git install reads the **root** manifest. Without `main` / `exports` /
`dsh.client.inject` / `dsh.bundle.patch` there is nothing for the harness to mount; and if
the root name is still a private workspace name with `"private": true`, pnpm installs a
private package nothing can load.

**Evidence.**

| Branch | Root manifest |
| --- | --- |
| `feat/ctx-preset-v2` @ `455f74f` | correct name, has `main`/`exports`/`dsh`; but `dependencies` **empty**, `exports` missing `./pruner` and `./invariant` |
| `compat/0.1.5` @ `d7c592d` | `dsh-context-compression-improved-workspace`, `private: true`, **no** `main`/`exports`/`dsh`/`dependencies` |
| `main` / `baseline/pre-god-module-split` @ `e337bf5` | same as compat, plus **zero** `lib/` artifacts committed |

**Affected.** `compat/0.1.5`, `baseline/pre-god-module-split`, `main` (fully);
`feat/ctx-preset-v2` (partially: empty dependencies, incomplete exports).

`baseline/pre-god-module-split` is a pre-split baseline, not a distribution: it has no
install contract and no built artifacts. Do not use it as a rollback target.

**Fix.** The root manifest carries the install contract: `name`, `main`, `types`,
`exports`, `dependencies`, `dsh`. `dependencies` lists the real third-party runtime
dependencies (`@huggingface/tokenizers`, `js-yaml`).

**Verification.** `git show <branch>:package.json` field-by-field; after a real
`dsh plugin add`, confirm `node_modules/<pkg>` exists and contains `lib/index.js`.

**Status.** Fixed on the merge branch for `dependencies` / `./pruner`; `./invariant` is
still absent from the root `exports` (parity item, not a boot blocker).

---

## D3 — Build chunks not committed: the same crash under a different filename

**Symptom.** After the merge, the built entry starts with:

```js
// packages/selector/lib/index.js:1
import { … } from "./config.js";
// packages/selector/lib/invariant.js:1
import { … } from "./tail-trim.js";
```

tsdown splits a shared chunk out of every entry that reuses a module.

**Root cause.** This repository commits `lib/` because pnpm refuses a `prepare` script on a
git dependency, so consumers can only install prebuilt artifacts. After the merge the new
artifacts — `lib/config.js`, `lib/tail-trim.js`, `lib/pruner.js`, `lib/pruner.d.ts`,
`src/deepseek-v4-tokenizer.ts` — were **untracked** while `lib/index.js` already imported
them. Pushing in that state makes a git install fetch an entry whose chunk does not exist:
the identical `ERR_MODULE_NOT_FOUND`, only the specifier changes from the sibling package
to `./config.js`.

A git install fetches exactly the **tracked** tree, so `pnpm test:e2e:packed` cannot catch
this: `npm pack` builds from the working tree and happily includes untracked files.

**Evidence.**

- `git ls-files packages/selector/lib` listed only the seven pre-merge files.
- `git status --porcelain` showed the five untracked artifacts above.
- Before the gate was added, `pnpm verify:release` printed
  `release verification: OK` — the release gate did not cover the artifact graph.
- Contrast with history, showing this is merge-introduced: on `feat/ctx-preset-v2` and
  `compat/0.1.5`, `packages/runtime/lib/tail-trim.js` is committed, and the selector entry
  is self-contained with no relative imports.

**Affected.** Any release built from the merged single-package layout, i.e. every future
version of this repository. Treat it as a permanent gate, not a one-off fix.

**Fix.**
1. Commit `lib/**` together with the sources, including every chunk and entry.
2. Gate it: every relative import in a shipped artifact must (a) resolve to an existing
   file, (b) be covered by the package `files` allowlist (packed install), and (c) be
   git-tracked (git install).

The gate is scoped to the **import graph**. Unreferenced build by-products such as
`lib/style.css` are excluded: its rules are already carried inline by `lib/client.js`
(the `\0dsh-context-compression-css:` region), nothing in the repository reads the file,
and the `files` allowlist deliberately drops it from the tarball. Requiring it would mean
widening the allowlist to ship dead weight.

**Verification.** `scripts/verify-release.mjs`. Observed:

```text
# untracked chunk present
Error: release verification: packages/selector/lib/config.js is not committed;
       a git install would fetch an incomplete artifact graph

# after git add (the gate reads the index, so staging is enough)
release verification: OK
```

**Status.** Gate implemented and verified red → green. The root-cause fix is the
`git add`, applied in the merge commit.

---

## D4 — Consumer profile leftovers

**Symptom.** Even with the package fixed, a profile can still install the wrong thing or
fail to install.

**Evidence (`web` profile).**

- `package.json` depended on `…-selector-workspace` at
  `github:<owner>/<repo>#baseline/pre-god-module-split` — a spec **without**
  `&path:/packages/selector`, which resolves to the private workspace root and installs
  nothing usable.
- `pnpm-workspace.yaml` kept an `overrides` entry pointing at the now-deleted
  `packages/runtime` path.
- `node_modules` held nothing but the useless workspace package.

**Affected.** Any profile that installs this plugin.

**Fix.** Remove the stale dependency and the dead override; install by the single-package
spec (no `&path:` needed once the root manifest is the install face).

**Correction.** An earlier analysis claimed `allowBuilds` for `@huggingface/tokenizers` was
a blocker. `@huggingface/tokenizers@0.1.3` has no `install`/`postinstall` script — `dist/`
ships prebuilt — and the repository's own packed E2E writes a consumer workspace manifest
of just `packages: []`. Adding the `allowBuilds` entry is precautionary, not required.

**Status.** Delivered as a manual script; not executed by the maintainer agent.

---

## D5 — `compat/0.1.5` predates the install contract

**Verdict: it must inherit.** `compat/0.1.5` @ `d7c592d` is four commits behind
`feat/ctx-preset-v2` (`0b20bf2`, `cd03575`, `4635d19`, `455f74f`), so what it needs is not
merely the merge but the whole install contract:

1. the root manifest contract (D2) — it currently cannot be mounted at all;
2. the single-package merge (structural fix for D1) — it is still two packages, with
   neither manifest declaring the other as an installable dependency, so a git install
   cannot materialize the runtime package: the same root cause, a different presentation;
3. the artifact-graph gate (D3) and the profile hygiene (D4).

Its entry lacks a top-level cross-package import only because it resolves the runtime
package lazily through `import.meta.resolve`. That is why it fails as "no bundle to load"
instead of a load-time throw. Same disease, different symptom — do not read it as
"unaffected".

**Replay, not merge.** `compat/0.1.5` carries 0.1.5-rc.2-only adaptations (client slot
names, `engines.dsh`, pinned overrides, lazy service resolution, estimator host route,
`/api` route prefix). A `git merge` would drag the old-line adaptations back, so the merge
is replayed file by file on that branch instead.

**Status.** Not started.

---

## Affected-surface matrix

| Branch / version | D1 entry import | D2 install contract | D3 artifact chunks | D4 profile | Verdict |
| --- | --- | --- | --- | --- | --- |
| `feat/ctx-preset-v2` @ `455f74f` | **present (crash)** | partial | n/a before merge | needed | affected; D1/D2 fixed on merge branch |
| merged single package | eliminated | fixed (`./invariant` pending) | **gated** | delivered | this change |
| `compat/0.1.5` @ `d7c592d` | no (lazy) | **absent** | n/a | needed | **inherits the whole contract** |
| `baseline/pre-god-module-split`, `main` @ `e337bf5` | no | **absent, no `lib/`** | n/a | needed | not distributable by design |
| any future single-package release | structurally impossible | — | **permanent gate** | — | inherits D3 |

## Inheritance rules

1. **The root manifest is the install contract**: `name`, `main`, `types`, `exports`,
   `dependencies`, `dsh` — all six. A new subpath export is declared in both the root and
   the package manifest.
2. **No top-level cross-package import inside one package.** `lib/**/*.js` may only
   reference the frozen provenance literal.
3. **`lib/**` ships in the same commit as its sources**, and every chunk an entry imports
   must be committed. Enforced by `pnpm verify:release`.
4. **The provenance literal `dsh-context-compression-improved-runtime` is frozen.** It is
   already written into durable session logs (`source.plugin` on tail-trim manifests) and
   validated on read, so renaming it silently discards historical tail-trim entries.
5. **Profile-side hygiene**: install spec that actually resolves, no dead `overrides`.

## Change log

| Date | Entry | Action |
| --- | --- | --- |
| 2026-09-14 | D1–D5 | Ledger created; D1 fixed; D2 fixed for `dependencies`/`./pruner`; D3 gate added and verified; D4 delivered as a script; D5 recorded for `compat/0.1.5` |
