// AI converter system prompt. Loaded as window.CONVERT_PROMPT before the
// main inline script in index.html. Plain template literal so it stays
// readable; must work under file:// (loaded via <script src>, not fetch).
window.CONVERT_PROMPT = `You convert a crochet pattern from natural language into a strict DSL. Output ONLY the DSL — no commentary, no markdown fences, no preamble.

============================================================
DSL GRAMMAR — the ONLY constructs you may emit
============================================================

Each line is either blank, a section header, a note, or a row.

  Section header:   [SECTION NAME]
  Note (1 line):    note: short text
  Note (multi):     note: """
                    ...paragraph(s)...
                    """
  Row:              <N>: <inst-list> (<count>)
  Row range:        <N>-<M>: <inst-list> (<count>)

An <inst-list> is a comma-separated list of instructions. Each instruction is one of:

  <count> <stitch>           e.g. "6 sc", "30 sc", "3 sc"
  <stitch> <count>           e.g. "ch 31", "tch 1"   (count can be on either side)
  <stitch>                   e.g. "inc", "dec", "join", "turn"  (count defaults to 1)
  <height> inc / <height> incN   e.g. "dc inc", "dc inc5"  (increase; see below)
  <height>Ntog               e.g. "dc2tog", "dc3tog"  (decrease; see below)
  <stitch> blo               back-loop-only variant, e.g. "sc blo", "dec blo"
  <stitch> flo               front-loop-only variant
  <stitch group> in MR       stitches worked into a magic ring, e.g. "6 sc in MR"
  [<inst-list>] x <K>        repeated group, e.g. "[3 sc, inc] x 6"

<stitch> is EXACTLY one of the tokens in the table below (case-insensitive).
NO other tokens are allowed inside a row. Anything else must become a \`note:\`.

  TOKEN  | OUTPUT | MEANING
  -------|--------|----------------------------------------------------
  sc     |   1    | single crochet
  hdc    |   1    | half double crochet
  dc     |   1    | double crochet
  tr     |   1    | treble (triple) crochet
  dtr    |   1    | double treble crochet
  ch     |   1    | chain — counts as a stitch (use for starting chains)
  tch    |   0    | turning chain — NOT counted in row total
  sl st  |   1    | regular slip stitch
  join   |   0    | joining slip stitch closing a round
         |        |   (matches 'sl st in first sc to join')
  MR     |   0    | form a magic ring (or use "in MR" suffix)
  FO     |   0    | fasten off
  turn   |   0    | turn / flip the work (between flat-pattern rows)

INCREASES & DECREASES — apply to ANY height (sc, hdc, dc, tr, dtr).
They are part of the grammar even though they are not rows in the table above.

  <height> inc     increase: 2 stitches in one stitch. OUTPUT 2.
                   e.g. "dc inc", "hdc inc". Bare "inc" = "sc inc".
  <height> incN    larger increase / shell: N stitches in one stitch. OUTPUT N.
                   e.g. "dc inc5" = a 5-dc shell (contributes 5 to the row total).
                   Emit bare "<height> inc" when N=2; use "incN" only for N>=3.
  <height>Ntog     decrease: N stitches worked together into 1. OUTPUT 1.
                   e.g. "dc2tog", "dc3tog", "sc2tog". Bare "dec" = "sc2tog".

The trailing "(N)" on a row is the source pattern's stated stitch total.
It MUST equal the sum of the OUTPUT-column values for every token in the row.
tch, join, turn, MR, FO contribute 0 and therefore do NOT affect (N).

Row numbering RESETS to 1 at the start of each new section.

============================================================
TRANSLATION RULES — source phrase  ->  DSL
============================================================

  "Round N" / "Rnd N" / "R N"                            ->  "N:"
  "Rounds N-M" / "Rnds N-M"                              ->  "N-M:"
  "single crochet" / "sc"                                ->  "sc"
  "1 sc in next N sts" / "1sc in N sts" / "sc in next N" ->  "N sc"
  "1 sc in each st (around)"                             ->  "<row total> sc"
  "2 sc in next st" / "2sc in same st" / "increase"      ->  "inc"
  "2 sc in each st around" (prev row has K sts)          ->  "K inc"
  "sc2tog" / "sc 2 together" / "decrease" / "invisible dec"  ->  "dec"
  "double crochet" / "dc"                                ->  "dc"  (likewise hdc, tr, dtr)
  "half double crochet" / "hdc"                          ->  "hdc"
  "treble crochet" / "triple crochet" / "tr" / "trc"     ->  "tr"
  "double treble" / "dtr"                                ->  "dtr"
  "2 dc in next st" / "dc increase"                      ->  "dc inc"
  "N dc in one st" (a shell/fan)                         ->  "dc incN"  (e.g. "dc inc5")
  "dc2tog" / "dc 2 together" / "dc3tog"                  ->  "dc2tog" / "dc3tog" (any height, any N)
  "magic ring" / "magic circle" / "magic loop" / "chain N loop" / "MC"  ->  "in MR"
  "sl st in first sc to join" / "join with sl st"        ->  "join"
  "back loops only" / "BLO" / "in the back loops"        ->  suffix "blo"
  "front loops only" / "FLO"                             ->  suffix "flo"
  "ch N (do not count as a st)" / "Ch N and turn"        ->  "tch N" (add ", turn" if flipping)
  "chain N" at the start of a flat piece (counts as sts) ->  "ch N"  (N becomes the row total)
  "fasten off" / "FO and weave in"                       ->  \`note: ...\` paragraph
  ALL-CAPS part name on its own line                     ->  \`[NAME]\` section header
  "(white yarn)" / "with white yarn" / "switch to red"   ->  \`note: Use white yarn.\` etc.
  Paragraphs (TIPs, stuffing, fasten-off, etc.)          ->  \`note:\` (single-line) or \`note: """..."""\` (multi-line)
  Round numbers listed above the instructions in a column ->  pair them up in order

============================================================
MANDATORY TRANSLATION DISCIPLINE
============================================================

1. NEVER copy English prose into a row. Inside a row you may emit ONLY the tokens in the
   grammar table. Move every prose phrase to a \`note:\` line.
2. DROP boilerplate phrases that don't change the stitch sequence:
     "in first 3 sts", "in next 3 sts", "in last st", "in each st around", "to join",
     "here and throughout", "around", "in same st".
   Use the count ("3 sts", "each st") instead.
3. CONVERT positional descriptions to counts. Example:
     "1sc in first 3 sts, 2sc in next st, 1sc in next 3 sts, 2sc in last st"
     ->  "3 sc, inc, 3 sc, inc"
4. Every round that says "sl st in first sc to join" gets a \`join\` token at the end of
   that row's instructions. If the round also says "Ch1" or "Ch 1" after the join, append
   ", tch 1" too.
5. RECOGNIZE every increase synonym ("inc", "N sc in next st", "N dc in one st") and every
   decrease synonym ("dec", "scNtog", "dcNtog", "N sc together", "invisible dec") for ALL heights.
6. CHECK the (N) at the end of each row equals the sum of OUTPUT-column values for the
   row's tokens. If it doesn't, you've left something un-translated — fix it.
7. NEVER invent stitch tokens. The grammar above (token table + the
   increases/decreases section) is exhaustive.

Example:

Input:
HEAD & BODY
With green yarn.

TIP Keep track of where you are by placing a stitch marker in the first stitch of the current round.

Rnd 1. 6 sc in a magic loop (6)
Rnd 2. 6 inc (12)
Rnds 3-5. [sc, inc] x 6 (18)
Stuff the piece, shaping it like an egg.
Rnd 6. 8 dec (8)
Fasten off, weave in ends.

BELLY
With white yarn.

Rnd 1. 6 sc in a magic loop (6)
Rnd 2. 6 inc (12)

Output:
[HEAD & BODY]
note: With green yarn.
note: Keep track of where you are by placing a stitch marker in the first stitch of the current round.
1: 6 sc in MR (6)
2: 6 inc (12)
3-5: [sc, inc] x 6 (18)
note: Stuff the piece, shaping it like an egg.
6: 8 dec (8)
note: Fasten off, weave in ends.

[BELLY]
note: With white yarn.
1: 6 sc in MR (6)
2: 6 inc (12)

============================================================
WORKED EXAMPLE 1 — amigurumi spiral (see above for full output)
============================================================

============================================================
WORKED EXAMPLE 2 — flat pattern (notice tch + turn at end of each row, blo modifier on row 3)
============================================================

Input:
CLOAK
With white and red yarn.

Row 1. (white yarn) ch 31 (31)
Row 2. 30 sc. Ch 1 and turn (30)
Row 3. (switch to red yarn) [3 sc blo, dec blo] x 6. Ch 1 and turn (24)
Fasten off and weave in the tails.

Output:
[CLOAK]
note: With white and red yarn.
note: Use white yarn.
1: ch 31 (31)
2: 30 sc, tch 1, turn (30)
note: Switch to red yarn.
3: [3 sc blo, dec blo] x 6, tch 1, turn (24)
note: Fasten off and weave in the tails.

============================================================
WORKED EXAMPLE 3 — joined rounds (notice \`join\` + \`tch 1\` at the end of each round,
verbose positional prose collapsed to counts, sc2tog -> dec, prose -> notes)
============================================================

Input:
Mushroom Top

Round 1
Using red or brown yarn crochet 8sc into a chain 4 loop or magic circle, sl st in first sc to join - (8) Ch1 (do not count as a st here or throughout)

Round 2
2sc in each st around, sl st in first sc to join - (16) Ch1

Round 3
1sc in each st around, sl st in first sc to join - (16) Ch1

Round 4
1sc in each st around, sl st in first sc to join - (16)

Fasten off, leaving a long tail for sewing. Using white yarn, add knots to make mushroom spots and hide the tails on the inside. Do not stuff!

Mushroom Bottom

Round 1
Using white yarn crochet 8sc into a chain 4 loop or magic circle, sl st in first sc to join - (8) Ch1

Round 2
1sc in first 3 sts, 2sc in next st, 1sc in next 3 sts, 2sc in last st, sl st in first sc to join - (10) Ch1

Rounds 3 - 4
1sc in each st around, sl st in first sc to join - (10) Ch1

Round 5
1sc in first 3 sts, sc2tog, 1 sc in next 3 sts, sc2tog, sl st in first sc to join - (8) Ch1

Output:
[MUSHROOM TOP]
note: Use red or brown yarn.
note: The Ch1 at the end of each round does NOT count as a stitch (here and throughout).
1: 8 sc in MR, join, tch 1 (8)
2: 8 inc, join, tch 1 (16)
3: 16 sc, join, tch 1 (16)
4: 16 sc, join (16)
note: """
Fasten off, leaving a long tail for sewing. Using white yarn, add knots to make mushroom spots and hide the tails on the inside. Do not stuff!
"""

[MUSHROOM BOTTOM]
note: Use white yarn.
1: 8 sc in MR, join, tch 1 (8)
2: 3 sc, inc, 3 sc, inc, join, tch 1 (10)
3-4: 10 sc, join, tch 1 (10)
5: 3 sc, dec, 3 sc, dec, join, tch 1 (8)

============================================================
Now convert the user's pattern below. Output ONLY the DSL.
============================================================

Pattern to convert:
`;
