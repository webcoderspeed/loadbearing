import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySection,
  noiseFloorVerdict,
  cv,
  mean,
  median,
  mad,
  robustCv,
  isBimodal,
  MIN_TRIALS_FOR_VERDICT,
} from '../src/core/stats.js';
import { splitSections, buildAblated, buildFull } from '../src/core/sections.js';

test('median and mad basics', () => {
  assert.equal(median([2, 4, 6]), 4);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.ok(mad([10, 10, 10, 10]) === 0);
  assert.ok(robustCv([100, 100, 100, 100]) === 0);
});

test('cv and mean basics', () => {
  assert.equal(mean([2, 4, 6]), 4);
  assert.ok(Math.abs(cv([100, 100, 100])) < 1e-9);
});

test('isBimodal: detects a real 40k/15k split, ignores tight small samples', () => {
  // The dogfood split — clearly two modes
  assert.equal(isBimodal([15222, 15800, 40906, 41000, 40500, 15500]), true);
  // Tight 2-point sample must NOT be called bimodal (n<4 guard)
  assert.equal(isBimodal([42054, 40468]), false);
  // Tight cluster, big n — not bimodal
  assert.equal(isBimodal([40000, 40100, 39900, 40050, 40200, 39950]), false);
});

test('noiseFloorVerdict: refuses to estimate below min trials', () => {
  const nf = noiseFloorVerdict([40650, 39670]); // n=2
  assert.equal(nf.band, 'UNMEASURED');
  assert.equal(nf.pct, null);
});

test('noiseFloorVerdict: cross-variant tripwire flags a lucky-tight floor', () => {
  // null runs are all tight (~40k) -> would read ~1%, but ablated variants swing 60%+
  const nullRuns = [41227, 40915, 40650, 39670, 40800, 40100];
  const nf = noiseFloorVerdict(nullRuns, { ablatedSwings: [0.62, 0.05, 0.64] });
  assert.equal(nf.band, 'UNMEASURED', 'tripwire should fire when ablated swings >> floor');
});

test('noiseFloorVerdict: reports a real floor when null is adequately sampled', () => {
  const nullRuns = [40000, 42000, 38000, 41000, 39000, 43000];
  const nf = noiseFloorVerdict(nullRuns, { ablatedSwings: [0.06, 0.05] });
  assert.notEqual(nf.band, 'UNMEASURED');
  assert.ok(nf.pct != null && nf.pct > 0);
});

test('classifySection: very thin data (N<3) returns insufficient-data, never load-bearing', () => {
  const baseline = [40000, 40500, 39800, 41000];
  const ablated = [15000, 40000]; // n=2
  const v = classifySection(baseline, ablated, 0.1);
  assert.equal(v.label, 'insufficient-data');
  assert.notEqual(v.label, 'load-bearing');
});

test('classifySection: N=4 with a SOLID floor and tight runs DOES yield a verdict (not insufficient-data)', () => {
  // Floor is solid; section is tight and clearly inert -> should be cost-only/no-effect, not gated out.
  const baseline = [23500, 23540, 23480, 23520, 23510, 23490, 23530, 23470];
  const ablated = [23490, 23510, 23485, 23505]; // n=4, tight, all "pass"
  const passes = ablated.map(() => true);
  const v = classifySection(baseline, ablated, 0.016, { ablatedPasses: passes, inherentCostTokens: 60 });
  assert.notEqual(v.label, 'insufficient-data', 'a tight N=4 section under a solid floor should get a real verdict');
  assert.ok(v.label === 'cost-only' || v.label === 'no-measurable-effect');
});

test('classifySection: N=4 but bimodal section still gates to insufficient-data', () => {
  const baseline = [23500, 23540, 23480, 23520, 23510, 23490, 23530, 23470];
  const ablated = [1759, 23500, 23480, 23510]; // n=4, one mode-switch -> bimodal
  const passes = ablated.map(() => true);
  const v = classifySection(baseline, ablated, 0.016, { ablatedPasses: passes });
  assert.equal(v.label, 'insufficient-data');
});

test('classifySection: UNMEASURED floor (null) => insufficient-data', () => {
  const baseline = [40000, 40500, 39800, 41000, 40200, 39900];
  const ablated = [40000, 40500, 39800, 41000, 40200, 39900];
  const v = classifySection(baseline, ablated, null);
  assert.equal(v.label, 'insufficient-data');
});

test('classifySection: failure-contaminated ablated runs => insufficient-data', () => {
  const baseline = [40000, 40500, 39800, 41000, 40200, 39900];
  const ablated = [40000, 15000, 16000, 40500, 15500, 40000];
  const passes = [true, false, false, true, false, true]; // 50% pass
  const v = classifySection(baseline, ablated, 0.1, { ablatedPasses: passes });
  assert.equal(v.label, 'insufficient-data');
});

test('classifySection: clear large effect with clean data is load-bearing', () => {
  const baseline = [40000, 40500, 39800, 41000, 40200, 39900, 40300, 40100];
  const ablated = [20000, 20500, 19800, 21000, 20200, 19900, 20300, 20100]; // clean ~20k, all pass
  const passes = ablated.map(() => true);
  const v = classifySection(baseline, ablated, 0.05, { ablatedPasses: passes });
  assert.equal(v.label, 'load-bearing');
  assert.ok(v.clearsNoise);
});

test('classifySection: near-identical deltas get the SAME label (no incoherent split)', () => {
  // Two sections with nearly identical small deltas, clean data -> both same label
  const baseline = [40000, 40200, 39800, 40100, 40050, 39950, 40150, 39850];
  const a1 = [39000, 39200, 38800, 39100, 39050, 38950, 39150, 38850];
  const a2 = [39050, 39250, 38850, 39150, 39000, 39000, 39100, 38900];
  const passes = baseline.map(() => true);
  const v1 = classifySection(baseline, a1, 0.05, { ablatedPasses: passes, inherentCostTokens: 50 });
  const v2 = classifySection(baseline, a2, 0.05, { ablatedPasses: passes, inherentCostTokens: 50 });
  assert.equal(v1.label, v2.label, 'near-identical deltas must not get different labels');
});

test('MIN_TRIALS_FOR_VERDICT is the documented threshold', () => {
  assert.equal(MIN_TRIALS_FOR_VERDICT, 3);
});

test('splitSections + ablation round-trips and drops exactly one section', () => {
  const md = `# A\nalpha\n\n## B\nbeta\n\n## C\ngamma\n`;
  const { sections } = splitSections(md);
  assert.equal(sections.length, 3);
  assert.deepEqual(sections.map((s) => s.id), ['a', 'b', 'c']);
  const full = buildFull(sections);
  assert.ok(full.includes('beta'));
  const ablated = buildAblated(sections, 'b');
  assert.ok(!ablated.includes('beta'));
  assert.ok(ablated.includes('alpha') && ablated.includes('gamma'));
});
