// Tests for lib.js. Runs in both Node and browser.
//   Node:    node tests.js
//   Browser: open tests.html

(function () {
  'use strict';
  const C = (typeof require !== 'undefined')
    ? require('./lib.js')
    : (typeof window !== 'undefined' ? window.Crochet : null);
  if (!C) throw new Error('Crochet library not loaded');

  const results = [];
  function record(passed, msg, detail) {
    results.push({ passed, msg, detail });
  }
  function assert(cond, msg) {
    record(!!cond, msg, cond ? null : 'assertion failed');
  }
  function eq(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a === b) record(true, msg);
    else record(false, msg, '  expected ' + b + '\n  got      ' + a);
  }

  // ---- Parser: user's original three examples ----

  {
    const { rows, errors, warnings } = C.parsePattern('7-9: 28sc (28)');
    eq(errors.length, 0, 'example 1: no errors');
    eq(warnings.length, 0, 'example 1: no warnings');
    eq(rows.length, 3, 'example 1: 7-9 expands to 3 rows');
    eq(rows.map(r => r.rowNumber), [7, 8, 9], 'example 1: row numbers');
    eq(rows[0].pressSteps.length, 28, 'example 1: 28 sc presses');
    eq(rows[0].pressSteps.every(s => s.stitch === 'sc'), true, 'example 1: all sc');
    eq(rows[0].rangeEnd, 9, 'example 1: rangeEnd preserved');
  }
  {
    const { rows, errors, warnings } = C.parsePattern('10: [6 sc, inc] x 4 (32)');
    eq(errors.length, 0, 'example 2: no errors');
    eq(warnings.length, 0, 'example 2: no warnings');
    eq(rows.length, 1, 'example 2: one row');
    eq(rows[0].pressSteps.length, 32, 'example 2: 32 press steps');
    const totalOut = rows[0].pressSteps.reduce((a, s) => a + s.outputDelta, 0);
    eq(totalOut, 32, 'example 2: output stitches = 32');
  }
  {
    const { rows, errors } = C.parsePattern('11-13: 32 sc (32)');
    eq(errors.length, 0, 'example 3: no errors');
    eq(rows.length, 3, 'example 3: 3 rows');
    eq(rows[2].pressSteps.length, 32, 'example 3: row 13 has 32 presses');
  }

  // ---- inc / dec semantics ----

  {
    const { rows } = C.parsePattern('1: [6 sc, inc] x 1 (8)');
    const steps = rows[0].pressSteps;
    eq(steps.length, 8, 'inc group: 6 + 2 = 8 presses');
    eq(steps[6].label, 'inc (1/2)', 'inc first leg label');
    eq(steps[7].label, 'inc (2/2)', 'inc second leg label');
    eq(steps[6].outputDelta, 1, 'inc first leg adds 1 stitch');
    eq(steps[7].outputDelta, 1, 'inc second leg adds 1 stitch');
  }
  {
    const { rows } = C.parsePattern('1: dec (1)');
    const steps = rows[0].pressSteps;
    eq(steps.length, 1, 'dec: 1 press');
    eq(steps[0].label, 'dec', 'dec label');
    eq(steps[0].outputDelta, 1, 'dec adds 1 stitch');
  }
  {
    const { rows, warnings } = C.parsePattern('5: [5 sc, dec] x 4 (24)');
    eq(rows.length, 1, 'dec group: 1 row');
    eq(rows[0].pressSteps.length, 24, 'dec group: 24 presses');
    const out = rows[0].pressSteps.reduce((a, s) => a + s.outputDelta, 0);
    eq(out, 24, 'dec group: output = 24');
    eq(warnings.length, 0, 'dec group: no warnings');
  }

  // ---- blo / flo modifier ----

  {
    const { rows, errors, warnings } = C.parsePattern('1: 3 sc blo, dec blo (4)');
    eq(errors.length, 0, 'blo modifier: no errors');
    eq(warnings.length, 0, 'blo modifier: no warnings');
    const steps = rows[0].pressSteps;
    eq(steps.length, 4, 'blo: 3 sc + 1 dec = 4 presses');
    eq(steps[0].label, 'sc (blo)', 'sc blo label');
    eq(steps[0].modifier, 'blo', 'sc blo modifier attr');
    eq(steps[0].outputDelta, 1, 'sc blo still outputs 1');
    eq(steps[3].label, 'dec (blo)', 'dec blo label');
    eq(steps[3].modifier, 'blo', 'dec blo modifier');
  }
  {
    // Group with blo'd stitches; modifier survives group expansion
    const { rows } = C.parsePattern('1: [3 sc blo, dec blo] x 6 (24)');
    const steps = rows[0].pressSteps;
    eq(steps.length, 24, 'group blo: 6 * (3+1) = 24 presses');
    eq(steps.every(s => s.modifier === 'blo'), true, 'all steps carry blo modifier');
  }
  {
    const { rows } = C.parsePattern('1: 6 sc flo (6)');
    eq(rows[0].pressSteps[0].modifier, 'flo', 'flo modifier');
    eq(rows[0].pressSteps[0].label, 'sc (flo)', 'flo label');
  }

  // ---- join (slip-stitch round join) ----

  {
    const { rows, errors, warnings } = C.parsePattern('1: 8 sc in MR, join, tch 1 (8)');
    eq(errors.length, 0, 'join: no errors');
    eq(warnings.length, 0, 'join: no warnings (join+tch are both 0-output)');
    const steps = rows[0].pressSteps;
    // MR + 8 sc + join + tch = 11 presses; output = 8
    eq(steps.length, 11, 'join: 11 presses (MR + 8 sc + join + tch)');
    eq(steps[9].stitch, 'join', 'second-to-last is join');
    eq(steps[9].outputDelta, 0, 'join outputs 0');
    eq(steps[10].stitch, 'tch', 'last is tch');
    const total = steps.reduce((a, s) => a + s.outputDelta, 0);
    eq(total, 8, 'total output = 8');
  }

  // ---- turn / tch ----

  {
    const { rows, errors, warnings } = C.parsePattern('2: 30 sc, tch 1, turn (30)');
    eq(errors.length, 0, 'tch + turn: no errors');
    eq(warnings.length, 0, 'tch + turn: no warnings (both 0-output)');
    const steps = rows[0].pressSteps;
    eq(steps.length, 32, '30 sc + 1 tch + 1 turn = 32 presses');
    eq(steps[30].stitch, 'tch', 'second-to-last step is tch');
    eq(steps[30].outputDelta, 0, 'tch outputs 0');
    eq(steps[31].stitch, 'turn', 'last step is turn');
    eq(steps[31].outputDelta, 0, 'turn outputs 0');
  }
  {
    // Starting chain still counts as 1-output each
    const { rows, warnings } = C.parsePattern('1: ch 31 (31)');
    eq(warnings.length, 0, 'starting chain: no warnings');
    eq(rows[0].pressSteps.length, 31, '31 ch presses');
    eq(rows[0].pressSteps.every(s => s.stitch === 'ch' && s.outputDelta === 1), true, 'ch is 1-output');
  }

  // ---- "in MR" suffix ----

  {
    const { rows, errors } = C.parsePattern('1: 6 sc in MR (6)');
    eq(errors.length, 0, '"in MR": no errors');
    const steps = rows[0].pressSteps;
    eq(steps.length, 7, '"in MR": 1 MR ack + 6 sc');
    eq(steps[0].stitch, 'mr', '"in MR": first step is MR');
    eq(steps[1].stitch, 'sc', '"in MR": second step is sc');
  }

  // ---- Count mismatch produces a warning ----

  {
    const { rows, errors, warnings } = C.parsePattern('1: 6 sc (10)');
    eq(errors.length, 0, 'mismatch: no errors');
    eq(warnings.length, 1, 'mismatch: 1 warning');
    eq(rows.length, 1, 'mismatch: row still parsed');
  }

  // ---- Comments, whitespace, case-insensitivity ----

  {
    const { rows, errors } = C.parsePattern('# top comment\n\n1: 6 sc (6) # trailing\n\n2: inc');
    eq(errors.length, 0, 'comments: no errors');
    eq(rows.length, 2, 'comments: 2 rows kept');
  }
  {
    const { rows, errors } = C.parsePattern('1: 28sc(28)');
    eq(errors.length, 0, 'tight whitespace: no errors');
    eq(rows[0].pressSteps.length, 28, 'tight whitespace: 28 sc');
  }
  {
    const { rows, errors } = C.parsePattern('1: 6 SC (6)\n2: INC\n3: 4 SL ST');
    eq(errors.length, 0, 'case insensitive: no errors');
    eq(rows[0].pressSteps.every(s => s.stitch === 'sc'), true, 'case: SC -> sc');
    eq(rows[1].pressSteps[0].stitch, 'sc', 'case: INC -> sc height');
    eq(rows[1].pressSteps[0].label, 'inc (1/2)', 'case: INC -> inc op');
    eq(rows[2].pressSteps[0].stitch, 'sl st', 'case: SL ST -> sl st');
  }

  // ---- Malformed input ----

  {
    const { errors } = C.parsePattern('this is not a row');
    assert(errors.length >= 1, 'malformed: at least 1 error');
  }
  {
    const { errors } = C.parsePattern('1: 6 zz (6)');
    assert(errors.length >= 1, 'unknown stitch: error');
  }
  {
    const { errors } = C.parsePattern('5-3: 6 sc');
    assert(errors.length >= 1, 'reversed range: error');
  }

  // ---- Sections are 1-press blocks ----

  {
    const parsed = C.parsePattern(
      '[HEAD & BODY]\n' +
      '1: 1 sc (1)\n' +
      '[BELLY]\n' +
      '1: 1 sc (1)\n'
    );
    eq(parsed.errors.length, 0, 'sections: no errors');
    eq(parsed.blocks.length, 4, 'sections: 4 blocks (2 sections + 2 rows)');
    eq(parsed.blocks[0].type, 'section', 'block 0 is a section');
    eq(parsed.blocks[0].name, 'HEAD & BODY', 'section name');
    eq(parsed.blocks[0].intro, [], 'section with no intro notes');
    eq(parsed.blocks[0].pressSteps.length, 1, 'section has 1 press step');
    eq(parsed.blocks[1].type, 'row', 'block 1 is a row');
    eq(parsed.blocks[1].section, 'HEAD & BODY', 'row inherits section');
    eq(parsed.blocks[2].name, 'BELLY', 'second section');
    eq(parsed.blocks[3].section, 'BELLY', 'second row inherits BELLY');
    eq(C.sectionsOf(parsed), ['HEAD & BODY', 'BELLY'], 'sectionsOf');
    // Row numbering resets per section
    eq(parsed.blocks[1].rowNumber, 1, 'first row of HEAD & BODY = 1');
    eq(parsed.blocks[3].rowNumber, 1, 'first row of BELLY = 1');
  }

  // ---- Section intro folding (notes between [SECTION] and first row) ----

  {
    const parsed = C.parsePattern(
      '[HEAD & BODY]\n' +
      'note: With green yarn.\n' +
      'note: """\n' +
      'TIP keep stitch marker\nin the first stitch.\n' +
      '"""\n' +
      '1: 6 sc in MR (6)\n' +
      'note: After-row note.\n'
    );
    eq(parsed.errors.length, 0, 'intro folding: no errors');
    eq(parsed.blocks.length, 3, '3 blocks: section, row, after-row note');
    eq(parsed.blocks[0].type, 'section', 'first block is section');
    eq(parsed.blocks[0].intro.length, 2, 'section has 2 intro notes folded in');
    eq(parsed.blocks[0].intro[0], 'With green yarn.', 'first intro note');
    assert(parsed.blocks[0].intro[1].includes('TIP keep stitch marker'), 'multi-line intro note captured');
    eq(parsed.blocks[1].type, 'row', '2nd block is the row');
    eq(parsed.blocks[2].type, 'note', '3rd block is a standalone note (after a row)');
    eq(parsed.blocks[2].content, 'After-row note.', 'standalone note content');
  }

  // ---- previousSectionName helper ----

  {
    const parsed = C.parsePattern('[A]\n1: 1 sc\n[B]\n1: 1 sc\n');
    // Block layout: [A][rowA][B][rowB]
    eq(C.previousSectionName(parsed, 0), null, 'before first section: null');
    eq(C.previousSectionName(parsed, 2), 'A', 'before [B]: previous section is A');
  }

  // ---- Notes (standalone, in-between rows) ----

  {
    const parsed = C.parsePattern(
      '1: 6 sc in MR (6)\n' +
      'note: Stuff the piece.\n' +
      '2: 6 inc (12)\n'
    );
    eq(parsed.errors.length, 0, 'note: no errors');
    eq(parsed.blocks.length, 3, '3 blocks');
    eq(parsed.blocks[1].type, 'note', 'middle block is a note');
    eq(parsed.blocks[1].content, 'Stuff the piece.', 'note content');
    eq(parsed.blocks[1].pressSteps.length, 1, 'note has 1 press step');
  }

  // ---- Notes (unclosed) ----

  {
    const parsed = C.parsePattern('note: """\nunclosed\n1: 6 sc (6)\n');
    assert(parsed.errors.length >= 1, 'unclosed note: error reported');
  }

  // ---- Cursor: advance + undo ----

  {
    const parsed = C.parsePattern('1: 3 sc\n2: 2 sc');
    let s = C.initialState();
    eq(s.blockIndex, 0, 'cursor starts at block 0');
    eq(s.stepIndex, 0, 'cursor starts at step 0');
    eq(s.markerPending, false, 'no marker pending initially');
    s = C.advance(s, parsed);
    eq([s.blockIndex, s.stepIndex], [0, 1], 'advance 1');
    s = C.advance(s, parsed);
    s = C.advance(s, parsed);
    eq([s.blockIndex, s.stepIndex], [1, 0], 'rolls into next row');
    s = C.advance(s, parsed);
    s = C.advance(s, parsed);
    eq(C.isDone(s, parsed), true, 'isDone after final step');
    const after = C.advance(s, parsed);
    eq([after.blockIndex, after.stepIndex], [s.blockIndex, s.stepIndex], 'advance is no-op when done');
  }
  {
    const parsed = C.parsePattern('1: 3 sc');
    let s = C.initialState();
    s = C.advance(s, parsed);
    s = C.advance(s, parsed);
    eq(s.stepIndex, 2, 'undo: at step 2');
    s = C.undo(s);
    eq(s.stepIndex, 1, 'undo: back to 1');
    s = C.undo(s);
    eq(s.stepIndex, 0, 'undo: back to 0');
    s = C.undo(s);
    eq(s.stepIndex, 0, 'undo: no-op past start');
  }

  // ---- back() — positional reverse ----

  {
    const parsed = C.parsePattern('1: 2 sc\n2: 3 sc');
    let s = C.initialState();
    s = C.advance(s, parsed);
    s = C.advance(s, parsed); // (1, 0)
    eq([s.blockIndex, s.stepIndex], [1, 0], 'reached row 2 step 0');
    s = C.back(s, parsed);
    eq([s.blockIndex, s.stepIndex], [0, 1], 'back: rolls into prev block last step');
    s = C.back(s, parsed);
    eq([s.blockIndex, s.stepIndex], [0, 0], 'back: step--');
    const same = C.back(s, parsed);
    eq([same.blockIndex, same.stepIndex], [0, 0], 'back: no-op at start');
  }

  // ---- back is recorded in history; undo reverses it ----

  {
    const parsed = C.parsePattern('1: 3 sc');
    let s = C.initialState();
    s = C.advance(s, parsed);
    s = C.advance(s, parsed); // at (0, 2)
    s = C.back(s, parsed);    // at (0, 1)
    eq(s.stepIndex, 1, 'back moved to step 1');
    s = C.undo(s);            // undo the back -> (0, 2)
    eq(s.stepIndex, 2, 'undo of back restores forward position');
  }

  // ---- jumpTo + undo reverses it ----

  {
    const parsed = C.parsePattern('1: 1 sc\n2: 1 sc\n3: 1 sc');
    let s = C.initialState();
    s = C.advance(s, parsed); // (1, 0)
    s = C.jumpTo(s, 2, 0);
    eq([s.blockIndex, s.stepIndex], [2, 0], 'jumpTo lands at target');
    s = C.undo(s);
    eq([s.blockIndex, s.stepIndex], [1, 0], 'undo of jump returns to prior position');
  }

  // ---- Marker as a virtual press step ----

  {
    const parsed = C.parsePattern('1: 3 sc (3)');
    const options = { stitchMarker: true };
    let s = C.initialState();
    // First press: completes first stitch + sets markerPending
    s = C.press(s, parsed, options);
    eq([s.blockIndex, s.stepIndex], [0, 1], 'marker: positionally advanced to step 1');
    eq(s.markerPending, true, 'marker: pending after first stitch');
    eq(C.nextLabel(s, parsed), '🔖 done placing marker', 'nextLabel reflects marker');
    // Second press: clears markerPending (no positional change)
    s = C.press(s, parsed, options);
    eq([s.blockIndex, s.stepIndex], [0, 1], 'marker ack: position unchanged');
    eq(s.markerPending, false, 'marker: cleared');
    // Third press: advances to step 2
    s = C.press(s, parsed, options);
    eq([s.blockIndex, s.stepIndex], [0, 2], 'next stitch advances');
    eq(s.markerPending, false, 'marker does not re-trigger mid-row');
  }
  {
    // No marker if option is off
    const parsed = C.parsePattern('1: 3 sc (3)');
    let s = C.initialState();
    s = C.press(s, parsed, {});  // no stitchMarker
    eq(s.markerPending, false, 'marker option off: no marker');
  }
  {
    // Marker doesn't trigger on note blocks
    const parsed = C.parsePattern('note: hi\n1: 2 sc');
    const options = { stitchMarker: true };
    let s = C.initialState();
    s = C.press(s, parsed, options); // ack the note
    eq(s.markerPending, false, 'note ack does not trigger marker');
    eq([s.blockIndex, s.stepIndex], [1, 0], 'on row 1 step 0 after ack');
    s = C.press(s, parsed, options); // first stitch
    eq(s.markerPending, true, 'first stitch of next row triggers marker');
  }

  // ---- Undo through marker correctly restores it ----

  {
    const parsed = C.parsePattern('1: 2 sc');
    const options = { stitchMarker: true };
    let s = C.initialState();
    s = C.press(s, parsed, options); // first stitch -> marker pending
    s = C.press(s, parsed, options); // ack marker
    eq(s.markerPending, false, 'after marker ack');
    s = C.undo(s);
    eq(s.markerPending, true, 'undo restores markerPending');
    s = C.undo(s);
    eq(s.markerPending, false, 'undo again -> before first stitch');
    eq(s.stepIndex, 0, 'position back to step 0');
  }

  // ---- Cursor migration ----

  {
    const old = { rowIndex: 3, stepIndex: 2, history: [{ rowIndex: 1, stepIndex: 0 }] };
    const fixed = C.normalizeCursor(old);
    eq(fixed.blockIndex, 3, 'migration: rowIndex -> blockIndex');
    eq(fixed.stepIndex, 2, 'migration: stepIndex preserved');
    eq(fixed.markerPending, false, 'migration: markerPending defaults false');
    eq(fixed.history[0].blockIndex, 1, 'migration: history entries normalized');
    const fixed2 = C.normalizeCursor(fixed);
    eq(fixed2.blockIndex, 3, 'migration: idempotent');
  }

  // ---- currentMode: the single derived view state ----

  {
    // Blocks: [section BODY][row 1][note]. (A note before the first row would
    // fold into the section intro, so the note goes after the row here.)
    const parsed = C.parsePattern('[BODY]\n1: 3 sc (3)\nnote: stuff it');
    eq(parsed.blocks.map(b => b.type), ['section', 'row', 'note'], 'mode: block layout');

    eq(C.currentMode({ blockIndex: 0, stepIndex: 0, markerPending: false, history: [] }, parsed),
      'section', 'mode: section block -> section');
    eq(C.currentMode({ blockIndex: 1, stepIndex: 0, markerPending: false, history: [] }, parsed),
      'row', 'mode: row block -> row');
    eq(C.currentMode({ blockIndex: 1, stepIndex: 1, markerPending: true, history: [] }, parsed),
      'marker', 'mode: markerPending overrides block type');
    eq(C.currentMode({ blockIndex: 2, stepIndex: 0, markerPending: false, history: [] }, parsed),
      'note', 'mode: note block -> note');
    eq(C.currentMode({ blockIndex: 3, stepIndex: 0, markerPending: false, history: [] }, parsed),
      'done', 'mode: past last block -> done');
    eq(C.currentMode({ blockIndex: 3, stepIndex: 0, markerPending: true, history: [] }, parsed),
      'done', 'mode: done takes precedence over marker');
  }

  // ---- Cursor clamping (repair after a pattern shrinks) ----

  {
    // A 2-block pattern: [section][row]. The row has 3 press steps (3 sc).
    const parsed = C.parsePattern('1: 3 sc (3)');
    const nBlocks = parsed.blocks.length; // section? no — single row => 1 block

    // In-bounds cursor is returned unchanged (same reference).
    const valid = { blockIndex: 0, stepIndex: 1, markerPending: false, history: [] };
    eq(C.clampCursor(valid, parsed) === valid, true, 'clamp: valid cursor returned by reference');

    // blockIndex past the end clamps to the done sentinel (blocks.length).
    const oob = C.clampCursor({ blockIndex: 99, stepIndex: 0, markerPending: false, history: [] }, parsed);
    eq(oob.blockIndex, nBlocks, 'clamp: out-of-range block -> done sentinel');
    eq(oob.stepIndex, 0, 'clamp: done sentinel carries stepIndex 0');
    eq(C.isDone(oob, parsed), true, 'clamp: clamped done cursor reads as done');

    // stepIndex past the block's last valid index clamps to that last index,
    // NOT one past it (the old off-by-one).
    const lastStep = parsed.blocks[0].pressSteps.length - 1;
    const stepOob = C.clampCursor({ blockIndex: 0, stepIndex: 50, markerPending: false, history: [] }, parsed);
    eq(stepOob.stepIndex, lastStep, 'clamp: out-of-range step -> last valid index');
    eq(C.nextLabel(stepOob, parsed) !== '(end of row)', true, 'clamp: clamped step points at a real step');

    // History entries are clamped too.
    const withBadHistory = C.clampCursor(
      { blockIndex: 0, stepIndex: 0, markerPending: false,
        history: [{ blockIndex: 0, stepIndex: 0, markerPending: false },
                  { blockIndex: 7, stepIndex: 9, markerPending: false }] },
      parsed);
    eq(withBadHistory.history[1].blockIndex, nBlocks, 'clamp: history block clamped');
    eq(withBadHistory.history[0].blockIndex, 0, 'clamp: valid history entry preserved');

    // markerPending is preserved through a clamp.
    const withMarker = C.clampCursor({ blockIndex: 0, stepIndex: 50, markerPending: true, history: [] }, parsed);
    eq(withMarker.markerPending, true, 'clamp: markerPending preserved');

    // Null cursor becomes a fresh initial state.
    eq(C.clampCursor(null, parsed).blockIndex, 0, 'clamp: null -> initial state');
  }

  // ---- End-to-end the user's specific example ----

  {
    const parsed = C.parsePattern('10: [6 sc, inc] x 4 (32)');
    let s = C.initialState();
    for (let i = 0; i < 32; i++) s = C.advance(s, parsed);
    eq(C.isDone(s, parsed), true, 'row 10 example: done after 32 presses');
    const totalOut = parsed.rows[0].pressSteps.reduce((a, s) => a + s.outputDelta, 0);
    eq(totalOut, 32, 'row 10 example: 32 output stitches');
  }

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

  // ---- flo modifier on an increase ----

  {
    const { rows } = C.parsePattern('1: dc inc flo (2)');
    const s = rows[0].pressSteps;
    eq(s.length, 2, 'dc inc flo: 2 presses');
    eq([s[0].label, s[1].label], ['dc inc (1/2) (flo)', 'dc inc (2/2) (flo)'], 'dc inc flo: leg labels carry flo');
    eq(s.every(x => x.modifier === 'flo'), true, 'dc inc flo: modifier carried on every leg');
  }

  // ---- word-form decrease (distinct code path from Ntog) ----

  {
    const { rows } = C.parsePattern('1: dc dec, dc dec3 (2)');
    const s = rows[0].pressSteps;
    eq([s[0].label, s[1].label], ['dc2tog', 'dc3tog'], 'word-form dec: dc dec -> dc2tog, dc dec3 -> dc3tog');
    eq(s.reduce((a, x) => a + x.outputDelta, 0), 2, 'word-form dec: output 2');
  }

  // ---- degenerate multiplicity is rejected ----

  {
    const { errors } = C.parsePattern('1: dc inc1 (1)');
    eq(errors.length >= 1, true, 'dc inc1: rejected as a parse error');
  }
  {
    const { errors } = C.parsePattern('1: dc1tog (1)');
    eq(errors.length >= 1, true, 'dc1tog: rejected as a parse error');
  }

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
    eq(errors.some(e => /[Dd]uplicate/.test(e.message)), true, 'def: duplicate error message is specific');
  }
  {
    const { errors } = C.parsePattern('def bo =\n1: 6 sc (6)');
    eq(errors.length >= 1, true, 'def: bare "=" with no description is rejected');
  }
  {
    const { errors } = C.parsePattern('def = nameless\n1: 6 sc (6)');
    eq(errors.length >= 1, true, 'def: missing name is rejected');
  }

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
    const src = 'def bo = bobble\n1: bo 3 (3)';
    const { rows, errors } = C.parsePattern(src);
    eq(errors.length, 0, 'custom count: trailing-count "bo 3" parses');
    eq(rows[0].pressSteps.length, 3, 'custom count: bo 3 -> 3 steps');
  }
  {
    const src = 'def bo = bobble\n1: bo flo (1)';
    const { rows, errors } = C.parsePattern(src);
    eq(errors.length, 0, 'custom modifier: "bo flo" parses');
    eq(rows[0].pressSteps[0].modifier, 'flo', 'custom modifier: flo carried on the custom step');
    eq(rows[0].pressSteps[0].definition, 'bobble', 'custom modifier: definition still present with a modifier');
  }
  {
    // Every press-step carries a `definition` field; built-ins have it as null.
    const { rows } = C.parsePattern('1: 2 sc, [sc] x 2 (4)');
    const steps = rows[0].pressSteps;
    eq(steps.every(s => 'definition' in s), true, 'shape: every built-in step has a definition key');
    eq(steps.every(s => s.definition === null), true, 'shape: built-in definitions are null (grouped and not)');
  }
  {
    const { errors } = C.parsePattern('1: 6 zz (6)');
    eq(errors.length >= 1, true, 'undefined token still errors');
  }

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

  // ---- Report ----
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;

  if (typeof document !== 'undefined') {
    const lines = results.map(r => {
      const mark = r.passed ? '✓' : '✗';
      const detail = r.passed ? '' : '\n' + r.detail;
      return mark + ' ' + r.msg + detail;
    });
    const summary = '\n\n' + passed + '/' + results.length + ' passed' +
      (failed ? '  (' + failed + ' FAILED)' : '');
    document.body.style.background = failed ? '#fee' : '#efe';
    const pre = document.createElement('pre');
    pre.style.font = '14px ui-monospace, Menlo, Consolas, monospace';
    pre.style.padding = '16px';
    pre.textContent = lines.join('\n') + summary;
    document.body.appendChild(pre);
  } else {
    for (const r of results) {
      const mark = r.passed ? 'PASS' : 'FAIL';
      let line = mark + '  ' + r.msg;
      if (!r.passed && r.detail) line += '\n' + r.detail;
      console.log(line);
    }
    console.log('\n' + passed + '/' + results.length + ' passed' +
      (failed ? '  (' + failed + ' FAILED)' : ''));
    if (failed) process.exit(1);
  }
})();
