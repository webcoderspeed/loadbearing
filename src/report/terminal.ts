import type { ProfileReport } from '../core/profiler.js';

/** Minimal ANSI styling — no dependency on chalk. */
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  grey: '\x1b[90m',
  amber: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
};

const labelColor: Record<string, string> = {
  'load-bearing': c.green,
  'cost-only': c.amber,
  'no-measurable-effect': c.grey,
  'insufficient-data': c.grey,
};

export function renderTerminal(r: ProfileReport): string {
  const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
  const out: string[] = [];

  out.push('');
  out.push(`${c.bold}loadbearing${c.reset} — context cost report`);
  out.push(`${c.dim}${r.contextFile} · ${r.adapter} (${r.model}) · ${r.trials} trials/variant${c.reset}`);
  out.push('');

  const nf = r.noiseFloor;
  if (nf.band === 'UNMEASURED' || nf.pct == null) {
    out.push(`noise floor: ${c.grey}UNMEASURED${c.reset} ${c.dim}— ${nf.reason}${c.reset}`);
  } else {
    const band =
      nf.band === 'SOLID' || nf.band === 'USABLE' ? c.green : nf.band === 'SHAKY' ? c.amber : c.red;
    out.push(
      `noise floor: ${band}${nf.pct.toFixed(1)}%${c.reset} ${c.dim}(${nf.band}) · baseline ${fmt(r.baseline.meanTokens)} tok · pass ${(r.baseline.passRate * 100).toFixed(0)}%${c.reset}`,
    );
  }
  out.push('');

  const maxInherent = Math.max(1, ...r.sections.map((s) => s.inherentTokens));
  const nameW = Math.min(28, Math.max(10, ...r.sections.map((s) => (s.heading ?? s.id).length)));

  for (const s of [...r.sections].sort((a, b) => b.inherentTokens - a.inherentTokens)) {
    const name = (s.heading ?? `#${s.id}`).slice(0, nameW).padEnd(nameW);
    const barLen = Math.max(1, Math.round((s.inherentTokens / maxInherent) * 20));
    const col = labelColor[s.label] ?? c.reset;
    const bar = col + '█'.repeat(barLen) + c.reset + c.dim + '░'.repeat(20 - barLen) + c.reset;
    const delta = s.deltaTokens;
    const deltaStr =
      s.label === 'insufficient-data' ? '     —  ' : `${delta >= 0 ? '−' : '+'}${fmt(Math.abs(delta))}`.padStart(8);
    const tag = `${col}${s.label}${c.reset}`;
    out.push(
      `  ${name} ${bar} ${c.dim}${fmt(s.inherentTokens).padStart(6)}t${c.reset} ${deltaStr} ${tag} ${c.dim}${s.confidence}${c.reset}`,
    );
    if (s.label === 'insufficient-data') {
      out.push(`  ${' '.repeat(nameW)} ${c.dim}↳ ${s.reason} (ran N=${s.ablatedRuns}, range ${fmt(s.range.min)}–${fmt(s.range.max)})${c.reset}`);
    }
  }

  out.push('');
  const confidentInert = r.sections.filter(
    (s) => s.label === 'cost-only' || s.label === 'no-measurable-effect',
  );
  const insufficient = r.sections.filter((s) => s.label === 'insufficient-data');

  if (insufficient.length === r.sections.length) {
    out.push(
      `${c.amber}Not enough data to judge any section.${c.reset} ` +
        `Re-run with more trials (e.g. ${c.bold}--trials 8${c.reset}) so the noise floor becomes estimable.`,
    );
  } else if (confidentInert.length) {
    out.push(
      `${c.bold}${r.contextFile}${c.reset} spends ${c.bold}${fmt(r.totalContextTokens)} tokens/session${c.reset}; ` +
        `${c.blue}${confidentInert.length} section(s) totaling ${fmt(r.inertTokens)} tokens${c.reset} ` +
        `show no measurable effect.`,
    );
  } else {
    out.push(`Every measured section earns its tokens — nothing safe to cut.`);
  }
  if (insufficient.length && insufficient.length < r.sections.length) {
    out.push(`${c.dim}(${insufficient.length} section(s) need more trials before a verdict.)${c.reset}`);
  }
  out.push('');
  return out.join('\n');
}
