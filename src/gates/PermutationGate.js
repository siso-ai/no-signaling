/**
 * PermutationGate — permutation test on no-signaling residuals.
 *
 * Signature: 'residual'
 *
 * For each of the four no-signaling deltas, the null hypothesis
 * is that the marginal does not depend on the remote setting.
 * Under the null, trials from the two remote-setting groups
 * are exchangeable.
 *
 * Implementation: for each delta, the null distribution of
 * the "successes in group 1" count follows a hypergeometric
 * distribution. We sample from this to generate permuted deltas,
 * then compute the combined magnitude. The p-value is the fraction
 * of permuted magnitudes ≥ observed.
 *
 * For small N: exact hypergeometric sampling (sequential draw).
 * For large N: normal approximation to the hypergeometric.
 * Threshold: N_pair > 50000.
 *
 * Seeded PRNG for reproducibility.
 *
 * Stateless. Pure.
 *
 * GPL v3
 */

import { Gate } from './GateBase.js';


export class PermutationGate extends Gate {
  constructor() { super('residual'); }

  transform(event, stream) {
    const r = event.data;
    const opts = r._permOpts || {};
    const nPerms = opts.nPermutations || 10000;
    const seed = opts.seed || 137;

    // Extract the four delta specifications.
    // Each delta compares two groups sharing a local setting,
    // differing in the remote setting.
    //
    // Δ_A(a=1): groups (1,1) vs (1,2), count Alice's +
    // Δ_A(a=2): groups (2,1) vs (2,2), count Alice's +
    // Δ_B(b=1): groups (1,1) vs (2,1), count Bob's +
    // Δ_B(b=2): groups (1,2) vs (2,2), count Bob's +

    const t = r.tables;
    const sc = r.settingCounts;

    const specs = [
      { // Δ_A(a=1)
        n1: sc['11'], k1: t['11'].pp + t['11'].pm,  // Alice + in (1,1)
        n2: sc['12'], k2: t['12'].pp + t['12'].pm,  // Alice + in (1,2)
      },
      { // Δ_A(a=2)
        n1: sc['21'], k1: t['21'].pp + t['21'].pm,
        n2: sc['22'], k2: t['22'].pp + t['22'].pm,
      },
      { // Δ_B(b=1)
        n1: sc['11'], k1: t['11'].pp + t['11'].mp,  // Bob + in (1,1)
        n2: sc['21'], k2: t['21'].pp + t['21'].mp,   // Bob + in (2,1)
      },
      { // Δ_B(b=2)
        n1: sc['12'], k1: t['12'].pp + t['12'].mp,
        n2: sc['22'], k2: t['22'].pp + t['22'].mp,
      },
    ];

    // Observed magnitude
    const observedMag = r.magnitude;

    // Seeded PRNG (mulberry32)
    let rngState = seed | 0;
    function rand() {
      rngState = (rngState + 0x6D2B79F5) | 0;
      let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // Standard normal via Box-Muller (for large-N approximation)
    let hasSpare = false;
    let spare = 0;
    function randNormal() {
      if (hasSpare) { hasSpare = false; return spare; }
      let u, v, s;
      do {
        u = rand() * 2 - 1;
        v = rand() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const mul = Math.sqrt(-2 * Math.log(s) / s);
      spare = v * mul;
      hasSpare = true;
      return u * mul;
    }

    // Sample from hypergeometric: drawing n1 items from
    // a population of N = n1+n2, of which K = k1+k2 are successes.
    // Returns the count of successes in the sample of size n1.
    function sampleHypergeometric(n1, n2, K) {
      const N = n1 + n2;
      if (K === 0) return 0;
      if (K === N) return n1;

      // Large-N: normal approximation
      if (N > 50000) {
        const mean = n1 * K / N;
        const variance = n1 * n2 * K * (N - K) / (N * N * (N - 1));
        const std = Math.sqrt(variance);
        if (std < 1e-15) return Math.round(mean);
        const x = Math.round(mean + std * randNormal());
        return Math.max(0, Math.min(Math.min(n1, K), x));
      }

      // Small-N: sequential draw
      let successes = 0;
      let remaining = N;
      let kLeft = K;
      const draw = Math.min(n1, N);
      for (let i = 0; i < draw; i++) {
        if (rand() < kLeft / remaining) {
          successes++;
          kLeft--;
        }
        remaining--;
        if (kLeft === 0) break;
      }
      return successes;
    }

    // Run permutations
    const nullDist = new Float64Array(nPerms);
    let exceedCount = 0;

    // Per-delta observed values for individual p-values
    const observedDeltas = r.deltas.map(Math.abs);
    const exceedPerDelta = [0, 0, 0, 0];

    for (let p = 0; p < nPerms; p++) {
      let sumSq = 0;

      for (let d = 0; d < 4; d++) {
        const s = specs[d];
        const K = s.k1 + s.k2;

        // Under null: randomly split K successes into groups of n1 and n2
        const k1perm = sampleHypergeometric(s.n1, s.n2, K);
        const k2perm = K - k1perm;

        const delta = (s.n1 > 0 ? k1perm / s.n1 : 0) - (s.n2 > 0 ? k2perm / s.n2 : 0);
        sumSq += delta * delta;

        if (Math.abs(delta) >= observedDeltas[d]) {
          exceedPerDelta[d]++;
        }
      }

      const mag = Math.sqrt(sumSq);
      nullDist[p] = mag;

      if (mag >= observedMag) {
        exceedCount++;
      }
    }

    // p-value (Phipson & Smyth conservative correction)
    const pValue = (exceedCount + 1) / (nPerms + 1);

    // Per-delta p-values
    const perDeltaPValues = exceedPerDelta.map(c => (c + 1) / (nPerms + 1));

    // Null distribution statistics
    const sorted = Float64Array.from(nullDist).sort();
    const nullMedian = sorted[Math.floor(nPerms / 2)];
    const null95 = sorted[Math.floor(0.95 * nPerms)];
    const null99 = sorted[Math.floor(0.99 * nPerms)];

    stream.emit({
      type: 'permutation_result',
      data: {
        name: r.name,
        N: r.N,
        observedMagnitude: observedMag,
        pValue,
        nPermutations: nPerms,
        exceedCount,
        seed,
        perDeltaPValues,
        nullMedian,
        null95,
        null99,
        observedDeltas: r.deltas,
        observedZScores: r.zScores,
        chiSq: r.chiSq,
        // Pass through for downstream gates
        _residual: r,
      },
    });
  }
}
