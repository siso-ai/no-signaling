import { test, assertEqual, assert, assertClose, report } from './runner.js';
import { Event } from '../src/core/Event.js';
import { Stream } from '../src/core/Stream.js';
import { ValidateSurvey } from '../src/gates/ValidateSurvey.js';
import { ScoreSurvey } from '../src/gates/ScoreSurvey.js';
import { ClassifySurvey } from '../src/gates/ClassifySurvey.js';
import { PrioritizeCategories } from '../src/gates/PrioritizeCategories.js';
import { SUB_OPTIONS } from '../src/survey/definition.js';

// ── Helpers ──────────────────────────────────────

function allAnswer(ans) {
  const answers = {};
  for (const so of SUB_OPTIONS) {
    // Use requested answer if allowed, else fall back to 'idk' (same base score as 'no')
    answers[so.key] = so.allowed.has(ans) ? ans : 'no';
  }
  return answers;
}

function allYes() { return allAnswer('yes'); }
function allNo()  { return allAnswer('no'); }

function validMotivations() {
  return { selected: ['ethos'], rankings: { ethos: 1 } };
}

/** Stream with just ScoreSurvey. */
function scoreStream() {
  const s = new Stream();
  s.register(new ScoreSurvey());
  return s;
}

/** Stream with ScoreSurvey + ClassifySurvey. */
function classifyStream() {
  const s = new Stream();
  s.register(new ScoreSurvey());
  s.register(new ClassifySurvey());
  return s;
}

/** Stream with all three scoring gates. */
function fullScoringStream() {
  const s = new Stream();
  s.register(new ScoreSurvey());
  s.register(new ClassifySurvey());
  s.register(new PrioritizeCategories());
  return s;
}

/** Stream with ValidateSurvey + all three scoring gates (full chain). */
function fullChain() {
  const s = new Stream();
  s.register(new ValidateSurvey());
  s.register(new ScoreSurvey());
  s.register(new ClassifySurvey());
  s.register(new PrioritizeCategories());
  return s;
}

// ── T2B.1 — All-yes scores to max per category ──

test('T2B.1 — all-yes survey scores to known maxima', () => {
  const s = scoreStream();
  s.emit(new Event('survey_validated', {
    location: 'X', motivations: validMotivations(), answers: allYes(),
  }));
  const scores = s.sampleHere().pending[0].data.scores;

  // Verified against spreadsheet summary table
  assertClose(scores.energy_use.ambition, 105, 0.01, 'energy amb');
  assertClose(scores.energy_use.sustainability, 95, 0.01, 'energy sus');
  assertClose(scores.fan_community_engagement.ambition, 40, 0.01, 'fan amb');
  assertClose(scores.fan_community_engagement.sustainability, 35, 0.01, 'fan sus');
  assertClose(scores.travel_transportation.ambition, 75, 0.01, 'travel amb');
  assertClose(scores.travel_transportation.sustainability, 75, 0.01, 'travel sus');
  assertClose(scores.sourcing_procurement.ambition, 45, 0.01, 'sourcing amb');
  assertClose(scores.sourcing_procurement.sustainability, 45, 0.01, 'sourcing sus');
  assertClose(scores.food_waste.ambition, 10, 0.01, 'food amb');
  assertClose(scores.food_waste.sustainability, 10, 0.01, 'food sus');
  assertClose(scores.material_waste.ambition, 45, 0.01, 'waste amb');
  assertClose(scores.material_waste.sustainability, 35, 0.01, 'waste sus');
  assertClose(scores.water_use.ambition, 65, 0.01, 'water amb');
  assertClose(scores.water_use.sustainability, 55, 0.01, 'water sus');
  assertClose(scores.biodiversity.ambition, 35, 0.01, 'bio amb');
  assertClose(scores.biodiversity.sustainability, 40, 0.01, 'bio sus');
});

// ── T2B.2 — All-no scores to minimum ────────────

test('T2B.2 — all-no survey scores correctly', () => {
  const s = scoreStream();
  s.emit(new Event('survey_validated', {
    location: 'X', motivations: validMotivations(), answers: allNo(),
  }));
  const scores = s.sampleHere().pending[0].data.scores;

  // Energy Use: 7 sub-options all base=1, weights: (3+3+3+3+3+3+3)=21 amb, (3+1+3+3+3+3+3)=19 sus
  assertClose(scores.energy_use.ambition, 21, 0.01, 'energy amb all-no');
  assertClose(scores.energy_use.sustainability, 19, 0.01, 'energy sus all-no');

  // Food waste: 1 sub-option, base=1, w(2,2)
  assertClose(scores.food_waste.ambition, 2, 0.01, 'food amb all-no');
  assertClose(scores.food_waste.sustainability, 2, 0.01, 'food sus all-no');
});

// ── T2B.3 — Weight asymmetry ────────────────────

test('T2B.3 — asymmetric weights produce different ambition vs sustainability', () => {
  const s = scoreStream();
  // Only change q3_led to 'yes', rest 'no'
  // q3_led: base(yes)=5, w_amb=3, w_sus=1
  // So its contribution: amb=15, sus=5
  const answers = allNo();
  answers.q3_led = 'yes';
  s.emit(new Event('survey_validated', {
    location: 'X', motivations: validMotivations(), answers,
  }));
  const scores = s.sampleHere().pending[0].data.scores;

  // Energy: q2(no:1×3=3), q3(yes:5×3=15), q4×3(no:1×3=3 each=9), q5(no:1×3=3), q6(no:1×3=3) = 33 amb
  //         q2(no:1×3=3), q3(yes:5×1=5),  q4×3(no:1×3=3 each=9), q5(no:1×3=3), q6(no:1×3=3) = 23 sus
  assertClose(scores.energy_use.ambition, 33, 0.01);
  assertClose(scores.energy_use.sustainability, 23, 0.01);
});

// ── T2B.4 — Threshold boundary: exactly at low_max ─

test('T2B.4 — energy use ambition=26 classifies as quick_win (boundary)', () => {
  const s = new Stream();
  s.register(new ClassifySurvey());
  s.emit(new Event('survey_scored', {
    scores: {
      energy_use: { ambition: 26, sustainability: 19 },
      fan_community_engagement: { ambition: 0, sustainability: 0 },
      travel_transportation: { ambition: 0, sustainability: 0 },
      sourcing_procurement: { ambition: 0, sustainability: 0 },
      food_waste: { ambition: 0, sustainability: 0 },
      material_waste: { ambition: 0, sustainability: 0 },
      water_use: { ambition: 0, sustainability: 0 },
      biodiversity: { ambition: 0, sustainability: 0 },
    },
    motivations: validMotivations(),
    location: 'X',
  }));
  const cl = s.sampleHere().pending[0].data.classifications;
  assertEqual(cl.energy_use.ambition_level, 'quick_win');
  assertEqual(cl.energy_use.sustainability_level, 'rookie');
});

// ── T2B.5 — Threshold boundary +1 ──────────────

test('T2B.5 — energy use ambition=27 classifies as power_play', () => {
  const s = new Stream();
  s.register(new ClassifySurvey());
  s.emit(new Event('survey_scored', {
    scores: {
      energy_use: { ambition: 27, sustainability: 20 },
      fan_community_engagement: { ambition: 0, sustainability: 0 },
      travel_transportation: { ambition: 0, sustainability: 0 },
      sourcing_procurement: { ambition: 0, sustainability: 0 },
      food_waste: { ambition: 0, sustainability: 0 },
      material_waste: { ambition: 0, sustainability: 0 },
      water_use: { ambition: 0, sustainability: 0 },
      biodiversity: { ambition: 0, sustainability: 0 },
    },
    motivations: validMotivations(),
    location: 'X',
  }));
  const cl = s.sampleHere().pending[0].data.classifications;
  assertEqual(cl.energy_use.ambition_level, 'power_play');
  assertEqual(cl.energy_use.sustainability_level, 'playmaker');
});

// ── T2B.5b — Above mid_max → game_changer / all_star ─

test('T2B.5b — energy use ambition=45 classifies as game_changer', () => {
  const s = new Stream();
  s.register(new ClassifySurvey());
  s.emit(new Event('survey_scored', {
    scores: {
      energy_use: { ambition: 45, sustainability: 49 },
      fan_community_engagement: { ambition: 0, sustainability: 0 },
      travel_transportation: { ambition: 0, sustainability: 0 },
      sourcing_procurement: { ambition: 0, sustainability: 0 },
      food_waste: { ambition: 0, sustainability: 0 },
      material_waste: { ambition: 0, sustainability: 0 },
      water_use: { ambition: 0, sustainability: 0 },
      biodiversity: { ambition: 0, sustainability: 0 },
    },
    motivations: validMotivations(),
    location: 'X',
  }));
  const cl = s.sampleHere().pending[0].data.classifications;
  assertEqual(cl.energy_use.ambition_level, 'game_changer');
  assertEqual(cl.energy_use.sustainability_level, 'all_star');
});

// ── T2B.6 — Priority cascade: skip game_changer ──

test('T2B.6 — cascade skips game_changer, picks first non-GC', () => {
  const s = new Stream();
  s.register(new PrioritizeCategories());

  const allGC = {};
  for (const cat of ['energy_use', 'fan_community_engagement', 'travel_transportation',
    'sourcing_procurement', 'food_waste', 'material_waste', 'water_use', 'biodiversity']) {
    allGC[cat] = { ambition_level: 'game_changer', sustainability_level: 'all_star' };
  }
  // Make fan and travel not game_changer
  allGC.fan_community_engagement = { ambition_level: 'power_play', sustainability_level: 'playmaker' };
  allGC.travel_transportation = { ambition_level: 'quick_win', sustainability_level: 'rookie' };

  s.emit(new Event('survey_classified', {
    classifications: allGC,
    scores: {},
    motivations: validMotivations(),
    location: 'X',
  }));

  const p = s.sampleHere().pending[0].data;
  // Energy is game_changer → skipped
  // Fan is power_play → priority 1
  // Travel is quick_win → priority 2
  // Rest are game_changer → only 2 priorities
  assertEqual(p.priorities[0], 'fan_community_engagement');
  assertEqual(p.priorities[1], 'travel_transportation');
  assertEqual(p.priorities.length, 2);
});

// ── T2B.7 — All game_changer → empty priorities ──

test('T2B.7 — all game_changer produces empty priorities', () => {
  const s = new Stream();
  s.register(new PrioritizeCategories());

  const allGC = {};
  for (const cat of ['energy_use', 'fan_community_engagement', 'travel_transportation',
    'sourcing_procurement', 'food_waste', 'material_waste', 'water_use', 'biodiversity']) {
    allGC[cat] = { ambition_level: 'game_changer', sustainability_level: 'all_star' };
  }

  s.emit(new Event('survey_classified', {
    classifications: allGC, scores: {}, motivations: validMotivations(), location: 'X',
  }));

  const p = s.sampleHere().pending[0].data;
  assertEqual(p.priorities.length, 0);
  assertEqual(p.all_categories.length, 8);
});

// ── T2B.8 — Full chain: validated → analyzed ─────

test('T2B.8 — full scoring chain produces survey_analyzed', () => {
  const s = fullScoringStream();
  s.emit(new Event('survey_validated', {
    location: 'Phoenix', motivations: validMotivations(), answers: allNo(),
  }));
  const { pending } = s.sampleHere();
  assertEqual(pending.length, 1);
  assertEqual(pending[0].type, 'survey_analyzed');

  const d = pending[0].data;
  assert(Array.isArray(d.priorities), 'has priorities');
  assert(d.priorities.length <= 3, 'at most 3 priorities');
  assertEqual(d.all_categories.length, 8);
  assert(d.classifications.energy_use != null, 'has energy classification');
  assert(d.scores.energy_use != null, 'has energy scores');
});

// ── T2B.9 — Partial answers score correctly ──────

test('T2B.9 — partial answer on pattern-D scores with base=3', () => {
  const s = scoreStream();
  const answers = allNo();
  answers.q7_toilets = 'partial';  // base=3, w_amb=2, w_sus=1
  answers.q7_faucets = 'most';     // base=4, w_amb=2, w_sus=1
  s.emit(new Event('survey_validated', {
    location: 'X', motivations: validMotivations(), answers,
  }));
  const water = s.sampleHere().pending[0].data.scores.water_use;

  // toilets: partial(3)×2=6 amb, 3×1=3 sus
  // faucets: most(4)×2=8 amb, 4×1=4 sus
  // refill: no(1)×2=2, 1×1=1
  // graywater: no(1)×3=3, 1×3=3
  // rainwater: no(1)×1=1, 1×2=2
  // blackwater: no(1)×3=3, 1×3=3
  assertClose(water.ambition, 6+8+2+3+1+3, 0.01, 'water amb partial');  // 23
  assertClose(water.sustainability, 3+4+1+3+2+3, 0.01, 'water sus partial');  // 16
});

// ── T2B.10 — Food waste IDK → quick_win/rookie ──

test('T2B.10 — food waste IDK produces quick_win and rookie', () => {
  const s = classifyStream();
  const answers = allNo();
  answers.q9_composting = 'idk';  // base=1, w(2,2) → amb=2, sus=2
  s.emit(new Event('survey_validated', {
    location: 'X', motivations: validMotivations(), answers,
  }));
  const cl = s.sampleHere().pending[0].data.classifications;
  // food_waste thresholds: amb [2,9], sus [2,9]
  // score=2 → <=2 → quick_win/rookie
  assertEqual(cl.food_waste.ambition_level, 'quick_win');
  assertEqual(cl.food_waste.sustainability_level, 'rookie');
});

// ── T2B.11 — Motivations survive the full chain ──

test('T2B.11 — motivations and location survive scoring chain', () => {
  const s = fullScoringStream();
  s.emit(new Event('survey_validated', {
    location: 'Phoenix, AZ',
    motivations: { selected: ['ethos', 'sponsor'], rankings: { ethos: 1, sponsor: 2 } },
    answers: allNo(),
  }));
  const d = s.sampleHere().pending[0].data;
  assertEqual(d.location, 'Phoenix, AZ');
  assert(d.motivations.selected.includes('ethos'));
  assert(d.motivations.selected.includes('sponsor'));
  assertEqual(d.motivations.rankings.ethos, 1);
});

// ── T2B.12 — 'soon' answer on Q10 scores correctly ─

test('T2B.12 — soon answer gives base=2.5', () => {
  const s = scoreStream();
  const answers = allNo();
  answers.q10_fans = 'soon';  // base=2.5, w_amb=3, w_sus=2
  s.emit(new Event('survey_validated', {
    location: 'X', motivations: validMotivations(), answers,
  }));
  const travel = s.sampleHere().pending[0].data.scores.travel_transportation;

  // q10_fans soon: 2.5×3=7.5 amb, 2.5×2=5 sus
  // Other 7 travel sub-options all 'no': base=1 each
  // q10_employees(1×1), q10_athletes(1×2), q10_volunteers(1×1), q11_virtual(1×3),
  // q11_direct_flight(1×2), q11_coach(1×2), q11_offsets(1×1) = 1+2+1+3+2+2+1 = 12 amb
  // sus: 1+2+3+1+2+1+3 = 13 sus
  assertClose(travel.ambition, 7.5 + 12, 0.01, 'travel amb with soon');  // 19.5
  assertClose(travel.sustainability, 5 + 13, 0.01, 'travel sus with soon');  // 18
});

// ── T2B.13 — 'na' answer scores 0 ──────────────

test('T2B.13 — na answer contributes 0 to score', () => {
  const s = scoreStream();
  const answers = allNo();
  // Set all pattern-C sourcing answers to 'na'
  answers.q12_supplier_coc = 'na';
  answers.q12_green_cleaning = 'na';
  answers.q12_packaging = 'na';
  answers.q12_reusable = 'na';
  s.emit(new Event('survey_validated', {
    location: 'X', motivations: validMotivations(), answers,
  }));
  const sourcing = s.sampleHere().pending[0].data.scores.sourcing_procurement;
  assertClose(sourcing.ambition, 0, 0.01, 'all-na amb = 0');
  assertClose(sourcing.sustainability, 0, 0.01, 'all-na sus = 0');
});

// ── T2B.14 — Full chain from survey_raw ──────────

test('T2B.14 — full chain: survey_raw → survey_analyzed', () => {
  const s = fullChain();
  s.emit(new Event('survey_raw', {
    location: 'Miami, FL',
    motivations: validMotivations(),
    answers: allYes(),
  }));
  const { pending } = s.sampleHere();
  assertEqual(pending.length, 1);
  assertEqual(pending[0].type, 'survey_analyzed');

  const d = pending[0].data;
  // All-yes should make everything game_changer → empty priorities
  assertEqual(d.priorities.length, 0, 'all-yes = all game_changer → no priorities');
  assertEqual(d.all_categories.length, 8);
  assertEqual(d.classifications.energy_use.ambition_level, 'game_changer');
});

// ── T2B.15 — Material waste has different thresholds ─

test('T2B.15 — material waste has asymmetric thresholds', () => {
  // ambition: [2, 9], sustainability: [10, 25]
  const s = new Stream();
  s.register(new ClassifySurvey());
  s.emit(new Event('survey_scored', {
    scores: {
      energy_use: { ambition: 0, sustainability: 0 },
      fan_community_engagement: { ambition: 0, sustainability: 0 },
      travel_transportation: { ambition: 0, sustainability: 0 },
      sourcing_procurement: { ambition: 0, sustainability: 0 },
      food_waste: { ambition: 0, sustainability: 0 },
      material_waste: { ambition: 5, sustainability: 5 },  // amb: 5 > 2 → power_play, sus: 5 ≤ 10 → rookie
      water_use: { ambition: 0, sustainability: 0 },
      biodiversity: { ambition: 0, sustainability: 0 },
    },
    motivations: validMotivations(), location: 'X',
  }));
  const cl = s.sampleHere().pending[0].data.classifications;
  assertEqual(cl.material_waste.ambition_level, 'power_play');
  assertEqual(cl.material_waste.sustainability_level, 'rookie');
});

// ── T2B.16 — Cascade fills max 3 ───────────────

test('T2B.16 — cascade stops at 3 priorities', () => {
  const s = new Stream();
  s.register(new PrioritizeCategories());

  const allLow = {};
  for (const cat of ['energy_use', 'fan_community_engagement', 'travel_transportation',
    'sourcing_procurement', 'food_waste', 'material_waste', 'water_use', 'biodiversity']) {
    allLow[cat] = { ambition_level: 'quick_win', sustainability_level: 'rookie' };
  }

  s.emit(new Event('survey_classified', {
    classifications: allLow, scores: {}, motivations: validMotivations(), location: 'X',
  }));

  const p = s.sampleHere().pending[0].data;
  assertEqual(p.priorities.length, 3);
  // First 3 in hierarchy order
  assertEqual(p.priorities[0], 'energy_use');
  assertEqual(p.priorities[1], 'fan_community_engagement');
  assertEqual(p.priorities[2], 'travel_transportation');
});

// ── Report ───────────────────────────────────────

const exitCode = report('phase2b');
process.exit(exitCode);
