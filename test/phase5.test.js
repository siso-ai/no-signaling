import { test, assertEqual, assert, report } from './runner.js';
import { Event } from '../src/core/Event.js';
import { Stream } from '../src/core/Stream.js';
import { StreamLog } from '../src/core/StreamLog.js';
import { MiniDocument, buildSurveyDOM } from './minidom.js';
import { SUB_OPTIONS } from '../src/survey/definition.js';

import { CaptureSurveyForm } from '../src/gates/frontend/CaptureSurveyForm.js';
import { RenderSurveyResults } from '../src/gates/frontend/RenderSurveyResults.js';
import { RenderSurveyError } from '../src/gates/frontend/RenderSurveyError.js';
import { ValidateSurvey } from '../src/gates/ValidateSurvey.js';
import { ScoreSurvey } from '../src/gates/ScoreSurvey.js';
import { ClassifySurvey } from '../src/gates/ClassifySurvey.js';
import { PrioritizeCategories } from '../src/gates/PrioritizeCategories.js';
import { createSurveyStream } from '../src/streams/SurveyStream.js';

// ── Test data ────────────────────────────────────

/** All 38 keys answered lowest-scoring valid answer. */
function allNo() {
  const a = {};
  for (const so of SUB_OPTIONS) a[so.key] = so.allowed.has('no') ? 'no' : 'idk';
  return a;
}

/** All 38 keys answered 'yes'. */
function allYes() {
  const a = {};
  for (const so of SUB_OPTIONS) a[so.key] = 'yes';
  return a;
}

const MOTIVATIONS = {
  selected: ['ethos', 'fan_demand'],
  rankings: { ethos: 1, fan_demand: 2 },
};

/** Build taxonomy Maps (normally from LoadTaxonomy, here inline for tests). */
function taxonomyMaps() {
  const categories = new Map([
    ['energy_use', { slug: 'energy_use', name: 'Energy Use' }],
    ['fan_community_engagement', { slug: 'fan_community_engagement', name: 'Fan & Community Engagement' }],
    ['travel_transportation', { slug: 'travel_transportation', name: 'Travel & Transportation' }],
    ['sourcing_procurement', { slug: 'sourcing_procurement', name: 'Sourcing & Procurement' }],
    ['food_waste', { slug: 'food_waste', name: 'Food Waste' }],
    ['material_waste', { slug: 'material_waste', name: 'Material Waste' }],
    ['water_use', { slug: 'water_use', name: 'Water Use' }],
    ['biodiversity', { slug: 'biodiversity', name: 'Biodiversity' }],
  ]);
  const difficulties = new Map([
    ['rookie', { slug: 'rookie', name: 'Rookie', display_label: 'Rookie Stage' }],
    ['playmaker', { slug: 'playmaker', name: 'Playmaker', display_label: 'Playmaker Stage' }],
    ['all_star', { slug: 'all_star', name: 'All-Star', display_label: 'All-Star Stage' }],
  ]);
  const sizes = new Map([
    ['quick_win', { slug: 'quick_win', name: 'Quick Win', display_label: 'Quick Win Action' }],
    ['power_play', { slug: 'power_play', name: 'Power Play', display_label: 'Power Play Action' }],
    ['game_changer', { slug: 'game_changer', name: 'Game Changer', display_label: 'Game Changer Action' }],
  ]);
  return { categories, difficulties, sizes };
}

// ══════════════════════════════════════════════════
// CaptureSurveyForm
// ══════════════════════════════════════════════════

test('T5.1 — CaptureSurveyForm reads 38 sub-options + motivations from DOM', () => {
  const doc = new MiniDocument();
  buildSurveyDOM(doc, {
    location: 'Phoenix, AZ',
    answers: allNo(),
    motivations: MOTIVATIONS,
  });

  const s = new Stream();
  s.register(new CaptureSurveyForm(doc));
  s.emit(new Event('survey_form_captured', {}));

  const { pending } = s.sampleHere();
  assertEqual(pending.length, 1);
  assertEqual(pending[0].type, 'survey_raw');

  const d = pending[0].data;
  assertEqual(d.location, 'Phoenix, AZ');
  assertEqual(Object.keys(d.answers).length, 38, 'all 38 answer keys captured');
  assertEqual(d.answers.q2_leed, 'no');
  assertEqual(d.answers.q14_xeriscape, 'no');

  // Motivations
  assert(d.motivations.selected.includes('ethos'), 'ethos checked');
  assert(d.motivations.selected.includes('fan_demand'), 'fan_demand checked');
  assertEqual(d.motivations.selected.length, 2);
  assertEqual(d.motivations.rankings.ethos, 1);
  assertEqual(d.motivations.rankings.fan_demand, 2);
});

test('T5.1b — CaptureSurveyForm reads mixed answers', () => {
  const answers = allNo();
  answers.q3_led = 'partial';
  answers.q7_graywater = 'most';
  answers.q10_fans = 'soon';

  const doc = new MiniDocument();
  buildSurveyDOM(doc, { location: 'Denver', answers, motivations: MOTIVATIONS });

  const s = new Stream();
  s.register(new CaptureSurveyForm(doc));
  s.emit(new Event('survey_form_captured', {}));

  const d = s.sampleHere().pending[0].data;
  assertEqual(d.answers.q3_led, 'partial');
  assertEqual(d.answers.q7_graywater, 'most');
  assertEqual(d.answers.q10_fans, 'soon');
  assertEqual(d.answers.q2_leed, 'no');
});

test('T5.1c — CaptureSurveyForm with single motivation', () => {
  const doc = new MiniDocument();
  buildSurveyDOM(doc, {
    location: 'X',
    answers: allNo(),
    motivations: { selected: ['commercial'], rankings: { commercial: 1 } },
  });

  const s = new Stream();
  s.register(new CaptureSurveyForm(doc));
  s.emit(new Event('survey_form_captured', {}));

  const d = s.sampleHere().pending[0].data;
  assertEqual(d.motivations.selected.length, 1);
  assertEqual(d.motivations.selected[0], 'commercial');
});

// ══════════════════════════════════════════════════
// RenderSurveyResults
// ══════════════════════════════════════════════════

test('T5.2 — survey_analyzed renders priorities into DOM', () => {
  const doc = new MiniDocument();
  buildSurveyDOM(doc);
  const { categories, difficulties, sizes } = taxonomyMaps();

  const s = new Stream();
  s.register(new RenderSurveyResults(doc, categories, difficulties, sizes));

  s.emit(new Event('survey_analyzed', {
    priorities: ['water_use', 'energy_use', 'food_waste'],
    all_categories: ['energy_use', 'fan_community_engagement', 'travel_transportation',
      'sourcing_procurement', 'food_waste', 'material_waste', 'water_use', 'biodiversity'],
    classifications: {
      energy_use: { ambition_level: 'game_changer', sustainability_level: 'all_star' },
      fan_community_engagement: { ambition_level: 'power_play', sustainability_level: 'playmaker' },
      travel_transportation: { ambition_level: 'quick_win', sustainability_level: 'rookie' },
      sourcing_procurement: { ambition_level: 'power_play', sustainability_level: 'playmaker' },
      food_waste: { ambition_level: 'quick_win', sustainability_level: 'rookie' },
      material_waste: { ambition_level: 'power_play', sustainability_level: 'playmaker' },
      water_use: { ambition_level: 'quick_win', sustainability_level: 'rookie' },
      biodiversity: { ambition_level: 'power_play', sustainability_level: 'playmaker' },
    },
    scores: {
      energy_use: { ambition: 60, sustainability: 50 },
      fan_community_engagement: { ambition: 20, sustainability: 18 },
      travel_transportation: { ambition: 10, sustainability: 8 },
      sourcing_procurement: { ambition: 15, sustainability: 12 },
      food_waste: { ambition: 2, sustainability: 2 },
      material_waste: { ambition: 5, sustainability: 5 },
      water_use: { ambition: 8, sustainability: 6 },
      biodiversity: { ambition: 12, sustainability: 14 },
    },
    motivations: MOTIVATIONS,
    location: 'Phoenix',
  }));

  // Results container visible
  assertEqual(doc.getElementById('resultsContainer').style.display, 'block');

  // Loading hidden
  assertEqual(doc.getElementById('loadingOverlay').style.display, 'none');

  // Priority list has 3 children
  const priorityList = doc.getElementById('priorityList');
  assertEqual(priorityList.children.length, 3);
  assertEqual(priorityList.children[0].querySelector('.priority-label').textContent, 'Water Use');
  assertEqual(priorityList.children[1].querySelector('.priority-label').textContent, 'Energy Use');
  assertEqual(priorityList.children[2].querySelector('.priority-label').textContent, 'Food Waste');
  assert(priorityList.children[0].getAttribute('data-category') === 'water_use');

  // Summary section rendered with location
  const summary = doc.getElementById('resultsSummary');
  assert(summary !== null, 'results summary exists');
  const locValue = doc.getElementById('resultsLocationValue');
  assertEqual(locValue.textContent, 'Phoenix', 'location displayed');
});

test('T5.2b — display labels are used in summary (Rookie, Quick Win Action)', () => {
  const doc = new MiniDocument();
  buildSurveyDOM(doc);
  const { categories, difficulties, sizes } = taxonomyMaps();

  const s = new Stream();
  s.register(new RenderSurveyResults(doc, categories, difficulties, sizes));

  s.emit(new Event('survey_analyzed', {
    priorities: ['energy_use'],
    all_categories: ['energy_use', 'fan_community_engagement', 'travel_transportation',
      'sourcing_procurement', 'food_waste', 'material_waste', 'water_use', 'biodiversity'],
    classifications: Object.fromEntries(
      ['energy_use', 'fan_community_engagement', 'travel_transportation', 'sourcing_procurement',
        'food_waste', 'material_waste', 'water_use', 'biodiversity'].map(c => [c,
        { ambition_level: 'quick_win', sustainability_level: 'rookie' }])
    ),
    scores: Object.fromEntries(
      ['energy_use', 'fan_community_engagement', 'travel_transportation', 'sourcing_procurement',
        'food_waste', 'material_waste', 'water_use', 'biodiversity'].map(c => [c, { ambition: 5, sustainability: 3 }])
    ),
    motivations: MOTIVATIONS,
    location: 'X',
  }));

  // Stage highlight should say "Rookie" (name, not slug)
  const stageEl = doc.getElementById('resultsSummary').querySelector('.stage-highlight');
  assert(stageEl !== null, 'stage highlight exists');
  assertEqual(stageEl.textContent, 'Rookie', 'stage name');

  // Ambition highlight should say "Quick Win Action" (display_label)
  const ambEl = doc.getElementById('resultsSummary').querySelector('.ambition-highlight');
  assert(ambEl !== null, 'ambition highlight exists');
  assertEqual(ambEl.textContent, 'Quick Win Action', 'ambition label');
});

test('T5.2c — results include Definitions Guide link and action buttons', () => {
  const doc = new MiniDocument();
  buildSurveyDOM(doc);
  const { categories, difficulties, sizes } = taxonomyMaps();

  const s = new Stream();
  s.register(new RenderSurveyResults(doc, categories, difficulties, sizes));

  s.emit(new Event('survey_analyzed', {
    priorities: ['water_use'],
    all_categories: ['energy_use', 'fan_community_engagement', 'travel_transportation',
      'sourcing_procurement', 'food_waste', 'material_waste', 'water_use', 'biodiversity'],
    classifications: Object.fromEntries(
      ['energy_use', 'fan_community_engagement', 'travel_transportation', 'sourcing_procurement',
        'food_waste', 'material_waste', 'water_use', 'biodiversity'].map(c => [c,
        { ambition_level: 'power_play', sustainability_level: 'playmaker' }])
    ),
    scores: Object.fromEntries(
      ['energy_use', 'fan_community_engagement', 'travel_transportation', 'sourcing_procurement',
        'food_waste', 'material_waste', 'water_use', 'biodiversity'].map(c => [c, { ambition: 15, sustainability: 12 }])
    ),
    motivations: MOTIVATIONS,
    location: 'X',
  }));

  // Definitions Guide link
  const defLink = doc.getElementById('resultsSummary').querySelector('.internal-link');
  assert(defLink !== null, 'definitions link exists');
  assertEqual(defLink.textContent, 'Definitions Guide');
  assertEqual(defLink.getAttribute('data-page'), 'definitions');

  // Action buttons
  const results = doc.getElementById('resultsContainer');
  const retakeBtn = results.querySelector('#retakeSurveyBtn');
  assert(retakeBtn !== null, 'retake button exists');

  const searchLink = results.querySelector('[data-page="search"]');
  assert(searchLink !== null, 'search tool link exists');
});

// ══════════════════════════════════════════════════
// RenderSurveyError
// ══════════════════════════════════════════════════

test('T5.3 — survey_invalid renders errors into DOM', () => {
  const doc = new MiniDocument();
  buildSurveyDOM(doc);

  const s = new Stream();
  s.register(new RenderSurveyError(doc));

  s.emit(new Event('survey_invalid', {
    errors: ['location is required', 'q2_leed: answer partial not allowed', 'missing key: q14_xeriscape'],
  }));

  const errorC = doc.getElementById('errorContainer');
  assertEqual(errorC.style.display, 'block');
  assertEqual(errorC.children.length, 3);
  assertEqual(errorC.children[0].textContent, 'location is required');
  assertEqual(errorC.children[1].textContent, 'q2_leed: answer partial not allowed');

  // Form still visible
  assertEqual(doc.getElementById('surveyForm').style.display, 'block');

  // Results hidden
  assertEqual(doc.getElementById('resultsContainer').style.display, 'none');
});

test('T5.3b — loading overlay hidden on error', () => {
  const doc = new MiniDocument();
  buildSurveyDOM(doc);
  doc.getElementById('loadingOverlay').style.display = 'block';

  const s = new Stream();
  s.register(new RenderSurveyError(doc));
  s.emit(new Event('survey_invalid', { errors: ['test error'] }));

  assertEqual(doc.getElementById('loadingOverlay').style.display, 'none');
});

// ══════════════════════════════════════════════════
// Full chain: DOM → capture → validate → score → classify → prioritize → render
// ══════════════════════════════════════════════════

test('T5.4 — full chain: DOM form → 7 gates → rendered results', () => {
  const doc = new MiniDocument();
  buildSurveyDOM(doc, {
    location: 'Miami, FL',
    answers: allYes(),
    motivations: MOTIVATIONS,
  });

  const { categories, difficulties, sizes } = taxonomyMaps();
  const log = new StreamLog('EVENTS');
  const s = createSurveyStream(doc, categories, difficulties, sizes, { log });

  s.emit(new Event('survey_form_captured', {}));

  // Results should be rendered
  assertEqual(doc.getElementById('resultsContainer').style.display, 'block');

  // All-yes → everything game_changer → 0 priorities
  const priorityList = doc.getElementById('priorityList');
  assertEqual(priorityList.children.length, 0, 'all-yes = no priorities');

  // Summary section should still be rendered
  const summary = doc.getElementById('resultsSummary');
  assert(summary !== null, 'summary rendered even with 0 priorities');

  // StreamLog: 7 claimed events + survey_analyzed is the last one
  // survey_form_captured → survey_raw → survey_validated → survey_scored
  // → survey_classified → survey_analyzed → (claimed by RenderSurveyResults)
  // That's 6 events all claimed. survey_analyzed is claimed by render (terminal).
  const entries = log.sample().entries;
  assert(entries.length >= 6, `expected >=6 log entries, got ${entries.length}`);
  assertEqual(entries[0].type, 'survey_form_captured');
  assertEqual(entries[0].claimed, 'survey_form_captured');
  assertEqual(entries[1].type, 'survey_raw');
  assertEqual(entries[1].claimed, 'survey_raw');  // ValidateSurvey
  assertEqual(entries[5].type, 'survey_analyzed');
  assertEqual(entries[5].claimed, 'survey_analyzed');  // RenderSurveyResults (terminal)
});

test('T5.4b — full chain: invalid survey → error rendered', () => {
  const doc = new MiniDocument();
  const answers = allNo();
  delete answers.q14_xeriscape;  // missing key → will fail validation

  buildSurveyDOM(doc, {
    location: 'X',
    answers,
    motivations: MOTIVATIONS,
  });

  const { categories, difficulties, sizes } = taxonomyMaps();
  const s = createSurveyStream(doc, categories, difficulties, sizes);

  s.emit(new Event('survey_form_captured', {}));

  // Error should be rendered
  assertEqual(doc.getElementById('errorContainer').style.display, 'block');
  assert(doc.getElementById('errorContainer').children.length > 0, 'has error items');

  // Results should NOT be rendered
  assertEqual(doc.getElementById('resultsContainer').style.display, 'none');
});

test('T5.4c — full chain: all-no survey → priorities populated', () => {
  const doc = new MiniDocument();
  buildSurveyDOM(doc, {
    location: 'Phoenix',
    answers: allNo(),
    motivations: MOTIVATIONS,
  });

  const { categories, difficulties, sizes } = taxonomyMaps();
  const s = createSurveyStream(doc, categories, difficulties, sizes);
  s.emit(new Event('survey_form_captured', {}));

  // All-no should produce low scores → 3 priorities
  const priorityList = doc.getElementById('priorityList');
  assertEqual(priorityList.children.length, 3);
  // First priority is energy_use (first in hierarchy)
  assertEqual(priorityList.children[0].querySelector('.priority-label').textContent, 'Energy Use');
});

test('T5.4d — full chain: nothing in pending (all events claimed)', () => {
  const doc = new MiniDocument();
  buildSurveyDOM(doc, {
    location: 'X',
    answers: allNo(),
    motivations: MOTIVATIONS,
  });

  const { categories, difficulties, sizes } = taxonomyMaps();
  const s = createSurveyStream(doc, categories, difficulties, sizes);
  s.emit(new Event('survey_form_captured', {}));

  // Terminal gate claims survey_analyzed → nothing in pending
  assertEqual(s.sampleHere().pending.length, 0, 'nothing in pending — all claimed');
});

test('T5.4e — full chain: mixed answers → correct priorities', () => {
  const doc = new MiniDocument();
  const answers = allYes();
  // Make water_use weak: lowest valid scores
  answers.q7_toilets = 'no';
  answers.q7_faucets = 'no';
  answers.q7_refill = 'no';
  answers.q7_graywater = 'no';
  answers.q7_rainwater = 'no';
  answers.q7_blackwater = 'no';

  buildSurveyDOM(doc, { location: 'X', answers, motivations: MOTIVATIONS });

  const { categories, difficulties, sizes } = taxonomyMaps();
  const s = createSurveyStream(doc, categories, difficulties, sizes);
  s.emit(new Event('survey_form_captured', {}));

  // water_use should be a priority (low scores while others are high)
  const priorityList = doc.getElementById('priorityList');
  const slugs = priorityList.children.map(c => c.getAttribute('data-category'));
  assert(slugs.includes('water_use'), 'water_use is a priority');
});

// ── Report ───────────────────────────────────────

const exitCode = report('phase5');
process.exit(exitCode);
