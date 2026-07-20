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

  // Names a pattern may NOT use for a custom `def` — built-in tokens plus the
  // grammar words the parser reserves.
  const RESERVED_NAMES = new Set([
    ...HEIGHTS,
    'ch', 'tch', 'sl st', 'slst', 'join', 'mr', 'fo', 'turn',
    'inc', 'dec', 'tog', 'in', 'blo', 'flo', 'x', 'def', 'note', 'color',
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
          pressSteps: [{ stitch: 'note', label: '📝 done reading', outputDelta: 0, definition: null }],
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
          pressSteps: [{ stitch: 'section', label: '▶ tap to start', outputDelta: 0, definition: null }],
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
        parsed = parseLine(stripped, custom);
      } catch (e) {
        errors.push({ line: lineNo, message: e.message, raw });
        i++;
        continue;
      }
      pendingSectionBlock = null; // intro window closes once a row appears
      const start = parsed.rangeStart;
      const end = parsed.rangeEnd == null ? parsed.rangeStart : parsed.rangeEnd;
      for (let r = start; r <= end; r++) {
        const pressSteps = expandInstructions(parsed.instructions, custom);
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
    const custom = Object.create(null);
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

  function parseLine(line, custom = Object.create(null)) {
    const m = line.match(/^(\d+)(?:-(\d+))?\s*:\s*(.+?)\s*(?:\((\d+)\))?\s*$/);
    if (!m) throw new Error('Could not parse line: "' + line + '"');
    const rangeStart = parseInt(m[1], 10);
    const rangeEnd = m[2] ? parseInt(m[2], 10) : null;
    if (rangeEnd != null && rangeEnd < rangeStart) {
      throw new Error('Invalid row range: ' + rangeStart + '-' + rangeEnd);
    }
    const instructions = parseInstList(m[3], custom);
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

  function parseInstList(text, custom = Object.create(null)) {
    return splitTopLevel(text, ',').map(t => parseInst(t, custom));
  }

  function parseInst(text, custom = Object.create(null)) {
    text = text.trim();
    const groupMatch = text.match(/^\[(.+)\]\s*x\s*(\d+)$/i);
    if (groupMatch) {
      return {
        type: 'group',
        instructions: parseInstList(groupMatch[1], custom),
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
    if (s2) {
      count = s2[2] != null ? parseInt(s2[2], 10) : 1;
      return { type: 'stitch', stitch: normalizeStitchName(s2[1]), op: null, count, inMR, modifier };
    }

    // 5. Custom (pattern-defined) stitch, optional count on either side.
    // Names are validated as [a-z][a-z0-9]* at def time, so they need no regex
    // escaping. The RegExp is rebuilt per call — fine, parse is one-shot per load.
    const names = Object.keys(custom);
    if (names.length) {
      // Longest name first so a name that is a prefix of another can't shadow it.
      const NAME_RE = names.slice().sort((a, b) => b.length - a.length).join('|');
      const c1 = text.match(new RegExp('^(?:(\\d+)\\s*)?(' + NAME_RE + ')$', 'i'));
      if (c1) {
        const cnt = c1[1] != null ? parseInt(c1[1], 10) : 1;
        return { type: 'stitch', stitch: c1[2].toLowerCase(), op: null, count: cnt, inMR, modifier };
      }
      const c2 = text.match(new RegExp('^(' + NAME_RE + ')\\s+(\\d+)$', 'i'));
      if (c2) {
        return { type: 'stitch', stitch: c2[1].toLowerCase(), op: null, count: parseInt(c2[2], 10), inMR, modifier };
      }
    }

    throw new Error('Unknown instruction: "' + text + '"');
  }

  // ---- Row expansion ----

  function makeStitchSteps(stitch, op, modifier, custom = Object.create(null)) {
    const suffix = modifier ? ' (' + modifier + ')' : '';
    const mod = modifier || null;

    // Special (non-height) tokens: emit their literal steps.
    if (SPECIALS[stitch]) {
      const info = SPECIALS[stitch];
      const steps = [];
      for (let i = 0; i < info.presses; i++) {
        steps.push({ stitch, label: info.labels[i] + suffix, outputDelta: info.outputDelta[i], modifier: mod, definition: null });
      }
      return steps;
    }

    // Custom (pattern-defined) stitch: one opaque press carrying its definition.
    if (custom[stitch]) {
      const info = custom[stitch];
      return [{ stitch, label: stitch + suffix, outputDelta: info.count, modifier: mod, definition: info.description }];
    }

    // Height tokens.
    if (!op) {
      return [{ stitch, label: stitch + suffix, outputDelta: 1, modifier: mod, definition: null }];
    }
    if (op.kind === 'dec') {
      // "dec" stays the legacy sc-2-together label; everything else is Ntog.
      const label = (stitch === 'sc' && op.mult === 2) ? 'dec' : stitch + op.mult + 'tog';
      return [{ stitch, label: label + suffix, outputDelta: 1, modifier: mod, definition: null }];
    }
    // increase: M completed stitches, one press each.
    const legBase = (stitch === 'sc' && op.mult === 2) ? 'inc' : stitch + ' inc';
    const steps = [];
    for (let i = 0; i < op.mult; i++) {
      const label = legBase + ' (' + (i + 1) + '/' + op.mult + ')';
      steps.push({ stitch, label: label + suffix, outputDelta: 1, modifier: mod, definition: null });
    }
    return steps;
  }

  function expandInstructions(insts, custom = Object.create(null)) {
    const steps = [];
    for (const inst of insts) {
      if (inst.type === 'group') {
        const inner = expandInstructions(inst.instructions, custom);
        for (let i = 0; i < inst.repeat; i++) {
          for (const s of inner) steps.push({
            stitch: s.stitch, label: s.label, outputDelta: s.outputDelta,
            modifier: s.modifier || null, definition: s.definition,
          });
        }
      } else {
        if (inst.inMR) {
          steps.push({ stitch: 'mr', label: SPECIALS.mr.labels[0], outputDelta: 0, modifier: null, definition: null });
        }
        for (let i = 0; i < inst.count; i++) {
          for (const s of makeStitchSteps(inst.stitch, inst.op, inst.modifier, custom)) steps.push(s);
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

  // The single mutually-exclusive state the UI is in, derived from the cursor.
  // One of: 'done' | 'marker' | 'section' | 'note' | 'row'. 'marker' takes
  // precedence over the block type (the marker prompt overlays a row); 'done'
  // takes precedence over everything. Lets the view switch on one value instead
  // of juggling several booleans that must stay mutually exclusive by hand.
  function currentMode(state, parsed) {
    if (isDone(state, parsed)) return 'done';
    if (state && state.markerPending) return 'marker';
    return parsed.blocks[state.blockIndex].type; // 'section' | 'note' | 'row'
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

  // Clamp a cursor to valid positions for `parsed`, repairing anything out of
  // bounds (e.g. after the pattern was edited and shrank). The invariant it
  // guarantees: blockIndex is in [0, blocks.length], where blocks.length is the
  // "done" sentinel; and for a non-done cursor, stepIndex is a valid index into
  // that block's pressSteps. History entries are clamped the same way. Assumes a
  // normalized cursor (run normalizeCursor first for legacy shapes). Returns the
  // original object unchanged when it was already valid, so callers can use a
  // reference check to decide whether to persist.
  function clampCursor(cursor, parsed) {
    if (!cursor) return initialState();
    const n = parsed.blocks.length;
    function clampPos(blockIndex, stepIndex) {
      let bi = blockIndex || 0;
      if (bi < 0) bi = 0;
      if (bi > n) bi = n;
      if (bi >= n) return { blockIndex: bi, stepIndex: 0 }; // done carries no step
      const last = parsed.blocks[bi].pressSteps.length - 1;
      let si = stepIndex || 0;
      if (si < 0) si = 0;
      if (si > last) si = last;
      return { blockIndex: bi, stepIndex: si };
    }
    const head = clampPos(cursor.blockIndex, cursor.stepIndex);
    let historyChanged = false;
    const history = (cursor.history || []).map(h => {
      const p = clampPos(h.blockIndex, h.stepIndex);
      if (p.blockIndex !== h.blockIndex || p.stepIndex !== h.stepIndex) historyChanged = true;
      return { blockIndex: p.blockIndex, stepIndex: p.stepIndex, markerPending: !!h.markerPending };
    });
    if (!historyChanged &&
        head.blockIndex === cursor.blockIndex &&
        head.stepIndex === cursor.stepIndex) {
      return cursor;
    }
    return {
      blockIndex: head.blockIndex,
      stepIndex: head.stepIndex,
      markerPending: !!cursor.markerPending,
      history,
    };
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
    COLOR_WORDS,
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
    currentMode,
    rowsOf,
    sectionsOf,
    previousSectionName,
    lastRowOfSection,
    normalizeCursor,
    clampCursor,
    resolveColour,
    collectPalette,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Crochet = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
