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

  // ---- parsePattern: user's three examples ----

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
    // 4 groups, each: 6 sc + inc(2 presses) = 8 presses; 4*8 = 32
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

  // ---- inc / dec semantics (the key clarified bit) ----

  {
    const { rows } = C.parsePattern('1: [6 sc, inc] x 1 (8)');
    const steps = rows[0].pressSteps;
    eq(steps.length, 8, 'inc group: 6 + 2 = 8 presses');
    eq(steps[6].label, 'inc (1/2)', 'inc first leg label');
    eq(steps[7].label, 'inc (2/2)', 'inc second leg label');
    eq(steps[6].outputDelta, 0, 'inc first leg adds 0 stitches');
    eq(steps[7].outputDelta, 2, 'inc second leg adds 2 stitches');
  }
  {
    const { rows } = C.parsePattern('1: dec (1)');
    const steps = rows[0].pressSteps;
    eq(steps.length, 2, 'dec: 2 presses');
    eq(steps[0].label, 'dec (1/2)', 'dec first label');
    eq(steps[1].label, 'dec (2/2)', 'dec second label');
    eq(steps[0].outputDelta, 0, 'dec first leg adds 0');
    eq(steps[1].outputDelta, 1, 'dec second leg adds 1');
  }
  {
    const { rows, warnings } = C.parsePattern('5: [5 sc, dec] x 4 (24)');
    eq(rows.length, 1, 'dec group: 1 row');
    // 4 * (5 sc + dec[2]) = 28 presses; output = 4 * 6 = 24
    eq(rows[0].pressSteps.length, 28, 'dec group: 28 presses');
    const out = rows[0].pressSteps.reduce((a, s) => a + s.outputDelta, 0);
    eq(out, 24, 'dec group: output = 24');
    eq(warnings.length, 0, 'dec group: no warnings');
  }

  // ---- "in MR" suffix ----

  {
    const { rows, errors } = C.parsePattern('1: 6 sc in MR (6)');
    eq(errors.length, 0, '"in MR": no errors');
    eq(rows.length, 1, '"in MR": 1 row');
    const steps = rows[0].pressSteps;
    eq(steps.length, 7, '"in MR": 1 MR ack + 6 sc');
    eq(steps[0].stitch, 'mr', '"in MR": first step is MR');
    eq(steps[0].outputDelta, 0, '"in MR": MR adds no stitches');
    eq(steps[1].stitch, 'sc', '"in MR": second step is sc');
  }
  {
    // Also: alternate explicit syntax
    const { rows, errors } = C.parsePattern('1: MR, 6 sc (6)');
    eq(errors.length, 0, 'MR-as-token: no errors');
    eq(rows[0].pressSteps.length, 7, 'MR-as-token: same 7 presses');
  }

  // ---- count mismatch produces a warning, not an error ----

  {
    const { rows, errors, warnings } = C.parsePattern('1: 6 sc (10)');
    eq(errors.length, 0, 'mismatch: no errors');
    eq(warnings.length, 1, 'mismatch: 1 warning');
    eq(rows.length, 1, 'mismatch: row still parsed');
  }

  // ---- comments, blank lines, whitespace ----

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
    eq(rows[1].pressSteps[0].stitch, 'inc', 'case: INC -> inc');
    eq(rows[2].pressSteps[0].stitch, 'sl st', 'case: SL ST -> sl st');
  }

  // ---- malformed input ----

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

  // ---- cursor: advance + undo ----

  {
    const parsed = C.parsePattern('1: 3 sc\n2: 2 sc');
    let s = C.initialState();
    eq(s.rowIndex, 0, 'cursor: starts at row 0');
    eq(s.stepIndex, 0, 'cursor: starts at step 0');
    s = C.advance(s, parsed);
    eq([s.rowIndex, s.stepIndex], [0, 1], 'cursor: advance 1');
    s = C.advance(s, parsed);
    s = C.advance(s, parsed);
    eq([s.rowIndex, s.stepIndex], [1, 0], 'cursor: rolls to next row');
    s = C.advance(s, parsed);
    s = C.advance(s, parsed);
    eq(C.isDone(s, parsed), true, 'cursor: isDone after final step');
    const after = C.advance(s, parsed);
    eq([after.rowIndex, after.stepIndex], [s.rowIndex, s.stepIndex], 'cursor: advance is no-op when done');
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

  // ---- jumpTo ----
  {
    const parsed = C.parsePattern('1: 3 sc\n2: 3 sc\n3: 3 sc');
    let s = C.initialState();
    s = C.advance(s, parsed); // (0,1)
    s = C.jumpTo(s, 2, 0);
    eq([s.rowIndex, s.stepIndex], [2, 0], 'jumpTo: lands at (2,0)');
    s = C.undo(s);
    eq([s.rowIndex, s.stepIndex], [0, 1], 'jumpTo: undo returns to prior position');
  }

  // ---- rowProgress and nextLabel ----

  {
    const parsed = C.parsePattern('1: [3 sc, inc] x 1 (5)');
    let s = C.initialState();
    eq(C.rowProgress(s, parsed), { done: 0, total: 5 }, 'progress: 0/5 at start');
    eq(C.nextLabel(s, parsed), 'sc', 'next label: sc at start');
    for (let i = 0; i < 3; i++) s = C.advance(s, parsed);
    eq(C.rowProgress(s, parsed).done, 3, 'progress: 3 after 3 sc');
    eq(C.nextLabel(s, parsed), 'inc (1/2)', 'next label: inc 1/2');
    s = C.advance(s, parsed);
    eq(C.rowProgress(s, parsed).done, 3, 'progress: still 3 after inc 1/2');
    eq(C.nextLabel(s, parsed), 'inc (2/2)', 'next label: inc 2/2');
    s = C.advance(s, parsed);
    // Final press of only row → cursor rolls past end, isDone.
    eq(C.isDone(s, parsed), true, 'done after final inc 2/2');
    eq(C.nextLabel(s, parsed), 'Done! 🎉', 'next label: done');
  }

  // After completing a row that is NOT the last, cursor lands at next row, step 0
  {
    const parsed = C.parsePattern('1: 2 sc\n2: 3 sc');
    let s = C.initialState();
    s = C.advance(s, parsed);
    s = C.advance(s, parsed); // last press of row 1
    eq([s.rowIndex, s.stepIndex], [1, 0], 'row transition: lands at next row, step 0');
    eq(C.rowProgress(s, parsed), { done: 0, total: 3 }, 'row transition: progress resets');
    eq(C.nextLabel(s, parsed), 'sc', 'row transition: next label is first stitch of next row');
    // Undo from the transition returns to the last step of the previous row
    s = C.undo(s);
    eq([s.rowIndex, s.stepIndex], [0, 1], 'row transition: undo returns to last step of prev row');
  }

  // ---- end-to-end the user's specific example ----
  // 10: [6 sc, inc] x 4 (32) — walk all 32 presses and check final state
  {
    const parsed = C.parsePattern('10: [6 sc, inc] x 4 (32)');
    let s = C.initialState();
    for (let i = 0; i < 32; i++) s = C.advance(s, parsed);
    eq(C.isDone(s, parsed), true, 'row 10 example: done after 32 presses');
    // 4 inc completions of 2 stitches each, plus 4*6=24 sc => 32
    let totalOut = 0;
    for (const step of parsed.rows[0].pressSteps) totalOut += step.outputDelta;
    eq(totalOut, 32, 'row 10 example: 32 output stitches');
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
