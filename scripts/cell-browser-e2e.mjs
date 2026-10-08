// cell-browser-e2e.mjs —— 六线宿主格子 × 浏览器面 e2e（发版前后均可跑）。
//
// 与 packed-install-e2e.mjs 的分工：那条门在官方 dsh-v0.2.0-rc.1 克隆上验证
// 安装生命周期与 boot 探针（单线、无浏览器交互）；本脚本补的是**多线浏览器面**：
// 按 scripts/hosts.mjs 的六线抽样各备一个格子，从 npm 安装宿主与插件，真启动
// web profile，用 CDP 驱动真实浏览器——设置节/详情卡渲染、Profile 点击写穿、
// 桥读回。0.1.0/0.1.1/0.1.2 三线只有这条门有浏览器面证据。
//
// 用法：
//   pnpm test:browser:e2e              # 六格全跑（首次会逐格 pnpm 装宿主）
//   pnpm test:browser:e2e 0.1.5-rc.3   # 只跑一格（重跑/排障）
// 环境变量：
//   CELL_E2E_DIR   格子根目录（默认 <repo>/.cell-e2e，已 gitignore；删掉即全量重备）
//   PLUGIN_SPEC    插件安装 spec（默认 latest=验证 npm 发布物；可指 file:tgz 或本地目录）
//   CHROME_PATH    Chrome 可执行文件（默认查标准安装位置）
// 前提：pnpm 在 PATH；Chrome/Chromium 可用；registry 可达（宿主 15 rc 在 npm 上齐全）。
//
// 钉版矩阵来源（实测在案，见 .agents/plans/cci-compat-legacy-15rc/tasks.md）：
//   - 0.1.1 线宿主崩于「patch 层监视需要 Cordis HMR 服务」→ sandbox 依赖
//     @deepseek-ai/cordis-plugin-hmr ^1.0.16 + profile 补丁行 insert hmr(root:[])；
//   - 0.1.2 线同病，但 registerConfig 自 1.0.17 起才有 → hmr 钉 1.0.17；
//   - 其余线最小依赖 @deepseek-ai/dsh@<rc> 即可（宿主自带运行时依赖）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const CELL_ROOT = process.env.CELL_E2E_DIR ?? path.join(repoRoot, '.cell-e2e')
// 默认=仓库当前版本：验证「这个版本」在六线上的表现，且精确 spec 免疫
// registry 的 dist-tag metadata 缓存（latest 曾解析到陈旧 0.8.0）。
const PLUGIN_SPEC = process.env.PLUGIN_SPEC
  ?? JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/selector/package.json'), 'utf8')).version
const NPMRC = 'registry=https://registry.npmjs.org\n'
// pnpm ≥12 对带构建脚本的依赖默认拒绝并把安装变成非零退出——宿主运行时需要
// node-pty/koffi/protobufjs/dsh-subprocess-local 的原生/后装产物。pnpm 12.5 的
// 权威开关是 allowBuilds 布尔 map（onlyBuiltDependencies 清单会被无视）。
const ALLOW_BUILDS = [
  'allowBuilds:',
  '  "@deepseek-ai/dsh-subprocess-local": true',
  '  "@google/genai": true',
  '  koffi: true',
  '  node-pty: true',
  '  protobufjs: true',
  '',
].join('\n')
// sandbox：默认 autoInstallPeers（true）——老宿主的 peer 闭包（dsh-timeout 等
// 只声明为 peer 的包）靠它补全，缺了 web client 直接不激活。
const SANDBOX_WORKSPACE_YAML = 'packages:\n  - .\n\nnodeLinker: hoisted\n' + ALLOW_BUILDS
// profile web：只装插件本体，peers 不自动补（宿主运行时靠 sandbox 闭包兜底）。
const WEB_WORKSPACE_YAML = 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n' + ALLOW_BUILDS

// 六线抽样 = 计划 Gate 矩阵的口径（15rc 全测已被用户裁决为抽样即可）。
// cordis 家族钉版 = 实证格子矩阵：npm 上的 @deepseek-ai/dsh 会把老线拖到新
// cordis（0.1.0-rc.2 + cordis 4.0.4/loader 1.0.5 → web client 不激活），
// 各线必须钉它实证能跑的组合。hmr = 0.1.1/0.1.2 宿主的 patch 层监视必需
// （registerConfig 自 1.0.17 起，0.1.1 线钉 ^1.0.16），并配 profile 补丁行。
const HOSTS = [
  {
    rc: '0.1.0-rc.2', generation: 'legacy',
    pins: { '@deepseek-ai/cordis': '4.0.2', '@deepseek-ai/cordis-plugin-group': '1.0.2', '@deepseek-ai/cordis-plugin-hmr': '1.0.17', '@deepseek-ai/cordis-plugin-include': '1.0.7', '@deepseek-ai/cordis-plugin-loader': '1.0.3', '@deepseek-ai/cordis-plugin-timer': '1.1.4' },
  },
  // hmr 必须精确钉：^1.0.16 会浮动到 1.0.19+，而 registerConfig 的签名在
  // 1.0.19 与两条老线都不兼容（host 在 web url 打印后崩于 registerConfig）。
  { rc: '0.1.1-rc.2', generation: 'legacy', pins: { '@deepseek-ai/cordis-plugin-hmr': '1.0.16' }, patchHmr: true },
  { rc: '0.1.2-rc.1', generation: 'legacy', pins: { '@deepseek-ai/cordis-plugin-hmr': '1.0.17' }, patchHmr: true },
  {
    rc: '0.1.5-rc.3', generation: 'legacy',
    pins: { '@deepseek-ai/cordis': '4.0.2', '@deepseek-ai/cordis-plugin-group': '1.0.2', '@deepseek-ai/cordis-plugin-hmr': '1.0.17', '@deepseek-ai/cordis-plugin-include': '1.0.7', '@deepseek-ai/cordis-plugin-loader': '1.0.3', '@deepseek-ai/cordis-plugin-timer': '1.1.4' },
  },
  {
    rc: '0.1.7-rc.1', generation: 'modern',
    pins: { '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/cordis-plugin-group': '1.0.4', '@deepseek-ai/cordis-plugin-hmr': '1.0.19', '@deepseek-ai/cordis-plugin-include': '1.0.9', '@deepseek-ai/cordis-plugin-loader': '1.0.5', '@deepseek-ai/cordis-plugin-timer': '1.1.6' },
  },
  { rc: '0.2.0-rc.2', generation: 'modern', pins: {} },
]
const ONLY = process.argv[2]
const HOSTS_TO_RUN = ONLY ? HOSTS.filter(h => h.rc === ONLY) : HOSTS
if (ONLY && HOSTS_TO_RUN.length === 0) {
  console.error(`unknown host rc "${ONLY}"; one of: ${HOSTS.map(h => h.rc).join(', ')}`)
  process.exit(2)
}

const findChrome = () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = process.platform === 'win32' ? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ] : [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ]
  return candidates.find(p => fs.existsSync(p))
}

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  // Node ≥18.20 拒绝无 shell 直接 spawn .cmd（EINVAL）。
  const child = spawn(command, args, { shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'], ...options })
  let out = ''
  child.stdout.on('data', c => { out += c })
  child.stderr.on('data', c => { out += c })
  child.once('exit', code => code === 0 ? resolve(out) : reject(new Error(`${command} exited ${code}\n${out.slice(-2000)}`)))
  child.once('error', reject)
})

const PROFILE_PATCH_BASE = `# cell-browser-e2e provisioned profile patch
`

async function provisionCell({ rc, pins, patchHmr }) {
  const sandbox = path.join(CELL_ROOT, rc)
  const web = path.join(sandbox, 'home/profiles/web')
  const fresh = !fs.existsSync(path.join(sandbox, 'node_modules/@deepseek-ai/dsh/package.json'))
  if (fresh) {
    fs.rmSync(sandbox, { recursive: true, force: true })
    fs.mkdirSync(web, { recursive: true })
    const sandboxPkg = {
      name: 'cell-browser-e2e-host',
      private: true,
      dependencies: { '@deepseek-ai/dsh': rc, ...pins },
    }
    await fs.promises.writeFile(path.join(sandbox, 'package.json'), JSON.stringify(sandboxPkg, null, 2) + '\n')
    // 自带 workspace+npmrc：切断对仓库 workspace 的目录继承（否则 pnpm 把安装
    // 静默吞进仓库根），并钉死 registry（命令行 --registry 经 shell 传递不可靠）。
    await fs.promises.writeFile(path.join(sandbox, 'pnpm-workspace.yaml'), SANDBOX_WORKSPACE_YAML)
    await fs.promises.writeFile(path.join(sandbox, '.npmrc'), NPMRC)
    await run('pnpm.cmd', ['install', '--no-frozen-lockfile'], { cwd: sandbox })
    await fs.promises.writeFile(path.join(web, 'pnpm-workspace.yaml'), WEB_WORKSPACE_YAML)
    await fs.promises.writeFile(path.join(web, '.npmrc'), NPMRC)
    const profilePkg = {
      name: 'dsh-profile-web',
      private: true,
      dependencies: { 'dsh-context-compression-improved': PLUGIN_SPEC },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-context-compression-improved'] } },
    }
    await fs.promises.writeFile(path.join(web, 'package.json'), JSON.stringify(profilePkg, null, 2) + '\n')
    const patch = patchHmr
      ? `${PROFILE_PATCH_BASE}- insert:\n    - name: '@deepseek-ai/cordis-plugin-hmr'\n      config:\n        root: []\n`
      : `${PROFILE_PATCH_BASE}[]\n`
    await fs.promises.writeFile(path.join(web, 'cordis.patch.yml'), patch)
    await run('pnpm.cmd', ['install', '--no-frozen-lockfile'], { cwd: web })
  } else {
    // 复用格子：只把插件刷到目标 spec（幂等）。
    const web = path.join(sandbox, 'home/profiles/web')
    const pkgPath = path.join(web, 'package.json')
    const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf8'))
    if (pkg.dependencies['dsh-context-compression-improved'] !== PLUGIN_SPEC) {
      pkg.dependencies['dsh-context-compression-improved'] = PLUGIN_SPEC
      await fs.promises.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
      await run('pnpm.cmd', ['install', '--no-frozen-lockfile'], { cwd: web })
    }
  }
  const installed = JSON.parse(await fs.promises.readFile(path.join(web, 'node_modules/dsh-context-compression-improved/package.json'), 'utf8')).version
  return { sandbox, installed }
}

async function bootHost(sandbox) {
  const host = spawn(process.execPath, ['node_modules/@deepseek-ai/dsh/lib/bin.js', '--profile', 'web', '--port', '0', '--no-open'], {
    cwd: sandbox,
    env: { ...process.env, DSH_HOME: path.join(sandbox, 'home') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let bootOut = ''
  host.stdout.on('data', c => { bootOut += c })
  host.stderr.on('data', c => { bootOut += c })
  const t0 = Date.now()
  while (Date.now() - t0 < 60000) {
    const m = bootOut.match(/dsh web: (http:\/\/\S+)/u)
    if (m) return { host, url: m[1] }
    if (host.exitCode !== null) throw new Error(`host exited ${host.exitCode} before web url:\n${bootOut.slice(-1200)}`)
    await sleep(1000)
  }
  host.kill('SIGKILL')
  throw new Error(`no web url within 60s:\n${bootOut.slice(-1200)}`)
}

async function probeWithChrome(bootUrl, generation, shotPath, chromePath) {
  const cdpPort = 9400 + Math.floor(Math.random() * 400)
  const chrome = spawn(chromePath, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${path.join(CELL_ROOT, 'chrome-profile-' + Date.now())}`, '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore' })
  try {
    await sleep(2500)
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()
    const page = targets.find(t => t.type === 'page')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    let id = 0
    const pending = new Map()
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    }
    await new Promise(r => { ws.onopen = r })
    const send = (method, params = {}) => new Promise(resolve => {
      const mid = ++id
      pending.set(mid, resolve)
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
    const evalJS = async (expression, awaitPromise = false) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
      return r.result?.result?.value ?? r.result?.result?.description ?? 'undefined'
    }
    const realClick = async findExpr => {
      const pos = await evalJS(`(() => {
        const el = (${findExpr});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
      })()`)
      if (!pos || pos === 'null' || pos === 'undefined') return null
      const { x, y } = JSON.parse(pos)
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'mouse' })
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'mouse' })
      }
      return `${x},${y}`
    }
    const waitClick = async (tag, findExpr, timeoutMs = 25000) => {
      const t0 = Date.now()
      while (Date.now() - t0 < timeoutMs) {
        if (await realClick(findExpr)) return true
        await sleep(700)
      }
      const labels = await evalJS(`JSON.stringify([...document.querySelectorAll("button,a[role=button]")].map(b => b.textContent?.trim()).filter(Boolean).slice(0, 14))`)
      throw new Error(`click TIMEOUT ${tag}; buttons: ${labels}`)
    }
    const readSettings = async () => JSON.parse(await evalJS(`(async () => {
      const r = await fetch("/api/dsh-context-compression-improved/settings", { headers: { accept: "application/json" } });
      const j = await r.json();
      return JSON.stringify({ profile: j.doc && j.doc.profile, generation: j.generation });
    })()`, true))

    // 首屏两层门（顺序因线而异，且可能复弹）：API Key 弹窗「稍后配置」+
    // 0.1.x「内测声明→继续」。轮询直到两层都不在（有轮次上限）。
    const dismissOverlays = async () => {
      for (let round = 0; round < 4; round += 1) {
        const apiModal = await realClick(`(() => {
          const b = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "稍后配置");
          return b ?? null;
        })()`)
        await sleep(800)
        const banner = await realClick(`(() => {
          const b = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "继续");
          return b ?? null;
        })()`)
        if (!apiModal && !banner) return true
        await sleep(1200)
      }
      return false
    }
    await send('Page.enable')
    await send('Page.navigate', { url: bootUrl })
    await sleep(11000)
    await dismissOverlays()
    await sleep(1000)

    if (generation === 'modern') {
      // 插件面板 → 包详情 → plugins.bundle.config 卡片
      await dismissOverlays()
      await waitClick('plugins-panel', `(() => {
        const b = [...document.querySelectorAll("nav button, button")].filter(b => b.textContent?.trim() === "插件").pop();
        return b ?? null;
      })()`)
      await sleep(2500)
      await waitClick('pkg-title', `(() => {
        const el = [...document.querySelectorAll("*")].filter(e => /^dsh-context-compression-improved/.test(e.textContent?.trim() ?? "") && e.children.length === 0).pop();
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        return el.closest("button") ?? el;
      })()`)
      await sleep(3000)
    } else {
      // 设置弹窗 → 左栏「上下文压缩选择器」分类 → settings.section 节
      await waitClick('settings-panel', `(() => {
        const b = [...document.querySelectorAll("button")].filter(b => b.textContent?.trim() === "设置").pop();
        return b ?? null;
      })()`)
      await sleep(2000)
      await dismissOverlays()
      await waitClick('cci-category', `(() => {
        const b = [...document.querySelectorAll("button")].filter(b => (b.textContent ?? "").includes("上下文压缩")).pop();
        return b ?? null;
      })()`)
      await sleep(2500)
    }

    const face = await evalJS(`(() => ({
      slotErr: document.querySelectorAll("[data-slot-error]").length,
      sectionText: document.body.innerText.includes("平衡模式") || document.body.innerText.includes("压缩 Profile"),
      hasBalancedBtn: [...document.querySelectorAll("button")].some(b => b.textContent?.includes("平衡模式")),
      hasSavingsBtn: [...document.querySelectorAll("button")].some(b => b.textContent?.includes("节省模式")),
      entryErrors: window.__cciEntryError ?? null,
    }))()`)

    // 写穿断言：before/after 必须翻转，不依赖任何残留状态。
    const before = await readSettings()
    const target = before.profile === 'savings' ? '平衡模式' : '节省模式'
    const expected = target === '节省模式' ? 'savings' : 'balanced'
    const clicked = await evalJS(`(() => {
      const card = [...document.querySelectorAll("button")].find(b => b.textContent?.includes(${JSON.stringify(target)}));
      if (card) { card.click(); return 'clicked'; }
      return 'no-btn';
    })()`)
    if (clicked !== 'clicked') throw new Error(`profile button "${target}" not rendered`)
    await sleep(3500)
    const after = await readSettings()
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    if (shot.result?.data) await fs.promises.writeFile(shotPath, Buffer.from(shot.result.data, 'base64'))
    ws.close()
    return { face, before, after, expected }
  } finally {
    chrome.kill()
  }
}

const chromePath = findChrome()
if (!chromePath) {
  console.error('no Chrome/Chromium found; set CHROME_PATH')
  process.exit(2)
}

const results = []
let failed = 0
for (const host of HOSTS_TO_RUN) {
  const line = `${host.rc} (${host.generation})`
  let host_ = null
  try {
    const { sandbox, installed } = await provisionCell(host)
    console.log(`CELL ${line}: plugin ${installed}`)
    const booted = await bootHost(sandbox)
    host_ = booted.host
    console.log(`CELL ${line}: boot ${booted.url}`)
    await sleep(4000)
    const shotPath = path.join(CELL_ROOT, `${host.rc}.png`)
    const { face, before, after, expected } = await probeWithChrome(booted.url, host.generation, shotPath, chromePath)
    const pass = face.slotErr === 0 && face.sectionText === true && face.hasSavingsBtn === true
      && after.profile === expected && before.profile !== after.profile
    console.log(`CELL ${line}: ${pass ? 'PASS' : 'FAIL'} ${JSON.stringify({ face, before, after })}`)
    results.push({ rc: host.rc, pass, installed })
    if (!pass) failed += 1
  } catch (error) {
    console.log(`CELL ${line}: FAIL ${String(error.message).slice(-1500)}`)
    results.push({ rc: host.rc, pass: false })
    failed += 1
  } finally {
    host_?.kill('SIGKILL')
    await sleep(1500)
  }
}
console.log('SUMMARY ' + JSON.stringify(results))
process.exit(failed === 0 ? 0 : 1)
