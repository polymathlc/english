# English Learning Portal

The Polymath teaching portal, for English. It is a fork of the Science portal
(`polymathlc/cer`) with the whole game layer removed and the subject changed —
same authoring tools, same AI marking, same worksheets, no RPG.

Two files are the app: **`index.html`** (markup + CSS) and **`app.js`** (all of
the JavaScript). They ship together — deploy the directory, never the single
file.

---

## What it does

**For the teacher and the question writers**

| | |
|---|---|
| ✍️ Create Question | Block editor — text, pictures, tables, MCQ, open answers, fill-in-the-blank, annotation pads, working space, interactive widgets |
| 🤖 Build from screenshot | Photograph or paste an exam question and the AI writes it up as a question, cropping the figures out of the picture |
| 📚 Bulk import | A whole paper as a PDF, streamed into the vetting queue |
| 📄 Exam Paper | A whole paper added a screenshot at a time, with its marking scheme added separately and slotted into the questions by question number |
| 🖊️ Mark Paper | Scan a script a student has written on: the AI finds each question, reads the handwriting, marks it and writes the report |
| ✅ Check Questions | The newest questions served back one at a time for a second pair of eyes |
| 🩺 Question Doctor | A whole-bank audit — duplicates, blank answers, broken options |
| 🎯 Learning Objectives | The MOE English Language Syllabus outcomes, with questions filed under each |
| 📚 Teaching Notes | Upload your own notes; the AI grounds every question and every mark on them |
| ⏱️ Work Sessions | Clock on before writing questions; every question saved is logged against the session |
| 📋 Worksheets | Build from the bank, print or export as PDF, with an optional cover page and an answer key |
| 📊 Usage | Logins, questions attempted, accuracy, and an activity view with prompts to look |

**For the student**

Quick practice, topical practice, worksheet practice, past papers, Snap & Mark
(photograph a question and your handwritten answer and have it marked), revision
flashcards built from your own mistakes, a progress report, the community board,
and Ai-nstein — the study buddy that follows you from page to page.

**My Gaps** keeps the list of what you don't understand *yet* — the actual
grammar point or word, not just the topic — worked out from the questions you
get wrong. Each gap picks its own practice out of the question bank, and when
there is nothing left in there for it, a brand-new question is written for that
gap on the spot. Every student gets **30 credits a day**: one credit buys another
question on something you just got wrong, so a mistake becomes a second attempt
instead of a dead end. A gap closes after three right answers in a row, and
re-opens the moment you slip on it again.

---

## Setting it up

### 1. Firestore rules

**This is the step that will bite you if you skip it.** The app shares a
Firebase project with the Science portal but shares no data with it: every
collection carries an English name of its own (`users/{uid}/questionsEn`,
`enUserProfiles`, `enCommunity`, …). Firestore denies anything the rules do not
name, and denial is *silent* — pages come back empty rather than erroring — so
until the rules are deployed the app will look broken in a way nothing on screen
explains.

`firestore.rules` in this repo has the block to deploy. Paste its `match`
statements into the project's existing rules **alongside** the Science app's, in
the same `service cloud.firestore` block. Do not replace that file with this one:
that would lock the Science app out of its own data.

### 2. Point the bank at yourself

Sign in as the teacher account, then write the pointer every student resolves
the bank from:

```
enConfig/admin  →  { uid: "<the teacher's uid>" }
```

Until that document exists, students see *"Admin has not set up the question
bank yet"*.

### 3. Admin and employee accounts

Roles are decided at sign-in from two lists near the top of `app.js`:

- `ADMIN_EMAILS` — full access.
- `EMPLOYEE_EMAILS` — accounts hired to write questions. They get the authoring
  pages and nothing else, and they author straight into the teacher's bank.

Everyone else is a student.

### 4. The question bank starts empty

That is deliberate — it is an English bank, not the Science one. The past-paper
library starts empty too (`PP_SEED_Q`), and the syllabus objectives are seeded
from the MOE English Language Syllabus and are editable from the 🎯 page.

### To fork the data completely

Everything above assumes one Firebase project. To give English its own project
instead, replace `firebaseConfig` in `app.js` and the collection names can go
back to their plain forms.

---

## Working on it

```bash
# app.js must parse as a module
cp app.js /tmp/c.mjs && node --check /tmp/c.mjs

# the harnesses that guard the silent failures
node tools/answer-key-tests.mjs        # a key that drops a question prints fine
node tools/check-questions-tests.mjs   # a bad auto-fix destroys a question
node tools/objective-tag-tests.mjs     # a lost tag throws nothing
```

**Bump `APP_VERSION` in `app.js` on every change.** It renders in the sidebar
footer for admins, and it is how you tell whether the deploy actually went
through. Report the new number when you describe a change.

See `CLAUDE.md` for the design decisions worth knowing before editing —
especially the print planner, the annotation transform session, question parts
and the concurrent-tab rules.

---

## What is deliberately not here

The Science portal's game layer: the RPG hero, the dungeon, the arcade, the
Realm of Embers trading-card game, Ember Duel / Siege / Legends, Science Strike,
the game leaderboards, points, packs, prizes and game credits. About 20,000
lines of `app.js` and 1,200 CSS rules. The student progress underneath it —
questions marked, accuracy, day streak — is still there, because the report, the
Home screen and the teacher's dashboard read it.

The Textbooks page is not here either: it embedded a file of Science content
with no English equivalent.
