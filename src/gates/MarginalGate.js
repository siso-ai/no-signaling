/**
 * MarginalGate — count tables → marginal probabilities.
 *
 * Signature: 'counts'
 *
 * From each 2×2 table, compute:
 *   Alice's marginal: P(x=+|a,b) = (pp + pm) / N_ab
 *   Bob's marginal:   P(y=+|a,b) = (pp + mp) / N_ab
 *
 * Emits a 'marginals' event with all eight marginal values
 * (four for Alice, four for Bob) plus the count data.
 *
 * Stateless. Pure.
 *
 * GPL v3
 */

import { Gate } from './GateBase.js';

export class MarginalGate extends Gate {
  constructor() { super('counts'); }

  transform(event, stream) {
    const { name, tables, settingCounts, N } = event.data;

    // Alice's marginal P(x=+|a,b) for each (a,b)
    // Keyed as "ab" → probability
    const alice = {};
    const bob = {};

    for (const ab of ['11', '12', '21', '22']) {
      const t = tables[ab];
      const n = settingCounts[ab];
      if (n === 0) {
        alice[ab] = 0;
        bob[ab] = 0;
        continue;
      }

      // Alice's outcome +: she got + regardless of Bob's outcome
      alice[ab] = (t.pp + t.pm) / n;

      // Bob's outcome +: he got + regardless of Alice's outcome
      bob[ab] = (t.pp + t.mp) / n;
    }

    stream.emit({
      type: 'marginals',
      data: {
        name,
        alice,
        bob,
        tables,
        settingCounts,
        N,
        _permOpts: event.data._permOpts || null,
      },
    });
  }
}
