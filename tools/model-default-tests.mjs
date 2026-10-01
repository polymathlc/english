// Exercise the production routing code without credentials or provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function section(from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `missing source section: ${from}`);
  return src.slice(a, b);
}
const routing = section('const AI_ENGINE_STORE =', '// ── ChatGPT image generation');
const textDoor = section('async function askGemini(prompt,', '// Was the LAST _parseAIJson');
const visionDoor = section('async function askGeminiVision(', '// Convert text with [[keyword]]');
const widgetEfforts = section('const WIDGET_EFFORTS =', 'let _widgetBusy =');
const widgetDoor = section('async function _widgetAskAI(', '// Pull the HTML document');
const preview = section('function aiEngineChoicePreview(', '/* Read at sign-in');

function fixture(saved = {}, failures = {}, sharedData = null) {
  const values = new Map(Object.entries(saved)), calls = [];
  const state = { failures, sharedData, preview: null };
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  const context = vm.createContext({
    localStorage, app: {}, db: {}, CONFIG_COL: 'configEn', currentUser: { email: 'admin@example.com' },
    AI_THINK_MIN: 'low', Date, console: { warn() {} },
    document: { getElementById: () => ({ classList: { contains: () => false } }) },
    getFunctions: () => ({}), doc: () => ({}), setDoc: async () => {},
    onSnapshot: () => () => {},
    getDoc: async () => ({ exists: () => state.sharedData !== null, data: () => state.sharedData }),
    httpsCallable: (_functions, name) => async payload => {
      const engine = name === 'askKimi' ? 'kimi' : 'openai';
      calls.push({ engine, payload });
      if (state.failures[engine] instanceof Error) throw state.failures[engine];
      return { data: { text: state.failures[engine] ?? `${engine} reply` } };
    },
    geminiModel: { generateContent: async payload => {
      calls.push({ engine: 'gemini', payload });
      if (state.failures.gemini instanceof Error) throw state.failures.gemini;
      return { response: { text: () => state.failures.gemini ?? 'gemini reply' } };
    } },
    fetch: async (url, options) => {
      const engine = String(url).includes('moonshot') ? 'kimiKey' : 'openaiKey';
      calls.push({ engine, payload: JSON.parse(options.body) });
      if (state.failures[engine] instanceof Error) throw state.failures[engine];
      return { ok: true, json: async () => ({ choices: [{ message: { content: `${engine} reply` } }] }) };
    },
    renderAiEngineStatus: () => { state.preview = vm.runInContext('aiPreferredEngine()', context); }
  });
  vm.runInContext(routing + textDoor + visionDoor + widgetEfforts + widgetDoor + preview, context);
  return { calls, values, state, run: code => vm.runInContext(code, context) };
}

test('fresh devices use GPT 6.1 Sol and OpenAI > Gemini > Kimi', async () => {
  const f = fixture();
  assert.equal(f.run('getOpenAiModel()'), 'gpt-6.1-sol');
  assert.equal(f.run('aiEngineOrder().join()'), 'openai,gemini,kimi');
  assert.equal(await f.run("askGemini('Explain this')"), 'openai reply');
  assert.equal(f.calls[0].payload.model, 'gpt-6.1-sol');
  assert.equal(f.calls[0].payload.reasoningEffort, 'low');
  assert.ok(!('temperature' in f.calls[0].payload));
});

test('old persisted defaults migrate once, manual model selections survive', () => {
  for (const oldModel of ['gpt-5.6-sol', 'gpt-6-astra']) {
    const f = fixture({ eng_openai_model: oldModel, eng_ai_engine: 'gemini', eng_openai_model_gen: 'astra' });
    assert.equal(f.run('getOpenAiModel()'), 'gpt-6.1-sol');
    assert.equal(f.run('getAiEngine()'), 'openai');
    assert.equal(f.values.get('eng_openai_model_gen'), 'sol61');
  }
  const f = fixture({ eng_openai_model: 'gpt-6-astra', eng_openai_model_choice: 'manual', eng_ai_engine: 'gemini', eng_ai_engine_choice: 'manual' });
  assert.equal(f.run('getOpenAiModel()'), 'gpt-6-astra');
  assert.equal(f.run('getAiEngine()'), 'gemini');
  const upgraded = fixture({ eng_openai_model: 'gpt-6-astra', eng_openai_model_gen: 'sol61' });
  assert.equal(upgraded.run('getOpenAiModel()'), 'gpt-6-astra');
});

test('legacy shared defaults lift, teacher choices remain deliberate', async () => {
  for (const data of [null, {}, { aiEngine: 'gemini' }]) {
    const f = fixture({}, {}, data);
    assert.equal(await f.run('aiEngineLoadShared(true)'), 'openai');
  }
  for (const data of [{ aiEngine: 'gemini', aiEngineAt: '2026-09-01' }, { aiEngine: 'kimi', aiEngineBy: 'teacher' }]) {
    const f = fixture({}, {}, data);
    assert.equal(await f.run('aiEngineLoadShared(true)'), data.aiEngine);
  }
});

test('vision carries the image and reasoning to ChatGPT without a browser key', async () => {
  const f = fixture();
  assert.equal(await f.run("askGeminiVision('Read the image', [{ mimeType: 'image/png', data: 'pixels' }], { json: true })"), 'openai reply');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].payload.media)), [{ mimeType: 'image/png', data: 'pixels' }]);
  assert.equal(f.calls[0].payload.json, true);
  assert.equal(f.calls[0].payload.model, 'gpt-6.1-sol');
});

test('OpenAI failure falls back to Gemini with the complete image', async () => {
  const f = fixture({}, { openai: new Error('429 quota') });
  assert.equal(await f.run("askGeminiVision('Read this', [{ mimeType: 'image/png', data: 'pixels' }])"), 'gemini reply');
  assert.deepEqual(f.calls.map(c => c.engine), ['openai', 'gemini']);
  assert.equal(f.calls[1].payload.contents[0].parts[1].inlineData.data, 'pixels');
  assert.equal(f.run('aiLastCall.engine'), 'gemini');
  assert.equal(f.run('aiLastCall.fellBack'), true);
});

test('OpenAI and Gemini failures reach Kimi, preserving attachments', async () => {
  const f = fixture({}, { openai: new Error('unavailable'), gemini: new Error('429 cap') });
  assert.equal(await f.run("askGeminiVision('Read this', [{ mimeType: 'image/png', data: 'pixels' }])"), 'kimi reply');
  assert.deepEqual(f.calls.map(c => c.engine), ['openai', 'gemini', 'kimi']);
  assert.equal(f.calls[2].payload.media[0].data, 'pixels');
});

test('empty replies fall through, and all failures report every provider', async () => {
  const f = fixture({}, { openai: '', gemini: '' });
  assert.equal(await f.run("askGemini('Explain this')"), 'kimi reply');
  const bad = fixture({}, { openai: new Error('quota'), gemini: new Error('cap'), kimi: new Error('offline') });
  await assert.rejects(bad.run("askGemini('Explain this')"), /ChatGPT.*quota.*Gemini.*cap.*Kimi.*offline/);
});

test('browser fallback sends correct GPT reasoning, image and JSON shape', async () => {
  const f = fixture({ eng_openai_key: 'mock-key' }, { openai: new Error('server down') });
  assert.equal(await f.run("askGeminiVision('Reply as JSON', [{ mimeType: 'image/png', data: 'pixels' }], { json: true })"), 'openaiKey reply');
  const body = f.calls[1].payload;
  assert.equal(body.model, 'gpt-6.1-sol');
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.messages[0].content[1].image_url.url, 'data:image/png;base64,pixels');
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(body.max_completion_tokens, 6144);
  for (const key of ['temperature', 'top_p', 'logprobs']) assert.ok(!(key in body));
  await f.run("askOpenAI('Think', null, { reasoningEffort: 'minimal', temperature: 0.2 })");
  assert.equal(f.calls.at(-1).payload.reasoning_effort, 'low');
  await f.run("askOpenAI('Build', null, { maxOutputTokens: 16384, exactOutputBudget: true })");
  assert.equal(f.calls.at(-1).payload.max_completion_tokens, 16384);
});

test('Kimi K3 browser backup uses its documented reasoning schema', async () => {
  const f = fixture({ eng_kimi_key: 'mock-key' }, { openai: new Error('quota'), gemini: new Error('cap'), kimi: new Error('server unavailable') });
  assert.equal(await f.run("askGeminiVision('Read this', [{ mimeType: 'image/png', data: 'pixels' }])"), 'kimiKey reply');
  const body = f.calls.at(-1).payload;
  assert.equal(body.model, 'kimi-k3');
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.max_completion_tokens, 6144);
  for (const key of ['temperature', 'top_p', 'thinking', 'max_tokens']) assert.ok(!(key in body));
  await f.run("askKimiDirect('Build a widget', null, { reasoningEffort: 'medium', maxOutputTokens: 16000, exactOutputBudget: true, temperature: 0.4 })");
  assert.equal(f.calls.at(-1).payload.reasoning_effort, 'high');
  assert.equal(f.calls.at(-1).payload.max_completion_tokens, 16000);
  const manual = fixture({ eng_kimi_key: 'mock-key', eng_kimi_model: 'kimi-k2-thinking' });
  await manual.run("askKimiDirect('Explain', null, { temperature: 0.2 })");
  assert.equal(manual.calls.at(-1).payload.max_tokens, 1024);
  assert.equal(manual.calls.at(-1).payload.temperature, 0.2);
});

test('widgets use the server by default, with bounded effort and automatic backup', async () => {
  const f = fixture({}, { openai: new Error('server down') });
  assert.equal(await f.run("_widgetAskAI('auto', 'pro', 'Build a widget')"), 'gemini reply');
  assert.deepEqual(f.calls.map(c => c.engine), ['openai', 'gemini']);
  assert.equal(f.calls[0].payload.reasoningEffort, 'high');
  assert.equal(f.calls[0].payload.maxOutputTokens, 32000);
  assert.equal(f.calls[0].payload.exactOutputBudget, true);
  assert.equal(f.calls[1].payload.generationConfig.thinkingConfig.thinkingLevel, 'high');
});

test('widgets retain an explicitly selected provider and its backups', async () => {
  const f = fixture({}, { gemini: new Error('quota') });
  assert.equal(await f.run("_widgetAskAI('gemini', 'high', 'Build a widget')"), 'openai reply');
  assert.deepEqual(f.calls.map(c => c.engine), ['gemini', 'openai']);
});

test('engine previews restore the shared choice and never write storage', async () => {
  const f = fixture({}, {}, { aiEngine: 'openai', aiEngineAt: 'today' });
  await f.run('aiEngineLoadShared(true)');
  const before = [...f.values.entries()];
  f.run("aiEngineChoicePreview('gemini')");
  assert.equal(f.state.preview, 'gemini');
  assert.equal(f.run('aiPreferredEngine()'), 'openai');
  assert.deepEqual([...f.values.entries()], before);
});

test('speech and generated images keep specialised models, unrelated gates allow ChatGPT', () => {
  assert.match(src, /const AI_TRANSCRIBE_MODEL = 'gemini-3\.5-transcribe'/);
  assert.match(src, /const OPENAI_IMAGE_DEFAULT_MODEL = 'gpt-image-1'/);
  assert.match(src, /_transcribeClean\(await askGeminiDirect\(TRANSCRIBE_PROMPT/);
  for (const [from, to] of [['async function _aiRefineCrop(', 'const b64 ='], ['async function runBankAiSearch(', 'bankAiBusy = true'], ['async function runOeqCompare(', 'const nums =']]) {
    const body = section(from, to);
    assert.match(body, /aiEngineOrder\(\)\.length/);
    assert.doesNotMatch(body, /!geminiModel/);
  }
});
