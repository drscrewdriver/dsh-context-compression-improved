/**
 * 压缩监控浮动球 + 面板(task: cci-monitor-fab;骨架整编自 pm 撤下的
 * `longtask-fab.ts` — d29bcb1^, VANILLA DOM overlay 模式: FAB + 面板
 * appendChild 到 document.body, position:fixed + JS 内联定位, Pointer Events
 * 拖拽 + localStorage 持久化 + 视口夹紧)。
 *
 * cci 客户端纪律:
 *  - body 级直挂 = 幂等单例,应用生命周期存续,不做 dispose(页面刷新自然回收);
 *  - 回声环过滤:自有节点带 `dsh-cci-parasite` 类,不参与宿主面板探测;
 *  - 数据面: `/api/.../monitor` 忙 2s / 闲 5s 自调度轮询(savings 卡同口径),
 *    fetch 失败静默降级 + 陈旧标记——监控面板永不打扰主流程;
 *  - 动作面: 仅会话覆盖(POST,复用 /ctx-summary 状态机),不做压缩执行。
 *
 * 显隐: `enabledOf()`(设置文档 monitorPanel.enabled)为总闸;总闸开才显示球;
 * 净节省为负时「点亮」呼吸态(负节省警示)。v1 监控全会话聚合(savings 卡同
 * 口径),覆盖作用于默认会话;会话级绑定待 cci 有输入栏座位后另行接线。
 */

const FAB_ID = 'dsh-cci-monitor-fab';
const PANEL_ID = 'dsh-cci-monitor-panel';
const STYLE_ID = 'dsh-cci-monitor-style';
const PARASITE = 'dsh-cci-parasite';
const POS_KEY = 'dsh.cci.monitor.pos';

/** `/monitor` 快照的消费侧窄化(服务端契约在路由 spec 钉住;此处自断言)。 */
export interface MonitorSnapshotPayload {
  ok?: unknown
  startedAt?: unknown
  gross?: { exact?: unknown; estimated?: unknown }
  offsets?: { exact?: unknown; estimated?: unknown }
  net?: { exact?: unknown; estimated?: unknown }
  usage?: { requests?: unknown; cacheHitRate?: unknown }
  pricing?: { currency?: unknown; actualCost?: unknown; estimatedSavedCost?: unknown }
  intent?: {
    override?: 'on' | 'off' | undefined
    observedEnabled?: boolean | undefined
    gate?: { floorFraction?: unknown; growthTokens?: unknown }
    lastFold?: { turn?: unknown; startSeq?: unknown; endSeq?: unknown } | undefined
  }
  context?: { liveTokens?: unknown; contextWindow?: unknown; pct?: unknown }
  suggestion?: { suggest?: unknown; thresholdPct?: unknown; occupancyPct?: unknown }
  recentOffsets?: Array<{ component?: unknown; tokens?: unknown }>
  /** /monitor 附加统计块:只带当前会话——组成按压缩路径(无数据省略)+持久化状态。 */
  persisted?: { persisted?: unknown; driver?: unknown; reason?: unknown }
  composition?: Array<{ component?: unknown; basis?: unknown; tokens?: unknown; events?: unknown }>
  /** 组成归属的会话(服务端解析的最近压缩会话,回带以正名)。 */
  compositionSession?: unknown
  /** 会话三值(毛/抵消/净,该会话持久 claims 聚合 = jsonl 公式口径)。 */
  sessionTotals?: {
    gross?: { exact?: unknown; estimated?: unknown }
    offsets?: { exact?: unknown; estimated?: unknown }
    net?: { exact?: unknown; estimated?: unknown }
  }
  /** 每类目「最后的 Δ」(claims 账本内 saving/offset 各自 seq 最大一行)。 */
  lastDelta?: {
    saving?: { tokens?: unknown; seq?: unknown }
    offset?: { tokens?: unknown; seq?: unknown }
  }
  sessionScope?: string | null
}

export type MonitorAction = 'on' | 'off' | 'clear'

export interface MonitorFabDeps {
  /** bind(NS) 的活性翻译器:漏译回退键名,跟随宿主语言切换。 */
  t: (key: string) => string
  fetchSnapshot: (sessionId: string | undefined) => Promise<MonitorSnapshotPayload>
  applyOverride: (sessionId: string | undefined, action: MonitorAction) => Promise<void>
  sessionIdOf: () => string | undefined
  enabledOf: () => boolean
  /** 首轮轮询延迟(ms);测试注入 1ms 走真实时钟。 */
  initialDelayMs?: number
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function initMonitorFab(deps: MonitorFabDeps): void {
  if (document.getElementById(FAB_ID) !== null) return;
  const { t } = deps;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#${FAB_ID} { position: fixed; z-index: 9999; width: 42px; height: 42px; border-radius: 50%;
  background: rgba(30,30,32,.72); backdrop-filter: blur(22px) saturate(180%);
  border: 1px solid rgba(255,255,255,.14); box-shadow: 0 8px 24px rgba(0,0,0,.4);
  color: #f5f5f7; font-size: 18px; line-height: 40px; text-align: center; cursor: grab;
  touch-action: none; user-select: none; display: none; transition: transform .18s; }
#${FAB_ID}:hover { transform: scale(1.08); }
#${FAB_ID}.lit { display: block; box-shadow: 0 0 0 5px rgba(255,159,10,.28), 0 8px 24px rgba(0,0,0,.4);
  animation: dsh-cci-mon-breathe 2.4s ease-in-out infinite; }
@keyframes dsh-cci-mon-breathe { 0%,100% { box-shadow: 0 0 0 4px rgba(255,159,10,.18), 0 8px 24px rgba(0,0,0,.4); }
  50% { box-shadow: 0 0 0 8px rgba(255,159,10,.32), 0 8px 24px rgba(0,0,0,.4); } }
#${PANEL_ID} { position: fixed; z-index: 9998; width: 336px; border-radius: 14px;
  background: rgba(28,28,30,.78); backdrop-filter: blur(26px) saturate(180%);
  border: 1px solid rgba(255,255,255,.12); box-shadow: 0 14px 44px rgba(0,0,0,.55);
  color: #f5f5f7; font-size: 12.5px; opacity: 0; pointer-events: none;
  transform: translateY(10px) scale(.92); transform-origin: 88% 100%;
  transition: opacity .22s cubic-bezier(.16,.8,.3,1.05), transform .22s cubic-bezier(.16,.8,.3,1.1); }
#${PANEL_ID}.open { opacity: 1; pointer-events: auto; transform: none; }
#${PANEL_ID} h4 { margin: 0; padding: 10px 14px 8px; font-size: 13px; cursor: grab;
  touch-action: none; user-select: none; border-bottom: 1px solid rgba(255,255,255,.09); }
#${PANEL_ID} .row { display: flex; align-items: center; gap: 8px; padding: 6px 14px; }
#${PANEL_ID} .row.label { width: 108px; flex: none; color: rgba(245,245,247,.55); }
#${PANEL_ID} .muted { color: rgba(245,245,247,.55); }
#${PANEL_ID} .neg { color: #ff9f0a; }
#${PANEL_ID} button { font: inherit; border-radius: 8px; border: 1px solid rgba(255,255,255,.18);
  background: rgba(10,132,255,.85); color: #fff; padding: 4px 10px; cursor: pointer; }
#${PANEL_ID} button.ghost { background: transparent; }
#${PANEL_ID} button:disabled { opacity: .45; cursor: default; }
#${PANEL_ID} .stale { padding: 4px 14px 8px; color: #ffd60a; display: none; }
#${PANEL_ID} .hint { margin: 0; padding: 8px 14px; color: #ffd60a; display: none;
  border-bottom: 1px solid rgba(255,255,255,.09); }
#${PANEL_ID} .hint.show { display: block; }
#${PANEL_ID} .stale.show { display: block; }
#${PANEL_ID} .recent { max-height: 132px; overflow: auto; padding: 2px 14px 8px;
  color: rgba(245,245,247,.8); white-space: pre-wrap; }
`;
  document.head.appendChild(style);

  const fab = document.createElement('div');
  fab.id = FAB_ID;
  fab.className = PARASITE;
  fab.textContent = '📉';
  fab.title = t('monitor.fab.title');
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = PARASITE;
  panel.hidden = true;
  panel.innerHTML = `
<h4>${t('monitor.panel.title')}</h4>
<div class="hint" data-hint></div>
<div class="row"><span class="label">${t('monitor.panel.net')}</span><span data-net>–</span></div>
<div class="row"><span class="label">${t('monitor.panel.gross')}</span><span data-gross class="muted">–</span></div>
<div class="row"><span class="label">${t('monitor.panel.offsets')}</span><span data-offsets class="muted">–</span></div>
<div class="row"><span class="label">${t('monitor.panel.context')}</span><div class="bar"><i data-ctxbar></i></div><span data-ctxpct class="muted">–</span></div>
<div class="row"><span class="label">${t('monitor.panel.cacheHit')}</span><span data-cache class="muted">–</span></div>
<div class="row"><span class="label">${t('monitor.panel.cost')}</span><span data-cost class="muted">–</span></div>
<div class="row"><span class="label">${t('monitor.panel.intent')}</span><span data-intent class="muted">–</span></div>
<div class="row"><span class="label">${t('monitor.panel.overrideHint')}</span>
  <button data-overon>${t('monitor.panel.resume')}</button>
  <button data-overoff class="ghost">${t('monitor.panel.disable')}</button></div>
<div class="row muted" data-fold style="display:none"></div>
<div class="stale" data-stale>${t('monitor.panel.stale')}</div>
<div data-compwrap style="display:none">
  <div class="row"><span class="label">${t('monitor.panel.composition')}</span></div>
  <div class="row muted" data-compscope style="display:none"></div>
  <div class="recent" data-comp></div>
</div>
<div class="recent" data-recent></div>
`;
  document.body.append(fab, panel);

  // 位置:localStorage 恢复 + 视口夹紧(pm 骨架原样)
  let pos: { x: number; y: number };
  try {
    pos = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') ?? {
      x: Math.max(8, window.innerWidth - 66),
      y: Math.max(8, Math.round(window.innerHeight * 0.6)),
    };
  } catch {
    pos = { x: Math.max(8, window.innerWidth - 66), y: Math.max(8, Math.round(window.innerHeight * 0.6)) };
  }
  const clamp = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: Math.max(8, Math.min(window.innerWidth - 50, p.x)),
    y: Math.max(8, Math.min(window.innerHeight - 50, p.y)),
  });
  const place = (): void => {
    pos = clamp(pos);
    fab.style.left = `${pos.x}px`;
    fab.style.top = `${pos.y}px`;
  };
  place();
  window.addEventListener('resize', place);

  const makeDrag = (el: HTMLElement, key: 'fab' | 'panel'): void => {
    let active = false;
    let moved = false;
    let origin = { x: 0, y: 0 };
    let startPos = { x: 0, y: 0 };
    el.addEventListener('pointerdown', (e) => {
      active = true;
      moved = false;
      origin = { x: e.clientX, y: e.clientY };
      startPos = { x: pos.x, y: pos.y };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!active) return;
      // 以「按下时的位置」为基准 + 指针相对按下点的总位移。若把每帧更新后的 pos
      // 再当基准叠加总位移,位移会被重复累加,浮窗一路被甩到边缘(只能贴边)。
      const next = clamp({ x: startPos.x + (e.clientX - origin.x), y: startPos.y + (e.clientY - origin.y) });
      if (Math.abs(next.x - pos.x) > 2 || Math.abs(next.y - pos.y) > 2) moved = true;
      pos = key === 'fab' ? next : pos;
      if (key === 'fab') place();
    });
    el.addEventListener('pointerup', () => {
      active = false;
      if (moved && key === 'fab') {
        try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* 隐私模式:位置不持久化 */ }
      }
    });
    el.addEventListener('pointercancel', () => {
      active = false;
    });
  };
  let suppressClick = false;
  makeDrag(fab, 'fab');

  let open = false;
  fab.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    open = !open;
    if (open) {
      panel.hidden = false;
      const px = Math.max(8, Math.min(window.innerWidth - 344, pos.x - 300));
      const py = pos.y - 300 < 8 ? pos.y + 46 : Math.max(8, pos.y - 300);
      panel.style.left = `${px}px`;
      panel.style.top = `${py}px`;
      void panel.offsetHeight;
      panel.classList.add('open');
    } else {
      panel.classList.remove('open');
      setTimeout(() => {
        panel.hidden = true;
      }, 240);
    }
  });
  makeDrag(panel.querySelector('h4') as HTMLElement, 'panel');

  // 状态与轮询
  let stale = false;
  let busyAction = false;

  const fmtTokens = (n: unknown): string => num(n).toLocaleString('en-US');

  // 面板主数字口径:优先精确 tokenizer(exact);exact 为 0(如无内置 tokenizer 的
  // Qwen 路由)时退回估算(chars/4)并标 "est"。两口径绝不合并成一个数。
  const lead = (exact: unknown, estimated: unknown): { v: number; est: boolean } => {
    const ex = num(exact);
    const es = num(estimated);
    return ex !== 0 ? { v: ex, est: false } : { v: es, est: es !== 0 };
  };

  const render = (snap: MonitorSnapshotPayload): void => {
    // 单一来源(用户定标):Δ 三行只认服务端下发的会话三值(DRS 投影每次全量
    // 重导:毛=Σ(a−b) 仅压缩对,抵消=Σb 仅召回对,净=毛−抵消)。无下发 = 「–」
    // ——不回退 live/claims 账本,杜绝双源串数;长度新鲜度由 DRS 同步负责。
    const stockSource = (kind: 'net' | 'gross' | 'offsets'): { exact?: unknown; estimated?: unknown } | undefined =>
      snap.sessionTotals?.[kind] as { exact?: unknown; estimated?: unknown } | undefined;
    const fmtArm = (source: { exact?: unknown; estimated?: unknown } | undefined, negative: boolean): string => {
      if (source === undefined) return '–';
      const l = lead(source.exact, source.estimated);
      if (!negative) return l.est ? `${fmtTokens(l.v)} est` : fmtTokens(l.v);
      return l.v === 0 ? '0' : l.est ? `-${fmtTokens(l.v)} est` : `-${fmtTokens(l.v)}`;
    };
    const net = num(stockSource('net')?.exact) + num(stockSource('net')?.estimated);
    const netEl = panel.querySelector('[data-net]') as HTMLElement;
    netEl.textContent = fmtArm(stockSource('net'), false);
    netEl.classList.toggle('neg', net < 0);
    const suggest = snap.suggestion?.suggest === true;
    fab.classList.toggle('lit', suggest || net < 0);
    const hint = panel.querySelector('[data-hint]') as HTMLElement;
    if (suggest) {
      const pct = typeof snap.suggestion?.occupancyPct === 'number'
        ? Math.round(snap.suggestion.occupancyPct * 100)
        : null;
      hint.textContent = (t('monitor.panel.suggest') as string).replace('{pct}', String(pct ?? '–'));
      hint.classList.add('show');
    } else {
      hint.classList.remove('show');
    }
    (panel.querySelector('[data-gross]') as HTMLElement).textContent = fmtArm(stockSource('gross'), false);
    (panel.querySelector('[data-offsets]') as HTMLElement).textContent = fmtArm(stockSource('offsets'), true);
    // 「汇总 · Δ最后」两段式:主数与 Δ 段同一来源(DRS 投影下发的 lastDelta,
    // 压缩/召回各自 seq 最大一行,saving 为正、offset 为负);无记录不加段。
    const deltaSeg = (tokens: unknown, sign: 1 | -1): string => {
      const value = num(tokens);
      return value === 0 ? '' : ` · Δ${sign > 0 ? '+' : '-'}${fmtTokens(Math.abs(value))}`;
    };
    const lastSaving = snap.lastDelta?.saving;
    const lastOffset = snap.lastDelta?.offset;
    const netDelta = lastSaving === undefined && lastOffset === undefined
      ? ''
      : num(lastSaving?.seq) >= num(lastOffset?.seq)
        ? deltaSeg(lastSaving?.tokens, 1)
        : deltaSeg(lastOffset?.tokens, -1);
    netEl.textContent += netDelta;
    (panel.querySelector('[data-gross]') as HTMLElement).textContent += deltaSeg(lastSaving?.tokens, 1);
    (panel.querySelector('[data-offsets]') as HTMLElement).textContent += deltaSeg(lastOffset?.tokens, -1);
    // 「怎么省的」:本会话 saving claims 按压缩路径聚合(top5)
    const compRows = Array.isArray(snap.composition) ? snap.composition.slice(0, 5) : [];
    (panel.querySelector('[data-compwrap]') as HTMLElement).style.display = compRows.length === 0 ? 'none' : '';
    const scopeEl = panel.querySelector('[data-compscope]') as HTMLElement;
    const scopeId = typeof snap.compositionSession === 'string' ? snap.compositionSession.replace(/^session-/, '').slice(0, 8) : '';
    scopeEl.style.display = scopeId !== '' ? '' : 'none';
    if (scopeId !== '') scopeEl.textContent = `${t('monitor.panel.compositionScope')} ${scopeId}`;
    if (compRows.length > 0) {
      (panel.querySelector('[data-comp]') as HTMLElement).textContent = compRows
        .map((row) => {
          const e = row as { component?: unknown; basis?: unknown; tokens?: unknown; events?: unknown };
          // exact / mixed(跨口径合并) 任一含精确即不打 est;回填投影如实改名
          const est = e.basis === 'exact-tokenizer' || e.basis === 'mixed' ? '' : ' est';
          const name = e.component === 'projection' ? `${t('monitor.panel.compositionBackfill')}(projection)` : String(e.component ?? '–');
          return `${name}: +${fmtTokens(e.tokens)}${est} · ${String(e.events ?? '–')}×`;
        })
        .join('\n');
    }
    const h4El = panel.querySelector('h4') as HTMLElement;
    h4El.textContent = t('monitor.panel.title') + (snap.persisted?.persisted === false ? ' ⚠' : '');
    const ctxBar = panel.querySelector('[data-ctxbar]') as HTMLElement;
    const ctxPct = panel.querySelector('[data-ctxpct]') as HTMLElement;
    const ctxPctNum = typeof snap.context?.pct === 'number' ? snap.context.pct : null;
    if (ctxPctNum === null) {
      ctxBar.style.width = '0%';
      ctxPct.textContent = '–';
    } else {
      ctxBar.style.width = `${Math.min(100, Math.round(ctxPctNum * 100))}%`;
      ctxBar.parentElement?.classList.toggle('hot', ctxPctNum >= 0.7);
      ctxPct.textContent = `${Math.round(ctxPctNum * 100)}%`;
    }
    const hit = snap.usage?.cacheHitRate;
    (panel.querySelector('[data-cache]') as HTMLElement).textContent =
      typeof hit === 'number' ? `${Math.round(hit * 100)}%` : '–';
    const pricing = snap.pricing;
    (panel.querySelector('[data-cost]') as HTMLElement).textContent =
      pricing?.actualCost === undefined && pricing?.estimatedSavedCost === undefined
        ? '–'
        : `${pricing?.actualCost ?? '–'} / -${pricing?.estimatedSavedCost ?? '–'} ${String(pricing?.currency ?? '')}`.trim();
    const intentEl = panel.querySelector('[data-intent]') as HTMLElement;
    const override = snap.intent?.override;
    const observed = snap.intent?.observedEnabled;
    intentEl.textContent = override === 'on' || override === 'off'
      ? `${t('monitor.panel.overridePrefix')} ${override === 'on' ? t('monitor.panel.stateOn') : t('monitor.panel.stateOff')}`
      : observed === undefined
        ? t('monitor.panel.gateUnknown')
        : observed ? t('monitor.panel.stateOn') : t('monitor.panel.stateOff');
    const fold = snap.intent?.lastFold;
    const foldEl = panel.querySelector('[data-fold]') as HTMLElement;
    if (fold !== undefined && fold !== null && typeof fold === 'object') {
      foldEl.style.display = '';
      foldEl.textContent = `${t('monitor.panel.lastFold')} turn ${String(fold.turn ?? '–')}, seq ${String(fold.startSeq ?? '–')}..${String(fold.endSeq ?? '–')}`;
    } else {
      foldEl.style.display = 'none';
    }
    // 最近抵消(压缩后再读全文的负项) top3：无记录整行隐藏——旧空态文案
    // 「尚无压缩记录」与上方组成块自相矛盾(无抵消≠无压缩，回填投影明明在)，
    // savings.empty 的真正空态职责在设置页账本(savings-card)。
    const recent = Array.isArray(snap.recentOffsets) ? snap.recentOffsets.slice(0, 3) : [];
    const recentEl = panel.querySelector('[data-recent]') as HTMLElement;
    recentEl.style.display = recent.length === 0 ? 'none' : '';
    if (recent.length > 0) {
      recentEl.textContent = recent
          .map((entry: { component?: unknown; tokens?: unknown }) => {
            const e = entry as { component?: unknown; tokens?: unknown };
            return `${String(e.component ?? '–')}: ${fmtTokens(e.tokens)}`;
          })
          .join('\n');
    }
    for (const [selector, action] of [
      ['[data-overon]', 'on'],
      ['[data-overoff]', 'off'],
    ] as const) {
      (panel.querySelector(selector) as HTMLButtonElement).disabled = busyAction || override === action;
    }
  };

  const markStale = (isStale: boolean): void => {
    stale = isStale;
    (panel.querySelector('[data-stale]') as HTMLElement).classList.toggle('show', stale);
  };

  const tick = async (): Promise<void> => {
    const enabled = deps.enabledOf();
    fab.style.display = enabled ? 'block' : 'none';
    if (!enabled) {
      if (open) {
        open = false;
        panel.classList.remove('open');
        panel.hidden = true;
      }
      setTimeout(tick, 5000);
      return;
    }
    try {
      const snap = await deps.fetchSnapshot(deps.sessionIdOf());
      markStale(false);
      render(snap);
    } catch {
      /* 快照不可达:静默 + 陈旧标记,不打扰主流程 */
      markStale(true);
    }
    setTimeout(tick, open ? 2000 : 5000);
  };
  setTimeout(tick, deps.initialDelayMs ?? 1500);

  const wireOverride = (selector: string, action: MonitorAction): void => {
    panel.querySelector(selector)?.addEventListener('click', async () => {
      if (busyAction) return;
      busyAction = true;
      try {
        await deps.applyOverride(deps.sessionIdOf(), action);
        const sid = deps.sessionIdOf();
        const snap = await deps.fetchSnapshot(sid);
        markStale(false);
        render(snap);
      } catch {
        markStale(true);
      } finally {
        busyAction = false;
      }
    });
  };
  wireOverride('[data-overon]', 'on');
  wireOverride('[data-overoff]', 'off');
}
