# Stitch heights & parameterized operations

**Date:** 2026-06-05
**Status:** Approved design, pending implementation plan

## Problem

The tracker only understands single crochet (`sc`). Increases (`inc`) and
decreases (`dec`) are hardcoded as sc-specific tokens. We want to support
taller stitches (half-double, double, treble, double-treble) and their
increases/decreases — without a combinatorial explosion of tokens.

## Key insight: two orthogonal axes

What looked like "is dc a modifier? is inc a modifier?" is really two
independent axes that were conflated:

| Axis | Values | Role |
|---|---|---|
| **Height** | `sc, hdc, dc, tr, dtr` | the *base stitch* (peers of each other) |
| **Operation** | plain, `inc` (N-in-one), `dec` (N-together) | a modifier on a height |
| **Placement** (already exists) | normal, `blo`, `flo`, in `MR` | a modifier on a height |

Resolution: **height is the base stitch** (dc is a peer of sc, not a
modifier) and **inc/dec is the operation modifier** that applies to any
height. The operation carries a multiplicity `N`, so `2tog`/`3tog`/`Ntog`
and 2-in-one/5-in-one (shells) all come from one rule.

This collapses `5 heights × {plain, inc, dec} × any N` into `5 heights +
2 operation rules`.

### Why the press model generalizes for free

In the existing model, **presses correspond to output stitches produced**,
not internal yarn-over motions. A plain stitch of any height is therefore
one tap (decided with the user: "one tap per stitch"):

| Case | Presses | outputDelta |
|---|---|---|
| height, plain | 1 | `[+1]` |
| height, `dec` mult K | 1 | `[+1]` (eats K stitches, produces 1) |
| height, `inc` mult M | M | `[+1, +1, … ×M]` (M completed stitches) |
| special token | unchanged | unchanged |

Decreases of any N are structurally identical (1 press, +1) — only the
label differs. Increases scale press count with N. The model never needs
to track input consumption because row totals `(N)` are validated against
*output*.

## Design

### 1. Data model (`lib.js`)

Replace the flat `STITCH_INFO` table with two concepts:

- **`HEIGHTS`** — token → display label: `sc, hdc, dc, tr, dtr`. Every
  height is structurally identical (1 press, +1 plain); the label is the
  only difference between them.
- **`SPECIALS`** — the existing non-height tokens kept exactly as today,
  with the same `presses` / `outputDelta` / `labels`:
  `ch, tch, sl st, join, mr, fo, turn`.

A parsed stitch instruction gains an `op` field:

```js
{ type: 'stitch',
  stitch,                         // a height OR a special token
  op: { kind: 'inc'|'dec', mult } | null,   // heights only; null = plain
  count,                          // repetitions (e.g. "6 dc")
  inMR,                           // unchanged
  modifier }                      // placement: 'blo' | 'flo' | null
```

`op` is only valid on heights; specials never carry an op.

### 2. Press-step derivation (generalizes `makeStitchSteps`)

Given `(stitch, op, modifier)`:

- **special** → return its literal steps (unchanged behavior).
- **height, `op` null (plain)** → 1 step, label = height label, `+1`.
- **height, `op` dec mult K** → 1 step, `+1`, label = decrease label.
- **height, `op` inc mult M** → M steps, each `+1`, labels = increase
  legs `(i/M)`.

Placement modifier suffix (`(blo)` / `(flo)`) is appended to labels and
carried on `step.modifier` exactly as today.

### 3. Labels (backward-compatible)

The three legacy sc labels are preserved by special-casing sc + mult 2:

- **plain:** `"sc"`, `"hdc"`, `"dc"`, `"tr"`, `"dtr"`
- **decrease:** sc + mult 2 → `"dec"` (legacy); otherwise `"<height><N>tog"`
  → `"dc2tog"`, `"dc3tog"`, `"sc3tog"`
- **increase:** sc + mult 2 → `"inc (1/2)"`, `"inc (2/2)"` (legacy);
  otherwise `"<height> inc (i/M)"` → `"dc inc (1/2)"`, `"dc inc (1/5)"`

This rule guarantees every existing test label is reproduced exactly.

### 4. Parser (`parseInst`)

Strip order stays outer→inner. New operation step inserted before the
final count+height parse:

1. group `[ … ] x N` (unchanged)
2. ` in MR` suffix (unchanged)
3. placement ` blo|flo` suffix (unchanged)
4. **operation** (new). Two spellings, tried in this order:
   - **native decrease** (height is embedded, so capture everything here):
     `^(\d+\s*)?(dtr|hdc|dc|tr|sc)(\d+)tog$` → `count` (default 1),
     `height`, `op = {dec, mult=K}`. On match the instruction is fully
     resolved — **skip step 5**. Handles `dc2tog`, `dc3tog`, `sc2tog`,
     `6 dc3tog`.
   - **word form:** `^(?:(.+?)\s+)?(inc|dec)(\d+)?$` → `op.kind`,
     `op.mult` (default 2). The captured `<rest>` (group 1, may be empty)
     flows to step 5. Handles `dc inc`, `dc inc5`, `dc dec3`, bare `inc` /
     `dec`, `6 inc`.
5. **count + height:** the remaining text (only reached from the word form
   or when no operation matched) parsed as `^(\d+\s*)?(dtr|hdc|dc|tr|sc)?$`
   → `count` (default 1), `height` (default `sc`). So bare `inc` = `sc inc`,
   `6 inc` = six sc increases (preserving current AI output), and `6 dc` =
   six plain dc.

Height alternation ordered to disambiguate longer tokens:
`dtr|hdc|dc|tr|sc`. Full-match anchoring prevents `tr` matching inside
`dtr`.

Cases that must parse identically to today: `6 sc`, `28 sc`,
`[6 sc, inc] x 4 (32)`, `dec`, `3 sc blo, dec blo (4)`, `ch 31`, `tch 1`,
`6 sc in MR`, `join`, `turn`.

New cases: `dc`, `6 dc`, `dc inc`, `dc inc5`, `dc2tog`, `dc3tog`,
`sc3tog`, `dc2tog blo`, `[3 dc, dc2tog] x 6`.

### 5. Expansion (`expandInstructions`)

Pass `op` through to the step maker. Group repetition and `inMR` injection
are unchanged.

### 6. AI grammar prompt (`index.html` `CONVERT_PROMPT`)

Extend the grammar table and conversion rules:

- Add height tokens with descriptions: `hdc, dc, tr, dtr`.
- Document operation syntax: `<height> inc`, `<height> inc<M>`,
  `<height><K>tog` / `<height> dec`.
- Add input synonyms that normalize to the clean DSL:
  - "double crochet" → `dc`; "half double crochet" / "hdc" → `hdc`;
    "treble" / "triple crochet" → `tr`; "double treble" → `dtr`
  - "dc2tog" / "dc 2 together" → `dc2tog`; "dc3tog" → `dc3tog`
  - "2 dc in next st" → `dc inc`; "5 dc in one st" (shell) → `dc inc5`
- Update the press/output explanation so the model knows a plain stitch of
  any height is one press, `inc` adds presses, `Ntog` is one press.

### 7. Tests (`tests.js`)

Add cases (all existing tests must stay green):

- plain `dc` / `tr` / `hdc` / `dtr`: 1 press, `+1`, correct labels
- `dc inc`: 2 presses, labels `"dc inc (1/2)"` / `"dc inc (2/2)"`,
  each `+1`
- `dc2tog`: 1 press, `+1`, label `"dc2tog"`; same for `dc3tog`, `sc3tog`
- `dc inc5` (shell): 5 presses, output `+5`
- `dc2tog blo`: placement modifier carried, label suffix `(blo)`
- a mixed row with declared total, e.g. `[3 dc, dc2tog] x 6 (24)`, no
  warnings
- backward-compat assertions: existing sc/inc/dec/blo labels unchanged

## Out of scope

- README has no grammar docs (it is a one-line description) — no change.
- The UI is label-driven (`step.label` / `step.outputDelta`), with no
  per-stitch icons keyed to token names — no UI rendering change required.
- Input-stitch consumption tracking (how many prev-row stitches a `dec`
  eats) — not modeled; only output is counted, which is sufficient for
  row-total validation.

## Files touched

- `lib.js` — table split, parser, expansion, label rule
- `index.html` — `CONVERT_PROMPT` grammar
- `tests.js` — new coverage
