#!/usr/bin/env node
// One-off: build the four enforcement versions of the K-pop "soloist from a group"
// round (analysis/2026-06-11-kpop-solo). The round is music-only with optional,
// chat-clarified fit leans (mention which group / lesser-known intent). The user
// asked for several "pass / fail / maybe" enforcement profiles, so this script
// encodes each as explicit per-song gate words and runs the deterministic
// allocator (score-core.mjs) — the LLM never allocates.
//
// Why a driver instead of plain `parse-round --fit`:
//   1. WOODZ "Chaser" — the comment "76 fit bonus" is misread by scoreComment as a
//      manual FIT token ("76 fit" => fitScore 76) so the music score is lost and a
//      stray "X1" later yields music 10. Intended music score is 76.
//   2. BSS "Fighting" — "strong negative fit" is misread as fitTier=strong (a
//      POSITIVE fit), the opposite of intent.
//   3. MOMMAE — "maybe fit bonus" is read as a manual gate=maybe.
// Comment-derived fit (fitSource 'manual') wins over a fit JSON, so we reset all
// comment fit fields and set WOODZ music = 76 before applying each version's gates.
//
// Run: node scripts/one-off/kpop-solo-versions.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mergeFitJson, FIT_TIER_SCORES } from '../score-core.mjs';
import { roundAnalysisDir, scoresPaths, versionsDir } from '../paths.mjs';
import { loadParsedFromHtml, render, clearManualFit } from './_helpers.mjs';

const ROUND_ID = '2026-06-11-kpop-solo';
const ROUND_HTML = `rounds/${ROUND_ID}.html`;

// --- Shared identity / context per raw-order index ------------------------------
// group: the larger act the artist belongs to (the prompt's subject).
// comment: did the submitter leave ANY note? namedGroup: did they name the group?
// popular: rough fame of the artist/group to a casual listener (fuzzy, per admin).
const INFO = {
  0:  { artist: 'SUNMI',                      group: 'Wonder Girls',      comment: false, namedGroup: false, popular: 'high' },
  1:  { artist: 'TAEYANG',                     group: 'BIGBANG',           comment: true,  namedGroup: true,  popular: 'mega' },
  2:  { artist: 'HWASA',                       group: 'MAMAMOO',           comment: true,  namedGroup: false, popular: 'high' },
  3:  { artist: 'TAEMIN',                      group: 'SHINee',            comment: false, namedGroup: false, popular: 'mega' },
  4:  { artist: 'ZICO',                        group: 'Block B',           comment: true,  namedGroup: true,  popular: 'high' },
  5:  { artist: 'Yves',                        group: 'LOONA',             comment: true,  namedGroup: true,  popular: 'low'  },
  6:  { artist: 'Jay Park',                    group: '2PM',               comment: false, namedGroup: false, popular: 'high' },
  7:  { artist: 'HAN (can\'t be blue)',        group: 'Stray Kids',        comment: false, namedGroup: false, popular: 'antiprompt' },
  9:  { artist: 'Jung Kook',                   group: 'BTS',               comment: true,  namedGroup: true,  popular: 'mega' },
  11: { artist: 'Jackson Wang',                group: 'GOT7',              comment: true,  namedGroup: true,  popular: 'mega' },
  12: { artist: 'SOYEON / WINTER / LIZ',       group: '(G)I-DLE/aespa/IVE',comment: true,  namedGroup: true,  popular: 'low'  },
  13: { artist: 'YENA',                        group: 'IZ*ONE',            comment: false, namedGroup: false, popular: 'low'  },
  14: { artist: 'MAX CHANGMIN',                group: 'TVXQ',              comment: false, namedGroup: false, popular: 'high' },
  15: { artist: 'JAEHYUN',                     group: 'NCT',               comment: false, namedGroup: false, popular: 'antiprompt' },
  16: { artist: 'WOODZ',                       group: 'UNIQ / X1',         comment: true,  namedGroup: true,  popular: 'low'  },
  17: { artist: 'BSS',                         group: 'SEVENTEEN (subunit)',comment: false, namedGroup: false, popular: 'subunit' },
};
const SHINEE = 8; // group title track — the disqualified entry (already isDisqualified)

// Per-song upvote cap = the round's own rule (10/song). The old CAP=2 stopgap is
// gone: the center-out staircase rewrite (R1) caps top-heaviness from the budget,
// not the cap, so a lone 80 over a tight 72–76 field no longer balloons to 3–4 —
// the curve stays contiguous and low-topped at the natural cap.
const CAP = 10;

const FIT_SCALE = {
  pass:  { fitScore: 80, desc: 'Valid soloist-from-a-group; vote on music.' },
  maybe: { fitScore: 50, desc: 'Borderline (too popular / no submitter note / barely a soloist). Conditional band below the passes; funded only when points are spare, ordered by defensibility.' },
  fail:  { fitScore: 10, desc: 'Broke the prompt (a group release, or never a soloist). Earns 0.' },
};

// Standard thematic-round fit tiers, used by the fit-weighted strategy that
// converts the admin's per-song notes into tiers and ranks on the existing
// combined blend. Scores come from FIT_TIER_SCORES (score-core); only the
// round-specific descriptions are local.
const THEMATIC_DESC = {
  excellent: 'Exactly the round\'s intent: named the group AND a genuinely lesser-known soloist.',
  strong: 'Positive fit note ("fit bonus"): lesser-known and/or named the group.',
  solid: 'Neutral: a valid soloist with no fit lean either way.',
  moderate: 'Slight-negative note: too popular, or a mild anti-prompt lean.',
  weak: 'Strong-negative note: a subunit, or known only as a group member (anti-prompt).',
  nope: 'Broke the prompt (a group release).',
};
const THEMATIC_SCALE = Object.fromEntries(
  Object.entries(THEMATIC_DESC).map(([tier, desc]) => [tier, { fitScore: FIT_TIER_SCORES[tier], desc }])
);

// --- Version definitions ---------------------------------------------------------
// Each maps rawOrderIndex -> { gate, fitScore, why }. fitScore only matters for
// ordering the maybe band (most defensible funded first) and for display.
const VERSIONS = [
  {
    id: 'v1-music-lenient',
    name: 'V1 · Music only (lenient)',
    blurb: 'Only the SHINee group track is out. Everyone else — subunits, collabs, popular or not, comment or not — is valid and voted purely on music.',
    levers: ['SHINee group-track DQ only'],
    gates: () => {
      const g = {};
      for (const i of Object.keys(INFO).map(Number)) g[i] = { gate: 'pass' };
      return g;
    },
  },
  {
    id: 'v2-music-no-subunit',
    name: 'V2 · Music only, subunit excluded',
    blurb: 'Same as V1 but the BSS entry (a SEVENTEEN *subunit*, not a soloist) is also failed. Isolates the one structural toggle the admin flagged ("maybe BSS"). No popularity / comment leans.',
    levers: ['SHINee DQ', 'BSS (subunit) failed'],
    gates: () => {
      const g = {};
      for (const i of Object.keys(INFO).map(Number)) g[i] = { gate: 'pass' };
      g[17] = { gate: 'fail', why: 'BSS is a SEVENTEEN subunit, not a soloist — the one entry beyond SHINee that misses the "soloist" frame.' };
      return g;
    },
  },
  {
    id: 'v3-my-notes',
    name: 'V3 · Exactly the admin notes',
    blurb: 'Applies only the leans actually written in the vote comments, song by song — nothing extrapolated. Negative-flagged songs become "maybe"; the BSS strong-negative is the weakest maybe; positively-flagged and unflagged songs pass on music.',
    levers: ['Per-comment leans only'],
    gates: () => ({
      0:  { gate: 'pass' },                                  // Gashina — no note
      2:  { gate: 'pass' },                                  // Maria — no note
      4:  { gate: 'pass' },                                  // Any song — no note
      5:  { gate: 'pass', fitScore: 86, why: 'Comment "fit bonus" — named LOONA, lesser-known. Positive lean.' },
      11: { gate: 'pass' },                                  // 100 Ways — no note (8+)
      12: { gate: 'pass', fitScore: 86, why: 'Comment "fit bonus" — collab, all three groups named. Positive lean.' },
      13: { gate: 'pass', fitScore: 74, why: 'Comment: obscure bonus vs. "knocked down for not explaining" — the admin mused they cancel out. Neutral pass.' },
      14: { gate: 'pass' },                                  // Fever — no note
      16: { gate: 'pass', fitScore: 88, why: 'Comment "fit bonus… Nice!" — UNIQ/X1, admin forgot he was in a group. Strong positive lean. (Music corrected 10→76.)' },
      6:  { gate: 'maybe', fitScore: 66, why: 'Comment "maybe fit bonus, might take it away because they didn\'t comment which group." Best music among the maybes.' },
      3:  { gate: 'maybe', fitScore: 60, why: 'Comment "slight negative fit" (TAEMIN, very well known).' },
      1:  { gate: 'maybe', fitScore: 56, why: 'Comment "slight negative fit" (TAEYANG / BIGBANG).' },
      9:  { gate: 'maybe', fitScore: 50, why: 'Comment "possible negative fit bonus" (Jung Kook / BTS).' },
      15: { gate: 'maybe', fitScore: 48, why: 'Comment "slight negative fit — doubt anyone\'s heard of him as a soloist independent of NCT."' },
      7:  { gate: 'maybe', fitScore: 44, why: 'Comment "negative fit bonus — it\'s in the title because he isn\'t known as a soloist; would fit the opposite prompt."' },
      17: { gate: 'maybe', fitScore: 30, why: 'Comment "strong negative fit — subunits clearly weren\'t the intent." Weakest maybe.' },
    }),
  },
  {
    id: 'v4-full-enforcement',
    name: 'V4 · Full consistent enforcement',
    blurb: 'Applies ALL three leans uniformly by objective signal, not just where the admin happened to comment. Fail = broke the prompt (SHINee group track, BSS subunit). Pass = named the group AND lesser-known ("did it right"). Everyone else = maybe (too popular, or no submitter note, or anti-prompt), ranked by defensibility.',
    levers: ['too-popular → maybe', 'no submitter note → maybe', 'anti-prompt → maybe', 'named group + lesser-known → pass', 'rule-breakers → fail'],
    gates: () => ({
      // clean passes: named their group AND lesser-known / on-prompt
      5:  { gate: 'pass', fitScore: 90, why: 'Named LOONA, lesser-known soloist — exactly the round\'s intent.' },
      16: { gate: 'pass', fitScore: 88, why: 'Named UNIQ/X1, obscure — exactly the intent. (Music corrected 10→76.)' },
      12: { gate: 'pass', fitScore: 84, why: 'Collab naming all three groups; members not obvious as soloists.' },
      // maybes ordered by defensibility (named group + better music rank higher)
      11: { gate: 'maybe', fitScore: 70, why: 'Named GOT7 but Jackson is mega-popular; best music in the field (80), so most defensible maybe.' },
      13: { gate: 'maybe', fitScore: 66, why: 'Lesser-known (positive) but left no submitter note (negative) — nets to a defensible maybe.' },
      1:  { gate: 'maybe', fitScore: 60, why: 'Named BIGBANG (positive) but mega-popular (negative).' },
      4:  { gate: 'maybe', fitScore: 58, why: 'Named Block B (positive) but a popular soloist (negative).' },
      2:  { gate: 'maybe', fitScore: 52, why: 'Left a note but never named MAMAMOO; popular.' },
      3:  { gate: 'maybe', fitScore: 48, why: 'No submitter note + mega-popular (TAEMIN / SHINee).' },
      9:  { gate: 'maybe', fitScore: 46, why: 'Mega-popular (Jung Kook / BTS); named the group.' },
      6:  { gate: 'maybe', fitScore: 44, why: 'No submitter note; popular (Jay Park / 2PM).' },
      14: { gate: 'maybe', fitScore: 40, why: 'No submitter note; well-known (TVXQ).' },
      0:  { gate: 'maybe', fitScore: 38, why: 'No submitter note; popular (SUNMI / Wonder Girls).' },
      7:  { gate: 'maybe', fitScore: 32, why: 'No note + anti-prompt (known only as a Stray Kids member).' },
      15: { gate: 'maybe', fitScore: 30, why: 'No note + anti-prompt (not known as a soloist apart from NCT).' },
      // rule-breakers
      17: { gate: 'fail', why: 'BSS is a SEVENTEEN subunit, not a soloist.' },
    }),
  },
  {
    id: 'v5-fit-weighted',
    name: 'V5 · Fit-weighted (combined 50/50)',
    blurb: 'Not a gate — the existing thematic combined system. The admin\'s per-song fit notes are converted into standard fit tiers, then combinedScore = 0.5·fit + 0.5·music ranks the field. Positive notes ("fit bonus") lift a song; "slight/strong negative" notes drag it down; the SHINee group track is still DQ. Leans apply smoothly instead of bucketing into pass/maybe/fail.',
    levers: ['notes → fit tiers', 'combined 0.5 fit / 0.5 music'],
    scale: THEMATIC_SCALE,
    profile: { rankBy: 'combined', gate: { type: 'passFailMaybe' }, weights: { fit: 0.5, music: 0.5 } },
    gates: () => ({
      0:  { fitTier: 'solid',    why: 'No fit note — neutral.' },
      1:  { fitTier: 'moderate', why: '"slight negative fit" (TAEYANG / BIGBANG, mega-popular).' },
      2:  { fitTier: 'solid',    why: 'No fit note — neutral.' },
      3:  { fitTier: 'moderate', why: '"slight negative fit" (TAEMIN, very well known).' },
      4:  { fitTier: 'solid',    why: 'No fit note — neutral.' },
      5:  { fitTier: 'strong',   why: '"fit bonus" — named LOONA, lesser-known.' },
      6:  { fitTier: 'solid',    why: '"maybe fit bonus" but no group named — nets neutral.' },
      7:  { fitTier: 'weak',     why: '"negative fit" — known only as a Stray Kids member (anti-prompt).' },
      9:  { fitTier: 'moderate', why: '"possible negative fit" (Jung Kook / BTS, mega-popular).' },
      11: { fitTier: 'solid',    why: 'No fit note (just "8+" music) — neutral.' },
      12: { fitTier: 'strong',   why: '"fit bonus" — collab naming all three groups.' },
      13: { fitTier: 'solid',    why: 'Obscure bonus vs. "knocked down for not explaining" — nets neutral.' },
      14: { fitTier: 'solid',    why: 'No fit note — neutral.' },
      15: { fitTier: 'moderate', why: '"slight negative fit — not known as a soloist apart from NCT."' },
      16: { fitTier: 'strong',   why: '"fit bonus… Nice!" — UNIQ/X1, obscure. (Music corrected 10→76.)' },
      17: { fitTier: 'weak',     why: '"strong negative fit" — a SEVENTEEN subunit, not a soloist.' },
    }),
  },
  {
    // The owner's locked choice: V3 maybe-tags, SHINee + BSS out, a slight
    // popularity ding on Jackson/Maria/Gashina, then ZICO<->HWASA swapped (ZICO
    // popular -> 0, Maria liked better -> 1). Curve is hand-pinned 3x2 / 4x1.
    id: 'FINAL',
    name: 'FINAL · locked curve',
    blurb: 'Locked allocation. Clear on-prompt passes take the 2s; mid passes take the 1s. Too-popular and anti-prompt entries (and the dinged Jackson aside, who still leads on an 80) sit at 0.',
    levers: ['V3 maybe tags', 'SHINee + BSS out', 'popularity ding: Jackson/Maria/Gashina', 'ZICO->0, HWASA->1'],
    profile: {
      rankBy: 'music',
      gate: { type: 'passFailMaybe' },
      // Pins fully spend the bank (2x2 + 6x1 = 10); everyone else is 0.
      overrides: { 16: 2, 5: 2, 11: 1, 6: 1, 14: 1, 13: 1, 12: 1, 2: 1 },
    },
    gates: () => ({
      16: { gate: 'pass', why: 'WOODZ/UNIQ — on-prompt (obscure, named the group). A 2. (Music corrected 10->76.)' },
      5:  { gate: 'pass', why: 'Yves/LOONA — on-prompt (lesser-known, named the group). A 2.' },
      11: { gate: 'pass', why: 'Best music (80) but a popularity ding (GOT7); gave one point to MOMMAE, so a 1.' },
      6:  { gate: 'pass', fitScore: 85, why: 'MOMMAE/Jay Park — counted as a fit bonus (not a negative); liked it. A 1.' },
      14: { gate: 'pass', why: 'Fever — clean mid pass. A 1.' },
      13: { gate: 'pass', why: 'YENA — lesser-known (positive). A 1.' },
      12: { gate: 'pass', why: 'NOBODY — on-prompt collab, all groups named. A 1.' },
      2:  { gate: 'pass', why: 'HWASA/Maria — slight popularity ding, but kept over ZICO (liked better). A 1.' },
      0:  { gate: 'maybe', why: 'Gashina/SUNMI — popularity ding + no submitter note. Drops to 0.' },
      4:  { gate: 'maybe', why: 'ZICO — popular; swapped below HWASA. Drops to 0.' },
      3:  { gate: 'maybe', why: 'TAEMIN — slight negative (very popular). 0.' },
      9:  { gate: 'maybe', why: 'Jung Kook — negative (BTS, mega-popular). 0.' },
      1:  { gate: 'maybe', why: 'TAEYANG — slight negative (BIGBANG). 0.' },
      7:  { gate: 'maybe', why: 'can\'t love / HAN — anti-prompt (known only as a group member). 0.' },
      15: { gate: 'maybe', why: 'JAEHYUN — anti-prompt (not known as a soloist apart from NCT). 0.' },
      17: { gate: 'fail', why: 'BSS — a SEVENTEEN subunit, not a soloist. Out.' },
    }),
  },
];

function baseFitData(version) {
  const gates = version.gates();
  const scale = version.scale ?? FIT_SCALE;
  const combined = version.profile?.rankBy === 'combined';
  const songs = [];
  // SHINee is a DQ group track in every version (already isDisqualified).
  songs.push({
    rawOrderIndex: SHINEE,
    title: 'Poet | Artist',
    artist: 'SHINee',
    fitTier: combined ? 'nope' : 'fail',
    gate: 'fail',
    fitScore: scale.nope?.fitScore ?? 10,
    rationale: 'A SHINee group title track, not a solo release — breaks the prompt outright. Zero in every version.',
  });
  for (const [idxStr, info] of Object.entries(INFO)) {
    const idx = Number(idxStr);
    const g = gates[idx];
    if (!g) continue;
    // Two entry shapes: gate-style ({gate}) for the pass/maybe/fail strategies,
    // tier-style ({fitTier}) for the fit-weighted combined strategy.
    const song = {
      rawOrderIndex: idx,
      artist: info.artist,
      group: info.group,
      rationale: g.why ?? `${info.artist} — from ${info.group}. Valid soloist; voted on music.`,
    };
    if (g.gate) {
      song.fitTier = g.gate;
      song.gate = g.gate;
      song.fitScore = g.fitScore ?? FIT_SCALE[g.gate].fitScore;
    } else {
      song.fitTier = g.fitTier;
      song.fitScore = g.fitScore ?? scale[g.fitTier].fitScore;
    }
    songs.push(song);
  }
  songs.sort((a, b) => a.rawOrderIndex - b.rawOrderIndex);
  const method = combined
    ? `Fit-weighted round using the existing thematic combined system. ${version.blurb} combinedScore = ${version.profile.weights.fit} × fit + ${version.profile.weights.music} × music; the field is ranked and tiered on that blend, capped at ${CAP}/song. Allocation is the deterministic allocator in score-core.mjs.`
    : `Music-only round with chat-clarified fit leans modeled as a pass / maybe / fail gate. ${version.blurb} Passes are tiered by music (capped at ${CAP}/song for a non-top-heavy curve); the "maybe" band sits below the passes, funded only with spare points, ordered by defensibility (fitScore). Allocation is the deterministic allocator in score-core.mjs.`;
  return {
    round: {
      title: 'Music League | Kpop songs! | a song made by an artist that was or still is in a group',
      league: 'Kpop songs!',
      prompt: 'a song made by an artist that was or still is in a group',
      description: 'Chat clarification: subunits and collabs are fine; intent was lesser-known soloists and naming the larger group. The original description was vague and most submissions ignored both points.',
    },
    enforcement: { id: version.id, name: version.name, blurb: version.blurb, levers: version.levers },
    method,
    rankBy: version.profile?.rankBy ?? 'music',
    fitScale: scale,
    songs,
  };
}

function applyCorrections(songs) {
  // Drop comment-derived fit so each version's explicit gate is authoritative.
  clearManualFit(songs);
  const woodz = songs.find((s) => s.rawOrderIndex === 16);
  if (woodz) {
    woodz.score = 76; // comment "76 fit bonus" misread as a fit token; intended music score
  }
}

async function main() {
  const html = await readFile(ROUND_HTML, 'utf8');
  const parsedBase = loadParsedFromHtml(html, 'objective');
  const roundDir = roundAnalysisDir(ROUND_ID);
  const verDir = versionsDir(ROUND_ID);
  await mkdir(roundDir, { recursive: true });
  await mkdir(verDir, { recursive: true });

  const identity = new Map(
    parsedBase.songs.map((s) => [s.rawOrderIndex, { title: s.title, artist: s.artist }])
  );

  const summary = [];
  for (const version of VERSIONS) {
    const parsed = JSON.parse(JSON.stringify(parsedBase));
    applyCorrections(parsed.songs);
    parsed.budget.maxUpvotesPerSong = CAP;
    const fitData = baseFitData(version);
    for (const s of fitData.songs) {
      const id = identity.get(s.rawOrderIndex);
      if (id) {
        s.title = id.title;
        s.artist = id.artist;
      }
    }
    const profile = version.profile ?? { rankBy: 'music', gate: { type: 'passFailMaybe' } };
    const { tradeoffs } = mergeFitJson(parsed, fitData, { shape: 'auto', ...profile });

    const isOfficial = version.id === 'FINAL';
    const jsonPath = isOfficial
      ? scoresPaths(ROUND_ID).json
      : join(verDir, `${version.id}.json`);
    await writeFile(jsonPath, JSON.stringify(fitData, null, 2), 'utf8');

    const htmlPath = isOfficial
      ? scoresPaths(ROUND_ID).html
      : join(verDir, `${version.id}.html`);
    await render(jsonPath, htmlPath, 'raw');

    const total = fitData.songs.reduce((a, s) => a + (s.draftVotes || 0), 0);
    const rows = fitData.songs
      .filter((s) => (s.draftVotes || 0) > 0)
      .sort((a, b) => (b.draftVotes || 0) - (a.draftVotes || 0) || (b.musicScore || 0) - (a.musicScore || 0))
      .map((s) => `${s.draftVotes}  ${s.artist} (${s.group ?? ''}) m=${s.musicScore} c=${s.combinedScore ?? '-'} [${s.gate ?? s.fitTier}]`);
    summary.push({
      version: version.name,
      official: isOfficial,
      total,
      tradeoffs: tradeoffs.map((t) => t.question),
      awarded: rows,
      jsonPath,
      htmlPath,
    });
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
