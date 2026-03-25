#!/usr/bin/env python3
"""
convert_nist_pulsegroup.py — Proper pulse-group selection via syncNumber mapping.

The HDF5 has two data levels:
  Trial level (356M):     settings, clicks (one per sync)
  Detection level (~17M): syncNumber, laserPulseNumber (one per photon click)

The laserPulseNumber ranges 0-800. The Pockels cell window is a 16-pulse
region with elevated detection rates:
  Alice: pulses 28-43 (config bitoffset=28)
  Bob:   pulses 37-52 (config bitoffset=37)

The click bitmask bits 0-15 correspond to these 16 Pockels cell slots.
The published analysis uses specific subsets of these 16 slots.

This converter:
1. Loads detection-level data (17M entries, fits in memory)
2. For a given pulse group (specified as Pockels window slot indices),
   builds a set of sync numbers that had detections in those slots
3. Streams settings in chunks, writes binary with outcomes based on
   whether each trial's sync had a detection in the selected slots

Usage:
    python3 convert_nist_pulsegroup.py --scan <hdf5>
    python3 convert_nist_pulsegroup.py --slots 4,5,6,7,8 <hdf5> [outdir]

Slots are 0-15 within the Pockels cell window (0 = first slot = bitoffset pulse).

GPL v3
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
GILL_TOTAL = 173149423


def scan(hdf5_path):
    """Show Pockels window structure and test all slot groupings."""
    print(f"Scanning: {hdf5_path}\n")

    with h5py.File(hdf5_path, 'r') as f:
        n_trials = f['alice/settings'].shape[0]

        # Config
        a_offset = int(f['config/alice/bitoffset'][()])
        b_offset = int(f['config/bob/bitoffset'][()])
        a_pk = int(f['config/alice/pk'][()])
        b_pk = int(f['config/bob/pk'][()])
        a_radius = int(f['config/alice/radius'][()])
        b_radius = int(f['config/bob/radius'][()])

        print(f"Trials: {n_trials:,}")
        print(f"Alice: bitoffset={a_offset}, pk={a_pk}, radius={a_radius}")
        print(f"  Pockels window: laser pulses {a_offset} to {a_offset+15}")
        print(f"Bob:   bitoffset={b_offset}, pk={b_pk}, radius={b_radius}")
        print(f"  Pockels window: laser pulses {b_offset} to {b_offset+15}")

        # Load detection-level data
        print(f"\nLoading detection data...")
        a_sn = f['alice/syncNumber'][:]
        a_pn = f['alice/laserPulseNumber'][:]
        b_sn = f['bob/syncNumber'][:]
        b_pn = f['bob/laserPulseNumber'][:]
        print(f"  Alice: {len(a_sn):,} detections")
        print(f"  Bob:   {len(b_sn):,} detections")

        # Map laser pulse numbers to Pockels window slots
        # Slot = laserPulseNumber - bitoffset (0-15 if in window, else outside)
        a_slot = a_pn.astype(np.int32) - a_offset
        b_slot = b_pn.astype(np.int32) - b_offset

        # Count detections per slot (0-15 = in window, others = background)
        print(f"\nAlice detections per Pockels window slot:")
        for s in range(16):
            cnt = int(np.sum(a_slot == s))
            pulse = a_offset + s
            print(f"  slot {s:2d} (pulse {pulse:3d}): {cnt:>8,}")
        a_bg = int(np.sum((a_slot < 0) | (a_slot > 15)))
        print(f"  background:           {a_bg:>8,}")

        print(f"\nBob detections per Pockels window slot:")
        for s in range(16):
            cnt = int(np.sum(b_slot == s))
            pulse = b_offset + s
            print(f"  slot {s:2d} (pulse {pulse:3d}): {cnt:>8,}")
        b_bg = int(np.sum((b_slot < 0) | (b_slot > 15)))
        print(f"  background:           {b_bg:>8,}")

        # Load settings (sample for speed)
        print(f"\nLoading settings...")
        sa_all = f['alice/settings'][:].astype(np.int8)
        sb_all = f['bob/settings'][:].astype(np.int8)
        if sa_all.max() <= 2 and sa_all.min() >= 1:
            sa_all -= 1
            sb_all -= 1

        # Test all contiguous slot groupings
        print(f"\n{'='*80}")
        print(f"Testing all contiguous slot groupings against Gill's counts")
        print(f"{'='*80}")
        print(f"{'Slots':20s} {'Total':>12s} {'dd(11)':>8s} {'dd(22)':>8s} {'S':>10s} {'Gill score':>10s}")
        print(f"{'-'*80}")

        results = []
        for width in range(1, 17):
            for start in range(17 - width):
                slots = list(range(start, start + width))

                # Build outcome arrays from detection-level data
                a_out = np.zeros(n_trials, dtype=np.uint8)
                b_out = np.zeros(n_trials, dtype=np.uint8)

                a_in = (a_slot >= start) & (a_slot < start + width)
                a_out[a_sn[a_in]] = 1

                b_in = (b_slot >= start) & (b_slot < start + width)
                b_out[b_sn[b_in]] = 1

                # Count tables
                counts = {}
                for a in [0, 1]:
                    for b in [0, 1]:
                        m = (sa_all == a) & (sb_all == b)
                        k = f"{a+1}{b+1}"
                        counts[k] = {
                            'pp': int(np.sum(m & (a_out==1) & (b_out==1))),
                            'pm': int(np.sum(m & (a_out==1) & (b_out==0))),
                            'mp': int(np.sum(m & (a_out==0) & (b_out==1))),
                            'mm': int(np.sum(m & (a_out==0) & (b_out==0))),
                        }
                        counts[k]['total'] = sum(counts[k].values())

                total = sum(v['total'] for v in counts.values())

                def rho(k):
                    t = counts[k]
                    n = t['total']
                    return (t['pp'] + t['mm'] - t['pm'] - t['mp']) / n if n else 0

                S = rho('11') + rho('12') + rho('21') - rho('22')

                # Score against Gill
                score = 0
                for k in GILL_COUNTS:
                    g = GILL_COUNTS[k]
                    c = counts[k]
                    for field in ['pp', 'pm', 'mp']:
                        if g[field] > 0:
                            score += abs(c[field] - g[field]) / g[field]
                score /= 12

                label = ','.join(str(s) for s in slots)
                marker = ' ← MATCH' if score < 0.05 else ' ← close' if score < 0.15 else ''
                print(f"  [{label:16s}] {total:>12,} {counts['11']['pp']:>8,} {counts['22']['pp']:>8,} {S:>10.6f} {score:>9.3f}{marker}")

                results.append({
                    'slots': slots, 'counts': counts, 'S': S,
                    'gill_score': score, 'total': total,
                })

        results.sort(key=lambda r: r['gill_score'])
        best = results[0]
        print(f"\nBest Gill match: slots {best['slots']} (score={best['gill_score']:.4f}, S={best['S']:.6f})")

        # Detailed comparison for best
        print(f"\n  Detailed count comparison:")
        for k in sorted(best['counts']):
            c = best['counts'][k]
            g = GILL_COUNTS[k]
            print(f"    ({k[0]},{k[1]}):")
            for field in ['pp', 'pm', 'mp', 'mm']:
                diff = c[field] - g[field]
                pct = abs(diff) / max(g[field], 1) * 100
                match = '✓' if pct < 5 else '~' if pct < 15 else '✗'
                print(f"      {field}: {c[field]:>10,}  gill: {g[field]:>10,}  diff: {diff:>+10,} ({pct:.1f}%) {match}")

        print(f"\nTo convert with best match:")
        print(f"  python3 convert_nist_pulsegroup.py --slots {','.join(str(s) for s in best['slots'])} {hdf5_path}")

        # Also show middle slots vs edge slots (SISO test)
        print(f"\n{'='*80}")
        print(f"SISO spacelike separation test")
        print(f"{'='*80}")
        mid = [r for r in results if r['slots'] == list(range(5, 12))][0] if any(r['slots'] == list(range(5, 12)) for r in results) else None
        edge = [r for r in results if r['slots'] == [0, 1, 14, 15]][0] if any(r['slots'] == [0, 1, 14, 15] for r in results) else None
        if mid:
            print(f"  Middle slots [5-11]: S={mid['S']:.6f}, Gill score={mid['gill_score']:.3f}")
        if edge:
            print(f"  Edge slots [0,1,14,15]: S={edge['S']:.6f}, Gill score={edge['gill_score']:.3f}")


def convert(hdf5_path, slots, output_dir=None):
    """Convert using proper syncNumber-based pulse-group selection."""
    if output_dir is None:
        output_dir = os.path.dirname(hdf5_path) or '.'
    os.makedirs(output_dir, exist_ok=True)

    slot_tag = 's' + '_'.join(str(s) for s in slots)
    basename = os.path.basename(hdf5_path)
    for ext in ['.hdf5', '.build', '.compressed', '.dat']:
        if basename.endswith(ext):
            basename = basename[:-len(ext)]
    basename = basename.strip('.') or 'nist_data'

    bin_path = os.path.join(output_dir, f"{basename}.{slot_tag}.bin")
    json_path = os.path.join(output_dir, f"{basename}.{slot_tag}.json")

    print(f"Input:   {hdf5_path}")
    print(f"Output:  {bin_path}")
    print(f"Slots:   {slots}\n")

    t0 = time.time()

    with h5py.File(hdf5_path, 'r') as f:
        n_trials = f['alice/settings'].shape[0]
        a_offset = int(f['config/alice/bitoffset'][()])
        b_offset = int(f['config/bob/bitoffset'][()])

        # Load detection-level data
        print("Loading detection data...")
        a_sn = f['alice/syncNumber'][:]
        a_pn = f['alice/laserPulseNumber'][:]
        b_sn = f['bob/syncNumber'][:]
        b_pn = f['bob/laserPulseNumber'][:]

        # Map to Pockels window slots
        a_slot = a_pn.astype(np.int32) - a_offset
        b_slot = b_pn.astype(np.int32) - b_offset

        # Build outcome arrays
        print(f"Building outcomes for slots {slots}...")
        a_outcome = np.zeros(n_trials, dtype=np.uint8)
        b_outcome = np.zeros(n_trials, dtype=np.uint8)

        slot_set = set(slots)
        a_in = np.array([s in slot_set for s in a_slot], dtype=bool)
        a_outcome[a_sn[a_in]] = 1
        n_a_det = int(np.sum(a_outcome))

        b_in = np.array([s in slot_set for s in b_slot], dtype=bool)
        b_outcome[b_sn[b_in]] = 1
        n_b_det = int(np.sum(b_outcome))

        print(f"  Alice detections: {n_a_det:,}")
        print(f"  Bob detections:   {n_b_det:,}")

        # Free detection data
        del a_sn, a_pn, b_sn, b_pn, a_slot, b_slot, a_in, b_in

        # Stream settings and write binary
        print("Writing binary...")
        counts = {f"{a+1}{b+1}": {'pp':0,'pm':0,'mp':0,'mm':0} for a in [0,1] for b in [0,1]}

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

                for a in [0,1]:
                    for b in [0,1]:
                        m = (sa==a) & (sb==b)
                        k = f"{a+1}{b+1}"
                        counts[k]['pp'] += int(np.sum(m & (oa==1) & (ob==1)))
                        counts[k]['pm'] += int(np.sum(m & (oa==1) & (ob==0)))
                        counts[k]['mp'] += int(np.sum(m & (oa==0) & (ob==1)))
                        counts[k]['mm'] += int(np.sum(m & (oa==0) & (ob==0)))

                out.write(np.column_stack([sa, sb, oa, ob]).tobytes())

                if end % (CHUNK * 50) == 0 or end == n_trials:
                    print(f"  {end/n_trials*100:5.1f}%", flush=True)

    elapsed = time.time() - t0

    for k in counts:
        t = counts[k]
        t['total'] = t['pp'] + t['pm'] + t['mp'] + t['mm']
    total = sum(counts[k]['total'] for k in counts)

    def rho(k):
        t = counts[k]
        n = t['total']
        return (t['pp'] + t['mm'] - t['pm'] - t['mp']) / n if n else 0
    S = rho('11') + rho('12') + rho('21') - rho('22')

    print(f"\nSlots: {slots}")
    print(f"Trials: {total:,}")
    print(f"S: {S:.6f}")
    print(f"Time: {elapsed:.1f}s")
    print(f"\nCounts vs Gill:")
    for k in sorted(counts):
        c = counts[k]
        g = GILL_COUNTS[k]
        print(f"  ({k[0]},{k[1]}): dd={c['pp']:>8,}({g['pp']:>8,}) dn={c['pm']:>8,}({g['pm']:>8,}) nd={c['mp']:>8,}({g['mp']:>8,})")

    meta = {
        'source': os.path.basename(hdf5_path),
        'n_trials': total, 'slots': slots,
        'format': '4 x uint8: [sa, sb, oa, ob]', 'stride': 4,
        'counts': counts, 'chsh_S': S,
        'detection_rate_alice': n_a_det / total,
        'detection_rate_bob': n_b_det / total,
        'bin_file': os.path.basename(bin_path), 'time_s': round(elapsed, 1),
    }
    with open(json_path, 'w') as jf:
        json.dump(meta, jf, indent=2)
    print(f"\nMetadata: {json_path}")
    print("Done.")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 convert_nist_pulsegroup.py --scan <hdf5>")
        print("  python3 convert_nist_pulsegroup.py --slots 4,5,6,7,8 <hdf5> [outdir]")
        sys.exit(1)

    if sys.argv[1] == '--scan':
        scan(sys.argv[2])
    elif sys.argv[1] == '--slots':
        slots = [int(x) for x in sys.argv[2].split(',')]
        convert(sys.argv[3], slots, sys.argv[4] if len(sys.argv) > 4 else None)
    else:
        print(f"Unknown: {sys.argv[1]}")
