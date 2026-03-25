/**
 * windowed.js — Time-windowed no-signaling analysis.
 *
 * Splits an event-level binary into N windows.
 * Runs Gates 2-3 on each window independently.
 * Produces a time series of deltas.
 * Tests for temporal stability vs drift.
 *
 * Key test: autocorrelation of the delta time series.
 *   White noise → autocorrelation ≈ 0 → persistent signal.
 *   Drift → positive autocorrelation → instrumental artifact.
 *
 * GPL v3
 */

import { streamBinary } from '../gates/StreamingCountGate.js';
import { analyzeExperiment } from '../pipeline.js';


/**
 * Run time-windowed analysis on a binary file.
 *
 * @param {string} binPath  Path to flat binary
 * @param {number} nWindows  Number of windows
 * @returns {object} Analysis results
 */
export function windowedAnalysis(binPath, nWindows) {
  // Stream the binary into per-window count tables
  const streamed = streamBinary(binPath, { windows: nWindows });

  if (streamed.error) {
    return { error: streamed.error };
  }

  if (!streamed.windows || streamed.windows.length === 0) {
    return { error: 'No windows produced' };
  }

  // Run Gates 2-3 (marginals + no-signaling) on each window
  const windowDeltas = [];

  for (const win of streamed.windows) {
    const exp = {
      name: `Window ${win.window}`,
      tables: win.tables,
    };

    // Run without permutation/bootstrap for speed
    const result = analyzeExperiment(exp, {
      permutation: false,
      bootstrap: false,
    });

    windowDeltas.push({
      window: win.window,
      N: win.N,
      deltas: result.residual.deltas,
      zScores: result.residual.zScores,
      magnitude: result.residual.magnitude,
      chiSq: result.residual.chiSq,
    });
  }

  // Extract per-delta time series
  const deltaLabels = ['Δ_A(1)', 'Δ_A(2)', 'Δ_B(1)', 'Δ_B(2)'];
  const deltaSeries = [[], [], [], []];
  const magSeries = [];

  for (const wd of windowDeltas) {
    for (let d = 0; d < 4; d++) {
      deltaSeries[d].push(wd.deltas[d]);
    }
    magSeries.push(wd.magnitude);
  }

  // Compute statistics on each delta series
  const deltaStats = deltaSeries.map((series, d) => {
    const mean = _mean(series);
    const std = _std(series);
    const ac1 = _autocorrelation(series, 1);
    const ac2 = _autocorrelation(series, 2);
    const trend = _linearTrend(series);

    return {
      label: deltaLabels[d],
      mean,
      std,
      autocorrelation_lag1: ac1,
      autocorrelation_lag2: ac2,
      trendSlope: trend.slope,
      trendR2: trend.r2,
    };
  });

  // Overall assessment
  const maxAC1 = Math.max(...deltaStats.map(s => Math.abs(s.autocorrelation_lag1)));
  const maxTrendR2 = Math.max(...deltaStats.map(s => s.trendR2));

  // AC1 significance threshold: |AC1| > 2/√N for 95% confidence
  const acThreshold = 2 / Math.sqrt(nWindows);

  // R² significance: critical R² at p=0.05 ≈ 4/(n-2) for n datapoints
  // (from F-distribution: F_{1,n-2} at p=0.05 ≈ 4 for large n)
  const r2Threshold = 4 / Math.max(1, nWindows - 2);

  let temporalVerdict;
  if (maxAC1 > acThreshold && maxTrendR2 > r2Threshold) {
    temporalVerdict = 'DRIFT';
  } else if (maxAC1 > acThreshold) {
    temporalVerdict = 'AUTOCORRELATED';
  } else if (maxTrendR2 > r2Threshold) {
    temporalVerdict = 'TRENDING';
  } else {
    temporalVerdict = 'STATIONARY';
  }

  // Also run full analysis on the complete run for comparison
  const fullRun = streamBinary(binPath, { windows: 1 });
  const fullResult = analyzeExperiment(
    { name: 'NIST (event-level)', tables: fullRun.tables },
    { permutation: true, bootstrap: true, nPermutations: 10000, seed: 137, bootstrapSeed: 42 }
  );

  return {
    nWindows,
    totalTrials: streamed.totalTrials,
    windowSize: streamed.windowSize,
    windowDeltas,
    deltaStats,
    magSeries,
    acThreshold,
    r2Threshold,
    temporalVerdict,
    fullRunResult: {
      residual: fullResult.residual,
      permutation: fullResult.permutation,
      bootstrap: fullResult.bootstrap,
    },
  };
}


/**
 * Run windowed analysis on in-memory buffer (for testing).
 * Writes to temp file, runs analysis, cleans up.
 *
 * @param {Buffer} buf  Binary data
 * @param {number} nWindows
 * @returns {object}
 */
export function windowedAnalysisFromBuffer(buf, nWindows) {
  const tmpPath = '/tmp/bell_synth_' + Date.now() + '.bin';
  writeFileSync(tmpPath, buf);
  try {
    return windowedAnalysis(tmpPath, nWindows);
  } finally {
    try { unlinkSync(tmpPath); } catch(e) {}
  }
}

import { writeFileSync, unlinkSync } from 'fs';


// ═══════════════════════════════════════
// Statistical helpers — pure functions
// ═══════════════════════════════════════

function _mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function _std(arr) {
  if (arr.length < 2) return 0;
  const m = _mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/**
 * Autocorrelation at lag k.
 * AC(k) = Σ (x_t - μ)(x_{t+k} - μ) / Σ (x_t - μ)²
 */
function _autocorrelation(arr, lag) {
  const n = arr.length;
  if (n <= lag) return 0;
  const m = _mean(arr);
  let num = 0, den = 0;
  for (let t = 0; t < n; t++) {
    den += (arr[t] - m) ** 2;
    if (t + lag < n) {
      num += (arr[t] - m) * (arr[t + lag] - m);
    }
  }
  return den > 0 ? num / den : 0;
}

/**
 * Linear trend: y = slope * x + intercept
 * Returns { slope, intercept, r2 }
 */
function _linearTrend(arr) {
  const n = arr.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += arr[i];
    sxy += i * arr[i];
    sx2 += i * i;
  }

  const den = n * sx2 - sx * sx;
  if (Math.abs(den) < 1e-20) return { slope: 0, intercept: sy / n, r2: 0 };

  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;

  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * i + intercept;
    ssTot += (arr[i] - meanY) ** 2;
    ssRes += (arr[i] - pred) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2 };
}
