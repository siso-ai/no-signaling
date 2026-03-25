/**
 * summary_counts.js — Bell test count tables from published sources.
 *
 * Source: Gill, R.D. "Optimal Statistical Analyses of Bell Experiments"
 * arXiv:2209.00702v4, AppliedMath 2023. Appendix A–F.
 *
 * Each experiment has four 2×2 tables, one per setting pair (a,b).
 * Rows = Alice's outcomes, Columns = Bob's outcomes.
 * Convention: outcomes are labeled +1 and -1 (or d and n).
 * Tables keyed as "ab" where a ∈ {1,2}, b ∈ {1,2}.
 *
 * Table format: { pp, pm, mp, mm }
 *   pp = N(Alice=+, Bob=+)    pm = N(Alice=+, Bob=-)
 *   mp = N(Alice=-, Bob=+)    mm = N(Alice=-, Bob=-)
 *
 * For NIST/Vienna: d→+, n→-
 *
 * Gill's convention: settings reordered so that (1,1), (1,2), (2,1)
 * have large diagonal (positive correlation) and (2,2) has large
 * off-diagonal (negative correlation). S = ρ₁₁ + ρ₁₂ + ρ₂₁ − ρ₂₂.
 *
 * GPL v3
 */


/**
 * Hensen et al. (2015) — Delft
 * Nature 526, 682 (2015)
 * Diamond NV center spins, 1.3 km separation
 * Gill Appendix A
 */
export const delft = {
  name: 'Delft (Hensen 2015)',
  ref: 'Nature 526, 682 (2015)',
  system: 'Diamond NV spins',
  year: 2015,
  tables: {
    '11': { pp: 23, pm:  3, mp:  4, mm: 23 },
    '12': { pp: 33, pm: 11, mp:  5, mm: 30 },
    '21': { pp: 22, pm: 10, mp:  6, mm: 24 },
    '22': { pp:  4, pm: 20, mp: 21, mm:  6 },
  },
};


/**
 * Rosenfeld et al. (2017) — Munich
 * PRL 119, 010402 (2017)
 * Trapped Rubidium atoms, 398 m separation
 * Gill Appendix B
 */
export const munich = {
  name: 'Munich (Rosenfeld 2017)',
  ref: 'PRL 119, 010402 (2017)',
  system: 'Trapped Rb atoms',
  year: 2017,
  tables: {
    '11': { pp: 16, pm:  4, mp:  3, mm: 13 },
    '12': { pp: 11, pm:  4, mp:  2, mm: 17 },
    '21': { pp: 19, pm:  4, mp:  3, mm: 16 },
    '22': { pp:  4, pm: 22, mp: 10, mm:  2 },
  },
};


/**
 * Shalm et al. (2015) — NIST (Boulder)
 * PRL 115, 250402 (2015)
 * Entangled photons, 185 m separation
 * Gill Appendix C
 * Outcomes: d (detection) → +, n (nondetection) → -
 */
export const nist = {
  name: 'NIST (Shalm 2015)',
  ref: 'PRL 115, 250402 (2015)',
  system: 'Entangled photons',
  year: 2015,
  tables: {
    '11': { pp:   6378, pm:    3282, mp:    3189, mm: 43897356 },
    '12': { pp:   6794, pm:    2821, mp:   23243, mm: 43276943 },
    '21': { pp:   6486, pm:   21334, mp:    2843, mm: 43338281 },
    '22': { pp:    106, pm:   27539, mp:   30040, mm: 42502788 },
  },
};


/**
 * Giustina et al. (2015) — Vienna
 * PRL 115, 250401 (2015)
 * Entangled photons, 60 m separation
 * Gill Appendix D
 * Outcomes: d (detection) → +, n (nondetection) → -
 */
export const vienna = {
  name: 'Vienna (Giustina 2015)',
  ref: 'PRL 115, 250401 (2015)',
  system: 'Entangled photons',
  year: 2015,
  tables: {
    '11': { pp: 141439, pm:    73391, mp:    76224, mm: 875392736 },
    '12': { pp: 146831, pm:    67941, mp:   326768, mm: 874976534 },
    '21': { pp: 158338, pm:   425067, mp:    58742, mm: 875239860 },
    '22': { pp:   8392, pm:   576445, mp:   463985, mm: 874651457 },
  },
};


/**
 * Weihs et al. (1998) — Innsbruck
 * PRL 81, 5039 (1998)
 * Entangled photons (not loophole-free — detection loophole open)
 * Gill Appendix E
 */
export const innsbruck = {
  name: 'Innsbruck (Weihs 1998)',
  ref: 'PRL 81, 5039 (1998)',
  system: 'Entangled photons',
  year: 1998,
  loopholeFree: false,
  tables: {
    '11': { pp: 1683, pm:  418, mp:  361, mm: 1578 },
    '12': { pp: 1100, pm:  269, mp:  156, mm: 1386 },
    '21': { pp: 1728, pm:  313, mp:  351, mm: 1978 },
    '22': { pp:  179, pm: 1636, mp: 1143, mm:  294 },
  },
};


/**
 * Zhang et al. (2022) — Munich DIQKD
 * Nature 607, 687 (2022)
 * Trapped atoms, DIQKD protocol
 * Gill Appendix F
 */
export const zhangMunich = {
  name: 'Munich DIQKD (Zhang 2022)',
  ref: 'Nature 607, 687 (2022)',
  system: 'Trapped atoms',
  year: 2022,
  tables: {
    '11': { pp: 178, pm:  44, mp:  29, mm: 183 },
    '12': { pp: 199, pm:  36, mp:  28, mm: 160 },
    '21': { pp: 160, pm:  47, mp:  31, mm: 151 },
    '22': { pp:  38, pm: 160, mp: 166, mm:  39 },
  },
};


/**
 * All experiments in array form for iteration.
 */
export const allExperiments = [
  delft, munich, nist, vienna, innsbruck, zhangMunich,
];


/**
 * The three loophole-free 2015 experiments — the primary dataset.
 */
export const loopholeFree2015 = [delft, nist, vienna];


// ═══════════════════════════════════════
// Utility functions
// ═══════════════════════════════════════

/**
 * Total trials for one setting pair.
 */
export function tableTotal(t) {
  return t.pp + t.pm + t.mp + t.mm;
}

/**
 * Total trials across all four setting pairs.
 */
export function experimentTotal(exp) {
  return Object.values(exp.tables).reduce((sum, t) => sum + tableTotal(t), 0);
}

/**
 * Correlation ρ for one setting pair.
 * ρ = (N++ + N-- - N+- - N-+) / N
 */
export function tableCorrelation(t) {
  const n = tableTotal(t);
  if (n === 0) return 0;
  return (t.pp + t.mm - t.pm - t.mp) / n;
}

/**
 * CHSH S value.
 * S = ρ₁₁ + ρ₁₂ + ρ₂₁ − ρ₂₂
 */
export function chshS(exp) {
  const r11 = tableCorrelation(exp.tables['11']);
  const r12 = tableCorrelation(exp.tables['12']);
  const r21 = tableCorrelation(exp.tables['21']);
  const r22 = tableCorrelation(exp.tables['22']);
  return r11 + r12 + r21 - r22;
}
