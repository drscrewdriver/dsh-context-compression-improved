# Shallow/Discard 教学补丁行模板（preset-overlay 通道，T4.13）

> 用途：Flash 精简类（PTC/code-mode）preset 的 author 把以下 section 行并入 preset 的
> systemPrompt 组合，即可在**该 preset 内**启用弃对协议教学；非 PTC preset 不引用则零注入。
> 插件侧的运行时兜底（对所有 preset 生效的最小指导）在
> `packages/selector/src/runtime/shallow-tools.ts` 的 `systemPrompt.section`，
> 本文是它的**按 preset 加强版**，不是替代品。

## 补丁行（YAML，进 preset 的 systemPrompt sections）

```yaml
- id: context-compression-shallow-teaching
  section: tool:context-compression-shallow
  order: 115
  text: |
    Large-file reading protocol (code mode):
    1. PROBE FIRST. Before reading a file larger than ~3K tokens, call
       context_compression_probe with its path; it returns the recommended
       shallow view in O(1) without opening the body.
    2. MAP BEFORE BODY. Prefer context_compression_shallow to get the
       declaration/outline/key-map view plus its checkpoint line
       ([cci-checkpoint] path | coverage | ref | fingerprint). Decide the
       needed line window from the map, then read only that window.
    3. PAIR AND RELEASE. A full read of a file that has a live shallow map
       carries a [cci-shallow-pair] footer. When the map is superseded, call
       context_compression_discard with both refs; the guard refuses when the
       covering read does not span the map. The checkpoint line always
       survives; retrieve by ref recovers any body on demand.
    4. NEVER reconstitute withheld or discarded output from memory; the ref
       in the checkpoint/footer is the recovery path.
```

## 接线核对清单（preset author）

- [ ] 目标 preset 是 PTC/code-mode 形态（wire 上只暴露 run_code / code_run）
- [ ] section `order: 115` 不与宿主既有 tool section 冲突（114 为 retrieve）
- [ ] preset 引用的 selector 模块版本 ≥ 本分支（含 shallow-tools 注册）
- [ ] 非 PTC preset 保持不引用本 section（默认零教学噪声）

## 与运行时兜底的关系

| 层 | 生效范围 | 内容 |
|---|---|---|
| 工具 description（静态） | 全部 | 一句话用途 + PTC_BINDING_NOTE |
| `systemPrompt.section`（运行时注入） | 全部 | 最小三步指导（probe→shallow→discard 名称与用途） |
| 本 preset 补丁行 | 仅引用的 preset | 完整四步协议 + 反补写纪律 |
