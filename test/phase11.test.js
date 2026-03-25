import { test, assertEqual, assert, report, reset } from './runner.js';
import { Event } from '../src/core/Event.js';
import { Stream } from '../src/core/Stream.js';
import { StreamLog } from '../src/core/StreamLog.js';
import { MiniDocument, buildSurveyDOM } from './minidom.js';

import { BuildSurveyForm } from '../src/gates/frontend/BuildSurveyForm.js';
import { CaptureSurveyForm } from '../src/gates/frontend/CaptureSurveyForm.js';
import { ValidateSurvey } from '../src/gates/ValidateSurvey.js';
import { GenerateTipsStub } from '../src/gates/GenerateTipsStub.js';
import { ShapeTips } from '../src/gates/ShapeTips.js';
import { RenderTipCards } from '../src/gates/frontend/RenderTipCards.js';
import { RenderTipGenerationError } from '../src/gates/frontend/RenderTipGenerationError.js';
import { ValidateTipRequest } from '../src/gates/ValidateTipRequest.js';
import { createSearchToolStream } from '../src/streams/SearchToolStream.js';
import { SUB_OPTIONS } from '../src/survey/definition.js';

// ── Taxonomy maps ────────────────────────────────
const CATS = new Map([
  ['energy_use', { slug: 'energy_use', name: 'Energy Use' }],
  ['fan_community_engagement', { slug: 'fan_community_engagement', name: 'Fan & Community Engagement' }],
  ['travel_transportation', { slug: 'travel_transportation', name: 'Travel & Transportation' }],
  ['sourcing_procurement', { slug: 'sourcing_procurement', name: 'Sourcing & Procurement' }],
  ['food_waste', { slug: 'food_waste', name: 'Food Waste' }],
  ['material_waste', { slug: 'material_waste', name: 'Material Waste' }],
  ['water_use', { slug: 'water_use', name: 'Water Use' }],
  ['biodiversity', { slug: 'biodiversity', name: 'Biodiversity' }],
]);
const CAT_SLUGS = new Set(CATS.keys());
const DIFFS = new Map([
  ['rookie', { slug: 'rookie', name: 'Rookie', display_label: 'Rookie Stage' }],
  ['playmaker', { slug: 'playmaker', name: 'Playmaker', display_label: 'Playmaker Stage' }],
  ['all_star', { slug: 'all_star', name: 'All-Star', display_label: 'All-Star Stage' }],
]);
const DIFF_SLUGS = new Set(DIFFS.keys());
const SIZES = new Map([
  ['quick_win', { slug: 'quick_win', name: 'Quick Win', display_label: 'Quick Win Action' }],
  ['power_play', { slug: 'power_play', name: 'Power Play', display_label: 'Power Play Action' }],
  ['game_changer', { slug: 'game_changer', name: 'Game Changer', display_label: 'Game Changer Action' }],
]);
const SIZE_SLUGS = new Set(SIZES.keys());
const SDG_MAP = new Map([
  ['energy_use', [7, 13]], ['fan_community_engagement', [4, 11, 17]],
  ['travel_transportation', [11, 13]], ['sourcing_procurement', [12]],
  ['food_waste', [2, 12]], ['material_waste', [12, 14, 15]],
  ['water_use', [6, 14]], ['biodiversity', [13, 15]],
]);

function allAnswers(ans) {
  const answers = {};
  for (const so of SUB_OPTIONS) {
    answers[so.key] = so.allowed.has(ans) ? ans : 'no';
  }
  return answers;
}

function mockAnalysis() {
  const base = {};
  for (const cat of CAT_SLUGS) {
    base[cat] = { ambition_level: 'power_play', sustainability_level: 'playmaker' };
  }
  return {
    priorities: ['energy_use', 'water_use', 'food_waste'],
    all_categories: [...CAT_SLUGS],
    classifications: base,
    scores: {}, motivations: { selected: ['ethos'], rankings: { ethos: 1 } }, location: 'X',
  };
}

// ═══════════════════════════════════════════════════
// 1. SINGLE-COLUMN REORDER (BuildSurveyForm)
// ═══════════════════════════════════════════════════

test('P11.1 — BuildSurveyForm: generates reorder-list (not dnd-container)', () => {
  const doc = new MiniDocument();
  const container = doc.createElement('div');
  container.id = 'surveyFormContainer';
  doc.addElement(container);

  const s = new Stream();
  s.register(new BuildSurveyForm(doc, CATS));
  s.emit(new Event('survey_form_build', {}));

  const reorderList = doc.getElementById('motivationRankedList');
  assert(reorderList !== null, 'motivationRankedList exists');
  assert(reorderList._classList.has('reorder-list'), 'has reorder-list class');

  const dndContainer = container.querySelector('.dnd-container');
  assertEqual(dndContainer, null, 'no dnd-container');
  const dndPool = doc.getElementById('motivationPoolList');
  assertEqual(dndPool, null, 'no motivationPoolList');
});

test('P11.2 — BuildSurveyForm: reorder list has all 6 motivations', () => {
  const doc = new MiniDocument();
  const container = doc.createElement('div');
  container.id = 'surveyFormContainer';
  doc.addElement(container);

  const s = new Stream();
  s.register(new BuildSurveyForm(doc, CATS));
  s.emit(new Event('survey_form_build', {}));

  const items = doc.getElementById('motivationRankedList').querySelectorAll('.reorder-item');
  assertEqual(items.length, 6, 'all 6 motivations present');

  const slugs = items.map(i => i.getAttribute('data-slug'));
  assert(slugs.includes('ethos'), 'ethos');
  assert(slugs.includes('regulatory'), 'regulatory');
  assert(slugs.includes('partnership'), 'partnership');
});

test('P11.3 — BuildSurveyForm: no dnd-empty-hint', () => {
  const doc = new MiniDocument();
  const container = doc.createElement('div');
  container.id = 'surveyFormContainer';
  doc.addElement(container);

  const s = new Stream();
  s.register(new BuildSurveyForm(doc, CATS));
  s.emit(new Event('survey_form_build', {}));

  assertEqual(doc.getElementById('dndEmptyHint'), null, 'no empty hint');
});

test('P11.4 — CaptureSurveyForm: reads reorder-item elements', () => {
  const doc = new MiniDocument();
  buildSurveyDOM(doc, {
    location: 'Portland, OR',
    motivations: {
      selected: ['ethos', 'sponsor', 'fan_demand'],
      rankings: { ethos: 1, sponsor: 2, fan_demand: 3 },
    },
    answers: allAnswers('yes'),
  });

  const s = new Stream();
  s.register(new CaptureSurveyForm(doc));
  s.emit(new Event('survey_form_captured', {}));

  const { pending } = s.sampleHere();
  assertEqual(pending[0].type, 'survey_raw', 'type');
  const { motivations } = pending[0].data;
  assertEqual(motivations.selected[0], 'ethos', 'rank 1');
  assertEqual(motivations.selected[1], 'sponsor', 'rank 2');
  assertEqual(motivations.selected[2], 'fan_demand', 'rank 3');
  assertEqual(motivations.rankings.ethos, 1);
  assertEqual(motivations.rankings.sponsor, 2);
  assertEqual(motivations.rankings.fan_demand, 3);
});

// ═══════════════════════════════════════════════════
// 2. ALPHABETICAL SUB-QUESTION LABELS
// ═══════════════════════════════════════════════════

test('P11.5 — BuildSurveyForm: Q13 sub-options labeled (a)(b)(c)(d)', () => {
  const doc = new MiniDocument();
  const container = doc.createElement('div');
  container.id = 'surveyFormContainer';
  doc.addElement(container);

  const s = new Stream();
  s.register(new BuildSurveyForm(doc, CATS));
  s.emit(new Event('survey_form_build', {}));

  const pairs = [
    ['q13_signage', '(a)'],
    ['q13_contests', '(b)'],
    ['q13_event_day', '(c)'],
    ['q13_facility_tour', '(d)'],
  ];
  for (const [key, prefix] of pairs) {
    const group = container.querySelector(`[data-key="${key}"]`);
    assert(group !== null, `${key} exists`);
    const label = group.querySelector('.sub-option-label');
    assert(label.textContent.startsWith(prefix), `${key} starts with ${prefix}: "${label.textContent}"`);
  }
});

test('P11.6 — BuildSurveyForm: single sub-option has NO letter prefix', () => {
  const doc = new MiniDocument();
  const container = doc.createElement('div');
  container.id = 'surveyFormContainer';
  doc.addElement(container);

  const s = new Stream();
  s.register(new BuildSurveyForm(doc, CATS));
  s.emit(new Event('survey_form_build', {}));

  for (const key of ['q2_leed', 'q9_composting', 'q6_ppa']) {
    const group = container.querySelector(`[data-key="${key}"]`);
    const label = group.querySelector('.sub-option-label');
    assert(!label.textContent.startsWith('('), `${key} has no prefix: "${label.textContent}"`);
  }
});

test('P11.7 — BuildSurveyForm: headings use "Question N" not "QN."', () => {
  const doc = new MiniDocument();
  const container = doc.createElement('div');
  container.id = 'surveyFormContainer';
  doc.addElement(container);

  const s = new Stream();
  s.register(new BuildSurveyForm(doc, CATS));
  s.emit(new Event('survey_form_build', {}));

  const headings = container.querySelectorAll('h3');
  const oldFormat = headings.filter(h => /\bQ\d+\./.test(h.textContent));
  assertEqual(oldFormat.length, 0, 'no QN. format headings');

  const newFormat = headings.filter(h => /\bQuestion \d+\./.test(h.textContent));
  assert(newFormat.length > 0, 'at least one "Question N." heading');
});

// ═══════════════════════════════════════════════════
// 3. IMPROVED VALIDATION MESSAGES
// ═══════════════════════════════════════════════════

test('P11.8 — ValidateSurvey: missing location gives readable message', () => {
  const s = new Stream();
  s.register(new ValidateSurvey());
  s.emit(new Event('survey_raw', {
    location: '',
    motivations: { selected: ['ethos'], rankings: { ethos: 1 } },
    answers: allAnswers('yes'),
  }));
  const errors = s.sampleHere().pending[0].data.errors;
  assert(errors.some(e => e.includes('location')), 'mentions location');
  assert(errors.some(e => e.includes('Please')), 'user-friendly');
});

test('P11.9 — ValidateSurvey: empty motivations gives "Question 1" message', () => {
  const s = new Stream();
  s.register(new ValidateSurvey());
  s.emit(new Event('survey_raw', {
    location: 'Portland',
    motivations: { selected: [], rankings: {} },
    answers: allAnswers('yes'),
  }));
  const errors = s.sampleHere().pending[0].data.errors;
  assert(errors.some(e => e.includes('Question 1')), 'references Question 1');
});

test('P11.10 — ValidateSurvey: missing answer shows "Question N (letter)" + key', () => {
  const s = new Stream();
  s.register(new ValidateSurvey());
  const answers = allAnswers('yes');
  delete answers.q13_signage;

  s.emit(new Event('survey_raw', {
    location: 'Portland',
    motivations: { selected: ['ethos'], rankings: { ethos: 1 } },
    answers,
  }));
  const errors = s.sampleHere().pending[0].data.errors;
  assert(errors.some(e => e.includes('Question 13') && e.includes('(a)') && e.includes('q13_signage')),
    `error has Question 13, (a), and key: ${errors.join('; ')}`);
});

test('P11.11 — ValidateSurvey: invalid answer shows question + value', () => {
  const s = new Stream();
  s.register(new ValidateSurvey());
  const answers = allAnswers('yes');
  answers.q7_toilets = 'invalid_answer';

  s.emit(new Event('survey_raw', {
    location: 'Portland',
    motivations: { selected: ['ethos'], rankings: { ethos: 1 } },
    answers,
  }));
  const errors = s.sampleHere().pending[0].data.errors;
  assert(errors.some(e => e.includes('Question 7') && e.includes('invalid_answer')),
    `error has Question 7 and bad value: ${errors.join('; ')}`);
});

test('P11.12 — ValidateSurvey: valid survey still passes', () => {
  const s = new Stream();
  s.register(new ValidateSurvey());
  s.emit(new Event('survey_raw', {
    location: 'Portland, OR',
    motivations: { selected: ['ethos', 'sponsor'], rankings: { ethos: 1, sponsor: 2 } },
    answers: allAnswers('yes'),
  }));
  assertEqual(s.sampleHere().pending[0].type, 'survey_validated', 'passes');
});

// ═══════════════════════════════════════════════════
// 4. STUB NOTICE (DUMMY COPY)
// ═══════════════════════════════════════════════════

test('P11.13 — GenerateTipsStub: emits source = "stub"', () => {
  const s = new Stream();
  s.register(new GenerateTipsStub());
  s.emit(new Event('tip_request_valid', {
    distribution: [{ index: 0, category: 'energy_use' }],
    difficulty: 'rookie', size_of_impact: 'quick_win',
    notes: '', survey_analysis: mockAnalysis(),
  }));
  assertEqual(s.sampleHere().pending[0].data.context.source, 'stub');
});

test('P11.14 — ShapeTips: passes source through', () => {
  const s = new Stream();
  s.register(new ShapeTips(SDG_MAP));
  s.emit(new Event('tips_raw', {
    tips: [{ title: 'T', description: 'D', category: 'energy_use' }],
    context: { difficulty: 'rookie', size_of_impact: 'quick_win', source: 'stub' },
  }));
  assertEqual(s.sampleHere().pending[0].data.source, 'stub');
});

test('P11.15 — ShapeTips: passes "api" source through', () => {
  const s = new Stream();
  s.register(new ShapeTips(SDG_MAP));
  s.emit(new Event('tips_raw', {
    tips: [{ title: 'T', description: 'D', category: 'energy_use' }],
    context: { difficulty: 'rookie', size_of_impact: 'quick_win', source: 'api' },
  }));
  assertEqual(s.sampleHere().pending[0].data.source, 'api');
});

test('P11.16 — RenderTipCards: stub notice when source = "stub"', () => {
  const doc = new MiniDocument();
  const container = doc.createElement('div');
  container.id = 'tipsContainer';
  doc.addElement(container);

  const s = new Stream();
  s.register(new RenderTipCards(doc, CATS, DIFFS, SIZES));
  s.emit(new Event('tips_shaped', {
    tips: [{
      id: 'test1', title: 'T', description: 'D', impact_category: 'energy_use',
      difficulty: 'rookie', size_of_impact: 'quick_win', sdgs: [7, 13],
      status: 'pending', action_plan: null, financial_plan: null,
      start_date: null, end_date: null, cost: null, savings: null,
      sponsor_name: null, sponsor_dollars: null, imp_notes: null,
    }],
    source: 'stub',
  }));

  const notice = doc.getElementById('stubNotice');
  assert(notice !== null, 'notice exists');
  assert(notice._classList.has('stub-notice'), 'has class');
  assert(notice.textContent.includes('placeholder'), 'mentions placeholder');
});

test('P11.17 — RenderTipCards: no notice when source = "api"', () => {
  const doc = new MiniDocument();
  const container = doc.createElement('div');
  container.id = 'tipsContainer';
  doc.addElement(container);

  const s = new Stream();
  s.register(new RenderTipCards(doc, CATS, DIFFS, SIZES));
  s.emit(new Event('tips_shaped', {
    tips: [{
      id: 'test1', title: 'T', description: 'D', impact_category: 'energy_use',
      difficulty: 'rookie', size_of_impact: 'quick_win', sdgs: [7, 13],
      status: 'pending', action_plan: null, financial_plan: null,
      start_date: null, end_date: null, cost: null, savings: null,
      sponsor_name: null, sponsor_dollars: null, imp_notes: null,
    }],
    source: 'api',
  }));
  assertEqual(doc.getElementById('stubNotice'), null, 'no notice');
});

// ═══════════════════════════════════════════════════
// 5. ERROR RENDERING (RenderTipGenerationError)
// ═══════════════════════════════════════════════════

test('P11.18 — RenderTipGenerationError: network error', () => {
  const doc = new MiniDocument();
  const c = doc.createElement('div'); c.id = 'tipsContainer'; doc.addElement(c);

  const s = new Stream();
  s.register(new RenderTipGenerationError(doc));
  s.emit(new Event('tip_generation_error', { code: 'network', message: null, detail: null }));

  const box = doc.getElementById('tipGenerationError');
  assert(box !== null, 'error box exists');
  assert(box._classList.has('tip-generation-error'), 'has class');
  assert(box.querySelector('.tip-error-heading').textContent.includes('reach'), 'heading');
  assert(box.querySelector('.tip-error-body').textContent.includes('internet'), 'body');
});

test('P11.19 — RenderTipGenerationError: auth error', () => {
  const doc = new MiniDocument();
  const c = doc.createElement('div'); c.id = 'tipsContainer'; doc.addElement(c);

  const s = new Stream();
  s.register(new RenderTipGenerationError(doc));
  s.emit(new Event('tip_generation_error', { code: 'auth' }));

  const heading = doc.getElementById('tipGenerationError').querySelector('.tip-error-heading');
  assert(heading.textContent.includes('API') || heading.textContent.includes('configuration'), 'auth heading');
});

test('P11.20 — RenderTipGenerationError: custom message + detail', () => {
  const doc = new MiniDocument();
  const c = doc.createElement('div'); c.id = 'tipsContainer'; doc.addElement(c);

  const s = new Stream();
  s.register(new RenderTipGenerationError(doc));
  s.emit(new Event('tip_generation_error', {
    code: 'server', message: 'Claude returned HTTP 500', detail: 'Request ID: abc123',
  }));

  assertEqual(doc.getElementById('tipGenerationError').querySelector('.tip-error-body').textContent,
    'Claude returned HTTP 500', 'custom msg');
  assertEqual(doc.getElementById('tipGenerationError').querySelector('.tip-error-detail').textContent,
    'Request ID: abc123', 'detail');
});

test('P11.21 — RenderTipGenerationError: hides progress', () => {
  const doc = new MiniDocument();
  const c = doc.createElement('div'); c.id = 'tipsContainer'; doc.addElement(c);
  const p = doc.createElement('div'); p.id = 'generationProgress'; p.style.display = 'flex'; doc.addElement(p);

  const s = new Stream();
  s.register(new RenderTipGenerationError(doc));
  s.emit(new Event('tip_generation_error', { code: 'timeout' }));
  assertEqual(p.style.display, 'none', 'progress hidden');
});

test('P11.22 — RenderTipGenerationError: all codes produce distinct headings', () => {
  const codes = ['network', 'auth', 'rate_limit', 'server', 'timeout', 'unknown'];
  const headings = new Set();
  for (const code of codes) {
    const doc = new MiniDocument();
    const c = doc.createElement('div'); c.id = 'tipsContainer'; doc.addElement(c);
    const s = new Stream();
    s.register(new RenderTipGenerationError(doc));
    s.emit(new Event('tip_generation_error', { code }));
    headings.add(doc.getElementById('tipGenerationError').querySelector('.tip-error-heading').textContent);
  }
  assertEqual(headings.size, codes.length, 'all distinct');
});

// ═══════════════════════════════════════════════════
// 6. FULL PIPELINE INTEGRATION
// ═══════════════════════════════════════════════════

test('P11.23 — Full pipeline: stub → shape → render shows notice', () => {
  const doc = new MiniDocument();
  const c = doc.createElement('div'); c.id = 'tipsContainer'; doc.addElement(c);

  const log = new StreamLog('DATA');
  const s = new Stream({ log });
  s.register(new GenerateTipsStub());
  s.register(new ShapeTips(SDG_MAP));
  s.register(new RenderTipCards(doc, CATS, DIFFS, SIZES));

  s.emit(new Event('tip_request_valid', {
    distribution: [{ index: 0, category: 'energy_use' }, { index: 1, category: 'water_use' }],
    difficulty: 'rookie', size_of_impact: 'quick_win', notes: '', survey_analysis: mockAnalysis(),
  }));

  assert(doc.getElementById('stubNotice') !== null, 'stub notice');
  assertEqual(c.querySelectorAll('.tip-card-wrap').length, 2, '2 cards');

  const shapedEntry = log.sample().entries.find(e => e.type === 'tips_shaped');
  assertEqual(shapedEntry.data.source, 'stub', 'source in log');
});

test('P11.24 — SearchToolStream: tip_generation_error gate registered without collision', () => {
  const doc = new MiniDocument();
  const c = doc.createElement('div'); c.id = 'tipsContainer'; doc.addElement(c);

  // createSearchToolStream would throw on signature collision
  const stream = createSearchToolStream(doc, CAT_SLUGS, DIFF_SLUGS, SIZE_SLUGS, SDG_MAP,
    CATS, DIFFS, SIZES);

  // Emit error and verify it's claimed (not in pending)
  stream.emit(new Event('tip_generation_error', { code: 'network' }));
  const errorInPending = stream.sampleHere().pending.find(e => e.type === 'tip_generation_error');
  assertEqual(errorInPending, undefined, 'error claimed by gate');
});

// ── Report ───────────────────────────────────────
const exitCode = report('phase11');
process.exit(exitCode);
