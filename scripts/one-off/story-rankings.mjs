// One-off helper for the "story" round (continue-the-sentence creative-writing
// league). Encodes three axes per candidate title and prints multiple weighted
// ballots + a budget-exact 10-upvote allocation. Not part of the main pipeline.
//
//   stem: "as i sat sadly by her side, me and the devil ___"
//
// Axes (0-100):
//   C = continuation: how easy AND interesting it is to keep the sentence going
//       (or cleanly start a new one). HIGHEST priority.
//   G = grammar: how smoothly the title attaches to the stem (tense/agreement).
//       Scored, but never the top weight (the stem already mixes tenses).
//   M = music: the user's music score. Matters least.

const SONGS = [
  // raw#, title, G, C, M, next-idea
  { i: 1,  t: 'Got A Call',                    G: 88, C: 88, M: 71, next: '…got a call we couldn’t ignore.' },
  { i: 10, t: 'Watching A Good Thing Burn',    G: 80, C: 85, M: 74, next: '…watching a good thing burn, too tired to move.' },
  { i: 11, t: 'Breathing the Same Air',        G: 80, C: 80, M: 75, next: '…breathing the same air, saying nothing at all.' },
  { i: 12, t: 'Trade Hearts',                  G: 56, C: 80, M: 77, next: '…trade hearts in the dark, then regret it by morning.' },
  { i: 9,  t: 'Drink Before the War',          G: 52, C: 84, M: 60, next: '…drink before the war we knew was coming.' },
  { i: 4,  t: 'Drink Deep',                    G: 56, C: 78, M: 73.5, next: '…drink deep and forget her name.' },
  { i: 7,  t: 'Spin The Bottle',               G: 56, C: 77, M: 70, next: '…spin the bottle, dare the dark to answer.' },
  { i: 6,  t: 'Said I Loved You...But I Lied', G: 90, C: 72, M: 72.5, next: 'closes the sentence on a twist; next person opens fresh.' },
  { i: 2,  t: 'Burn Your Village',             G: 55, C: 72, M: 80, next: '…burn your village, then dance in the ashes.' },
  { i: 5,  t: 'Laugh It Off',                  G: 56, C: 64, M: 80, next: '…laugh it off like it never happened.' },
  { i: 15, t: 'Turn Loose the Mermaids',       G: 50, C: 58, M: 80, next: 'surreal pivot; hard to keep coherent ("what comes next?").' },
  { i: 13, t: 'Plan For My Escape',            G: 45, C: 64, M: 70, next: '…plan my escape before the sun came up. (my vs. we clashes)' },
  { i: 8,  t: 'Had A Talk',                     G: 88, C: 56, M: 64, next: '…had a talk about the end. (clean but flat)' },
  { i: 14, t: 'WE MADE PLANS & GOD LAUGHED',   G: 50, C: 58, M: 75, next: 'self-contained; "me and the devil WE made…" breaks the stem.' },
  { i: 0,  t: 'Play Noble',                    G: 48, C: 50, M: 65, next: '…play noble for a night. (awkward phrase, low spark)' },
];

const RANKINGS = [
  { key: 'A', name: 'Story-first (recommended)', w: { C: 0.55, G: 0.30, M: 0.15 } },
  { key: 'B', name: 'Grammar-safe',              w: { C: 0.45, G: 0.40, M: 0.15 } },
  { key: 'C', name: 'Music-hedge',               w: { C: 0.45, G: 0.20, M: 0.35 } },
];

const BUDGET = 10; // upvote bank
const CAP = 3;     // sane per-song cap (export reported "0" = uncaptured)
const FLOOR = 62;  // composite below this earns no upvote

const DV_BUDGET = 5;   // downvote bank (must be spent in full)
const DV_CAP = 2;      // sane per-song downvote cap
const DV_FLOOR = 60;   // composite above this is safe from downvotes

const CONCENTRATED = process.argv.includes('--concentrated'); // more 2s, fewer 1s

function composite(s, w) {
  return s.C * w.C + s.G * w.G + s.M * w.M;
}

// Largest-remainder allocation of BUDGET over weight = max(0, comp - FLOOR),
// clamped to CAP, spending the budget exactly.
function allocate(rows) {
  const weights = rows.map((r) => Math.max(0, r.comp - FLOOR));
  const total = weights.reduce((a, b) => a + b, 0);
  let alloc = rows.map(() => 0);
  if (total > 0) {
    const raw = weights.map((wt) => (wt / total) * BUDGET);
    alloc = raw.map((x) => Math.min(CAP, Math.floor(x)));
    let spent = alloc.reduce((a, b) => a + b, 0);
    // distribute remainder by largest fractional part, respecting cap
    const fr = raw
      .map((x, idx) => ({ idx, frac: x - Math.floor(x) }))
      .sort((a, b) => b.frac - a.frac);
    let k = 0;
    while (spent < BUDGET && k < fr.length * 4) {
      const { idx } = fr[k % fr.length];
      if (alloc[idx] < CAP) { alloc[idx]++; spent++; }
      k++;
    }
    // if still short (all capped), relax cap on the best rows
    let j = 0;
    while (spent < BUDGET) { alloc[j % alloc.length]++; spent++; j++; }
  }
  return alloc;
}

// Downvotes: budget-exact largest-remainder over weight = max(0, DV_FLOOR - comp),
// clamped to DV_CAP. The worst story-killers (low grammar AND low continuation)
// soak up the most. Spent in full even if it has to dip above the floor.
function allocateDown(rows) {
  const weights = rows.map((r) => Math.max(0, DV_FLOOR - r.comp));
  const total = weights.reduce((a, b) => a + b, 0);
  const alloc = rows.map(() => 0);
  if (total > 0) {
    const raw = weights.map((wt) => (wt / total) * DV_BUDGET);
    raw.forEach((x, idx) => { alloc[idx] = Math.min(DV_CAP, Math.floor(x)); });
    let spent = alloc.reduce((a, b) => a + b, 0);
    const fr = raw
      .map((x, idx) => ({ idx, frac: x - Math.floor(x) }))
      .sort((a, b) => b.frac - a.frac || rows[a.idx].comp - rows[b.idx].comp);
    let k = 0;
    while (spent < DV_BUDGET && k < fr.length * 4) {
      const { idx } = fr[k % fr.length];
      if (alloc[idx] < DV_CAP) { alloc[idx]++; spent++; }
      k++;
    }
  }
  // if still short (few below floor), keep adding to the lowest composites
  let spent = alloc.reduce((a, b) => a + b, 0);
  const order = rows.map((_, idx) => idx).sort((a, b) => rows[a].comp - rows[b].comp);
  let j = 0;
  while (spent < DV_BUDGET) {
    const idx = order[j % order.length];
    if (alloc[idx] < DV_CAP) { alloc[idx]++; spent++; }
    j++;
    if (j > order.length * DV_CAP) break;
  }
  return alloc;
}

// Concentrated ("more 2s, fewer 1s"): fill the top of the ranking at TIER votes
// each until the budget runs out, so points stack on the standouts instead of
// dribbling 1s down the list.
function allocateConcentrated(rows, tier = 2) {
  const alloc = rows.map(() => 0);
  let spent = 0;
  for (let i = 0; i < rows.length && spent < BUDGET; i++) {
    const give = Math.min(tier, BUDGET - spent);
    alloc[i] = give;
    spent += give;
  }
  return alloc;
}

for (const rk of RANKINGS) {
  const rows = SONGS.map((s) => ({ ...s, comp: composite(s, rk.w) }))
    .sort((a, b) => b.comp - a.comp);
  const up = CONCENTRATED ? allocateConcentrated(rows) : allocate(rows);
  const down = allocateDown(rows);
  console.log(`\n===== ${rk.key}. ${rk.name}  (C ${rk.w.C} · G ${rk.w.G} · M ${rk.w.M}) =====`);
  console.log('rank  comp  up  dn  G   C   M   #  title');
  rows.forEach((r, idx) => {
    const dn = down[idx] ? `-${down[idx]}` : ' 0';
    console.log(
      `${String(idx + 1).padStart(2)}  ${r.comp.toFixed(1).padStart(5)}  ${String(up[idx]).padStart(2)}  ${dn.padStart(2)}  ` +
      `${String(r.G).padStart(2)} ${String(r.C).padStart(2)} ${String(Math.round(r.M)).padStart(2)}  ` +
      `${String(r.i).padStart(2)}  ${r.t}`
    );
  });
  console.log(`upvotes: ${up.reduce((a, b) => a + b, 0)}/${BUDGET}   downvotes: ${down.reduce((a, b) => a + b, 0)}/${DV_BUDGET}`);
}
