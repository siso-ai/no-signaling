/**
 * BootstrapGate — bootstrap confidence intervals on no-signaling deltas.
 *
 * Signature: 'permutation_result'
 *
 * Resamples the count tables using Poisson resampling
 * (equivalent to multinomial bootstrap for large N).
 * For each resample, recomputes all four deltas and the
 * combined magnitude. Reports percentile CIs.
 *
 * Poisson resampling: each cell count is replaced by
 * Poisson(observed_count). This preserves the multinomial
 * structure asymptotically and is O(1) per cell — no need
 * to enumerate individual trials.
 *
 * For small N (< 200 per setting pair): multinomial resampling
 * by drawing n balls from the four-cell distribution.
 *
 * Seeded PRNG for reproducibility.
 *
 * Stateless. Pure.
 *
 * GPL v3
 */

import { Gate } from './GateBase.js';


export class BootstrapGate extends Gate {
  constructor() { super('permutation_result'); }

  transform(event, stream) {
    const pr = event.data;
    const r = pr._residual;
    const opts = r._permOpts || {};
    const nResamples = opts.nBootstrap || 10000;
    const seed = opts.bootstrapSeed || 42;
    const ciLevel = opts.ciLevel || 0.95;

    const tables = r.tables;
    const sc = r.settingCounts;

    // Seeded PRNG (mulberry32)
    let rngState = seed | 0;
    function rand() {
      rngState = (rngState + 0x6D2B79F5) | 0;
      let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // Poisson variate via Knuth (small λ) or normal approx (large λ)
    function poisson(lambda) {
      if (lambda <= 0) return 0;
      if (lambda > 30) {
        // Normal approximation
        let u, v, s;
        do {
          u = rand() * 2 - 1;
          v = rand() * 2 - 1;
          s = u * u + v * v;
        } while (s >= 1 || s === 0);
        const z = u * Math.sqrt(-2 * Math.log(s) / s);
        return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
      }
      // Knuth's algorithm
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= rand();
      } while (p > L);
      return k - 1;
    }

    // Multinomial resample: draw n items from distribution [p1,p2,p3,p4]
    function multinomialSample(counts, n) {
      const total = counts[0] + counts[1] + counts[2] + counts[3];
      if (total === 0) return [0, 0, 0, 0];
      const probs = counts.map(c => c / total);
      const result = [0, 0, 0, 0];
      let remaining = n;
      let pRemaining = 1.0;
      for (let i = 0; i < 3; i++) {
        if (pRemaining <= 0 || remaining <= 0) break;
        const p = probs[i] / pRemaining;
        // Binomial draw
        let successes = 0;
        for (let j = 0; j < remaining; j++) {
          if (rand() < p) successes++;
        }
        result[i] = successes;
        remaining -= successes;
        pRemaining -= probs[i];
      }
      result[3] = remaining;
      return result;
    }

    // Determine resampling method per setting pair
    const usePoisson = {};
    for (const ab of ['11', '12', '21', '22']) {
      usePoisson[ab] = sc[ab] > 200;
    }

    // Distribution arrays
    const deltaA1Dist = new Float64Array(nResamples);
    const deltaA2Dist = new Float64Array(nResamples);
    const deltaB1Dist = new Float64Array(nResamples);
    const deltaB2Dist = new Float64Array(nResamples);
    const magDist = new Float64Array(nResamples);

    for (let b = 0; b < nResamples; b++) {
      // Resample each table
      const resampled = {};
      const resampledN = {};

      for (const ab of ['11', '12', '21', '22']) {
        const t = tables[ab];
        let pp, pm, mp, mm;

        if (usePoisson[ab]) {
          pp = poisson(t.pp);
          pm = poisson(t.pm);
          mp = poisson(t.mp);
          mm = poisson(t.mm);
        } else {
          const counts = [t.pp, t.pm, t.mp, t.mm];
          const n = sc[ab];
          const s = multinomialSample(counts, n);
          pp = s[0]; pm = s[1]; mp = s[2]; mm = s[3];
        }

        resampled[ab] = { pp, pm, mp, mm };
        resampledN[ab] = pp + pm + mp + mm;
      }

      // Compute marginals from resampled tables
      // Alice's marginal P(x=+|a,b) = (pp + pm) / n
      const aliceP = {};
      const bobP = {};
      for (const ab of ['11', '12', '21', '22']) {
        const t = resampled[ab];
        const n = resampledN[ab];
        aliceP[ab] = n > 0 ? (t.pp + t.pm) / n : 0.5;
        bobP[ab] = n > 0 ? (t.pp + t.mp) / n : 0.5;
      }

      // Deltas
      const dA1 = aliceP['11'] - aliceP['12'];
      const dA2 = aliceP['21'] - aliceP['22'];
      const dB1 = bobP['11'] - bobP['21'];
      const dB2 = bobP['12'] - bobP['22'];

      deltaA1Dist[b] = dA1;
      deltaA2Dist[b] = dA2;
      deltaB1Dist[b] = dB1;
      deltaB2Dist[b] = dB2;
      magDist[b] = Math.sqrt(dA1*dA1 + dA2*dA2 + dB1*dB1 + dB2*dB2);
    }

    // Extract percentile CIs
    const alpha = 1 - ciLevel;
    const lo = Math.floor((alpha / 2) * nResamples);
    const hi = Math.floor((1 - alpha / 2) * nResamples) - 1;

    function ciFromDist(dist) {
      const sorted = Float64Array.from(dist).sort();
      return {
        lo: sorted[lo],
        hi: sorted[hi],
        median: sorted[Math.floor(nResamples / 2)],
      };
    }

    const ciA1 = ciFromDist(deltaA1Dist);
    const ciA2 = ciFromDist(deltaA2Dist);
    const ciB1 = ciFromDist(deltaB1Dist);
    const ciB2 = ciFromDist(deltaB2Dist);
    const ciMag = ciFromDist(magDist);

    // Does the CI for each delta include zero?
    const zeroInCI = [
      ciA1.lo <= 0 && ciA1.hi >= 0,
      ciA2.lo <= 0 && ciA2.hi >= 0,
      ciB1.lo <= 0 && ciB1.hi >= 0,
      ciB2.lo <= 0 && ciB2.hi >= 0,
    ];

    stream.emit({
      type: 'bootstrap_result',
      data: {
        name: r.name,
        N: r.N,
        nResamples,
        ciLevel,
        seed,
        deltaCIs: [ciA1, ciA2, ciB1, ciB2],
        magnitudeCI: ciMag,
        observedDeltas: r.deltas,
        observedMagnitude: r.magnitude,
        zeroInCI,
        // Pass through for downstream
        _residual: r,
        _permutation: pr,
      },
    });
  }
}
