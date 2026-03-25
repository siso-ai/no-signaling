# Bell Test No-Signaling Residual Analysis

**SISO Pipeline — Eliminative Search**

## What This Does

Subtracts the no-signaling constraint from Bell test marginal
distributions and examines the residual. Standard quantum mechanics
predicts the residual is zero. The SISO ontology predicts systematic
nonzero residuals from walkers traversing the entangled edge.

## Architecture

Six stateless gates in a stream:

```
→ summary data
  → Gate 1: CountTableGate    (validate, compute totals)
  → Gate 2: MarginalGate      (P(x=+|a,b) for each setting pair)
  → Gate 3: NoSignalingGate   (subtract constraint → four deltas)
  → Gate 4: PermutationGate   (is the residual distinguishable from noise?)
  → Gate 5: BootstrapGate     (confidence intervals on each delta)
  → Gate 6: CrossDatasetGate  (sign consistency across experiments → verdict)
```

Each gate is a pure function. No state. No side effects.
The stream carries everything. `sampleHere()` reads the verdict.

## Data

Six experiments from Gill (2023), arXiv:2209.00702, Appendix A–F:

| Experiment | N | System | Year |
|---|---|---|---|
| Delft (Hensen) | 245 | Diamond NV spins | 2015 |
| Munich (Rosenfeld) | 150 | Trapped Rb atoms | 2017 |
| NIST (Shalm) | 173M | Entangled photons | 2015 |
| Vienna (Giustina) | 3.5B | Entangled photons | 2015 |
| Innsbruck (Weihs) | 14.6K | Entangled photons | 1998 |
| Munich DIQKD (Zhang) | 1,649 | Trapped atoms | 2022 |

## Running

```
node bell/pipeline.js          # full analysis with report
node bell/tests/run_tests.js   # 269 assertions
```

## Results (Summary Data)

### Individual Experiments

| Experiment | p-perm | CIs excl. 0 | Max \|z\| | χ² |
|---|---|---|---|---|
| Delft | 0.885 | 0/4 | 0.75 | 1.19 |
| Munich | 0.661 | 0/4 | 1.27 | 2.55 |
| **NIST** | **0.014** | **1/4** | **2.59** | **10.03** |
| Vienna | 0.194 | 0/4 | 1.44 | 4.83 |
| **Innsbruck** | **0.0001** | **4/4** | **7.90** | **90.85** |
| Zhang | 0.415 | 0/4 | 1.29 | 3.92 |

### NIST Detail

Bob's marginal Δ_B(b=2) — the difference in Bob's detection rate
when Alice uses setting 1 vs setting 2 — has z = −2.59 and a 95%
bootstrap CI of [−2.57e-5, −3.49e-6] which excludes zero. This is
in 173 million trials from a loophole-free photonic Bell test.

### Cross-Dataset (Loophole-Free 2015)

```
Δ_B(b=1): Delft +, NIST +, Vienna +  → 3/3 unanimous
```

Bob's marginal for setting 1 shows the same sign across all three
loophole-free experiments. The other three deltas show 2/3 majority
agreement.

### Verdict

**ISOLATED_SIGNAL** — NIST shows a statistically significant
no-signaling deviation (p = 0.014, CI excludes zero on one delta).
Cross-dataset sign consistency is majority but not unanimous.
The weighted combined χ² = 4.99 (4 df) does not reach the p < 0.05
threshold of 9.49.

### Interpretation

Under standard QM: the NIST deviation is a ~2.6σ fluctuation or
an instrumental systematic (e.g., time-correlated RNG drift, as
Gill suggests). Innsbruck's massive deviations are explained by
the known detection loophole and RNG problems.

Under SISO: the NIST deviation is the first evidence of walkers
traversing the entangled edge, visible as a marginal dependence
on the remote setting. The signal is real but weak — consistent
with low edge bandwidth. The sign consistency on Δ_B(b=1) across
all three 2015 experiments (3/3) is unexplained by noise.

### What Would Resolve It

1. **NIST event-level analysis** (Phase 6): the open data contains
   multiple runs with different configurations. Time-windowed
   analysis would distinguish instrumental drift from a persistent
   signal. If the Δ_B(b=2) deviation is stable across 10-minute
   windows within a run, it's not drift.

2. **Dose-response** (Phase 7): if the deviation magnitude
   correlates with entanglement quality across NIST runs, that's
   a prediction of SISO that noise cannot produce.

## License

GPL v3

---

*Jonathan Bailey / Timothy Daniels — SISO Architecture*
