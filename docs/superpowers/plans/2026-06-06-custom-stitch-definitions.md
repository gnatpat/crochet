# Custom Stitch Definitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a pattern declare its own stitches with `def` lines (e.g. bobble, mini picot) that render as single, atomic press-steps showing a definition; and extract the AI converter prompt out of inline JS into a readable file that learns the new `def` grammar.

**Architecture:** Custom stitches are pattern-supplied entries that behave like `SPECIALS`: one press, opaque, with a `count` (output contribution, default 1) and a display-only `description`. `parsePattern` does a pre-pass collecting all `def` lines into a `custom` map, then threads that map through the parser/expander. A new press-step field `definition` carries the description to the UI, shown inline under the big button. The converter prompt moves to `convert-prompt.js` (loaded via `<script src>` so it works under `file://`) and gains the `def` grammar.

**Tech Stack:** Vanilla JS (`lib.js` engine, `index.html` UI), Node test runner (`tests.js`, run with `node tests.js`).

---

## File Structure

- `lib.js` — engine. Add `RESERVED_NAMES`, `parseDef`, `collectCustomStitches`; thread a `custom` map through `parsePattern`, `parseLine`, `parseInstList`, `parseInst`, `expandInstructions`, `makeStitchSteps`; add `definition` to custom press-steps.
- `tests.js` — engine tests. Add cases for def parsing/validation and custom tokens in rows.
- `convert-prompt.js` — **new**. Holds `window.CONVERT_PROMPT` as one template literal. Gains `def` grammar.
- `index.html` — remove inline `CONVERT_PROMPT` array, load `convert-prompt.js`, render the inline definition under the big button, add `.stitch-def` CSS.

---

## Task 1: Extract the AI prompt into `convert-prompt.js`

Pure mechanical move — no behavior change. The current prompt is an array of quoted strings at [index.html:279-523](index.html#L279) ending in `].join('\n')`. We move its joined text into a template literal in a new file.

**Files:**
- Create: `convert-prompt.js`
- Modify: `index.html:204-205` (add script tag), `index.html:279-523` (remove inline array)

- [ ] **Step 1: Create `convert-prompt.js`**

Open `index.html` and read the array body at lines 279–523. Each array element is one line of the prompt. Build the new file by placing every line's text, in order, inside a single backtick template literal (drop the per-line `"..."` quotes, the trailing commas, the surrounding `[ ]`, and the `.join('\n')`). Un-escape JS string escapes: `\"` becomes `"`, `\\` becomes `\`. Backtick characters and `${` do not appear in the prompt text, so no new escaping is needed (if any are found, escape them as `` \` `` / `\${`).

The file's first and last lines must look exactly like this (anchors — keep everything in between):

```js
// AI converter system prompt. Loaded as window.CONVERT_PROMPT before the
// main inline script in index.html. Plain template literal so it stays
// readable; must work under file:// (loaded via <script src>, not fetch).
window.CONVERT_PROMPT = `You convert a crochet pattern from natural language into a strict DSL. Output ONLY the DSL — no commentary, no markdown fences, no preamble.

============================================================
DSL GRAMMAR — the ONLY constructs you may emit
============================================================
` /* ...all remaining prompt lines, in order... */ + ``;
```

Note: the simplest correct form is one unbroken template literal — start with `` window.CONVERT_PROMPT = ` `` immediately before "You convert…", paste every prompt line (real newlines between them), and close with `` `; `` right after the final prompt line. Do not include the `/* ... */ + \`\`` shown above; that is only illustrating where the body goes.

- [ ] **Step 2: Add the script tag in `index.html`**

At [index.html:204](index.html#L204), the existing line is:

```html
  <script src="lib.js"></script>
  <script>
```

Change it to load the prompt first:

```html
  <script src="lib.js"></script>
  <script src="convert-prompt.js"></script>
  <script>
```

- [ ] **Step 3: Remove the inline array from `index.html`**

Delete the entire `const CONVERT_PROMPT = [ ... ].join('\n');` block (lines 279–523, from `const CONVERT_PROMPT = [` through `    ].join('\n');` inclusive). The usage at the (now-renumbered) `messages: [{ role: 'user', content: CONVERT_PROMPT + rawText }]` line stays unchanged — it now reads the global string set by `convert-prompt.js`.

- [ ] **Step 4: Verify the prompt loads as a non-empty string**

Run:

```bash
node -e "global.window={}; require('./convert-prompt.js'); const p=window.CONVERT_PROMPT; if (typeof p!=='string' || p.length<2000 || !p.includes('DSL GRAMMAR') || !p.includes('WORKED EXAMPLE 1')) { console.error('FAIL: prompt missing/too short'); process.exit(1); } console.log('OK, length', p.length);"
```

Expected: `OK, length <number>` (a few thousand).

- [ ] **Step 5: Verify the inline array is gone**

Run:

```bash
grep -c "CONVERT_PROMPT = \[" index.html
```

Expected: `0`.

- [ ] **Step 6: Verify engine tests still pass**

Run: `node tests.js`
Expected: `... passed` with `(0 FAILED)` — i.e. no `(N FAILED)` suffix, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add convert-prompt.js index.html
git commit -m "refactor: extract AI converter prompt into convert-prompt.js"
```

---

## Task 2: Teach the converter the `def` grammar

Add the `def` line type and translation rules to the now-readable prompt.

**Files:**
- Modify: `convert-prompt.js`

- [ ] **Step 1: Add `def` to the line-type list**

In `convert-prompt.js`, find the block that lists line types (it contains `Section header:   [SECTION NAME]` and `Row:              <N>: <inst-list> (<count>)`). Add a `Custom stitch def` entry right after the `Row range:` line, so it reads:

```
  Row:              <N>: <inst-list> (<count>)
  Row range:        <N>-<M>: <inst-list> (<count>)
  Custom stitch:    def <name> [(<count>)] = <description>

A `def` line declares a pattern-specific stitch (e.g. a bobble or picot) that
is not in the standard token table. It is OPAQUE: one press, not broken into
sub-steps. <name> is one lowercase word. The optional (<count>) is how many
stitches it adds to a row's total — DEFAULT 1; use (0) for a decorative stitch
(e.g. a picot) that does not add to the count. <description> is free text shown
to the user. Put def lines at the TOP, before the sections that use them. Once
defined, use <name> in rows exactly like any other token.
```

- [ ] **Step 2: Add translation rules for inline definitions**

Find the `TRANSLATION RULES` table (the `source phrase  ->  DSL` list) and add these rows near the bottom of it:

```
  "X = ..." or "(ab = ...)" defining a stitch abbreviation -> a `def` line; then use the token X/ab in rows
  a bobble / popcorn / puff that replaces one stitch        -> def it (count 1, the default), use the token
  a picot / decorative motif worked between stitches        -> def it with (0), use the token between stitches
```

- [ ] **Step 3: Relax the "never invent tokens" rule**

Find rule 7 in `MANDATORY TRANSLATION DISCIPLINE`:

```
7. NEVER invent stitch tokens. The grammar above (token table + the
   increases/decreases section) is exhaustive.
```

Replace it with:

```
7. NEVER invent stitch tokens out of thin air. The token table + increases/
   decreases are exhaustive for STANDARD stitches. The ONE exception: when the
   source pattern itself defines a non-standard abbreviation (e.g. "bo = bobble
   stitch", "(mp = mini picot, ch2, slst…)"), emit a `def` line for it and use
   that token in rows — do NOT bury it in a note.
```

- [ ] **Step 4: Add a worked example with custom stitches**

Find `WORKED EXAMPLE 1` and immediately before it, add a small worked example. Insert this block (keep the existing `WORKED EXAMPLE 1` heading right after it):

```
============================================================
WORKED EXAMPLE 0 — custom stitches (def)
============================================================

Input:
BODY
1. 6 sc in magic ring (6)
6. sc6, then sc, [hdc, mp, hdc] x5, sc (18)
   (mp = mini picot, ch2, slst into first ch made to form a point)
8. sc, bo, sc2, bo, sc13 (18)
bo = bobble stitch

Output:
def bo = bobble stitch
def mp (0) = mini picot, ch2, sl st into first ch made to form a point

[BODY]
1: 6 sc in MR (6)
6: 6 sc, sc, [hdc, mp, hdc] x 5, sc (18)
8: sc, bo, 2 sc, bo, 13 sc (18)

Notes on this example:
- `mp` is decorative, so it is `(0)` and does NOT count toward the row's (18).
  Row 6 total = 6 + 1 + 5×(hdc + hdc) + 1 = 18.
- `bo` replaces one stitch, so it uses the default count of 1.
  Row 8 total = 1 + 1 + 2 + 1 + 13 = 18.

```

- [ ] **Step 5: Verify the prompt still loads and contains the new grammar**

Run:

```bash
node -e "global.window={}; require('./convert-prompt.js'); const p=window.CONVERT_PROMPT; if (!p.includes('def <name>') || !p.includes('WORKED EXAMPLE 0') || !p.includes('def mp (0)')) { console.error('FAIL: def grammar missing'); process.exit(1); } console.log('OK');"
```

Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add convert-prompt.js
git commit -m "feat: teach AI converter the def grammar for custom stitches"
```

---

## Task 3: Collect and validate `def` lines in the engine

Add def parsing, a reserved-name set, the pre-pass collector, and wire it into `parsePattern` (skip def lines; surface validation errors). No row can use a custom token yet — that's Task 4. This task is independently testable via `parsePattern`'s error array and block list.

**Files:**
- Modify: `lib.js` (after `SPECIALS`, near `parseLine`, inside `parsePattern`)
- Test: `tests.js`

- [ ] **Step 1: Write failing tests**

Add to `tests.js`, just before the `// ---- Report ----` block:

```js
  // ---- Custom stitch defs: collection & validation ----

  {
    const { blocks, errors } = C.parsePattern('def bo = bobble stitch\n[BODY]\n1: 6 sc (6)');
    eq(errors.length, 0, 'def: valid def + row has no errors');
    eq(blocks.filter(b => b.type === 'row').length, 1, 'def: def line produces no row block');
    eq(blocks.some(b => b.rawLine && b.rawLine.indexOf('def ') === 0), false, 'def: no block for the def line itself');
  }
  {
    const { errors } = C.parsePattern('def sc = something\n1: 6 sc (6)');
    eq(errors.length >= 1, true, 'def: reserved name (sc) is rejected');
  }
  {
    const { errors } = C.parsePattern('def bo = first\ndef bo = second\n1: 6 sc (6)');
    eq(errors.length >= 1, true, 'def: duplicate name is rejected');
  }
  {
    const { errors } = C.parsePattern('def bo =\n1: 6 sc (6)');
    eq(errors.length >= 1, true, 'def: empty description is rejected');
  }
  {
    const { errors } = C.parsePattern('def = nameless\n1: 6 sc (6)');
    eq(errors.length >= 1, true, 'def: missing name is rejected');
  }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests.js`
Expected: FAIL — the "no errors" / "no row block" cases fail because `def` lines are currently treated as unparseable rows (errors), and the validation cases may pass for the wrong reason. At least one `FAIL` line appears and exit code is 1.

- [ ] **Step 3: Add `RESERVED_NAMES`**

In `lib.js`, immediately after the `SPECIALS` object closes (after [lib.js:29](lib.js#L29)), add:

```js
  // Names a pattern may NOT use for a custom `def` — built-in tokens plus the
  // grammar words the parser reserves.
  const RESERVED_NAMES = new Set([
    ...HEIGHTS,
    'ch', 'tch', 'sl st', 'slst', 'join', 'mr', 'fo', 'turn',
    'inc', 'dec', 'tog', 'in', 'blo', 'flo', 'x', 'def',
  ]);
```

- [ ] **Step 4: Add `parseDef` and `collectCustomStitches`**

In `lib.js`, immediately before `function parseLine(` ([lib.js:187](lib.js#L187)), add:

```js
  // A custom stitch definition line: "def NAME [(count)] = description".
  // Returns { name, count, description }. Throws on malformed/reserved/empty.
  function parseDef(line) {
    const m = line.match(/^def\s+([A-Za-z][A-Za-z0-9]*)\s*(?:\((\d+)\))?\s*=\s*(.+)$/i);
    if (!m) throw new Error('Malformed def (use: def NAME [(count)] = description): "' + line + '"');
    const name = m[1].toLowerCase();
    if (RESERVED_NAMES.has(name)) throw new Error('Cannot define reserved stitch name: "' + name + '"');
    const count = m[2] != null ? parseInt(m[2], 10) : 1;
    const description = m[3].trim();
    if (!description) throw new Error('Empty definition for "' + name + '"');
    return { name, count, description };
  }

  // Pre-pass: scan every line for `def` lines and build the custom-stitch map.
  // Lets defs sit anywhere (conventionally the top) and still resolve in rows.
  function collectCustomStitches(lines) {
    const custom = {};
    const errors = [];
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].replace(/#.*$/, '').trim();
      if (!/^def\b/i.test(stripped)) continue;
      let def;
      try { def = parseDef(stripped); }
      catch (e) { errors.push({ line: i + 1, message: e.message, raw: lines[i] }); continue; }
      if (custom[def.name]) {
        errors.push({ line: i + 1, message: 'Duplicate stitch definition: "' + def.name + '"', raw: lines[i] });
        continue;
      }
      custom[def.name] = def;
    }
    return { custom, errors };
  }
```

- [ ] **Step 5: Wire the pre-pass into `parsePattern`**

In `parsePattern`, just after `const lines = (text || '').split('\n');` ([lib.js:51](lib.js#L51)), add:

```js
    const { custom, errors: defErrors } = collectCustomStitches(lines);
    for (const e of defErrors) errors.push(e);
```

Then, inside the main `while` loop, right after the empty-line guard `if (!stripped) { i++; continue; }` ([lib.js:78](lib.js#L78)), add a guard so def lines are skipped (they were already handled by the pre-pass):

```js
      // `def` lines were consumed by the pre-pass; they produce no block.
      if (/^def\b/i.test(stripped)) { i++; continue; }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node tests.js`
Expected: PASS — all previous tests plus the 5 new def cases. `(0 FAILED)`.

- [ ] **Step 7: Commit**

```bash
git add lib.js tests.js
git commit -m "feat: collect and validate custom stitch def lines"
```

---

## Task 4: Use custom stitches in rows

Thread the `custom` map through the instruction parser and expander so a defined token can be used in rows, expands to one press-step with the right `outputDelta`, and carries its `definition` (including inside repeated groups).

**Files:**
- Modify: `lib.js` (`parseLine`, `parseInstList`, `parseInst`, `makeStitchSteps`, `expandInstructions`, and the `expandInstructions` call inside `parsePattern`)
- Test: `tests.js`

- [ ] **Step 1: Write failing tests**

Add to `tests.js`, just before the `// ---- Report ----` block:

```js
  // ---- Custom stitches used in rows ----

  {
    const src = 'def bo = bobble stitch (yo, pull up x5, close)\n1: sc, bo, 2 sc, bo, 13 sc (18)';
    const { rows, errors, warnings } = C.parsePattern(src);
    eq(errors.length, 0, 'custom row: no errors');
    eq(warnings.length, 0, 'custom row: total 18 matches');
    const steps = rows[0].pressSteps;
    const total = steps.reduce((a, s) => a + s.outputDelta, 0);
    eq(total, 18, 'custom row: bo counts as 1 each -> 18');
    const bo = steps.find(s => s.stitch === 'bo');
    eq(bo.outputDelta, 1, 'custom row: bo outputDelta default 1');
    eq(bo.label, 'bo', 'custom row: bo label is its name');
    eq(bo.definition, 'bobble stitch (yo, pull up x5, close)', 'custom row: bo carries its definition');
  }
  {
    const src = 'def mp (0) = mini picot: ch2, sl st\n6: 6 sc, sc, [hdc, mp, hdc] x 5, sc (18)';
    const { rows, errors, warnings } = C.parsePattern(src);
    eq(errors.length, 0, 'picot row: no errors');
    eq(warnings.length, 0, 'picot row: mp(0) keeps total at 18');
    const steps = rows[0].pressSteps;
    const mp = steps.find(s => s.stitch === 'mp');
    eq(mp.outputDelta, 0, 'picot row: mp(0) contributes 0');
    eq(mp.definition, 'mini picot: ch2, sl st', 'picot row: mp inside a group still carries its definition');
    eq(steps.filter(s => s.stitch === 'mp').length, 5, 'picot row: group x5 produced 5 mp steps');
  }
  {
    const src = 'def bo = bobble\n1: 2 bo (2)';
    const { rows, errors } = C.parsePattern(src);
    eq(errors.length, 0, 'custom count: "2 bo" parses');
    eq(rows[0].pressSteps.length, 2, 'custom count: 2 bo -> 2 steps');
  }
  {
    const { errors } = C.parsePattern('1: 6 zz (6)');
    eq(errors.length >= 1, true, 'undefined token still errors');
  }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests.js`
Expected: FAIL — `bo`/`mp` are unknown tokens, so the rows error (`Unknown instruction`). Several new cases fail; exit code 1.

- [ ] **Step 3: Thread `custom` through the parse chain**

In `lib.js`, update these four signatures and their internal calls to pass `custom` (default `{}` keeps existing direct callers working):

`parseLine` ([lib.js:187](lib.js#L187)):

```js
  function parseLine(line, custom = {}) {
```

and its instruction call ([lib.js:195](lib.js#L195)):

```js
    const instructions = parseInstList(m[3], custom);
```

`parseInstList` ([lib.js:222](lib.js#L222)):

```js
  function parseInstList(text, custom = {}) {
    return splitTopLevel(text, ',').map(t => parseInst(t, custom));
  }
```

`parseInst` ([lib.js:226](lib.js#L226)) — change the signature and the group-recursion call:

```js
  function parseInst(text, custom = {}) {
```

and inside the `groupMatch` branch ([lib.js:230](lib.js#L230)):

```js
        instructions: parseInstList(groupMatch[1], custom),
```

- [ ] **Step 4: Recognize custom tokens in `parseInst`**

In `parseInst`, replace the final fallback for special tokens. The current tail ([lib.js:296-299](lib.js#L296)) is:

```js
    const s2 = text.match(new RegExp('^' + SPECIAL_RE.source + '(?:\\s+(\\d+))?$', 'i'));
    if (!s2) throw new Error('Unknown instruction: "' + text + '"');
    count = s2[2] != null ? parseInt(s2[2], 10) : 1;
    return { type: 'stitch', stitch: normalizeStitchName(s2[1]), op: null, count, inMR, modifier };
```

Replace it with (handle the special match first, then try custom tokens, then throw):

```js
    const s2 = text.match(new RegExp('^' + SPECIAL_RE.source + '(?:\\s+(\\d+))?$', 'i'));
    if (s2) {
      count = s2[2] != null ? parseInt(s2[2], 10) : 1;
      return { type: 'stitch', stitch: normalizeStitchName(s2[1]), op: null, count, inMR, modifier };
    }

    // 5. Custom (pattern-defined) stitch, optional count on either side.
    const names = Object.keys(custom);
    if (names.length) {
      // Longest name first so a name that is a prefix of another can't shadow it.
      const NAME_RE = names.slice().sort((a, b) => b.length - a.length).join('|');
      let c1 = text.match(new RegExp('^(?:(\\d+)\\s*)?(' + NAME_RE + ')$', 'i'));
      if (c1) {
        if (c1[1] != null) count = parseInt(c1[1], 10);
        return { type: 'stitch', stitch: c1[2].toLowerCase(), op: null, count, inMR, modifier };
      }
      const c2 = text.match(new RegExp('^(' + NAME_RE + ')\\s+(\\d+)$', 'i'));
      if (c2) {
        return { type: 'stitch', stitch: c2[1].toLowerCase(), op: null, count: parseInt(c2[2], 10), inMR, modifier };
      }
    }

    throw new Error('Unknown instruction: "' + text + '"');
```

(Custom names are `[a-z][a-z0-9]*`, so they contain no regex metacharacters and need no escaping.)

- [ ] **Step 5: Emit definition steps in `makeStitchSteps`**

Change the signature ([lib.js:304](lib.js#L304)) to accept `custom`:

```js
  function makeStitchSteps(stitch, op, modifier, custom = {}) {
```

Then, immediately after the `SPECIALS` block returns (after [lib.js:316](lib.js#L316), before `// Height tokens.`), add the custom branch:

```js
    // Custom (pattern-defined) stitch: one opaque press carrying its definition.
    if (custom[stitch]) {
      const info = custom[stitch];
      return [{ stitch, label: stitch + suffix, outputDelta: info.count, modifier: mod, definition: info.description }];
    }
```

- [ ] **Step 6: Thread `custom` and preserve `definition` in `expandInstructions`**

Change the signature ([lib.js:337](lib.js#L337)):

```js
  function expandInstructions(insts, custom = {}) {
```

In the `group` branch, recurse with `custom` and copy the `definition` field ([lib.js:341-345](lib.js#L341)):

```js
      if (inst.type === 'group') {
        const inner = expandInstructions(inst.instructions, custom);
        for (let i = 0; i < inst.repeat; i++) {
          for (const s of inner) steps.push({
            stitch: s.stitch, label: s.label, outputDelta: s.outputDelta,
            modifier: s.modifier || null, definition: s.definition || null,
          });
        }
      } else {
```

And in the `else` branch, pass `custom` to `makeStitchSteps` ([lib.js:352](lib.js#L352)):

```js
          for (const s of makeStitchSteps(inst.stitch, inst.op, inst.modifier, custom)) steps.push(s);
```

- [ ] **Step 7: Pass `custom` to `expandInstructions` in `parsePattern`**

In `parsePattern`, the row-expansion call ([lib.js:155](lib.js#L155)):

```js
        const pressSteps = expandInstructions(parsed.instructions, custom);
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node tests.js`
Expected: PASS — all prior tests plus the 4 new custom-row cases. `(0 FAILED)`.

- [ ] **Step 9: Commit**

```bash
git add lib.js tests.js
git commit -m "feat: use custom stitches in rows with definitions"
```

---

## Task 5: Show the definition under the big button

When the current step is a custom stitch, render its `definition` inline below the "Next:" label so the flow isn't interrupted (no extra tap).

**Files:**
- Modify: `index.html` (CSS near [index.html:183](index.html#L183); render near [index.html:1010](index.html#L1010))

- [ ] **Step 1: Add the `.stitch-def` style**

In `index.html`, after the `.big-button .hint` rule ([index.html:183](index.html#L183)), add:

```css
    .big-button .stitch-def { font-size: 15px; opacity: 0.72; margin-top: 12px; max-width: 92%; line-height: 1.35; }
    .big-button.compact .stitch-def { font-size: 12px; margin-top: 6px; }
```

- [ ] **Step 2: Render the definition**

In the big-button render block, the current lines ([index.html:1010-1012](index.html#L1010)) are:

```js
          bigBtn.appendChild(el('div', { class: 'next-small' }, 'Next:'));
          bigBtn.appendChild(el('div', { class: 'next-label' }, C.nextLabel(cur, parsed)));
          bigBtn.appendChild(el('div', { class: 'hint' }, 'Tap, or press Space / Enter'));
```

Insert the definition between the label and the hint:

```js
          bigBtn.appendChild(el('div', { class: 'next-small' }, 'Next:'));
          bigBtn.appendChild(el('div', { class: 'next-label' }, C.nextLabel(cur, parsed)));
          const defBlock = C.currentBlock(cur, parsed);
          const defStep = (!cur.markerPending && defBlock && defBlock.pressSteps)
            ? defBlock.pressSteps[cur.stepIndex] : null;
          if (defStep && defStep.definition) {
            bigBtn.appendChild(el('div', { class: 'stitch-def' }, 'ⓘ ' + defStep.definition));
          }
          bigBtn.appendChild(el('div', { class: 'hint' }, 'Tap, or press Space / Enter'));
```

- [ ] **Step 3: Verify the engine still passes (no regressions)**

Run: `node tests.js`
Expected: `(0 FAILED)`.

- [ ] **Step 4: Manual UI check**

Open `index.html` in a browser (or via the server). Create a project with this pattern:

```
def bo = bobble stitch (yo, pull up a loop x5, yo and pull through all 6)
def mp (0) = mini picot, ch2, sl st into first ch

[BODY]
1: 6 sc in MR (6)
8: sc, bo, 2 sc, bo, 13 sc (18)
```

Tap through row 8. When the next step is `bo`, confirm the big button shows the label `bo` with `ⓘ bobble stitch (yo, pull up a loop x5, yo and pull through all 6)` beneath it, and that plain `sc` steps show no definition line. Confirm the row progress reaches `18 / 18`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: show custom stitch definition under the big button"
```

---

## Self-Review Notes

- **Spec coverage:** def syntax/validation → Task 3; engine model + threading + press-step `definition` + group preservation → Task 4; UI inline definition → Task 5; prompt extraction (`convert-prompt.js`, `<script src>`, file:// rationale) → Task 1; `def` grammar in converter → Task 2. Testing section items map to Tasks 3–4 (engine) and Task 5 step 4 (manual UI) and Task 1 step 4 (prompt loads under node).
- **Backward compatibility:** every new engine param defaults to `{}` so `parseLine`/`parseInstList`/`expandInstructions` direct callers in `tests.js` are unaffected (verified by the full suite passing each task).
- **Naming consistency:** `custom` map shape `{ name, count, description }`; press-step field `definition`; helpers `parseDef`, `collectCustomStitches`, `RESERVED_NAMES` — used identically across tasks.
