#!/usr/bin/env python3
"""
convert_nist_filtered.py — Convert NIST HDF5 with pulse-slot filtering.

The NIST clicks field is a uint16 bitmask. Each bit represents one
laser pulse slot within the Pockels cell window (~15 slots). Only
the middle slots are confirmed spacelike separated.

Current (unfiltered) converter: outcome = clicks > 0 (any bit)
This converter: outcome = (clicks & pulse_mask) > 0 (selected bits only)

All 356M trials are kept. Only the outcome definition changes.

Usage:
    python3 convert_nist_filtered.py --scan <hdf5>
    python3 convert_nist_filtered.py --bits 3,4,5,6,7 <hdf5> [outdir]
    python3 convert_nist_filtered.py --auto <hdf5> [outdir]

GPL v3
"""

import sys, os, json, time

try:
    import h5py
    import numpy as np
except ImportError:
    print("ERROR: pip install h5py numpy")
    sys.exit(1)

CHUNK = 1_000_000
GILL_TOTAL = 173_149_423

GILL_COUNTS = {
    '11': {'pp': 6378, 'pm': 3282, 'mp': 3189, 'mm': 43897356, 'total': 43910205},
    '12': {'pp': 6794, 'pm': 2821, 'mp': 23243, 'mm': 43276943, 'total': 43309801},
    '21': {'pp': 6486, 'pm': 21334, 'mp': 2843, 'mm': 43338281, 'total': 43368944},
    '22': {'pp': 106, 'pm': 27539, 'mp': 30040, 'mm': 42502788, 'total': 42560473},
}


def scan(hdf5_path):
    """Analyze click bitmask and find which bits match Gill's counts."""
    print(f"Scanning: {hdf5_path}\n")

    with h5py.File(hdf5_path, 'r') as f:
        n = f['alice/clicks'].shape[0]
        print(f"Total trials: {n:,}")

        # Config values
        for party in ['alice', 'bob']:
            for key in ['pk', 'radius', 'bitoffset']:
                path = f'config/{party}/{key}'
                if path in f:
                    print(f"  config/{party}/{key} = {f[path][()]}")

        # Sample clicks
        sample_n = min(5_000_000, n)
        ca = f['alice/clicks'][:sample_n]
        cb = f['bob/clicks'][:sample_n]
        sa = f['alice/settings'][:sample_n]
        sb = f['bob/settings'][:sample_n]

        # Which bits are ever set?
        print(f"\nBit population (first {sample_n:,} trials):")
        print(f"  {'Bit':>4s}  {'Alice':>10s} {'%':>6s}  {'Bob':>10s} {'%':>6s}")
        print(f"  {'-'*42}")

        for bit in range(16):
            mask = np.uint16(1 << bit)
            a_cnt = int(np.sum((ca & mask) > 0))
            b_cnt = int(np.sum((cb & mask) > 0))
            if a_cnt > 0 or b_cnt > 0:
                print(f"  {bit:4d}  {a_cnt:10,} {a_cnt/sample_n*100:5.2f}%  "
                      f"{b_cnt:10,} {b_cnt/sample_n*100:5.2f}%")

        # Any detection at all
        a_any = int(np.sum(ca > 0))
        b_any = int(np.sum(cb > 0))
        print(f"  {'any':>4s}  {a_any:10,} {a_any/sample_n*100:5.2f}%  "
              f"{b_any:10,} {b_any/sample_n*100:5.2f}%")

        # Settings encoding
        off_a = -1 if set(np.unique(sa)).issubset({1, 2}) else 0
        off_b = -1 if set(np.unique(sb)).issubset({1, 2}) else 0
        if off_a: sa = sa.astype(np.int8) - 1
        if off_b: sb = sb.astype(np.int8) - 1
        sa = np.clip(sa, 0, 1).astype(np.uint8)
        sb = np.clip(sb, 0, 1).astype(np.uint8)

        # Try different bit selections and compare counts to Gill
        print(f"\nSearching for bit mask that matches Gill's counts...")
        print(f"Gill's total: {GILL_TOTAL:,}")
        print(f"Gill's S: 2.000092")
        print()

        # Gill's total is 173M but we have 356M trials.
        # The total trial count doesn't change with bit filtering —
        # only the detection counts change.
        # So we match on detection counts and S value, not on N.

        results = []
        seen = set()

        # Get all populated bits
        all_bits = []
        for bit in range(16):
            mask = np.uint16(1 << bit)
            if int(np.sum((ca & mask) > 0)) > 0:
                all_bits.append(bit)

        print(f"Populated bits: {all_bits}")
        print()

        # Try contiguous ranges
        for start_bit in all_bits:
            for width in range(1, len(all_bits) + 1):
                bits = [b for b in range(start_bit, start_bit + width) if b in set(all_bits)]
                if len(bits) != width:
                    continue
                key = tuple(bits)
                if key in seen:
                    continue
                seen.add(key)

                # Build bitmask
                bmask = np.uint16(sum(1 << b for b in bits))
                oa = ((ca & bmask) > 0).astype(np.uint8)
                ob = ((cb & bmask) > 0).astype(np.uint8)

                # Compute counts for setting pair (2,2) — the diagnostic one
                m22 = (sa == 1) & (sb == 1)
                pp22 = int(np.sum(m22 & (oa==1) & (ob==1)))
                pm22 = int(np.sum(m22 & (oa==1) & (ob==0)))
                mp22 = int(np.sum(m22 & (oa==0) & (ob==1)))

                # Scale from sample to full dataset
                scale = n / sample_n
                pp22_est = pp22 * scale
                pm22_est = pm22 * scale
                mp22_est = mp22 * scale

                # Compare to Gill (2,2)
                g = GILL_COUNTS['22']
                pp_diff = abs(pp22_est - g['pp']) / max(g['pp'], 1)
                pm_diff = abs(pm22_est - g['pm']) / max(g['pm'], 1)
                mp_diff = abs(mp22_est - g['mp']) / max(g['mp'], 1)

                # Also compute full S estimate
                counts_est = {}
                for a in [0, 1]:
                    for b in [0, 1]:
                        m = (sa == a) & (sb == b)
                        pp = int(np.sum(m & (oa==1) & (ob==1)))
                        pm = int(np.sum(m & (oa==1) & (ob==0)))
                        mp = int(np.sum(m & (oa==0) & (ob==1)))
                        mm = int(np.sum(m & (oa==0) & (ob==0)))
                        nn = pp + pm + mp + mm
                        k = f"{a+1}{b+1}"
                        counts_est[k] = {'pp':pp,'pm':pm,'mp':mp,'mm':mm,'total':nn}

                def rho(k):
                    t = counts_est[k]
                    nn = t['total']
                    return (t['pp'] + t['mm'] - t['pm'] - t['mp']) / nn if nn else 0
                S_est = rho('11') + rho('12') + rho('21') - rho('22')

                avg_diff = (pp_diff + pm_diff + mp_diff) / 3
                results.append((bits, avg_diff, S_est, counts_est))

                if avg_diff < 0.15:
                    print(f"  bits {str(bits):20s}  S={S_est:.6f}  "
                          f"(2,2) dd={pp22_est:.0f} dn={pm22_est:.0f} nd={mp22_est:.0f}  "
                          f"avg_diff={avg_diff:.3f}")

        if not results:
            print("  No candidates found!")
            return

        # Sort by best match
        results.sort(key=lambda r: r[1])
        best = results[0]

        print(f"\nBest match: bits {best[0]}")
        print(f"  S = {best[2]:.6f} (Gill: 2.000092)")
        print(f"  Avg count diff: {best[1]:.3f}")

        # Show full count comparison for best
        print(f"\n  Full count comparison (estimated from sample):")
        scale = n / sample_n
        for k in sorted(best[3]):
            t = best[3][k]
            g = GILL_COUNTS[k]
            print(f"    ({k[0]},{k[1]}):  dd={t['pp']*scale:>10.0f} (gill={g['pp']:>8,})  "
                  f"dn={t['pm']*scale:>10.0f} (gill={g['pm']:>8,})  "
                  f"nd={t['mp']*scale:>10.0f} (gill={g['mp']:>8,})")

        print(f"\nTo convert with this filter:")
        print(f"  python3 convert_nist_filtered.py --bits {','.join(map(str, best[0]))} {hdf5_path}")


def convert(hdf5_path, bits, output_dir=None):
    """Convert with bitmask filter on clicks."""
    if output_dir is None:
        output_dir = os.path.dirname(hdf5_path) or '.'
    os.makedirs(output_dir, exist_ok=True)

    pulse_mask_a = np.uint16(sum(1 << b for b in bits))
    pulse_mask_b = np.uint16(sum(1 << b for b in bits))  # same mask for bob

    basename = os.path.basename(hdf5_path)
    for ext in ['.hdf5', '.build', '.compressed', '.dat']:
        if basename.endswith(ext):
            basename = basename[:-len(ext)]
    basename = basename.strip('.') or 'nist_data'

    bin_path = os.path.join(output_dir, f"{basename}.filtered.bin")
    json_path = os.path.join(output_dir, f"{basename}.filtered.json")

    print(f"Input:    {hdf5_path}")
    print(f"Output:   {bin_path}")
    print(f"Bits:     {bits}")
    print(f"Bitmask:  0x{pulse_mask_a:04X} = {bin(pulse_mask_a)}")
    print(f"Chunk:    {CHUNK:,}\n")

    t0 = time.time()

    with h5py.File(hdf5_path, 'r') as f:
        alice_set = f['alice/settings']
        bob_set   = f['bob/settings']
        alice_clk = f['alice/clicks']
        bob_clk   = f['bob/clicks']
        n_total   = alice_set.shape[0]

        off_a = -1 if set(np.unique(alice_set[:100000])).issubset({1, 2}) else 0
        off_b = -1 if set(np.unique(bob_set[:100000])).issubset({1, 2}) else 0

        counts = {f"{a+1}{b+1}": {'pp':0,'pm':0,'mp':0,'mm':0} for a in [0,1] for b in [0,1]}
        det_a = 0
        det_b = 0

        with open(bin_path, 'wb') as out:
            for start in range(0, n_total, CHUNK):
                end = min(start + CHUNK, n_total)

                sa = alice_set[start:end].astype(np.int8)
                sb = bob_set[start:end].astype(np.int8)
                ca = alice_clk[start:end]
                cb = bob_clk[start:end]

                if off_a: sa = sa + off_a
                if off_b: sb = sb + off_b
                sa = np.clip(sa, 0, 1).astype(np.uint8)
                sb = np.clip(sb, 0, 1).astype(np.uint8)

                # FILTERED outcomes: only count clicks in selected bit positions
                oa = ((ca & pulse_mask_a) > 0).astype(np.uint8)
                ob = ((cb & pulse_mask_b) > 0).astype(np.uint8)

                det_a += int(np.sum(oa))
                det_b += int(np.sum(ob))

                for a in [0, 1]:
                    for b in [0, 1]:
                        m = (sa == a) & (sb == b)
                        k = f"{a+1}{b+1}"
                        counts[k]['pp'] += int(np.sum(m & (oa==1) & (ob==1)))
                        counts[k]['pm'] += int(np.sum(m & (oa==1) & (ob==0)))
                        counts[k]['mp'] += int(np.sum(m & (oa==0) & (ob==1)))
                        counts[k]['mm'] += int(np.sum(m & (oa==0) & (ob==0)))

                out.write(np.column_stack([sa, sb, oa, ob]).tobytes())

                pct = end / n_total * 100
                el = time.time() - t0
                rate = end / el if el > 0 else 0
                eta = (n_total - end) / rate if rate > 0 else 0
                print(f"  {pct:5.1f}%  {end:>12,}/{n_total:,}  "
                      f"({rate/1e6:.1f}M/s ETA {eta:.0f}s)", flush=True)

    elapsed = time.time() - t0
    bin_size = os.path.getsize(bin_path)

    for k in counts:
        t = counts[k]
        t['total'] = t['pp'] + t['pm'] + t['mp'] + t['mm']
    n_total_counted = sum(counts[k]['total'] for k in counts)

    print(f"\n{'='*60}")
    print(f"Filtered conversion complete")
    print(f"{'='*60}")
    print(f"  Bits:    {bits}")
    print(f"  Mask:    0x{pulse_mask_a:04X}")
    print(f"  Trials:  {n_total_counted:,}")
    print(f"  File:    {bin_path} ({bin_size/1e6:.1f} MB)")
    print(f"  Time:    {elapsed:.1f}s")

    # CHSH S
    def rho(k):
        t = counts[k]
        nn = t['total']
        return (t['pp'] + t['mm'] - t['pm'] - t['mp']) / nn if nn else 0
    S = rho('11') + rho('12') + rho('21') - rho('22')

    print(f"\n  Detection: alice={det_a/n_total_counted:.8f}  bob={det_b/n_total_counted:.8f}")
    print(f"  CHSH S = {S:.6f}  (Gill: 2.000092)")

    print(f"\n  Count tables (ours vs Gill):")
    for k in sorted(counts):
        t = counts[k]
        g = GILL_COUNTS[k]
        close = all(abs(t[c] - g[c]) / max(g[c], 1) < 0.05 for c in ['pp','pm','mp'])
        status = "MATCH" if close else "DIFFERS"
        print(f"    ({k[0]},{k[1]}): {status}")
        print(f"      dd: {t['pp']:>10,}  gill: {g['pp']:>10,}  diff: {t['pp']-g['pp']:>+10,}")
        print(f"      dn: {t['pm']:>10,}  gill: {g['pm']:>10,}  diff: {t['pm']-g['pm']:>+10,}")
        print(f"      nd: {t['mp']:>10,}  gill: {g['mp']:>10,}  diff: {t['mp']-g['mp']:>+10,}")
        print(f"      nn: {t['mm']:>10,}  gill: {g['mm']:>10,}  diff: {t['mm']-g['mm']:>+10,}")

    meta = {
        'source': os.path.basename(hdf5_path),
        'n_trials': n_total_counted,
        'format': '4 x uint8: [sa, sb, oa, ob]',
        'stride': 4,
        'pulse_bits': bits,
        'pulse_bitmask': int(pulse_mask_a),
        'counts': counts,
        'detection_rate_alice': det_a / n_total_counted,
        'detection_rate_bob': det_b / n_total_counted,
        'chsh_S': S,
        'bin_file': os.path.basename(bin_path),
        'time_s': round(elapsed, 1),
    }
    with open(json_path, 'w') as jf:
        json.dump(meta, jf, indent=2)
    print(f"\n  Metadata: {json_path}")
    print("Done.")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 convert_nist_filtered.py --scan <hdf5>")
        print("  python3 convert_nist_filtered.py --bits 3,4,5,6,7 <hdf5> [outdir]")
        print("  python3 convert_nist_filtered.py --auto <hdf5> [outdir]")
        sys.exit(1)

    if sys.argv[1] == '--scan':
        scan(sys.argv[2])
    elif sys.argv[1] == '--auto':
        # Scan then convert with best match
        print("Auto mode: scanning first...\n")
        # Just run scan for now — user picks bits from output
        scan(sys.argv[2])
    elif sys.argv[1] == '--bits':
        bits = [int(x) for x in sys.argv[2].split(',')]
        hdf5 = sys.argv[3]
        outdir = sys.argv[4] if len(sys.argv) > 4 else None
        convert(hdf5, bits, outdir)
    elif sys.argv[1] == '--explore':
        print(f"HDF5 structure of: {sys.argv[2]}")
        print("=" * 60)
        with h5py.File(sys.argv[2], 'r') as f:
            def visitor(name, obj):
                if isinstance(obj, h5py.Dataset):
                    print(f"  DATASET: {name}  shape={obj.shape}  dtype={obj.dtype}")
                elif isinstance(obj, h5py.Group):
                    print(f"  GROUP:   {name}/")
            f.visititems(visitor)
        print("=" * 60)
    else:
        print(f"Unknown flag: {sys.argv[1]}")
        sys.exit(1)