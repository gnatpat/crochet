// Crochet tracker pure logic: parser, row expansion, and cursor.
// Works in browser (attaches to window.Crochet) and in Node (module.exports).

(function (root) {
  'use strict';

  // ---- Stitch tables ----
  //
  // Two orthogonal concepts:
  //   HEIGHTS  — base stitches (sc, hdc, dc, tr, dtr). All are structurally
  //              identical: 1 press, +1 output when plain. They differ only by
  //              token name. Increases/decreases are applied as an operation.
  //   SPECIALS — non-height tokens with fixed press/output behavior.
  const HEIGHTS = new Set(['sc', 'hdc', 'dc', 'tr', 'dtr']);

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

  // Names a pattern may NOT use for a custom `def` — built-in tokens plus the
  // grammar words the parser reserves.
  const RESERVED_NAMES = new Set([
    ...HEIGHTS,
    'ch', 'tch', 'sl st', 'slst', 'join', 'mr', 'fo', 'turn',
    'inc', 'dec', 'tog', 'in', 'blo', 'flo', 'x', 'def',
  ]);

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
    const { custom, errors: defErrors } = collectCustomStitches(lines);
    for (const e of defErrors) errors.push(e);
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

      // `def` lines were consumed by the pre-pass; they produce no block.
      if (/^def\b/i.test(stripped)) { i++; continue; }

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
      const mult = parseInt(m[3], 10);
      if (mult < 2) throw new Error('Unknown instruction: "' + text + '"');
      return { type: 'stitch', stitch: m[2].toLowerCase(), op: { kind: 'dec', mult }, count, inMR, modifier };
    }

    // 2. Word-form operation: "dc inc", "dc inc5", "dc dec3", bare "inc"/"dec", "6 inc".
    m = text.match(/^(?:(.+?)\s+)?(inc|dec)(\d+)?$/i);
    if (m) {
      const mult = m[3] != null ? parseInt(m[3], 10) : 2;
      if (mult < 2) throw new Error('Unknown instruction: "' + text + '"');
      op = { kind: m[2].toLowerCase(), mult };
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

  // ---- Row expansion ----

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
    if (!op) {
      return [{ stitch, label: stitch + suffix, outputDelta: 1, modifier: mod }];
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
          steps.push({ stitch: 'mr', label: SPECIALS.mr.labels[0], outputDelta: 0, modifier: null });
        }
        for (let i = 0; i < inst.count; i++) {
          for (const s of makeStitchSteps(inst.stitch, inst.op, inst.modifier)) steps.push(s);
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
    HEIGHTS,
    SPECIALS,
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
