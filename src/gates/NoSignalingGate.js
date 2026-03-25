/**
 * NoSignalingGate — marginals → no-signaling residual.
 *
 * Signature: 'marginals'
 *
 * No-signaling says:
 *   P(x=+|a, b=1) = P(x=+|a, b=2)  for each a  (Alice's marginal independent of Bob's setting)
 *   P(y=+|a=1, b) = P(y=+|a=2, b)  for each b  (Bob's marginal independent of Alice's setting)
 *
 * The residual is the difference. Four deltas:
 *   Δ_A(a=1) = P(x=+|a=1,b=1) - P(x=+|a=1,b=2)
 *   Δ_A(a=2) = P(x=+|a=2,b=1) - P(x=+|a=2,b=2)
 *   Δ_B(b=1) = P(y=+|a=1,b=1) - P(y=+|a=2,b=1)
 *   Δ_B(b=2) = P(y=+|a=1,b=2) - P(y=+|a=2,b=2)
 *
 * Under no-signaling, all four are zero.
 * Under SISO, walkers traverse the entangled edge,
 * making these systematically nonzero.
 *
 * This is sampleHere(). The residual is the measurement.
 *
 * Stateless. Pure.
 *
 * GPL v3
 */

import { Gate } from './GateBase.js';

export class NoSignalingGate extends Gate {
  constructor() { super('marginals'); }

  transform(event, stream) {
    const { name, alice, bob, tables, settingCounts, N } = event.data;

    // ── Alice deltas ──
    // Δ_A(a=1): does Alice's marginal depend on Bob's setting when Alice uses setting 1?
    const deltaA1 = alice['11'] - alice['12'];
    const seA1 = _deltaStdErr(alice['11'], settingCounts['11'], alice['12'], settingCounts['12']);

    // Δ_A(a=2): same question when Alice uses setting 2
    const deltaA2 = alice['21'] - alice['22'];
    const seA2 = _deltaStdErr(alice['21'], settingCounts['21'], alice['22'], settingCounts['22']);

    // ── Bob deltas ──
    // Δ_B(b=1): does Bob's marginal depend on Alice's setting when Bob uses setting 1?
    const deltaB1 = bob['11'] - bob['21'];
    const seB1 = _deltaStdErr(bob['11'], settingCounts['11'], bob['21'], settingCounts['21']);

    // Δ_B(b=2): same question when Bob uses setting 2
    const deltaB2 = bob['12'] - bob['22'];
    const seB2 = _deltaStdErr(bob['12'], settingCounts['12'], bob['22'], settingCounts['22']);

    // ── Combined magnitude ──
    const magnitude = Math.sqrt(deltaA1**2 + deltaA2**2 + deltaB1**2 + deltaB2**2);

    // ── z-scores (delta / SE) ──
    const zA1 = seA1 > 0 ? deltaA1 / seA1 : 0;
    const zA2 = seA2 > 0 ? deltaA2 / seA2 : 0;
    const zB1 = seB1 > 0 ? deltaB1 / seB1 : 0;
    const zB2 = seB2 > 0 ? deltaB2 / seB2 : 0;

    // ── Chi-squared: sum of z² under null ──
    const chiSq = zA1**2 + zA2**2 + zB1**2 + zB2**2;

    stream.emit({
      type: 'residual',
      data: {
        name,
        N,
        alice: {
          delta1: deltaA1, se1: seA1, z1: zA1,
          delta2: deltaA2, se2: seA2, z2: zA2,
        },
        bob: {
          delta1: deltaB1, se1: seB1, z1: zB1,
          delta2: deltaB2, se2: seB2, z2: zB2,
        },
        deltas: [deltaA1, deltaA2, deltaB1, deltaB2],
        standardErrors: [seA1, seA2, seB1, seB2],
        zScores: [zA1, zA2, zB1, zB2],
        magnitude,
        chiSq,
        marginals: { alice, bob },
        settingCounts,
        tables,
        _permOpts: event.data._permOpts || null,
      },
    });
  }
}


/**
 * Standard error for difference of two independent proportions.
 *
 * SE(p1 - p2) = sqrt( p1(1-p1)/n1 + p2(1-p2)/n2 )
 *
 * @param {number} p1  First proportion
 * @param {number} n1  First sample size
 * @param {number} p2  Second proportion
 * @param {number} n2  Second sample size
 * @returns {number} Standard error
 */
function _deltaStdErr(p1, n1, p2, n2) {
  if (n1 === 0 || n2 === 0) return 0;
  const v1 = p1 * (1 - p1) / n1;
  const v2 = p2 * (1 - p2) / n2;
  return Math.sqrt(v1 + v2);
}
