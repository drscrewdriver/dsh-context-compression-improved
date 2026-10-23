# Checklist

## Must Pass
- [ ] /ccip 命令：无 commands 服务的宿主上静默不挂载、插件加载零报错（照 /ctx-summary 降级形态）；displayPrefs 跨重启从 meta 表恢复；`backfill pause` 后调度器零新 chunk
- [ ] 记账收敛：召回/全文重读的 offset 条目带 sourceSeq，召回文本离面后停止压净值（构造：召回→继续压缩老化出 face→净值回升断言）
- [ ] 翻负折叠：同 basis 下全量召回后该源条目分项贡献 = −b（与现行为数值等值）；部分召回贡献 = a−(b+R)；多次召回累计 R 下限 −b 不再下探
- [ ] 跨 basis 不混算：精确口径源条目遭遇 chars/4 召回时不折叠，保持收敛 offset 流水；exact/estimated 两列合计与折叠前自洽
- [ ] 积分器：无召回时累计单调不减；召回后存量转负积分回落；重启后累计从 store 恢复且不重复计数（sample 按 (session_id, boundarySeq) 幂等）
- [ ] 驱逐保护：ring buffer 满 400 驱逐时，replacementSeq 仍在面上的 saving 条目绝不被清（构造 401+ 条目压力用例）
- [ ] 跨会话不覆盖：同一 DB 灌两个会话，各自 claims/聚合完整互不污染（BC #2671-2 断言；基线 tests/runtime/savings.spec.ts:85 已有内存版先例）
- [ ] 幂等重放：同一会话回填两遍，第二遍零新增行；live 已记录的会话再回填不双计（水位 + INSERT OR IGNORE 对账）
- [ ] 绝对 seq：DB 只写宿主日志绝对 seq，回填后 perSession 数字与内存账本 snapshot() 对账一致（BC #2671-1 断言）
- [ ] 主键必含 sessionId：schema 静态检查 + 迁移后 meta.user_version 正确
- [ ] jsonl fallback fail-soft：header.version 未知/撕裂尾帧/缺口 → 跳过该会话 + 恰一条 warn，绝不整体失败（fixture：session-v4-dump.jsonl + 合成代次样本）——C 线已落解码层：classifySessionHeader 四态 verdict + 撕裂帧抢救/缺口 prefix 21 例绿（session-file-decode.spec.ts）；「跳过+warn」接线待 T20 回填器
- [ ] 回填只读：对会话源文件零写入（测试断言 mtime/size 不变）
- [ ] 隐私：DB 文件字节级扫描无原文/无 SHA-256 savingsHash/无自由文本 errorMessage；audit content-free 测试继续绿
- [ ] 可见降级：无驱动/写失败 → warn 恰一次 + /savings/sessions payload persisted:false + 面板"降级"标注；禁静默吞（BC compaction-guard 教训）
- [ ] /savings 与 /monitor 既有契约不变：monitor.spec.ts 与 savings 相关 8+6 例全绿
- [ ] 路由测试更新后绿：estimator-route-registration.host.spec.ts:116/132/186-188 反映新端点
- [ ] built 产物测试绿：vitest.built.config.ts CJS 白名单通过（node:sqlite 走 `node:` 前缀）
- [ ] verify-release.mjs 依赖闸通过：better-sqlite3 若声明仅入 optionalDependencies，两份 package.json 同步
- [ ] 9 语 locale 键一致：zh/en（locales.ts）+ de/es/fr/it/ja/ko/ru 七文件；"重启归零"旧文案全部替换
- [ ] 全量 vitest 三 project 绿 + pnpm build（tsdown）绿
- [ ] ctx.effect(close) 生效：插件卸载/热重载后无泄漏 fd（打开句柄断言）

## Should Pass
- [ ] 省钱加权：有定价路由显示 cached/uncached 分权估计（缓存读边际价 ≈1/10），无定价路由仅 token 口径不崩
- [ ] 性能：43 会话样例（~20MB zstd）全量回填 < 5s；单会话 decode+parse ≤ 100ms 量级（B 实测基线 84ms）
- [ ] 面板分页 payload ≤ 64KB/页；服务端截断，聚合 snapshot 不再 O(N×条目) 全量递归
- [ ] WAL：写路径 chunked 事务（10-50 会话/事务）；busy_timeout 生效（并发双连接写测试）
- [ ] DB 可随时删除重建：删文件后插件自动重建空库且功能不崩
- [ ] 六线 peer 清单 diff 为零（本次不新增任何 peer 依赖）
