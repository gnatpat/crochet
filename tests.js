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
