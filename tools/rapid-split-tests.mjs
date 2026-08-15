// Regression tests for HOW MANY QUESTIONS A PAGE HOLDS. Run with:
//     node tools/rapid-split-tests.mjs            all cases
//     node tools/rapid-split-tests.mjs <name>     one case
//
// It loads the REAL `_aiQuestionPayloads` and `buildQuestionFromAi` out of
// app.js, plus the build prompt, and checks the rules the model is given.
//
// A page of 61, 62, 63, 64, 65 holds FIVE questions, not one question with five
// parts. They share no passage, a student is served one at a time and each is
// marked on its own — so ⚡ Rapid add must put five rows in vetting. A passage
// followed by numbered questions is the opposite case and is still ONE question
// with lettered parts, because those questions cannot be read without it.
//
// `_aiQuestionPayloads` is the ONE place that decision is read out of a build
// reply, and every way it can go wrong is silent:
//
//  • Return one payload for a five-question page and four questions are thrown
//    away, with a single row in vetting that looks perfectly fine.
//  • Return five for a passage question and the passage is torn off its
//    sub-questions, leaving five that cannot be answered.
//  • Drop the inherited topic/category and every question after the first lands
//    in vetting untopiced, for an author to open and fix by hand.
//  • Return NOTHING for a reply in the old single-question shape and Rapid add
//    stops working altogether for every ordinary screenshot.
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
  cut('function _aiQuestionPayloads(parsed)', 'function buildQuestionFromAi', 'payload split'),
  cut('function _aiBuildQuestionPrompt(isPdf, imageCount, levelHint)', '\n// The lettered-parts rules', 'build prompt'),
  cut('function _partsPromptRules()', '\n// The rectangle-selection', 'parts rules'),
  `
function currentTopics() { return ['Grammar', 'Vocabulary', 'Comprehension']; }
// ⚡ Rapid add's "Level for this batch" narrows the topic list the prompt
// offers — a level is read off the TOPIC here, so that is the only lever.
function currentTopicsByLevel() { return { P3: ['Grammar'], P4: [], P5: ['Vocabulary'], P6: ['Comprehension'] }; }
function _genPreamble() { return ''; }
function _aiTagsPromptLine() { return ''; }
function _rectangleRules() { return ''; }
const SCAN_READING_NOTE = '';
`
].join('\n');

const M = new Function(section + '\nreturn { _aiQuestionPayloads, _aiBuildQuestionPrompt };')();

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};

const syn = (given, cue) => ({ type: 'synthesis', given, cue, cuePos: 'use', answer: 'x', marks: 2 });

// The page off the paper: five synthesis questions, 61 to 65, sharing nothing.
const PAGE = {
  questions: [
    { title: 'In case', topic: 'Grammar', category: 'Explanation', tags: ['synthesis'], questionType: 'open', blocks: [syn('We did not want to miss the show so we left the house early.', 'in case')] },
    { title: 'Reported speech', blocks: [syn('"Do you want to eat sushi tomorrow?" Mother asked Andrea.', 'Mother asked Andrea if')] },
    { title: 'Without', blocks: [syn('Charlie ran out of the house. He did not lock the door.', 'Without')] },
    { title: 'With effect', blocks: [syn('The library will open earlier starting next Monday.', 'With effect')] },
    { title: 'Seldom', blocks: [syn('Since he started working, I have hardly seen him.', 'Seldom')] }
  ],
  topic: 'Grammar', category: 'Explanation', tags: ['synthesis', 'transformation']
};

// ── the split ───────────────────────────────────────────────────────────────

test('a page of five numbered questions becomes FIVE questions', () => {
  // The whole point: five rows in vetting, not one question with five parts.
  const out = M._aiQuestionPayloads(PAGE);
  eq(out.length, 5, 'four questions were thrown away');
  eq(out.map(p => p.title), ['In case', 'Reported speech', 'Without', 'With effect', 'Seldom']);
  eq(out[0].blocks.length, 1, 'each carries only its own blocks');
});

test('the order on the page is the order they are added', () => {
  const out = M._aiQuestionPayloads(PAGE);
  eq(out[0].blocks[0].cue, 'in case');
  eq(out[4].blocks[0].cue, 'Seldom');
});

test('an entry INHERITS the topic and category it did not repeat', () => {
  // A model told to write these per entry writes them once at the top and then
  // stops. Without the inheritance every question after the first lands in
  // vetting untopiced, for an author to open and fix by hand.
  const out = M._aiQuestionPayloads(PAGE);
  out.forEach((p, i) => {
    eq(p.topic, 'Grammar', 'entry ' + i + ' lost its topic');
    eq(p.category, 'Explanation', 'entry ' + i + ' lost its category');
  });
  eq(out[1].tags, ['synthesis', 'transformation'], 'and its tags');
});

test('an entry that DID carry its own keeps them', () => {
  const out = M._aiQuestionPayloads(PAGE);
  eq(out[0].tags, ['synthesis'], 'its own tags must win over the page default');
  const own = M._aiQuestionPayloads({ topic: 'Grammar', questions: [{ topic: 'Vocabulary', blocks: [1] }] });
  eq(own[0].topic, 'Vocabulary');
});

// ── the shapes that must NOT split ──────────────────────────────────────────

test('the old single-question shape still returns exactly one', () => {
  // Every ordinary screenshot comes back like this. Return nothing here and
  // Rapid add stops working altogether.
  const one = { title: 'One question', topic: 'Grammar', blocks: [syn('a', 'b')] };
  eq(M._aiQuestionPayloads(one).length, 1);
  eq(M._aiQuestionPayloads(one)[0].title, 'One question');
});

test('a page holding ONE question returns one, not zero', () => {
  eq(M._aiQuestionPayloads({ questions: [{ title: 'Solo', blocks: [syn('a', 'b')] }] }).length, 1);
});

test('a passage question stays ONE question with its parts', () => {
  // The opposite failure: torn apart, the sub-questions cannot be answered
  // because the passage they are about is attached to only the first of them.
  const passage = {
    title: 'Hawker culture', questionType: 'passage',
    blocks: [
      { type: 'text', text: 'A long passage about hawker centres.' },
      { type: 'mcq', part: 'a', options: ['1', '2'], correctIndex: 0 },
      { type: 'mcq', part: 'b', options: ['1', '2'], correctIndex: 1 }
    ]
  };
  const out = M._aiQuestionPayloads(passage);
  eq(out.length, 1, 'the passage was torn off its sub-questions');
  eq(out[0].blocks.length, 3, 'and every part must stay with it');
});

// ── replies that are broken in some way ─────────────────────────────────────

test('an empty questions array falls back to the reply itself', () => {
  // A page that produced blocks must produce a question.
  const out = M._aiQuestionPayloads({ questions: [], title: 'Fallback', blocks: [syn('a', 'b')] });
  eq(out.length, 1);
  eq(out[0].title, 'Fallback');
});

test('entries with no blocks are dropped, not built as empty questions', () => {
  const out = M._aiQuestionPayloads({
    questions: [{ title: 'Real', blocks: [syn('a', 'b')] }, { title: 'Empty', blocks: [] }, { title: 'Missing' }, null, 'nonsense']
  });
  eq(out.length, 1, 'an entry with nothing in it is not a question');
  eq(out[0].title, 'Real');
});

test('a reply with nothing usable at all returns nothing', () => {
  // Rapid add turns this into a visible red card rather than a blank question.
  eq(M._aiQuestionPayloads({ questions: [] }), []);
  eq(M._aiQuestionPayloads({ questions: [{}] }), []);
  eq(M._aiQuestionPayloads(null), []);
  eq(M._aiQuestionPayloads('a string'), []);
  eq(M._aiQuestionPayloads(undefined), []);
});

test('questions that is not an array is ignored, not crashed on', () => {
  const out = M._aiQuestionPayloads({ questions: 'five', title: 'Still here', blocks: [syn('a', 'b')] });
  eq(out.length, 1);
  eq(out[0].title, 'Still here');
});

// ── what the model is actually told ─────────────────────────────────────────

test('the prompt asks how many questions the page holds, FIRST', () => {
  const p = M._aiBuildQuestionPrompt(false, 1);
  ok(/HOW MANY QUESTIONS/i.test(p), 'the count decision is missing from the prompt');
  ok(/SEPARATE questions/.test(p), p.slice(0, 200));
  ok(/Never merge them into one question with parts/i.test(p), 'nothing stops it clumping them into parts');
});

test('the prompt still protects the passage case', () => {
  const p = M._aiBuildQuestionPrompt(false, 1);
  ok(/is ONE question, however many numbers it carries/i.test(p), 'a passage must not be split: ' + p.slice(0, 400));
  ok(/letter its sub-questions/i.test(p), 'and its sub-questions are still lettered');
});

test('the prompt says the paper\'s NUMBER is only a signal, never kept', () => {
  const p = M._aiBuildQuestionPrompt(false, 1);
  ok(/QUESTION NUMBER IS ONLY THE SIGNAL/i.test(p), 'nothing tells it to drop the number');
  ok(/no "part" field/i.test(p), 'the number must not become a part');
});

test('the prompt asks for the block type to be chosen PER question', () => {
  const p = M._aiBuildQuestionPrompt(false, 1);
  ok(/decided per question and not once for the page/i.test(p), 'the type is decided once for the page: ' + p.slice(0, 300));
  ['synthesis', 'mcq', 'clozeopen', 'clozebank', 'editpassage'].forEach(t =>
    ok(p.indexOf('"' + t + '"') >= 0, 'the model is never told about "' + t + '"'));
});

test('the prompt asks for the questions ARRAY', () => {
  const p = M._aiBuildQuestionPrompt(false, 1);
  ok(/"questions":\[/.test(p), 'the array shape is missing');
  ok(/ONE question returns an array of ONE entry/i.test(p), 'a single question has to be expressible too');
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
