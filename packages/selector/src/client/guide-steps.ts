/**
 * dsh-context-compression-improved 的首次使用引导文案（zh + en 各 4 步；末条讲用量端点）。
 *
 * 为什么单独一个文件：`guide.tsx` 是 `_tools/guide-kit/` 的**生成副本**（sync 会覆盖），
 * 本插件的步骤正文不能写进副本；引导外壳的十语词表由副本自带，正文按
 * 「本语 → en → zh → 任意可用」回退，所以这里只写 zh/en 不会留空白。
 *
 * 术语对齐 `locales.ts` 的真实译名（Profile 名、代码骨架压缩、轮尾沉降、
 * 回合末意图摘要、压缩监控、悬浮面板、净节省/毛节省/负节省、水位、估计器、通道）。
 */
import type { GuideLocale, GuideStep } from './guide.tsx'

export const CCI_GUIDE_STEPS: Partial<Record<GuideLocale, readonly GuideStep[]>> = {
  zh: [
    {
      title: '先选 Profile，再看正交开关',
      body: '设置 → 上下文压缩选择器，上方卡片就是压缩档位（平衡模式／节省模式／PTC 模式（绝对水位）等），点一下即改即存。下面的代码骨架压缩、轮尾沉降、回合末意图摘要属于档位之外的正交开关（默认关），Auto Compact 触发水位才是随档位联动的参数。',
    },
    {
      title: '只对新会话生效，沉降还会撤下原消息',
      body: '运行时首次观察某个会话时就冻结策略，改完当前会话没反应不是保存失败——开新会话才用新档位；只有出现「保存失败，请重试」才是真失败。开启轮尾沉降后，该轮工具调用区间被一张沉降卡替换，原消息会从对话视图撤出（原文仍在会话日志，可用卡里的序号回捞）。',
    },
    {
      title: '看节省去悬浮面板，先分清口径',
      body: '在设置里打开「悬浮面板」，输入区旁出现可拖拽的悬浮球，点开是压缩监控：净节省、毛节省、负节省（压缩后再读全文的抵消）、缓存命中率与成本估算。设置页底部的「节省统计(本进程)」在首次裁剪前是空的；标注「持久化降级」说明统计只留在内存。',
    },
    {
      title: '压缩与折叠走本地直连端点',
      body: '两处都能单独指定模型：设置页的「估计器（可选）」（仅「TokenPilot 启发模式」提供）把「通道」选成「直连 OpenAI 兼容端点」，填端点地址（/v1）与一个小模型；轮尾折叠的两层端点（高吞吐档吃 ≤2K 输入、稳定档吃 2~8K，如本地 35B）在配置里写 `sediment.foldMode: direct` 加 `foldBaseUrl` / `foldStrata*` / `foldLocal35*`。停在「宿主模型」时，压缩与对话共用同一个 provider/model，每轮裁剪都在吃对话 token。',
    },
  ],
  en: [
    {
      title: 'Pick a profile first, then the orthogonal switches',
      body: 'Settings → Context compression selector: the cards at the top are the profiles (Balanced, Savings, PTC / Code-mode (absolute), …); a click applies and saves. Code skeleton compression, turn-tail sedimentation, and turn-tail intent summary below are orthogonal switches outside the profile (off by default), while the Auto Compact trigger level is the one parameter that follows the profile.',
    },
    {
      title: 'New sessions only — and sedimentation pulls originals out of view',
      body: 'A session freezes its policy the first time the runtime observes it, so no visible change in the current session is not a failed save — open a new session; only “Save failed” means the save really failed. With turn-tail sedimentation on, each turn’s tool-call span becomes one sediment card and the replaced messages leave the transcript view (originals stay in the session log and can be retrieved by the card’s sequence numbers).',
    },
    {
      title: 'Read savings in the monitor, mind the basis',
      body: 'Turn on “Floating panel” in settings and a draggable ball appears next to the composer; it opens the compression monitor with net Δ, gross Δ, offsets (full reads after compression), cache hit rate, and cost estimates. The “Savings (this process)” card at the bottom of Settings stays empty until the first trim; a “persistence degraded” note means the numbers live in memory only.',
    },
    {
      title: 'Route compression and folding to local direct endpoints',
      body: 'Two places take an explicit model: the Estimator block in settings (offered only under the TokenPilot-inspired profile) — set Channel to “Direct OpenAI-compatible endpoint” with a /v1 base URL and a small model; and the two turn-tail folding tiers (a high-throughput tier for inputs ≤2K, a stable tier such as local 35B for 2–8K), configured as sediment.foldMode: direct with foldBaseUrl / foldStrata* / foldLocal35*. Left on “Host model”, summarisation shares one provider/model with the conversation, so every trim spends conversation tokens.',
    },
  ],
}
