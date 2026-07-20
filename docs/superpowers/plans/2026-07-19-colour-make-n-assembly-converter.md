# Colour, Make-N, Assembly checklist, Converter limits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support two large multi-piece, multi-colour patterns by making colour a per-stitch property with an auto-anchored "switch now" prompt, adding "make N" repeated pieces, an assembly checklist, and a converter that doesn't truncate long patterns.

**Architecture:** All stitch logic lives in `lib.js` (pure, Node+browser). Colour is threaded as running state through `parsePattern`/`expandInstructions`, tagging every press-step with a `color` and marking the anchor stitch with `changeTo`. "Make N" duplicates a section's blocks in a post-parse pass. The UI (`index.html`) reads these fields in the existing big-button and info-card render paths. The AI converter is a client-side OpenRouter call in `index.html`; its prompt lives in `convert-prompt.js`.

**Tech Stack:** Vanilla JS (no build, no package.json), `node tests.js` for engine tests, OpenRouter chat completions API (SSE streaming).

## Global Constraints

- No build step; runs under `file://`. No new dependencies. `lib.js` must work in both Node and browser (it attaches to `window.Crochet` / `module.exports`).
- Engine tests run via `node tests.js` (single file, prints pass/fail). Browser: `tests.html`.
- New parameters on existing `lib.js` functions must be **optional with safe defaults** so existing callers/tests keep working.
- Colour object shape everywhere: `{ name: string, hex: string | null }`.
- Press-step shape gains `color` (colour object or `null`) and optional `changeTo` (colour object). Existing fields unchanged: `{ stitch, label, outputDelta, modifier, definition }`.
- Comment stripping in the parser is `line.replace(/#.*$/, '')` — a hex value `#6b4a2e` collides with it. Palette lines MUST be matched on raw lines before comment-stripping (see Task 1).
- Model ids in the converter stay as the ids already present in the codebase (`anthropic/claude-haiku-4.5`, `anthropic/claude-sonnet-4.6`, `anthropic/claude-opus-4.7`); they live in one constant so they are easy to bump later.

---

## Task 1: Colour palette + resolution (`COLOR_WORDS`, `resolveColour`, `collectPalette`)

**Files:**
- Modify: `lib.js` (add `COLOR_WORDS`, `isHex`, `resolveColour`, `collectPalette`; extend `RESERVED_NAMES`; export new fns)
- Test: `tests.js`

**Interfaces:**
- Produces:
  - `resolveColour(name: string, palette: object) -> { name: string, hex: string|null }`
  - `collectPalette(lines: string[]) -> { palette: object, errors: [{line,message,raw}] }` — `palette` maps lowercased name → raw value string (`#hex` or a colour word)
  - `COLOR_WORDS: { [word]: '#hex' }`
  - `RESERVED_NAMES` now includes `'color'`

- [ ] **Step 1: Write the failing tests**

Add to `tests.js` (anywhere inside the IIFE, before the results print):

```js
// ---- Colour palette + resolution ----
{
  eq(C.resolveColour('brown', {}).hex, '#6b4a2e', 'brown derives a hex');
  eq(C.resolveColour('BROWN', {}).name, 'brown', 'resolveColour lowercases name');
  assert(C.resolveColour('chartreuse', {}).hex == null, 'unknown colour -> hex null');
  eq(C.resolveColour('brown', { brown: '#123456' }).hex, '#123456', 'palette overrides derived shade');
  eq(C.resolveColour('buff', { buff: 'tan' }).hex, C.resolveColour('tan', {}).hex, 'palette value can be a colour word');

  const { palette, errors } = C.collectPalette(['color brown = #6b4a2e', '1: 6 sc (6)']);
  eq(errors.length, 0, 'collectPalette: no errors on valid line');
  eq(palette.brown, '#6b4a2e', 'collectPalette captures the hex value');

  const dup = C.collectPalette(['color brown = #111', 'color brown = #222']);
  assert(dup.errors.some(e => /duplicate/i.test(e.message)), 'duplicate palette line errors');

  const withComment = C.collectPalette(['color brown = #6b4a2e  # main body']);
  eq(withComment.palette.brown, '#6b4a2e', 'trailing comment after hex is ignored');
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests.js`
Expected: FAIL — `C.resolveColour is not a function` (or the new asserts fail).

- [ ] **Step 3: Implement in `lib.js`**

Add after the `SPECIALS` block (around `lib.js:29`):

```js
  // ---- Colour ----
  // Small table of common yarn colour words -> a representative swatch hex.
  // Used to draw the colour dot when the pattern doesn't pin an exact hex.
  const COLOR_WORDS = {
    white: '#f7f7f2', cream: '#f2e2c4', ivory: '#fffff0', beige: '#e8dcc4',
    tan: '#d2b48c', buff: '#e8c99b', brown: '#6b4a2e', black: '#2b2b2b',
    grey: '#9aa0a6', gray: '#9aa0a6', yellow: '#e5a50a', gold: '#d4af37',
    orange: '#e8730c', red: '#c0392b', pink: '#e79ab0', rose: '#c76b7f',
    purple: '#7d5ba6', blue: '#3a6ea5', green: '#3e8e5a', mint: '#9fd8b0',
    teal: '#2a9d8f',
  };

  function isHex(s) { return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s); }

  // name -> { name, hex }. Palette (pattern-declared) wins; then COLOR_WORDS;
  // then hex:null (UI draws a neutral ring).
  function resolveColour(name, palette) {
    const key = String(name).toLowerCase();
    const raw = palette && palette[key];
    if (raw != null) {
      if (isHex(raw)) return { name: key, hex: raw.toLowerCase() };
      return { name: key, hex: COLOR_WORDS[String(raw).toLowerCase()] || null };
    }
    return { name: key, hex: COLOR_WORDS[key] || null };
  }
```

Add `collectPalette` next to `collectCustomStitches` (around `lib.js:231`):

```js
  // Pre-pass: scan raw lines for palette declarations "color NAME = VALUE".
  // Matched on RAW lines (not comment-stripped) because a #hex value would
  // otherwise be eaten by the `#`-comment rule. A trailing `# comment` after
  // the value is still tolerated by anchoring the value capture.
  function collectPalette(lines) {
    const palette = Object.create(null);
    const errors = [];
    const RE = /^\s*color\s+([a-z][a-z0-9]*)\s*=\s*(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z][a-z0-9]*)\s*(?:#.*)?$/i;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(RE);
      if (!m) continue;
      const name = m[1].toLowerCase();
      if (palette[name]) {
        errors.push({ line: i + 1, message: 'Duplicate colour definition: "' + name + '"', raw: lines[i] });
        continue;
      }
      palette[name] = m[2];
    }
    return { palette, errors };
  }
```

Extend `RESERVED_NAMES` (add `'color'` to the set at `lib.js:33`):

```js
    'inc', 'dec', 'tog', 'in', 'blo', 'flo', 'x', 'def', 'note', 'color',
```

Add to the `api` object (around `lib.js:679`):

```js
    COLOR_WORDS,
    resolveColour,
    collectPalette,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests.js`
Expected: PASS — all Task 1 assertions pass, no previously-passing test regresses.

- [ ] **Step 5: Commit**

```bash
git add lib.js tests.js
git commit -m "feat: colour palette table and resolution"
```

---

## Task 2: Colour threading + anchor (`parsePattern`, `expandInstructions`, inline `color:`)

This is the core. Colour flows across the whole pattern; the "switch now" prompt anchors to the last real stitch before any colour boundary (round or mid-round); it resets at piece boundaries.

**Files:**
- Modify: `lib.js` (`parseInst`, `expandInstructions`, `parsePattern`, add `applyColourSwitch`)
- Test: `tests.js`

**Interfaces:**
- Consumes: `resolveColour`, `collectPalette` (Task 1).
- Produces:
  - `applyColourSwitch(ctx, name, palette)` — sets `ctx.current` and, when an anchor exists whose colour differs, sets `anchor.changeTo`.
  - `expandInstructions(insts, custom?, palette?, ctx?)` — new optional `palette`, `ctx` params. `ctx = { current: colour|null, last: step|null }`. Each emitted step gets `.color = ctx.current`; anchor-eligible steps update `ctx.last`.
  - Press-steps now carry `color` and optional `changeTo`.
  - Colour instruction node: `{ type: 'colour', name }` from `parseInst`.

- [ ] **Step 1: Write the failing tests**

Add to `tests.js`:

```js
// ---- Colour threading + anchor ----
{
  const { blocks, errors } = C.parsePattern(
    ['color: cream', '1: 3 sc (3)', 'color: brown', '2: 3 sc (3)'].join('\n'));
  eq(errors.length, 0, 'colour threading: no errors');
  const r1 = blocks.find(b => b.type === 'row' && b.rowNumber === 1);
  const r2 = blocks.find(b => b.type === 'row' && b.rowNumber === 2);
  eq(r1.pressSteps[0].color.name, 'cream', 'R1 stitches cream');
  eq(r2.pressSteps[0].color.name, 'brown', 'R2 stitches brown');
  eq(r1.pressSteps[r1.pressSteps.length - 1].changeTo.name, 'brown', 'last of R1 anchors to brown');
  assert(r2.pressSteps[r2.pressSteps.length - 1].changeTo == null, 'R2 last has no change');
}
{
  // Trailing join/tch must NOT be the anchor.
  const { blocks } = C.parsePattern(
    ['color: cream', '1: 3 sc, join (3)', 'color: brown', '2: 3 sc (3)'].join('\n'));
  const r1 = blocks.find(b => b.type === 'row' && b.rowNumber === 1);
  const scSteps = r1.pressSteps.filter(s => s.stitch === 'sc');
  eq(scSteps[scSteps.length - 1].changeTo.name, 'brown', 'anchor lands on last sc');
  eq(r1.pressSteps.find(s => s.stitch === 'join').changeTo, undefined, 'join is not the anchor');
}
{
  // Mid-round inline colour change.
  const { blocks, errors } = C.parsePattern('color: yellow\n1: 2 sc, color: brown, 2 sc (4)');
  eq(errors.length, 0, 'inline colour: no errors');
  const r = blocks.find(b => b.type === 'row');
  eq(r.pressSteps.length, 4, 'inline colour emits no press-step');
  eq(r.expectedTotal, 4, 'inline colour does not affect the (N) total');
  eq(r.pressSteps[0].color.name, 'yellow', 'pre-switch stitches yellow');
  eq(r.pressSteps[1].changeTo.name, 'brown', '2nd stitch anchors to brown');
  eq(r.pressSteps[2].color.name, 'brown', 'post-switch stitches brown');
}
{
  // Piece boundary (section) resets the anchor — no change onto the prior piece.
  const { blocks } = C.parsePattern(
    ['color: brown', '[Head]', '1: 3 sc (3)', '[Ears]', 'color: yellow', '1: 3 sc (3)'].join('\n'));
  const head1 = blocks.find(b => b.type === 'row' && b.section === 'Head');
  assert(head1.pressSteps[head1.pressSteps.length - 1].changeTo == null, 'no cross-piece anchor');
  const ears1 = blocks.find(b => b.type === 'row' && b.section === 'Ears');
  eq(ears1.pressSteps[0].color.name, 'yellow', 'ears start yellow');
}
{
  // Regression: no colour anywhere -> color null, no changeTo.
  const { blocks } = C.parsePattern('1: 3 sc (3)');
  const r = blocks.find(b => b.type === 'row');
  assert(r.pressSteps[0].color == null, 'no colour -> color null');
  assert(r.pressSteps[0].changeTo == null, 'no colour -> no changeTo');
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests.js`
Expected: FAIL — `color` is undefined on steps / `changeTo` missing.

- [ ] **Step 3: Implement colour instruction parsing**

In `parseInst` (`lib.js:272`), add as the FIRST branch after `text = text.trim();`:

```js
    // Inline colour switch: "color: brown". Emits no stitch; flips running colour.
    const colourInline = text.match(/^color:\s*([a-z][a-z0-9]*)$/i);
    if (colourInline) {
      return { type: 'colour', name: colourInline[1].toLowerCase() };
    }
```

- [ ] **Step 4: Implement `applyColourSwitch` and colour-aware `expandInstructions`**

Add `applyColourSwitch` at module scope (near `resolveColour`):

```js
  // Set the running colour. If there's a preceding anchor-eligible stitch in a
  // DIFFERENT colour, mark it as where the crocheter completes the switch.
  function applyColourSwitch(ctx, name, palette) {
    if (!ctx) return;
    const col = resolveColour(name, palette);
    if (ctx.last && (!ctx.last.color || ctx.last.color.name !== col.name)) {
      ctx.last.changeTo = col;
    }
    ctx.current = col;
  }
```

Replace `expandInstructions` (`lib.js:410-431`) with:

```js
  // Stitches that don't represent a pulled loop — never the colour-change anchor.
  const ANCHOR_SKIP = new Set(['mr', 'join', 'tch', 'turn', 'fo']);

  function expandInstructions(insts, custom = Object.create(null), palette = Object.create(null), ctx = null) {
    const steps = [];
    function emit(s) {
      s.color = ctx ? ctx.current : null;
      steps.push(s);
      if (ctx) {
        if (s.stitch === 'fo') ctx.last = null;           // end of piece
        else if (!ANCHOR_SKIP.has(s.stitch)) ctx.last = s; // eligible anchor
      }
    }
    for (const inst of insts) {
      if (inst.type === 'colour') {
        applyColourSwitch(ctx, inst.name, palette);
        continue;
      }
      if (inst.type === 'group') {
        // Re-run expansion per repetition (instead of expand-once-and-copy) so
        // colour + anchors thread correctly through repeated groups. Produces
        // identical steps to the old copy loop when there is no colour.
        for (let i = 0; i < inst.repeat; i++) {
          const inner = expandInstructions(inst.instructions, custom, palette, ctx);
          for (const s of inner) steps.push(s);
        }
      } else {
        if (inst.inMR) {
          emit({ stitch: 'mr', label: SPECIALS.mr.labels[0], outputDelta: 0, modifier: null, definition: null });
        }
        for (let i = 0; i < inst.count; i++) {
          for (const s of makeStitchSteps(inst.stitch, inst.op, inst.modifier, custom)) emit(s);
        }
      }
    }
    return steps;
  }
```

Note: in the group branch, `inner` steps were already `emit`ted (colour-tagged, `ctx.last` updated) by the recursive call, so they are pushed directly — do NOT re-emit.

- [ ] **Step 5: Thread colour through `parsePattern`**

In `parsePattern`:

(a) After the `collectCustomStitches` call (`lib.js:60`), add:

```js
    const { palette, errors: palErrors } = collectPalette(lines);
    for (const e of palErrors) errors.push(e);
    const colourCtx = { current: null, last: null };
```

(b) In the while loop, after the `def` skip line (`lib.js:91`), add a palette-line skip and a standalone colour switch:

```js
      // Palette declarations were consumed by the pre-pass; skip (raw match so
      // a #hex value isn't confused with a comment).
      if (/^\s*color\s+[a-z][a-z0-9]*\s*=/i.test(raw)) { i++; continue; }

      // Standalone colour switch between rows.
      let cm = stripped.match(/^color:\s*([a-z][a-z0-9]*)$/i);
      if (cm) { applyColourSwitch(colourCtx, cm[1], palette); i++; continue; }
```

(c) In the section-header branch, after `pendingSectionBlock = sectionBlock;` (`lib.js:107`), reset the anchor (colour persists, but a new piece has no physical switch onto the prior piece):

```js
        colourCtx.last = null;
```

(d) In the row expansion loop, change the `expandInstructions` call (`lib.js:168`) to pass palette + ctx:

```js
        const pressSteps = expandInstructions(parsed.instructions, custom, palette, colourCtx);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node tests.js`
Expected: PASS — all Task 2 assertions pass; all prior tests still pass (group re-run is behaviourally identical without colour).

- [ ] **Step 7: Export `applyColourSwitch` (for completeness) and commit**

Add `applyColourSwitch,` to the `api` object, then:

```bash
git add lib.js tests.js
git commit -m "feat: thread colour through stitches with auto-anchored switch"
```

---

## Task 3: "Make N" repeated sections (`[Ears] x2`)

**Files:**
- Modify: `lib.js` (section-header regex; add `expandRepeats` + `cloneBlockWithCopy`; call in `parsePattern`)
- Test: `tests.js`

**Interfaces:**
- Consumes: colour-threaded blocks from Task 2 (duplication happens after threading).
- Produces: section blocks may carry `repeat: N`; duplicated blocks carry `copyIndex` (1-based) and `copyTotal`.

- [ ] **Step 1: Write the failing tests**

Add to `tests.js`:

```js
// ---- Make N ----
{
  const { blocks, errors } = C.parsePattern('[Ears] x2\n1: 3 sc (3)\n2: 3 sc (3)');
  eq(errors.length, 0, 'make-N: no errors');
  const secs = blocks.filter(b => b.type === 'section');
  eq(secs.length, 2, 'x2 duplicates the section block');
  eq(secs[0].copyIndex, 1, 'first copy index 1');
  eq(secs[1].copyIndex, 2, 'second copy index 2');
  eq(secs[0].copyTotal, 2, 'copyTotal 2');
  const rows = blocks.filter(b => b.type === 'row');
  eq(rows.length, 4, 'rows duplicated (2 rows x2)');
  eq(rows[0].rowNumber, 1, 'copy1 starts at R1');
  eq(rows[2].rowNumber, 1, 'copy2 restarts at R1');
}
{
  const { blocks } = C.parsePattern('[Head]\n1: 3 sc (3)');
  const secs = blocks.filter(b => b.type === 'section');
  eq(secs.length, 1, 'no x -> single section');
  assert(!(secs[0].copyTotal > 1), 'copyTotal not > 1 for plain section');
}
{
  // Colour survives duplication; no spurious cross-copy anchor.
  const { blocks } = C.parsePattern('[Leg] x2\ncolor: cream\n1: 2 sc (2)\ncolor: yellow\n2: 2 sc (2)');
  const rows = blocks.filter(b => b.type === 'row');
  eq(rows.length, 4, 'leg duplicated');
  eq(rows[0].pressSteps[0].color.name, 'cream', 'copy1 R1 cream');
  eq(rows[0].pressSteps[1].changeTo.name, 'yellow', 'copy1 anchor to yellow');
  eq(rows[2].pressSteps[0].color.name, 'cream', 'copy2 R1 cream (cloned)');
  eq(rows[2].pressSteps[1].changeTo.name, 'yellow', 'copy2 anchor preserved');
  assert(rows[1].pressSteps[rows[1].pressSteps.length - 1].changeTo == null, 'no cross-copy anchor');
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests.js`
Expected: FAIL — only 1 section block, rows not duplicated.

- [ ] **Step 3: Extend the section-header regex**

In `parsePattern`, replace the section-header match (`lib.js:94`):

```js
      let m = stripped.match(/^\[(.+?)\]\s*(?:x\s*(\d+))?$/i);
      if (m) {
        currentSection = m[1].trim();
        const repeat = m[2] ? parseInt(m[2], 10) : 1;
        const sectionBlock = {
          type: 'section',
          name: currentSection,
          section: currentSection,
          repeat,
          intro: [],
          rawLine: raw,
          expectedTotal: 0,
          pressSteps: [{ stitch: 'section', label: '▶ tap to start', outputDelta: 0, definition: null }],
        };
```

(Leave the rest of the section branch unchanged.)

- [ ] **Step 4: Add `expandRepeats` + `cloneBlockWithCopy`**

Add at module scope (near the other block helpers, e.g. before `clampCursor`):

```js
  // Deep-enough clone of a block for a "make N" copy: fresh pressStep objects
  // (so cursor indices are independent) with colour/changeTo refs preserved.
  function cloneBlockWithCopy(block, copyIndex, copyTotal) {
    const clone = Object.assign({}, block, {
      copyIndex,
      copyTotal,
      pressSteps: block.pressSteps.map(s => Object.assign({}, s)),
    });
    if (block.intro) clone.intro = block.intro.slice();
    return clone;
  }

  // Post-pass: for each section with repeat > 1, duplicate its run of blocks
  // (the section block + all following blocks up to the next section) N times.
  function expandRepeats(blocks) {
    const out = [];
    let i = 0;
    while (i < blocks.length) {
      const b = blocks[i];
      if (b.type === 'section' && b.repeat && b.repeat > 1) {
        const run = [b];
        let j = i + 1;
        while (j < blocks.length && blocks[j].type !== 'section') { run.push(blocks[j]); j++; }
        for (let c = 1; c <= b.repeat; c++) {
          for (const rb of run) out.push(cloneBlockWithCopy(rb, c, b.repeat));
        }
        i = j;
      } else {
        out.push(b);
        i++;
      }
    }
    return out;
  }
```

- [ ] **Step 5: Call `expandRepeats` at the end of `parsePattern`**

Replace the `return` block (`lib.js:192-198`):

```js
    const finalBlocks = expandRepeats(blocks);
    return {
      blocks: finalBlocks,
      errors,
      warnings,
      rows: finalBlocks.filter(b => b.type === 'row'),
    };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node tests.js`
Expected: PASS — all Task 3 assertions pass; prior tests still pass.

- [ ] **Step 7: Commit**

```bash
git add lib.js tests.js
git commit -m "feat: make-N repeated sections via block duplication"
```

---

## Task 4: UI — colour chip + switch hint on the big button

No engine change. Manual verification (no browser test harness).

**Files:**
- Modify: `index.html` (big-button render ~745-753; add helpers; add CSS)

**Interfaces:**
- Consumes: `step.color` (`{name,hex}|null`) and `step.changeTo` on the current press-step.

- [ ] **Step 1: Add CSS**

In the `<style>` block, near `.stitch-def` (search for `.stitch-def`), add:

```css
    .colour-dot { display:inline-block; width:12px; height:12px; border-radius:50%;
      vertical-align:middle; margin-right:6px; border:1px solid rgba(0,0,0,0.3); }
    .colour-dot.empty { background:transparent; }
    .colour-chip { margin-top:8px; font-size:14px; color:#001; display:inline-flex;
      align-items:center; gap:2px; opacity:0.85; }
    .colour-switch { margin-top:8px; font-size:14px; font-weight:700; color:#001;
      background:rgba(255,255,255,0.7); padding:6px 12px; border-radius:999px;
      display:inline-flex; align-items:center; gap:4px; }
```

- [ ] **Step 2: Add render helpers**

Near the top of the inline `<script>` (with the other small helpers such as `el`), add:

```js
    function colourDot(hex) {
      const d = el('span', { class: 'colour-dot' });
      if (hex) d.style.background = hex; else d.classList.add('empty');
      return d;
    }
```

- [ ] **Step 3: Render chip + switch hint on the big button**

In the big-button branch, right after the `stitch-def` append (`index.html:750-752`), add:

```js
          const stepColour = defStep && defStep.color;
          if (stepColour) {
            bigBtn.appendChild(el('div', { class: 'colour-chip' },
              colourDot(stepColour.hex), el('span', null, stepColour.name)));
          }
          if (defStep && defStep.changeTo) {
            bigBtn.appendChild(el('div', { class: 'colour-switch' },
              colourDot(defStep.changeTo.hex),
              el('span', null, 'Change to ' + defStep.changeTo.name + ' on the final pull-through')));
          }
```

- [ ] **Step 4: Manual verification**

Open `index.html` in a browser. Create a project with:

```
color: cream
1: 6 sc in MR (6)
2: 6 inc (12)
color: brown
3: 12 sc (12)
```

Verify: while working rounds 1–2 a cream dot + "cream" shows under the button; on the **last stitch of round 2** the "Change to brown on the final pull-through" pill appears with a brown dot; round 3 shows a brown chip. A pattern with no `color:` shows no chip (regression).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: colour chip and switch prompt on the big button"
```

---

## Task 5: UI — Make-N section card + Assembly checklist note

No engine change. Manual verification.

**Files:**
- Modify: `index.html` (section-card render ~677-691; note render ~692-701; add note-index helper)

**Interfaces:**
- Consumes: `block.copyIndex` / `block.copyTotal` on section blocks; `block.section` on note blocks.

- [ ] **Step 1: Make-N section card**

Replace the `else if (mode === 'section')` body (`index.html:677-691`) with:

```js
        } else if (mode === 'section') {
          infoCard.classList.add('section');
          let eyebrow, title;
          if (block.copyTotal > 1) {
            eyebrow = '🧶 Piece ' + block.copyIndex + ' of ' + block.copyTotal;
            title = block.name + ' · ' + block.copyIndex + ' of ' + block.copyTotal;
          } else {
            const prevName = C.previousSectionName(parsed, cur.blockIndex);
            eyebrow = prevName ? '✨ Next part' : '✨ First part';
            title = prevName ? 'Finished ' + prevName + ' · Next: ' + block.name : 'Starting ' + block.name;
          }
          const children = [
            el('div', { class: 'info-card-eyebrow' }, eyebrow),
            el('div', { class: 'info-card-title' }, title),
          ];
          for (const intro of (block.intro || [])) {
            children.push(el('div', { class: 'info-card-body' }, intro));
          }
          children.push(el('div', { class: 'info-card-foot' }, 'Tap below to begin this section.'));
          infoCard.append(...children);
```

- [ ] **Step 2: Assembly checklist note eyebrow**

Add a helper near the other render helpers:

```js
    function noteStepInfo(parsed, block) {
      const notes = parsed.blocks.filter(b => b.type === 'note' && b.section === block.section);
      return { idx: notes.indexOf(block) + 1, total: notes.length };
    }
```

Replace the `else if (mode === 'note')` body (`index.html:692-701`) with:

```js
        } else if (mode === 'note') {
          infoCard.classList.add('note');
          const isAssembly = block.section && /^(assembly|finishing)$/i.test(block.section);
          let eyebrow;
          if (isAssembly) {
            const info = noteStepInfo(parsed, block);
            eyebrow = '☑ ' + block.section + ' · step ' + info.idx + ' of ' + info.total;
          } else {
            const lastRow = sectionLastRowBefore(parsed, cur.blockIndex, block.section);
            const where = lastRow ? 'After Row ' + lastRow.rowNumber : 'Before Row 1';
            const sectionTag = block.section ? block.section + ' · ' : '';
            eyebrow = '📝 ' + sectionTag + where;
          }
          infoCard.append(
            el('div', { class: 'info-card-eyebrow' }, eyebrow),
            el('div', { class: 'info-card-body' }, block.content),
            el('div', { class: 'info-card-foot' }, isAssembly ? 'Tap below when this step is done.' : 'Tap below when done reading.'),
          );
```

- [ ] **Step 3: Manual verification**

Open `index.html`. Create a project with:

```
[Ears] x2
1: 6 sc in MR (6)
2: 6 sc (6)

[Assembly]
note: Attach each ear to the mane.
note: Embroider the nose across R3-4.
```

Verify: starting the Ears section shows "Ears · 1 of 2"; finishing the first ear rolls into a card reading "Ears · 2 of 2"; the Assembly notes show "☑ Assembly · step 1 of 2" then "step 2 of 2".

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: make-N section card and assembly checklist note"
```

---

## Task 6: Converter — raise cap, detect truncation, stream

**Files:**
- Modify: `index.html` (`llmConvert` ~285-327; add `LLM_MAX_TOKENS`)

**Interfaces:**
- Produces: `llmConvert(rawText, key, model, thinking, onDelta?)` — streams; calls `onDelta({content, reasoning})` per chunk; returns final trimmed DSL string; throws on truncation.

- [ ] **Step 1: Add the constant**

Near `DEFAULT_LLM_MODEL` (`index.html:283`):

```js
    const LLM_MAX_TOKENS = 32000;
```

- [ ] **Step 2: Rewrite `llmConvert` to stream**

Replace `llmConvert` (`index.html:285-327`) with:

```js
    async function llmConvert(rawText, key, model, thinking, onDelta) {
      const body = {
        model: model || DEFAULT_LLM_MODEL,
        messages: [{ role: 'user', content: CONVERT_PROMPT + rawText }],
        temperature: 0,
        max_tokens: LLM_MAX_TOKENS,
        stream: true,
      };
      if (thinking !== false) body.reasoning = { effort: 'low' };
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json',
          'HTTP-Referer': location.origin === 'null' ? 'https://crochet.local/' : location.origin,
          'X-Title': 'Crochet tracker',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        let detail = t;
        try { detail = JSON.parse(t).error?.message || t; } catch (e) {}
        throw new Error('OpenRouter ' + res.status + ': ' + (detail || res.statusText).slice(0, 240));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', content = '', reasoning = '', finishReason = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep the (possibly partial) last line
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue; // skip blank lines and ": keep-alive" comments
          const payload = t.slice(5).trim();
          if (payload === '[DONE]') continue;
          let json;
          try { json = JSON.parse(payload); } catch (e) { continue; }
          const choice = json.choices && json.choices[0];
          if (!choice) continue;
          const delta = choice.delta || {};
          if (delta.content) { content += delta.content; if (onDelta) onDelta({ content: delta.content, reasoning: '' }); }
          if (delta.reasoning) { reasoning += delta.reasoning; if (onDelta) onDelta({ content: '', reasoning: delta.reasoning }); }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      }
      if (finishReason === 'length') {
        throw new Error('The model hit the output limit and the pattern was cut off. Try converting a shorter section, or pick a model with a larger output limit.');
      }
      let out = content.trim();
      if (out.startsWith('```')) {
        const outLines = out.split('\n');
        if (outLines[outLines.length - 1].startsWith('```')) outLines.pop();
        outLines.shift();
        out = outLines.join('\n').trim();
      }
      return out;
    }
```

- [ ] **Step 3: Update the caller to pass `onDelta`**

In `go()` (`index.html:1087`), change the call to pass a no-op for now (the live panel is wired in Task 7):

```js
          const out = await llmConvert(rawText, llm.key, llm.model, llm.thinking !== false, null);
```

- [ ] **Step 4: Manual verification**

Open `index.html`, open Convert with AI, paste a long pattern (e.g. the full Landon the Lion text), Convert. Verify it completes without truncation and produces a full DSL (all sections present). Temporarily set `LLM_MAX_TOKENS = 200`, reconvert, and confirm the truncation error message appears instead of a half-pattern; then restore `32000`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: stream conversion, 32k token cap, truncation detection"
```

---

## Task 7: Converter dialog — model dropdown + live panel

**Files:**
- Modify: `index.html` (`aiConvertDialog` ~997-1126; add `LLM_MODELS`)

**Interfaces:**
- Consumes: `llmConvert(..., onDelta)` (Task 6).

- [ ] **Step 1: Add the model list constant**

Near `DEFAULT_LLM_MODEL`:

```js
    const LLM_MODELS = [
      { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5 — fast & cheap (default)' },
      { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet — stronger' },
      { id: 'anthropic/claude-opus-4.7', label: 'Claude Opus — strongest, for hard patterns' },
    ];
```

- [ ] **Step 2: Replace the freetext model input with a dropdown + Custom field**

In `aiConvertDialog`, replace the `modelInput` definition and the two suggestion-link `keyRow` children (`index.html:1008` and `1012-1029`) with a select + hidden custom input:

```js
      const modelSelect = el('select');
      for (const m of LLM_MODELS) {
        const opt = document.createElement('option');
        opt.value = m.id; opt.textContent = m.label;
        modelSelect.appendChild(opt);
      }
      const customOpt = document.createElement('option');
      customOpt.value = '__custom__'; customOpt.textContent = 'Custom… (enter an OpenRouter model id)';
      modelSelect.appendChild(customOpt);
      const modelCustom = el('input', { type: 'text', placeholder: 'e.g. anthropic/claude-3.5-sonnet' });
      modelCustom.style.display = 'none';
      function syncModelUI(savedId) {
        const known = LLM_MODELS.some(m => m.id === savedId);
        if (savedId && !known) { modelSelect.value = '__custom__'; modelCustom.value = savedId; modelCustom.style.display = ''; }
        else { modelSelect.value = savedId || DEFAULT_LLM_MODEL; modelCustom.style.display = 'none'; }
      }
      modelSelect.addEventListener('change', () => {
        modelCustom.style.display = modelSelect.value === '__custom__' ? '' : 'none';
      });
      function selectedModelId() {
        return modelSelect.value === '__custom__' ? modelCustom.value.trim() : modelSelect.value;
      }
```

Update `keyRow` to use these instead of the old `modelInput` + links:

```js
      const keyRow = el('div', { class: 'stack' },
        el('div', { class: 'muted', style: 'font-size:13px' }, 'OpenRouter key (stored locally, never sent anywhere except OpenRouter)'),
        keyInput,
        el('div', { class: 'muted', style: 'font-size:13px;margin-top:4px' }, 'Model'),
        modelSelect,
        modelCustom,
      );
```

- [ ] **Step 3: Update save/restore to use the select**

Replace the three spots that read/write `modelInput.value`:

- In `editKeyBtn` onclick (`index.html:1033`): `syncModelUI(llm.model || '');`
- In `go()` where it saves (`index.html:1074`): `const m = selectedModelId();`
- On dialog open (after `refreshKeyUI()`): call `syncModelUI(llm.model || '');`

- [ ] **Step 4: Add the live conversion panel**

Add a panel element and wire `onDelta`. After `status` is defined (`index.html:1004`):

```js
      const thinkingPane = el('pre', { class: 'code-box', style: 'display:none; max-height:120px; overflow:auto; opacity:0.7; font-size:12px' });
      const outputPane = el('pre', { class: 'code-box', style: 'display:none; max-height:160px; overflow:auto; font-size:12px' });
```

In `go()`, before the `llmConvert` call, reset and show the panes; pass an `onDelta`:

```js
        thinkingPane.textContent = ''; outputPane.textContent = '';
        thinkingPane.style.display = ''; outputPane.style.display = '';
        const onDelta = ({ content, reasoning }) => {
          if (reasoning) { thinkingPane.textContent += reasoning; thinkingPane.scrollTop = thinkingPane.scrollHeight; }
          if (content) { outputPane.textContent += content; outputPane.scrollTop = outputPane.scrollHeight; }
        };
        try {
          const out = await llmConvert(rawText, llm.key, llm.model, llm.thinking !== false, onDelta);
```

(Keep the rest of the `try/catch/finally` as-is; the success path still closes the dialog.)

Add the panes to the `drawer` (before `status`, `index.html:1116`):

```js
        thinkingPane,
        outputPane,
```

- [ ] **Step 5: Manual verification**

Open `index.html` → Convert with AI. Verify: the model dropdown shows three options + Custom; picking Custom reveals a text field; a saved custom id reselects Custom on reopen. During a conversion, thinking text streams into the dim pane and the DSL builds up in the output pane; on success the DSL lands in the pattern textarea and the dialog closes.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: model dropdown and live streaming panel in convert dialog"
```

---

## Task 8: Converter prompt — teach colour / make-N / assembly

**Files:**
- Modify: `convert-prompt.js`
- Test: `tests.js` (one test that the taught DSL shape parses cleanly)

**Interfaces:**
- Consumes: the engine grammar from Tasks 1–3.

- [ ] **Step 1: Write the failing test**

Add to `tests.js`:

```js
// ---- Converter-shaped DSL parses cleanly ----
{
  const dsl = [
    'color yellow = #e5a50a',
    '[Head] x1',
    'color: cream',
    '1: 6 sc in MR (6)',
    'color: yellow',
    '2: 6 inc (12)',
    '3: 4 sc, color: brown, 8 sc (12)',
    '[Ears] x2',
    '1: 6 sc in MR (6)',
    '[Assembly]',
    'note: Attach each ear to the mane.',
  ].join('\n');
  const { errors, warnings, blocks } = C.parsePattern(dsl);
  eq(errors.length, 0, 'converter DSL: no errors');
  eq(warnings.length, 0, 'converter DSL: no total warnings');
  // Head has 3 rows; [Ears] x2 has 1 row duplicated to 2; total 5.
  eq(blocks.filter(b => b.type === 'row').length, 5, 'Head 3 rows + Ears 1 row x2 = 5');
}
```

- [ ] **Step 2: Run test to verify it passes or fails**

Run: `node tests.js`
Expected: PASS already (engine supports it after Tasks 1–3). This test guards the DSL shape the prompt is taught to emit. If it fails, fix the engine, not the test.

- [ ] **Step 3: Edit `convert-prompt.js` — grammar additions**

In the line-type list (after the `def` line, `convert-prompt.js:19`), add:

```
  Colour switch:    color: <name>        (own line before a round, OR inline in a row's inst-list)
  Colour swatch:    color <name> = #hex  (optional; pins the dot colour)
  Repeated piece:   [SECTION NAME] x <N> (e.g. "[Ears] x2" for "make 2")
```

Add a short grammar note after the `def` paragraph:

```
`color: <name>` sets the working yarn colour from that point on. Put it on its
own line BEFORE the round where the colour begins; for a change partway through
a round, place `color: <name>` inline in that row's comma list
(e.g. `12: 5 sc, color: brown, 5 sc (10)`). It adds nothing to the row's (N)
total. `<name>` is a lowercase colour word (brown, cream, yellow, white, …).
Optionally declare `color <name> = #hex` once at the top to pin the exact shade.
`[NAME] x N` means "make N of this piece" (from "make 2", "make 4", "×2").
```

- [ ] **Step 4: Edit `convert-prompt.js` — translation rules**

Replace the yarn-note rules (`convert-prompt.js:107`):

```
  "(white yarn)" / "with white yarn" / "using color A (yellow)"  ->  color: white  (place before the round it starts)
  "switch to red yarn" / "change to red" mid-round               ->  inline "color: red" in that row's list
  "(make 2)" / "make 4" / "×2" beside a part name                ->  "[NAME] x N"
  finishing / assembly / attaching instructions                  ->  an [ASSEMBLY] section, one note: per step
```

Update rule 1 wording (NEVER copy English into a row) to note the one exception is the inline `color:` switch, which IS allowed inside a row's list.

- [ ] **Step 5: Edit `convert-prompt.js` — worked examples**

In WORKED EXAMPLE 2 (the cloak), replace the `note: Use white yarn.` / `note: Switch to red yarn.` lines with `color: white` (before row 1) and `color: red` (before row 3). In the HEAD & BODY intro example (`convert-prompt.js:162-170`), change `note: With green yarn.` to `color: green`. Add one compact worked example demonstrating a mid-round `color:` switch, a `[… ] x2` piece, and an `[ASSEMBLY]` section with one note per step (use the Task 1 test DSL as the model).

- [ ] **Step 6: Run the full engine suite**

Run: `node tests.js`
Expected: PASS — all tests including the Step 1 guard.

- [ ] **Step 7: Manual verification**

Open `index.html`, convert a real multi-colour pattern (e.g. Landon the Lion). Confirm the output uses `color:` lines at colour boundaries, `[NAME] xN` for "make N" pieces, and an `[ASSEMBLY]` section — and that it loads into the tracker with the colour chip, switch prompts, piece counters, and assembly checklist all working end to end.

- [ ] **Step 8: Commit**

```bash
git add convert-prompt.js tests.js
git commit -m "feat: teach converter colour, make-N, and assembly"
```

---

## Self-review notes (coverage)

- Spec Feature 1 (Colour): Tasks 1 (palette/resolve), 2 (threading/anchor/inline/reset), 4 (chip + switch UI), 8 (prompt).
- Spec Feature 2 (Make N): Tasks 3 (duplication), 5 (section card), 8 (prompt).
- Spec Feature 3 (Assembly): Tasks 5 (checklist note), 8 (prompt emits `[ASSEMBLY]`).
- Spec Feature 4 (Converter): Tasks 6 (cap/truncation/stream), 7 (dropdown/live panel).
- Out-of-scope items (mane/leftover-loops, per-conversion max field, colour-usage validation) are not implemented, per spec.
