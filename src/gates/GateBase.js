/**
 * Gate — a pure transform with a signature.
 *
 * The signature is a unique key. The stream uses it
 * for O(1) dispatch. Gates are stateless.
 *
 * This is the shape of the arrow in →E→E→.
 *
 * GPL v3
 */

export class Gate {
  constructor(signature) {
    this.signature = signature;
  }

  transform(event, stream) {
    // Override in subclass.
  }
}
