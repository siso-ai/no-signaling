/**
 * StreamingCountGate - reads flat binary Bell test data in chunks.
 *
 * Memory: O(4MB) regardless of file size. Never loads the full file.
 * Reads 1M trials (4MB) at a time, increments counters, discards chunk.
 *
 * Binary format: 4 x uint8 per trial
 *   [setting_a, setting_b, outcome_a, outcome_b]
 *
 * GPL v3
 */

import { existsSync, openSync, readSync, closeSync, statSync } from 'fs';
import { Buffer } from 'buffer';


const CHUNK_TRIALS = 1_000_000;
const STRIDE = 4;


/**
 * Stream a flat binary file and produce count tables.
 * Reads in chunks. Never holds more than 4MB.
 *
 * @param {string} binPath  Path to .bin file
 * @param {object} [opts]
 * @param {number} [opts.windows]  Number of time windows (default 1 = full run)
 * @returns {object} { tables, N, settingCounts, windows? }
 */
export function streamBinary(binPath, opts = {}) {
  const { windows: nWindows = 1 } = opts;

  if (!existsSync(binPath)) {
    return { error: 'File not found: ' + binPath, tables: null };
  }

  const fileSize = statSync(binPath).size;
  const nTrials = fileSize / STRIDE;

  if (fileSize % STRIDE !== 0) {
    return { error: 'File size ' + fileSize + ' not divisible by stride ' + STRIDE, tables: null };
  }

  if (nWindows <= 1) {
    return _countFullRunChunked(binPath, nTrials);
  }

  return _countWindowedChunked(binPath, nTrials, nWindows);
}


function _countFullRunChunked(binPath, nTrials) {
  var tables = _emptyTables();
  var settingCounts = { '11': 0, '12': 0, '21': 0, '22': 0 };

  var fd = openSync(binPath, 'r');
  var chunkBytes = CHUNK_TRIALS * STRIDE;
  var buf = Buffer.alloc(chunkBytes);
  var totalRead = 0;

  try {
    while (totalRead < nTrials) {
      var trialsToRead = Math.min(CHUNK_TRIALS, nTrials - totalRead);
      var bytesToRead = trialsToRead * STRIDE;
      var bytesRead = readSync(fd, buf, 0, bytesToRead, totalRead * STRIDE);

      if (bytesRead === 0) break;
      var trialsInChunk = bytesRead / STRIDE;

      for (var i = 0; i < trialsInChunk; i++) {
        var off = i * STRIDE;
        var sa = buf[off];
        var sb = buf[off + 1];
        var oa = buf[off + 2];
        var ob = buf[off + 3];

        var key = '' + (sa + 1) + (sb + 1);
        var t = tables[key];

        if (oa && ob) t.pp++;
        else if (oa && !ob) t.pm++;
        else if (!oa && ob) t.mp++;
        else t.mm++;

        settingCounts[key]++;
      }

      totalRead += trialsInChunk;
    }
  } finally {
    closeSync(fd);
  }

  return {
    name: 'NIST (event-level)',
    tables: tables,
    settingCounts: settingCounts,
    N: totalRead,
  };
}


function _countWindowedChunked(binPath, nTrials, nWindows) {
  var windowSize = Math.ceil(nTrials / nWindows);

  var windowResults = [];
  for (var w = 0; w < nWindows; w++) {
    windowResults.push({
      window: w,
      startTrial: w * windowSize,
      endTrial: Math.min((w + 1) * windowSize, nTrials),
      tables: _emptyTables(),
      settingCounts: { '11': 0, '12': 0, '21': 0, '22': 0 },
      N: 0,
    });
  }

  var fd = openSync(binPath, 'r');
  var chunkBytes = CHUNK_TRIALS * STRIDE;
  var buf = Buffer.alloc(chunkBytes);
  var totalRead = 0;

  try {
    while (totalRead < nTrials) {
      var trialsToRead = Math.min(CHUNK_TRIALS, nTrials - totalRead);
      var bytesToRead = trialsToRead * STRIDE;
      var bytesRead = readSync(fd, buf, 0, bytesToRead, totalRead * STRIDE);

      if (bytesRead === 0) break;
      var trialsInChunk = bytesRead / STRIDE;

      for (var i = 0; i < trialsInChunk; i++) {
        var trialIdx = totalRead + i;
        var windowIdx = Math.min(Math.floor(trialIdx / windowSize), nWindows - 1);
        var win = windowResults[windowIdx];

        var off = i * STRIDE;
        var sa = buf[off];
        var sb = buf[off + 1];
        var oa = buf[off + 2];
        var ob = buf[off + 3];

        var key = '' + (sa + 1) + (sb + 1);
        var t = win.tables[key];

        if (oa && ob) t.pp++;
        else if (oa && !ob) t.pm++;
        else if (!oa && ob) t.mp++;
        else t.mm++;

        win.settingCounts[key]++;
        win.N++;
      }

      totalRead += trialsInChunk;
    }
  } finally {
    closeSync(fd);
  }

  return {
    name: 'NIST (event-level)',
    nWindows: nWindows,
    windowSize: windowSize,
    totalTrials: totalRead,
    windows: windowResults,
  };
}


function _emptyTables() {
  return {
    '11': { pp: 0, pm: 0, mp: 0, mm: 0 },
    '12': { pp: 0, pm: 0, mp: 0, mm: 0 },
    '21': { pp: 0, pm: 0, mp: 0, mm: 0 },
    '22': { pp: 0, pm: 0, mp: 0, mm: 0 },
  };
}


/**
 * Generate a synthetic flat binary file for testing.
 *
 * @param {number} nTrials
 * @param {object} [opts]
 * @returns {Buffer} The binary data
 */
export function generateSynthetic(nTrials, opts) {
  opts = opts || {};
  var seed = opts.seed || 42;
  var detectionRate = opts.detectionRate || 0.0003;
  var signalDelta = opts.signalDelta || 0;

  var rngState = seed | 0;
  function rand() {
    rngState = (rngState + 0x6D2B79F5) | 0;
    var t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  var buf = Buffer.alloc(nTrials * 4);

  for (var i = 0; i < nTrials; i++) {
    var sa = rand() < 0.5 ? 0 : 1;
    var sb = rand() < 0.5 ? 0 : 1;

    var rateA = detectionRate;
    var rateB = detectionRate;

    if (sb === 1 && signalDelta !== 0) {
      rateB = sa === 0
        ? detectionRate + signalDelta / 2
        : detectionRate - signalDelta / 2;
      rateB = Math.max(0, Math.min(1, rateB));
    }

    var oa = rand() < rateA ? 1 : 0;
    var ob = rand() < rateB ? 1 : 0;

    var off = i * 4;
    buf[off] = sa;
    buf[off + 1] = sb;
    buf[off + 2] = oa;
    buf[off + 3] = ob;
  }

  return buf;
}
