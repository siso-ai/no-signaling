/**
 * pipeline.js — Bell test no-signaling residual pipeline.
 *
 * Wires Gates 1–3 into a stream. Feeds experiments.
 * Collects residuals from pending. Reports.
 *
 * Run: node bell/pipeline.js
 *
 * GPL v3
 */

import { Stream } from './lib/Stream.js';
import { CountTableGate } from './gates/CountTableGate.js';
import { MarginalGate } from './gates/MarginalGate.js';
import { NoSignalingGate } from './gates/NoSignalingGate.js';
import { PermutationGate } from './gates/PermutationGate.js';
import { BootstrapGate } from './gates/BootstrapGate.js';
import { CrossDatasetGate } from './gates/CrossDatasetGate.js';
import { streamBinary, generateSynthetic } from './gates/StreamingCountGate.js';
import { allExperiments, loopholeFree2015 } from './data/summary_counts.js';


/**
 * Run the pipeline on one experiment.
 * Returns { residual, permutation, bootstrap } data objects.
 *
 * @param {object} exp  Experiment from summary_counts.js
 * @param {object} [opts]  Options
 * @param {boolean} [opts.permutation]  Run permutation test (default true)
 * @param {boolean} [opts.bootstrap]    Run bootstrap CIs (default true)
 * @param {number} [opts.nPermutations]  Number of permutations (default 10000)
 * @param {number} [opts.nBootstrap]     Number of bootstrap resamples (default 10000)
 * @param {number} [opts.seed]  Permutation PRNG seed (default 137)
 * @param {number} [opts.bootstrapSeed]  Bootstrap PRNG seed (default 42)
 * @param {number} [opts.ciLevel]  CI level (default 0.95)
 */
export function analyzeExperiment(exp, opts = {}) {
  const {
    permutation: runPerm = true,
    bootstrap: runBoot = true,
    nPermutations = 10000,
    nBootstrap = 10000,
    seed = 137,
    bootstrapSeed = 42,
    ciLevel = 0.95,
  } = opts;

  const stream = new Stream();
  stream.register(new CountTableGate());
  stream.register(new MarginalGate());
  stream.register(new NoSignalingGate());
  if (runPerm) {
    stream.register(new PermutationGate());
  }
  if (runPerm && runBoot) {
    stream.register(new BootstrapGate());
  }

  const expWithOpts = { ...exp };
  if (runPerm) {
    expWithOpts._permOpts = {
      nPermutations, seed,
      nBootstrap, bootstrapSeed, ciLevel,
    };
  }

  stream.emit({ type: 'summary', data: expWithOpts });

  const result = stream.sampleHere();

  // Collect results by type
  const out = {};

  for (const e of result.pending) {
    if (e.type === 'residual') out.residual = e.data;
    if (e.type === 'permutation_result') {
      out.permutation = e.data;
      out.residual = out.residual || e.data._residual;
    }
    if (e.type === 'bootstrap_result') {
      out.bootstrap = e.data;
      out.residual = out.residual || e.data._residual;
      out.permutation = out.permutation || e.data._permutation;
    }
  }

  if (!out.residual) {
    throw new Error(`No residual produced for ${exp.name}`);
  }

  return out;
}


/**
 * Run on all experiments and print report.
 */
/**
 * Run full analysis across a set of experiments.
 * Returns individual results plus cross-dataset verdict.
 */
export function analyzeAll(exps, opts = {}) {
  const results = exps.map(exp => {
    const r = analyzeExperiment(exp, opts);
    return { ...r, name: r.residual.name };
  });

  // Cross-dataset verdict
  const crossStream = new Stream();
  crossStream.register(new CrossDatasetGate());
  crossStream.emit({
    type: 'all_results',
    data: { experiments: results },
  });

  const crossResult = crossStream.sampleHere();
  const verdicts = crossResult.pending.filter(e => e.type === 'verdict');
  const verdict = verdicts.length > 0 ? verdicts[0].data : null;

  return { results, verdict };
}


function main() {
  console.log('Bell Test No-Signaling Residual Analysis');
  console.log('═'.repeat(60));
  console.log('');

  const results = [];

  for (const exp of allExperiments) {
    const { residual: r, permutation: perm, bootstrap: boot } = analyzeExperiment(exp);
    results.push({ r, perm, boot });

    console.log(`── ${r.name} ──`);
    console.log(`  N = ${r.N.toLocaleString()}`);
    console.log('');
    console.log('  No-signaling deltas (should be 0 under standard QM):');
    console.log(`    Δ_A(a=1) = ${fmt(r.alice.delta1)}  ±${fmt(r.alice.se1)}  z=${fmt(r.alice.z1)}`);
    console.log(`    Δ_A(a=2) = ${fmt(r.alice.delta2)}  ±${fmt(r.alice.se2)}  z=${fmt(r.alice.z2)}`);
    console.log(`    Δ_B(b=1) = ${fmt(r.bob.delta1)}  ±${fmt(r.bob.se1)}  z=${fmt(r.bob.z1)}`);
    console.log(`    Δ_B(b=2) = ${fmt(r.bob.delta2)}  ±${fmt(r.bob.se2)}  z=${fmt(r.bob.z2)}`);
    console.log('');
    console.log(`  Combined magnitude: ${fmt(r.magnitude)}`);
    console.log(`  χ² (4 df):          ${r.chiSq.toFixed(4)}`);

    if (perm) {
      console.log('');
      console.log(`  Permutation test (${perm.nPermutations.toLocaleString()} permutations, seed=${perm.seed}):`);
      console.log(`    p-value:      ${perm.pValue.toFixed(6)}`);
      console.log(`    null median:  ${fmt(perm.nullMedian)}`);
      console.log(`    null 95th:    ${fmt(perm.null95)}`);
      console.log(`    null 99th:    ${fmt(perm.null99)}`);
      console.log(`    observed:     ${fmt(perm.observedMagnitude)}`);

      if (perm.pValue < 0.01) {
        console.log(`    ⚑ SIGNIFICANT at p < 0.01`);
      } else if (perm.pValue < 0.05) {
        console.log(`    ⚑ SUGGESTIVE at p < 0.05`);
      }
    }

    if (boot) {
      const labels = ['Δ_A(1)', 'Δ_A(2)', 'Δ_B(1)', 'Δ_B(2)'];
      console.log('');
      console.log(`  Bootstrap ${(boot.ciLevel * 100).toFixed(0)}% CIs (${boot.nResamples.toLocaleString()} resamples, seed=${boot.seed}):`);
      for (let i = 0; i < 4; i++) {
        const ci = boot.deltaCIs[i];
        const obs = boot.observedDeltas[i];
        const zeroIn = boot.zeroInCI[i] ? '' : ' ★ excludes 0';
        console.log(`    ${labels[i]}: ${fmt(obs)}  [${fmt(ci.lo)}, ${fmt(ci.hi)}]${zeroIn}`);
      }
      console.log(`    ‖Δ‖:     ${fmt(boot.observedMagnitude)}  [${fmt(boot.magnitudeCI.lo)}, ${fmt(boot.magnitudeCI.hi)}]`);
    }

    const maxZ = Math.max(...r.zScores.map(Math.abs));
    if (maxZ > 2) {
      console.log(`  ⚑ Max |z| = ${maxZ.toFixed(3)} — exceeds 2σ`);
    }
    console.log('');
  }

  // Summary table
  console.log('═'.repeat(60));
  console.log('Summary');
  console.log('─'.repeat(60));
  console.log(padR('Experiment', 30) + padR('N', 16) + padR('‖Δ‖', 12) + padR('p-perm', 10) + padR('0∈CI?', 8));
  console.log('─'.repeat(76));
  for (const { r, perm, boot } of results) {
    const nExclude = boot ? boot.zeroInCI.filter(x => !x).length : 0;
    const ciCol = boot ? (nExclude > 0 ? `${nExclude}/4 excl` : 'all incl') : '—';
    console.log(
      padR(r.name, 30) +
      padR(r.N.toLocaleString(), 16) +
      padR(r.magnitude.toExponential(3), 12) +
      padR(perm ? perm.pValue.toFixed(4) : '—', 10) +
      padR(ciCol, 8)
    );
  }
  console.log('═'.repeat(76));

  // ── Cross-dataset analysis ──
  console.log('');
  console.log('');

  // All experiments
  printCrossAnalysis('ALL EXPERIMENTS', allExperiments);

  // Loophole-free 2015 only
  printCrossAnalysis('LOOPHOLE-FREE 2015 (Delft + NIST + Vienna)', loopholeFree2015);
}


function printCrossAnalysis(title, exps) {
  const { verdict } = analyzeAll(exps);
  if (!verdict) return;

  console.log('═'.repeat(76));
  console.log(`Cross-Dataset Analysis: ${title}`);
  console.log('═'.repeat(76));
  console.log('');

  // Sign consistency
  const labels = ['Δ_A(1)', 'Δ_A(2)', 'Δ_B(1)', 'Δ_B(2)'];
  console.log('Sign consistency across experiments:');
  console.log('─'.repeat(76));
  console.log(padR('', 10) + verdict.experiments.map(n => padR(n.slice(0, 12), 14)).join('') + padR('Agreement', 12));
  console.log('─'.repeat(76));

  for (let d = 0; d < 4; d++) {
    const dd = verdict.deltaDetail[d];
    let row = padR(labels[d], 10);
    for (const pe of dd.perExp) {
      const s = pe.sign > 0 ? '+' : '−';
      const ci = pe.ciExcludesZero ? '★' : ' ';
      row += padR(`${s} (z=${pe.z.toFixed(1)})${ci}`, 14);
    }
    row += padR(`${dd.signAgreement.agreementCount}/${verdict.nExperiments}`, 12);
    console.log(row);
  }

  console.log('');
  console.log(`  Unanimous on ${verdict.signConsistency.unanimousCount}/4 deltas`);
  console.log(`  Majority  on ${verdict.signConsistency.majorityCount}/4 deltas`);
  console.log(`  Overall agreement: ${(verdict.signConsistency.overallAgreement * 100).toFixed(1)}%`);

  // Weighted means
  console.log('');
  console.log('Inverse-variance weighted means:');
  console.log('─'.repeat(50));
  for (const wm of verdict.weightedMeans) {
    const sig = Math.abs(wm.z) > 2 ? ' ★' : '';
    console.log(`  ${padR(wm.label, 10)} mean=${fmt(wm.mean)}  SE=${fmt(wm.se)}  z=${wm.z.toFixed(3)}${sig}`);
  }
  console.log(`  Combined χ² = ${verdict.weightedChiSq.toFixed(4)} (4 df)`);
  console.log(`  χ²>9.49 → p<0.05 | χ²>13.28 → p<0.01`);

  // Pairwise
  console.log('');
  console.log('Pairwise sign agreement:');
  for (const p of verdict.pairwise) {
    console.log(`  ${padR(p.exp1.slice(0, 25), 28)} × ${padR(p.exp2.slice(0, 25), 28)} → ${p.agree}/4`);
  }

  // Verdict
  console.log('');
  console.log('─'.repeat(76));
  console.log(`  VERDICT: ${verdict.verdict}`);
  console.log(`  FLAGS:   ${verdict.verdictFlags.join(', ') || 'none'}`);
  console.log('─'.repeat(76));
  console.log('');
}

function fmt(x) {
  if (Math.abs(x) < 0.001 && x !== 0) return x.toExponential(4);
  return x.toFixed(6);
}

function padR(s, w) {
  s = String(s);
  return s + ' '.repeat(Math.max(0, w - s.length));
}

main();
