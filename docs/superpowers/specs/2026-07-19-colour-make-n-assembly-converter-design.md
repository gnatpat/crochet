# Colour changes, "make N", assembly checklist, converter limits — design

**Date:** 2026-07-19
**Status:** Approved (pending spec review)

## Problem

Two large multi-piece patterns (Landon the Lion, Mostly Stitchin' Bear) push
past what the tracker handles today. Four gaps:

1. **Colour changes.** The Lion head runs cream → yellow → brown → yellow, plus
   a separately-attached mane, and colour can also change **mid-round**. Today
   colour exists only as `note: Use white yarn.` — invisible on the actual
   stitch. Crucially, in crochet the change is completed on the **last yarn-over
   of the previous stitch**, so the physical action happens one press *before*
   the round the pattern labels. Nothing surfaces that.
2. **"Make N" pieces.** Nearly every piece is *Ears (make 2)*, *Legs (make 2)*,
   *Paw Pads (make 4)*. The tracker has no notion of "do this section N times" —
   you finish it once and it's done.
3. **Assembly/finishing.** Both patterns end with substantial finishing that
   references rows (*attach head at R13–16*, *embroider nose R3–4*). Today this
   collapses into unstructured notes.
4. **Converter token limit.** `max_tokens: 4000` truncates long patterns (worse
   with thinking, which shares that budget), silently returning half a pattern.
   The convert dialog is also a loose stack of inputs with a freetext model box.

## Decisions (settled in brainstorming)

- **Colour is a property of every stitch**, not of a round — this is what makes
  mid-round changes and the one-stitch-early anchor fall out naturally.
- The app **auto-anchors** the "switch now" prompt to the last old-colour stitch
  before any colour boundary. The author never marks the anchor.
- Colour is shown as a **dot + name** chip; the dot shade is auto-derived from
  common colour words, with an optional `color <name> = #hex` override.
- **"Make N"** reuses the existing `x K` repeat syntax and is implemented by
  duplicating the section's blocks — no cursor-model change.
- **Assembly** is the *easy* version only: an `[Assembly]` section whose lines
  are tick-off steps. It reuses the note/step mechanism — no new engine
  primitive. Row references stay as plain text.
- Converter token limit: **one generous default (32000)**, no per-conversion
  field. Add truncation detection. Add streaming so long conversions are
  visible and thinking is shown. Replace the freetext model box with a dropdown.

---

## Feature 1 — Colour

### Data model

A **colour** is `{ name: string, hex: string | null }`.

Every press-step gains an optional `color` field (the resolved colour object, or
`null` when the pattern declares no colours). A step may also carry
`changeTo: <colour object>` — set only on the stitch where the crocheter should
complete the switch (the anchor).

**Backward compatibility:** a pattern with no `color:` lines produces steps with
`color: null` and no `changeTo`; the UI renders exactly as today.

### Syntax

Two forms of one keyword. The **palette** form uses `=` (no colon); the
**switch** form uses `:`. They are unambiguous to parse:

```
color <name> = <#hex | colour-word>     # palette declaration (optional)
color: <name>                           # switch to <name>
```

- **Palette declaration** `color brown = #6b4a2e` — optional; pins the dot shade
  for a colour word. Matched by `^color\s+([a-z][a-z0-9]*)\s*=\s*(.+)$`.
  Collected in a pre-pass (like `def`); the main loop skips these lines so they
  produce no block. `<name>` is one word `[a-z][a-z0-9]*` (lowercased). Value is
  a `#hex` (3 or 6 hex digits) or another known colour word (resolved through
  `COLOR_WORDS`). Duplicate declaration → error.
- **Switch** `color: <name>` — matched by `^color:\s*([a-z][a-z0-9]*)$`; sets
  the running colour to `<name>` from that point forward.
  - As its **own line** between rows: sets colour for subsequent rows. Handled
    in the main parse loop; produces no block (metadata, like `def`).
  - As an **item inside a row's inst-list**: `12: 5 sc, color: brown, 5 sc` —
    switches mid-round. Emits no press-step; flips the running colour for the
    rest of that row and onward.

`color` is added to `RESERVED_NAMES` so a `def`/palette can't shadow the keyword.

### Palette resolution

`resolveColour(name, palette)` → `{ name, hex }`:

1. If `palette[name]` exists: use its value directly if it's a `#hex`, otherwise
   resolve that value as a colour word via `COLOR_WORDS`.
2. Else look up `name` in a built-in **`COLOR_WORDS`** map (small table of common
   yarn colours → hex: white, cream, ivory, tan, buff, beige, brown, black,
   grey/gray, yellow, gold, orange, red, pink, rose, purple, blue, green, mint,
   teal … ~20 entries).
3. Else `hex: null` (UI renders the name with a neutral outline dot).

### Colour threading (engine)

The running colour flows through the whole pattern build, across rows.

- `parsePattern` maintains `currentColour` (starts `null`) and a
  `lastStitchStep` reference (the most recently emitted **anchor-eligible**
  press-step so far, across all blocks).
- A **standalone** `color:` line updates `currentColour` and, if
  `lastStitchStep` exists and its colour differs from the new colour, sets
  `lastStitchStep.changeTo = newColour`.
- `expandInstructions` / `makeStitchSteps` take a mutable `colourState`
  (`{ current, lastStitchStep }`) so that:
  - each emitted press-step gets `color: colourState.current`;
  - an **inline** `color:` instruction updates `colourState.current` and sets
    `changeTo` on `colourState.lastStitchStep` (same rule as the standalone
    form);
  - every anchor-eligible step updates `colourState.lastStitchStep`.
- After a row expands, its final `colourState.current` becomes `parsePattern`'s
  `currentColour` for the next block (inline changes persist forward).

**Anchor-eligible** = a step representing a pulled loop. Concretely: **not** in
the housekeeping set `{ mr, join, tch, turn, fo }` and **not** a synthetic
`section`/`note` step. Heights (`sc`…`dtr`), `ch`, `sl st`, and custom stitches
are eligible. (A colour change with no preceding eligible stitch — e.g. at the
very start of a piece — sets only the starting colour, no `changeTo`.)

Rationale for "last emitted eligible step" over adjacent-colour diffing: it ties
the prompt to exactly where the author placed the switch and correctly skips
trailing `join`/`tch` at a round's end so the prompt lands on the last real
stitch.

### Inline `color:` parsing

`parseInstList` splits on top-level commas as today. `parseInst` gains an early
branch: `^color:\s*([a-z][a-z0-9]*)$` → `{ type: 'colour', name }`. In
`expandInstructions`, a `colour` instruction performs the switch (above) and
pushes no step. It does **not** contribute to the row's `(N)` total (it has no
output), so the existing total check is unaffected.

### UI (`index.html`)

Reuses the big-button render path (around
[index.html:745–753](index.html#L745-L753)), alongside the definition chip.

- **Persistent colour chip:** when the current step has a `color`, render a chip
  = a filled dot (`background: hex`, or an outlined neutral dot if `hex` is
  null) + the colour name, e.g. `🟤 brown`. Placed near the "Next:" label.
- **Switch prompt:** when the current step has `changeTo`, render a prominent
  hint under the button — e.g. `🎨 Change to brown on the final pull-through of
  this stitch` with the target dot. Styled like the definition chip but using
  the warn/accent colour so it stands out. It is **informational** — the stitch
  stays a single tap; the user makes the change while working this stitch.
- No new mandatory step, no extra tap. `rowProgress`, history, and cursor are
  untouched (colour is pure metadata on steps).

A small dot helper renders `hex → <span>` (filled circle) or a neutral ring when
`hex` is null.

---

## Feature 2 — "Make N" pieces

### Syntax

```
[Ears] x2
[Paw Pads] x4
```

Section-header regex extends from `^\[(.+)\]$` to
`^\[(.+?)\]\s*(?:x\s*(\d+))?$`. The optional `x N` (N ≥ 1) sets the section's
repeat count. `x1` or omitted → 1.

### Engine

The section block records `repeat: N`. After the main parse loop, a **post-pass
duplicates repeated sections**:

- A section's **run** = its `section` block plus all following blocks with the
  same `.section` name, up to (not including) the next `section` block.
- For `repeat > 1`, the run is copied `N` times in place. Each copy's blocks get
  `copyIndex` (1-based) and `copyTotal: N`; the section block of each copy also
  carries these for its card.
- Copies are deep enough that `pressSteps` (including `color`/`changeTo`) are
  duplicated. Duplication runs **after** colour threading, so each copy keeps
  the same colours and anchors, and no spurious cross-copy `changeTo` is created
  (both copies start in the same colour).

Row numbers naturally restart per copy (the same row blocks repeat). The cursor,
history, `rowsOf`, `sectionsOf`, and clamping are unchanged — there are simply
more blocks.

### UI

Section card (around [index.html:677–691](index.html#L677-L691)): when the
section block has `copyTotal > 1`, the title becomes `Ears · 2 of 2` (copy index
of total) instead of the `Finished X · Next: Y` form, so repeats read as "you're
on the 2nd one," not as a new part.

### Converter

Recognise "(make 2)", "make 4", "×2" beside a part name → append `x N` to the
`[SECTION]` header.

---

## Feature 3 — Assembly checklist (easy version)

No new engine primitive — an `[Assembly]` (or `[Finishing]`) section whose lines
are `note:` steps already works: each becomes a note block you tap through in
order. Two light touches:

- **Converter:** emit finishing/assembly prose as an `[Assembly]` section with
  **one `note:` per instruction** (attach ear…, embroider nose…), rather than a
  single multi-line note or dropping it. Row references stay as plain text
  inside the note.
- **UI (optional polish):** when a note block's section name is `Assembly` or
  `Finishing` (case-insensitive), render its eyebrow as a checklist affordance —
  `☑ Assembly · step 3 of 8` (count of note steps in that section) instead of
  the generic `📝 After Row N`. Purely a label change in the note branch
  (around [index.html:692–701](index.html#L692-L701)); no engine change.

If even the polish isn't worth it, the converter change alone (one note per
finishing step, grouped in an `[Assembly]` section) delivers the checklist feel.

---

## Feature 4 — Converter: token limit, truncation, streaming, UI

### Token limit + truncation (`llmConvert`, [index.html:285–327](index.html#L285-L327))

- Replace `max_tokens: 4000` with a constant `LLM_MAX_TOKENS = 32000` (module
  scope near `DEFAULT_LLM_MODEL`). No per-conversion UI field.
- **Truncation detection:** if the model stops on `finish_reason === 'length'`,
  throw a clear error — *"The model hit the output limit and the pattern was cut
  off. Try a shorter section, or a model with a larger output limit."* — instead
  of returning partial DSL. (Today no check exists.)

### Streaming + thinking

Switch the request to SSE (`stream: true`) and read the response incrementally:

- Read `res.body.getReader()`, decode chunks, split on `\n`, parse lines
  beginning `data: `. Ignore `data: [DONE]`. Each JSON chunk's
  `choices[0].delta` carries `content` (DSL) and/or `reasoning` (thinking).
  Accumulate both; capture `finish_reason` from the final chunk for the
  truncation check.
- `llmConvert` accepts an `onDelta({ content, reasoning })` callback so the
  dialog can update live. It still returns the final trimmed, fence-stripped DSL
  string (existing post-processing at [index.html:318–326](index.html#L318-L326)
  reused on the accumulated content).
- SSE parsing keeps a buffer for partial lines across chunk boundaries.

### AI panel cleanup (`aiConvertDialog`, [index.html:997–1126](index.html#L997-L1126))

- **Model dropdown** replaces the freetext input (and removes the two inline
  suggestion links, [index.html:1014–1029](index.html#L1014-L1029)). A curated
  `LLM_MODELS` constant array of `{ id, label }` — e.g. Haiku 4.5 (default,
  "fast & cheap"), Sonnet, Opus ("for hard patterns") — plus a **Custom…**
  option that reveals a text input for arbitrary OpenRouter IDs. Selected id
  persists in the existing `llm.model` config; an id not in the list selects
  Custom and fills the field. Model ids stay easy to bump in one place.
- **Live conversion panel:** replace the static "Converting…" status
  ([index.html:1085](index.html#L1085)) with a panel that shows, while
  streaming, a dim **thinking** area (from `reasoning` deltas) above the DSL
  building up (from `content` deltas). On success the DSL flows to the target
  textarea and the dialog closes, as today.
- **Tidy layout:** group key / model / thinking into a cleaner block so the
  dialog reads as labelled fields rather than a loose stack. No behavioural
  change to key storage or the thinking toggle.

### Converter prompt (`convert-prompt.js`)

- **Colour:** replace the "yarn → note" rules. `"(white yarn)" / "with white
  yarn" / "switch to red yarn"` → a `color: white` / `color: red` line, placed
  **before** the round where that colour begins (mid-round switches go inline in
  the row's inst-list: `5 sc, color: brown, 5 sc`). Add `color: <name>` and the
  optional `color <name> = #hex` palette line to the grammar. Update worked
  examples 1 and 2 (currently `note: Use … yarn.`) to use `color:`.
- **Make N:** `"(make 2)" / "make 4"` beside a part name → `[NAME] x N`.
- **Assembly:** finishing/assembly prose → an `[ASSEMBLY]` section with one
  `note:` per step (don't drop it, don't merge into one blob).
- Add a short worked example: a two-colour piece with a mid-round change, a
  `[… ] x2` piece, and an `[ASSEMBLY]` section.

---

## Testing

### `tests.js` (engine — `node tests.js`)

Colour:
- Standalone `color:` between rows: subsequent rows' steps carry the colour;
  the last eligible step of the previous colour gets `changeTo` = new colour.
- The switch anchors on the last **stitch** step, skipping trailing
  `join`/`tch` at a round's end.
- Inline `color:` mid-row: steps before it keep the old colour, steps after
  (and following rows) take the new one; no press-step emitted for the switch;
  row `(N)` total unaffected.
- Colour at the very start (no preceding stitch): starting colour set, no
  `changeTo`.
- Palette `color brown = #6b4a2e` overrides the derived shade; unknown word →
  `hex: null`; duplicate palette line → error; palette hoisting works.
- No `color:` anywhere → every step `color: null`, no `changeTo` (regression).

Make N:
- `[Ears] x2` yields two copies of the section's blocks; each copy's section
  block has `copyIndex`/`copyTotal`; row numbers restart per copy.
- `x1`/omitted → single copy, `copyTotal` 1 (or absent).
- Cursor walks straight from copy 1 into copy 2; `clampCursor`/`rowsOf` counts
  reflect the duplicated blocks.
- Colour + make-N: a two-colour leg made ×2 keeps colours/anchors in both
  copies with no cross-copy `changeTo`.

Assembly:
- An `[Assembly]` section of `note:` lines parses to one note block per line in
  order (already covered by note tests; add one asserting the section name is
  preserved for the UI checklist branch).

Backward compat:
- `parseLine` / `expandInstructions` called without colour state behave as
  before; existing pattern fixtures parse with unchanged step counts/totals.

### Converter (client-side, manual/smoke)

The converter runs in the browser against OpenRouter and isn't unit-tested.
Verify manually: both full patterns convert without truncation; thinking and DSL
stream into the live panel; the model dropdown persists and the Custom option
works; a deliberately tiny cap (temporary) surfaces the truncation error.
`server/test_server.py` is unaffected (sync-only server).

---

## Out of scope

- Non-standard construction: the Lion mane worked into leftover front loops, and
  chain-loop tails. Left as `note:` + `def` for now (deferred in brainstorming).
- A per-conversion max-tokens field (chose a single generous default).
- Colour-aware validation (e.g. warning that a declared palette colour is
  never used).
- Executing/parsing palette hex for anything beyond the display dot.
- A structured assembly model that references piece/section names as data
  (kept to plain-text row references).
