import { test, assertEqual, assert, report } from './runner.js';
import { Event } from '../src/core/Event.js';
import { Stream } from '../src/core/Stream.js';
import { ValidateSurvey } from '../src/gates/ValidateSurvey.js';
import { SUB_OPTIONS } from '../src/survey/definition.js';

// ── Helpers ──────────────────────────────────────

/** Build a complete valid answers object (all 38 keys, lowest-scoring answer). */
function allNo() {
  const answers = {};
  for (const so of SUB_OPTIONS) {
    // 'no' and 'idk' both score base=1. Use whichever is allowed.
    answers[so.key] = 'no';
  }
  return answers;
}

/** Build a complete valid answers object (all 38 keys, all 'yes'). */
function allYes() {
  const answers = {};
  for (const so of SUB_OPTIONS) {
    answers[so.key] = 'yes';
  }
  return answers;
}

/** Valid motivations. */
function validMotivations() {
  return {
    selected: ['ethos', 'fan_demand'],
    rankings: { ethos: 1, fan_demand: 2 },
  };
}

/** Fresh stream with ValidateSurvey. */
function fresh() {
  const s = new Stream();
  s.register(new ValidateSurvey());
  return s;
}

// ── T2A.1 — Complete valid survey with motivations ──

test('T2A.1 — complete valid survey passes validation', () => {
  const s = fresh();
  s.emit(new Event('survey_raw', {
    location: 'Phoenix, AZ',
    motivations: validMotivations(),
    answers: allNo(),
  }));
  const { pending } = s.sampleHere();
  assertEqual(pending.length, 1);
  assertEqual(pending[0].type, 'survey_validated');
  assertEqual(pending[0].data.location, 'Phoenix, AZ');
  assert(pending[0].data.motivations.selected.includes('ethos'));
  assertEqual(Object.keys(pending[0].data.answers).length, 38);
});

test('T2A.1b — all-yes survey also passes', () => {
  const s = fresh();
  s.emit(new Event('survey_raw', {
    location: 'Denver, CO',
    motivations: { selected: ['commercial'], rankings: { commercial: 1 } },
    answers: allYes(),
  }));
  assertEqual(s.sampleHere().pending[0].type, 'survey_validated');
});

// ── T2A.2 — Empty motivations.selected ──────────

test('T2A.2 — empty motivations.selected produces survey_invalid', () => {
  const s = fresh();
  s.emit(new Event('survey_raw', {
    location: 'X',
    motivations: { selected: [], rankings: {} },
    answers: allNo(),
  }));
  const p = s.sampleHere().pending[0];
  assertEqual(p.type, 'survey_invalid');
  assert(p.data.errors.some(e => e.includes('selected') && e.includes('non-empty')));
});

// ── T2A.3 — Ranking missing for selected motivation ─

test('T2A.3 — ranking missing for selected slug produces survey_invalid', () => {
  const s = fresh();
  s.emit(new Event('survey_raw', {
    location: 'X',
    motivations: {
      selected: ['ethos', 'fan_demand'],
      rankings: { ethos: 1 },  // fan_demand missing
    },
    answers: allNo(),
  }));
  const p = s.sampleHere().pending[0];
  assertEqual(p.type, 'survey_invalid');
  assert(p.data.errors.some(e => e.includes('fan_demand')));
});

// ── T2A.4 — Duplicate ranking values ────────────

test('T2A.4 — duplicate ranking values produce survey_invalid', () => {
  const s = fresh();
  s.emit(new Event('survey_raw', {
    location: 'X',
    motivations: {
      selected: ['ethos', 'fan_demand'],
      rankings: { ethos: 1, fan_demand: 1 },  // both rank 1
    },
    answers: allNo(),
  }));
  const p = s.sampleHere().pending[0];
  assertEqual(p.type, 'survey_invalid');
  assert(p.data.errors.some(e => e.includes('duplicate rank')));
});

// ── T2A.5 — Invalid answer for sub-option ───────

test('T2A.5 — invalid answer for pattern-A sub-option produces survey_invalid', () => {
  const s = fresh();
  const answers = allNo();
  answers.q2_leed = 'partial';  // q2_leed only allows yes/no/idk
  s.emit(new Event('survey_raw', {
    location: 'X',
    motivations: validMotivations(),
    answers,
  }));
  const p = s.sampleHere().pending[0];
  assertEqual(p.type, 'survey_invalid');
  assert(p.data.errors.some(e => e.includes('q2_leed') && e.includes('partial')));
});

test('T2A.5b — invalid answer for pattern-B sub-option', () => {
  const s = fresh();
  const answers = allNo();
  answers.q10_employees = 'most';  // pattern B: yes/soon/no/idk only
  s.emit(new Event('survey_raw', {
    location: 'X',
    motivations: validMotivations(),
    answers,
  }));
  const p = s.sampleHere().pending[0];
  assertEqual(p.type, 'survey_invalid');
  assert(p.data.errors.some(e => e.includes('q10_employees')));
});

// ── T2A.6 — Missing sub-option key ─────────────

test('T2A.6 — missing sub-option key produces survey_invalid', () => {
  const s = fresh();
  const answers = allNo();
  delete answers.q14_xeriscape;
  s.emit(new Event('survey_raw', {
    location: 'X',
    motivations: validMotivations(),
    answers,
  }));
  const p = s.sampleHere().pending[0];
  assertEqual(p.type, 'survey_invalid');
  assert(p.data.errors.some(e => e.includes('q14_xeriscape')));
});

// ── T2A.7 — Empty location ─────────────────────

test('T2A.7 — empty location produces survey_invalid', () => {
  const s = fresh();
  s.emit(new Event('survey_raw', {
    location: '',
    motivations: validMotivations(),
    answers: allNo(),
  }));
  assertEqual(s.sampleHere().pending[0].type, 'survey_invalid');
});

test('T2A.7b — whitespace-only location produces survey_invalid', () => {
  const s = fresh();
  s.emit(new Event('survey_raw', {
    location: '   ',
    motivations: validMotivations(),
    answers: allNo(),
  }));
  assertEqual(s.sampleHere().pending[0].type, 'survey_invalid');
});

// ── T2A.8 — Multiple errors collected ───────────

test('T2A.8 — multiple problems produce multiple errors in one event', () => {
  const s = fresh();
  s.emit(new Event('survey_raw', {
    location: '',         // error
    motivations: { selected: [], rankings: {} },  // error
    answers: { q2_leed: 'partial' },  // wrong answer + 34 missing keys
  }));
  const p = s.sampleHere().pending[0];
  assertEqual(p.type, 'survey_invalid');
  assert(p.data.errors.length >= 3, `expected >=3 errors, got ${p.data.errors.length}`);
});

// ── T2A.9 — Unknown motivation slug ─────────────

test('T2A.9 — unknown motivation slug produces survey_invalid', () => {
  const s = fresh();
  s.emit(new Event('survey_raw', {
    location: 'X',
    motivations: {
      selected: ['ethos', 'fake_motivation'],
      rankings: { ethos: 1, fake_motivation: 2 },
    },
    answers: allNo(),
  }));
  const p = s.sampleHere().pending[0];
  assertEqual(p.type, 'survey_invalid');
  assert(p.data.errors.some(e => e.includes('fake_motivation')));
});

// ── T2A.10 — Unknown answer key ─────────────────

test('T2A.10 — unknown answer key produces error', () => {
  const s = fresh();
  const answers = allNo();
  answers.q99_fake = 'yes';
  s.emit(new Event('survey_raw', {
    location: 'X',
    motivations: validMotivations(),
    answers,
  }));
  const p = s.sampleHere().pending[0];
  assertEqual(p.type, 'survey_invalid');
  assert(p.data.errors.some(e => e.includes('q99_fake') && e.includes('unknown')));
});

// ── T2A.11 — Valid 'soon' answer on pattern-B ───

test('T2A.11 — soon answer valid on pattern-B sub-option', () => {
  const s = fresh();
  const answers = allNo();
  answers.q10_athletes = 'soon';
  s.emit(new Event('survey_raw', {
    location: 'X',
    motivations: validMotivations(),
    answers,
  }));
  assertEqual(s.sampleHere().pending[0].type, 'survey_validated');
});

// ── T2A.12 — Valid 'partial' and 'most' on pattern-D ─

test('T2A.12 — partial and most valid on pattern-D sub-options', () => {
  const s = fresh();
  const answers = allNo();
  answers.q3_led = 'partial';
  answers.q7_graywater = 'most';
  answers.q13_signage = 'na';
  s.emit(new Event('survey_raw', {
    location: 'X',
    motivations: validMotivations(),
    answers,
  }));
  assertEqual(s.sampleHere().pending[0].type, 'survey_validated');
});

// ── Report ───────────────────────────────────────

const exitCode = report('phase2a');
process.exit(exitCode);
