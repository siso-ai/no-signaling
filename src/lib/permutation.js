/**
 * permutation.js — Shuffle significance test.
 *
 * Shuffles the compactness values across systems N times.
 * Computes r for each shuffle. The fraction of shuffled r
 * values exceeding the observed r is the permutation p-value.
 *
 * This is the most honest significance test: it makes no
 * distributional assumptions. It asks: "how often would
 * random re-labeling produce a correlation this strong?"
 *
 * Uses a seeded PRNG for reproducibility.
 *
 * Pure function. No state. No pipeline knowledge.
 */

import { pearsonCorrelation } from './correlate.js';


/**
 * Permutation test for correlation significance.
 *
 * @param {Array} points  Array of { log10Xi, shapiroRMS }
 * @param {number} observedR  The observed Pearson r
 * @param {object} [options]
 * @param {number} [options.nPermutations]  Number of permutations (default 10000)
 * @param {number} [options.seed]           PRNG seed (default 137)
 * @returns {object} permutation result
 */
export function computePermutation(points, observedR, options = {}) {
  const {
    nPermutations = 10000,
    seed = 137,
  } = options;

  const n = points.length;
  if (n < 4) {
    return {
      observedR,
      pValue: 1.0,
      nPermutations: 0,
      nSystems: n,
      nullDistribution: new Float64Array(0),
      seed,
      insufficient: true,
    };
  }

  const x = points.map(p => p.log10Xi);
  const y = points.map(p => p.shapiroRMS);

  // Seeded PRNG (mulberry32)
  let rngState = seed | 0;
  function rand() {
    rngState = (rngState + 0x6D2B79F5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const nullDist = new Float64Array(nPermutations);
  const xShuffled = [...x];

  let exceedCount = 0;

  for (let p = 0; p < nPermutations; p++) {
    // Fisher-Yates shuffle of x (compactness labels)
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = xShuffled[i];
      xShuffled[i] = xShuffled[j];
      xShuffled[j] = tmp;
    }

    const rPerm = pearsonCorrelation(xShuffled, y);
    nullDist[p] = rPerm;

    // Two-tailed: count |r_perm| >= |r_observed|
    if (Math.abs(rPerm) >= Math.abs(observedR)) {
      exceedCount++;
    }
  }

  // p-value: fraction of permutations at least as extreme
  // Add 1 to numerator and denominator for conservatism (Phipson & Smyth, 2010)
  const pValue = (exceedCount + 1) / (nPermutations + 1);

  return {
    observedR,
    pValue,
    nPermutations,
    nSystems: n,
    exceedCount,
    nullDistribution: nullDist,
    seed,
    insufficient: false,
  };
}
