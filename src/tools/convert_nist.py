#!/usr/bin/env python3
"""
convert_nist.py — Convert NIST Bell test HDF5 to flat binary.

Reads HDF5 in chunks of 1M trials. ~16 MB memory regardless of file size.

Filters by laser pulse number to match the published analysis.
The HDF5 contains all ~15 pulse slots per Pockels cell window.
The published paper uses a subset. This script auto-detects the
right filter by matching Gill's published total (~173M).

Binary format: 4 uint8 per trial [setting_a, setting_b, outcome_a, outcome_b]

Usage:
    pip install h5py numpy
    python3 bell/tools/convert_nist.py <hdf5_path> [output_dir]
    python3 bell/tools/convert_nist.py --explore <hdf5_path>

GPL v3
"""

import sys, os, json, time

try:
    import h5py
    import numpy as np
except ImportError:
    print("ERROR: h5py and numpy required.\n  pip install h5py numpy")
    sys.exit(1)

CHUNK = 1_000_000
GILL_NIST_TOTAL = 173_149_423


def explore_hdf5(path):
    print(f"HDF5 structure of: {path}")
    print("=" * 60)
    def visitor(name, obj):
        if isinstance(obj, h5py.Dataset):
            print(f"  DATASET: {name}  shape={obj.shape}  dtype={obj.dtype}")
        elif isinstance(obj, h5py.Group):
            print(f"  GROUP:   {name}/")
            for key, val in obj.attrs.items():
                print(f"           @{key} = {val}")
    with h5py.File(path, 'r') as f:
        print(f"  Root attrs: {list(f.attrs.keys())}")
        f.visititems(visitor)
    print("=" * 60)


def detect_pulse_filter(f, n_total):
    alice_pn = f['alice/laserpulsenumber']
    sample_size = min(1_000_000, n_total)
    apn_sample = alice_pn[:sample_size]
    unique_vals = np.unique(apn_sample)
    print(f"  Pulse numbers found: {unique_vals}")
    print(f"  Min={unique_vals.min()}, Max={unique_vals.max()}, Count={len(unique_vals)}")

    print(f"\n  Trials per pulse (sampled):")
    for pv in unique_vals:
        cnt = int(np.sum(apn_sample == pv))
        print(f"    pulse {pv:2d}: {cnt:>8,}  ({cnt/sample_size*100:.1f}%)")

    # Try all contiguous windows centered on each value
    best_name = None
    best_pulses = None
    best_diff = float('inf')
    seen = set()

    for center in range(int(unique_vals.min()), int(unique_vals.max()) + 1):
        for half in range(0, 8):
            pulses = [p for p in range(center - half, center + half + 1) if p in set(unique_vals)]
            if len(pulses) != 2 * half + 1:
                continue
            key = tuple(pulses)
            if key in seen:
                continue
            seen.add(key)

            mask = np.isin(apn_sample, pulses)
            est = int(np.sum(mask)) / sample_size * n_total
            diff = abs(est - GILL_NIST_TOTAL) / GILL_NIST_TOTAL

            if diff < 0.02:
                name = f"{len(pulses)}-pulse ({pulses[0]}-{pulses[-1]})"
                print(f"    MATCH: {name:25s}  est={est/1e6:.1f}M  ({diff*100:.1f}% off)")
                if diff < best_diff:
                    best_diff = diff
                    best_name = name
                    best_pulses = pulses

    if best_diff > 0.10:
        print(f"\n  WARNING: No good pulse filter found ({best_diff*100:.1f}% off)")
        print(f"  Using all pulses.")
        return None, "all"

    print(f"\n  Selected: {best_name} ({best_diff*100:.1f}% off Gill)")
    return best_pulses, best_name


def convert(hdf5_path, output_dir=None):
    if output_dir is None:
        output_dir = os.path.dirname(hdf5_path) or '.'
    os.makedirs(output_dir, exist_ok=True)

    basename = os.path.basename(hdf5_path)
    for ext in ['.hdf5', '.build', '.compressed', '.dat']:
        if basename.endswith(ext):
            basename = basename[:-len(ext)]
    basename = basename.strip('.') or 'nist_data'

    bin_path = os.path.join(output_dir, basename + '.bin')
    json_path = os.path.join(output_dir, basename + '.json')

    print(f"Input:  {hdf5_path}")
    print(f"Output: {bin_path}")
    print(f"Chunk:  {CHUNK:,}\n")

    t_start = time.time()

    with h5py.File(hdf5_path, 'r') as f:
        for ds in ['alice/settings', 'bob/settings', 'alice/clicks', 'bob/clicks']:
            if ds not in f:
                print(f"ERROR: '{ds}' not found")
                sys.exit(1)

        alice_set = f['alice/settings']
        bob_set   = f['bob/settings']
        alice_clk = f['alice/clicks']
        bob_clk   = f['bob/clicks']
        n_total   = alice_set.shape[0]
        print(f"Total events: {n_total:,}")

        # Pulse filter
        has_pulse = 'alice/laserpulsenumber' in f
        pulse_filter = None
        pulse_name = "none"

        if has_pulse and n_total > GILL_NIST_TOTAL * 1.5:
            print(f"\nDetecting pulse filter...\n")
            pulse_filter, pulse_name = detect_pulse_filter(f, n_total)

        alice_pn = f['alice/laserpulsenumber'] if has_pulse and pulse_filter else None

        # Settings encoding
        sa_peek = np.unique(alice_set[:100000])
        sb_peek = np.unique(bob_set[:100000])
        print(f"\nAlice settings: {sa_peek}")
        print(f"Bob settings:   {sb_peek}")

        off_a = -1 if set(sa_peek).issubset({1, 2}) else 0
        off_b = -1 if set(sb_peek).issubset({1, 2}) else 0
        if off_a: print("Alice settings 1/2 -> 0/1")
        if off_b: print("Bob settings 1/2 -> 0/1")
        print()

        counts = {f"{a+1}{b+1}": {'pp':0,'pm':0,'mp':0,'mm':0} for a in [0,1] for b in [0,1]}
        total_det_a = 0
        total_det_b = 0
        n_written = 0

        with open(bin_path, 'wb') as out:
            for start in range(0, n_total, CHUNK):
                end = min(start + CHUNK, n_total)

                sa = alice_set[start:end].astype(np.int8)
                sb = bob_set[start:end].astype(np.int8)
                ca = alice_clk[start:end]
                cb = bob_clk[start:end]

                if pulse_filter is not None:
                    apn = alice_pn[start:end]
                    mask = np.isin(apn, pulse_filter)
                    sa, sb, ca, cb = sa[mask], sb[mask], ca[mask], cb[mask]

                if len(sa) == 0:
                    continue

                if off_a: sa = sa + off_a
                if off_b: sb = sb + off_b
                sa = np.clip(sa, 0, 1).astype(np.uint8)
                sb = np.clip(sb, 0, 1).astype(np.uint8)

                oa = (ca > 0).astype(np.uint8)
                ob = (cb > 0).astype(np.uint8)

                total_det_a += int(np.sum(oa))
                total_det_b += int(np.sum(ob))

                for a in [0, 1]:
                    for b in [0, 1]:
                        m = (sa == a) & (sb == b)
                        k = f"{a+1}{b+1}"
                        counts[k]['pp'] += int(np.sum(m & (oa==1) & (ob==1)))
                        counts[k]['pm'] += int(np.sum(m & (oa==1) & (ob==0)))
                        counts[k]['mp'] += int(np.sum(m & (oa==0) & (ob==1)))
                        counts[k]['mm'] += int(np.sum(m & (oa==0) & (ob==0)))

                out.write(np.column_stack([sa, sb, oa, ob]).tobytes())
                n_written += len(sa)

                pct = end / n_total * 100
                el = time.time() - t_start
                rate = end / el if el > 0 else 0
                eta = (n_total - end) / rate if rate > 0 else 0
                print(f"  {pct:5.1f}%  {end:>12,}/{n_total:,}  "
                      f"kept={n_written:,}  ({rate/1e6:.1f}M/s ETA {eta:.0f}s)", flush=True)

    elapsed = time.time() - t_start
    bin_size = os.path.getsize(bin_path)

    print(f"\nBinary: {bin_path}")
    print(f"  Trials: {n_written:,}  Size: {bin_size/1e6:.1f} MB  Time: {elapsed:.1f}s")
    if pulse_filter:
        print(f"  Filter: {pulse_name}  ({n_total:,} -> {n_written:,}, {n_written/n_total*100:.1f}%)")

    for k in counts:
        t = counts[k]
        t['total'] = t['pp'] + t['pm'] + t['mp'] + t['mm']
    total_counted = sum(counts[k]['total'] for k in counts)
    assert total_counted == n_written

    gill_match = abs(n_written - GILL_NIST_TOTAL) / GILL_NIST_TOTAL < 0.05
    print(f"\n  {'MATCH' if gill_match else 'MISMATCH'}: {n_written:,} vs Gill {GILL_NIST_TOTAL:,} "
          f"({abs(n_written-GILL_NIST_TOTAL)/GILL_NIST_TOTAL*100:.1f}% off)")

    print()
    for k in sorted(counts):
        t = counts[k]
        print(f"  ({k[0]},{k[1]}): n={t['total']:>12,}  dd={t['pp']:>8,}  dn={t['pm']:>8,}  nd={t['mp']:>8,}  nn={t['mm']:>12,}")

    det_a = total_det_a / n_written
    det_b = total_det_b / n_written
    print(f"\n  Detection: alice={det_a:.8f}  bob={det_b:.8f}")

    def rho(k):
        t = counts[k]
        n = t['total']
        return (t['pp'] + t['mm'] - t['pm'] - t['mp']) / n if n else 0

    S = rho('11') + rho('12') + rho('21') - rho('22')
    print(f"  CHSH S = {S:.6f}  (S-2 = {S-2:.6f})  Bell: {'YES' if S>2 else 'NO'}")

    # Compare to Gill
    gill = {
        '11': {'pp':6378,'pm':3282,'mp':3189,'mm':43897356},
        '12': {'pp':6794,'pm':2821,'mp':23243,'mm':43276943},
        '21': {'pp':6486,'pm':21334,'mp':2843,'mm':43338281},
        '22': {'pp':106,'pm':27539,'mp':30040,'mm':42502788},
    }
    print(f"\n  vs Gill:")
    for k in sorted(gill):
        g, m = gill[k], counts[k]
        close = all(abs(m[c]-g[c])/max(g[c],1) < 0.1 for c in ['pp','pm','mp'])
        print(f"    ({k[0]},{k[1]}): {'close' if close else 'DIFFERS'}")
        if not close:
            for c in ['pp','pm','mp','mm']:
                print(f"      {c}: ours={m[c]:,}  gill={g[c]:,}  diff={m[c]-g[c]:+,}")

    meta = {
        'source': os.path.basename(hdf5_path),
        'n_trials': n_written,
        'n_total_events': n_total,
        'format': '4 x uint8: [sa, sb, oa, ob]',
        'stride': 4,
        'pulse_filter': pulse_name,
        'filter_pulses': pulse_filter,
        'counts': counts,
        'detection_rate_alice': det_a,
        'detection_rate_bob': det_b,
        'chsh_S': S,
        'bin_file': os.path.basename(bin_path),
        'time_s': round(elapsed, 1),
    }
    with open(json_path, 'w') as jf:
        json.dump(meta, jf, indent=2)
    print(f"\n  Metadata: {json_path}")
    print("Done.")
    return meta


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 bell/tools/convert_nist.py <hdf5_path> [output_dir]")
        print("       python3 bell/tools/convert_nist.py --explore <hdf5_path>")
        sys.exit(1)
    if sys.argv[1] == '--explore':
        explore_hdf5(sys.argv[2])
    else:
        convert(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
