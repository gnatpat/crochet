// Crochet tracker pure logic: parser, row expansion, and cursor.
// Works in browser (attaches to window.Crochet) and in Node (module.exports).

(function (root) {
  'use strict';

  // ---- Stitch table ----
  const STITCH_INFO = {
    'sc':    { presses: 1, outputDelta: [1],    labels: ['sc'] },
    'inc':   { presses: 2, outputDelta: [1, 1], labels: ['inc (1/2)', 'inc (2/2)'] },
    'dec':   { presses: 1, outputDelta: [1],    labels: ['dec'] },
    'ch':    { presses: 1, outputDelta: [1],    labels: ['ch'] },
    // Turning chain: physically a chain, but conventionally NOT counted in
    // the row's stitch total. AI converter emits this at the end of flat rows.
    'tch':   { presses: 1, outputDelta: [0],    labels: ['turning ch'] },
    'sl st': { presses: 1, outputDelta: [1],    labels: ['sl st'] },
    'mr':    { presses: 1, outputDelta: [0],    labels: ['MR (form magic ring)'] },
    'fo':    { presses: 1, outputDelta: [0],    labels: ['FO (fasten off)'] },
    // Flip the work — used between rows in flat patterns.
    'turn':  { presses: 1, outputDelta: [0],    labels: ['↩ turn the work'] },
  };

  function normalizeStitchName(s) {
    s = s.toLowerCase().replace(/\s+/g, ' ').trim();
    if (s === 'slst') return 'sl st';
    return s;
  }

  // ---- Parser ----
  //
  // Block types in the order they appear:
  //   { type: 'section', name, intro: [string], pressSteps: [1 ack step] }
  //     - Renders as a "Starting NAME" / "Finished X · Next: NAME" card.
  //     - `intro` holds any notes that appeared between the [NAME] header
  //       and the first row of the section — they're shown inside the card.
  //   { type: 'row',  section, rowNumber, ..., pressSteps }
  //   { type: 'note', section, content, pressSteps: [1 ack step] }

  function parsePattern(text) {
    const blocks = [];
    const errors = [];
    const warnings = [];
    const lines = (text || '').split('\n');
    let currentSection = null;
    // Section block whose `intro` we should fold notes into. Cleared as soon
    // as we see a row in that section.
    let pendingSectionBlock = null;
    let i = 0;

    function addNote(content, raw) {
      if (pendingSectionBlock) {
        pendingSectionBlock.intro.push(content);
      } else {
        blocks.push({
          type: 'note',
          section: currentSection,
          content,
          rawLine: raw,
          expectedTotal: 0,
          pressSteps: [{ stitch: 'note', label: '📝 done reading', outputDelta: 0 }],
        });
      }
    }

    while (i < lines.length) {
      const lineNo = i + 1;
      const raw = lines[i];
      const stripped = raw.replace(/#.*$/, '').trim();

      if (!stripped) { i++; continue; }

      // Section header: [NAME]
      let m = stripped.match(/^\[(.+)\]$/);
      if (m) {
        currentSection = m[1].trim();
        const sectionBlock = {
          type: 'section',
          name: currentSection,
          section: currentSection,
          intro: [],
          rawLine: raw,
          expectedTotal: 0,
          pressSteps: [{ stitch: 'section', label: '▶ tap to start', outputDelta: 0 }],
        };
        blocks.push(sectionBlock);
        pendingSectionBlock = sectionBlock;
        i++;
        continue;
      }

      // Multi-line note: note: """ ... """
      m = stripped.match(/^note:\s*"""(.*)$/);
      if (m) {
        const firstRest = m[1];
        if (firstRest.trim().endsWith('"""')) {
          const trimmed = firstRest.trim();
          const content = trimmed.slice(0, -3).trim();
          addNote(content, raw);
          i++;
          continue;
        }
        const noteLines = [];
        if (firstRest) noteLines.push(firstRest);
        i++;
        let closed = false;
        while (i < lines.length) {
          const l = lines[i];
          if (l.replace(/\s+$/, '').endsWith('"""')) {
            const lastPart = l.replace(/"""\s*$/, '').replace(/\s+$/, '');
            if (lastPart) noteLines.push(lastPart);
            closed = true;
            i++;
            break;
          }
          noteLines.push(l);
          i++;
        }
        if (!closed) {
          errors.push({ line: lineNo, message: 'Unclosed multi-line note (missing """)', raw });
          continue;
        }
        addNote(noteLines.join('\n').trim(), raw);
        continue;
      }

      // Single-line note: note: text
      m = stripped.match(/^note:\s*(.+)$/);
      if (m) {
        addNote(m[1].trim(), raw);
        i++;
        continue;
      }

      // Row
      let parsed;
      try {
        parsed = parseLine(stripped);
      } catch (e) {
        errors.push({ line: lineNo, message: e.message, raw });
        i++;
        continue;
      }
      pendingSectionBlock = null; // intro window closes once a row appears
      const start = parsed.rangeStart;
      const end = parsed.rangeEnd == null ? parsed.rangeStart : parsed.rangeEnd;
      for (let r = start; r <= end; r++) {
        const pressSteps = expandInstructions(parsed.instructions);
        const computedTotal = pressSteps.reduce((a, s) => a + s.outputDelta, 0);
        if (parsed.expectedTotal != null && parsed.expectedTotal !== computedTotal) {
          warnings.push({
            line: lineNo,
            row: r,
            message: 'Row ' + r + ': declared total (' + parsed.expectedTotal +
              ") doesn't match computed (" + computedTotal + ')',
          });
        }
        blocks.push({
          type: 'row',
          section: currentSection,
          rowNumber: r,
          rangeStart: parsed.rangeStart,
          rangeEnd: parsed.rangeEnd,
          rawLine: raw,
          expectedTotal: parsed.expectedTotal == null ? computedTotal : parsed.expectedTotal,
          pressSteps,
        });
      }
      i++;
    }

    return {
      blocks,
      errors,
      warnings,
      rows: blocks.filter(b => b.type === 'row'),
    };
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
    // Trailing modifier: blo (back loop only) or flo (front loop only).
    let modifier = null;
    const modMatch = text.match(/^(.+?)\s+(blo|flo)\s*$/i);
    if (modMatch) {
      modifier = modMatch[2].toLowerCase();
      text = modMatch[1].trim();
    }
    // Accept "N stitch" (e.g. "28 sc") or "stitch N" (e.g. "ch 31") or just "stitch".
    const STITCH_RE = /(sl\s*st|sc|inc|dec|ch|tch|mr|fo|turn)/i;
    let count = 1;
    let stitchSrc;
    let m1 = text.match(new RegExp('^(?:(\\d+)\\s*)?' + STITCH_RE.source + '$', 'i'));
    if (m1) {
      if (m1[1] != null) count = parseInt(m1[1], 10);
      stitchSrc = m1[2];
    } else {
      const m2 = text.match(new RegExp('^' + STITCH_RE.source + '(?:\\s+(\\d+))?$', 'i'));
      if (!m2) throw new Error('Unknown instruction: "' + text + '"');
      stitchSrc = m2[1];
      if (m2[2] != null) count = parseInt(m2[2], 10);
    }
    const stitch = normalizeStitchName(stitchSrc);
    return { type: 'stitch', stitch, count, inMR, modifier };
  }

  // ---- Row expansion ----

  function makeStitchSteps(stitch, modifier) {
    const info = STITCH_INFO[stitch];
    const steps = [];
    const suffix = modifier ? ' (' + modifier + ')' : '';
    for (let i = 0; i < info.presses; i++) {
      steps.push({
        stitch,
        label: info.labels[i] + suffix,
        outputDelta: info.outputDelta[i],
        modifier: modifier || null,
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
          for (const s of inner) steps.push({
            stitch: s.stitch, label: s.label, outputDelta: s.outputDelta, modifier: s.modifier || null,
          });
        }
      } else {
        if (inst.inMR) {
          steps.push({ stitch: 'mr', label: STITCH_INFO.mr.labels[0], outputDelta: 0, modifier: null });
        }
        for (let i = 0; i < inst.count; i++) {
          for (const s of makeStitchSteps(inst.stitch, inst.modifier)) steps.push(s);
        }
      }
    }
    return steps;
  }

  // ---- Cursor / state ----
  //
  // State: { blockIndex, stepIndex, markerPending, history }
  // History entries: { blockIndex, stepIndex, markerPending }
  //
  // markerPending is a UI flag: true between the press that completes the
  // first stitch of a row and the next press that acks the marker. The
  // marker is a "virtual" step injected by press() when options.stitchMarker
  // is on.

  const HISTORY_CAP = 200;

  function initialState() {
    return { blockIndex: 0, stepIndex: 0, markerPending: false, history: [] };
  }

  function pushHistory(state) {
    const history = state.history.concat([{
      blockIndex: state.blockIndex,
      stepIndex: state.stepIndex,
      markerPending: !!state.markerPending,
    }]);
    if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
    return history;
  }

  // Internal raw advance: one positional step forward, no marker logic, no history.
  function advanceRaw(state, parsed) {
    if (isDone(state, parsed)) return state;
    const block = parsed.blocks[state.blockIndex];
    let blockIndex = state.blockIndex;
    let stepIndex = state.stepIndex + 1;
    if (stepIndex >= block.pressSteps.length) {
      blockIndex++;
      stepIndex = 0;
    }
    return { blockIndex, stepIndex, markerPending: false, history: state.history };
  }

  // External: same as advanceRaw but pushes history.
  function advance(state, parsed) {
    if (isDone(state, parsed)) return state;
    const history = pushHistory(state);
    const next = advanceRaw(state, parsed);
    return { ...next, history };
  }

  // Press: the "user pressed the big button" handler.
  // Knows about marker injection.
  function press(state, parsed, options) {
    // Acknowledge a pending marker without changing position.
    if (state.markerPending) {
      return { ...state, markerPending: false, history: pushHistory(state) };
    }
    if (isDone(state, parsed)) return state;
    const prevDone = rowProgress(state, parsed).done;
    const prevBlockIdx = state.blockIndex;
    const next = advance(state, parsed);
    if (next === state) return state;
    const nowDone = rowProgress(next, parsed).done;
    const block = parsed.blocks[prevBlockIdx];
    const sameBlock = next.blockIndex === prevBlockIdx;
    const triggers = options && options.stitchMarker
      && block && block.type === 'row'
      && prevDone === 0 && nowDone > 0
      && sameBlock
      && !isDone(next, parsed);
    if (triggers) next.markerPending = true;
    return next;
  }

  // Positional back. If markerPending, clears it without moving. Else,
  // decrements stepIndex (or rolls to previous block's last step).
  function back(state, parsed) {
    if (state.markerPending) {
      return { ...state, markerPending: false, history: pushHistory(state) };
    }
    if (state.blockIndex === 0 && state.stepIndex === 0) return state;
    let blockIndex = state.blockIndex;
    let stepIndex = state.stepIndex - 1;
    if (stepIndex < 0) {
      blockIndex--;
      if (blockIndex < 0) return state;
      stepIndex = parsed.blocks[blockIndex].pressSteps.length - 1;
    }
    const history = pushHistory(state);
    return { blockIndex, stepIndex, markerPending: false, history };
  }

  function undo(state) {
    if (state.history.length === 0) return state;
    const history = state.history.slice(0, -1);
    const prev = state.history[state.history.length - 1];
    return {
      blockIndex: prev.blockIndex,
      stepIndex: prev.stepIndex,
      markerPending: !!prev.markerPending,
      history,
    };
  }

  function jumpTo(state, blockIndex, stepIndex) {
    if (stepIndex == null) stepIndex = 0;
    return {
      blockIndex,
      stepIndex,
      markerPending: false,
      history: pushHistory(state),
    };
  }

  function isDone(state, parsed) {
    return state.blockIndex >= parsed.blocks.length;
  }

  function nextLabel(state, parsed) {
    if (state && state.markerPending) return '🔖 done placing marker';
    if (isDone(state, parsed)) return 'Done! 🎉';
    const block = parsed.blocks[state.blockIndex];
    const step = block.pressSteps[state.stepIndex];
    return step ? step.label : '(end of row)';
  }

  function rowProgress(state, parsed) {
    if (isDone(state, parsed)) return { done: 0, total: 0 };
    const block = parsed.blocks[state.blockIndex];
    let done = 0;
    for (let i = 0; i < state.stepIndex; i++) done += block.pressSteps[i].outputDelta;
    return { done, total: block.expectedTotal };
  }

  function currentBlock(state, parsed) {
    if (isDone(state, parsed)) return null;
    return parsed.blocks[state.blockIndex];
  }

  function rowsOf(parsed) { return parsed.blocks.filter(b => b.type === 'row'); }

  function sectionsOf(parsed) {
    const names = [];
    const seen = new Set();
    for (const b of parsed.blocks) {
      const n = b.section;
      if (n != null && !seen.has(n)) { seen.add(n); names.push(n); }
    }
    return names;
  }

  // Section that the previous *row* belongs to, if any. Used for the
  // "Finished X · Next: Y" header on section blocks.
  function previousSectionName(parsed, blockIndex) {
    for (let i = blockIndex - 1; i >= 0; i--) {
      const b = parsed.blocks[i];
      if (b.type === 'row' || b.type === 'note') {
        return b.section != null ? b.section : null;
      }
    }
    return null;
  }

  // Last row block in a given section name (or null for "no section").
  function lastRowOfSection(parsed, sectionName) {
    let last = null;
    for (const b of parsed.blocks) {
      if (b.type === 'row' && b.section === sectionName) last = b;
    }
    return last;
  }

  // Migrate cursors stored in older formats:
  //   - `rowIndex` field (pre-blocks model)  ->  `blockIndex`
  //   - missing `markerPending`              ->  false
  function normalizeCursor(c) {
    if (!c) return initialState();
    const fix = (entry) => {
      if (!entry) return null;
      if ('blockIndex' in entry) return entry;
      if ('rowIndex' in entry) {
        return { blockIndex: entry.rowIndex, stepIndex: entry.stepIndex || 0, markerPending: !!entry.markerPending };
      }
      return null;
    };
    const headFix = fix(c);
    const head = headFix || initialState();
    const out = {
      blockIndex: head.blockIndex || 0,
      stepIndex: head.stepIndex || 0,
      markerPending: !!head.markerPending,
      history: (c.history || []).map(h => fix(h)).filter(h => h != null),
    };
    return out;
  }

  const api = {
    STITCH_INFO,
    parsePattern,
    parseLine,
    parseInstList,
    expandInstructions,
    initialState,
    advance,
    advanceRaw,
    press,
    back,
    undo,
    jumpTo,
    isDone,
    nextLabel,
    rowProgress,
    currentBlock,
    rowsOf,
    sectionsOf,
    previousSectionName,
    lastRowOfSection,
    normalizeCursor,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Crochet = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
