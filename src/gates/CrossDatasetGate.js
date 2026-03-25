/**
 * CrossDatasetGate — cross-experiment consistency and verdict.
 *
 * Signature: 'all_results'
 *
 * Collects residuals from multiple experiments.
 * Tests:
 *   1. Sign consistency: do the four deltas point the same
 *      direction across independent experiments?
 *   2. Weighted mean: inverse-variance weighted average of
 *      each delta across experiments.
 *   3. Weighted mean z-scores: is the combined evidence significant?
 *   4. Grouping analysis: compare loophole-free (2015+) vs
 *      non-loophole-free vs all.
 *
 * Emits a 'verdict' event.
 *
 * Stateless. Pure.
 *
 * GPL v3
 */

import { Gate } from './GateBase.js';


export class CrossDatasetGate extends Gate {
  constructor() { super('all_results'); }

  transform(event, stream) {
    const experiments = event.data.experiments;
    // Each entry: { residual, permutation, bootstrap, name }

    if (experiments.length < 2) {
      stream.emit({
        type: 'verdict',
        data: {
          verdict: 'INSUFFICIENT_DATA',
          reason: `Need ≥2 experiments, have ${experiments.length}`,
          experiments: experiments.map(e => e.residual.name),
        },
      });
      return;
    }

    const deltaLabels = ['Δ_A(1)', 'Δ_A(2)', 'Δ_B(1)', 'Δ_B(2)'];

    // ── 1. Sign consistency ──
    // For each of the four deltas, record the sign across experiments.
    // +1, -1, or 0 (if exactly zero, which won't happen with real data).
    const signs = [];       // [expIdx][deltaIdx] → +1 or -1
    const names = [];

    for (const exp of experiments) {
      const r = exp.residual;
      names.push(r.name);
      signs.push(r.deltas.map(d => d >= 0 ? +1 : -1));
    }

    // Count agreements per delta
    const nExp = experiments.length;
    const signAgreement = [];  // per delta: { positive, negative, dominant, agreementFraction }

    for (let d = 0; d < 4; d++) {
      let pos = 0, neg = 0;
      for (let e = 0; e < nExp; e++) {
        if (signs[e][d] > 0) pos++; else neg++;
      }
      const dominant = pos >= neg ? +1 : -1;
      const agree = Math.max(pos, neg);
      signAgreement.push({
        positive: pos,
        negative: neg,
        dominant,
        agreementCount: agree,
        agreementFraction: agree / nExp,
      });
    }

    // Overall: how many of 4 deltas have ≥ threshold agreement?
    const unanimousCount = signAgreement.filter(s => s.agreementFraction === 1.0).length;
    const majorityCount = signAgreement.filter(s => s.agreementFraction > 0.5).length;
    // Fraction of all (experiment, delta) pairs that agree with the dominant sign
    const totalAgreements = signAgreement.reduce((s, a) => s + a.agreementCount, 0);
    const totalPairs = nExp * 4;
    const overallAgreement = totalAgreements / totalPairs;


    // ── 2. Inverse-variance weighted mean per delta ──
    const weightedMeans = [];

    for (let d = 0; d < 4; d++) {
      let sumW = 0, sumWD = 0;
      for (const exp of experiments) {
        const r = exp.residual;
        const se = r.standardErrors[d];
        if (se > 0) {
          const w = 1 / (se * se);
          sumW += w;
          sumWD += w * r.deltas[d];
        }
      }
      const mean = sumW > 0 ? sumWD / sumW : 0;
      const se = sumW > 0 ? 1 / Math.sqrt(sumW) : 0;
      const z = se > 0 ? mean / se : 0;

      weightedMeans.push({ mean, se, z, label: deltaLabels[d] });
    }

    // Combined weighted chi-squared
    const weightedChiSq = weightedMeans.reduce((s, w) => s + w.z * w.z, 0);


    // ── 3. Per-delta detail table ──
    const deltaDetail = [];
    for (let d = 0; d < 4; d++) {
      const perExp = experiments.map(exp => ({
        name: exp.residual.name,
        delta: exp.residual.deltas[d],
        se: exp.residual.standardErrors[d],
        z: exp.residual.zScores[d],
        sign: signs[experiments.indexOf(exp)][d],
        ciExcludesZero: exp.bootstrap ? !exp.bootstrap.zeroInCI[d] : null,
      }));

      deltaDetail.push({
        label: deltaLabels[d],
        perExp,
        signAgreement: signAgreement[d],
        weightedMean: weightedMeans[d],
      });
    }


    // ── 4. Pairwise experiment comparison ──
    // For each pair, count how many of 4 deltas have same sign
    const pairwise = [];
    for (let i = 0; i < nExp; i++) {
      for (let j = i + 1; j < nExp; j++) {
        let agree = 0;
        for (let d = 0; d < 4; d++) {
          if (signs[i][d] === signs[j][d]) agree++;
        }
        pairwise.push({
          exp1: names[i],
          exp2: names[j],
          agree,
          total: 4,
        });
      }
    }


    // ── 5. Verdict ──
    const verdictFlags = [];

    // Sign consistency
    if (unanimousCount >= 3) {
      verdictFlags.push('SIGN_CONSISTENT');
    } else if (majorityCount >= 3) {
      verdictFlags.push('SIGN_MAJORITY');
    }

    // Weighted significance
    // Chi-squared with 4 df: p < 0.05 at χ² > 9.49, p < 0.01 at χ² > 13.28
    if (weightedChiSq > 13.28) {
      verdictFlags.push('WEIGHTED_SIGNIFICANT_001');
    } else if (weightedChiSq > 9.49) {
      verdictFlags.push('WEIGHTED_SIGNIFICANT_005');
    } else if (weightedChiSq > 7.78) {
      verdictFlags.push('WEIGHTED_SUGGESTIVE');
    }

    // Any individual experiment significant by permutation
    const sigExps = experiments.filter(e => e.permutation && e.permutation.pValue < 0.05);
    if (sigExps.length > 0) {
      verdictFlags.push('INDIVIDUAL_SIGNIFICANT');
    }

    // Any CI excludes zero
    const ciExclusions = experiments.filter(e =>
      e.bootstrap && e.bootstrap.zeroInCI.some(z => !z)
    );
    if (ciExclusions.length > 0) {
      verdictFlags.push('CI_EXCLUDES_ZERO');
    }

    // Overall verdict
    let verdict;
    if (verdictFlags.includes('WEIGHTED_SIGNIFICANT_001') && verdictFlags.includes('SIGN_CONSISTENT')) {
      verdict = 'SYSTEMATIC';
    } else if (verdictFlags.includes('WEIGHTED_SIGNIFICANT_005') || verdictFlags.includes('WEIGHTED_SUGGESTIVE')) {
      verdict = 'SUGGESTIVE';
    } else if (verdictFlags.includes('INDIVIDUAL_SIGNIFICANT')) {
      verdict = 'ISOLATED_SIGNAL';
    } else {
      verdict = 'NULL';
    }

    stream.emit({
      type: 'verdict',
      data: {
        verdict,
        verdictFlags,
        nExperiments: nExp,
        experiments: names,

        signConsistency: {
          perDelta: signAgreement,
          unanimousCount,
          majorityCount,
          overallAgreement,
        },

        weightedMeans,
        weightedChiSq,

        deltaDetail,
        pairwise,

        // Individual experiment summaries
        experimentSummaries: experiments.map(exp => ({
          name: exp.residual.name,
          N: exp.residual.N,
          magnitude: exp.residual.magnitude,
          chiSq: exp.residual.chiSq,
          deltas: exp.residual.deltas,
          zScores: exp.residual.zScores,
          permPValue: exp.permutation ? exp.permutation.pValue : null,
          ciExcludesZero: exp.bootstrap ? exp.bootstrap.zeroInCI.map(z => !z) : null,
        })),
      },
    });
  }
}
