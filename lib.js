// Crochet tracker pure logic: parser, row expansion, and cursor.
// Works in browser (attaches to window.Crochet) and in Node (module.exports).

(function (root) {
  'use strict';

  // ---- Stitch table ----
  // presses = number of button presses to complete this stitch
  // outputDelta[i] = how many output stitches the i-th press contributes
  // labels[i] = what to display as "Next:" before the i-th press
  const STITCH_INFO = {
    'sc':    { presses: 1, outputDelta: [1],    labels: ['sc'] },
    'inc':   { presses: 2, outputDelta: [0, 2], labels: ['inc (1/2)', 'inc (2/2)'] },
    'dec':   { presses: 2, outputDelta: [0, 1], labels: ['dec (1/2)', 'dec (2/2)'] },
    'ch':    { presses: 1, outputDelta: [1],    labels: ['ch'] },
    'sl st': { presses: 1, outputDelta: [1],    labels: ['sl st'] },
    'mr':    { presses: 1, outputDelta: [0],    labels: ['MR (form magic ring)'] },
    'fo':    { presses: 1, outputDelta: [0],    labels: ['FO (fasten off)'] },
  };

  function normalizeStitchName(s) {
    s = s.toLowerCase().replace(/\s+/g, ' ').trim();
    if (s === 'slst') return 'sl st';
    return s;
  }

  // ---- Parser ----

  function parsePattern(text) {
    const rows = [];
    const errors = [];
    const warnings = [];
    const lines = (text || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.replace(/#.*$/, '').trim();
      if (!line) continue;
      let parsed;
      try {
        parsed = parseLine(line);
      } catch (e) {
        errors.push({ line: i + 1, message: e.message, raw });
        continue;
      }
      const start = parsed.rangeStart;
      const end = parsed.rangeEnd == null ? parsed.rangeStart : parsed.rangeEnd;
      for (let r = start; r <= end; r++) {
        const pressSteps = expandInstructions(parsed.instructions);
        const computedTotal = pressSteps.reduce((a, s) => a + s.outputDelta, 0);
        if (parsed.expectedTotal != null && parsed.expectedTotal !== computedTotal) {
          warnings.push({
            line: i + 1,
            row: r,
            message: 'Row ' + r + ': declared total (' + parsed.expectedTotal +
              ") doesn't match computed (" + computedTotal + ')',
          });
        }
        rows.push({
          rowNumber: r,
          rangeStart: parsed.rangeStart,
          rangeEnd: parsed.rangeEnd,
          rawLine: raw,
          expectedTotal: parsed.expectedTotal == null ? computedTotal : parsed.expectedTotal,
          pressSteps,
        });
      }
    }
    return { rows, errors, warnings };
  }

  function parseLine(line) {
    const m = line.match(/^(\d+)(?:-(\d+))?\s*:\s*(.+?)\s*(?:\((\d+)\))?\s*$/);
    if (!m) throw new Error('Could not parse line: "' + line + '"');
    const rangeStart = parseInt(m[1], 10);
    const rangeEnd = m[2] ? parseInt(m[2], 10) : null;
    if (rangeEnd != null && rangeEnd < rangeStart) {
      throw new Error('Invalid row range: ' + rangeStart + '-' + rangeEnd);
    }
    const instructions = parseInstList(m[3]);
    if (instructions.length === 0) {
      throw new Error('Empty instructions on line: "' + line + '"');
    }
    const expectedTotal = m[4] ? parseInt(m[4], 10) : null;
    return { rangeStart, rangeEnd, instructions, expectedTotal };
  }

  function splitTopLevel(s, sep) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '[') depth++;
      else if (ch === ']') depth--;
      if (ch === sep && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  function parseInstList(text) {
    return splitTopLevel(text, ',').map(parseInst);
  }

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
    // Match optional count + stitch name (allow "sl st" with optional space)
    const stitchMatch = text.match(/^(?:(\d+)\s*)?(sl\s*st|sc|inc|dec|ch|mr|fo)$/i);
    if (!stitchMatch) {
      throw new Error('Unknown instruction: "' + text + '"');
    }
    const count = stitchMatch[1] ? parseInt(stitchMatch[1], 10) : 1;
    const stitch = normalizeStitchName(stitchMatch[2]);
    return { type: 'stitch', stitch, count, inMR };
  }

  // ---- Row expansion ----

  function makeStitchSteps(stitch) {
    const info = STITCH_INFO[stitch];
    const steps = [];
    for (let i = 0; i < info.presses; i++) {
      steps.push({
        stitch,
        label: info.labels[i],
        outputDelta: info.outputDelta[i],
      });
    }
    return steps;
  }

  function expandInstructions(insts) {
    const steps = [];
    for (const inst of insts) {
      if (inst.type === 'group') {
        const inner = expandInstructions(inst.instructions);
        for (let i = 0; i < inst.repeat; i++) {
          for (const s of inner) steps.push({ stitch: s.stitch, label: s.label, outputDelta: s.outputDelta });
        }
      } else {
        if (inst.inMR) {
          steps.push({ stitch: 'mr', label: STITCH_INFO.mr.labels[0], outputDelta: 0 });
        }
        for (let i = 0; i < inst.count; i++) {
          for (const s of makeStitchSteps(inst.stitch)) steps.push(s);
        }
      }
    }
    return steps;
  }

  // ---- Cursor / state ----

  const HISTORY_CAP = 200;

  function initialState() {
    return { rowIndex: 0, stepIndex: 0, history: [] };
  }

  function advance(state, parsed) {
    if (isDone(state, parsed)) return state;
    const history = state.history.concat([{ rowIndex: state.rowIndex, stepIndex: state.stepIndex }]);
    if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
    const row = parsed.rows[state.rowIndex];
    let rowIndex = state.rowIndex;
    let stepIndex = state.stepIndex + 1;
    if (stepIndex >= row.pressSteps.length) {
      rowIndex++;
      stepIndex = 0;
    }
    return { rowIndex, stepIndex, history };
  }

  function undo(state) {
    if (state.history.length === 0) return state;
    const history = state.history.slice(0, -1);
    const prev = state.history[state.history.length - 1];
    return { rowIndex: prev.rowIndex, stepIndex: prev.stepIndex, history };
  }

  function jumpTo(state, rowIndex, stepIndex) {
    if (stepIndex == null) stepIndex = 0;
    const history = state.history.concat([{ rowIndex: state.rowIndex, stepIndex: state.stepIndex }]);
    if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
    return { rowIndex, stepIndex, history };
  }

  function isDone(state, parsed) {
    return state.rowIndex >= parsed.rows.length;
  }

  function nextLabel(state, parsed) {
    if (isDone(state, parsed)) return 'Done! 🎉';
    const row = parsed.rows[state.rowIndex];
    const step = row.pressSteps[state.stepIndex];
    return step ? step.label : '(end of row)';
  }

  function rowProgress(state, parsed) {
    if (isDone(state, parsed)) return { done: 0, total: 0 };
    const row = parsed.rows[state.rowIndex];
    let done = 0;
    for (let i = 0; i < state.stepIndex; i++) done += row.pressSteps[i].outputDelta;
    return { done, total: row.expectedTotal };
  }

  const api = {
    STITCH_INFO,
    parsePattern,
    parseLine,
    parseInstList,
    expandInstructions,
    initialState,
    advance,
    undo,
    jumpTo,
    isDone,
    nextLabel,
    rowProgress,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Crochet = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
