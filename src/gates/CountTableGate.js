/**
 * CountTableGate — summary data → validated count tables.
 *
 * Signature: 'summary'
 *
 * Accepts an experiment object from summary_counts.js.
 * Validates structure, computes per-setting-pair totals.
 * Emits a 'counts' event with the validated tables and metadata.
 *
 * For streaming large files (Phase 6): this gate would accept
 * individual trial events and increment counters. The output
 * format is identical — four 2×2 tables. 80GB in, eight
 * integers out. The trial is consumed.
 *
 * Stateless. Pure.
 *
 * GPL v3
 */

import { Gate } from './GateBase.js';

export class CountTableGate extends Gate {
  constructor() { super('summary'); }

  transform(event, stream) {
    const exp = event.data;

    // Validate structure
    const required = ['11', '12', '21', '22'];
    for (const ab of required) {
      const t = exp.tables?.[ab];
      if (!t) throw new Error(`Missing table for setting pair (${ab})`);
      if (t.pp == null || t.pm == null || t.mp == null || t.mm == null) {
        throw new Error(`Incomplete table for setting pair (${ab})`);
      }
      if (t.pp < 0 || t.pm < 0 || t.mp < 0 || t.mm < 0) {
        throw new Error(`Negative count in table (${ab})`);
      }
    }

    // Compute per-setting-pair totals
    const settingCounts = {};
    let N = 0;
    for (const ab of required) {
      const t = exp.tables[ab];
      const n = t.pp + t.pm + t.mp + t.mm;
      settingCounts[ab] = n;
      N += n;
    }

    stream.emit({
      type: 'counts',
      data: {
        name: exp.name || '?',
        tables: exp.tables,
        settingCounts,
        N,
        _permOpts: exp._permOpts || null,
      },
    });
  }
}
