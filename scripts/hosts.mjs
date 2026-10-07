/**
 * hosts.mjs —— 宿主声明唯一事实源（enum-peer 家族范式，见
 * improve-dsh-plugins/enum-peer-migration/INDEX.md §A）。
 *
 * 15 rc 全量六线（0.1.0-rc.2 → 0.2.0-rc.2）。compat-legacy 单版本计划
 * （.agents/plans/cci-compat-legacy-15rc/）的 Gate 0 实跑结论：
 *   - 0.1.0-rc.2 格 cci 0.8.0 + 探针 boot 绿（findings B2.3）——无 0.1.0 降级依据；
 *   - 三干净格证据目录 _tmp-audit/spike-cells/。
 *
 * developmentHost 显式偏离家族惯例（rc.2）：本仓 devDeps/overrides 钉 0.2.0-rc.1，
 * 且 Gate 0 已证 0.1.7-rc.2 ↔ 0.2.0-rc.1/2 运行时 waist 等价（零 src 差异）——
 * rc.1 床 = lockfile 零 churn（P1-2/P1-10 绑定决策，spec 决策记录）。
 */
export const supportedHosts = Object.freeze([
	'0.1.0-rc.2',
	'0.1.0-rc.3',
	'0.1.0-rc.6',
	'0.1.0-rc.7',
	'0.1.0-rc.8',
	'0.1.1-rc.1',
	'0.1.1-rc.2',
	'0.1.2-rc.1',
	'0.1.5-rc.1',
	'0.1.5-rc.2',
	'0.1.5-rc.3',
	'0.1.7-rc.1',
	'0.1.7-rc.2',
	'0.2.0-rc.1',
	'0.2.0-rc.2',
])
export const peerRange = supportedHosts.join(' || ')
/** 显式偏离：devDeps 钉 rc.1（见文件头）。 */
export const developmentHost = '0.2.0-rc.1'

/**
 * root package.json 的 host peer 集 = npm/git 安装面 = 宿主 peer 闸唯一可见面
 * （verify-release.mjs:20-22 自证 + npm@0.8.0 registry 对照，findings §A0）。
 * 这四个 peer 的枚举是防老线拒载的唯一闸门动作。
 */
export const rootHostPeers = Object.freeze([
	'@deepseek-ai/dsh-client-locale',
	'@deepseek-ai/dsh-client-ui-primitives',
	'@deepseek-ai/dsh-client-ui-settings',
	'@deepseek-ai/dsh-client-ui-slots',
])

/**
 * selector 子包的 dsh-* peer 集 = 内部一致性面（不进 npm 清单、宿主闸看不到）。
 * 枚举化是同一口径的一致性动作，不承担闸门职能。cordis（>=4.0.1 <5）与
 * react（>=18 <19）不属宿主版本轴，保持原值不枚举。
 * 硬约束（findings §A0/§B3）：这些包在老线可能不存在（autoInstallPeers:false
 * 时不进注册表），src 对其中部分零 import——枚举只约束「宿主运行时版本」匹配。
 */
export const selectorDshPeers = Object.freeze([
	'@deepseek-ai/dsh-agent',
	'@deepseek-ai/dsh-agent-presets',
	'@deepseek-ai/dsh-client-locale',
	'@deepseek-ai/dsh-client-store',
	'@deepseek-ai/dsh-client-ui-primitives',
	'@deepseek-ai/dsh-client-ui-session',
	'@deepseek-ai/dsh-client-ui-settings',
	'@deepseek-ai/dsh-client-ui-slots',
	'@deepseek-ai/dsh-client-ui-workspace',
	'@deepseek-ai/dsh-command-compact',
	'@deepseek-ai/dsh-compaction',
	'@deepseek-ai/dsh-compaction-basic',
	'@deepseek-ai/dsh-invariants',
	'@deepseek-ai/dsh-llm',
	'@deepseek-ai/dsh-session',
	'@deepseek-ai/dsh-settings',
	'@deepseek-ai/dsh-system-prompt',
	'@deepseek-ai/dsh-token-meter',
	'@deepseek-ai/dsh-tools',
])
