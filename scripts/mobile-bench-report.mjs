#!/usr/bin/env node
// Compares two mobile-bench.sh results (base vs head) as a Markdown table: median and spread per metric and state.
//   node scripts/mobile-bench-report.mjs <bench.tsv> [base-label] [head-label]
import { readFileSync } from 'node:fs';

const [file, baseLabel = 'base', headLabel = 'head'] = process.argv.slice(2);
const rows = readFileSync(file, 'utf8').trim().split('\n').slice(1).map((line) => {
  const [label, state, metric, run, value] = line.split('\t');
  return { label, state, metric, run: Number(run), value: Number(value) };
}).filter((r) => Number.isFinite(r.value) && r.value > 0);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quartiles = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  return [q(0.25), q(0.75)];
};
const values = (label, state, metric) => rows.filter((r) => r.label === label && r.state === state && r.metric === metric).map((r) => r.value);
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const metrics = [
  ['first_frame_ms', 'Cold start, first frame (ms)'],
  ['react_ready_ms', 'Cold start, React screen ready (ms)'],
  ['janky_pct', 'Settings scroll, janky frames (%)'],
  ['frame_p50_ms', 'Settings scroll, frame p50 (ms)'],
  ['frame_p90_ms', 'Settings scroll, frame p90 (ms)'],
  ['frame_p99_ms', 'Settings scroll, frame p99 (ms)'],
];

const lines = [
  `| State | Metric | ${baseLabel} median (IQR) | ${headLabel} median (IQR) | Change | n |`,
  '| --- | --- | --- | --- | --- | --- |',
];
for (const state of ['fresh', 'dexopted']) {
  for (const [metric, name] of metrics) {
    const a = values(baseLabel, state, metric);
    const b = values(headLabel, state, metric);
    if (!a.length || !b.length) continue;
    const [ma, mb] = [median(a), median(b)];
    const [a1, a3] = quartiles(a);
    const [b1, b3] = quartiles(b);
    const delta = mb - ma;
    const pct = ma ? (delta / ma) * 100 : 0;
    // Only call it a change when the medians are further apart than either side's interquartile spread.
    const clear = Math.abs(delta) > Math.max(a3 - a1, b3 - b1);
    const change = `${delta > 0 ? '+' : ''}${fmt(delta)} (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)${clear ? '' : ' · within noise'}`;
    lines.push(`| ${state} | ${name} | ${fmt(ma)} (${fmt(a1)}–${fmt(a3)}) | ${fmt(mb)} (${fmt(b1)}–${fmt(b3)}) | ${change} | ${a.length}/${b.length} |`);
  }
}
console.log(lines.join('\n'));
