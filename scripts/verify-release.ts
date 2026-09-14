import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

const fail = (message: string): never => {
  throw new Error(`release verification: ${message}`)
}

const json = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
const rootPackage = await json(join(root, 'package.json'))
const selectorPackage = await json(join(root, 'packages/selector/package.json')) as Record<string, Record<string, unknown>>

const rootScripts = rootPackage.scripts as Record<string, string> | undefined
const selectorScripts = selectorPackage.scripts as Record<string, string> | undefined

if (!(rootScripts?.typecheck as string)?.includes('pnpm run typecheck:tests')
  || rootScripts?.['typecheck:tests'] !== 'tsc --noEmit -p tsconfig.tests.json') {
  fail('root typecheck must include the strict active-test TypeScript gate')
}
if (selectorScripts?.test
  !== 'vitest run --root ../.. --config vitest.config.ts --project runtime --project selector-host --project selector-client') {
  fail('Package-local test script is not the verified root project command')
}
const ci = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8')
if (!ci.includes('pnpm --filter dsh-context-compression-improved test')) {
  fail('CI lacks the package-local gate: pnpm --filter dsh-context-compression-improved test')
}
// The packed release E2E is the release gate that actually installs the
// tarballs: verify it cannot be silently dropped or defanged. It must exist
// as a root script, CI must run exactly that script, the script must default
// to fail-closed release mode, and that mode must refuse every skip/null
// lifecycle outcome.
if (rootScripts?.['test:e2e:packed'] !== 'node scripts-dist/packed-install-e2e.js') {
  fail('root test:e2e:packed script is missing or does not run the packed E2E directly')
}
if (!ci.includes('pnpm run test:e2e:packed') && !ci.includes('pnpm test:e2e:packed')) {
  fail('CI does not run the packed release E2E gate')
}
const packedE2e = await readFile(join(root, 'scripts/packed-install-e2e.ts'), 'utf8')
if (!/const e2eMode\s*(:\s*'dev'\s*\|\s*'release')?\s*=\s*process\.env\.DSH_E2E_MODE === 'dev' \? 'dev' : 'release'/u.test(packedE2e)) {
  fail('packed E2E must default to release mode (dev only via an explicit DSH_E2E_MODE)')
}
for (const failClosed of [
  'release gate requires the upgrade leg to run',
  'release gate requires the official clean-harness lifecycle to run',
]) {
  if (!packedE2e.includes(failClosed)) {
    fail(`packed E2E release mode lost its fail-closed guard: ${failClosed}`)
  }
}
const packedComponents = await readFile(join(root, 'scripts/packed-components-smoke.ts'), 'utf8')
for (const required of [
  'Runtime.measureForCompaction(visionCtx, visionImage)',
  "estimatedImageCount?.kind === 'tokenizer-estimate'",
  'estimatedImageCount.tokens === 340',
  'estimatedImageCount.upperBoundTokens === 384',
  'imageMeasurement.currentSurface.kind',
]) {
  if (!packedComponents.includes(required)) {
    fail(`packed component smoke lost its installed vision estimate guard: ${required}`)
  }
}
for (const required of [
  "packedVisionSmoke.imageSession?.measurement?.kind === 'tokenizer-estimate'",
  'packedVisionSmoke.imageSession.measurement.tokens === 340',
  'packedVisionSmoke.imageSession.measurement.upperBoundTokens === 384',
  'packedVisionSmoke.imageSession.measurement.estimatorId',
  'packedVisionSmoke.imageSession.measurement.estimatorRevision',
]) {
  if (!packedE2e.includes(required)) {
    fail(`packed E2E lost its parsed vision estimate guard: ${required}`)
  }
}
await stat(join(root, 'tsconfig.tests.json'))

if ((selectorPackage.dsh as Record<string, Record<string, string>>)?.bundle?.patch !== './cordis.patch.yml') {
  fail('selector must declare the DSH Bundle patch')
}
if ((selectorPackage.files as string[] | undefined)?.some((entry: string) => entry.endsWith('.css'))) {
  fail('selector must not rely on separately served CSS assets')
}
if ((selectorPackage.name as unknown as string) !== 'dsh-context-compression-improved') fail('unexpected package name')
if ((selectorPackage.publishConfig as Record<string, string>)?.access !== 'public') fail('publish access is not public')
if ((selectorPackage.publishConfig as Record<string, string>)?.tag !== 'latest') fail('publish tag is not latest')
for (const peer of [
  '@deepseek-ai/dsh-command-compact',
  '@deepseek-ai/dsh-compaction-basic',
]) {
  if (((selectorPackage.peerDependencies as Record<string, string>) ?? {})[peer] !== '>=0.1.1-rc.2 <0.2.0') {
    fail(`selector peer ${peer} is missing or outside the verified range`)
  }
}
const notice = await readFile(join(root, 'packages/selector/THIRD_PARTY_NOTICES.md'), 'utf8')
if (!notice.includes('Copyright (c) 2026 DeepSeek')) {
  fail('packages/selector does not carry the full DeepSeek Harness MIT notice')
}

interface AssetManifest {
  directory: string
  repository: string
  modelIds: string
  revision?: string
}

const assetManifests: AssetManifest[] = [
  {
    directory: 'deepseek-v4',
    repository: 'deepseek-ai/DeepSeek-V4-Pro',
    modelIds: 'deepseek-v4-flash","deepseek-v4-pro',
  },
  {
    directory: 'deepseek-v4-vision-exp',
    repository: 'deepseek-ai/DeepSeek-V4-Flash-Vision-Exp',
    revision: '6821d6ad3681a4b137b066b76094fa82ebd0a380',
    modelIds: 'deepseek-v4-flash-vision-exp',
  },
]
for (const expected of assetManifests) {
  const assetRoot = join(root, 'packages/selector/assets', expected.directory)
  const manifest = await json(join(assetRoot, 'manifest.json')) as {
    repository: string
    modelIds: string[]
    revision?: string
    files: Record<string, { bytes: number; sha256: string }>
  }
  if (manifest.repository !== expected.repository) fail(`${expected.directory} manifest repository differs`)
  if (!JSON.stringify(manifest.modelIds).includes(expected.modelIds)) {
    fail(`${expected.directory} manifest model ids differ`)
  }
  if (expected.revision !== undefined && manifest.revision !== expected.revision) {
    fail(`${expected.directory} manifest revision is not the pinned vision revision`)
  }
  for (const [name, descriptor] of Object.entries(manifest.files)) {
    const bytes = await readFile(join(assetRoot, name))
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (bytes.byteLength !== descriptor.bytes) fail(`${expected.directory}/${name} byte length differs from manifest`)
    if (hash !== descriptor.sha256) fail(`${expected.directory}/${name} SHA-256 differs from manifest`)
  }
  if (!(selectorPackage.files as string[] | undefined)?.some(
    entry => entry === 'assets' || entry === `assets/${expected.directory}/*`,
  )) {
    fail(`package files list omits assets for ${expected.directory}`)
  }
}

const sourceRoots = [join(root, 'packages/selector/src')]
const forbidden = [
  { pattern: /compaction\/group-trim/u, label: 'custom compaction/group-trim event' },
  { pattern: /@deepseek-ai\/[^'"\s]+\/src(?:\/|['"])/u, label: 'Harness source subpath import' },
  { pattern: /(?:\/home\/|[A-Za-z]:\\Users\\)/u, label: 'developer absolute path' },
  { pattern: /\.\.\/\.\.\/\.\.\/(?:core|packages)\//u, label: 'monorepo-relative source import' },
]

const walk = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else files.push(path)
  }
  return files
}

for (const sourceRoot of sourceRoots) {
  for (const path of await walk(sourceRoot)) {
    const text = await readFile(path, 'utf8')
    for (const rule of forbidden) {
      if (rule.pattern.test(text)) fail(`${relative(root, path)} contains ${rule.label}`)
    }
  }
}

const lib = join(root, 'packages/selector/lib')
if (!(await stat(lib)).isDirectory()) fail(`${relative(root, lib)} is missing; run build first`)
for (const path of await walk(lib)) {
  if (path.endsWith('.map')) fail(`${relative(root, path)} is a source map`)
}

// A git install ships exactly the tracked tree, so the artifact graph the
// entries import must be complete AND committed. tsdown splits a shared chunk
// out of every entry that reuses a module, and an untracked chunk makes the
// installed entry crash at module-load time with ERR_MODULE_NOT_FOUND — the
// same failure class as a cross-package import, so it gets the same gate.
// Only the import graph is gated: build by-products nothing imports (for
// example lib/style.css, whose rules the client artifact already carries
// inline) are neither shipped nor required.
const libArtifacts = await walk(lib)
const libNames = new Set(libArtifacts.map(path => relative(lib, path).replaceAll('\\', '/')))
const libScripts = [...libNames].filter(name => name.endsWith('.js')).sort()
const libAllowedSuffixes = ((selectorPackage.files as unknown as string[]) ?? [])
  .filter(pattern => pattern.startsWith('lib/'))
  .map(pattern => pattern.slice(pattern.lastIndexOf('*') + 1))
if (libAllowedSuffixes.length === 0) fail('selector package files allowlist covers no lib artifact')
const isAllowed = (name: string) => libAllowedSuffixes.some(suffix => name.endsWith(suffix))
const importedArtifacts = new Set<string>()
for (const name of libScripts) {
  const text = await readFile(join(lib, name), 'utf8')
  for (const match of text.matchAll(/from\s*["'](\.\/[^"']+)["']/gu)) {
    const target = match[1]!.slice(2)
    if (!libNames.has(target)) fail(`lib/${name} imports missing artifact ${match[1]}`)
    importedArtifacts.add(target)
  }
}
for (const name of [...libScripts, ...importedArtifacts].sort()) {
  if (!isAllowed(name)) fail(`lib/${name} is part of the load graph but the package files allowlist would drop it`)
}
let trackedLib: Set<string> | undefined
try {
  trackedLib = new Set(execFileSync('git', ['ls-files', '--', 'packages/selector/lib'], { cwd: root, encoding: 'utf8' })
    .split('\n').map(line => line.trim()).filter(Boolean))
} catch (cause: unknown) {
  fail(`cannot read the tracked artifact list with git: ${(cause as Error).message}`)
}
if (trackedLib === undefined || trackedLib.size === 0) fail('git tracks no packages/selector/lib artifact; a git install would ship an unbuilt package')
for (const name of [...libScripts, ...importedArtifacts].sort()) {
  const tracked = `packages/selector/lib/${name}`
  if (!trackedLib!.has(tracked)) {
    fail(`${tracked} is not committed; a git install would fetch an incomplete artifact graph`)
  }
}

const clientArtifact = await readFile(join(root, 'packages/selector/lib/client.js'), 'utf8')
if (!clientArtifact.startsWith('window.__ModuleLoader__.load({')) {
  fail('client.js is not a Harness lazy-CJS artifact')
}
if (!clientArtifact.includes('data-plugin-css') || !clientArtifact.includes('document.head.appendChild(tag)')) {
  fail('client.js does not contain its tagged CSS injection')
}
if (/^\s*(?:import|export)\s/mu.test(clientArtifact)) fail('client.js contains ESM syntax')
if (/(?:\/home\/|[A-Za-z]:\\Users\\)/u.test(clientArtifact)) fail('client.js contains a developer absolute path')
if (clientArtifact.includes('sourceMappingURL')) fail('client.js contains a source map reference')
const clientRequires = [...clientArtifact.matchAll(/require\("([^"]+)"\)/gu)].map(match => match[1]!).filter(Boolean)
const allowedClientRequires = new Set([
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
])
for (const dependency of clientRequires) {
  if (!allowedClientRequires.has(dependency)) fail(`client.js has unexpected external dependency ${dependency}`)
}

const collectSpecs = async (directory: string) => (await walk(directory))
  .filter(path => /\.spec\.tsx?$/u.test(path))
  .map(path => relative(root, path).replaceAll('\\', '/'))
  .sort()

const runtimeSpecs = await collectSpecs(join(root, 'packages/selector/tests/runtime'))
const selectorSpecs = (await collectSpecs(join(root, 'packages/selector/tests')))
  .filter(path => !path.startsWith('packages/selector/tests/runtime/'))
if (runtimeSpecs.some(path => !path.endsWith('.spec.ts'))) {
  fail('Runtime test inventory contains a spec outside the active **/*.spec.ts project')
}
const selectorUnclassified = selectorSpecs.filter(path => path !== 'packages/selector/tests/cache-prefix-audit.spec.ts'
  && path !== 'packages/selector/tests/estimator-catalog.spec.ts'
  && path !== 'packages/selector/tests/built/client-artifact.spec.ts'
  && !path.endsWith('.host.spec.ts')
  && !path.endsWith('.client.spec.ts')
  && !path.endsWith('.client.spec.tsx'))
if (selectorUnclassified.length > 0) {
  fail(`Selector test inventory contains unclassified specs: ${selectorUnclassified.join(', ')}`)
}
const rootTestConfig = await readFile(join(root, 'vitest.config.ts'), 'utf8')
for (const required of [
  'packages/selector/tests/runtime/**/*.spec.ts',
  'packages/selector/tests/**/*.host.spec.ts',
  'packages/selector/tests/**/*.client.spec.{ts,tsx}',
  'packages/selector/tests/cache-prefix-audit.spec.ts',
]) {
  if (!rootTestConfig.includes(required)) fail(`vitest.config.ts lacks active inventory rule ${required}`)
}
const builtTestConfig = await readFile(join(root, 'vitest.built.config.ts'), 'utf8')
if (!builtTestConfig.includes('packages/selector/tests/built/**/*.spec.ts')) {
  fail('vitest.built.config.ts lacks the built client artifact inventory rule')
}
const forbiddenTestDependencies = [
  /(?:from\s+|import\s*\(|require\s*\()\s*['"]@deepseek-ai\/dsh-compaction-tool-result-pruner/u,
  /(?:from\s+|import\s*\(|require\s*\()\s*['"]@deepseek-ai\/dsh-tool-context-retrieve/u,
  /\.\.\/\.\.\/\.\.\/(?:core|client)\//u,
]
for (const path of [...runtimeSpecs, ...selectorSpecs]) {
  const text = await readFile(join(root, path), 'utf8')
  if (forbiddenTestDependencies.some(pattern => pattern.test(text))) {
    fail(`${path} depends on a removed core-extension or monorepo test contract`)
  }
}

const runtime = await import(new URL('../packages/selector/lib/pruner.js', import.meta.url).href)
const defaults = runtime.DEFAULT_CUSTOM_COMPRESSION_POLICY as Record<string, Record<string, unknown>> | undefined
if ((defaults?.history as Record<string, number>)?.trigger !== 500_000) fail('Custom History default is not 500000')
if ((defaults?.tailTrim as Record<string, unknown>)?.trigger !== 700_000
  || (defaults?.tailTrim as Record<string, unknown>)?.enabled !== false) {
  fail('Custom TailTrim default is not disabled at 700000')
}

console.info('release verification: OK')
