// T5.3 turn-tail fold latency report (plan cci-sedimentation-triage, M18).
//
// Data source: the single observability line emitted by the pruner's fold
// channel on every fold attempt:
//   context-compression sediment fold (<session>): tier=<t> ok=<b> latencyMs=<n>[ reason=<r>]
// Feed it any capture of host stdout/stderr (the Host logger has no file sink;
// `dsh … 2>&1 | tee run.log` or the desktop console capture is the intake).
//
// Usage: node scripts/sediment-latency-report.mjs <logfile> [more logs…]
// Exit 0 with "insufficient samples" note until ≥50 attempts are accumulated —
// the ≥50 threshold is an acceptance gate, not a crash gate.

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node scripts/sediment-latency-report.mjs <logfile> [more logs…]')
  process.exit(2)
}

const LINE = /context-compression sediment fold \(([^)]+)\): tier=(\S+) ok=(true|false) latencyMs=(\d+)(?: reason=(\S+))?/g

const samples = []
for (const file of files) {
  const { readFileSync } = await import('node:fs')
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(LINE)) {
    samples.push({
      session: m[1],
      tier: m[2],
      ok: m[3] === 'true',
      latencyMs: Number(m[4]),
      reason: m[5],
    })
  }
}

const pct = (sorted, p) => {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

const okLat = samples.filter(s => s.ok).map(s => s.latencyMs).sort((a, b) => a - b)
const allLat = samples.map(s => s.latencyMs).sort((a, b) => a - b)
const byTier = {}
for (const s of samples) (byTier[s.tier] ??= []).push(s)

console.log(`fold attempts: ${samples.length} (ok=${samples.filter(s => s.ok).length}) from ${files.length} log file(s)`)
console.log(`latency ok-only : p50=${pct(okLat, 0.5)}ms p95=${pct(okLat, 0.95)}ms p99=${pct(okLat, 0.99)}ms max=${okLat.at(-1) ?? 0}ms`)
console.log(`latency all     : p50=${pct(allLat, 0.5)}ms p95=${pct(allLat, 0.95)}ms p99=${pct(allLat, 0.99)}ms`)
for (const [tier, list] of Object.entries(byTier)) {
  const lats = list.filter(s => s.ok).map(s => s.latencyMs).sort((a, b) => a - b)
  console.log(`tier ${tier.padEnd(8)}: n=${list.length} ok=${list.filter(s => s.ok).length} p99=${pct(lats, 0.99)}ms`)
}
const reasons = {}
for (const s of samples.filter(x => !x.ok && x.reason !== undefined)) {
  reasons[s.reason] = (reasons[s.reason] ?? 0) + 1
}
for (const [reason, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
  console.log(`fail reason ${reason}: ${n}`)
}
if (samples.length < 50) {
  console.log(`NOTE: M18 requires >=50 attempts; ${50 - samples.length} more to accumulate.`)
}
