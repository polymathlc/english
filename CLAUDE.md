# CLAUDE.md

Guidance for Claude when working in this repo.

## The app

`index.html` + `app.js` — the **"English Learning Portal"** (the product name in
the sidebar, the `<title>` and the footer). Admin question authoring (block
editor, AI build-from-screenshot, image crop/touch-up, vetting → bank) plus
student practice, worksheets and marking.

**The markup and CSS live in `index.html`; ALL of the application JavaScript
lives in `app.js`**, loaded as `<script type="module" src="app.js">`. They ship
together — `index.html` is useless without `app.js` next to it, so deploy the
directory, never the single file.

This is a fork of the Science portal (`polymathlc/cer`) with the entire game
layer removed. See **The fork** at the bottom for what that means in practice.

- Functions referenced from inline `onclick`/`on*` handlers MUST be assigned to
  `window` near the bottom of `app.js` (search `window.navigateTo =`), because
  the module has its own scope.
- `const` declared mid-module is in its temporal dead zone earlier in the file —
  only read such values at call time, not at module-eval time.

## Where the data lives — read this before touching any Firestore path

This app shares a Firebase PROJECT with the Science portal and shares **no data**
with it. Every collection is named once, at the top of `app.js`, and every path
is built from those constants (`QUESTIONS_COL`, `SETTINGS_COL`, `PROFILES_COL`,
`PROGRESS_COL`, …). Nothing else in the file spells a collection name out — keep
it that way.

**That rule is not style, and v1.3.0 is what it costs to break it.** Four
functions are the only door to the bank — `_qRef` / `_vRef` / `_qCol` / `_vCol`
— and they spelled `'questions'` and `'vetting'` inline: the Science app's own
names, under the same `users/{uid}` tree, in the same project. So for three
versions the two apps were *one bank wearing two front ends*. Every English
question this app saved landed in the Science bank and every Science question
came back out of it. Nothing threw. Nothing looked broken. The only symptom was
Science questions listed on the English bank page, which reads as a filter bug.
Three things follow:

- **A shared-name path fails LOUDLY nowhere and quietly everywhere.** The
  fail-closed warning below is about names the rules *don't* know; this is the
  opposite and worse — a name the rules know for the *other app*, which works
  perfectly and silently merges two data sets.
- **`mistakes`, `flashcards` and `scheduledQuestions` had the same bug** and
  are now `mistakesEn` / `flashcardsEn` / `scheduledQuestionsEn`. The comment
  above them used to say they were "shared with no one"; they were shared with
  the Science app, which writes exactly those three names under the same user.
  `scheduledQuestions` was the dangerous one: a question the SCIENCE app had
  queued would have been released into the ENGLISH bank on its release date,
  re-linking the two a day after they were separated.
- **The one-time rescue is `_lb*`** (📦 From Science bank, on the Question Bank
  page, admin only). It moves what was written to the wrong collection back
  across, deciding subject by TOPIC — the two topic lists share no entry and a
  topic comes off a `<select>`, so it is a strong signal, and anything neither
  list knows is listed UNTICKED for the admin to decide rather than guessed at.
  It copies, **reads the copy back**, and only then deletes the original; a copy
  that cannot be verified leaves the original where it is. Delete the tool once
  the banks have been apart long enough that nobody is upgrading across it.

**A name the Firestore rules do not know about fails closed**: reads come back
empty, writes are denied, and nothing on screen explains why. So a new
collection means a matching block in `firestore.rules`, deployed alongside the
Science app's rules — never replacing them. `README.md` has the deploy steps.

The bank starts EMPTY, deliberately: `users/{uid}/questionsEn` does not exist
until the first English question is written.

## Keep the page fast — these are load-bearing, do not undo them

- Fonts are ONE non-blocking request (`media="print" onload="this.media='all'"`).
  Adding another render-blocking `<link rel="stylesheet">` to Google Fonts puts
  first paint back at the mercy of the school's network. Crimson Pro is
  deliberately `media="print"` — it is only used by the printed worksheet cover.
- There is NO icon font. The landing-page icons are inline SVG inside
  `.material-symbols-outlined` spans. Do not reintroduce Material Symbols: the
  variable webfont is 1.1 MB.
- Tailwind is PREBUILT and inlined (search `Tailwind, prebuilt`). Do not put the
  `cdn.tailwindcss.com` Play CDN back — it ships a CSS compiler to the student's
  phone. Regenerate via `docs/tailwind/` instead.
- `<link rel="modulepreload" href="app.js">` in the head is what starts the app
  download early. Keep it, and keep it pointing at the right filename.

## Learner progress

`progress` (in `app.js`, search `LEARNER PROGRESS`) is the plain record of work
done: questions marked, how many were right, the fractional marks total and the
day streak. My Report, the student Home screen, the teacher's Usage dashboard
and Ai-nstein all read it. It replaced the RPG hero doc the Science app used.

- **`progressOnMarked(q, score, total, opts)` is the ONE hook** every marking
  path calls, through `recordCerPerformance`. Do not add a second.
- Stored at `users/{uid}/{SETTINGS_COL}/progress`, mirrored to `PROGRESS_COL`
  so a teacher — who cannot read another account's settings tree — can see the
  class. That mirror carries **counts only**: never answers, never the mark on a
  particular question.
- **`correct` is a valid lower bound on `creditSum`.** Every question in the
  binary count scored ≥ 0.95, so an honestly accumulated `creditSum` can never
  sit below `0.95 × correct`; `progressHydrate` seeds it from the binary count
  when it is lower, and `progressPublish` takes the higher of the two. Without
  that, a counter added later reads every earlier question as WRONG for the rest
  of the account's life. Any future counter added beside an older one needs the
  same treatment.
- Writes coalesce (600 ms) and the class mirror publishes at 1500 ms — a photo
  answer marks every part at once and would otherwise be one write per part.

## Learning gaps and the daily retry credits

`lgState` (in `app.js`, search `LEARNING GAPS`) is the list of what one student
does not understand yet — **named** weaknesses ("past perfect tense", "the word
'reluctant'"), not topics. The mistake log records what went wrong on a
particular question; this is the same evidence read as a list that outlives the
question. Stored at `users/{uid}/{SETTINGS_COL}/{GAPS_DOC}`, and **not mirrored
to the class collection**: a list of what a child cannot do is not a class
statistic.

- **`lgNoteFromParts` is the ONE hook**, and it is called from inside
  `fcNoteMistakes` — the function every marking path already funnels its wrong
  answers through. Do not add a second; a surface added later is covered free.
- The list does three jobs and it is the **same list** for all three: it is shown
  to the student, it **picks** the bank questions they are served
  (`lgBankQuestionsFor`), and it **briefs the AI** when the bank has nothing left
  (`lgBuildQuestion`, which goes through `buildBlocksFromAi` like every other AI
  authoring path). A generated question is **never saved** — the bank is the
  teacher's, and nothing unvetted belongs in it.
- **The AI names the gap; the question's own tags are the fallback.** With the AI
  off or the call failed, `_lgFallbackItems` files the mistake under the
  question's tags or topic. The list must never simply stop filling. But an
  **empty `items` array is a real answer** — the model is told to return one when
  a slip shows no misunderstanding — so it is not overridden by the fallback.
- **A gap is closed by the student, not the clock**: `LG_CLEAR_WINS` right in a
  row (`lgNoteWin`, called from `recordCerPerformance` at the same ≥0.95
  threshold `progressOnMarked` uses). One wrong answer **re-opens** it.
- **Credits are `REGEN_DAILY_CREDITS` (30) a day, reset by calendar day**, spent
  BEFORE the AI call so two quick taps cannot buy two questions for one credit,
  and **refunded when the call fails**. `_lgRollCredits` must run on load or a
  stale `dayKey` hands out one allowance and never another.
- `_lgHostId` is the ONE place a gap key becomes an element id, and it is
  injective on purpose — a bare strip of non-alphanumerics lets two gaps share a
  host, and the second one's button then does nothing at all.
- Run **`node tools/learning-gap-tests.mjs`** after touching any of it: a
  mis-keyed gap, a credit that misses the rollover and a gap that cannot re-open
  are all silent.

Topic lists carry **no P3–P6 headings** — not the bank filter, the authoring
`<select>`, the manage dialog or the student topic grid. An English topic is not
owned by a year the way a Science one is. The level each topic is filed under is
still live (it gates what a student may be served); it is simply not announced.

## The two comprehension formats — one passage, many questions

Both arrived in v1.6.0 and both exist because the block editor could not express
a **passage with its own sub-questions as ONE bank question**.

### Sub-questions are LETTERED — (a) (b) (c) — whatever the paper called them

**Every automatic path letters them** (v1.8.0): the passage builder, and the AI
read of a screenshot set. The paper's 16, 17, 18 / 21, 22, 23 are *that exam
paper's* numbering, not this question's — a bank question stands on its own, and
one that opens at part (21) reads as though twenty parts are missing.

- **The markers INSIDE the passage are renumbered to match**
  (`_pbRelabelPassage`). The paper prints "(16)" against the underlined word
  question 16 asks about; letter the questions and leave the passage alone and
  the student reads "(16)" over the word, then hunts for a question 16 that is
  now part (a). Only the **parenthesised whole number** is rewritten, so "(160)"
  and the 16 in "16 January" survive. The AI prompt asks for the same rewrite on
  any passage text it transcribes.
- **Past the alphabet a sub-question is DROPPED and the author is told**
  (`pbPartOverflow`). It is never given an empty part: `qPartMap` inherits
  forward, so an unlabelled sub-question is filed under the previous one and two
  option lists share a heading.
- `pbPartLetter(i)` is the one place an index becomes a letter.

### Parts may still be NUMBERS

`qPartNormalize` accepts **1–999** as well as a letter. Nothing automatic
produces one any more — the parts bar's **Number from** box is the deliberate
manual escape hatch, for an author who does want the paper's numbering.

- **Detection is deliberately NOT extended.** `qPartDetect` still matches
  letters only — a number at the start of a line is a question number, a
  quantity or a year far more often than it is a part. Assigning is a decision;
  detecting is a guess, which is why `QPART_ASSIGN` was already longer than
  `QPART_LETTERS`.
- The letter branch now requires **length 1**: `indexOf` on a *string* matches
  substrings, so `'ab'` used to come back as a valid part — one no picker could
  show and no key could label.
- `autoNumberParts(startAt)` takes an optional start; the parts bar's **Number
  from** box feeds it, and blank falls back to the letters.
- **`QPART_OPENER_TYPES` is `['text', 'mcq']`.** An MCQ joins because these
  papers have no text block to hang the part on — the sub-question is nothing
  but its four options. Both print paths and `buildOpenBody` print the label for
  an MCQ that opens a part, which is what makes that safe (the original
  text-only rule existed so a part could never be labelled on the key with
  nothing marking it on the paper).

### 📑 The passage builder (`pb*`)

Paste the passage and the option lists as they are on the paper; out comes one
text block plus one MCQ per sub-question, each opening its own lettered part.

- **The parse is deterministic — there is no AI in it.** A wrong guess here is
  not a wrong answer, it is four options quietly filed under the wrong number.
- A question opens on a **bare** number at the start of a line; an option number
  is **parenthesised and single-digit**. That one rule is what stops the "(16)"
  markers inside the passage reading as options, and stops "20,000 animals
  across 1,000 species" reading as question 20.
- A line that is neither **continues the option above it** — an option long
  enough to wrap arrives as two lines, and dropping the tail loses half the
  answer with nothing looking wrong.
- **An unticked sub-question is saved with no correct option.** Guessing one
  marks every class that ever sits it against the wrong word.

### Reading a passage set off SCREENSHOTS (v1.7.0)

The multi-screenshot build and the `box_2d` auto-crop both already existed —
`aiBuildFromScreenshot` reads N images as ONE question and
`_autoFillDiagramsFromBoxes` crops each AI-drawn rectangle out of its own page.
The one thing missing was a way for the model to say **"these four options are
question 21 of the passage"**, so a comprehension page came back as eight
option lists in a row with nothing telling them apart.

- **`buildBlocksFromAi` honours an explicit `"part"`** on any AI block, through
  `qPartNormalize` — so `"b"` and `"21"` both work, though the prompt now asks
  for letters — with `QPART_NONE` preserved. It is stamped on the FIRST block that entry produced, because
  `qPartMap` inherits forward. This is the ONE function every AI authoring path
  goes through, so all of them gained it at once.
- **`qLiftPartMarkers` already skipped a block that opens a part**, which is
  what stops the typed-marker pass overwriting the model's numbering.
- **The rules live in `_partsPromptRules()`**, the fragment all four build
  prompts carry — do not restate them in a prompt. They tell the model to
  LETTER the sub-questions in order and to rewrite any "(16)" marker in the
  passage text to the matching letter.
- **`qPartLabelFirst(blocks, block)` decides who prints the label.** A numbered
  question is usually a text block (the wording) and an MCQ (the options) both
  filed under (21); labelled twice the paper reads "(21) What does… (21) (1)
  humans", which looks like a printing fault. `buildOpenBody` and both print
  builders ask the same function, so screen and paper cannot disagree.
- **The token budget scales with the pages** (`4096 + 3000 × extra`, capped at
  16384). Running out does not fail — it TRUNCATES, and `_repairAIJson` then
  hands back a valid-looking question missing its last few sub-questions.
  `_aiJsonRepaired` is set when a reply had to be repaired, and the build warns
  the author instead of letting the tail go quietly.
- **A sub-question the model could not answer is built with NO tick.** It works
  the answers out from the passage rather than reading a marking scheme, so the
  completion toast says how many need checking. Never turn a missing
  `correctIndex` into a guess.
- Run **`node tools/ai-parts-tests.mjs`** after touching any of it.

### 🔤 The comprehension cloze (`cb*`, block type `clozebank`)

One passage, numbered blanks, and a bank of words lettered (A)–(Q) above it.
The student drags a word into a blank and it is struck off.

- It is **`fillblank`'s sibling, not a variant**. A fill-in-the-blank is marked
  on what the student *wrote*, so it goes to the AI for synonyms and spelling.
  Here the student picks from a closed list, so the mark is exact, instant and
  free — an AI pass could only turn a right answer wrong.
- **The answers ARE the bank**: `cbBank` derives the list from the blanks plus
  the author's distractors, so a bank missing one of its own answers cannot be
  authored. It renders perfectly, prints perfectly and is unanswerable.
- `[[word]]` is **the same markup `fillblank` uses**, parsed by the same
  `_fbParse`. `_fbChipsHtml` takes the toggle to call, because hardcoding
  `fbToggleToken` made every cloze chip a no-op that looked like a working one.
- **`CB_LETTERS` skips I and O** — a handwritten (I) is a 1 and a handwritten
  (O) is a 0. The paper says so in as many words, and `cbIntro` generates that
  sentence from the passage so it cannot drift from it.
- **Struck-off is a RENDER of the placements** (`_cbUsed`), never a second list;
  a flag kept beside them is one drag away from disagreeing with the passage.
  The tapped-and-waiting word lives on the element, not in a map keyed by block
  id — the same block can be on screen in two surfaces at once.
- A **used word is still draggable**, and dropping it MOVES it. Refusing the
  drag would make the only way to correct blank 26 a tap to release and a second
  drag to place.
- **The bank is read DOWN the columns**, as the paper sets it, and the cells are
  sized from the columns actually filled (`_cbCols`).
- Both print builders carry an **explicit `case 'clozebank'`** for exactly the
  reason `fillblank` does, one step worse: falling through to the student
  rendering prints a draggable word bank over a passage of drop targets.
- Run **`node tools/passage-cloze-tests.mjs`** after touching any of it.

## ✍️ Synthesis & transformation (`sy*`, block type `synthesis`)

The last section of the paper: one or two sentences, a word the student must
use, and ONE rewritten sentence meaning exactly the same thing. *"We admire Mr
Kwan. He is our local football player." + "whom"*.

**It is marked by the AI as one whole sentence, and that is the design
constraint.** There is no marking a rewrite in pieces — the meaning lives in the
arrangement, so a clause correct on its own can still be the wrong answer, and a
sentence differing from the model answer word for word can still be right. The
student writes ONE sentence and the marker receives ONE string.

### On screen it is the PAPER: ruled lines, not a box (v1.9.1)

The paper gives this question two ruled lines with the word provided printed at
one end of the first, and the student writes one sentence across both. That is
what the screen shows: `syLines(block)` clickable rules, the cue printed where
the paper prints it, the closing full stop at the end of the last rule — and
**no square marks box**, which on paper is where a teacher writes a mark and on
screen is furniture.

- **Several boxes, still ONE answer.** `_openAnswerEls(el)` is the ONE place the
  group of rules is resolved, and everything that reads, paints, clears or locks
  an answer asks it. Each of those fails in its own silent way if a rule is
  missed: half a sentence surviving a reset into the next question, a red border
  on rule one and none on rule two, and worst — a second rule still typeable
  after the question has been marked and scored.
- A box with no `data-sy-group` **answers for itself**, which is every other
  question type in the app. They see no change at all.
- Only the **FIRST rule** is the registered `.open-answer` and carries
  `data-oidx`. Two would register one answer twice and mark the student on half
  a sentence, twice over.
- `syLineKey` walks the rules — Enter and ↓ forward, ↑ and Backspace-on-empty
  back, never Tab, and never into a locked rule.

- **It hangs off the EXISTING open-answer plumbing rather than growing its own.**
  It renders an `.open-answer` inside an `.open-answer-section` and registers one
  item in `items`, exactly as `_openSection` does, so every marking path, the
  score, the mistake log, the photo-of-your-page route and `_checkAllPartsMarked`
  cover it without knowing it exists. **Do not add a second marking path.**
- **`syRubric` is the ONE place the marker is told what "correct" means**, and it
  travels on `item.rubric` into both marking prompts. Without it the model falls
  back to comparing wording against the model answer and fails every valid
  rewrite phrased differently — which is most of them. Both prompts say a rubric
  OVERRIDES the default "compare by meaning" instruction for that item.
- **`_openAnswerText(el)` is the ONE place an answer is read**, and both marking
  paths call it. It reads the page in the order the page reads, putting back the
  three things that are PRINTED and therefore never typed. Each one missing marks
  a perfect rewrite wrong in its own way:
  - the given **opening** ("This plot of corn ______"), or the marker gets a
    fragment and says it is not a sentence;
  - the word provided printed **BETWEEN the rules** ("… because of its" / "… or"),
    or the marker reads the two rules run together, cannot find the word the
    question required, and says the connector is missing — the whole question,
    answered correctly, marked wrong (v1.9.2);
  - the closing **full stop**, or it marks a perfect answer down for punctuation
    nobody asked for.

  Each goes back **only where the student has not already written it**
  (`_syAlreadyTyped`): a student may reasonably type the whole sentence on one
  rule, word provided and all, and doubling it — "…football player whom." — is
  the same wrong answer from the other direction. An empty set of rules stays
  empty: printed words alone are never an answer.
- **`cueHere` in `syStudentHtml` decides BOTH the span the student reads and the
  `data-after` the marker reads.** Two expressions could disagree, and that
  disagreement is invisible — the page shows the connector, the marker never
  sees it. Same reason `qPartLabelFirst` is asked by screen and paper alike.
- **`syStudentHtml` refuses a block with nothing given**, exactly as
  `syPrintHtml` does — an item is a markable answer, and one with no question
  behind it is a mark the student can never earn.
- `cuePos` is `'use'` (printed at the end of the rule, the sentence must contain
  it) or `'start'` (the given opening). Only `'start'` writes a `data-prefix`.
- **`QPART_OPENER_TYPES` gained `'synthesis'`** — the block carries its own
  question wording, so labelling it is honest on the printed page.
- **Both print builders carry an explicit `case 'synthesis'`**, for `fillblank`'s
  reason: the read-only rendering shows the model answer, which on a worksheet
  is the whole question given away.
- The PRINTED page **keeps its marks box** (`print-sy-box`). Screen and paper
  differ here on purpose: paper is marked with a pen.
- Run **`node tools/synthesis-tests.mjs`** after touching any of it.

## Word & grammar help on a marked question's options

`wh*` (in `app.js`, search `WORD & GRAMMAR HELP`). Once a multiple-choice
question has been **marked**, every option becomes hoverable — tap the ⓘ on a
touch screen — and the card says two things: what the word or phrase **means**,
and why that word **does or does not work in this sentence** (the tense, the
preposition, the part of speech, the partner word).

The second half is the point of it. `_genAndShowExplanation` writes an A.I.
Explanation only when the question has an OPEN part (`hasOpen`), so before this
an MCQ-only question — most of English grammar practice — ended at a red border
and a green one and told the student nothing about the difference.

- **`_mcqPaintResult` is the ONE painter**, and `whArm` is called from it and
  nowhere else. All three marking paths (`markOpenAnswersIn`, and both branches
  of `markQuestionPart`) carried their own copy of the colouring loop, which is
  exactly how this would have ended up armed on two surfaces out of three.
- **It must never arm before marking.** Hover the four options on an unanswered
  question and the one that "fits" is the one to tick. `resetOpenAnswersIn`
  disarms for the same reason, and the gate is the **`wh-on` class checked in
  `_whOpen`** — not unbinding the listeners, which cannot be done without a
  handle on every closure, and which is why a reset used to leave a question
  that still answered a hover.
- **ONE call covers the WHOLE option list**, through `askGeminiCached` (this is
  its first caller) so the prompt hash is the cache key: the prompt carries the
  question, every option and which is correct, so an edited question can never
  be served the old wording's answers. A failed call **removes** that key — the
  raw reply is already in `sessionStorage`, and if it was the PARSE that failed,
  leaving it makes every retry for the rest of the session fail instantly.
- **An answer is placed against an option by the option's OWN number.** This is
  the one thing here that fails silently: an explanation under the wrong option
  reads perfectly and teaches a child the opposite of the truth. `_whNormItems`
  falls back to positional order **only** when the model numbered nothing at all
  AND returned exactly one entry per option; a partial unnumbered list is
  dropped rather than guessed at.
- **An option with no words gets no badge** (`_whHasWords`). A question whose
  choices read "(1) (2) (3) (4)" against a diagram — the shape ✅ Check
  Questions exists to encourage — has nothing to define.
- Run **`node tools/word-help-tests.mjs`** after touching any of it.

## Printing

- **Printed / PDF worksheet answer boxes** are sized from the MODEL ANSWER by
  `printAnswerLines(block, text)`: `PRINT_ANSWER_LINES` (2) is the floor, a
  one-number / ≤4-word answer (`PRINT_SHORT_CHARS`) gets 1 line, longer answers
  scale at `PRINT_LINE_CHARS` (52) characters a ruled line with a
  `PRINT_HAND_ALLOWANCE` (×1.15) for handwriting, capped at `PRINT_LINES_MAX`.
  Each Claim / Evidence / Reasoning box is sized from ITS OWN field. The answer
  block's "Printed lines" field (`block.printLines`) overrides the estimate;
  blank means Auto. The box `min-height` in the print CSS is one line + padding
  (32pt) — do not raise it. Both print paths — `doPrintWorksheetOpen` and the
  saved-worksheet builder — must stay in step.

- **On-screen picture width** is capped by `IMG_AUTO_MAX_PCT` (70%) inside
  `imgSizeStyle` — the ONE function every rendered picture goes through. It is a
  `max-width` CAP, never a `width`: setting `width:70%` would stretch a small
  inset UP to 70% of the column. A picture the author sized by hand
  (`block.scale`) keeps that size.

- **Printed picture heights** — `.print-question-page img` caps at **92mm**, with
  `print-img-sm` (60mm) / `print-img-lg` (140mm) / `print-img-full` (170mm)
  chosen per picture by the image block's "Print size" control. A question whose
  SINGLE picture is paired with ≤3-character MCQ options is upgraded to Large
  automatically (`imgQuestionNeedsBig`). Do NOT go back to one flat 170mm cap.

- **`.print-text-block img` must not set `max-height`.** That selector has the
  SAME specificity (0,1,1) as the `.print-question-page img` 92mm cap while
  sitting later in the file, so a `max-height` there wins and makes
  `print-img-lg` *smaller* than Auto. The ladder must read 60 / 92 / 140 / 170mm.

- **The print planner must MEASURE, never assume.** `_printPlanIn` lays every
  page out in a print-CSS iframe; a page needing fit-to-page shrinking goes
  through `_printVerifiedZoom`, which re-measures with the zoom applied and steps
  down until the page really fits, falling back to a flowing
  (`print-page-tall`) page at the zoom floor. The page box is a fixed height with
  `overflow: visible`, so any un-verified overestimate paints over the NEXT sheet.
  Five things keep the measurement honest — none optional:
  - **Pictures must reserve their box before they load.** An `<img>` that has not
    decoded occupies ~22px, not the ~350px it prints at, and the planner's iframe
    RE-FETCHES every picture. `_printLearnImgDims` / `_printStampImgDims` stamp
    `width`/`height` onto every printed `<img>`. If anything is still unsized,
    `_printPlanPages` refuses to plan and takes `_printFlowFallback`, which is
    denser but can never overlap. **Never emit a printed `<img>` without dimensions.**
  - **`usable` must reserve the page number.** `.print-page-number` is stamped on
    AFTER planning, so `usable = PRINT_PAGE_PX − numH − PRINT_FIT_SAFETY`.
    `budget` derives from the same ceiling, so the packer and the verifier cannot
    drift apart.
  - **A page promoted to tall must promote its CHUNKS too.** `_printPlanIn`
    writes `cls.tallFlags[idx]` and adds `.print-chunk-tall` for the whole group,
    because a chunk that cannot break on an over-sheet page overflows.
  - **The measuring iframe must get the real fonts.** Both font `<link>`s are
    `media="print"` and the iframe is a SCREEN medium, so copying them verbatim
    measures every stem in fallback metrics. `_printFontLinksHtml` forces
    `media="all"` on the COPIES. Never copy `link.outerHTML` directly.
  - **No box may be taller than a sheet.** `PRINT_LINES_MANUAL_MAX` (24) caps the
    author's override; `_wsBlockLines` / `WS_BLOCK_LINES_MAX` (30) cap the raw
    pixel heights `openLines` / `workingSpace` write.

- **Fill-in-the-blank must print BLANK.** `renderImportedBlockStudent`'s
  `fillblank` branch is `_fbReadonlyHtml`, a REVIEW rendering with the answers in
  the slots. Both print builders carry an explicit `case 'fillblank'` using
  `_fbPrintHtml` and push `_fbAnswerKeyText` onto the key. Do not delete either.

- **EVERY question gets an answer on the printed key** (`_pushBlockAnswerKey` /
  `_qFallbackKeySection` / `_akQuestionSections`). Most answers live in an
  `answer` / `plainanswer` box; the rest do not, and were silently dropped — an
  **MCQ**'s correct option, an **`answerLine`**'s answer, a 🔑 **`answerKey`**
  block. A key that omits a question prints perfectly and looks tidy, so the
  teacher only finds out in front of the class.
  - **`answerKeyExtras` gates EXPLANATIONS ONLY.** An answer is never optional;
    an explanation is teaching commentary and stays behind the flag.
  - **`_pushBlockAnswerKey(sections, block, part)` is the ONE pusher both print
    paths call.** Adding an answer-bearing block type means adding a case there,
    not in two switches.
  - **A question with nothing still gets a ROW** — the explanation stands in
    (labelled *Explanation*), and failing that "No answer recorded for this
    question", because a gap in the numbering reads as a printing fault. The
    placeholder is substituted at RENDER time and is deliberately not what
    `hasAny` counts: a bank with no model answers must still print no key sheet.
  - Run **`node tools/answer-key-tests.mjs`** after touching any of it.

## Question parts — (a) (b) (c)

Parts live on `block.part`. A block carrying a part OPENS it and every block
after it INHERITS until the next opener. Read it with `qPartMap(blocks)` /
`qBlockOpensPart(b)` / `qHasParts(blocks)` — never write a second walker.

- **`block.part === QPART_NONE` (`'-'`) files a block under NO part** — how a
  note about the WHOLE question sits among the parts without lying about what it
  explains. It unfiles **that block only** and deliberately does NOT close the
  part. `qPartUnfiled(b)` is the predicate.
- **An explanation explains the question printed directly above it**, and that is
  enforced for EVERY authoring path:
  - **`qApplyAiParts(blocks)` runs inside `buildBlocksFromAi`** — the one
    function every AI authoring path goes through — in this order:
    `qSplitPartBlocks` → `qLiftPartMarkers` → `qScopeExplanations`. The guards
    keep it safe: splitting needs `<br>` to be the only markup
    (`QPART_ONLY_BR_RE` — the cut is a source offset), lowercase consecutive
    letters, and no `mcq` block; lifting inside an MCQ is allowed only on the
    FIRST text block, because every other lettered line is an option.
  - **The AI buttons write for ONE part.** `aiGenerateBlockExplanation` and
    `aiGenerateBlockAnswer` scope their prompt to the part the box sits in,
    marked `>>>` by `_aiPartScopeLine`, with the other parts as labelled
    background they are told not to write.
  - **Every build prompt carries `_partsPromptRules()`** — keep the four prompts
    pointing at that one fragment rather than restating the rules.
- `qPartDetect` matches a single letter **a–h** at the very start, parenthesised
  or not, closed by `)` or `.`. It stops at `h` on purpose (`i` collided with the
  roman sub-part `(i)`), and a bare `X.` must be LOWERCASE (`E. coli` is prose).
  **`QPART_ASSIGN` is a separate, longer alphabet** for what the editor may
  ASSIGN — detection has to be conservative about unvetted text, an admin
  numbering by hand is not guessing.
- `autoNumberParts` must never write an EMPTY part: `qPartMap` inherits forward,
  so an unlabelled opener is filed under the PREVIOUS part and two answers share
  one heading — the very bug parts exist to prevent.
- **Apply re-resolves each question by id** and checks the block still holds the
  scanned text, then saves a COPY and only commits to `questionBank` on success:
  between scan and apply a question can be edited or deleted.

## Authoring surfaces that must not be merged

- **📄 Exam Paper** (`ep*`) takes a whole paper the way a teacher has one:
  question screenshots ONE AT A TIME, the marking scheme SEPARATELY, and the
  paper's own answers slotted in by **question number**.
  - **Nothing is written until Send.** The paper sits in `_epShots` /
    `_epKeyShots` in memory; `_epCommit` is the only writer and it goes through
    `saveQuestion` / `saveVettingQuestion` like every other path.
  - **Screenshots are read as a RUN, never one question per screenshot.**
    `_epRunBuild` sends `EP_BATCH` (4) at a time as multiple images in ONE
    `askGeminiVision` call. Reading is always a read of the WHOLE set — adding or
    removing a screenshot sets `_epDirty` and asks for a re-read.
  - **The paper's question number never reaches the question**
    (`_epStripNumbering`). `EP_LEAD_NUM_RE` ends in `(?!\d)` or "2.5 kg of ice"
    opens with what looks like question 2; a bare leading number needs a `.`/`)`
    after it, so "50 ml of water was added" survives.
  - **The link between a question and its answer is `_epNumKey(number)`**, which
    collapses `Q12 (b)`, `12b` and `12(B)` to one key. Every unmatched question
    gets a per-row `<select>` in the ③ Match table.
  - **A question with parts is matched PART BY PART** — the paper numbers ONE
    question while the scheme answers (a), (b), (c) separately. `_epApplyAnswer`
    places each answer **inside that part's own run of blocks**, never on top of
    the next part's. A question matched on only SOME parts is **partial** and
    both the ③ table and the Send dialog say so.

- **🖊️ Mark Paper** (`mp*`) is the exam-paper builder read backwards: the same
  paper once a student has WRITTEN on it.
  - **It is not Snap & Mark.** Snap & Mark is the STUDENT's tool — one photo, one
    question, matched against a question that must already be in the bank. A
    marked script is thirty questions the bank has never seen, so the questions
    here are read off the paper itself.
  - **The answer key has three sources, best first, and every row says which**:
    🔑 the paper's own marking scheme, 📚 a bank question that is plainly the
    same (`_mpBankMatch`, a cheap token overlap with `MP_BANK_MIN_SIM` at 0.62
    because a wrong match marks the student against the wrong question), then 🤖
    the model's own answer. A teacher checking a mark has to know which.
  - **Reading and marking are separate passes.** `_mpReadScript` sends
    `MP_READ_BATCH` (3) pages in one vision call and is told to transcribe, never
    to mark; `_mpMarkAll` then marks from the transcription in text-only calls.
  - **Nothing is written anywhere.** A marked script is a child's work; it lives
    in memory and leaves through `mpPrintReport` / `mpCopyReport`.
  - Guards: an unmarked question defaults to 1 (MCQ) / 2 (written); `awarded` is
    clamped to `[0, marks]`; a `correct` verdict earns FULL marks; a blank answer
    can never be correct; a batch whose AI call FAILED renders `unmarked` with a
    note rather than a silent zero.

- **✅ Check Questions** (`cq*`) serves the newest questions back one at a time
  for a second pair of eyes. It is not the Question Doctor: the Doctor is a
  whole-bank audit read as a LIST, this is a QUEUE worked newest-first.
  - **The headline check**: a question whose TABLE OR DIAGRAM already sets out
    the four choices, with the options underneath repeating them in words. Those
    should read just **(1) (2) (3) (4)**.
  - **Two layers find it, and neither can do the job alone.** Structurally it is
    decidable only when the choices are in a `table` block. The same question
    with a **picture** is invisible to any text check, so the AI pass attaches the
    diagrams (`_cqMedia` → `askGeminiVision`). **Do not "optimise" that down to
    `askGemini`** — without the images the check cannot be made.
  - **The one-tap fix must never be a guess.** `_cqMcqFixable` gates it on a real
    option list that is not already numbered; the button blanks the wording of
    all four options, so offering it on a question whose choices are NOT in the
    picture destroys the question while looking tidy. The picture-only case
    raises a low-severity nudge with **no fix button**.
  - **`q.checked` lives on the QUESTION, not per user**, and is written with a
    **quiet** save — reading a question is housekeeping, not authoring. It is
    deliberately absent from `EDITOR_OWNED_QUESTION_FIELDS`.
  - Run **`node tools/check-questions-tests.mjs`** after touching any of it.

## 🗑 The bin — deleting a question is a move, not a delete

A question is somebody's work: a screenshot cropped, an answer written, a
diagram touched up. So every real deletion in the app is a **move**
(`questionsEn` → `binEn`, `binQuestion`), restorable in one tap for `BIN_DAYS`
(7), after which the next sign-in sweeps it for good.

- **`binQuestion(id)` is the ONE deletion path** — the bank card's 🗑, the
  Question Doctor's, and ✅ Check Questions' all go through it. `deleteQuestionDoc`
  is the raw hard-delete and stays that way, because two of its three call sites
  are **moves to vetting**, not deletions; binning there would leave a copy in
  the bin of a question that is still very much alive.
- **Copy → read the copy back → delete the original**, the same order as the
  legacy bank rescue. If the copy cannot be verified the question stays in the
  bank; if the *original* cannot be deleted the bin copy is rolled back, because
  a question in both places is worse than a question that refused to delete.
- **A binned question is OUT of `questionsEn`.** It is not a flag on a live
  question — no practice mode, worksheet, search or student can reach it. A
  saved worksheet that referenced it draws its "no longer in the bank" row, and
  restoring puts it back.
- **`binExpired` KEEPS a record whose date it cannot read**, and that asymmetry
  is deliberate: keeping one too long leaves a row in a dialog with a *Delete
  forever* button beside it, while sweeping one too early destroys work in a
  background job with nothing on screen to show it happened. `_binExpiryMs`
  accepts **only an ISO string** for the same reason — `Date.parse` coerces, and
  `Date.parse(12345)` is the *year 12345*, so a numeric timestamp would read as
  perfectly healthy and sit in the bin for ten millennia.
- **The purge is client-side** — there is no server — so it runs when an author
  next opens the app, not on the stroke of the seventh day. `binDaysLeft` is
  therefore what the bin PROMISES (never *less* than 7 days), not a countdown.
- **The confirm dialog is on the bank and the Doctor, and deliberately NOT in
  Check Questions.** That queue is worked at speed with one big button and an
  ↩ Undo in view at all times; a dense list of small 🗑 icons is a different
  risk. `cqUndo` covers the deletion *and* the last ✓, newest first.
- `_firestoreSafeQuestion` is shared with `saveQuestion` — Firestore rejects
  nested arrays, so a table question written to the bin without it fails to save
  at all. Run **`node tools/bin-tests.mjs`** after touching any of it.

## Image touch-up & the transform session

- **Touch up & label** (`_annotXform*`) is ONE session shared by Resize (F),
  Rotate (R) and Skew (K): the selected pixels are lifted onto their own layer
  and nothing is committed until Apply, so 30° and back to 0° leaves the pixels
  as sharp as they started. The transform is **scale → skew → rotate**, and
  `_annotXformMapper` and `_annotXformDrawInto` must apply it in that order or
  the handles drift off the picture they are drawn on.
  - Resize drags the eight handles round the box: the corner OPPOSITE the one
    being dragged is the anchor, so the maths runs in the **M-frame**
    (`_annotXformMFrame`), where the new factor is just
    `(pointer − anchor) / handle-span`. Only the axes a handle actually DRIVES
    get a vote when "keep shape" is on, and `_annotXformRecentre` puts the pivot
    back in the middle after every resize or move.
  - A pointer arrives in CANVAS coordinates and the transform lives in the
    pre-offset frame, so anything comparing the two goes through
    `_annotXformUnoffset` or a grown canvas breaks the hit test.
- **The brush cursor is a RING at the real size of the mark**
  (`ANNOT_RING_TOOLS` / `_annotUpdateBrushRing`). The tools that take no size
  show no ring, and `_annotUpdateBrushRing` only touches `canvas.style.cursor`
  for a tool that IS in `ANNOT_RING_TOOLS`, or it fights the resize handles'
  own cursors. The ring lives in the STAGE, never on the canvas (which is scaled
  and panned underneath it). `_annotSyncControls` is the ONE place every route to
  the size lands, so the "12 px" badge flashes from there.
- **A picture can be PASTED straight in** (`_annotPasteHandler`). Ctrl+V drops it
  on the canvas scaled to fit (`ANNOT_PASTE_FIT`, 90%) and opens the transform
  box with **Resize already in hand**.
  - It is its **own transform scope, `paste`** — the pixels do not come off the
    canvas, so Cancel leaves no trace.
  - **`_annotXformIsIdentity` must return false for a paste**, or a picture
    dropped at 100% and 0° is read as "nothing to do" and silently thrown away.
    That is the one bug this scope can produce, and it looks exactly like the
    paste never happened.
  - The handler is bound in **capture**, because the exam paper builder, Mark
    Paper and the contenteditable guard all listen for `paste` underneath.
- **`_annotPaintCompose` sets the composite mode for a WHOLE stroke** and
  `_annotUp` puts it back; `_annotSetTool` resets it too — a canvas stranded in
  `destination-out` erases everything drawn afterwards.
- **Annotation answers** — an annotation pad carries its own answer on the block:
  `answerImg` is a screenshot of the diagram WITH the correct annotations,
  `answerKey` the same in words. All three consumers read the BLOCK, not the
  question: `annotShowAnswer`, `annotAiCheck` (which sends the screenshot as a
  SECOND picture so the AI compares two diagrams), and `_pushAnnotAnswerKey`.

## Roles

**admin / employee / student.** `EMPLOYEE_EMAILS` names accounts hired to WRITE
QUESTIONS: they get exactly `EMPLOYEE_PAGES` and nothing else. Two rules keep it
default-deny — `configureSidebarForRole('employee')` hides every `.nav-item` and
shows back only those pages, and `navigateTo` rewrites any other page to `create`
(hiding nav items alone would leave a bookmark walking straight in). **Anything
that switches a nav item on after sign-in must ask `_navAllowed(page)` first.**

Gate authoring on **`_canAuthor()`** (admin OR employee), never by widening
`_isAdmin()`. An employee has **no bank of their own**: `_bankOwnerUid()` points
`_qCol`/`_vCol` at the teacher's subtree, so `_resolveBankOwner()` must run (and
`adminUid` be set) before anything reads or writes. Employees must never write
the bank pointer — that is what students resolve the bank from. An employee must
be created with their REAL email; the dialog refuses an address not already on
`EMPLOYEE_EMAILS`. The `role` written to the profile is descriptive only — the
live role is decided at sign-in.

## Work sessions and concurrent tabs

- **The clock is two timestamps, never a counter.** `_wkElapsed` =
  `(endedAt || pausedAt || now) − startedAt − pausedMs`, so a minimised tab, a
  throttled `setInterval` or a sleeping laptop cost nothing. Do not "fix" it by
  accumulating ticks — that is the exact bug this shape prevents.
- `lastSeen` is a 60-second heartbeat meaning *the tab was demonstrably open at
  this moment*, and it is where an abandoned session is closed. Hours when
  nobody was at the keyboard are not hours worked.
- **Questions are logged from `saveQuestion` / `saveVettingQuestion`** — the two
  functions every committed question goes through. `opts.quiet` writes are
  excluded and `_wkSuppress` guards the automatic paths. **Both flags are read at
  CALL time into a local `wkLog`, before the `await`.**
- **One session covers ALL the author's windows, and every write MERGES.**
  `_wkMerge` must stay **idempotent**: items union by question id, `savesByTab`
  counts per tab, `pauseSetAt` decides whose pause is current, any `endedAt`
  wins. `uniq` is DERIVED from the merged list, never incremented.
- `xtInit()` opens a **BroadcastChannel**, falling back to a `localStorage` key.
  Messages are **hints, never data**: a tab is told an id changed and re-reads
  that document, so two tabs cannot talk each other into a state the database
  does not have. `_xtFlushQuestions` debounces (500 ms), **reads first and
  applies after**, and a read that FAILS changes nothing.
- `_xtTabId()` lives in **`sessionStorage`** — per-tab, kept across a reload.
  That is exactly what the exam paper draft needs; don't move it to localStorage.
- **The exam paper draft is mirrored to IndexedDB** (`_epDraft*`) so an unsent
  paper survives a reload. Three records per draft — `epmeta:` (a few numbers, so
  a scan never pulls another window's 90 MB of screenshots into memory),
  `epwork:` and `epshot:` (rewritten only when `_epShotsSig()` changes). Keyed by
  **tab**, never by user.

## Learning objectives

Filed from BOTH ends: from the objective's end (the 🎯 page writes
`loData.map[loId]`) and from the question's end (the editor's 🎯 field writes
`q.los`). **`loQuestions(id)` reads both and dedupes** — that is what makes them
one system. `loDetachQuestion` clears both ends, or the question reappears on the
next render.

- Nothing is written until the question is saved; `los` is in
  `EDITOR_OWNED_QUESTION_FIELDS` or `carryOverQuestionMeta` restores an objective
  the author just removed.
- **`var editorLos`, not `let`** — the block sits near the END of the module and
  `navigateTo('create')`'s reset can reach `loEditorSet` before it is evaluated.
- **`qLos(q)` drops an unknown objective at READ time, and only once the list has
  LOADED** — otherwise a question opened before the list arrives comes back from
  the editor stripped of every objective it had, and is saved that way.
- Run **`node tools/objective-tag-tests.mjs`** after touching any of it: every
  failure here is silent.

## Saved worksheets

A saved worksheet is nothing but an ORDERED list of bank ids (`ws.questionIds`),
so the editor (`wse*`) edits that list and everything else follows.

- It **never touches the question bank** — it only adds and removes references.
  Editing the question ITSELF is the quick-edit drawer (`wsQuickEdit`).
- **Every change persists as it is made** (`_wsPersistWorksheet`): a list of ids
  is a tiny write, and an edit the teacher believes is saved and is not is far
  worse than a chatty connection.
- Removing must also drop the id from `wsManualBreaks` / `wsMergeUp` — those
  overrides are keyed by question id.
- The **whole-paper editor** renders each question through **`buildOpenBody`**,
  the same renderer every student surface uses, so the preview cannot drift. Each
  row needs its OWN container selector — buildOpenBody keys its answer stores by
  selector, and the same selector twice clobbers the first question's answers.

## Versioning convention — applies to EVERY change

1. **Bump the version.** In `app.js`, update `const APP_VERSION = 'vX.Y.Z'`.
   Patch bump for fixes, minor bump for new features.
2. **Keep it visible.** It renders in the sidebar footer for admins only
   (`#appVersionBadge`, class `admin-only`).
3. **Report it.** When summarising an update in chat, always state the new
   version number (e.g. "Shipped in **v1.0.3**").

The point: the user checks the version shown in the sidebar against the number
reported in chat, to know whether the deploy actually went through.

## Design convention — breathing space

- Give elements room to breathe: generous, consistent padding inside
  cards/banners, clear vertical spacing between title → description → meta →
  buttons, comfortable line-height. Never cram content edge-to-edge.
- Cards/banners are rounded rectangles constrained to a sensible max-width (not
  full page width) and centred.
- When the user says something is "too big/thick/messy", the fix is usually
  *more* whitespace and a tighter width, not shrinking fonts until it's cramped.
- Keep the spacing scale consistent so every surface feels like one design system.

## House rules

- After editing `app.js`, validate it:
  `cp app.js /tmp/c.mjs && node --check /tmp/c.mjs` (the `.mjs` copy makes Node
  parse it as a module, so `import` at the top is accepted).
- **The Gemini model is `AI_MODEL` and its thinking floor is `AI_THINK_MIN`, and
  the two move TOGETHER** (v1.2.0). Every model has its own thinking scale, and a
  level it does not know is a **400 INVALID_ARGUMENT on every AI call in the
  app** — not a degraded answer, no answer at all. `gemini-3.7-flash` takes
  `low` / `medium` / `high` and **dropped the `"minimal"` 3.6 accepted**, exactly
  as 3.x had already dropped 2.x's numeric `thinkingBudget`. So the floor is a
  named constant used at every call site rather than a string typed out in three
  places, and swapping the model means checking its scale first. The Science app
  (`polymathlc/cer`) carries the same pair — keep the two in step.
- Run the ten harnesses after touching what they cover — every failure they
  catch is **silent**, with nothing thrown and nothing wrong on screen:
  - `node tools/answer-key-tests.mjs`
  - `node tools/check-questions-tests.mjs`
  - `node tools/objective-tag-tests.mjs`
  - `node tools/learning-gap-tests.mjs`
  - `node tools/bin-tests.mjs` — the bin's calendar and stored record, plus the
    `_firestoreSafeQuestion` helper every save shares. A day counted wrong
    purges somebody's question early, in a background sweep, with nothing on
    screen; a field lost on the way in is a question that comes back broken a
    week later with nothing left to compare it against.
  - `node tools/bank-rescue-tests.mjs` — the one-time rescue's topic verdicts.
    Wrong in one direction it leaves an author's questions in the other app and
    reports nothing to move; wrong in the other it offers a one-click **delete
    from the Science bank**. It also pins the premise the whole heuristic rests
    on: that the two subjects' topic lists share no entry.
  - `node tools/word-help-tests.mjs` — which OPTION each of the model's answers
    is about. Line them up wrong and the popout still opens, still looks right
    and still reads fluently, while telling a child that "reluctantly" cannot be
    used because it is an adjective.
  - `node tools/synthesis-tests.mjs` — the rubric the sentence-rewrite marker
    is given, and the printed opening being put back before marking. Lose the
    rubric and a correct rewrite worded differently from the model answer is
    marked wrong; lose the prefix and the marker judges a fragment.
  - `node tools/ai-parts-tests.mjs` — the `"part"` the AI puts on a block, and
    that the typed-marker pass leaves it alone. Drop it and a comprehension page
    is eight option lists in a row with nothing telling them apart, on a screen
    that still looks right.
  - `node tools/passage-cloze-tests.mjs` — the passage builder's parse, the
    cloze's word bank, and the part lettering both rest on. A passage split
    one line early swallows the first option list; a question number read off a
    quantity cuts the passage in half; a bank that does not contain one of its
    own answers renders and prints perfectly and is unanswerable.

### Two CSS traps in `index.html`

- **`.confirm-dialog` is declared LATE** and sets `max-width: 400px`, `padding`
  and `text-align: center`. A new dialog variant that only adds a second class
  earlier in the file silently loses all three. Use `.confirm-dialog.your-variant`
  (both classes) for anything that clashes.
- **Tailwind's preflight sets `appearance: none` on form controls**, so a bare
  `<input type="radio">`/`checkbox` renders as an invisible white box. Set
  `appearance: auto` (plus `-webkit-`) on any you add, or draw your own.
- **A `<button>` does not inherit `color`** the way a div does — it falls back to
  the browser's own button text. Any card-shaped button must set
  `color: var(--text)` itself, or its child text is invisible on a dark surface.

## The fork

This repo was created from `polymathlc/cer` by removing the game layer:
the RPG hero, the dungeon, the arcade, the Realm of Embers trading-card game,
Ember Duel / Siege / Legends, Science Strike, the game leaderboards, points,
packs, prizes and game credits — about 20,000 lines of `app.js` and 1,200 CSS
rules. What replaced the hero doc is the small **Learner progress** store above.

Do not port the games back. If you are copying a fix across from the Science
repo, take the teaching-side change only, and remember that the two apps use
different collection names (see **Where the data lives**) and a different
`topicLevelMap` / `SYLLABUS_LO_TOPICS`.

The **Textbooks** page is also absent: it embedded a file of Science content with
no English equivalent.
