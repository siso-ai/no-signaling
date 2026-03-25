/**
 * Stream — the processing loop.
 *
 * Gates register by signature. Events arrive via emit().
 * If a gate claims it, transform runs immediately.
 * If nothing claims it, the event lands in pending.
 *
 * This is →E→E→.
 *
 * GPL v3
 */

export class Stream {
  constructor() {
    this.gates = new Map();
    this.pending = [];
    this.eventCount = 0;
  }

  register(gate) {
    if (this.gates.has(gate.signature)) {
      throw new Error(`Signature collision: '${gate.signature}'`);
    }
    this.gates.set(gate.signature, gate);
  }

  emit(event) {
    this.eventCount++;
    const gate = this.gates.get(event.type);
    if (gate) {
      gate.transform(event, this);
    } else {
      this.pending.push(event);
    }
  }

  sampleHere() {
    return {
      pending: [...this.pending],
      eventCount: this.eventCount,
      gateCount: this.gates.size,
    };
  }
}
