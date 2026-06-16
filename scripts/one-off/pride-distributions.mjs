#!/usr/bin/env node
// One-off: Pride round (analysis/2026-06-08-pride) flat-curve distributions.
//
// The round is a fit GATE: PASS = queer artist OR clear queer theme (the two
// criteria are an UNWEIGHTED pass — fit gates, music ranks). MAYBE = anthem /
// association only (Cher, Kylie, Schitt's Creek). FAIL = no queer connection.
// 25 upvotes across ~50 passing songs, so the user asked for a deliberately FLAT
// curve: a hard 0-2 cap (the round allows 5), "more 1s than 2s," and the top
// outlier (The Village, 85) reined in to 2 instead of ballooning.
//
// Why a driver instead of plain `parse-round --fit`: there is no CLI cap flag, so
// we set parsed.budget.maxUpvotesPerSong = 2 here (same trick as the kpop-solo
// one-off), then sweep allocator configs to surface the distinct flat curves and
// print a fuzzy-boundary report (passes within 1 pt of the cutoff, and funded
// passes carrying a -/? modifier) for the user's swap calls.
//
// Run: node scripts/one-off/pride-distributions.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mergeFitJson, formatScore } from '../score-core.mjs';
import { roundAnalysisDir, scoresPaths, versionsDir, fitPaths } from '../paths.mjs';
import { loadParsedFromHtml, render } from './_helpers.mjs';

const ROUND_ID = '2026-06-08-pride';
const ROUND_HTML = `rounds/${ROUND_ID}.html`;
const CAP = 2; // hard 0-2 cap (round allows 5); flat curve, no top-heavy spike.

// Candidate flat curves. All gate on fit (passFailMaybe) and rank passes by
// music (fit is an unweighted gate, not a weight). They differ only in how the
// 25 points spread across the cap-2 field. We dedupe by realized (2s,1s) shape.
const CONFIGS = [
  { id: 'auto', label: 'Auto (natural breaks)', profile: { shape: 'auto' } },
  { id: 'relative', label: 'Relative (linear by score)', profile: { shape: 'relative' } },
  { id: 'tier2', label: 'All 1s (two point tiers)', profile: { shape: 'auto', tierCount: 2 } },
  { id: 'tier3', label: 'A few 2s, then 1s (three point tiers)', profile: { shape: 'auto', tierCount: 3 } },
  // Bucket sweep catches any other distinct realized curve.
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `k${i + 2}`,
    label: `bucket-count ${i + 2}`,
    profile: { shape: 'auto', bucketCount: i + 2 },
  })),
  // Hand-pinned "clean middle" curves: the bell jumps straight from 1×2 to
  // 10×2, so to honor "more 1s than 2s" with SOME 2s we pin the top music tiers
  // to 2 on a score boundary (no tie split) and let the bell fill the rest at 1.
  // TOP4 = music ≥ 76.5; TOP8 = music ≥ 76 (both are clean score breaks).
  { id: 'pin4', label: '4×2 at the top, then 1s (≥76.5 pinned)', profile: { shape: 'auto', overrides: pins([50, 42, 48, 53]) } },
  { id: 'pin8', label: '8×2 at the top, then 1s (≥76 pinned)', profile: { shape: 'auto', overrides: pins([50, 42, 48, 53, 54, 35, 29, 39]) } },
];

// Build an overrides map pinning each rawOrderIndex to 2 votes.
function pins(indices) {
  return Object.fromEntries(indices.map((i) => [i, 2]));
}

const baseProfile = { rankBy: 'music', gate: { type: 'passFailMaybe' } };

function loadParsed(html) {
  const parsed = loadParsedFromHtml(html, 'objective');
  parsed.budget.maxUpvotesPerSong = CAP;
  return parsed;
}

// Realized point distribution + fuzzy-boundary report for one allocation.
function analyze(songs) {
  const passes = songs.filter((s) => (s.gate ?? s.fitTier) === 'pass' && s.score != null && !s.isDisqualified);
  const funded = passes.filter((s) => (s.finalVotes || 0) > 0);
  const unfunded = passes.filter((s) => !(s.finalVotes || 0) && !s.needsUserInput);
  const twos = funded.filter((s) => s.finalVotes === 2);
  const ones = funded.filter((s) => s.finalVotes === 1);
  const cutoff = funded.length ? Math.min(...funded.map((s) => s.score)) : null;
  const total = songs.reduce((a, s) => a + (s.finalVotes || 0), 0);

  // Fuzzy boundary: passes within 1 pt of the cutoff (either side), and funded
  // passes carrying a -/? modifier (uncertain placement the user wants to vet).
  const nearCutoff = cutoff == null
    ? []
    : passes
        .filter((s) => Math.abs(s.score - cutoff) <= 1)
        .sort((a, b) => b.score - a.score || (b.finalVotes || 0) - (a.finalVotes || 0));
  const modifierFunded = funded
    .filter((s) => s.minus || s.uncertain)
    .sort((a, b) => b.score - a.score);

  return {
    shapeKey: `${twos.length}x2|${ones.length}x1`,
    total,
    twos: twos.length,
    ones: ones.length,
    funded: funded.length,
    cutoff,
    rows: funded
      .sort((a, b) => (b.finalVotes - a.finalVotes) || (b.score - a.score) || a.title.localeCompare(b.title))
      .map((s) => ({ v: s.finalVotes, score: token(s), title: s.title, artist: s.artist })),
    nearCutoff: nearCutoff.map((s) => ({ v: s.finalVotes || 0, score: token(s), title: s.title, artist: s.artist })),
    modifierFunded: modifierFunded.map((s) => ({ v: s.finalVotes, score: token(s), title: s.title, artist: s.artist })),
    unfundedTop: unfunded
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((s) => ({ score: token(s), title: s.title, artist: s.artist })),
  };
}

const token = (s) =>
  `${formatScore(s.score)}${s.plus ? '+' : ''}${s.minus ? '-' : ''}${s.uncertain ? '?' : ''}`;

async function run(parsedBase, fitTemplate, profile) {
  const parsed = JSON.parse(JSON.stringify(parsedBase));
  const fitData = JSON.parse(JSON.stringify(fitTemplate));
  mergeFitJson(parsed, fitData, { ...baseProfile, ...profile });
  return { fitData, parsed };
}

async function main() {
  const html = await readFile(ROUND_HTML, 'utf8');
  const parsedBase = loadParsed(html);
  const fitTemplate = JSON.parse(await readFile(fitPaths(ROUND_ID).json, 'utf8'));

  const verDir = versionsDir(ROUND_ID);
  await mkdir(roundAnalysisDir(ROUND_ID), { recursive: true });
  await mkdir(verDir, { recursive: true });

  const distinct = new Map(); // shapeKey -> { config, analysis, fitData }
  for (const cfg of CONFIGS) {
    const { fitData, parsed } = await run(parsedBase, fitTemplate, cfg.profile);
    const a = analyze(parsed.songs);
    if (a.total !== (parsed.budget.upvoteBankSize ?? 0)) {
      a.budgetWarning = `allocated ${a.total} / ${parsed.budget.upvoteBankSize}`;
    }
    if (!distinct.has(a.shapeKey)) distinct.set(a.shapeKey, { cfg, a, fitData });
  }

  // Order distinct curves from flattest (fewest 2s) to peakiest.
  const ordered = [...distinct.values()].sort((x, y) => x.a.twos - y.a.twos || y.a.ones - x.a.ones);

  // The recommended deliverable: The Village (the lone 9-pt outlier at 85) takes
  // the single 2; the tight 77-74 pack shares flat 1s. Very flat, more 1s than
  // 2s, top reined in to the cap. Written to the official scores.json/html.
  const RECOMMENDED = '1x2|23x1';

  // Write each distinct curve to versions/, render HTML.
  const summary = [];
  for (let i = 0; i < ordered.length; i++) {
    const { cfg, a, fitData } = ordered[i];
    const name = `dist-${String.fromCharCode(97 + i)}-${a.twos}x2-${a.ones}x1`;
    const jsonPath = join(verDir, `${name}.json`);
    fitData.distribution = { id: name, label: cfg.label, config: cfg.profile, shape: a.shapeKey };
    await writeFile(jsonPath, JSON.stringify(fitData, null, 2), 'utf8');
    const htmlPath = join(verDir, `${name}.html`);
    // Music-score order so the funded/0 boundary is easy to compare across curves
    // (fit is an unweighted gate here; the vote-transfer table stays raw order).
    await render(jsonPath, htmlPath, 'music');
    summary.push({ name, label: cfg.label, recommended: a.shapeKey === RECOMMENDED, ...a });

    if (a.shapeKey === RECOMMENDED) {
      const sp = scoresPaths(ROUND_ID);
      await writeFile(sp.json, JSON.stringify(fitData, null, 2), 'utf8');
      await render(sp.json, sp.html, 'music');
    }
  }

  // Compact report.
  const L = [];
  L.push(`Round ${ROUND_ID} — cap ${CAP}/song, budget ${parsedBase.budget.upvoteBankSize} upvotes`);
  L.push(`${ordered.length} distinct flat curve(s):\n`);
  for (const s of summary) {
    L.push(`### ${s.name}  (${s.label})`);
    L.push(`   shape: ${s.twos}×2 + ${s.ones}×1 = ${s.total} pts across ${s.funded} songs; cutoff music = ${s.cutoff}${s.budgetWarning ? '  ⚠ ' + s.budgetWarning : ''}`);
    if (s.twos > 0) {
      const twos = s.rows.filter((r) => r.v === 2).map((r) => `${r.score} ${r.title.slice(0, 28)}`);
      L.push(`   2s: ${twos.join(' | ')}`);
    }
    const lastOnes = s.rows.filter((r) => r.v === 1).slice(-6).map((r) => `${r.score} ${r.title.slice(0, 22)}`);
    L.push(`   lowest 1s: ${lastOnes.join(' | ')}`);
    L.push(`   near cutoff (±1, funded+missed): ${s.nearCutoff.map((r) => `${r.score}${r.v ? '✓' : '✗'} ${r.title.slice(0, 18)}`).join(' | ')}`);
    L.push(`   funded w/ -/? modifier: ${s.modifierFunded.length ? s.modifierFunded.map((r) => `${r.score} ${r.title.slice(0, 20)}`).join(' | ') : '(none)'}`);
    L.push(`   top missed: ${s.unfundedTop.map((r) => `${r.score} ${r.title.slice(0, 18)}`).join(' | ')}`);
    L.push('');
  }
  console.log(L.join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
