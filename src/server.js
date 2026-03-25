/**
 * server.js — Bell test analysis server.
 *
 * Serves the viewer and streams analysis results via SSE.
 * Each gate fires an event → SSE pushes it to the browser →
 * browser Stream/Gate makes a targeted DOM update.
 *
 * Endpoints:
 *   GET /                    → viewer HTML
 *   GET /api/datasets        → list available .bin files
 *   GET /api/analyze?file=X  → SSE stream of gate events
 *   GET /api/convert?hdf5=X  → convert HDF5 to binary (spawns Python)
 *
 * Usage:
 *   cd /var/www/qm.fluanta.org
 *   node server.js [port]
 *
 * GPL v3
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

import { Stream } from './lib/Stream.js';
import { CountTableGate } from './gates/CountTableGate.js';
import { MarginalGate } from './gates/MarginalGate.js';
import { NoSignalingGate } from './gates/NoSignalingGate.js';
import { PermutationGate } from './gates/PermutationGate.js';
import { BootstrapGate } from './gates/BootstrapGate.js';
import { streamBinary } from './gates/StreamingCountGate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.argv[2] || '3847');
const DATA_DIR = path.join(__dirname, 'data', 'nist');


// ═══════════════════════════════════════
// Analysis runner — emits SSE events
// ═══════════════════════════════════════

function runAnalysis(binPath, res, opts = {}) {
  const { nWindows = 100, nPermutations = 10000, nBootstrap = 10000 } = opts;

  function send(type, data) {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    // ── Gate 0: Load binary ──
    send('gate', { gate: 'StreamLoad', action: 'enter', msg: `Loading ${path.basename(binPath)}` });

    const stats = fs.statSync(binPath);
    const nTrials = stats.size / 4;
    send('load', { file: path.basename(binPath), size: stats.size, nTrials });
    send('gate', { gate: 'StreamLoad', action: 'exit', msg: `${nTrials.toLocaleString()} trials loaded (${(stats.size / 1e6).toFixed(1)} MB)` });

    // ── Gate 1: Count tables ──
    send('gate', { gate: 'CountTableGate', action: 'enter', msg: 'Streaming binary → four 2×2 count tables' });

    const streamed = streamBinary(binPath);
    if (streamed.error) {
      send('error', { msg: streamed.error });
      res.end();
      return;
    }

    const tables = streamed.tables;
    const settingCounts = streamed.settingCounts;

    // Compute totals
    for (const ab of ['11', '12', '21', '22']) {
      const t = tables[ab];
      t.total = t.pp + t.pm + t.mp + t.mm;
    }

    send('counts', { tables, settingCounts, N: streamed.N });
    send('gate', { gate: 'CountTableGate', action: 'exit', msg: `N = ${streamed.N.toLocaleString()}` });

    // ── Gate 2: Marginals ──
    send('gate', { gate: 'MarginalGate', action: 'enter', msg: 'Computing P(outcome|setting_a, setting_b)' });

    const alice = {};
    const bob = {};
    for (const ab of ['11', '12', '21', '22']) {
      const t = tables[ab];
      const n = t.total;
      alice[ab] = n > 0 ? (t.pp + t.pm) / n : 0;
      bob[ab] = n > 0 ? (t.pp + t.mp) / n : 0;
    }

    send('marginals', { alice, bob });
    send('gate', { gate: 'MarginalGate', action: 'exit', msg: 'Marginal probabilities computed' });

    // ── Gate 3: No-signaling deltas ──
    send('gate', { gate: 'NoSignalingGate', action: 'enter', msg: 'Subtracting no-signaling constraint → four residual deltas' });

    // Use the pipeline for this
    const stream = new Stream();
    stream.register(new CountTableGate());
    stream.register(new MarginalGate());
    stream.register(new NoSignalingGate());

    const exp = { name: 'NIST (event-level)', tables };
    stream.emit({ type: 'summary', data: exp });
    const residualResult = stream.sampleHere();
    const residual = residualResult.pending.find(e => e.type === 'residual');

    if (!residual) {
      send('error', { msg: 'NoSignalingGate produced no residual' });
      res.end();
      return;
    }

    const r = residual.data;
    const deltaLabels = ['Δ_A(1)', 'Δ_A(2)', 'Δ_B(1)', 'Δ_B(2)'];

    send('deltas', {
      deltas: r.deltas,
      standardErrors: r.standardErrors,
      zScores: r.zScores,
      magnitude: r.magnitude,
      chiSq: r.chiSq,
      labels: deltaLabels,
    });

    // Flag significant z-scores
    for (let i = 0; i < 4; i++) {
      if (Math.abs(r.zScores[i]) > 2) {
        send('flag', { delta: deltaLabels[i], z: r.zScores[i], msg: `|z| = ${Math.abs(r.zScores[i]).toFixed(3)} exceeds 2σ` });
      }
    }

    send('gate', { gate: 'NoSignalingGate', action: 'exit', msg: `‖Δ‖ = ${r.magnitude.toExponential(4)}, χ² = ${r.chiSq.toFixed(4)}` });

    // ── Gate 4: Permutation test ──
    send('gate', { gate: 'PermutationGate', action: 'enter', msg: `Running ${nPermutations.toLocaleString()} permutations (seed=137)` });

    const permStream = new Stream();
    permStream.register(new CountTableGate());
    permStream.register(new MarginalGate());
    permStream.register(new NoSignalingGate());
    permStream.register(new PermutationGate());

    const permExp = { ...exp, _permOpts: { nPermutations, seed: 137 } };
    permStream.emit({ type: 'summary', data: permExp });
    const permResult = permStream.sampleHere();
    const permEvt = permResult.pending.find(e => e.type === 'permutation_result');

    if (permEvt) {
      const p = permEvt.data;
      send('permutation', {
        pValue: p.pValue,
        nullMedian: p.nullMedian,
        null95: p.null95,
        null99: p.null99,
        observedMagnitude: p.observedMagnitude,
        nPermutations: p.nPermutations,
      });

      let sig = 'NOT_SIGNIFICANT';
      if (p.pValue < 0.01) sig = 'SIGNIFICANT_001';
      else if (p.pValue < 0.05) sig = 'SUGGESTIVE_005';
      send('gate', { gate: 'PermutationGate', action: 'exit', msg: `p = ${p.pValue.toFixed(6)} → ${sig}` });
    }

    // ── Gate 5: Bootstrap CIs ──
    send('gate', { gate: 'BootstrapGate', action: 'enter', msg: `Running ${nBootstrap.toLocaleString()} bootstrap resamples (seed=42)` });

    const bootStream = new Stream();
    bootStream.register(new CountTableGate());
    bootStream.register(new MarginalGate());
    bootStream.register(new NoSignalingGate());
    bootStream.register(new PermutationGate());
    bootStream.register(new BootstrapGate());

    const bootExp = { ...exp, _permOpts: { nPermutations, seed: 137, nBootstrap, bootstrapSeed: 42, ciLevel: 0.95 } };
    bootStream.emit({ type: 'summary', data: bootExp });
    const bootResult = bootStream.sampleHere();
    const bootEvt = bootResult.pending.find(e => e.type === 'bootstrap_result');

    if (bootEvt) {
      const b = bootEvt.data;
      send('bootstrap', {
        deltaCIs: b.deltaCIs,
        magnitudeCI: b.magnitudeCI,
        zeroInCI: b.zeroInCI,
        nResamples: b.nResamples,
        ciLevel: b.ciLevel,
        labels: deltaLabels,
      });

      const nExcl = b.zeroInCI.filter(x => !x).length;
      send('gate', { gate: 'BootstrapGate', action: 'exit', msg: `${nExcl}/4 CIs exclude zero` });
    }

    // ── Gate 6: Time-windowed analysis ──
    send('gate', { gate: 'WindowedGate', action: 'enter', msg: `Splitting into ${nWindows} time windows` });

    const windowed = streamBinary(binPath, { windows: nWindows });

    if (windowed.windows) {
      const windowDeltas = [];

      for (let w = 0; w < windowed.windows.length; w++) {
        const win = windowed.windows[w];
        const ws = new Stream();
        ws.register(new CountTableGate());
        ws.register(new MarginalGate());
        ws.register(new NoSignalingGate());

        ws.emit({ type: 'summary', data: { name: `Window ${w}`, tables: win.tables } });
        const wr = ws.sampleHere();
        const wResidual = wr.pending.find(e => e.type === 'residual');

        if (wResidual) {
          windowDeltas.push({
            window: w,
            N: win.N,
            deltas: wResidual.data.deltas,
            magnitude: wResidual.data.magnitude,
          });
        }

        // Progress every 10 windows
        if ((w + 1) % 10 === 0 || w === windowed.windows.length - 1) {
          send('windowed_progress', { completed: w + 1, total: windowed.windows.length });
        }
      }

      // Compute temporal statistics
      const deltaSeries = [[], [], [], []];
      for (const wd of windowDeltas) {
        for (let d = 0; d < 4; d++) {
          deltaSeries[d].push(wd.deltas[d]);
        }
      }

      const deltaStats = deltaSeries.map((series, d) => {
        const mean = _mean(series);
        const ac1 = _autocorrelation(series, 1);
        const trend = _linearTrend(series);
        return {
          label: deltaLabels[d],
          mean,
          autocorrelation_lag1: ac1,
          trendSlope: trend.slope,
          trendR2: trend.r2,
        };
      });

      const acThreshold = 2 / Math.sqrt(nWindows);
      const r2Threshold = Math.max(0.04, 2 / nWindows);
      const maxAC1 = Math.max(...deltaStats.map(s => Math.abs(s.autocorrelation_lag1)));
      const maxTrendR2 = Math.max(...deltaStats.map(s => s.trendR2));

      let temporalVerdict;
      if (maxAC1 > acThreshold && maxTrendR2 > r2Threshold) temporalVerdict = 'DRIFT';
      else if (maxAC1 > acThreshold) temporalVerdict = 'AUTOCORRELATED';
      else if (maxTrendR2 > r2Threshold) temporalVerdict = 'TRENDING';
      else temporalVerdict = 'STATIONARY';

      send('windowed', {
        nWindows,
        deltaStats,
        temporalVerdict,
        acThreshold,
        r2Threshold,
        windowDeltas: windowDeltas.map(w => ({ window: w.window, deltas: w.deltas, magnitude: w.magnitude })),
      });

      send('gate', { gate: 'WindowedGate', action: 'exit', msg: `Temporal verdict: ${temporalVerdict}` });
    }

    // ── Final verdict ──
    send('gate', { gate: 'Verdict', action: 'enter', msg: 'Assembling final verdict' });

    const flags = [];
    if (permEvt && permEvt.data.pValue < 0.05) flags.push('PERMUTATION_SIGNIFICANT');
    if (bootEvt && bootEvt.data.zeroInCI.some(x => !x)) flags.push('CI_EXCLUDES_ZERO');
    if (windowed.windows) flags.push('TEMPORAL_ANALYZED');

    send('verdict', {
      flags,
      summary: {
        N: streamed.N,
        file: path.basename(binPath),
        magnitude: r.magnitude,
        chiSq: r.chiSq,
        permP: permEvt ? permEvt.data.pValue : null,
        nCIexcludeZero: bootEvt ? bootEvt.data.zeroInCI.filter(x => !x).length : 0,
      },
    });

    send('gate', { gate: 'Verdict', action: 'exit', msg: 'Analysis complete' });
    send('complete', { msg: 'All gates finished' });

  } catch (err) {
    send('error', { msg: err.message, stack: err.stack });
  }

  res.end();
}


// ═══════════════════════════════════════
// Statistical helpers (duplicated from windowed.js to avoid import issues)
// ═══════════════════════════════════════

function _mean(arr) {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

function _autocorrelation(arr, lag) {
  const n = arr.length;
  if (n <= lag) return 0;
  const m = _mean(arr);
  let num = 0, den = 0;
  for (let t = 0; t < n; t++) {
    den += (arr[t] - m) ** 2;
    if (t + lag < n) num += (arr[t] - m) * (arr[t + lag] - m);
  }
  return den > 0 ? num / den : 0;
}

function _linearTrend(arr) {
  const n = arr.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += arr[i]; sxy += i * arr[i]; sx2 += i * i; }
  const den = n * sx2 - sx * sx;
  if (Math.abs(den) < 1e-20) return { slope: 0, intercept: sy / n, r2: 0 };
  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) { const pred = slope * i + intercept; ssTot += (arr[i] - meanY) ** 2; ssRes += (arr[i] - pred) ** 2; }
  return { slope, intercept, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}


// ═══════════════════════════════════════
// HTTP server
// ═══════════════════════════════════════

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Serve viewer
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const htmlPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(htmlPath, 'utf-8'));
    } else {
      res.writeHead(404);
      res.end('index.html not found');
    }
    return;
  }

  // List datasets
  if (url.pathname === '/api/datasets') {
    const files = [];

    // Scan for .bin files
    const dirs = [
      path.join(__dirname, 'data', 'nist'),
      path.join(__dirname, 'data'),
      path.join(__dirname, 'nist'),
      path.join(__dirname, 'tools', 'nist'),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.bin')) {
          const fullPath = path.join(dir, f);
          const stat = fs.statSync(fullPath);
          files.push({
            name: f,
            path: fullPath,
            size: stat.size,
            nTrials: stat.size / 4,
            modified: stat.mtime.toISOString(),
          });
        }
      }
    }

    // Also list HDF5 files available for conversion
    const hdf5Files = [];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.hdf5')) {
          hdf5Files.push({ name: f, path: path.join(dir, f) });
        }
      }
    }
    // Check parent data dir
    const dataDir = path.join(__dirname, 'data');
    if (fs.existsSync(dataDir)) {
      for (const f of fs.readdirSync(dataDir)) {
        if (f.endsWith('.hdf5')) {
          hdf5Files.push({ name: f, path: path.join(dataDir, f) });
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ binaries: files, hdf5: hdf5Files }));
    return;
  }

  // Run analysis via SSE
  if (url.pathname === '/api/analyze') {
    const filePath = url.searchParams.get('file');
    const nWindows = parseInt(url.searchParams.get('windows') || '100');

    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `File not found: ${filePath}` }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Run analysis asynchronously
    setTimeout(() => runAnalysis(filePath, res, { nWindows }), 0);
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Bell Test Analysis Server`);
  console.log(`http://localhost:${PORT}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log('');

  // List available files
  if (fs.existsSync(DATA_DIR)) {
    const bins = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.bin'));
    console.log(`Available binaries: ${bins.length}`);
    for (const b of bins) {
      const s = fs.statSync(path.join(DATA_DIR, b));
      console.log(`  ${b} (${(s.size / 1e6).toFixed(1)} MB, ${(s.size / 4).toLocaleString()} trials)`);
    }
  }
});
