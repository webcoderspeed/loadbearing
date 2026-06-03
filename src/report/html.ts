import type { ProfileReport, SectionReport } from '../core/profiler.js';

/**
 * Render the killer artifact: a single self-contained HTML "context cost report
 * card". Its credibility comes from showing its own uncertainty — when the noise
 * floor can't be trusted it says UNMEASURED, and thin sections say
 * "insufficient-data" instead of a confident wrong label. No external assets.
 */

export function renderHtml(r: ProfileReport): string {
  const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
  const confidentInert = r.sections.filter(
    (s) => s.label === 'cost-only' || s.label === 'no-measurable-effect',
  );
  const headline = buildHeadline(r, confidentInert);

  const maxInherent = Math.max(1, ...r.sections.map((s) => s.inherentTokens));
  const rows = [...r.sections]
    .sort((a, b) => b.inherentTokens - a.inherentTokens)
    .map((s) => sectionRow(s, maxInherent, fmt))
    .join('\n');

  const nf = r.noiseFloor;
  const floorText =
    nf.band === 'UNMEASURED' || nf.pct == null
      ? `UNMEASURED — ${escapeHtml(nf.reason)}`
      : `${nf.pct.toFixed(1)}% (${nf.band})`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>loadbearing — context cost report</title>
<style>
  :root { --bg:#0d1117; --card:#161b22; --line:#30363d; --fg:#e6edf3; --mut:#8b949e;
          --green:#3fb950; --grey:#6e7681; --amber:#d29922; --accent:#58a6ff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:840px; margin:0 auto; padding:32px 20px 64px; }
  h1 { font-size:20px; margin:0 0 2px; letter-spacing:-.02em; }
  h1 .lb { color:var(--accent); }
  .sub { color:var(--mut); font-size:13px; margin:0 0 24px; }
  .headline { background:var(--card); border:1px solid var(--line); border-radius:12px;
              padding:20px 22px; margin:0 0 22px; font-size:17px; line-height:1.45; }
  .headline b { color:var(--green); }
  .headline .cut { color:var(--accent); }
  .meta { display:flex; flex-wrap:wrap; gap:14px; color:var(--mut); font-size:12px; margin:0 0 26px; }
  .meta span b { color:var(--fg); font-weight:600; }
  .meta .floor-unmeasured b { color:var(--amber); }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; color:var(--mut); font-weight:500; font-size:12px;
       padding:0 8px 8px; border-bottom:1px solid var(--line); }
  td { padding:12px 8px; border-bottom:1px solid var(--line); vertical-align:middle; }
  .sec-name { font-weight:600; }
  .sec-id { color:var(--mut); font-size:12px; font-weight:400; }
  .reason { color:var(--mut); font-size:11px; margin-top:3px; }
  .bar-cell { width:38%; }
  .bar-track { position:relative; height:22px; background:#0b0f14; border-radius:5px; overflow:hidden; }
  .bar { position:absolute; top:0; bottom:0; left:0; border-radius:5px; }
  .bar.load-bearing { background:linear-gradient(90deg,#238636,#3fb950); }
  .bar.cost-only { background:linear-gradient(90deg,#9e6a03,#d29922); }
  .bar.no-measurable-effect { background:linear-gradient(90deg,#484f58,#6e7681); }
  .bar.insufficient-data { background:repeating-linear-gradient(45deg,#30363d,#30363d 6px,#21262d 6px,#21262d 12px); }
  .tag { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:600; }
  .tag.load-bearing { background:rgba(63,185,80,.15); color:var(--green); }
  .tag.cost-only { background:rgba(210,153,34,.15); color:var(--amber); }
  .tag.no-measurable-effect { background:rgba(110,118,129,.18); color:var(--grey); }
  .tag.insufficient-data { background:rgba(110,118,129,.18); color:var(--grey); }
  .conf { color:var(--mut); font-size:11px; }
  .num { font-variant-numeric:tabular-nums; }
  .legend { color:var(--mut); font-size:12px; margin-top:22px; line-height:1.7; }
  .legend .swatch { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:middle; }
  footer { color:var(--mut); font-size:11px; margin-top:28px; border-top:1px solid var(--line); padding-top:14px; }
</style>
</head>
<body>
<div class="wrap">
  <h1><span class="lb">loadbearing</span> — context cost report</h1>
  <p class="sub">${escapeHtml(r.contextFile)} · profiled with ${escapeHtml(r.adapter)} (${escapeHtml(r.model)}) · ${r.trials} trials/variant</p>

  <div class="headline">${headline}</div>

  <div class="meta">
    <span>context size <b class="num">${fmt(r.totalContextTokens)}</b> tok</span>
    <span>sections <b>${r.sections.length}</b></span>
    <span class="${nf.band === 'UNMEASURED' ? 'floor-unmeasured' : ''}">noise floor <b>${floorText}</b></span>
    <span>baseline pass <b>${(r.baseline.passRate * 100).toFixed(0)}%</b></span>
    ${r.usingApiKey ? '' : '<span>cost = reference only (subscription)</span>'}
  </div>

  <table>
    <thead>
      <tr>
        <th>section</th>
        <th class="bar-cell">token weight</th>
        <th>verdict</th>
        <th class="num">Δ tokens</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <div class="legend">
    <div><span class="swatch" style="background:#3fb950"></span><b>load-bearing</b> — removing it measurably changed token spend beyond the noise floor.</div>
    <div><span class="swatch" style="background:#6e7681"></span><b>no-measurable-effect</b> — its effect is within the noise floor at this power; it may still cost tokens.</div>
    <div><span class="swatch" style="background:#d29922"></span><b>cost-only</b> — no measurable behavior change, but it spends input tokens every turn.</div>
    <div><span class="swatch" style="background:#30363d"></span><b>insufficient-data</b> — not enough trustworthy data to judge; re-run with more trials.</div>
  </div>

  <footer>
    Generated by loadbearing · ${escapeHtml(r.generatedAt)} · repo @${escapeHtml(r.headHash || 'nogit')}<br>
    Results are specific to this repo, task suite, and model version, and will drift as models change. Re-run after upgrades.
  </footer>
</div>
</body>
</html>`;
}

function sectionRow(s: SectionReport, maxInherent: number, fmt: (n: number) => string): string {
  const name = s.heading ?? '(preamble)';
  const weightPct = Math.max(3, (s.inherentTokens / maxInherent) * 100);
  const delta = s.deltaTokens;
  const deltaStr =
    s.label === 'insufficient-data' ? '—' : `${delta >= 0 ? '−' : '+'}${fmt(Math.abs(delta))}`;
  const reasonLine =
    s.label === 'insufficient-data'
      ? `<div class="reason">${escapeHtml(s.reason)} (ran N=${s.ablatedRuns}, range ${fmt(s.range.min)}–${fmt(s.range.max)})</div>`
      : '';
  return `      <tr>
        <td><div class="sec-name">${escapeHtml(name)}</div><div class="sec-id">#${escapeHtml(s.id)} · ${fmt(s.inherentTokens)} tok</div>${reasonLine}</td>
        <td class="bar-cell">
          <div class="bar-track">
            <div class="bar ${s.label}" style="width:${weightPct.toFixed(1)}%"></div>
          </div>
        </td>
        <td><span class="tag ${s.label}">${s.label}</span> <span class="conf">${s.confidence}</span></td>
        <td class="num">${deltaStr}</td>
      </tr>`;
}

function buildHeadline(r: ProfileReport, confidentInert: SectionReport[]): string {
  const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
  const insufficient = r.sections.filter((s) => s.label === 'insufficient-data');

  if (insufficient.length === r.sections.length) {
    return `This ${escapeHtml(r.contextFile)} spends <b style="color:var(--accent)">${fmt(r.totalContextTokens)} tokens/session</b>, but there wasn't enough data to judge any section — agent runs varied too much at ${r.trials} trials. <b style="color:var(--amber)">Re-run with more trials</b> (e.g. <code>--trials 8</code>) to get verdicts you can trust.`;
  }
  if (confidentInert.length === 0) {
    return `This ${escapeHtml(r.contextFile)} spends <b>${fmt(r.totalContextTokens)} tokens/session</b> and every measured section earns its tokens — nothing obvious to cut.`;
  }
  const names = confidentInert
    .slice(0, 3)
    .map((s) => `“${escapeHtml(s.heading ?? s.id)}”`)
    .join(', ');
  return `This ${escapeHtml(r.contextFile)} spends <b>${fmt(r.totalContextTokens)} tokens/session</b>; <span class="cut">${confidentInert.length} section${confidentInert.length > 1 ? 's' : ''} totaling ${fmt(r.inertTokens)} tokens</span> show <b style="color:var(--grey)">no measurable effect</b> — e.g. ${names}.`;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
