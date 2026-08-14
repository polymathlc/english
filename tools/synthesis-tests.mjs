// Regression tests for ✍️ SYNTHESIS & TRANSFORMATION. Run with:
//     node tools/synthesis-tests.mjs            all cases
//     node tools/synthesis-tests.mjs <name>     one case
//
// It loads the REAL section out of app.js — the accessors, `syRubric`,
// `_openAnswerText`, `syPrintHtml` — plus the `synthesis` arm of
// `buildBlocksFromAi`.
//
// Two things here fail silently and a class pays for both.
//
// `syRubric` is the ONE place the marker is told what "correct" means. Lose it
// and the AI falls back to comparing the student's wording against the model
// answer — and a sentence transformation has ONE right meaning but many right
// wordings, so a correct rewrite phrased differently is marked wrong. Nothing
// throws; the child simply gets a red border on a right answer.
//
// `_openAnswerText` puts back the opening the PAPER gave. "This plot of corn"
// is printed beside the box, not typed into it, so without this the marker is
// handed a sentence fragment — "was grown from scratch by the farmer" — and
// marks a perfect answer as not a sentence.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const cut = (from, to, what) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(what + ': "' + from + '" not found in app.js');
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(what + ': end marker not found');
  return src.slice(a, b);
};

const section = [
  cut('const SY_MARKS_DEFAULT', "// ---- the student's box", 'synthesis core'),
  cut('function syPrintHtml(block)', '\n}\n', 'print') + '\n}\n',
  // The synthesis arm of the builder, reached through the real function.
  'const SY_LINES_DEFAULT_X = SY_LINES_DEFAULT;',
  cut('function buildBlocksFromAi', '\n// Build a full pending question object', 'builder'),
  `
let _n = 0;
function generateBlockId() { return 'b' + (++_n); }
function stripHtml(c) { return c ? String(c).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim() : ''; }
function _separateOptionLines(t) { return String(t == null ? '' : t); }
function _markedToBlanks(t) { return { content: String(t == null ? '' : t), blanks: {} }; }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escapeHtmlKeepLines(s) { return escapeHtml(s); }
function qApplyAiParts(b) { return b; }
const QPART_NONE = '-';
function qPartNormalize(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase().replace(/[()\s.]/g, '');
  if (/^[1-9]\d{0,2}$/.test(t)) return t;
  return (t.length === 1 && 'abcdefghjklmnopqrstuvwxyz'.indexOf(t) >= 0) ? t : '';
}
`
].join('\n');

const M = new Function(section +
  '\nreturn { syIsBlock, syGiven, syCue, syAnswer, syStartsWith, syMarks, syLines, syReady,' +
  ' syRubric, _openAnswerText, syPrintHtml, buildBlocksFromAi, SY_MARKS_DEFAULT, SY_LINES_MAX };')();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};

// The five questions off the paper.
const Q66 = { type: 'synthesis', given: 'We admire Mr Kwan. He is our local football player.', cue: 'whom', cuePos: 'use', answer: 'Mr Kwan, whom we admire, is our local football player.', marks: 2 };
const Q67 = { type: 'synthesis', given: 'The farmer grew this plot of corn from scratch.', cue: 'This plot of corn', cuePos: 'start', answer: 'This plot of corn was grown from scratch by the farmer.', marks: 2 };
const Q70 = { type: 'synthesis', given: 'Produce the voucher to get your meal.', cue: 'or', cuePos: 'use', answer: 'Produce the voucher or you will not get your meal.', marks: 2 };
// A textarea, as the marking paths see it.
const box = (value, prefix) => ({ value, dataset: prefix ? { prefix } : {} });

// ── the block itself ────────────────────────────────────────────────────────

test('a block with nothing given is not a question yet', () => {
  ok(!M.syReady({ type: 'synthesis', given: '   ' }), 'an empty given must not render an answer box');
  ok(M.syReady(Q66), 'a real one must');
  ok(!M.syReady({ type: 'text', given: 'x' }), 'only a synthesis block counts');
});

test('the two cue positions are distinguished', () => {
  ok(!M.syStartsWith(Q66), '"whom" is printed at the end of the rule');
  ok(M.syStartsWith(Q67), '"This plot of corn" is the given opening');
  ok(!M.syStartsWith({ type: 'synthesis', cue: 'x' }), 'the default is "use"');
});

test('marks and lines fall back rather than going NaN', () => {
  eq(M.syMarks(Q66), 2);
  [null, undefined, 0, -1, 21, 'x', {}].forEach(v => eq(M.syMarks({ marks: v }), M.SY_MARKS_DEFAULT, 'marks ' + JSON.stringify(v)));
  eq(M.syLines({ lines: 99 }), M.SY_LINES_MAX, 'a runaway line count is capped');
  eq(M.syLines({ lines: 3 }), 3);
});

test('a malformed block never throws', () => {
  [null, undefined, {}, { type: 'synthesis' }, { type: 'synthesis', given: null, cue: null }]
    .forEach(b => { M.syGiven(b); M.syCue(b); M.syAnswer(b); M.syMarks(b); M.syLines(b); M.syReady(b); M.syPrintHtml(b); });
});

// ── _openAnswerText — the opening the paper gave ────────────────────────────

test('the given opening is put back before marking', () => {
  // The box holds only what the student wrote; "This plot of corn" was printed.
  eq(M._openAnswerText(box('was grown from scratch by the farmer.', 'This plot of corn')),
     'This plot of corn was grown from scratch by the farmer.');
});

test('an ordinary answer box is unchanged', () => {
  eq(M._openAnswerText(box('  Mr Kwan, whom we admire, is our local football player.  ')),
     'Mr Kwan, whom we admire, is our local football player.');
});

test('an empty box stays empty — the prefix alone is not an answer', () => {
  // Otherwise an untouched box reads as "This plot of corn", the marker is
  // asked to judge it, and "you did not answer" becomes "that is not a
  // sentence".
  eq(M._openAnswerText(box('', 'This plot of corn')), '');
  eq(M._openAnswerText(box('   ', 'This plot of corn')), '');
});

test('a missing element or dataset never throws', () => {
  eq(M._openAnswerText(null), '');
  eq(M._openAnswerText({ value: 'x' }), 'x');
  eq(M._openAnswerText({}), '');
});

// ── syRubric — what the marker is actually told ─────────────────────────────

test('the rubric says to mark the sentence AS A WHOLE', () => {
  const r = M.syRubric(Q66);
  ok(/AS ONE WHOLE SENTENCE/i.test(r), 'the whole-sentence instruction is missing: ' + r);
  ok(/never phrase by phrase/i.test(r), 'phrase-by-phrase must be ruled out');
});

test('the rubric protects a correct rewrite that is worded differently', () => {
  // The single most likely way this question type marks a class unfairly.
  const r = M.syRubric(Q66);
  ok(/[Dd]ifferent wording from the model answer is FINE/.test(r), 'wording latitude is missing: ' + r);
  ok(/more than one correct rewrite/i.test(r), 'the marker must be told there are several right answers');
});

test('the rubric names the word the sentence must use', () => {
  ok(/"whom"/.test(M.syRubric(Q66)), 'the cue must be quoted into the rubric');
  ok(/"or"/.test(M.syRubric(Q70)));
});

test('a given OPENING is described as an opening, not just a word to include', () => {
  const r = M.syRubric(Q67);
  ok(/as its opening/i.test(r), 'the opening requirement is missing: ' + r);
  ok(!/as its opening/i.test(M.syRubric(Q66)), '"whom" is not an opening');
});

test('the three verdicts are each given a meaning', () => {
  const r = M.syRubric(Q66);
  ok(/"correct"/.test(r) && /"partial"/.test(r) && /"incorrect"/.test(r), 'a verdict was left undefined: ' + r);
  ok(/meaning changes/i.test(r), 'a changed meaning must be incorrect');
});

test('a question with no word provided still gets a usable rubric', () => {
  const r = M.syRubric({ type: 'synthesis', given: 'He ran. He was tired.' });
  ok(/AS ONE WHOLE SENTENCE/i.test(r));
  ok(!/uses ""/.test(r), 'an empty cue must not be quoted in');
});

// ── the printed page ────────────────────────────────────────────────────────

test('the word provided prints at the END of the rule when it is a "use" cue', () => {
  const h = M.syPrintHtml(Q66);
  ok(h.indexOf('print-sy-rule') < h.indexOf('whom'), '"whom" should follow the rule, as the paper prints it');
});

test('a given OPENING prints at the START of the rule', () => {
  const h = M.syPrintHtml(Q67);
  ok(h.indexOf('This plot of corn') < h.indexOf('print-sy-rule'), 'the opening should precede the rule');
});

test('the printed page never shows the model answer', () => {
  // The trap fillblank fell into: the read-only rendering prints the answer,
  // which on a worksheet is the whole question given away.
  const h = M.syPrintHtml(Q67);
  ok(h.indexOf('was grown from scratch by the farmer') < 0, 'the answer is printed on the question page');
  ok(M.syPrintHtml(Q66).indexOf('whom we admire') < 0);
});

test('the marks box and the right number of rules are drawn', () => {
  const h = M.syPrintHtml(Object.assign({}, Q66, { lines: 3 }));
  ok(/print-sy-box/.test(h), 'the marks box is missing');
  eq((h.match(/class="print-sy-line"/g) || []).length, 3);
});

test('a block with nothing given prints nothing at all', () => {
  eq(M.syPrintHtml({ type: 'synthesis', given: '', cue: 'whom' }), '');
});

// ── read off a screenshot ───────────────────────────────────────────────────

const build = blocks => M.buildBlocksFromAi({ blocks }).blocks;

test('the AI can build one, with its part', () => {
  const bs = build([{
    type: 'synthesis', part: 'a',
    given: 'We admire Mr Kwan. He is our local football player.',
    cue: 'whom', cuePos: 'use',
    answer: 'Mr Kwan, whom we admire, is our local football player.', marks: 2
  }]);
  eq(bs.length, 1);
  eq(bs[0].type, 'synthesis');
  eq(bs[0].given, 'We admire Mr Kwan. He is our local football player.');
  eq(bs[0].cue, 'whom');
  eq(bs[0].cuePos, 'use');
  eq(bs[0].marks, 2);
});

test('cuePos falls back to "use" for anything that is not "start"', () => {
  eq(build([{ type: 'synthesis', given: 'g', cuePos: 'START' }])[0].cuePos, 'start');
  eq(build([{ type: 'synthesis', given: 'g', cuePos: 'end' }])[0].cuePos, 'use');
  eq(build([{ type: 'synthesis', given: 'g' }])[0].cuePos, 'use');
});

test('a synthesis entry with nothing given builds nothing', () => {
  eq(build([{ type: 'synthesis', cue: 'whom' }]).length, 0, 'an empty question must not reach the bank');
});

test('a nonsense marks value from the AI falls back', () => {
  eq(build([{ type: 'synthesis', given: 'g', marks: 'lots' }])[0].marks, M.SY_MARKS_DEFAULT);
  eq(build([{ type: 'synthesis', given: 'g', marks: 99 }])[0].marks, M.SY_MARKS_DEFAULT);
});

// ── runner ───────────────────────────────────────────────────────────────────

const only = process.argv[2];
let passed = 0, failed = 0;
for (const c of cases) {
  if (only && c.name !== only) continue;
  try { c.fn(); console.log('  ok   ' + c.name); passed++; }
  catch (err) { console.log('  FAIL ' + c.name + '\n         ' + err.message); failed++; }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
