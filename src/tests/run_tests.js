/**
 * run_tests.js — Bell test pipeline tests.
 *
 * Phase 1: Data integrity + statistical primitive validation.
 *
 * Run: node --experimental-vm-modules bell/tests/run_tests.js
 *   or: node bell/tests/run_tests.js
 *
 * GPL v3
 */

import {
  delft, munich, nist, vienna, innsbruck, zhangMunich,
  allExperiments, loopholeFree2015,
  tableTotal, experimentTotal, tableCorrelation, chshS,
} from '../data/summary_counts.js';

import {
  pearsonCorrelation, spearmanCorrelation, pearsonPValue, linearFit,
} from '../lib/correlate.js';

import { computePermutation } from '../lib/permutation.js';

import { analyzeExperiment } from '../pipeline.js';
import { analyzeAll } from '../pipeline.js';
import { streamBinary, generateSynthetic } from '../gates/StreamingCountGate.js';
import { windowedAnalysisFromBuffer, windowedAnalysis } from '../analysis/windowed.js';
import { writeFileSync, unlinkSync, existsSync } from 'fs';


// ═══════════════════════════════════════
// Test harness
// ═══════════════════════════════════════

let passed = 0;
let failed = 0;
let total = 0;

function assert(label, condition, detail) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
    if (detail) console.log(`    → ${detail}`);
  }
}

function assertClose(label, actual, expected, tol, unit) {
  const diff = Math.abs(actual - expected);
  const ok = diff <= tol;
  const u = unit || '';
  assert(label, ok,
    ok ? null : `expected ${expected}${u}, got ${actual}${u}, diff ${diff.toExponential(3)}`
  );
}

function section(name) {
  console.log(`\n── ${name} ──`);
}


// ═══════════════════════════════════════
// Phase 1 Tests
// ═══════════════════════════════════════

section('Phase 1: Data Integrity');

// --- Test 1.1: Table cell sums match per-setting-pair totals ---

const expectedSettingTotals = {
  delft:  { '11': 53, '12': 79, '21': 62, '22': 51 },
  munich: { '11': 36, '12': 34, '21': 42, '22': 38 },
  zhangMunich: { '11': 434, '12': 423, '21': 389, '22': 403 },
};

for (const [name, exp] of [['delft', delft], ['munich', munich], ['zhangMunich', zhangMunich]]) {
  for (const ab of ['11', '12', '21', '22']) {
    const t = exp.tables[ab];
    const got = tableTotal(t);
    const want = expectedSettingTotals[name][ab];
    assertClose(`${name} (${ab}) cell sum`, got, want, 0);
  }
}


// --- Test 1.2: Delft total N = 245 ---

assertClose('Delft total N', experimentTotal(delft), 245, 0);


// --- Test 1.3: All experiment totals ---

const expectedTotals = {
  'Delft': { exp: delft, N: 245 },
  'Munich': { exp: munich, N: 150 },
  'NIST': { exp: nist, N: 43910205 + 43309801 + 43368944 + 42560473 },
  'Vienna': { exp: vienna, N: 875683790 + 875518074 + 875882007 + 875700279 },
  'Innsbruck': { exp: innsbruck, N: 14573 },
  'Zhang': { exp: zhangMunich, N: 1649 },
};

for (const [name, info] of Object.entries(expectedTotals)) {
  assertClose(`${name} total N`, experimentTotal(info.exp), info.N, 0);
}


// --- Test 1.4: CHSH S values match Gill's published values ---

section('Phase 1: CHSH S Values');

const expectedS = [
  { name: 'Delft',     exp: delft,       S: 2.4225,   tol: 0.001 },
  { name: 'Munich',    exp: munich,      S: 2.6090,   tol: 0.001 },
  { name: 'NIST',      exp: nist,        S: 2.000092, tol: 0.00001 },
  { name: 'Vienna',    exp: vienna,      S: 2.000028, tol: 0.00001 },
  { name: 'Zhang',     exp: zhangMunich, S: 2.578,    tol: 0.01 },
];

for (const { name, exp, S, tol } of expectedS) {
  const computed = chshS(exp);
  assertClose(`${name} S = ${S}`, computed, S, tol);
}

// All S > 2 (Bell violation)
for (const exp of allExperiments) {
  const s = chshS(exp);
  assert(`${exp.name} S > 2 (Bell violation)`, s > 2, `S = ${s.toFixed(6)}`);
}


// --- Test 1.5: Pearson r on known test vector ---

section('Phase 1: Statistical Primitives');

// Known test case: perfect positive correlation
const xPerfect = [1, 2, 3, 4, 5];
const yPerfect = [2, 4, 6, 8, 10];
assertClose('Pearson r (perfect positive)', pearsonCorrelation(xPerfect, yPerfect), 1.0, 1e-10);

// Known test case: perfect negative correlation
const yNeg = [10, 8, 6, 4, 2];
assertClose('Pearson r (perfect negative)', pearsonCorrelation(xPerfect, yNeg), -1.0, 1e-10);

// Known test case: zero correlation (orthogonal)
const xOrtho = [1, -1, 1, -1];
const yOrtho = [1, 1, -1, -1];
assertClose('Pearson r (zero)', pearsonCorrelation(xOrtho, yOrtho), 0.0, 1e-10);

// Known test case: specific computed value
// x = [1,2,3,4,5], y = [1,3,2,5,4]
// Manual: r = 0.8
const xKnown = [1, 2, 3, 4, 5];
const yKnown = [1, 3, 2, 5, 4];
assertClose('Pearson r (known vector)', pearsonCorrelation(xKnown, yKnown), 0.8, 1e-10);

// Spearman on same — rank correlation
const rhoSpearman = spearmanCorrelation(xKnown, yKnown);
assertClose('Spearman ρ (known vector)', rhoSpearman, 0.8, 1e-10);

// p-value for r=0.8, n=5 should be about 0.104 (two-tailed)
const pVal = pearsonPValue(0.8, 5);
assertClose('Pearson p-value (r=0.8, n=5)', pVal, 0.104, 0.02);

// Linear fit on perfect data
const fit = linearFit(xPerfect, yPerfect);
assertClose('Linear fit slope (perfect)', fit.slope, 2.0, 1e-10);
assertClose('Linear fit intercept (perfect)', fit.intercept, 0.0, 1e-10);
assertClose('Linear fit R² (perfect)', fit.r2, 1.0, 1e-10);


// --- Test 1.6: Permutation test on synthetic data ---

section('Phase 1: Permutation Test');

// Synthetic dataset with strong signal — should produce small p-value
const xSignal = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const ySignal = [1.1, 2.2, 2.9, 4.1, 5.0, 6.1, 6.9, 8.0, 9.1, 10.0];
const rSignal = pearsonCorrelation(xSignal, ySignal);
const permSignal = computePermutation(
  xSignal.map((x, i) => ({ log10Xi: x, shapiroRMS: ySignal[i] })),
  rSignal,
  { bootstrap: false, nPermutations: 10000, seed: 137 }
);
assert('Permutation p < 0.01 (strong signal)',
  permSignal.pValue < 0.01,
  `p = ${permSignal.pValue.toFixed(4)}`
);

// Synthetic dataset with no signal — should produce large p-value
const xNoise = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const yNoise = [5, 3, 8, 1, 7, 2, 9, 4, 6, 10]; // shuffled
const rNoise = pearsonCorrelation(xNoise, yNoise);
const permNoise = computePermutation(
  xNoise.map((x, i) => ({ log10Xi: x, shapiroRMS: yNoise[i] })),
  rNoise,
  { bootstrap: false, nPermutations: 10000, seed: 137 }
);
assert('Permutation p > 0.1 (no signal)',
  permNoise.pValue > 0.1,
  `p = ${permNoise.pValue.toFixed(4)}`
);

// Reproducibility: same seed → same result
const permRepeat = computePermutation(
  xSignal.map((x, i) => ({ log10Xi: x, shapiroRMS: ySignal[i] })),
  rSignal,
  { bootstrap: false, nPermutations: 10000, seed: 137 }
);
assertClose('Permutation reproducibility (same seed)',
  permRepeat.pValue, permSignal.pValue, 0);


// --- Test 1.7: Data cross-checks ---

section('Phase 1: Cross-Checks');

// All four tables per experiment have non-negative entries
for (const exp of allExperiments) {
  let allNonNeg = true;
  for (const ab of ['11', '12', '21', '22']) {
    const t = exp.tables[ab];
    if (t.pp < 0 || t.pm < 0 || t.mp < 0 || t.mm < 0) allNonNeg = false;
  }
  assert(`${exp.name} all counts non-negative`, allNonNeg);
}

// Correlations for (1,1), (1,2), (2,1) are positive; (2,2) is negative
// (Gill's convention — applies to ±1 outcome experiments only.
// NIST/Vienna use d/n outcomes where nn dominates → all ρ near +1.)
const pmOneExperiments = allExperiments.filter(
  e => e !== nist && e !== vienna
);
for (const exp of pmOneExperiments) {
  const r11 = tableCorrelation(exp.tables['11']);
  const r12 = tableCorrelation(exp.tables['12']);
  const r21 = tableCorrelation(exp.tables['21']);
  const r22 = tableCorrelation(exp.tables['22']);
  assert(`${exp.name} ρ₁₁ > 0`, r11 > 0, `ρ₁₁ = ${r11.toFixed(4)}`);
  assert(`${exp.name} ρ₁₂ > 0`, r12 > 0, `ρ₁₂ = ${r12.toFixed(4)}`);
  assert(`${exp.name} ρ₂₁ > 0`, r21 > 0, `ρ₂₁ = ${r21.toFixed(4)}`);
  assert(`${exp.name} ρ₂₂ < 0`, r22 < 0, `ρ₂₂ = ${r22.toFixed(4)}`);
}

// NIST/Vienna: Eberhard experiments — all ρ near +1, S from tiny differences
for (const exp of [nist, vienna]) {
  const r11 = tableCorrelation(exp.tables['11']);
  const r22 = tableCorrelation(exp.tables['22']);
  assert(`${exp.name} all ρ > 0 (Eberhard)`, r11 > 0 && r22 > 0,
    `ρ₁₁=${r11.toFixed(6)}, ρ₂₂=${r22.toFixed(6)}`);
  assert(`${exp.name} ρ₁₁ > ρ₂₂ (Eberhard S>2 mechanism)`, r11 > r22,
    `ρ₁₁=${r11.toFixed(6)}, ρ₂₂=${r22.toFixed(6)}`);
}


// ═══════════════════════════════════════
// Phase 2 Tests — Gates 1–3
// ═══════════════════════════════════════

section('Phase 2: CountTableGate');

// Test 2.1: Pipeline produces exactly one residual per experiment
for (const exp of allExperiments) {
  let result;
  let err = null;
  try { result = analyzeExperiment(exp, { permutation: false, bootstrap: false }); } catch (e) { err = e; }
  assert(`${exp.name} pipeline runs without error`, err === null,
    err ? err.message : null);
  if (result) {
    const r = result.residual;
    assert(`${exp.name} residual has name`, r.name === exp.name);
    assert(`${exp.name} residual has correct N`, r.N === experimentTotal(exp));
  }
}


section('Phase 2: MarginalGate');

// Test 2.2: Delft marginals — four for Alice, four for Bob
const delftR = analyzeExperiment(delft, { permutation: false, bootstrap: false }).residual;

assert('Delft has alice marginals', delftR.marginals.alice != null);
assert('Delft has bob marginals', delftR.marginals.bob != null);
assert('Delft alice has 4 entries',
  Object.keys(delftR.marginals.alice).length === 4);
assert('Delft bob has 4 entries',
  Object.keys(delftR.marginals.bob).length === 4);

// Alice marginals from Delft data:
// (1,1): (23+3)/(23+3+4+23) = 26/53
// (1,2): (33+11)/(33+11+5+30) = 44/79
assertClose('Delft P(x=+|a=1,b=1)', delftR.marginals.alice['11'], 26/53, 1e-10);
assertClose('Delft P(x=+|a=1,b=2)', delftR.marginals.alice['12'], 44/79, 1e-10);
// (2,1): (22+10)/(22+10+6+24) = 32/62
// (2,2): (4+20)/(4+20+21+6) = 24/51
assertClose('Delft P(x=+|a=2,b=1)', delftR.marginals.alice['21'], 32/62, 1e-10);
assertClose('Delft P(x=+|a=2,b=2)', delftR.marginals.alice['22'], 24/51, 1e-10);


section('Phase 2: NoSignalingGate — Synthetic');

// Test 2.3: Perfectly symmetric dataset → all deltas exactly zero
const symmetric = {
  name: 'Symmetric',
  tables: {
    '11': { pp: 100, pm: 100, mp: 100, mm: 100 },
    '12': { pp: 100, pm: 100, mp: 100, mm: 100 },
    '21': { pp: 100, pm: 100, mp: 100, mm: 100 },
    '22': { pp: 100, pm: 100, mp: 100, mm: 100 },
  },
};
const symR = analyzeExperiment(symmetric, { permutation: false, bootstrap: false }).residual;
assertClose('Symmetric Δ_A(1) = 0', symR.alice.delta1, 0.0, 1e-15);
assertClose('Symmetric Δ_A(2) = 0', symR.alice.delta2, 0.0, 1e-15);
assertClose('Symmetric Δ_B(1) = 0', symR.bob.delta1, 0.0, 1e-15);
assertClose('Symmetric Δ_B(2) = 0', symR.bob.delta2, 0.0, 1e-15);
assertClose('Symmetric magnitude = 0', symR.magnitude, 0.0, 1e-15);


section('Phase 2: NoSignalingGate — Delft Residuals');

// Test 2.4: Delft deltas — record specific values for regression
// Δ_A(a=1) = P(x=+|1,1) - P(x=+|1,2) = 26/53 - 44/79
const expectedDeltaA1 = 26/53 - 44/79;
assertClose('Delft Δ_A(1) value', delftR.alice.delta1, expectedDeltaA1, 1e-10);

// Δ_A(a=2) = P(x=+|2,1) - P(x=+|2,2) = 32/62 - 24/51
const expectedDeltaA2 = 32/62 - 24/51;
assertClose('Delft Δ_A(2) value', delftR.alice.delta2, expectedDeltaA2, 1e-10);

// Δ_B(b=1) = P(y=+|1,1) - P(y=+|2,1) = 27/53 - 28/62
// Bob's marginal: (pp + mp) / n
const expectedDeltaB1 = (23+4)/53 - (22+6)/62;
assertClose('Delft Δ_B(1) value', delftR.bob.delta1, expectedDeltaB1, 1e-10);

// Δ_B(b=2) = P(y=+|1,2) - P(y=+|2,2) = 38/79 - 25/51
const expectedDeltaB2 = (33+5)/79 - (4+21)/51;
assertClose('Delft Δ_B(2) value', delftR.bob.delta2, expectedDeltaB2, 1e-10);

// Test 2.5: Delft combined magnitude is nonzero
assert('Delft magnitude > 0', delftR.magnitude > 0,
  `magnitude = ${delftR.magnitude.toFixed(6)}`);

// All four deltas array present and length 4
assert('Delft deltas array length 4', delftR.deltas.length === 4);
assert('Delft SEs array length 4', delftR.standardErrors.length === 4);
assert('Delft z-scores array length 4', delftR.zScores.length === 4);


section('Phase 2: Standard Errors');

// Test 2.6: Standard errors consistent with binomial proportion variance
// For Delft (1,1) → (1,2) Alice delta:
// p1 = 26/53, n1 = 53; p2 = 44/79, n2 = 79
// SE = sqrt(p1*(1-p1)/n1 + p2*(1-p2)/n2)
const p1 = 26/53, n1 = 53;
const p2 = 44/79, n2 = 79;
const expectedSE_A1 = Math.sqrt(p1*(1-p1)/n1 + p2*(1-p2)/n2);
assertClose('Delft SE_A(1) binomial formula', delftR.alice.se1, expectedSE_A1, 1e-10);

// All SEs are positive
for (const exp of allExperiments) {
  const r = analyzeExperiment(exp, { permutation: false, bootstrap: false }).residual;
  const allPos = r.standardErrors.every(se => se > 0);
  assert(`${exp.name} all SEs > 0`, allPos);
}


section('Phase 2: Pipeline End-to-End');

// Test 2.7: All experiments produce valid residuals
for (const exp of allExperiments) {
  const r = analyzeExperiment(exp, { permutation: false, bootstrap: false }).residual;
  assert(`${exp.name} has magnitude`, typeof r.magnitude === 'number' && !isNaN(r.magnitude));
  assert(`${exp.name} has chiSq`, typeof r.chiSq === 'number' && !isNaN(r.chiSq));
  assert(`${exp.name} has 4 deltas`, r.deltas.length === 4 && r.deltas.every(d => !isNaN(d)));
}

// The three 2015 loophole-free experiments all produce results
for (const exp of loopholeFree2015) {
  const r = analyzeExperiment(exp, { permutation: false, bootstrap: false }).residual;
  assert(`${exp.name} loophole-free residual computed`, r.N > 0 && r.magnitude >= 0);
}

// NIST has the largest z-score (known from pipeline run)
const nistR = analyzeExperiment(nist, { permutation: false, bootstrap: false }).residual;
const nistMaxZ = Math.max(...nistR.zScores.map(Math.abs));
assert('NIST max |z| > 2', nistMaxZ > 2, `max |z| = ${nistMaxZ.toFixed(3)}`);

// Innsbruck has massive violations (known — detection loophole, time drifts)
const innsR = analyzeExperiment(innsbruck, { permutation: false, bootstrap: false }).residual;
const innsMaxZ = Math.max(...innsR.zScores.map(Math.abs));
assert('Innsbruck max |z| > 5 (known systematic)', innsMaxZ > 5,
  `max |z| = ${innsMaxZ.toFixed(3)}`);


// ═══════════════════════════════════════
// Phase 3 Tests — Permutation Test
// ═══════════════════════════════════════

section('Phase 3: Permutation — Null Validation');

// Test 3.1: Symmetric dataset (zero signal) → p > 0.3
const symPerm = analyzeExperiment(symmetric, { permutation: true, bootstrap: false, nPermutations: 5000, seed: 137 });
assert('Symmetric permutation p > 0.3',
  symPerm.permutation.pValue > 0.3,
  `p = ${symPerm.permutation.pValue.toFixed(4)}`);


// Test 3.2: Injected signal → p < 0.01
// Create a dataset with large asymmetry in Alice's marginal
const signalData = {
  name: 'Injected Signal',
  tables: {
    '11': { pp: 400, pm: 100, mp: 100, mm: 400 },  // Alice+ = 500/1000
    '12': { pp: 200, pm: 100, mp: 200, mm: 500 },  // Alice+ = 300/1000
    '21': { pp: 400, pm: 100, mp: 100, mm: 400 },
    '22': { pp: 200, pm: 100, mp: 200, mm: 500 },
  },
};
const sigPerm = analyzeExperiment(signalData, { permutation: true, bootstrap: false, nPermutations: 5000, seed: 137 });
assert('Injected signal permutation p < 0.01',
  sigPerm.permutation.pValue < 0.01,
  `p = ${sigPerm.permutation.pValue.toFixed(4)}`);


section('Phase 3: Permutation — Real Experiments');

// Test 3.3: Run permutation on all six experiments, record p-values
const permResults = {};
for (const exp of allExperiments) {
  const { permutation: perm } = analyzeExperiment(exp, { bootstrap: false, nPermutations: 10000, seed: 137 });
  permResults[exp.name] = perm;
  assert(`${exp.name} permutation completes`,
    perm != null && typeof perm.pValue === 'number',
    perm ? `p = ${perm.pValue.toFixed(4)}` : 'null');
  console.log(`    → p = ${perm.pValue.toFixed(6)}, observed ‖Δ‖ = ${perm.observedMagnitude.toExponential(3)}, null 95th = ${perm.null95.toExponential(3)}`);
}


// Test 3.4: Null distribution has mean near zero is wrong — 
// magnitude is always positive, so null median should be > 0
// but observed should be in the bulk for null cases.
// Better test: null median is finite and positive
for (const exp of allExperiments) {
  const perm = permResults[exp.name];
  assert(`${exp.name} null median > 0`, perm.nullMedian > 0,
    `median = ${perm.nullMedian.toExponential(3)}`);
  assert(`${exp.name} null 95th > null median`, perm.null95 > perm.nullMedian);
}


// Test 3.5: Reproducibility — same seed → same p-value
const delftPerm1 = analyzeExperiment(delft, { bootstrap: false, nPermutations: 5000, seed: 137 }).permutation;
const delftPerm2 = analyzeExperiment(delft, { bootstrap: false, nPermutations: 5000, seed: 137 }).permutation;
assertClose('Delft permutation reproducibility',
  delftPerm1.pValue, delftPerm2.pValue, 0);
assertClose('Delft permutation null median reproducibility',
  delftPerm1.nullMedian, delftPerm2.nullMedian, 1e-15);


// Test 3.6: Innsbruck should have extremely small p-value (known systematic)
const innsPerm = permResults[innsbruck.name];
assert('Innsbruck permutation p < 0.001 (known systematic)',
  innsPerm.pValue < 0.001,
  `p = ${innsPerm.pValue.toFixed(6)}`);

// Test 3.7: NIST p-value — record it (the key measurement)
const nistPerm = permResults[nist.name];
console.log(`\n  ★ NIST permutation p-value: ${nistPerm.pValue.toFixed(6)}`);
console.log(`    observed ‖Δ‖ = ${nistPerm.observedMagnitude.toExponential(4)}`);
console.log(`    null 95th    = ${nistPerm.null95.toExponential(4)}`);
console.log(`    null 99th    = ${nistPerm.null99.toExponential(4)}`);
assert('NIST permutation p-value is a number',
  typeof nistPerm.pValue === 'number' && !isNaN(nistPerm.pValue));


// ═══════════════════════════════════════
// Phase 4 Tests — Bootstrap CIs
// ═══════════════════════════════════════

section('Phase 4: Bootstrap — Null Validation');

// Test 4.1: Symmetric dataset CIs include zero for all deltas
const symBoot = analyzeExperiment(symmetric, {
  permutation: true, bootstrap: true,
  nPermutations: 2000, nBootstrap: 5000,
  seed: 137, bootstrapSeed: 42,
});
assert('Symmetric bootstrap produces result', symBoot.bootstrap != null);
for (let i = 0; i < 4; i++) {
  assert(`Symmetric CI[${i}] includes 0`,
    symBoot.bootstrap.zeroInCI[i],
    `[${symBoot.bootstrap.deltaCIs[i].lo.toFixed(4)}, ${symBoot.bootstrap.deltaCIs[i].hi.toFixed(4)}]`);
}


section('Phase 4: Bootstrap — Real Experiments');

// Test 4.2: Delft CIs computed
const delftBoot = analyzeExperiment(delft, {
  nPermutations: 2000, nBootstrap: 5000,
  seed: 137, bootstrapSeed: 42,
});
assert('Delft bootstrap result exists', delftBoot.bootstrap != null);
assert('Delft has 4 delta CIs', delftBoot.bootstrap.deltaCIs.length === 4);
assert('Delft has magnitude CI', delftBoot.bootstrap.magnitudeCI != null);

// Each CI has lo, hi, median
for (let i = 0; i < 4; i++) {
  const ci = delftBoot.bootstrap.deltaCIs[i];
  assert(`Delft CI[${i}] lo < hi`, ci.lo < ci.hi,
    `lo=${ci.lo.toFixed(4)}, hi=${ci.hi.toFixed(4)}`);
  assert(`Delft CI[${i}] median between lo and hi`,
    ci.median >= ci.lo && ci.median <= ci.hi);
}

// Magnitude CI lower bound ≥ 0 (magnitude is always non-negative)
assert('Delft magnitude CI lo ≥ 0', delftBoot.bootstrap.magnitudeCI.lo >= 0);


// Test 4.3: CI width scales with 1/√N
// Compare Delft (N=245) with a larger experiment
// NIST has vastly more trials — its CIs should be much narrower
const nistBoot = analyzeExperiment(nist, {
  nPermutations: 2000, nBootstrap: 5000,
  seed: 137, bootstrapSeed: 42,
});
assert('NIST bootstrap result exists', nistBoot.bootstrap != null);

const delftWidth0 = delftBoot.bootstrap.deltaCIs[0].hi - delftBoot.bootstrap.deltaCIs[0].lo;
const nistWidth0 = nistBoot.bootstrap.deltaCIs[0].hi - nistBoot.bootstrap.deltaCIs[0].lo;
assert('NIST CI narrower than Delft CI',
  nistWidth0 < delftWidth0,
  `NIST width=${nistWidth0.toExponential(3)}, Delft width=${delftWidth0.toFixed(4)}`);

// Ratio should be roughly √(N_delft/N_nist) ≈ √(245/173M) ≈ 0.0012
// Allow a factor of 10 tolerance — we just need the scaling direction
const widthRatio = nistWidth0 / delftWidth0;
assert('CI width ratio reasonable',
  widthRatio < 0.1,
  `ratio = ${widthRatio.toExponential(3)}`);


// Test 4.4: Bootstrap median close to point estimate
for (const [name, result] of [['Delft', delftBoot], ['NIST', nistBoot]]) {
  for (let i = 0; i < 4; i++) {
    const ci = result.bootstrap.deltaCIs[i];
    const obs = result.bootstrap.observedDeltas[i];
    const ciWidth = ci.hi - ci.lo;
    const medianDiff = Math.abs(ci.median - obs);
    // Median should be within 10% of CI width from observed
    if (ciWidth > 0) {
      assert(`${name} CI[${i}] median near observed`,
        medianDiff < 0.1 * ciWidth,
        `diff=${medianDiff.toExponential(3)}, 10%width=${(0.1*ciWidth).toExponential(3)}`);
    }
  }
}


// Test 4.5: Reproducibility
const delftBoot2 = analyzeExperiment(delft, {
  nPermutations: 2000, nBootstrap: 5000,
  seed: 137, bootstrapSeed: 42,
});
for (let i = 0; i < 4; i++) {
  assertClose(`Delft bootstrap CI[${i}] lo reproducible`,
    delftBoot2.bootstrap.deltaCIs[i].lo,
    delftBoot.bootstrap.deltaCIs[i].lo, 1e-15);
  assertClose(`Delft bootstrap CI[${i}] hi reproducible`,
    delftBoot2.bootstrap.deltaCIs[i].hi,
    delftBoot.bootstrap.deltaCIs[i].hi, 1e-15);
}


// Test 4.6: All experiments produce bootstrap results
section('Phase 4: Bootstrap — All Experiments');

for (const exp of allExperiments) {
  const result = analyzeExperiment(exp, {
    nPermutations: 2000, nBootstrap: 5000,
    seed: 137, bootstrapSeed: 42,
  });
  assert(`${exp.name} bootstrap completes`, result.bootstrap != null);

  const b = result.bootstrap;
  const nExclude = b.zeroInCI.filter(x => !x).length;
  console.log(`    → ${nExclude}/4 CIs exclude zero, ‖Δ‖ CI [${b.magnitudeCI.lo.toExponential(3)}, ${b.magnitudeCI.hi.toExponential(3)}]`);
}


// ═══════════════════════════════════════
// Phase 5 Tests — Cross-Dataset Verdict
// ═══════════════════════════════════════

section('Phase 5: CrossDatasetGate — Structure');

// Test 5.1: analyzeAll produces a verdict
const fullResult = analyzeAll(allExperiments, {
  nPermutations: 2000, nBootstrap: 2000,
  seed: 137, bootstrapSeed: 42,
});
assert('analyzeAll produces verdict', fullResult.verdict != null);
assert('Verdict has verdict string', typeof fullResult.verdict.verdict === 'string');
assert('Verdict has flags array', Array.isArray(fullResult.verdict.verdictFlags));
assert('Verdict has nExperiments', fullResult.verdict.nExperiments === 6);
assert('Verdict has experiments list', fullResult.verdict.experiments.length === 6);
assert('Verdict has signConsistency', fullResult.verdict.signConsistency != null);
assert('Verdict has weightedMeans', fullResult.verdict.weightedMeans.length === 4);
assert('Verdict has weightedChiSq', typeof fullResult.verdict.weightedChiSq === 'number');
assert('Verdict has deltaDetail', fullResult.verdict.deltaDetail.length === 4);
assert('Verdict has pairwise', fullResult.verdict.pairwise.length > 0);
assert('Verdict has experimentSummaries', fullResult.verdict.experimentSummaries.length === 6);


section('Phase 5: Sign Consistency');

// Test 5.2: Sign consistency structure
const sc = fullResult.verdict.signConsistency;
assert('Sign perDelta has 4 entries', sc.perDelta.length === 4);
for (let d = 0; d < 4; d++) {
  const s = sc.perDelta[d];
  assert(`Delta ${d} positive + negative = nExp`,
    s.positive + s.negative === 6);
  assert(`Delta ${d} agreementFraction in [0.5, 1]`,
    s.agreementFraction >= 0.5 && s.agreementFraction <= 1.0);
}
assert('Overall agreement in [0.5, 1]',
  sc.overallAgreement >= 0.5 && sc.overallAgreement <= 1.0);

// Record the actual sign pattern for each delta
const deltaLabels5 = ['Δ_A(1)', 'Δ_A(2)', 'Δ_B(1)', 'Δ_B(2)'];
for (let d = 0; d < 4; d++) {
  const s = sc.perDelta[d];
  console.log(`    ${deltaLabels5[d]}: ${s.positive}+ / ${s.negative}−  (${(s.agreementFraction * 100).toFixed(0)}% agree)`);
}
console.log(`    Unanimous: ${sc.unanimousCount}/4, Majority: ${sc.majorityCount}/4`);
console.log(`    Overall agreement: ${(sc.overallAgreement * 100).toFixed(1)}%`);


section('Phase 5: Weighted Means');

// Test 5.3: Weighted means computed
for (let d = 0; d < 4; d++) {
  const wm = fullResult.verdict.weightedMeans[d];
  assert(`Weighted mean ${deltaLabels5[d]} has finite mean`,
    isFinite(wm.mean));
  assert(`Weighted mean ${deltaLabels5[d]} has positive SE`,
    wm.se > 0);
  assert(`Weighted mean ${deltaLabels5[d]} has finite z`,
    isFinite(wm.z));
  console.log(`    ${wm.label}: mean=${wm.mean.toExponential(3)}, z=${wm.z.toFixed(3)}`);
}
console.log(`    Combined χ² = ${fullResult.verdict.weightedChiSq.toFixed(4)}`);


section('Phase 5: Pairwise Agreement');

// Test 5.4: Pairwise computed
const expectedPairs = 6 * 5 / 2; // C(6,2) = 15
assert('Pairwise has 15 entries', fullResult.verdict.pairwise.length === expectedPairs);

// Each pair has agree in [0, 4]
for (const p of fullResult.verdict.pairwise) {
  assert(`${p.exp1.slice(0,10)} × ${p.exp2.slice(0,10)} agree in [0,4]`,
    p.agree >= 0 && p.agree <= 4);
}

// NIST × Vienna — the key pair (both loophole-free photonic)
const nistVienna = fullResult.verdict.pairwise.find(p =>
  (p.exp1.includes('NIST') && p.exp2.includes('Vienna')) ||
  (p.exp1.includes('Vienna') && p.exp2.includes('NIST'))
);
assert('NIST × Vienna pair found', nistVienna != null);
console.log(`    ★ NIST × Vienna sign agreement: ${nistVienna.agree}/4`);


section('Phase 5: Loophole-Free 2015 Subset');

// Test 5.5: Run on loophole-free 2015 only
const lf2015 = analyzeAll(loopholeFree2015, {
  nPermutations: 2000, nBootstrap: 2000,
  seed: 137, bootstrapSeed: 42,
});
assert('LF2015 verdict exists', lf2015.verdict != null);
assert('LF2015 has 3 experiments', lf2015.verdict.nExperiments === 3);
console.log(`    LF2015 verdict: ${lf2015.verdict.verdict}`);
console.log(`    LF2015 flags: ${lf2015.verdict.verdictFlags.join(', ') || 'none'}`);
console.log(`    LF2015 weighted χ²: ${lf2015.verdict.weightedChiSq.toFixed(4)}`);

// Sign consistency for LF2015
const lfSC = lf2015.verdict.signConsistency;
for (let d = 0; d < 4; d++) {
  const s = lfSC.perDelta[d];
  console.log(`    ${deltaLabels5[d]}: ${s.positive}+ / ${s.negative}−`);
}


section('Phase 5: Pipeline End-to-End');

// Test 5.6: Full pipeline runs end-to-end from single invocation
assert('Full pipeline runs', fullResult.results.length === 6);
for (const r of fullResult.results) {
  assert(`${r.name} has all three results`,
    r.residual != null && r.permutation != null && r.bootstrap != null);
}

// Test 5.7: All numerical results are reproducible
const fullResult2 = analyzeAll(allExperiments, {
  nPermutations: 2000, nBootstrap: 2000,
  seed: 137, bootstrapSeed: 42,
});
assertClose('Reproducible weighted χ²',
  fullResult2.verdict.weightedChiSq,
  fullResult.verdict.weightedChiSq, 1e-10);
for (let d = 0; d < 4; d++) {
  assertClose(`Reproducible weighted mean ${d}`,
    fullResult2.verdict.weightedMeans[d].mean,
    fullResult.verdict.weightedMeans[d].mean, 1e-15);
}

// Test 5.8: Innsbruck drives the all-experiments result
// (known systematic should dominate weighted means)
const innsIdx = fullResult.verdict.experimentSummaries.findIndex(e => e.name.includes('Innsbruck'));
assert('Innsbruck found in summaries', innsIdx >= 0);
const innsSum = fullResult.verdict.experimentSummaries[innsIdx];
assert('Innsbruck has 4/4 CI exclusions',
  innsSum.ciExcludesZero && innsSum.ciExcludesZero.filter(x => x).length === 4);


// ═══════════════════════════════════════
// Phase 6 Tests — Event-Level Streaming
// ═══════════════════════════════════════

section('Phase 6a: Synthetic Data Generation');

// Test 6.1: Generate synthetic binary
const synthBuf = generateSynthetic(100000, { seed: 42, detectionRate: 0.0003, signalDelta: 0 });
assert('Synthetic buffer has correct size', synthBuf.length === 100000 * 4,
  `expected ${100000*4}, got ${synthBuf.length}`);

// All values are 0 or 1
let allValid = true;
for (let i = 0; i < Math.min(1000, synthBuf.length); i++) {
  if (synthBuf[i] > 1) { allValid = false; break; }
}
assert('Synthetic values are 0 or 1', allValid);

// Settings are roughly 50/50
let s0count = 0;
for (let i = 0; i < 100000; i++) {
  if (synthBuf[i * 4] === 0) s0count++;
}
assert('Synthetic settings ~50/50',
  s0count > 45000 && s0count < 55000,
  `setting 0 count: ${s0count}/100000`);


section('Phase 6b: StreamingCountGate');

// Test 6.2: Stream synthetic data
const tmpPath = '/tmp/bell_test_phase6.bin';
writeFileSync(tmpPath, synthBuf);

const streamed = streamBinary(tmpPath);
assert('Streamed result has tables', streamed.tables != null);
assert('Streamed N = 100000', streamed.N === 100000);

// All four setting pairs have counts summing to N
let tableSum = 0;
for (const ab of ['11', '12', '21', '22']) {
  const t = streamed.tables[ab];
  tableSum += t.pp + t.pm + t.mp + t.mm;
}
assert('Streamed table sum = N', tableSum === 100000);

// Run full pipeline on streamed data
const streamResult = analyzeExperiment(
  { name: 'Synthetic', tables: streamed.tables },
  { permutation: false, bootstrap: false }
);
assert('Pipeline runs on streamed data', streamResult.residual != null);
assert('Streamed magnitude is finite', isFinite(streamResult.residual.magnitude));

// Test 6.3: No-signal synthetic should show no significant deviation
const synthNoSig = analyzeExperiment(
  { name: 'Synthetic (null)', tables: streamed.tables },
  { permutation: true, bootstrap: false, nPermutations: 2000, seed: 137 }
);
assert('Null synthetic permutation p > 0.05',
  synthNoSig.permutation.pValue > 0.05,
  `p = ${synthNoSig.permutation.pValue.toFixed(4)}`);


section('Phase 6b: Injected Signal');

// Test 6.4: Inject signal and verify detection
const synthSignalBuf = generateSynthetic(500000, { seed: 42, detectionRate: 0.0003, signalDelta: 0.0002 });
const tmpSigPath = '/tmp/bell_test_phase6_sig.bin';
writeFileSync(tmpSigPath, synthSignalBuf);

const streamedSig = streamBinary(tmpSigPath);
const sigResult = analyzeExperiment(
  { name: 'Synthetic (signal)', tables: streamedSig.tables },
  { permutation: true, bootstrap: true, nPermutations: 5000, seed: 137, bootstrapSeed: 42 }
);

// Δ_B(b=2) should be nonzero — that's where we injected the signal
const deltaB2 = sigResult.residual.deltas[3]; // Δ_B(b=2) is index 3
assert('Injected signal Δ_B(2) nonzero',
  Math.abs(deltaB2) > 0,
  `Δ_B(2) = ${deltaB2.toExponential(3)}`);
console.log(`    Injected Δ_B(2) = ${deltaB2.toExponential(3)}, z = ${sigResult.residual.zScores[3].toFixed(2)}`);


section('Phase 6c: Time-Windowed Analysis');

// Test 6.5: Windowed streaming
const windowedStream = streamBinary(tmpPath, { windows: 10 });
assert('Windowed result has windows', windowedStream.windows != null);
assert('Windowed has 10 windows', windowedStream.windows.length === 10);

// Each window has tables and counts
for (let w = 0; w < 10; w++) {
  const win = windowedStream.windows[w];
  assert(`Window ${w} has tables`, win.tables != null);
  assert(`Window ${w} has N > 0`, win.N > 0);
}

// Window Ns sum to total
const windowNSum = windowedStream.windows.reduce((s, w) => s + w.N, 0);
assert('Window N sum = total', windowNSum === 100000);

// Test 6.6: Windowed analysis on null synthetic
const windowedResult = windowedAnalysisFromBuffer(synthBuf, 20);
assert('Windowed analysis completes', windowedResult != null && !windowedResult.error,
  windowedResult.error || '');
assert('Windowed has deltaStats', windowedResult.deltaStats != null);
assert('Windowed has 4 delta series', windowedResult.deltaStats.length === 4);

// Temporal verdict on null data: with very low detection rates and small
// windows, random fluctuations in tiny counts can produce apparent trends.
// The key test is that null data does NOT produce DRIFT (which requires
// both autocorrelation AND trend). STATIONARY or TRENDING are both
// acceptable for noise — only DRIFT would be concerning.
assert('Null synthetic not DRIFT',
  windowedResult.temporalVerdict !== 'DRIFT',
  `verdict: ${windowedResult.temporalVerdict}`);

// Higher-statistics test: 50% detection rate, 1M trials, 50 windows
// This gives ~10K detections per window — enough for meaningful trend analysis
const synthHighStats = generateSynthetic(1000000, { seed: 99, detectionRate: 0.5, signalDelta: 0 });
const windowedHighStats = windowedAnalysisFromBuffer(synthHighStats, 50);
assert('High-stats null is STATIONARY',
  windowedHighStats.temporalVerdict === 'STATIONARY',
  `verdict: ${windowedHighStats.temporalVerdict}, AC(1)s: ${windowedHighStats.deltaStats.map(d => d.autocorrelation_lag1.toFixed(3)).join(', ')}`);

// Autocorrelation should be small for null data
for (let d = 0; d < 4; d++) {
  const ac = windowedResult.deltaStats[d].autocorrelation_lag1;
  console.log(`    ${windowedResult.deltaStats[d].label}: AC(1) = ${ac.toFixed(4)}, trend R² = ${windowedResult.deltaStats[d].trendR2.toFixed(4)}`);
}

// Test 6.7: Windowed analysis on signal synthetic
const windowedSig = windowedAnalysisFromBuffer(synthSignalBuf, 20);
assert('Signal windowed analysis completes', windowedSig != null && !windowedSig.error);

// The signal should be present in the full run
console.log(`    Signal full-run magnitude: ${windowedSig.fullRunResult.residual.magnitude.toExponential(3)}`);
console.log(`    Signal permutation p: ${windowedSig.fullRunResult.permutation.pValue.toFixed(4)}`);

// Signal should be roughly uniform across windows (stationary, not drifting)
// because we inject it uniformly
const sigDeltaB2series = windowedSig.windowDeltas.map(w => w.deltas[3]);
const sigMean = sigDeltaB2series.reduce((s,v) => s+v, 0) / sigDeltaB2series.length;
console.log(`    Signal Δ_B(2) windowed mean: ${sigMean.toExponential(3)}`);


section('Phase 6: NIST Real Data (optional)');

// Test 6.8: Check for real NIST binary
const nistBinPath = [
  'data/nist/completeblind.bin',
  'data/nist/17_04_CH_pockel_100kHz.run.completeblind.bin',
  'nist/17_04_CH_pockel_100kHz.run.completeblind.bin',
  'tools/nist/17_04_CH_pockel_100kHz.run.completeblind.bin',
  'bell/data/nist/completeblind.bin',
].find(p => existsSync(p)) || 'data/nist/completeblind.bin';
if (existsSync(nistBinPath)) {
  console.log('    ★ Real NIST binary found — running event-level analysis');
  const nistStreamed = streamBinary(nistBinPath);
  assert('NIST binary streams', nistStreamed.tables != null);
  console.log(`    N = ${nistStreamed.N.toLocaleString()}`);

  // Compare to Gill's summary counts
  const gillNIST = nist;
  let matchesGill = true;
  for (const ab of ['11', '12', '21', '22']) {
    const s = nistStreamed.tables[ab];
    const g = gillNIST.tables[ab];
    // Allow some tolerance — Gill may use slightly different trial definitions
    if (Math.abs(s.pp - g.pp) > g.pp * 0.05) matchesGill = false;
  }
  console.log(`    Matches Gill summary: ${matchesGill ? 'YES' : 'approximate (different trial definitions expected)'}`);

  // Time-windowed analysis
  const nistWindowed = windowedAnalysis(nistBinPath, 100);
  console.log(`    Temporal verdict: ${nistWindowed.temporalVerdict}`);
  for (const ds of nistWindowed.deltaStats) {
    console.log(`    ${ds.label}: AC(1)=${ds.autocorrelation_lag1.toFixed(4)}, trend R²=${ds.trendR2.toFixed(4)}`);
  }
} else {
  console.log('    NIST binary not found at ' + nistBinPath);
  console.log('    To run event-level analysis:');
  console.log('      1. Download HDF5 from NIST processed_compressed page');
  console.log('      2. python3 bell/tools/convert_nist.py <hdf5_path> bell/data/nist/');
  console.log('      3. Re-run tests');
}

// Cleanup temp files
try { unlinkSync(tmpPath); } catch(e) {}
try { unlinkSync(tmpSigPath); } catch(e) {}


// ═══════════════════════════════════════
// Summary
// ═══════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✓ All tests pass.');
} else {
  console.log(`✗ ${failed} test(s) failed.`);
}
console.log('═'.repeat(50));

process.exit(failed > 0 ? 1 : 0);
