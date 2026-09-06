# Installing dsh-context-compression-improved

> [English](installation.md) · [中文](installation.zh.md) · [日本語](installation.ja.md) · [한국어](installation.ko.md)

This guide installs the fork from source. The fork is not yet published to npm; the internal package names intentionally stay upstream's (`dsh-context-compression-selector` + its exact-version runtime dependency `dsh-context-compression-selector-runtime`).

## Prerequisites

- Node `^22.19.0 || >=24` and pnpm `11.7.0` (`corepack enable` picks the pinned version from `packageManager`).
- A DeepSeek Harness installation compatible with the `0.1.1-rc.2` peer range (verified against the official `dsh-v0.1.2-alpha.5` release).
- A DeepSeek V4 model route (`deepseek-v4-flash`, `deepseek-v4-pro`, or `deepseek-v4-flash-vision-exp`). Lossy compression — including the code-skeleton gate — requires the exact bundled tokenizer; other routes fail open and keep original tool results.
- Git.

## 1. Build from source

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` bundles both library faces of every package (`tsdown`). Run `pnpm test` first if you want the full suite on your machine before installing.

## 2. Pack the Bundle entry package

The selector package is the single Bundle entry; the runtime comes along as its exact-version dependency:

```sh
cd packages/selector
pnpm pack
# → dsh-context-compression-selector-0.1.0.tgz
cd ../..
```

`pnpm pack` runs the bundle through the `prepack` hook, so the tarball always matches your checkout.

## 3. Add it to a Harness profile

The selector package declares the Harness Bundle manifest field `dsh.bundle.patch`, so `dsh plugin add` is the standard out-of-tree Bundle installation path:

```sh
dsh plugin --profile web add packages/selector/dsh-context-compression-selector-0.1.0.tgz
dsh --profile web --dump-config
```

Restart the selected profile after installation. The config dump should list the selector Bundle as active. Do **not** install or wire the selector and runtime packages separately — the runtime is installed automatically.

## 4. Turn on the code-skeleton gate

Open DeepSeek Harness settings → **Context compression selector**:

1. Pick a compression profile (the gate is orthogonal to all of them).
2. Optionally adjust the Auto Compact trigger level (50–90%, default 80%).
3. Set **Code skeleton compression** to **On**. The toggle saves on change.

Like all selector settings, the value is frozen when a session first observes it — the gate affects newly observed sessions, never a task that is already running.

## 5. Update or remove

```sh
# update: pull, rebuild, repack, and add the new tarball again
git pull && pnpm install --frozen-lockfile && pnpm build
cd packages/selector && pnpm pack && cd ../..
dsh plugin --profile web add packages/selector/dsh-context-compression-selector-0.1.0.tgz

# remove
dsh plugin --profile web remove dsh-context-compression-selector
```

## Troubleshooting

- **Bundle not active in the dump**: restart the profile; confirm you added the selector entry package (not the runtime) and that the Harness version is in the compatible peer range.
- **Tool results are never skeleton-compressed**: the gate is off by default; check the toggle. Compression only applies to fresh, oversized source-code tool results on exact-tokenizer model routes, and every skip is recorded with a reason in the audit trail.
- **The toggle shows as unreadable**: the stored `codeSkeleton` section failed the strict browser decode (it must be exactly `{ enabled: boolean }`). Removing the malformed section restores defaults.
- **Updating fails on the upgrade step**: the plugin follows npm package semantics; remove the old version first if a tarball-to-tarball upgrade is refused by your Harness build.
