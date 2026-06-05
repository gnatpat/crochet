# Stitch Heights & Parameterized Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add taller crochet stitches (`hdc`, `dc`, `tr`, `dtr`) and parameterized increases/decreases (`dc2tog`, `dc3tog`, `dc inc`, 5-dc shells), modeled as orthogonal axes — height base × operation modifier × placement.

**Architecture:** Replace the flat `STITCH_INFO` table in `lib.js` with a `HEIGHTS` map (token → label) plus a `SPECIALS` map (the unchanged non-height tokens). Press-steps are derived from `(stitch, op, modifier)` where `op = {kind:'inc'|'dec', mult}|null`. The parser gains an operation-parsing stage; everything else (cursor, history, UI) is untouched because the UI is label-driven. The AI `CONVERT_PROMPT` grammar is extended to teach the model the new tokens.

**Tech Stack:** Vanilla JS (`lib.js` is a UMD module), Node-based test runner (`node tests.js`), an HTML/JS single-page app (`index.html`).

---

## File Structure

- `lib.js` — pure logic. Touched: stitch tables, `makeStitchSteps`, `parseInst`, `expandInstructions`, `api` exports. This is the whole feature's behavior.
- `tests.js` — append a new test block for heights/operations; update one legacy assertion (line 181) that encoded the old model.
- `index.html` — `CONVERT_PROMPT` only (the AI grammar string array). No rendering changes — the UI reads `step.label`/`step.outputDelta`, never per-stitch token names.

No other files. README has no grammar docs. Server is unaffected (stores opaque blobs).

---

## Background: contracts the new code must honor

A press step is `{ stitch, label, outputDelta, modifier }`. The cursor sums `outputDelta` for row totals and renders `label`. `step.stitch` is informational (the UI never reads it; tests assert it for a few special tokens).

**Press/output rules (from the spec):**

| Case | Presses | outputDelta per press |
|---|---|---|
| height, plain | 1 | `1` |
| height, `dec` mult K | 1 | `1` |
| height, `inc` mult M | M | `1` each |
| special token | unchanged | unchanged |

**Label rules (backward-compatible — these exact strings keep existing tests green):**
- plain: `"sc"`, `"hdc"`, `"dc"`, `"tr"`, `"dtr"`
- decrease: `sc`+mult 2 → `"dec"`; otherwise `"<height><N>tog"` (e.g. `"dc2tog"`, `"dc3tog"`, `"sc3tog"`)
- increase: `sc`+mult 2 → `"inc (1/2)"`, `"inc (2/2)"`; otherwise `"<height> inc (i/M)"` (e.g. `"dc inc (1/2)"`)
- a placement modifier appends `" (blo)"` / `" (flo)"` to whatever label results.

---

## Task 1: lib.js — heights, operations, parser

**Files:**
- Modify: `lib.js` (tables `:8-24`, `makeStitchSteps` `:264-277`, `parseInst` `:221-260`, `expandInstructions` `:279-299`, `api` `:494-516`)
- Test: `tests.js` (append block before the `// ---- Report ----` marker; edit lines 180-181)

### - [ ] Step 1: Write the failing tests

Open `tests.js`. Find the `// ---- Report ----` line (near the end). Insert this block **immediately before** it:

```js
  // ---- Stitch heights ----

  {
    const { rows, errors } = C.parsePattern('1: 6 dc (6)');
    eq(errors.length, 0, 'dc: no errors');
    const s = rows[0].pressSteps;
    eq(s.length, 6, 'dc: 6 presses');
    eq(s.every(x => x.stitch === 'dc' && x.outputDelta === 1), true, 'dc: all dc, +1 each');
    eq(s[0].label, 'dc', 'dc: plain label');
  }
  {
    const { rows, errors } = C.parsePattern('1: tr, hdc, dtr (3)');
    eq(errors.length, 0, 'heights: no errors');
    const s = rows[0].pressSteps;
    eq([s[0].stitch, s[1].stitch, s[2].stitch], ['tr', 'hdc', 'dtr'], 'heights: tr/hdc/dtr parse');
    eq([s[0].label, s[1].label, s[2].label], ['tr', 'hdc', 'dtr'], 'heights: plain labels');
    eq(s.reduce((a, x) => a + x.outputDelta, 0), 3, 'heights: output 3');
  }

  // ---- Parameterized decrease (Ntog) ----

  {
    const { rows } = C.parsePattern('1: dc2tog (1)');
    const s = rows[0].pressSteps;
    eq(s.length, 1, 'dc2tog: 1 press');
    eq(s[0].outputDelta, 1, 'dc2tog: +1 output');
    eq(s[0].stitch, 'dc', 'dc2tog: stitch is dc');
    eq(s[0].label, 'dc2tog', 'dc2tog: label');
  }
  {
    const { rows } = C.parsePattern('1: dc3tog, sc3tog (2)');
    const s = rows[0].pressSteps;
    eq(s.length, 2, 'Ntog: 2 presses');
    eq([s[0].label, s[1].label], ['dc3tog', 'sc3tog'], '3tog labels for dc and sc');
    eq(s.reduce((a, x) => a + x.outputDelta, 0), 2, 'Ntog: output 2');
  }
  {
    // "6 dc3tog" = six dc-3-together clusters
    const { rows } = C.parsePattern('1: 6 dc3tog (6)');
    const s = rows[0].pressSteps;
    eq(s.length, 6, '6 dc3tog: 6 presses');
    eq(s.every(x => x.label === 'dc3tog'), true, '6 dc3tog: all dc3tog');
  }

  // ---- Parameterized increase ----

  {
    const { rows } = C.parsePattern('1: dc inc (2)');
    const s = rows[0].pressSteps;
    eq(s.length, 2, 'dc inc: 2 presses');
    eq([s[0].label, s[1].label], ['dc inc (1/2)', 'dc inc (2/2)'], 'dc inc: leg labels');
    eq([s[0].outputDelta, s[1].outputDelta], [1, 1], 'dc inc: +1 each leg');
  }
  {
    // 5-dc shell = 5 dc in one stitch
    const { rows } = C.parsePattern('1: dc inc5 (5)');
    const s = rows[0].pressSteps;
    eq(s.length, 5, 'dc inc5: 5 presses');
    eq(s[0].label, 'dc inc (1/5)', 'dc inc5: first leg label');
    eq(s[4].label, 'dc inc (5/5)', 'dc inc5: last leg label');
    eq(s.reduce((a, x) => a + x.outputDelta, 0), 5, 'dc inc5: output 5');
  }

  // ---- Operations + placement modifier ----

  {
    const { rows } = C.parsePattern('1: dc2tog blo (1)');
    const s = rows[0].pressSteps;
    eq(s[0].label, 'dc2tog (blo)', 'dc2tog blo: label suffix');
    eq(s[0].modifier, 'blo', 'dc2tog blo: modifier carried');
  }

  // ---- Mixed row with declared total ----

  {
    const { rows, warnings } = C.parsePattern('1: [3 dc, dc2tog] x 6 (24)');
    const s = rows[0].pressSteps;
    eq(s.length, 24, 'mixed: 6 * (3 + 1) = 24 presses');
    eq(s.reduce((a, x) => a + x.outputDelta, 0), 24, 'mixed: output 24');
    eq(warnings.length, 0, 'mixed: declared total matches, no warnings');
  }
```

### - [ ] Step 2: Update the legacy case-insensitivity test

The old model tagged a bare `inc` step with `stitch === 'inc'`. The new model treats it as an `sc` height with an increase op, so `step.stitch` is `'sc'`. Update the assertion (preserve the case-insensitivity intent by also checking the label).

In `tests.js`, replace line 181:

```js
    eq(rows[1].pressSteps[0].stitch, 'inc', 'case: INC -> inc');
```

with:

```js
    eq(rows[1].pressSteps[0].stitch, 'sc', 'case: INC -> sc height');
    eq(rows[1].pressSteps[0].label, 'inc (1/2)', 'case: INC -> inc op');
```

### - [ ] Step 3: Run the tests and verify they fail

Run: `node tests.js`
Expected: FAIL — the new height/op assertions error or mismatch (e.g. `Unknown instruction: "dc"`), and the updated line-181 assertion expects `'sc'` but the old code still produces `'inc'`. The exit code is non-zero and the summary shows failures.

### - [ ] Step 4: Replace the stitch tables

In `lib.js`, replace the `STITCH_INFO` definition (the `const STITCH_INFO = {...};` block, lines 8-24) with:

```js
  // ---- Stitch tables ----
  //
  // Two orthogonal concepts:
  //   HEIGHTS  — base stitches (sc, hdc, dc, tr, dtr). All are structurally
  //              identical: 1 press, +1 output when plain. Only the label
  //              differs. Increases/decreases are applied as an operation.
  //   SPECIALS — non-height tokens with fixed press/output behavior.
  const HEIGHTS = {
    'sc':  'sc',
    'hdc': 'hdc',
    'dc':  'dc',
    'tr':  'tr',
    'dtr': 'dtr',
  };

  const SPECIALS = {
    'ch':    { presses: 1, outputDelta: [1], labels: ['ch'] },
    // Turning chain: physically a chain, but conventionally NOT counted in
    // the row's stitch total. AI converter emits this at the end of flat rows.
    'tch':   { presses: 1, outputDelta: [0], labels: ['turning ch'] },
    'sl st': { presses: 1, outputDelta: [1], labels: ['sl st'] },
    // Joining slip stitch used to close a round ("sl st in first sc to join").
    // 0-output so the round's stitch total still matches the source.
    'join':  { presses: 1, outputDelta: [0], labels: ['↻ sl st (join)'] },
    'mr':    { presses: 1, outputDelta: [0], labels: ['MR (form magic ring)'] },
    'fo':    { presses: 1, outputDelta: [0], labels: ['FO (fasten off)'] },
    // Flip the work — used between rows in flat patterns.
    'turn':  { presses: 1, outputDelta: [0], labels: ['↩ turn the work'] },
  };
```

### - [ ] Step 5: Replace `makeStitchSteps`

In `lib.js`, replace the entire `makeStitchSteps` function (lines 264-277) with a version that takes `op` and derives labels per the rules:

```js
  function makeStitchSteps(stitch, op, modifier) {
    const suffix = modifier ? ' (' + modifier + ')' : '';
    const mod = modifier || null;

    // Special (non-height) tokens: emit their literal steps.
    if (SPECIALS[stitch]) {
      const info = SPECIALS[stitch];
      const steps = [];
      for (let i = 0; i < info.presses; i++) {
        steps.push({ stitch, label: info.labels[i] + suffix, outputDelta: info.outputDelta[i], modifier: mod });
      }
      return steps;
    }

    // Height tokens.
    const heightLabel = HEIGHTS[stitch];
    if (!op) {
      return [{ stitch, label: heightLabel + suffix, outputDelta: 1, modifier: mod }];
    }
    if (op.kind === 'dec') {
      // "dec" stays the legacy sc-2-together label; everything else is Ntog.
      const label = (stitch === 'sc' && op.mult === 2) ? 'dec' : stitch + op.mult + 'tog';
      return [{ stitch, label: label + suffix, outputDelta: 1, modifier: mod }];
    }
    // increase: M completed stitches, one press each.
    const legBase = (stitch === 'sc' && op.mult === 2) ? 'inc' : stitch + ' inc';
    const steps = [];
    for (let i = 0; i < op.mult; i++) {
      const label = legBase + ' (' + (i + 1) + '/' + op.mult + ')';
      steps.push({ stitch, label: label + suffix, outputDelta: 1, modifier: mod });
    }
    return steps;
  }
```

### - [ ] Step 6: Replace `parseInst`

In `lib.js`, replace the entire `parseInst` function (lines 221-260) with the version below. It strips group/MR/placement as before, then resolves operation + count + height. Heights default to `sc`; specials keep both count orderings.

```js
  function parseInst(text) {
    text = text.trim();
    const groupMatch = text.match(/^\[(.+)\]\s*x\s*(\d+)$/i);
    if (groupMatch) {
      return {
        type: 'group',
        instructions: parseInstList(groupMatch[1]),
        repeat: parseInt(groupMatch[2], 10),
      };
    }
    let inMR = false;
    const mrMatch = text.match(/^(.+?)\s+in\s+MR\s*$/i);
    if (mrMatch) {
      inMR = true;
      text = mrMatch[1].trim();
    }
    // Placement modifier: blo (back loop only) or flo (front loop only).
    let modifier = null;
    const modMatch = text.match(/^(.+?)\s+(blo|flo)\s*$/i);
    if (modMatch) {
      modifier = modMatch[2].toLowerCase();
      text = modMatch[1].trim();
    }

    const HEIGHT = '(dtr|hdc|dc|tr|sc)';
    let count = 1;
    let op = null;

    // 1. Native decrease, height embedded: "dc2tog", "dc3tog", "6 dc2tog".
    let m = text.match(new RegExp('^(?:(\\d+)\\s*)?' + HEIGHT + '(\\d+)tog$', 'i'));
    if (m) {
      if (m[1] != null) count = parseInt(m[1], 10);
      return { type: 'stitch', stitch: m[2].toLowerCase(), op: { kind: 'dec', mult: parseInt(m[3], 10) }, count, inMR, modifier };
    }

    // 2. Word-form operation: "dc inc", "dc inc5", "dc dec3", bare "inc"/"dec", "6 inc".
    m = text.match(/^(?:(.+?)\s+)?(inc|dec)(\d+)?$/i);
    if (m) {
      op = { kind: m[2].toLowerCase(), mult: m[3] != null ? parseInt(m[3], 10) : 2 };
      const rest = (m[1] || '').trim();
      // Remainder is an optional count + optional height (height defaults to sc).
      const hm = rest.match(new RegExp('^(?:(\\d+)\\s*)?' + HEIGHT + '?$', 'i'));
      if (!hm) throw new Error('Unknown instruction: "' + text + '"');
      if (hm[1] != null) count = parseInt(hm[1], 10);
      const stitch = hm[2] ? hm[2].toLowerCase() : 'sc';
      return { type: 'stitch', stitch, op, count, inMR, modifier };
    }

    // 3. Plain height, count on either side: "dc", "6 dc", "dc 6".
    m = text.match(new RegExp('^(?:(\\d+)\\s*)?' + HEIGHT + '$', 'i'));
    if (m) {
      if (m[1] != null) count = parseInt(m[1], 10);
      return { type: 'stitch', stitch: m[2].toLowerCase(), op: null, count, inMR, modifier };
    }
    m = text.match(new RegExp('^' + HEIGHT + '\\s+(\\d+)$', 'i'));
    if (m) {
      return { type: 'stitch', stitch: m[1].toLowerCase(), op: null, count: parseInt(m[2], 10), inMR, modifier };
    }

    // 4. Special tokens, count on either side: "ch 31", "6 ch", "join", "turn".
    const SPECIAL_RE = /(sl\s*st|join|tch|ch|mr|fo|turn)/i;
    let s1 = text.match(new RegExp('^(?:(\\d+)\\s*)?' + SPECIAL_RE.source + '$', 'i'));
    if (s1) {
      if (s1[1] != null) count = parseInt(s1[1], 10);
      return { type: 'stitch', stitch: normalizeStitchName(s1[2]), op: null, count, inMR, modifier };
    }
    const s2 = text.match(new RegExp('^' + SPECIAL_RE.source + '(?:\\s+(\\d+))?$', 'i'));
    if (!s2) throw new Error('Unknown instruction: "' + text + '"');
    count = s2[2] != null ? parseInt(s2[2], 10) : 1;
    return { type: 'stitch', stitch: normalizeStitchName(s2[1]), op: null, count, inMR, modifier };
  }
```

### - [ ] Step 7: Pass `op` through expansion and update exports

In `lib.js` `expandInstructions` (lines 279-299), the non-group branch calls `makeStitchSteps(inst.stitch, inst.modifier)`. Replace that call so it forwards the op:

```js
        for (let i = 0; i < inst.count; i++) {
          for (const s of makeStitchSteps(inst.stitch, inst.op, inst.modifier)) steps.push(s);
        }
```

(The group branch already copies `s.stitch/label/outputDelta/modifier` and needs no change.)

Then in the `api` object (lines 494-516), replace the `STITCH_INFO,` line with the two new tables:

```js
    HEIGHTS,
    SPECIALS,
```

(Nothing in `tests.js` or `index.html` references `STITCH_INFO`, so removing it from the exports is safe.)

### - [ ] Step 8: Run the full test suite

Run: `node tests.js`
Expected: PASS — `node` exits 0 and prints a summary like `158/158 passed` (the original 145 plus the new assertions, with no `FAILED`).

### - [ ] Step 9: Commit

```bash
git add lib.js tests.js
git commit -m "feat: stitch heights (hdc/dc/tr/dtr) and parameterized inc/dec

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: index.html — teach the AI grammar the new tokens

**Files:**
- Modify: `index.html` (`CONVERT_PROMPT`, lines 309-321 the token table, 335-340 translation rules, 369-370 discipline)

### - [ ] Step 1: Extend the grammar token table

In `index.html`, replace the token-table rows (lines 311-321, from `"  sc     |   1    | single crochet",` through `"  turn   |   0    | turn / flip the work (between flat-pattern rows)",`) with:

```js
      "  sc     |   1    | single crochet",
      "  hdc    |   1    | half double crochet",
      "  dc     |   1    | double crochet",
      "  tr     |   1    | treble (triple) crochet",
      "  dtr    |   1    | double treble crochet",
      "  ch     |   1    | chain — counts as a stitch (use for starting chains)",
      "  tch    |   0    | turning chain — NOT counted in row total",
      "  sl st  |   1    | regular slip stitch",
      "  join   |   0    | joining slip stitch closing a round",
      "         |        |   (matches 'sl st in first sc to join')",
      "  MR     |   0    | form a magic ring (or use \"in MR\" suffix)",
      "  FO     |   0    | fasten off",
      "  turn   |   0    | turn / flip the work (between flat-pattern rows)",
      "",
      "INCREASES & DECREASES apply to ANY height (sc, hdc, dc, tr, dtr):",
      "",
      "  <height> inc      | OUTPUT M | M stitches in one stitch; default M=2.",
      "  <height> incM     |          |   e.g. \"dc inc\" = 2 dc in 1 st, \"dc inc5\" = 5-dc shell",
      "  <height>Ntog      | OUTPUT 1 | N stitches worked together into 1; default N=2.",
      "  <height> dec      |          |   e.g. \"dc2tog\", \"dc3tog\". Bare \"inc\"/\"dec\" mean sc.",
```

### - [ ] Step 2: Add height & operation translation rules

In `index.html`, replace the two increase/decrease translation lines (338-340):

```js
      "  \"2 sc in next st\" / \"2sc in same st\" / \"increase\"      ->  \"inc\"",
      "  \"2 sc in each st around\" (prev row has K sts)          ->  \"K inc\"",
      "  \"sc2tog\" / \"sc 2 together\" / \"decrease\" / \"invisible dec\"  ->  \"dec\"",
```

with (generalizes them to all heights and adds the height-name synonyms):

```js
      "  \"2 sc in next st\" / \"2sc in same st\" / \"increase\"      ->  \"inc\"",
      "  \"2 sc in each st around\" (prev row has K sts)          ->  \"K inc\"",
      "  \"sc2tog\" / \"sc 2 together\" / \"decrease\" / \"invisible dec\"  ->  \"dec\"",
      "  \"double crochet\" / \"dc\"                                ->  \"dc\"  (likewise hdc, tr, dtr)",
      "  \"half double crochet\" / \"hdc\"                          ->  \"hdc\"",
      "  \"treble crochet\" / \"triple crochet\" / \"tr\" / \"trc\"     ->  \"tr\"",
      "  \"double treble\" / \"dtr\"                                ->  \"dtr\"",
      "  \"2 dc in next st\" / \"dc increase\"                      ->  \"dc inc\"",
      "  \"N dc in one st\" (a shell/fan)                         ->  \"dc incN\"  (e.g. \"dc inc5\")",
      "  \"dc2tog\" / \"dc 2 together\" / \"dc3tog\"                  ->  \"dc2tog\" / \"dc3tog\" (any height, any N)",
```

### - [ ] Step 3: Generalize the discipline note

In `index.html`, replace line 369-370:

```js
      "5. RECOGNIZE every increase synonym (\"inc\", \"2sc in next st\", \"2sc in same st\") and every",
      "   decrease synonym (\"dec\", \"sc2tog\", \"sc 2 together\", \"invisible dec\").",
```

with:

```js
      "5. RECOGNIZE every increase synonym (\"inc\", \"N sc in next st\", \"N dc in one st\") and every",
      "   decrease synonym (\"dec\", \"scNtog\", \"dcNtog\", \"N sc together\", \"invisible dec\") for ALL heights.",
```

### - [ ] Step 4: Sanity-check tests still pass

The prompt is a string only consumed by the AI call, not by `lib.js`, so the unit tests are unaffected — but run them to confirm nothing in `index.html` editing accidentally touched shared code paths.

Run: `node tests.js`
Expected: PASS — same summary as Task 1 Step 8, exit 0.

### - [ ] Step 5: Commit

```bash
git add index.html
git commit -m "feat: teach AI converter the new heights and parameterized inc/dec

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review notes (already checked)

- **Spec coverage:** §1 tables → Task 1 Step 4; §2 derivation → Step 5; §3 labels → Step 5 (legacy-preserving rule, exercised by existing tests + new ones); §4 parser two-spelling algorithm → Step 6; §5 expansion → Step 7; §6 AI prompt → Task 2; §7 tests → Task 1 Step 1. Out-of-scope items (README, UI rendering, input-consumption) confirmed unneeded.
- **Backward compatibility:** all 145 existing assertions rely on labels `"sc"`, `"inc (1/2)"`, `"dec"`, and special `step.stitch` values, all reproduced by the label rule and the special-token branch. The one assertion encoding the *old* model (bare inc → `stitch:'inc'`) is intentionally updated in Step 2.
- **Type consistency:** instruction shape `{type, stitch, op:{kind,mult}|null, count, inMR, modifier}` is produced by `parseInst` and consumed by `expandInstructions` → `makeStitchSteps(stitch, op, modifier)` with matching arity everywhere.
