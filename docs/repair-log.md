# Repair log

Cross-version ledger of defects that break the **install / boot** path. Every branch and
version must leave its verdict here (affected / unaffected / fixed) before it ships.

Read this file before starting a new line (see `CONTRIBUTING.md`). A defect class already
recorded here is expected to be *re-checked*, not re-discovered.

- One defect, one `D#` id.
- One entry must contain: symptom / root cause / evidence / affected surface / fix / verification.
- Evidence means a command and its observed output, not a description of the code.

Defects that ship to the **settings surface** rather than the boot path use the `U#` series and
keep the same six-part shape. They are recorded here because they are reported the same way —
from a real machine, by someone who cannot tell a gate from a bug.

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

**Status.** Fixed on the merge branch for `dependencies` / `./pruner`. `./invariant` was
added to the root `exports` by the closure commit — the root and the package manifest now
export the same four subpaths (`.`, `./invariant`, `./pruner`, `./client`). See the
verification ledger below for the command-level evidence.

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

**Verification.** `scripts-dist/verify-release.js` (compiled from `scripts/verify-release.ts`). Observed:

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

## D6 — Consumer profile blocks dependency reconciliation (host precondition)

**Scope note.** This is *not* a defect of this repository. It is recorded here because it
blocks the real-machine verification step that every branch needs, and because CI is
structurally blind to it.

**Symptom.** `pnpm install` in the `web` profile fails, at a **different path on every run**:

```text
cannot create directory at "...\node_modules\katex\node_modules\commander_pacquet-stage_…":
拒绝访问。 (os error 5)

failed to remove existing directory "...\node_modules\better-sqlite3" prior to swap:
拒绝访问。 (os error 5)
```

Progress advances each run (`added 151 → 159 → 205`). The install is not wedged — it is
walking a list of blockers, one per run.

**Root cause — two independent sources of `os error 5`. Do not conflate them.**

1. **ACL denies write**, at exactly one directory: `node_modules\katex\node_modules` lists
   only `BUILTIN\Users: ReadAndExecute` and does not name the interactive user at all.
2. **A mapped native module is held by a live process.** `better-sqlite3` grants the
   interactive user `FullControl` on both itself and its nested `node_modules`, yet deletion
   still fails. `session-query-sqlite` is enabled and `dsh web` is running, so
   `better-sqlite3\build\Release\better_sqlite3.node` is mapped into that process; Windows
   returns `ERROR_ACCESS_DENIED` when asked to delete a mapped image. No ACL change fixes
   this one — only stopping the process does.

**Criterion warning — never test this by ownership.** Measured here:

| criterion | flagged |
| --- | --- |
| owner is not the interactive user | **211** |
| the interactive user actually lacks write | **0** of 269 package dirs, plus **1** nested |

Ownership is `BUILTIN\Administrators` almost everywhere (the profile was evidently produced
by one elevated install), while the interactive user holds explicit `FullControl` in nearly
all of them. An ownership-based fix would take ownership of 211 directories to solve one.
Test the **effective write right** instead.

**Affected.** Every real-machine verification on this host, on every branch — including the
`compat/0.1.5` replay, which cannot be validated anywhere else.

**Fix.** Stop `dsh web`; grant write on the one genuinely denied directory; re-run
`pnpm install --no-frozen-lockfile`; restart. Delivered as
`DSH-ccp-单包修复-04-node_modules依赖收敛阻塞.ps1` — diagnose / repair / re-verify, dry-run
capable, and it never stops the service for you.

**Verification.** The script's `-DryRun` reports one true target and names the one path.

**Status. Resolved** in the maintenance window. The consumer ran a plain `pnpm install` in
the profile and it completed: `Packages: +256 -16`, `Progress: resolved 256, reused 256`,
`Done in 11.1s using pnpm v12.4.1`, exit 0.

**Resolution evidence (read-only re-check after the install):**

| Check | Result |
| --- | --- |
| `pnpm-lock.yaml` references `dsh-context-compression-selector-workspace` | **none** — lockfile and `package.json` agree again |
| `node_modules\dsh-context-compression*` | exactly one directory, `dsh-context-compression-improved` |
| `*_pacquet-stage_*` residue | none |
| plugin `packages/selector/lib/**` | all ten artifacts present, `invariant.js` 3927 B — byte-size identical to the source build |
| `dsh.profile.bundles` row | `dsh-context-compression-improved` still listed |

Two things follow for the record. First, the lockfile inconsistency tracked here was a
**symptom** of the failed installs, not a separate defect: once one install succeeded, it
cleared itself — no manual lockfile surgery was needed. Second, the blockage cleared **by
retrying**, without the elevated ACL repair. That does not retire the finding — the `katex`
ACL hole is still real and will bite the next replacement of that subtree — but it does mean
the earlier per-run progress (`added 151 → 159 → 205`) was the decisive mechanism: each
attempt converged further and the last one finished. Record it as *cleared by convergence*,
not as *fixed by the script*; `-04` remains the tool of record if a future install stalls on
the same signature.

---

## D7 — The estimator catalog route never registered: a detached method lost `this`

**Symptom.** The settings card's host-route dropdowns stayed empty. An authenticated
`GET /api/dsh-context-compression-improved/estimator-catalog` answered 404 while a sibling
plugin's `/api/dsh-perm-gate/receiver` answered 200 in the same breath.

**Root cause.** `asWebServer` duck-typed the `webServer` service by pulling `register` off it
and returning a fresh wrapper:

```ts
const register = value?.register
return { register }          // `this` is now the wrapper
```

`dsh-host-webserver`'s `register` reads its own route tables:

```js
const table = route.kind === "exact" ? this.exact : this.prefixes;
if (table.has(route.path)) …        // L178 — `table` is undefined, TypeError
```

`this` was the wrapper, so `this.exact` / `this.prefixes` were `undefined`, the host threw
inside `register`, and the plugin's catch-all swallowed it. **The helper had never once
registered a route since it was written.**

**Why it stayed invisible.** On the 0.1.2 host the `dsh web` terminal prints no plugin
`ctx.logger` output at all — a full boot produced 1350 bytes containing only Node's
experimental warning and two `dsh web:` lines — and a plugin-load failure travels the same
logger. A swallowed throw and a plugin that quietly did nothing were observationally
identical. Once the diagnostic moved to `console` (as `dsh-perm-gate` already does on this
host), the real frame appeared:

```
TypeError: Cannot read properties of undefined (reading 'has')
    at Object.register (dsh-host-webserver/lib/index.js:178:13)
    at Object.apply (cordis/lib/index.js:120:36)
```

**Fix.** `return value as WebServerLike` — pass the service itself; `dsh-perm-gate` works
for exactly this reason.

**Verification.** Cordis does **not** bind service methods: on a bare `Context`, both a
detached call and a wrapped one lose `this`. On the real host, after installing this fix,
`/api/dsh-context-compression-improved/estimator-catalog` answers **200** with a full
catalog (four provider groups), `/endpoint/…` answers 200, perm-gate stays 200, and a
garbage path stays 401.

**Guard.** `packages/selector/tests/estimator-route-registration.host.spec.ts` now mounts a
stand-in whose `register` reads its tables off `this`, mirroring the host. Against the
previous implementation it fails **3 of 5** cases with `expected [] to deeply equal […]` —
the same empty route table the host exhibited. The earlier version of that stand-in recorded
routes in a closure, so it could never have caught this.

**Withdrawn hypotheses.** Everything this ledger recorded before the fix about the cause —
narrowing the injection gate, isolation scope, and moving to the `connection` service — was
a false trail produced by the silence. Two of them are worth keeping as *non*-causes:
isolation is opt-in and this row never opted in, and `connection.rpc` is the wrong transport
here for reasons the project's own `upgrade-pitfalls` §2.1 records independently.

---

## D8 — The search reducer dropped 21.2% of hits and never reported where they went

**Symptom.** Large `grep`/`rg` results compressed by `search-by-file` lost every hit the
per-file "first 4 + last" rule did not keep, and the file header only said `(592 matches)`
with no line numbers. The model could not tell which hits were dropped or where to re-read.

**Root cause.** `reduceSearch` filled each file's keep-set from index 0 (`keep.size < 5`)
and reported only counts. Nothing in the output identified the omitted hit positions, so the
loss was invisible and unrecoverable except by re-running the search.

**Evidence.** 14 real sessions (18.6M characters, DSH 0.1.5-rc.2): 186 search events /
5,301 hits; per-file median 18, p90 55, max 592; 1,122 hits (21.2%) discarded silently.

**Affected surface.** `packages/selector/src/runtime/reducers.ts` (`reduceSearch`).

**Fix.** Two-tier folding (R10): L1 is a lossless per-file locator
(`## <path> (N matches)  L12,L15,…`, one line number per hit, budget reserved first); L2 is
the content quota, water-filled round-robin so no file vanishes. When L1 itself cannot fit
the shortfall is announced (withheld file/match counts), never silently truncated.

**Verification.** `packages/selector/tests/runtime/search-reducer.spec.ts`: a 592-hit file
reports 592 locator numbers; water-filling serves every file before any file takes a second
row; withheld locators are announced in the output.

---

## D9 — HTML fell into `pi-head`, which kept the `<head>` and dropped the body

**Symptom.** Fetched/compressed HTML pages kept `<!DOCTYPE>`, `<meta>`, `<link>`,
`<script>` and `<style>` — the metadata — while the entire body content disappeared.

**Root cause.** `looksLikeSourceCode` matches no HTML tags (its patterns cover
declarations/imports/decorators only), so pages fell through to the head/tail fallbacks, and
`reduceHead` takes from the top — exactly the worst segment for HTML.

**Evidence.** `CODE_STRUCTURE_PATTERN` / `CODE_IMPORT_PATTERN` / `CODE_DECORATOR_PATTERN`
match none of `<html|<div|<script|…`; the repository carried zero HTML-input tests (31
`<html|<div|<script` hits, all in TSX sources and tokenizer vocabularies).

**Affected surface.** `packages/selector/src/runtime/reducers.ts` (candidate chain).

**Fix.** Two-stage reduction (R13): `html-slim` strips comments, script/style/noscript/svg/
head elements, data URIs, non-whitelisted attributes (`href/src/alt/title/id` survive) and
inline-tag markup, line-aligned so original-event line numbers survive; `html-skeleton`
keeps the heading hierarchy, section first lines and table header rows under tighter budgets.
Classification is pure form (≥3 markup-tag lines in the first 400).

**Verification.** `packages/selector/tests/runtime/html-reducer.spec.ts`: body paragraphs
and headings survive; script/style/comment/data-URI content is gone; the skeleton fallback
cites original line ranges; TS generics/comparisons are not misclassified as HTML.

---

## U1 — The estimator card vanished off TokenPilot-inspired instead of explaining its gate

**Symptom.** With any profile other than TokenPilot-inspired selected, the Settings page showed
no estimator section at all. A reader who had configured nothing could not tell whether the
feature was missing, broken, or gated — the first real-machine report of Defect A was exactly
this, and it was filed alongside D7 even though the two have nothing in common.

**Root cause.** The render was `current !== 'tokenpilot-inspired' ? null : <EstimatorControls …/>`.
The condition is right: `runtime/config.ts` merges `presetOptions` over the tokenpilot-inspired
defaults alone (`mergePresetOptions`), and `resolvePolicy(config, 'balanced').presetOptions` is
`undefined`, so no other profile can carry an estimator channel. What was wrong is that the gate
was *rendered as nothing*. The profile card that unlocks the section sits elsewhere on the page,
and the one element that would have named it was the section being hidden — a gate the reader
cannot see is indistinguishable from an absent feature.

**Fix.** Render `EstimatorInactiveNotice` in place of the controls: same `<section>`, same
`#context-compression-estimator-title` heading anchor, one paragraph naming the current profile
and the profile that unlocks the card. Losing the heading was half the defect, so the heading
stays. **The gate is unchanged** — no estimator control exists off TokenPilot-inspired, and no
other profile gains `presetOptions`.

**Evidence.** `packages/selector/tests/estimator-channel.client.spec.tsx` mounts the section with
`profile: 'balanced'` and asserts the anchor still reads `Estimator (optional)`, that the notice
contains the current profile label and `Select TokenPilot-inspired`, and that no channel select,
no provider input and no `input[list]` exist. Counter-proof: substituting `null` for the notice
turns that case red (`expected undefined to be 'Estimator (optional)'`) while the other six stay
green — the guard fails against the pre-fix behaviour, so it is not vacuous.

**Affected surface.** Client bundle only: `src/client/CompressionProfileSelector.tsx`,
`src/client/locales.ts` (both dictionaries; `en` satisfies the full key set), `lib/client.js`,
`lib/client.d.ts`. No runtime, config, or persistence change, and no change to
`presetOptions` semantics.

**Still open.** The save affordance remains unexplained in the UI — fields commit on change or
blur with only a transient busy state, so "did that save?" has no answer on screen. That is a
separate, larger change (explicit save button plus three-state feedback) and is not fixed here.

---

## Verification ledger — `feat/ctx-preset-v2` closure

Closure = `935d501` + the root-`exports` completion (`./invariant`). The working tree held
exactly that one manifest change; `lib/**` rebuilt byte-identically, so the build is
deterministic.

### Ten gates

| # | Command | Result |
| --- | --- | --- |
| 1 | `pnpm install` | exit 0 |
| 2 | `pnpm build` | exit 0 |
| 3 | `pnpm typecheck` | exit 0 |
| 4 | `pnpm lint` | exit 0 |
| 5 | `pnpm test` | exit 1 — nondeterministic Windows set, see below |
| 6 | `pnpm test:built` | exit 0 |
| 7 | `pnpm verify:release` | exit 0 |
| 8 | `pnpm pack:dry-run` | exit 0 |
| 9 | `pnpm test:e2e:packed` (`DSH_E2E_MODE=dev`) | exit 0 |
| 10 | `pnpm test:e2e:packed` (release mode) | **blocked** — external precondition, see below |

### Gate 5 — the failure set is nondeterministic; do not cite it as "4 known failures"

A single `pnpm test` run is not a baseline. Eight interleaved runs (four at `455f74f`,
four at the closure commit), same machine, nothing else running:

| Run | `455f74f` failed | closure failed |
| --- | --- | --- |
| 1 | 3 | 5 |
| 2 | 3 | 2 |
| 3 | 4 | 3 |
| 4 | 3 | 4 |

A ninth run, taken while a packed-install E2E ran concurrently, reported **9** failures at
`455f74f` — the same commit that reported 3 in three other runs. The count tracks machine
load, not code.

Per test name, over the four quiet runs on each side:

| Test | `455f74f` | closure |
| --- | --- | --- |
| `preset-overlay.host.spec.ts` > uses owner-only files and starts a new generation after source content changes | 4/4 | 4/4 |
| `standing-generation.host.spec.ts` > keeps one fully-identical generation under concurrent composition of the same identity | 3/4 | 3/4 |
| `standing-generation.host.spec.ts` > keeps one generation under concurrent and repeated composition of the same identity | 3/4 | 3/4 |
| `standing-generation.host.spec.ts` > separates colliding equal-size generations on a whole-second metadata surface before publish | 3/4 | 3/4 |
| `standing-generation.host.spec.ts` > switches the standing generation for an equal-length source change at a fixed threshold | 0/4 | 1/4 |

Four of the five fail on both sides at identical frequency: pre-existing. The fifth failed
once in four runs on the closure side and never on the baseline side, inside the same
timing-sensitive `describe` block as three tests that are 3/4 flaky on *both* sides. It is
recorded as **not excluded**, not as clean.

The visible causes are Windows-only: an owner-only permission assertion (`0o700` against
`0o666`), `fs.rename` `EPERM` during publish under concurrency, and mtime-window
assertions that assume a coarser clock.

**Consequence for review.** Any criterion phrased as "the failure set matches the baseline
item by item" is unsatisfiable — the baseline has no single failure set. Compare
*ever-failed* sets over at least three interleaved runs per side instead.

### Gate 10 — external precondition, not a defect

Release mode needs the *published* previous release to build the upgrade leg of its
fixture. `0.1.0-beta.2` was never published, so the fixture aborts with `release gate
requires the published previous release for the upgrade leg: packument responded 404`.
`DSH_E2E_MODE=dev` (gate 9) is the runnable leg and passes. Blocked on publishing, not on
this repository.

### Criterion withdrawn

The earlier merge plan carried "the overlay identity hash is unchanged across the merge".
That is unsatisfiable by construction: identity is `sha256(preset.id ‖ source ‖
JSON.stringify({modules, autoCompactThresholdPercent}))` computed over **absolute** module
paths, so collapsing two packages into one necessarily changes it. The replacement is
structural — `canonicalCompressionRows` stays byte-identical and the only permitted
difference in the generated YAML is the `tool-result-pruner` row's `name` resolving to the
merged package.

### `invariant.ts` literal decision

The merged package keeps **one** invariant companion, and it is the runtime's: `name =
'context-compression-selector-runtime-invariant'`, `PACKAGE_NAME =
'dsh-context-compression-improved-runtime'`. Both stay verbatim.

- The string is the frozen provenance literal (inheritance rule 4) and is written into
  durable session logs, so renaming it would discard historical tail-trim entries.
- The companion's real checks (`validatePublishedTailTrim`, `sessionEvents`) belong to the
  runtime, so the runtime identity is the semantically correct one.
- The pre-merge `packages/selector/src/invariant.ts` companion
  (`client-ui-context-compression-selector-invariant`, `PACKAGE_NAME =
  'dsh-context-compression-improved'`) installed **no** checks (`install = () => {}`) and
  was dropped by the merge. Nothing is lost: its only effect was reserving a name in the
  invariant registry, which is keyed by the installing package either way.

---

## Affected-surface matrix

| Branch / version | D1 entry import | D2 install contract | D3 artifact chunks | D4 profile | Verdict |
| --- | --- | --- | --- | --- | --- |
| `feat/ctx-preset-v2` @ `455f74f` | **present (crash)** | partial | n/a before merge | needed | affected; D1/D2 fixed on merge branch |
| merged single package | eliminated | fixed (all four subpaths) | **gated** | delivered | this change |
| `compat/0.1.5` @ `d7c592d` | no (lazy) | **absent** | n/a | needed | **inherits the whole contract** |
| `ts/0.1.5` @ `refactor/ts-0.1.5-merge` | no | **fixed by the R3 replay** (root manifest is the install surface, `./pruner` + `./invariant` declared) | **gated** (shared `lib/config.js` chunk added by the replay) | needed (script delivered) | contract inherited; D7 re-checked and the route defect it masked fixed —see below |
| `baseline/pre-god-module-split`, `main` @ `e337bf5` | no | **absent, no `lib/`** | n/a | needed | not distributable by design |
| any future single-package release | structurally impossible | — | **permanent gate** | — | inherits D3 |
| every branch on this host | — | — | — | — | was **blocked by D6**; the profile install now completes, so real-machine verification is unblocked |

### D7 per branch — the fix must travel one way only

`asWebServer` has two different bodies across the branches, and they are not equivalent:

| Branch | `asWebServer` returns | Verdict |
| --- | --- | --- |
| `compat/0.1.5` @ `d7c592d` | `value as WebServerLike` — the service itself | **correct; never had D7** |
| `feat/ctx-preset-v2` @ `e588f1c`, `ts/0.1.2+` @ `0eb5183` | `{ register }` — a detached method | **carries D7** |
| `baseline/pre-god-module-split`, `main` @ `e337bf5` | no such helper | n/a |
| `ts/0.1.5` @ `refactor/ts-0.1.5-merge` | `value as WebServerLike` —the service itself | **correct; never had D7**. The helper was taken from this line, not from the V2 line |

The defect was introduced on the V2 line, not inherited from the 0.1.x line. That inverts the
usual direction of these hand-offs: **the 0.1.5 replay must not copy this helper out of
`feat/ctx-preset-v2`.** Take `compat`'s body, or the fixed one from `00afcfc`; they agree.

## `ts/0.1.5` (compat) verdicts —2026-09-15

Branch `refactor/ts-0.1.5-merge`, the R3 replay of the single-package install contract
(`6941d2f` merge, `e511fe8` contract specs, `165f495` route registration, `e7e927c` lint
paths, `66c8c63` toolchain sweep, `6f2cb51` rebuilt artifacts, `75e3327` settings schema).

| Defect | Verdict on this line |
| --- | --- |
| D1 —host entry statically imports a sibling package | **unaffected.** This line had already inlined the namespace and downgraded the settings schema to `z.any()` (`ab2175a`) to keep the entry free of cross-package imports; the replay removed the reason for both. |
| D2 —root manifest missing the install contract | **fixed by the replay.** The root manifest is the install surface again: `name`, `main`, `types`, `exports` (`.`, `./invariant`, `./pruner`, `./client`), `dependencies`, `dsh`. |
| D3 —build chunks not committed | **gated here too.** The replay reintroduced a shared chunk (`lib/config.js`, imported by both entries through the settings schema), so the artifact-graph gate was run red 鈫?green: 11 artifacts, every relative import resolves, every non-CSS artifact is inside the `files` whitelist and tracked, no `.css` entry declared. |
| D4 —consumer profile leftovers | **same status as the other lines**: the hygiene script is delivered, the profile side is a host precondition the operator runs. |
| D5 —`compat/0.1.5` predates the install contract | **this replay is the D5 action.** |
| D6 —profile blocks dependency reconciliation | **unchanged.** No `os error 5` in this round; the `katex` write gap is still on the books for the next subtree replacement. |
| D7 —estimator catalog route never registered | **the detached-method body was never here**, but the route still had a registration defect of its own: the injection gate asked for `webServer`, `llm` and `agentDefaultModel`, and an unsatisfied `ctx.inject` callback is silent, so a usable `webServer` with a late `llm` left the plugin with no HTTP API at all. Fixed by `165f495` (dual prefix, guarded two-channel registration, per-request service resolution, `console` lifecycle lines); guard `estimator-route-registration.host.spec.ts`, six cases, falsified against the old gate (4 of 6 red). |
| U1 —the estimator card hides itself | **present, not fixed on this line.** The 0.1.5 client still renders nothing when the profile or channel does not enable the estimator, so the block disappears without saying why. The 0.1.2 line fixed this in `bb1f496`; this replay did not carry the client change. Recorded here so it is not silently inherited —porting it is a client-side item, not part of the install contract. |

**Estimator defects as first reported (`D-1` route, `D-2` save awareness).** `D-1` is D7 above;
on this line it was the over-broad gate, now fixed. `D-2` (explicit save button with three-state
feedback) is **not implemented on either line**: this branch still commits on blur, exactly like
`ts/0.1.2+`, where the item was explicitly descoped once the real defect turned out to be the
route.

**One more defect found and fixed by the replay.** `ab2175a` downgraded the settings schema to
`z.any()`, and that schema was the only thing publishing the daily Custom defaults, so
`settings.get('context-compression')` no longer carried `custom`. It was already failing before
the merge: the loader E2E case `publishes the daily Custom defaults from the plugin-owned
settings row` and the packed install E2E both stop on `settings.custom` being undefined, and the
five `public-runtime` Auto Compact cases assert audits derived from the same document. `75e3327`
restores `ContextCompressionSettingsSchema` in both `settings.register` calls, matching the
0.1.2 line.

**Suite effect of this branch, same machine and command:** 22 failed / 358 passed before
(`d7c592d`), 1 failed / 365 passed after. The remaining failure is the Windows mtime flake in
`standing-generation.host.spec.ts` that the compat report already documents as environment
caused.

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
   validated on read, so renaming it silently discards historical tail-trim entries. This
   covers every occurrence, including `src/invariant.ts`'s `PACKAGE_NAME` and companion
   `name` — the merge does **not** rename them to match the merged package name.
5. **Profile-side hygiene**: install spec that actually resolves, no dead `overrides`. And
   before trusting any profile-side install result: reconcile dependencies **with the host
   stopped**, and test a directory's write right — never its owner (D6).
6. **Never detach a method off a host service.** Duck typing that returns `{ register }`
   instead of the service loses `this`, and `dsh-host-webserver.register` reads its route
   tables off `this`. Pass the service object itself; `dsh-perm-gate` does, which is why it
   serves its routes. The same trap applies to any service whose methods touch instance
   state, so check the contract before narrowing a service to a single method (D7).
7. **A conditional the user cannot see is a defect, not a design.** If a section renders only
   under some profile, mode, or capability, the hidden branch must say what is missing and what
   would restore it — and keep its heading and anchor id so the panel is still findable where
   the reader last saw it. Gating *semantics* are not what is on trial here; hiding the *reason*
   is (U1).

## Change log

| Date | Entry | Action |
| --- | --- | --- |
| 2026-09-14 | D1–D5 | Ledger created; D1 fixed; D2 fixed for `dependencies`/`./pruner`; D3 gate added and verified; D4 delivered as a script; D5 recorded for `compat/0.1.5` |
| 2026-09-14 | D2 | `./invariant` added to the root `exports`; root and package manifests now agree. Ten-gate closure ledger added, with the gate-5 flakiness evidence and the withdrawn identity-hash criterion || 2026-09-15 | D2/D3 | `ts/0.1.2+` fast-forwarded onto the god-module-split branch (`04f86e4`) and pushed; the rebuild reproduces the committed `lib/` blob for blob |
| 2026-09-15 | D5 | `ts/0.1.5` replay: runtime merged into the selector package, root manifest made the install surface, toolchain/scripts/CI swept to one package, artifacts committed, D3 gate green |
| 2026-09-15 | D7 | `ts/0.1.5` route registration rewritten to the verified pattern; guard added and falsified against the old gate |
| 2026-09-15 | settings defaults | `z.any()` reverted to `ContextCompressionSettingsSchema` on `ts/0.1.5`; the loader E2E, the packed E2E and the five Auto Compact cases pass again || 2026-09-15 | docs | `ts/0.1.5` docs swept to the single package (four-language installation guides, selector READMEs, `THIRD_PARTY_NOTICES`, `TEST_INVENTORY`, four CHANGELOGs) |
| 2026-09-15 | known doc defect | `README.md`, `README.zh.md` and the three localized installation guides carry a handful of corrupted non-ASCII bytes (`0xE2` sequences) **on both lines, pre-dating this work**. The stale two-package sentences were replaced with correct text; the surrounding corruption still needs a regeneration pass from the English source. Recorded so it is not mistaken for a merge artifact |
| 2026-09-14 | D6 | Profile dependency-reconciliation blocker diagnosed: two independent `os error 5` sources (one ACL-denied directory; mapped native modules held by the live host), plus the ownership-vs-write-right criterion warning. Delivered as a dry-runnable script |
| 2026-09-15 | D6 | **Resolved.** One plain `pnpm install` in the profile converged (`+256 -16`, exit 0); the lockfile repointed itself and the `_pacquet-stage_` residue is gone. Cleared by convergence over successive attempts, not by the ACL repair — the `katex` denial stays on record |
| 2026-09-15 | D7 | **The estimator catalog route had never registered at all.** `asWebServer` detached `register` from the service, `this` became the wrapper, the host threw inside `register`, and a catch-all swallowed it. Fixed by passing the service itself; 200 verified on the real host; the injection, isolation and transport hypotheses recorded earlier are withdrawn |
| 2026-09-15 | U1 | **The estimator card was hidden by its own gate.** Off TokenPilot-inspired the section rendered `null`, so the reader saw a missing feature rather than a gated one. The heading and anchor are now kept and the hidden branch names the profile that unlocks the card; the gate itself is unchanged. Guard added with a counter-proof; the save-affordance question stays open |
| 2026-09-15 | doc corruption — mechanism | **Diagnosed.** A damaged spot is the 2-byte prefix of a three-byte UTF-8 character followed by `0x3F`: the character lost its third byte and, in most spots, the byte that followed it was consumed too (a double-byte-code-page decode/write pair collapse; 0 or 1 bytes lost per spot). The damage is **inherited, not produced here**: the newest valid blob of every affected file is `e337bf5`, while the same files are already defective at the `compat/0.1.5` baseline `d7c592d` and at `04f86e4`. Ten files carry it, not five — `README.{zh,ja,ko}.md` and `scripts/packed-install-e2e.mjs` were missed by the earlier note |
| 2026-09-15 | doc corruption — repaired | **Batch I / T-I2.** All ten files repaired by restoring each damaged spot from `e337bf5`, with three independent checks: the restored character must carry the surviving 2-byte prefix; re-corrupting the repair reproduces the previous bytes exactly (so the edit touches nothing but the damage, and no line, no EOL and no other character moves); and the repair must agree with the valid ancestor everywhere outside the restored spots. Every affected file is now valid UTF-8. The English `README.md` is the clean case: ten spots, all `—`/quote characters plus their following space, zero other differences from the ancestor |
| 2026-09-15 | ledger encoding | The twelve `—` characters in this file had been mangled to `鈥?` by the PowerShell port of the ledger (the 0.1.2 source has none); restored. Same class as the doc corruption above, introduced by that one-time port rather than inherited |
| 2026-09-19 | D8/D9 | Compression-quality defects ledgered on `feat/ctx-compression-v2-compat015`: search hits were dropped unlocatably (21.2%), HTML kept its `<head>` and lost its body; both fixed with two-tier search folding and two-stage HTML reduction, each with counter-proof tests |
