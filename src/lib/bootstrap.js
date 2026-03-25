/**
 * bootstrap.js — Resample confidence intervals.
 *
 * Resamples the system set N times with replacement.
 * Computes Pearson r for each resample.
 * Reports percentile confidence intervals on r and slope.
 *
 * Uses a seeded PRNG for reproducibility: same seed → same CIs.
 * The seed is recorded in the output.
 *
 * Pure function. No state. No pipeline knowledge.
 */

import { pearsonCorrelation, linearFit } from './correlate.js';


/**
 * Bootstrap confidence intervals for the correlation.
 *
 * @param {Array} points  Array of { log10Xi, shapiroRMS }
 * @param {object} [options]
 * @param {number} [options.nResamples]  Number of bootstrap resamples (default 10000)
 * @param {number} [options.ciLevel]     Confidence level (default 0.95)
 * @param {number} [options.seed]        PRNG seed (default 42)
 * @returns {object} bootstrap result
 */
export function computeBootstrap(points, options = {}) {
  const {
    nResamples = 10000,
    ciLevel = 0.95,
    seed = 42,
  } = options;

  const n = points.length;
  if (n < 4) {
    return {
      nResamples: 0,
      nSystems: n,
      rCI: [NaN, NaN],
      slopeCI: [NaN, NaN],
      rDistribution: new Float64Array(0),
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

  const rDist = new Float64Array(nResamples);
  const slopeDist = new Float64Array(nResamples);

  // Preallocate resample arrays
  const xr = new Array(n);
  const yr = new Array(n);

  for (let b = 0; b < nResamples; b++) {
    // Resample with replacement
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rand() * n);
      xr[i] = x[j];
      yr[i] = y[j];
    }

    rDist[b] = pearsonCorrelation(xr, yr);
    slopeDist[b] = linearFit(xr, yr).slope;
  }

  // Sort for percentile extraction
  const rSorted = Float64Array.from(rDist).sort();
  const sSorted = Float64Array.from(slopeDist).sort();

  const alpha = 1 - ciLevel;
  const lo = Math.floor((alpha / 2) * nResamples);
  const hi = Math.floor((1 - alpha / 2) * nResamples) - 1;

  return {
    nResamples,
    nSystems: n,
    ciLevel,
    seed,
    rCI: [rSorted[lo], rSorted[hi]],
    slopeCI: [sSorted[lo], sSorted[hi]],
    rMedian: rSorted[Math.floor(nResamples / 2)],
    slopeMedian: sSorted[Math.floor(nResamples / 2)],
    rDistribution: rDist,
    slopeDistribution: slopeDist,
    insufficient: false,
  };
}
