# Custom stitch definitions — design

**Date:** 2026-06-06
**Status:** Approved (pending spec review)

## Problem

Patterns use stitches the DSL doesn't know — e.g. a *mini picot* (`mp`) or a
*bobble* (`bo`). Today the only options are to hard-code each new stitch into
`HEIGHTS`/`SPECIALS`, or push it into a `note:`. Neither scales: every pattern
brings its own vocabulary, and a note can't be tracked as a step.

We want a pattern to **declare its own stitches** at the top, then use those
tokens in rows like any built-in. When such a stitch comes up while tracking,
its definition is shown to the user.

## Decisions (settled in brainstorming)

- A custom stitch is **opaque and atomic**: one button press, no walking
  through its internal motions. (A bobble is "one stitch" to the user.)
- The definition text is **display-only**. The engine does not parse or execute
  the `ch2, sl st …` inside it — it's a human-readable description shown in the
  UI. (Keeps the first version simple.)
- Declared via **dedicated `def` lines**, conventionally at the top.

## Syntax

```
def <name> [(<count>)] = <description>
```

Examples (from the motivating pattern):

```
def bo = bobble stitch (yo, pull up a loop ×5, yo and pull through all 6)
def mp (0) = mini picot: ch2, sl st into first ch to form a point
```

- **`name`** — the row token. One word: `[a-z][a-z0-9]*` after lowercasing.
  Leading/trailing whitespace trimmed. Case-insensitive (stored lowercased).
- **`(count)`** — optional integer stitch-count contribution (the OUTPUT this
  token adds to the row total). **Defaults to 1.** Decorative stitches use
  `(0)`. Must be `>= 0`.
- **`description`** — everything after `=`, trimmed. Free text. Required
  (non-empty).

### Validation (parse errors)

- Name collides with a built-in token or reserved word — rejected. Reserved
  set: all `HEIGHTS` (`sc hdc dc tr dtr`), all `SPECIALS` keys + `slst`
  (`ch tch sl st slst join mr fo turn`), and the grammar words
  `inc dec tog in blo flo x def`.
- Name defined twice — rejected (second `def` errors).
- Malformed line (no `=`, empty name, empty description, non-integer or
  negative count) — rejected with a clear message.
- A row token that looks like a stitch but matches no built-in **and** no
  custom def — stays today's `Unknown instruction: "<text>"` error.

All `def` errors are pushed to `parsePattern`'s `errors` array, same as row
parse errors.

## Engine model (`lib.js`)

Custom stitches behave exactly like a `SPECIALS` entry that the pattern supplies
at parse time: `{ presses: 1, outputDelta: [count], labels: [name],
description }`.

### Two-pass parse

`parsePattern` gains a **pre-pass** that scans all lines for `def` and builds a
`customStitches` map (`name -> { name, count, description }`) before any rows are
parsed. This means defs can sit anywhere but conventionally live at the top, and
rows always resolve regardless of order. The `def` lines themselves produce **no
block** — they're metadata, not steps.

### Threading

The custom map is threaded through the functions that currently only know the
built-in tables:

- `parseLine(line, custom)` / `parseInstList(text, custom)` /
  `parseInst(text, custom)` — `parseInst` checks the custom map when a token
  matches no built-in pattern. A custom token parses to
  `{ type: 'stitch', stitch: name, op: null, count, inMR, modifier }` and
  supports a leading/trailing count (`bo x2` / `2 bo`) and group nesting
  (`[hdc, mp, hdc] x5`) for free, like any token.
- `expandInstructions(insts, custom)` and `makeStitchSteps(stitch, op,
  modifier, custom)` — when `stitch` is in the custom map, emit a single
  press-step `{ stitch: name, label: name, outputDelta: count, modifier,
  definition: description }`.

**Backward compatibility:** the new `custom` parameter is optional everywhere
and defaults to an empty map, so existing direct callers (`parseLine`,
`parseInstList`, `expandInstructions` in tests and elsewhere) keep working
unchanged.

### Press-step shape

The only new field on a press-step is `definition` (a string), present solely on
custom-stitch steps. Everything downstream (`rowProgress`, cursor, history)
already treats steps generically via `outputDelta`, so no other engine change.

### `op` / modifiers on custom stitches

`inc`/`dec`/`Ntog` do **not** apply to custom tokens (they're not heights) — a
custom stitch only carries an optional count and an optional `blo`/`flo`
modifier (the modifier just decorates the label, as it does for any stitch).

## UI (`index.html`)

When the current step is a custom stitch (its press-step has a `definition`),
show the definition inline near the big button so the flow isn't interrupted —
**not** a full info-card (those are for sections/notes/markers and require an
extra tap). Concretely: a small subtitle line under the "Next:" label, e.g.

```
Next:  bo
       ⓘ bobble stitch (yo, pull up a loop ×5, yo and pull through all 6)
```

The stitch stays a single tap; the definition is informational. Rendering reads
`step.definition` from the current press-step in the big-button render path
(around [index.html:1010](index.html#L1010)).

## AI converter prompt — extract to its own file

Today the prompt lives in `index.html` as `const CONVERT_PROMPT = [ "...", "..."
]` — an array of quoted strings that's hard to read and edit. Extract it into a
dedicated file **before** adding the `def` grammar to it.

- New file `convert-prompt.js` containing a single readable template literal:
  `window.CONVERT_PROMPT = \`…\`;`. The whole prompt becomes one plain-text
  block (no per-line quotes, escaping, or array commas).
- Loaded via `<script src="convert-prompt.js"></script>` in `index.html`,
  immediately before the existing inline `<script>` at
  [index.html:205](index.html#L205), so the global is defined first.
- The inline `const CONVERT_PROMPT = [ … ]` is removed; the usage at
  [index.html:528](index.html#L528) (`CONVERT_PROMPT + rawText`) is unchanged —
  it now references the global string. (As a string it concatenates with real
  newlines; verify the existing `.join`/coercion behavior is preserved so the
  prompt text the model receives is byte-identical aside from the new `def`
  content.)

**Why a `.js` file, not a `.txt`/`.md`:** the page is loaded over `file://`
(the smoke test and local use), where `fetch()` of a sibling file is blocked by
the browser. A `<script src>` works under `file://` with no fetch and no build
step.

### Teach the converter the `def` grammar

Teach the converter to emit `def` lines when the source pattern defines its own
stitches inline (e.g. `bo = bobble stitch`, `(mp = mini picot, ch2, slst…)`).
Changes to the prompt text (now in `convert-prompt.js`):

- Add `def <name> [(<count>)] = <description>` to the line-type list and a short
  grammar note: custom stitches are single-press, opaque, count defaults to 1,
  use `(0)` for decorative stitches that don't add to the row total.
- Add a translation rule: when the source defines a non-standard stitch
  abbreviation (a "X = …" definition, or a parenthetical "(ab = …)"), emit a
  `def` line and use the token in rows — instead of forcing it into a `note:`.
- Update rule 7 ("NEVER invent stitch tokens") to: never invent tokens, **but**
  you may introduce a token via an explicit `def` when the source defines one.
- Add a short worked example covering a bobble (`def bo`, count 1) and a picot
  (`def mp (0)`), including that a `(0)` custom stitch doesn't affect the row's
  `(N)` total.

## Testing

`tests.js` (engine):

- `def` parses: name, default count 1, explicit `(0)`, description captured.
- Custom token in a row expands to one step with correct `outputDelta` and
  `definition`.
- `(0)` custom stitch contributes 0 to the row total; row-total warning still
  fires correctly against declared `(N)`.
- Custom token inside a group (`[hdc, mp, hdc] x5`) and with a count (`bo x2`).
- Validation: collision with built-in, duplicate def, malformed def, undefined
  token still errors.
- Hoisting: a `def` placed after the row that uses it still resolves.
- Backward compat: `parseLine`/`expandInstructions` called without a custom map
  behave as before.
- Full motivating pattern parses with zero errors and correct per-row totals.

Prompt extraction (`convert-prompt.js`):

- Loads under `file://` — `window.CONVERT_PROMPT` is a defined non-empty string
  after page load. The existing `ai-smoke.js` (puppeteer, `file://`) exercises
  the converter path and must still pass.

`server/test_server.py` — unaffected (server is sync-only; the converter prompt
lives in the client and isn't unit-tested there). The AI prompt change is
verified by the engine accepting its documented output.

## Out of scope

- Walking through a custom stitch's internal motions (multi-press).
- The engine understanding/expanding the description's contents.
- Editing/managing definitions through UI; they live in the pattern text.
