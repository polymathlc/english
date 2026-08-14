// Regression tests for 📝 THE OPEN COMPREHENSION CLOZE (`clozeopen`). Run with:
//     node tools/open-cloze-tests.mjs            all cases
//     node tools/open-cloze-tests.mjs <name>     one case
//
// It loads the REAL section out of app.js — the accessors, `coAlts`,
// `coAccepts`, `coStudentHtml`, `coMarkPassage`, `coPrintHtml`,
// `coAnswerKeyText` — plus the `clozeopen` arm of `buildBlocksFromAi`.
//
// This block type exists because of ONE fact: a cloze blank almost never has a
// single right answer. "Dishes like chicken rice ______ people from all
// backgrounds together" takes bring, draw, pull, tie. Everything here protects
// that, and every failure is silent — the passage still renders, still prints
// and still marks; it just marks children wrong for being right differently.
//
//  • `coAlts` is the ONE place `bring|draw|pull` becomes a list. Lose an entry
//    and the word it dropped is marked wrong for the rest of that question's
//    life, with the answer key still showing it as acceptable.
//  • `coAccepts` decides what is marked correct WITHOUT the AI. Narrow it and
//    the teacher's own accepted word goes to a model that can talk itself out
//    of it; widen it and a wrong word passes.
//  • `coMarkPassage` is what makes the marking fair: a cloze word is right or
//    wrong because of the sentence around it, so the marker is sent the whole
//    passage. Send the blank alone and this is `fillblank` again.
//  • The passage must reach `block.text` with its [[markup]] INTACT. The AI
//    builder's `stripBrackets` erases exactly that, leaving a plain paragraph
//    that looks perfectly fine and asks the student nothing.
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
  // _fbParse and friends: the open cloze shares the one blank parser.
  cut('function _fbSplitTokens(text)', 'function _fbHasBlanks', 'blank parser'),
  cut('const CO_START_DEFAULT', '// ---- marking: the list first', 'cloze core'),
  cut('function coPrintHtml(block)', '// ---- the editor', 'print + key'),
  cut('function _coEditorPreviewHtml(block)', 'function coSyncEditor', 'editor preview'),
  cut('function buildBlocksFromAi', '\n// Build a full pending question object', 'builder'),
  `
let _n = 0;
function generateBlockId() { return 'b' + (++_n); }
function stripHtml(c) { return c ? String(c).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim() : ''; }
function _separateOptionLines(t) { return String(t == null ? '' : t); }
function _markedToBlanks(t) { return { content: String(t == null ? '' : t), blanks: {} }; }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeHtmlKeepLines(s) { return escapeHtml(s).replace(/\\n/g, '<br>'); }
function qApplyAiParts(b) { return b; }
const QPART_NONE = '-';
function qPartNormalize(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase().replace(/[()\\s.]/g, '');
  if (/^[1-9]\\d{0,2}$/.test(t)) return t;
  return (t.length === 1 && 'abcdefghjklmnopqrstuvwxyz'.indexOf(t) >= 0) ? t : '';
}
const SY_MARKS_DEFAULT = 2, SY_LINES_DEFAULT = 2;
`
].join('\n');

const M = new Function(section +
  '\nreturn { coIsCloze, coAlts, coBest, _coBlanks, coHasBlanks, _coStart, coAccepts, coIntro,' +
  ' coStudentHtml, coMarkPassage, coPrintHtml, coAnswerKeyText, _coEditorPreviewHtml,' +
  ' buildBlocksFromAi, CO_START_DEFAULT, CO_MAX_BLANKS };')();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};

// The passage off the paper, shortened to three blanks.
const P = "Hawker culture is one of Singapore's most treasured traditions. Dishes like chicken rice, laksa and roti prata [[bring|draw|pull]] people from all backgrounds together, creating a strong [[sense|feeling]] of community. Hawker culture started in the 1800s [[when|as]] immigrants sold food on the streets.";
const Q = { id: 'blk1', type: 'clozeopen', text: P, startNum: 46 };

// ── the accepted-answer list ────────────────────────────────────────────────

test('a blank keeps EVERY answer it accepts, best first', () => {
  eq(M.coAlts('bring|draw|pull'), ['bring', 'draw', 'pull']);
  eq(M.coBest('bring|draw|pull'), 'bring', 'the key leads with the first');
  eq(M.coAlts('bring'), ['bring'], 'one answer is still a list');
});

test('an empty or duplicated entry never becomes a hole in the list', () => {
  // [[bring|]] and [[bring|Bring]] are ONE answer, not a list with a gap; a
  // blank entry reaching the marker reads as "the empty string is acceptable".
  eq(M.coAlts('bring|'), ['bring']);
  eq(M.coAlts('|bring||draw|'), ['bring', 'draw']);
  eq(M.coAlts('bring|Bring|BRING'), ['bring'], 'case is not a different answer');
  eq(M.coAlts('bring | draw'), ['bring', 'draw'], 'spaces round the separator are not part of the word');
  eq(M.coAlts(''), []);
  eq(M.coAlts(null), []);
});

test('the passage yields its blanks in order', () => {
  eq(M._coBlanks(Q), ['bring|draw|pull', 'sense|feeling', 'when|as']);
  ok(M.coHasBlanks(Q), 'three blanks is a cloze');
  ok(!M.coHasBlanks({ type: 'clozeopen', text: 'no blanks here' }));
  ok(!M.coHasBlanks({ type: 'clozebank', text: 'a [[word]]' }), 'only its own block type counts');
});

test('a runaway passage is capped rather than rendering forever', () => {
  const many = { type: 'clozeopen', text: Array.from({ length: 200 }, () => 'x [[a]]').join(' ') };
  eq(M._coBlanks(many).length, M.CO_MAX_BLANKS);
});

// ── what is marked correct without the AI ───────────────────────────────────

test('every word on the list is accepted, and the AI never sees it', () => {
  // The teacher's own accepted word must not be sent to a model that can
  // decide against it.
  ['bring', 'draw', 'pull'].forEach(w => ok(M.coAccepts('bring|draw|pull', w), w + ' is on the list'));
  ok(!M.coAccepts('bring|draw|pull', 'carry'), 'a word not on the list goes to the AI, not straight through');
});

test('case and stray punctuation are not what a cloze tests', () => {
  ok(M.coAccepts('bring|draw', 'Bring'));
  ok(M.coAccepts('bring|draw', ' bring. '));
  ok(M.coAccepts('bring|draw', 'BRING'));
});

test('but an apostrophe or a hyphen IS part of the word', () => {
  // "its" and "it's" are different words, and so are "well-known" and
  // "wellknown". Normalising these away marks a wrong answer right.
  ok(!M.coAccepts("its", "it's"), '"it\'s" is not "its"');
  ok(M.coAccepts("it's", "it's"));
  ok(!M.coAccepts('well-known', 'well known'), 'a hyphen is not a space');
});

test('an empty answer is never accepted', () => {
  ok(!M.coAccepts('bring|draw', ''));
  ok(!M.coAccepts('bring|draw', '   '));
  ok(!M.coAccepts('', ''), 'a blank with no answers accepts nothing, least of all nothing');
});

// ── the passage the marker is sent ──────────────────────────────────────────

test('the marker is sent the WHOLE passage with numbered gaps', () => {
  // A cloze word is right or wrong because of the sentence around it. Send the
  // blank on its own and there is no way to mark it fairly — which is exactly
  // what fillblank does, and why this is a separate block type.
  const rows = [{ num: 46 }, { num: 47 }, { num: 48 }];
  const p = M.coMarkPassage(Q, rows);
  ok(/Hawker culture is one of Singapore's most treasured traditions/.test(p), 'the passage must travel: ' + p);
  ok(/___\(46\)___/.test(p) && /___\(47\)___/.test(p) && /___\(48\)___/.test(p), 'every blank is numbered: ' + p);
  ok(!/\[\[/.test(p), 'the answers must NEVER be in the passage the marker reads: ' + p);
  ok(!/bring|draw|pull/.test(p.replace(/___\(\d+\)___/g, '')) || !/\bbring\b/.test(p), 'no answer word leaks in');
});

test('the numbered gaps run in the passage order', () => {
  const p = M.coMarkPassage(Q, [{ num: 46 }, { num: 47 }, { num: 48 }]);
  ok(p.indexOf('___(46)___') < p.indexOf('___(47)___'), '46 comes before 47');
  ok(p.indexOf('___(47)___') < p.indexOf('___(48)___'));
});

test('a malformed block never throws', () => {
  [null, undefined, {}, { type: 'clozeopen' }, { type: 'clozeopen', text: null }].forEach(b => {
    M._coBlanks(b); M.coHasBlanks(b); M._coStart(b); M.coIntro(b);
    M.coPrintHtml(b); M.coAnswerKeyText(b); M.coMarkPassage(b, []); M._coEditorPreviewHtml(b);
  });
});

// ── numbering ───────────────────────────────────────────────────────────────

test('the paper\'s own numbering is kept', () => {
  // Unlike a lettered sub-question, a cloze blank's number is part of how the
  // passage reads and the key has to say 46.
  eq(M._coStart(Q), 46);
  eq(M._coStart({}), M.CO_START_DEFAULT);
  [null, 0, -3, 1000, 'x', {}].forEach(v => eq(M._coStart({ startNum: v }), M.CO_START_DEFAULT, 'startNum ' + JSON.stringify(v)));
  eq(M._coStart({ startNum: '29' }), 29, 'a numeric string is a number');
});

test('the instruction line is generated from the passage, so it cannot drift', () => {
  const t = M.coIntro(Q);
  ok(/3 blanks/.test(t), 'the count comes from the passage: ' + t);
  ok(/46 to 48/.test(t), 'and so does the range: ' + t);
  ok(!/word bank|list of words|choose/i.test(t), 'there is no bank to choose from here: ' + t);
  eq(M.coIntro({ type: 'clozeopen', text: 'a [[x]] b', startNum: 7 }).indexOf('There is 1 blank, numbered 7,'), 0);
  eq(M.coIntro({ type: 'clozeopen', text: 'nothing' }), '', 'no blanks, no instruction');
  eq(M.coIntro({ type: 'clozeopen', text: 'a [[x]]', intro: 'My own words.' }), 'My own words.');
});

// ── the student's page ──────────────────────────────────────────────────────

const student = () => M.coStudentHtml(Q, '#c', [0, 1, 2]);

test('the answers are NOWHERE in the student rendering', () => {
  // The trap fillblank fell into: the read-only rendering shows every answer in
  // its slot, which on a live question is the whole exercise given away.
  const h = student();
  ['bring', 'draw', 'pull', 'sense', 'feeling', 'when'].forEach(w =>
    ok(h.indexOf('>' + w) < 0 && h.indexOf('"' + w) < 0, '"' + w + '" leaked into the student page'));
  ok(!/\[\[/.test(h), 'raw markup must not reach the page');
});

test('every blank is a typeable box, numbered as the paper numbers it', () => {
  const h = student();
  eq((h.match(/class="co-input"/g) || []).length, 3, 'one box per blank');
  ok(/\(46\)/.test(h) && /\(47\)/.test(h) && /\(48\)/.test(h), 'the numbers are printed under the rules');
  eq((h.match(/data-oidx="/g) || []).length, 3, 'each blank registers its own item');
});

test('the whole passage is submitted at ONE button', () => {
  // Fifteen blanks behind fifteen Check buttons is a different exercise, and it
  // leaks the answers one blank at a time.
  const h = student();
  eq((h.match(/data-co-check=/g) || []).length, 1, 'exactly one submit');
  ok(/Check all 3 answers/.test(h), 'and it says how many it is checking: ' + h.slice(0, 200));
});

test('every blank is the SAME width — a wide box names a long word', () => {
  // fillblank sizes each box from its own answer. Here the student has to think
  // of the word, so a box visibly wider than its neighbours is a hint the paper
  // never gives: the paper prints one rule width for the whole passage.
  const h = M.coStudentHtml({ id: 'x', type: 'clozeopen', startNum: 1, text: 'a [[in]] b [[extraordinary]] c [[of]]' }, '#c', [0, 1, 2]);
  const widths = (h.match(/width:\d+ch/g) || []);
  eq(widths.length, 3, 'every blank is sized');
  eq(new Set(widths).size, 1, 'the widths differ, which tells the student how long each answer is: ' + widths.join(' '));
  ok(Number(widths[0].replace(/\D/g, '')) >= 'extraordinary'.length, 'and the one width must still fit the longest answer: ' + widths[0]);
});

test('the passage keeps its PARAGRAPHS', () => {
  // A cloze passage runs to three or four paragraphs. Flattened into one block
  // of prose it is measurably harder to read, which is the one thing the
  // exercise actually tests.
  const two = { id: 'x', type: 'clozeopen', startNum: 1, text: 'First para with a [[gap]].\n\nSecond para here.' };
  ok(/<br/.test(M.coStudentHtml(two, '#c', [0])), 'the student page ran the paragraphs together');
  ok(/<br/.test(M.coPrintHtml(two)), 'the printed page ran the paragraphs together');
  ok(/<br/.test(M._coEditorPreviewHtml(two)), 'the editor preview ran the paragraphs together');
});

test('the passage wording survives escaping intact', () => {
  const h = M.coStudentHtml({ id: 'x', type: 'clozeopen', text: 'He said "go" &amp; [[left|departed]] <now>.', startNum: 1 }, '#c', [0]);
  ok(h.indexOf('&lt;now&gt;') >= 0, 'angle brackets are escaped, not dropped');
  ok(h.indexOf('<script') < 0);
});

// ── on paper, and on the key ────────────────────────────────────────────────

test('the printed passage is BLANK', () => {
  const h = M.coPrintHtml(Q);
  ['bring', 'draw', 'sense', 'when'].forEach(w => ok(h.indexOf(w) < 0, '"' + w + '" printed on the question page'));
  ok(/print-cb-num/.test(h), 'the blanks are numbered on paper');
  eq((h.match(/print-cb-slot/g) || []).length, 3);
});

test('the printed key names EVERY accepted answer', () => {
  // A teacher marking by hand has to know that "draw" earns the mark as surely
  // as "bring" does, or the alternatives may as well not exist.
  const k = M.coAnswerKeyText(Q);
  ok(/46\. bring \(or draw, pull\)/.test(k), 'alternatives are missing from the key: ' + k);
  ok(/47\. sense \(or feeling\)/.test(k), k);
  eq(M.coAnswerKeyText({ type: 'clozeopen', text: 'a [[x]]', startNum: 3 }), '3. x', 'a single answer needs no "or"');
  eq(M.coAnswerKeyText({ type: 'clozeopen', text: 'nothing' }), '');
});

test('the editor preview shows the answers — it is the AUTHOR\'s page', () => {
  const h = M._coEditorPreviewHtml(Q);
  ok(h.indexOf('bring') >= 0, 'the author must see what they authored');
  ok(/\+2/.test(h), 'and how many other words are accepted: ' + h);
  ok(h.indexOf('<input') < 0, 'but nothing to type into');
});

// ── read off a screenshot ───────────────────────────────────────────────────

const build = blocks => M.buildBlocksFromAi({ blocks }).blocks;

test('the AI can build one off a screenshot', () => {
  const bs = build([{ type: 'clozeopen', startNum: 46, text: P }]);
  eq(bs.length, 1);
  eq(bs[0].type, 'clozeopen');
  eq(bs[0].startNum, 46);
  eq(bs[0].text, P, 'the passage must arrive verbatim');
});

test('the [[markup]] SURVIVES the builder', () => {
  // stripBrackets exists to pull [[ ]] out of a model answer. Run the passage
  // through it and every blank is erased, leaving a paragraph that renders
  // perfectly, prints perfectly, and asks the student nothing at all.
  const b = build([{ type: 'clozeopen', text: P }])[0];
  eq(M._coBlanks(b), ['bring|draw|pull', 'sense|feeling', 'when|as'], 'the blanks were flattened away');
});

test('a passage with no blanks at all builds nothing', () => {
  eq(build([{ type: 'clozeopen', text: 'Hawker culture is a treasured tradition.' }]).length, 0,
     'a cloze with no blanks is a paragraph, and it must not reach the bank as a question');
});

test('a nonsense startNum from the AI falls back rather than going NaN', () => {
  eq(build([{ type: 'clozeopen', text: 'a [[x]]', startNum: 'lots' }])[0].startNum, M.CO_START_DEFAULT);
  eq(build([{ type: 'clozeopen', text: 'a [[x]]', startNum: 0 }])[0].startNum, M.CO_START_DEFAULT);
  eq(build([{ type: 'clozeopen', text: 'a [[x]]', startNum: 9999 }])[0].startNum, M.CO_START_DEFAULT);
  eq(build([{ type: 'clozeopen', text: 'a [[x]]' }])[0].startNum, M.CO_START_DEFAULT);
});

test('the cloze carries its part like any other block', () => {
  eq(build([{ type: 'clozeopen', text: 'a [[x]]', part: 'b' }])[0].part, 'b');
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
