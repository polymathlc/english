// Regression tests for the ONE-TIME BANK RESCUE (`_lb*` in app.js). Run with:
//     node tools/bank-rescue-tests.mjs            all cases
//     node tools/bank-rescue-tests.mjs <name>     one case
//
// It loads the REAL `_lbVerdict` / `_lbInner` / `_lbTitle` / `_lbTopic` and the
// REAL `topicLevelMap` out of app.js.
//
// Until v1.3.0 this app wrote every question into the SCIENCE app's bank. The
// rescue moves the English ones back, and decides which is which by TOPIC — so
// a wrong verdict is not a cosmetic slip:
//
//   • an English question read as Science is left behind, and the admin is told
//     there is nothing to move while their work sits in the other app;
//   • a Science question read as English is offered as a move, and moving it
//     DELETES it from the Science bank.
//
// Neither throws. Both are pinned here, along with the assumption the whole
// heuristic rests on: that the two subjects' topic lists share no entry.
import fs from 'fs';

const APP = new URL('../app.js', import.meta.url).pathname;
const src = fs.readFileSync(APP, 'utf8');

const slice = (from, to, what) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(what + ' not found in app.js — did the banner comment change?');
  return src.slice(a, b);
};

const readers = slice(
  'function _lbInner(data)',
  '// Read the three legacy collections.',
  'the _lb reader block');
const topics = slice('const topicLevelMap = {', '};', 'topicLevelMap') + '};';

const M = new Function(`
  let customTopics = {};
  let removedTopics = [];
  ${topics}
  function currentTopics() {
    return Object.keys(topicLevelMap).filter(t => !removedTopics.includes(t))
      .concat(Object.keys(customTopics));
  }
  ${readers}
  return {
    _lbInner, _lbTitle, _lbTopic, _lbVerdict, _lbEnglishTopics,
    topicLevelMap, LEGACY_SCIENCE_TOPICS,
    setUp(custom, removed) { customTopics = custom || {}; removedTopics = removed || []; },
  };
`)();

// The Science portal's own topic list (polymathlc/cer, `topicLevelMap`), as a
// fixture rather than read from the constant it is checking: dropping one from
// app.js should fail here rather than quietly turn that subject's questions
// into UNKNOWNs the admin is asked to rule on.
const SCIENCE_TOPICS = [
  'Living and non-living things', 'Materials', 'Life Cycles', 'Magnets',
  'Plant Systems', 'Human Body Systems', 'Matter and its 3 States', 'Light', 'Heat',
  'Water and its 3 States', 'Plant Reproduction', 'Human Reproduction',
  'Human and Plant Respiration', 'Human and Plant Transport', 'Electrical Systems',
  'Forces', 'Energy in Food', 'Energy Conversion',
  'Living Together', 'Food Chains and Webs', 'Humans and the Environment',
  'Cell Systems',   // retired in the Science app, still on its questions
];

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error((what || 'value') + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
};
const verdict = (data, custom, removed) => {
  M.setUp(custom, removed);
  return M._lbVerdict(data, M._lbEnglishTopics());
};

// ── the two lists must not overlap ───────────────────────────────────────────

test('no Science topic is also an English topic', () => {
  M.setUp({}, []);
  const english = M._lbEnglishTopics();
  const clash = SCIENCE_TOPICS.filter(t => english.has(t.toLowerCase()));
  eq(clash, [], 'topics on BOTH lists (the rescue cannot tell these apart)');
});

test('every English topic is recognised', () => {
  M.setUp({}, []);
  const english = M._lbEnglishTopics();
  const missing = Object.keys(M.topicLevelMap).filter(t => !english.has(t.toLowerCase()));
  eq(missing, [], 'English topics the rescue would read as Science');
});

// ── the verdict ──────────────────────────────────────────────────────────────

test('an English topic reads as English', () => {
  eq(verdict({ topic: 'Comprehension Cloze' }), 'english');
  eq(verdict({ topic: 'Grammar' }), 'english');
});

test('a Science topic reads as Science', () => {
  SCIENCE_TOPICS.forEach(t => eq(verdict({ topic: t }), 'science', t));
});

test('a topic neither list knows is UNKNOWN, never guessed', () => {
  // Both wrong answers cost something. Read as English, it offers a one-click
  // delete from the Science bank on no evidence; read as Science, it is not even
  // listed — which is how an English question filed under a custom topic this
  // browser has never heard of would be left behind in silence.
  eq(verdict({ topic: 'Something nobody has ever filed under' }), 'unknown');
  eq(verdict({ topic: '' }), 'unknown');
  eq(verdict({}), 'unknown');
  eq(verdict({ topic: '   ' }), 'unknown');
});

test('the Science list in app.js still covers every Science topic', () => {
  const known = M.LEGACY_SCIENCE_TOPICS;
  const missing = SCIENCE_TOPICS.filter(t => !known.includes(t.toLowerCase()));
  eq(missing, [], 'Science topics app.js no longer recognises');
});

test('case and stray whitespace do not change the verdict', () => {
  eq(verdict({ topic: '  vocabulary  ' }), 'english');
  eq(verdict({ topic: 'GRAMMAR CLOZE' }), 'english');
});

test('a topic the admin has since hidden still reads as English', () => {
  // removedTopics only hides a topic from the dropdown; questions already filed
  // under it are still English, and would otherwise be stranded.
  eq(verdict({ topic: 'Grammar' }, {}, ['Grammar']), 'english');
});

test('a custom English topic reads as English', () => {
  eq(verdict({ topic: 'Idioms and proverbs' }, { 'Idioms and proverbs': 'P4' }), 'english');
});

test('the SECOND topic counts too', () => {
  eq(verdict({ topic: '', topic2: 'Vocabulary' }), 'english');
  eq(verdict({ topic2: 'Punctuation and Spelling' }), 'english');
});

// ── the scheduled-release wrapper ────────────────────────────────────────────

test('a scheduled release is judged on the question inside it', () => {
  eq(verdict({ releaseDate: '2026-09-01', questionData: { topic: 'Situational Writing' } }), 'english');
  eq(verdict({ releaseDate: '2026-09-01', questionData: { topic: 'Forces' } }), 'science');
});

test('a scheduled release with the topic only on the OUTSIDE still resolves', () => {
  eq(verdict({ topic: 'Vocabulary Cloze', questionData: { blocks: [] } }), 'english');
});

// ── what the admin reads in the list ─────────────────────────────────────────

test('the row shows the question’s own title and topic', () => {
  eq(M._lbTitle({ title: 'Phrasal Verbs with Call' }), 'Phrasal Verbs with Call');
  eq(M._lbTopic({ topic: 'Vocabulary' }), 'Vocabulary');
  eq(M._lbTitle({ questionData: { title: 'Editing passage 4' } }), 'Editing passage 4');
  eq(M._lbTopic({ questionData: { topic: 'Grammar Cloze' } }), 'Grammar Cloze');
});

test('a scheduled release falls back to its own stored title', () => {
  eq(M._lbTitle({ questionTitle: 'Queued question', questionData: { blocks: [] } }), 'Queued question');
});

test('a question with no title is named, never blank', () => {
  // A blank row is one the admin cannot judge, and judging is the whole point.
  eq(M._lbTitle({}), 'Untitled question');
  eq(M._lbTitle({ title: '   ' }), 'Untitled question');
});

test('a malformed document never throws', () => {
  [null, undefined, {}, { questionData: null }, { topic: 42 }, { questionData: 'nope' }].forEach(d => {
    M._lbTitle(d); M._lbTopic(d); verdict(d);
  });
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
