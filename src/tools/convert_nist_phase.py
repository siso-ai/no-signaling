# -*- coding: utf-8 -*-
"""
convert_nist_phase.py - Phase-filtered converter for NIST Bell test data.

Memory budget: ~1.5GB peak
  - Outcome arrays: 356M x 2 = 712MB
  - Detection data: 17M x 3 arrays = ~200MB (freed after building outcomes)
  - Settings: read in 1M chunks = ~2MB at a time

Fits in 4GB RAM.
"""

import sys, os, json, time
import numpy as np
import h5py

CHUNK = 1_000_000

GILL_COUNTS = {
    '11': {'pp': 6378, 'pm': 3282, 'mp': 3189, 'mm': 43897356},
    '12': {'pp': 6794, 'pm': 2821, 'mp': 23243, 'mm': 43276943},
    '21': {'pp': 6486, 'pm': 21334, 'mp': 2843, 'mm': 43338281},
    '22': {'pp': 106, 'pm': 27539, 'mp': 30040, 'mm': 42502788},
}


def build_outcomes(f, slots=None):
    """Build outcome arrays from detection-level data. Returns (a_outcome, b_outcome, n_trials)."""
    n_trials = f['alice/settings'].shape[0]
    a_pk = int(f['config/alice/pk'][()])
    a_radius = int(f['config/alice/radius'][()])
    b_pk = int(f['config/bob/pk'][()])
    b_radius = int(f['config/bob/radius'][()])
    a_offset = int(f['config/alice/bitoffset'][()])
    b_offset = int(f['config/bob/bitoffset'][()])

    if slots is None:
        slots = list(range(16))
    slot_set = set(slots)

    print("Config: alice pk=%d r=%d off=%d, bob pk=%d r=%d off=%d" % (
        a_pk, a_radius, a_offset, b_pk, b_radius, b_offset))
    print("Slots: %s" % slots)
    print("Timing windows: alice [%d,%d], bob [%d,%d]" % (
        a_pk - a_radius, a_pk + a_radius, b_pk - b_radius, b_pk + b_radius))

    # Load alice detection data, filter, build outcome, free
    print("\nProcessing alice detections...")
    a_sn = f['alice/syncNumber'][:]
    a_phase = f['alice/phase'][:]
    a_pn = f['alice/laserPulseNumber'][:]
    print("  Loaded %s detections" % format(len(a_sn), ','))

    a_slot = a_pn.astype(np.int32) - a_offset
    a_good = (np.abs(a_phase - a_pk) <= a_radius)
    # Slot filter using vectorized operation
    a_slot_ok = np.zeros(len(a_slot), dtype=bool)
    for s in slot_set:
        a_slot_ok |= (a_slot == s)
    a_good &= a_slot_ok

    n_a_good = int(np.sum(a_good))
    print("  After timing+slot filter: %s" % format(n_a_good, ','))

    a_outcome = np.zeros(n_trials, dtype=np.uint8)
    a_outcome[a_sn[a_good]] = 1
    n_a_det = int(np.sum(a_outcome))
    print("  Trials with detection: %s" % format(n_a_det, ','))

    del a_sn, a_phase, a_pn, a_slot, a_good, a_slot_ok

    # Load bob detection data, filter, build outcome, free
    print("\nProcessing bob detections...")
    b_sn = f['bob/syncNumber'][:]
    b_phase = f['bob/phase'][:]
    b_pn = f['bob/laserPulseNumber'][:]
    print("  Loaded %s detections" % format(len(b_sn), ','))

    b_slot = b_pn.astype(np.int32) - b_offset
    b_good = (np.abs(b_phase - b_pk) <= b_radius)
    b_slot_ok = np.zeros(len(b_slot), dtype=bool)
    for s in slot_set:
        b_slot_ok |= (b_slot == s)
    b_good &= b_slot_ok

    n_b_good = int(np.sum(b_good))
    print("  After timing+slot filter: %s" % format(n_b_good, ','))

    b_outcome = np.zeros(n_trials, dtype=np.uint8)
    b_outcome[b_sn[b_good]] = 1
    n_b_det = int(np.sum(b_outcome))
    print("  Trials with detection: %s" % format(n_b_det, ','))

    del b_sn, b_phase, b_pn, b_slot, b_good, b_slot_ok

    return a_outcome, b_outcome, n_trials, n_a_det, n_b_det


def count_tables_chunked(f, a_outcome, b_outcome, n_trials):
    """Compute count tables by streaming settings in chunks."""
    counts = {"%d%d" % (a+1, b+1): {'pp':0,'pm':0,'mp':0,'mm':0} for a in [0,1] for b in [0,1]}

    for start in range(0, n_trials, CHUNK):
        end = min(start + CHUNK, n_trials)
        sa = f['alice/settings'][start:end].astype(np.int8)
        sb = f['bob/settings'][start:end].astype(np.int8)
        if sa.max() <= 2 and sa.min() >= 1:
            sa -= 1; sb -= 1
        sa = np.clip(sa, 0, 1).astype(np.uint8)
        sb = np.clip(sb, 0, 1).astype(np.uint8)
        oa = a_outcome[start:end]
        ob = b_outcome[start:end]

        for a in [0, 1]:
            for b in [0, 1]:
                m = (sa == a) & (sb == b)
                k = "%d%d" % (a + 1, b + 1)
                counts[k]['pp'] += int(np.sum(m & (oa == 1) & (ob == 1)))
                counts[k]['pm'] += int(np.sum(m & (oa == 1) & (ob == 0)))
                counts[k]['mp'] += int(np.sum(m & (oa == 0) & (ob == 1)))
                counts[k]['mm'] += int(np.sum(m & (oa == 0) & (ob == 0)))

    for k in counts:
        t = counts[k]
        t['total'] = t['pp'] + t['pm'] + t['mp'] + t['mm']

    return counts


def compute_S(counts):
    def rho(k):
        t = counts[k]
        n = t['total']
        return (t['pp'] + t['mm'] - t['pm'] - t['mp']) / n if n else 0
    return rho('11') + rho('12') + rho('21') - rho('22')


def gill_score(counts):
    score = 0
    for k in GILL_COUNTS:
        g = GILL_COUNTS[k]
        c = counts[k]
        for field in ['pp', 'pm', 'mp']:
            if g[field] > 0:
                score += abs(c[field] - g[field]) / g[field]
    return score / 12


def print_comparison(counts):
    S = compute_S(counts)
    gs = gill_score(counts)
    total = sum(v['total'] for v in counts.values())
    print("  Trials: %s" % format(total, ','))
    print("  S = %.6f (Gill: 2.000092)" % S)
    print("  Gill score: %.4f" % gs)
    print("")
    for k in sorted(counts):
        c = counts[k]
        g = GILL_COUNTS[k]
        print("  (%s,%s):" % (k[0], k[1]))
        for field in ['pp', 'pm', 'mp', 'mm']:
            diff = c[field] - g[field]
            pct = abs(diff) / max(g[field], 1) * 100
            status = 'OK' if pct < 5 else '~' if pct < 15 else 'X'
            print("    %s: %10s  gill: %10s  diff: %+10s (%5.1f%%) %s" % (
                field, format(c[field], ','), format(g[field], ','),
                format(diff, ','), pct, status))


def scan(hdf5_path):
    """Scan with phase filter, show count tables."""
    print("Scanning: %s\n" % hdf5_path)
    t0 = time.time()

    with h5py.File(hdf5_path, 'r') as f:
        # All 16 slots
        print("=== All 16 Pockels slots, phase filtered ===\n")
        a_out, b_out, n_trials, n_a, n_b = build_outcomes(f, slots=None)
        counts_all = count_tables_chunked(f, a_out, b_out, n_trials)
        print("")
        print_comparison(counts_all)

        # Key groupings
        for name, slots in [
            ("3-pulse [5,6,7]", [5, 6, 7]),
            ("5-pulse [4,5,6,7,8]", [4, 5, 6, 7, 8]),
            ("7-pulse [3,4,5,6,7,8,9]", [3, 4, 5, 6, 7, 8, 9]),
            ("Middle [6,7,8,9]", [6, 7, 8, 9]),
            ("Edge [0,1,14,15]", [0, 1, 14, 15]),
        ]:
            print("\n=== %s ===\n" % name)
            a_out2, b_out2, _, _, _ = build_outcomes(f, slots=slots)
            counts2 = count_tables_chunked(f, a_out2, b_out2, n_trials)
            print("")
            print_comparison(counts2)
            del a_out2, b_out2

    print("\nTotal time: %.1fs" % (time.time() - t0))


def convert(hdf5_path, slots=None, output_dir=None):
    """Convert with phase filter, write binary."""
    if output_dir is None:
        output_dir = os.path.dirname(hdf5_path) or '.'
    os.makedirs(output_dir, exist_ok=True)

    if slots is None:
        slots = list(range(16))
        slot_tag = "phase_all"
    else:
        slot_tag = "phase_s" + '_'.join(str(s) for s in slots)

    basename = os.path.basename(hdf5_path)
    for ext in ['.hdf5', '.build', '.compressed', '.dat']:
        if basename.endswith(ext):
            basename = basename[:-len(ext)]
    basename = basename.strip('.') or 'nist_data'

    bin_path = os.path.join(output_dir, "%s.%s.bin" % (basename, slot_tag))
    json_path = os.path.join(output_dir, "%s.%s.json" % (basename, slot_tag))

    print("Input:   %s" % hdf5_path)
    print("Output:  %s" % bin_path)
    print("Slots:   %s\n" % slots)

    t0 = time.time()

    with h5py.File(hdf5_path, 'r') as f:
        a_outcome, b_outcome, n_trials, n_a, n_b = build_outcomes(f, slots)

        # Write binary and compute counts in one chunked pass
        print("\nWriting binary...")
        counts = {"%d%d" % (a+1, b+1): {'pp':0,'pm':0,'mp':0,'mm':0} for a in [0,1] for b in [0,1]}

        with open(bin_path, 'wb') as out:
            for start in range(0, n_trials, CHUNK):
                end = min(start + CHUNK, n_trials)
                sa = f['alice/settings'][start:end].astype(np.int8)
                sb = f['bob/settings'][start:end].astype(np.int8)
                if sa.max() <= 2 and sa.min() >= 1:
                    sa -= 1; sb -= 1
                sa = np.clip(sa, 0, 1).astype(np.uint8)
                sb = np.clip(sb, 0, 1).astype(np.uint8)
                oa = a_outcome[start:end]
                ob = b_outcome[start:end]

                for a in [0, 1]:
                    for b in [0, 1]:
                        m = (sa == a) & (sb == b)
                        k = "%d%d" % (a + 1, b + 1)
                        counts[k]['pp'] += int(np.sum(m & (oa == 1) & (ob == 1)))
                        counts[k]['pm'] += int(np.sum(m & (oa == 1) & (ob == 0)))
                        counts[k]['mp'] += int(np.sum(m & (oa == 0) & (ob == 1)))
                        counts[k]['mm'] += int(np.sum(m & (oa == 0) & (ob == 0)))

                out.write(np.column_stack([sa, sb, oa, ob]).tobytes())

                pct = end / n_trials * 100
                if end % (CHUNK * 50) == 0 or end == n_trials:
                    print("  %.1f%%" % pct, flush=True)

    elapsed = time.time() - t0

    for k in counts:
        t = counts[k]
        t['total'] = t['pp'] + t['pm'] + t['mp'] + t['mm']

    S = compute_S(counts)
    total = sum(v['total'] for v in counts.values())

    print("\n" + "=" * 60)
    print("  Slots: %s" % slots)
    print("  Trials: %s" % format(total, ','))
    print("  S: %.6f" % S)
    print("  Time: %.1fs" % elapsed)
    print("")
    print_comparison(counts)

    meta = {
        'source': os.path.basename(hdf5_path),
        'n_trials': total, 'slots': slots,
        'phase_filter': True,
        'format': '4 x uint8: [sa, sb, oa, ob]', 'stride': 4,
        'counts': counts, 'chsh_S': S,
        'detection_rate_alice': n_a / total,
        'detection_rate_bob': n_b / total,
        'bin_file': os.path.basename(bin_path), 'time_s': round(elapsed, 1),
    }
    with open(json_path, 'w') as jf:
        json.dump(meta, jf, indent=2)
    print("\n  Metadata: %s" % json_path)
    print("Done.")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 convert_nist_phase.py --scan <hdf5>")
        print("  python3 convert_nist_phase.py --convert <hdf5> [outdir]")
        print("  python3 convert_nist_phase.py --convert --slots 4,5,6,7,8 <hdf5> [outdir]")
        sys.exit(1)

    if sys.argv[1] == '--scan':
        scan(sys.argv[2])
    elif sys.argv[1] == '--convert':
        slots = None
        hdf5_idx = 2
        if sys.argv[2] == '--slots':
            slots = [int(x) for x in sys.argv[3].split(',')]
            hdf5_idx = 4
        hdf5 = sys.argv[hdf5_idx]
        outdir = sys.argv[hdf5_idx + 1] if len(sys.argv) > hdf5_idx + 1 else None
        convert(hdf5, slots, outdir)
    else:
        print("Unknown: %s" % sys.argv[1])
