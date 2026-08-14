// Regression tests for ✏️ THE EDITING PASSAGE (`editpassage`) and for the
// SCREENSHOT path into the drag-and-drop cloze (`clozebank`). Run with:
//     node tools/editing-passage-tests.mjs            all cases
//     node tools/editing-passage-tests.mjs <name>     one case
//
// The editing passage reads backwards from a cloze: NOTHING is missing. Every
// word is there and about ten are wrong — "reseev" for receive, "choose" for
// chosen — each underlined with a numbered box for the correction. Three things
// here fail silently:
//
//  • `_edItem` is the ONE place `reseev>>receive` is taken apart. Read the two
//    halves the wrong way round and the CORRECT spelling is printed on the page
//    for the student to copy, and the marker is handed the error as the answer.
//  • **The printed word can never be a correct answer.** It is the error being
//    corrected. A model shown "reseev" against a passage that reads perfectly
//    around it will talk itself into accepting it, so this is decided locally,
//    before any AI call — and `edAiCorrections` filters it out of the model's
//    reply too.
//  • The passage must reach `block.text` with its [[markup]] INTACT, and the
//    wrong words must survive verbatim. `stripBrackets` erases the markup;
//    "helpfully" correcting a misspelling as it is transcribed destroys the
//    question while leaving a passage that reads perfectly.
//
// The `clozebank` half is here because until now the AI builder had no arm for
// it at all: the block type existed, and the only way to get one was to type
// the whole passage by hand.
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
  cut('function _fbSplitTokens(text)', 'function _fbHasBlanks', 'blank parser'),
  // coAlts / _coNorm / _coText are shared with the open cloze.
  cut('const CO_START_DEFAULT', '// ---- the student\'s passage', 'cloze core'),
  cut('const ED_START_DEFAULT', '// ---- marking ---', 'editing core'),
  cut('function edPrintHtml(block)', '// ---- the editor', 'print + key'),
  cut('function _edEditorPreviewHtml(block)', 'function edSyncEditor', 'editor preview'),
  cut('function buildBlocksFromAi', '\n// Build a full pending question object', 'builder'),
  `
let _n = 0;
function generateBlockId() { return 'b' + (++_n); }
function stripHtml(c) { return c ? String(c).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim() : ''; }
function _separateOptionLines(t) { return String(t == null ? '' : t); }
function _markedToBlanks(t) { return { content: String(t == null ? '' : t), blanks: {} }; }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeHtmlKeepLines(s) { return escapeHtml(s).replace(/\\\\n/g, '<br>'); }
function qApplyAiParts(b) { return b; }
const QPART_NONE = '-';
function qPartNormalize(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase().replace(/[()\\s.]/g, '');
  if (/^[1-9]\\d{0,2}$/.test(t)) return t;
  return (t.length === 1 && 'abcdefghjklmnopqrstuvwxyz'.indexOf(t) >= 0) ? t : '';
}
const SY_MARKS_DEFAULT = 2, SY_LINES_DEFAULT = 2, CB_START_DEFAULT = 26;
`
].join('\n');

const M = new Function(section +
  '\nreturn { edIsBlock, _edItem, _edItems, edHasItems, _edStart, edAccepts, edIsTheError, edIntro,' +
  ' edStudentHtml, edMarkPassage, edPrintHtml, edAnswerKeyText, _edEditorPreviewHtml,' +
  ' buildBlocksFromAi, ED_START_DEFAULT, ED_MAX_ITEMS };')();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};

// The diary passage off the paper, shortened to three items.
const P = "It's the first place in Singapore to [[reseev>>receive]] such an honour, and it was [[choose>>chosen|was chosen]] for its historical importance. It's also one of the few [[tropickle>>tropical]] colonial gardens left in the world!";
const Q = { id: 'blk1', type: 'editpassage', text: P, startNum: 36 };

// ── the item: the printed word, and its correction ──────────────────────────

test('an item is taken apart into the PRINTED word and its corrections', () => {
  eq(M._edItem('reseev>>receive'), { wrong: 'reseev', answers: ['receive'] });
  eq(M._edItem('choose>>chosen|was chosen'), { wrong: 'choose', answers: ['chosen', 'was chosen'] });
});

test('a marked word with NO correction yet is the printed word, not the answer', () => {
  // Clicking a word in the editor produces [[reseev]]. Read the other way round
  // the correct spelling would be printed on the page for the student to copy,
  // and the marker would be handed the error as the answer.
  eq(M._edItem('reseev'), { wrong: 'reseev', answers: [] });
  eq(M._edItem(''), { wrong: '', answers: [] });
  eq(M._edItem(null), { wrong: '', answers: [] });
});

test('only the FIRST separator splits — the correction may contain one', () => {
  eq(M._edItem('a>>b>>c').wrong, 'a');
  eq(M._edItem('a>>b>>c').answers, ['b>>c']);
});

test('an item with nothing printed is a plain numbered box', () => {
  // The paper sets the odd one out that way: no underlined word, just a gap.
  eq(M._edItem('>>proud'), { wrong: '', answers: ['proud'] });
});

test('the passage yields its items in order', () => {
  eq(M._edItems(Q).map(r => M._edItem(r).wrong), ['reseev', 'choose', 'tropickle']);
  ok(M.edHasItems(Q));
  ok(!M.edHasItems({ type: 'editpassage', text: 'nothing wrong here' }));
  ok(!M.edHasItems({ type: 'clozeopen', text: 'a [[word]]' }), 'only its own block type counts');
});

test('a runaway passage is capped rather than rendering forever', () => {
  const many = { type: 'editpassage', text: Array.from({ length: 200 }, () => 'x [[a>>b]]').join(' ') };
  eq(M._edItems(many).length, M.ED_MAX_ITEMS);
});

// ── what is marked without the AI ───────────────────────────────────────────

test('the correction, and its alternatives, are accepted locally', () => {
  ok(M.edAccepts('reseev>>receive', 'receive'));
  ok(M.edAccepts('choose>>chosen|was chosen', 'chosen'));
  ok(M.edAccepts('choose>>chosen|was chosen', 'was chosen'));
  ok(M.edAccepts('reseev>>receive', 'Receive'), 'capitals are not the error');
  ok(!M.edAccepts('reseev>>receive', 'recieve'), 'a near miss is still misspelt — this section tests spelling');
});

test('THE PRINTED WORD IS NEVER CORRECT — copying the error out is not an edit', () => {
  // The single thing a model gets wrong here: shown "reseev" against a passage
  // that reads perfectly around it, it accepts it. So it is decided locally.
  ok(M.edIsTheError('reseev>>receive', 'reseev'));
  ok(M.edIsTheError('reseev>>receive', 'Reseev'), 'nor with a capital');
  ok(M.edIsTheError('reseev>>receive', ' reseev. '), 'nor with punctuation round it');
  ok(!M.edAccepts('reseev>>receive', 'reseev'), 'it must never be accepted');
  // …even when an authoring slip lists it as an answer.
  ok(!M.edAccepts('reseev>>reseev', 'reseev'), 'not even if the block itself says so');
  ok(!M.edIsTheError('reseev>>receive', 'receive'), 'the correction is not the error');
  ok(!M.edIsTheError('>>proud', ''), 'an item with nothing printed has no error to copy');
});

test('an item with no correction yet accepts nothing locally — it goes to the AI', () => {
  ok(!M.edAccepts('reseev', 'receive'), 'with no stored answer the passage has to decide');
  ok(M.edIsTheError('reseev', 'reseev'), 'but copying the error out is still wrong');
});

test('an empty answer is never accepted', () => {
  ok(!M.edAccepts('reseev>>receive', ''));
  ok(!M.edAccepts('reseev>>receive', '   '));
});

// ── the passage the marker is sent ──────────────────────────────────────────

test('the marker gets the whole passage WITH the errors still in it', () => {
  // A correction is only right in the sentence it belongs to: "begin" → "began"
  // is right here and wrong in a passage written in the present tense.
  const p = M.edMarkPassage(Q, [{ num: 36 }, { num: 37 }, { num: 38 }]);
  ok(/first place in Singapore/.test(p), 'the passage must travel: ' + p);
  ok(/reseev ___\(36\)___/.test(p), 'each error is followed by its numbered box: ' + p);
  ok(/choose ___\(37\)___/.test(p), p);
  ok(!/receive|chosen|tropical/.test(p), 'the CORRECTIONS must never be in it: ' + p);
});

test('a malformed block never throws', () => {
  [null, undefined, {}, { type: 'editpassage' }, { type: 'editpassage', text: null }].forEach(b => {
    M._edItems(b); M.edHasItems(b); M._edStart(b); M.edIntro(b);
    M.edPrintHtml(b); M.edAnswerKeyText(b); M.edMarkPassage(b, []); M._edEditorPreviewHtml(b);
  });
});

test('the paper\'s own numbering is kept, and nonsense falls back', () => {
  eq(M._edStart(Q), 36);
  [null, 0, -3, 1000, 'x', {}].forEach(v => eq(M._edStart({ startNum: v }), M.ED_START_DEFAULT, 'startNum ' + JSON.stringify(v)));
});

test('the instruction line is generated from the passage', () => {
  const t = M.edIntro(Q);
  ok(/underlined words/.test(t) && /are wrong/.test(t), t);
  ok(/36 to 38/.test(t), 'the range comes from the passage: ' + t);
  eq(M.edIntro({ type: 'editpassage', text: 'nothing' }), '');
  eq(M.edIntro({ type: 'editpassage', text: 'a [[x>>y]]', intro: 'Mine.' }), 'Mine.');
});

// ── the student's page ──────────────────────────────────────────────────────

const student = () => M.edStudentHtml(Q, '#c', [0, 1, 2]);

test('the WRONG word stays on the page and the correction is nowhere on it', () => {
  const h = student();
  ['reseev', 'choose', 'tropickle'].forEach(w => ok(h.indexOf(w) >= 0, '"' + w + '" must stay — it is the question'));
  ['receive', 'chosen', 'tropical'].forEach(w => ok(h.indexOf(w) < 0, '"' + w + '" leaked into the student page'));
  ok(!/\[\[|>>/.test(h), 'raw markup must not reach the page');
});

test('every item is a typeable box, numbered as the paper numbers it', () => {
  const h = student();
  eq((h.match(/class="ed-input"/g) || []).length, 3);
  ok(/\(36\)/.test(h) && /\(37\)/.test(h) && /\(38\)/.test(h));
  eq((h.match(/ed-wrong/g) || []).length, 3, 'each error is underlined');
});

test('the space AFTER a blank survives', () => {
  // The passage is split at every blank, so the text resuming after one always
  // begins with the space that separated it from the word before. Trimmed away,
  // the passage reads "…reseevsuch an honour" — on every item, in all three
  // renderings and on the printed page.
  const b = { id: 'x', type: 'editpassage', startNum: 1, text: 'to [[reseev>>receive]] such an honour' };
  [M.edStudentHtml(b, '#c', [0]), M.edPrintHtml(b), M._edEditorPreviewHtml(b)].forEach((h, i) => {
    ok(/>\s*such an honour/.test(h.replace(/<\/?[a-z][^>]*>/gi, m => m)), 'rendering ' + i);
    ok(h.indexOf('such an honour') > 0, 'rendering ' + i + ' lost the text');
    ok(/(&nbsp;| )such an honour|>\s+such/.test(h), 'rendering ' + i + ' ate the space before "such": ' + h.slice(-120));
  });
});

test('every box is the SAME width — a wide box names a long word', () => {
  const h = M.edStudentHtml({ id: 'x', type: 'editpassage', startNum: 1, text: 'a [[q>>in]] b [[z>>extraordinary]]' }, '#c', [0, 1]);
  const widths = (h.match(/width:\d+ch/g) || []);
  eq(new Set(widths).size, 1, 'the widths differ, which tells the student how long each answer is: ' + widths.join(' '));
});

test('the whole passage is submitted at ONE button', () => {
  const h = student();
  eq((h.match(/data-ed-check=/g) || []).length, 1);
  ok(/Check all 3 corrections/.test(h));
});

// ── on paper, and on the key ────────────────────────────────────────────────

test('the printed page keeps the errors and leaves the boxes blank', () => {
  const h = M.edPrintHtml(Q);
  ok(h.indexOf('reseev') >= 0, 'the error is the question — it must print');
  ['receive', 'chosen', 'tropical'].forEach(w => ok(h.indexOf(w) < 0, '"' + w + '" printed on the question page'));
  eq((h.match(/print-ed-box/g) || []).length, 3, 'one empty box per item');
  eq((h.match(/print-ed-num/g) || []).length, 3, 'each numbered, as the paper numbers them');
});

test('the key shows the error, the arrow and every accepted correction', () => {
  const k = M.edAnswerKeyText(Q);
  ok(/36\. reseev → receive/.test(k), k);
  ok(/37\. choose → chosen \(or was chosen\)/.test(k), k);
  eq(M.edAnswerKeyText({ type: 'editpassage', text: 'nothing' }), '');
});

test('an item with no correction still gets a ROW on the key', () => {
  // A gap in the numbering reads as a printing fault, exactly as the answer-key
  // rules require everywhere else.
  const k = M.edAnswerKeyText({ type: 'editpassage', startNum: 5, text: 'a [[oops]] b' });
  ok(/5\. oops → —/.test(k), 'the unanswered item vanished from the key: ' + k);
});

test('the editor preview shows the corrections and flags the ones missing', () => {
  const h = M._edEditorPreviewHtml({ type: 'editpassage', startNum: 1, text: 'a [[reseev>>receive]] b [[oops]]' });
  ok(h.indexOf('receive') >= 0, 'the author must see what they authored');
  ok(/no correction yet/.test(h), 'and which items still need one: ' + h);
  ok(h.indexOf('<input') < 0, 'but nothing to type into');
});

// ── read off a screenshot ───────────────────────────────────────────────────

const build = blocks => M.buildBlocksFromAi({ blocks }).blocks;

test('the AI can build an editing passage off a screenshot', () => {
  const b = build([{ type: 'editpassage', startNum: 36, text: P }])[0];
  eq(b.type, 'editpassage');
  eq(b.startNum, 36);
  eq(b.text, P, 'the passage must arrive verbatim');
  eq(M._edItems(b).map(r => M._edItem(r).wrong), ['reseev', 'choose', 'tropickle'], 'the errors were flattened away');
});

test('the [[markup]] survives the builder', () => {
  // stripBrackets erases every item, leaving a passage of uncorrected errors
  // that reads as finished prose and asks the student nothing.
  ok(M.edHasItems(build([{ type: 'editpassage', text: P }])[0]), 'the markup was stripped');
});

test('a passage with nothing marked builds nothing', () => {
  eq(build([{ type: 'editpassage', text: 'Everything here is spelled correctly.' }]).length, 0);
});

test('a nonsense startNum falls back rather than going NaN', () => {
  eq(build([{ type: 'editpassage', text: 'a [[x>>y]]', startNum: 'lots' }])[0].startNum, M.ED_START_DEFAULT);
  eq(build([{ type: 'editpassage', text: 'a [[x>>y]]' }])[0].startNum, M.ED_START_DEFAULT);
});

// ── the drag-and-drop cloze, off a screenshot ───────────────────────────────
// The block type already existed; until now the AI builder had no arm for it,
// so the only way to get one was to type the whole passage by hand.

const CBP = 'Reading [[has]] been important for thousands of years. Only a few educated people [[could]] understand these symbols.';

test('the AI can build a word-bank cloze off a screenshot', () => {
  const b = build([{ type: 'clozebank', startNum: 26, text: CBP, extras: ['as', 'at', 'by'] }])[0];
  eq(b.type, 'clozebank');
  eq(b.startNum, 26);
  eq(b.text, CBP);
  eq(b.extras, ['as', 'at', 'by'], 'the distractors are the only part of the bank the model supplies');
  eq(b.once, true);
  eq(b.sortBank, true, 'sorted by default, so the order never hints at the answers');
});

test('the distractors arrive as a FLAT array of strings', () => {
  // Firestore rejects a nested array, and _firestoreSafeQuestion only rescues
  // the table block's rows — a nested one here fails the save outright.
  const b = build([{ type: 'clozebank', text: CBP, extras: ['as', 5, null, '  by  ', ''] }])[0];
  ok(b.extras.every(x => typeof x === 'string' && x), 'every extra must be a non-empty string: ' + JSON.stringify(b.extras));
  eq(b.extras, ['as', '5', 'by']);
  eq(build([{ type: 'clozebank', text: CBP, extras: 'not an array' }])[0].extras, []);
});

test('a word-bank cloze with no blanks builds nothing', () => {
  eq(build([{ type: 'clozebank', text: 'Reading has been important.', extras: ['as'] }]).length, 0);
});

test('a nonsense startNum on the word-bank cloze falls back too', () => {
  eq(build([{ type: 'clozebank', text: CBP, startNum: 'x' }])[0].startNum, 26);
  eq(build([{ type: 'clozebank', text: CBP }])[0].startNum, 26);
});

test('both new block types carry their part like any other block', () => {
  eq(build([{ type: 'editpassage', text: 'a [[x>>y]]', part: 'b' }])[0].part, 'b');
  eq(build([{ type: 'clozebank', text: CBP, part: 'c' }])[0].part, 'c');
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
