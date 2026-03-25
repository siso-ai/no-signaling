/**
 * correlate.js — Cross-system correlation analysis.
 *
 * This is the central question of the project.
 *
 * Given N binary pulsars, each with:
 *   - compactness Ξ (from compactness.js)
 *   - Shapiro residual RMS (from shapiro-residual.js)
 *
 * Compute:
 *   - Pearson r between log₁₀(Ξ) and shapiroRMS
 *   - Spearman rank correlation ρ
 *   - p-value (t-distribution for Pearson)
 *   - Linear fit: shapiroRMS = slope * log₁₀(Ξ) + intercept
 *   - Verdict
 *
 * GR prediction: slope = 0. No correlation.
 * Graph ontology prediction: slope > 0. Denser companions
 *   produce systematically larger Shapiro residuals.
 *
 * Pure functions. No state. No pipeline knowledge.
 */


/**
 * Run the full correlation analysis.
 *
 * @param {Array} systems  Array of objects, each with:
 *   { name, compactness: { xi, log10Xi, m2, type }, shapiro: { shapiroRMS }, stats }
 * @returns {object} correlation result
 */
export function computeCorrelation(systems) {
  // Filter to systems with both measurements
  const valid = systems.filter(s =>
    s.compactness != null &&
    s.compactness.xi > 0 &&
    s.shapiro != null &&
    s.shapiro.hasShapiro &&
    s.shapiro.shapiroRMS > 0
  );

  const n = valid.length;

  if (n < 4) {
    return {
      nSystems: n,
      verdict: 'INSUFFICIENT_DATA',
      reason: `Need ≥4 systems with both Shapiro + compactness, have ${n}`,
      points: _buildPoints(valid),
    };
  }

  // Extract arrays
  const x = valid.map(s => s.compactness.log10Xi);
  const y = valid.map(s => s.shapiro.shapiroRMS);

  // ── Pearson r ──
  const pearsonR = pearsonCorrelation(x, y);

  // ── Spearman ρ ──
  const spearmanRho = spearmanCorrelation(x, y);

  // ── p-value (two-tailed, t-distribution) ──
  const pValue = pearsonPValue(pearsonR, n);

  // ── Linear fit ──
  const fit = linearFit(x, y);

  // ── Verdict ──
  const verdict = _computeVerdict(pearsonR, pValue, n);

  return {
    pearsonR,
    spearmanRho,
    pValue,
    nSystems: n,
    linearFit: fit,
    points: _buildPoints(valid),
    verdict: verdict.label,
    verdictDetail: verdict.detail,
  };
}


/**
 * Build point array for plotting.
 */
function _buildPoints(systems) {
  return systems.map(s => ({
    name: s.name || s.fileBase || '?',
    log10Xi: s.compactness?.log10Xi ?? null,
    xi: s.compactness?.xi ?? null,
    shapiroRMS: s.shapiro?.shapiroRMS ?? null,
    m2: s.compactness?.m2 ?? null,
    type: s.compactness?.type ?? null,
    wrms: s.stats?.wrms ?? null,
  }));
}


/**
 * Verdict logic.
 */
function _computeVerdict(r, p, n) {
  if (n < 4) return { label: 'INSUFFICIENT_DATA', detail: `n=${n}, need ≥4` };
  if (n < 8) return { label: 'LOW_POWER', detail: `n=${n}, results unreliable below n=8` };

  if (p < 0.01 && r > 0) {
    return { label: 'CORRELATION', detail: `r=${r.toFixed(3)}, p=${p.toFixed(4)} — significant positive correlation` };
  }
  if (p < 0.05 && r > 0) {
    return { label: 'SUGGESTIVE', detail: `r=${r.toFixed(3)}, p=${p.toFixed(4)} — marginal, needs validation` };
  }
  if (p > 0.20) {
    return { label: 'NO_SIGNAL', detail: `r=${r.toFixed(3)}, p=${p.toFixed(4)} — no significant correlation` };
  }
  return { label: 'AMBIGUOUS', detail: `r=${r.toFixed(3)}, p=${p.toFixed(4)} — inconclusive` };
}


// ═══════════════════════════════════════
// Statistical Primitives
// ═══════════════════════════════════════

/**
 * Pearson product-moment correlation coefficient.
 *
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number} r in [-1, 1]
 */
export function pearsonCorrelation(x, y) {
  const n = x.length;
  if (n < 2) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (den < 1e-20) return 0;
  return num / den;
}


/**
 * Spearman rank correlation coefficient.
 *
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number} ρ in [-1, 1]
 */
export function spearmanCorrelation(x, y) {
  const n = x.length;
  if (n < 2) return 0;

  const rankX = _rank(x);
  const rankY = _rank(y);

  return pearsonCorrelation(rankX, rankY);
}


/**
 * Compute ranks (average rank for ties).
 */
function _rank(arr) {
  const n = arr.length;
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);

  const ranks = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + j - 1) / 2 + 1;  // 1-based average
    for (let k = i; k < j; k++) {
      ranks[indexed[k].i] = avgRank;
    }
    i = j;
  }
  return ranks;
}


/**
 * Two-tailed p-value for Pearson r using t-distribution.
 *
 * t = r * sqrt(n-2) / sqrt(1-r²)
 * df = n - 2
 *
 * Uses the incomplete beta function approximation.
 *
 * @param {number} r  Pearson correlation
 * @param {number} n  Sample size
 * @returns {number} two-tailed p-value
 */
export function pearsonPValue(r, n) {
  if (n < 3) return 1.0;
  if (Math.abs(r) >= 1.0) return 0.0;

  const df = n - 2;
  const t = Math.abs(r) * Math.sqrt(df) / Math.sqrt(1 - r * r);

  // Two-tailed p from t-distribution using regularized incomplete beta
  const x = df / (df + t * t);
  const p = incompleteBeta(x, df / 2, 0.5);

  return Math.min(1.0, Math.max(0.0, p));
}


/**
 * Ordinary least squares linear fit.
 *
 * y = slope * x + intercept
 *
 * @param {number[]} x
 * @param {number[]} y
 * @returns {object} { slope, intercept, r2 }
 */
export function linearFit(x, y) {
  const n = x.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
  }

  const den = n * sumX2 - sumX * sumX;
  if (Math.abs(den) < 1e-20) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope = (n * sumXY - sumX * sumY) / den;
  const intercept = (sumY - slope * sumX) / n;

  // R²
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * x[i] + intercept;
    ssTot += (y[i] - meanY) ** 2;
    ssRes += (y[i] - pred) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2 };
}


/**
 * Regularized incomplete beta function I_x(a, b).
 *
 * Continued fraction approximation (Lentz's method).
 * Sufficient for the t-distribution p-value computation.
 *
 * @param {number} x  in [0, 1]
 * @param {number} a  > 0
 * @param {number} b  > 0
 * @returns {number} I_x(a, b)
 */
export function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use symmetry relation for numerical stability
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - incompleteBeta(1 - x, b, a);
  }

  // Log of the prefactor: x^a * (1-x)^b / (a * B(a,b))
  const lnPre = a * Math.log(x) + b * Math.log(1 - x)
    - Math.log(a) - lnBeta(a, b);

  // Continued fraction (Lentz's method)
  const maxIter = 200;
  const eps = 1e-14;
  const tiny = 1e-30;

  let c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIter; m++) {
    // Even step
    let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + num * d;
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    c = 1 + num / c;
    if (Math.abs(c) < tiny) c = tiny;
    h *= d * c;

    // Odd step
    num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d;
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    c = 1 + num / c;
    if (Math.abs(c) < tiny) c = tiny;
    const delta = d * c;
    h *= delta;

    if (Math.abs(delta - 1) < eps) break;
  }

  return Math.exp(lnPre) * h;
}


/**
 * Log of the Beta function: ln(B(a, b)) = ln(Γ(a)) + ln(Γ(b)) - ln(Γ(a+b))
 */
function lnBeta(a, b) {
  return lnGamma(a) + lnGamma(b) - lnGamma(a + b);
}


/**
 * Lanczos approximation of ln(Γ(x)).
 */
function lnGamma(x) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }

  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) {
    a += c[i] / (x + i);
  }

  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
