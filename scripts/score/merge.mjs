// Fit + music merge and combined-score normalization.

import { FIT_TIER_ORDER, DEFAULT_COMBINED_WEIGHTS, fitTierForScore, GATE_WORD_SET } from './fit-signal.mjs';

// The weighted music+fit blend for a song (null when neither axis exists).
export function combinedScore(s, weights = DEFAULT_COMBINED_WEIGHTS) {
  if (s.fitScore == null && s.score == null) return null;
  if (s.fitScore == null) return s.score;
  if (s.score == null) return s.fitScore;
  return weights.fit * s.fitScore + weights.music * s.score;
}
export const normTitle = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
// A `+`/`-` modifier folded into the numeric music value *before* normalizing, so
// in a tight round (small music std) it becomes a real fraction of a std — and in a
// wide round it stays negligible. Kept below 0.5 so `74+` never collides with a
// real `74.5`.
const MODIFIER_MUSIC_DELTA = 0.34;
// Std floors per the asymmetric-trust design above.
const MUSIC_STD_FLOOR = 2;
const FIT_STD_FLOOR = 14;
// Display remap: average contender → COMBINED_DISPLAY_CENTER (75, the "actively
// like" anchor), and 1 blended std → COMBINED_DISPLAY_SD points, so a clearly
// above-average song lands near/over the 80 favorite anchor. This keeps the
// allocator's gap/75-80-anchor/favorite-band machinery valid unchanged.
const COMBINED_DISPLAY_CENTER = 75;
const COMBINED_DISPLAY_SD = 10;
// Below this many contenders a per-round mean/std is noise; fall back to fixed
// reference anchors (still floored) so a tiny field gets stable, dampened blending
// rather than a curve fit to 2–3 points.
const MIN_NORM_CONTENDERS = 4;
const FIT_REF_MEAN = 72; // ~solid tier
const MUSIC_REF_MEAN = 73;

// Music score with the +/- modifier folded in (combined-mode ranking/tiering only;
// music-only rounds keep +/- as pure tiebreaks). Null when there is no music score.
export function effectiveMusic(s) {
  if (s.score == null) return null;
  let v = s.score;
  if (s.plus) v += MODIFIER_MUSIC_DELTA;
  if (s.minus) v -= MODIFIER_MUSIC_DELTA;
  return v;
}
function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stddev(xs, mu) {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / xs.length);
}

// A contender = a song eligible to earn points, whose scores should shape the
// curve. Mirrors the allocator's exclusions: DQ'd (`-`) and blank songs are out,
// and the gate's terrible-fit/fail outliers are out (a fit cutoff is the fit-side
// analogue of the owner's `-` music DQ — it removes the bad ones so the std
// represents variation among the real contenders).
function isContender(s, gate) {
  if (s.isDisqualified || s.needsUserInput) return false;
  if (!gate) return true;
  if (gate.type === 'cutoff') {
    const v = gate.axis === 'fit' ? s.fitScore : s.score;
    return v != null && v >= gate.min;
  }
  const g = s.gate || (GATE_WORD_SET.has(String(s.fitTier || '').toLowerCase()) ? String(s.fitTier).toLowerCase() : null);
  return g !== 'fail';
}

/** manual = owner-typed fit scores; llm = fit.json / tier-word rounds. */
export function resolveFitTrust(songs) {
  return songs.some((s) => s.fitSource === 'manual' && s.fitScore != null) ? 'manual' : 'llm';
}

// Set `combinedScore` on every song to the normalized, remapped blend. Songs with
// only one axis fall back to that axis's raw score (kept clean for display).
export function normalizeCombined(
  songs,
  weights = DEFAULT_COMBINED_WEIGHTS,
  gate = null,
  { fitTrust = 'llm' } = {}
) {
  const contenders = songs.filter((s) => isContender(s, gate));
  const fitVals = contenders.map((s) => s.fitScore).filter((v) => v != null);
  const musicVals = contenders.map((s) => effectiveMusic(s)).filter((v) => v != null);
  const smallN = contenders.length < MIN_NORM_CONTENDERS;

  const fitMean = smallN || !fitVals.length ? FIT_REF_MEAN : mean(fitVals);
  const musicMean = smallN || !musicVals.length ? MUSIC_REF_MEAN : mean(musicVals);
  const fitFloor = fitTrust === 'manual' ? MUSIC_STD_FLOOR : FIT_STD_FLOOR;
  const fitDenom = Math.max(fitFloor, smallN || !fitVals.length ? 0 : stddev(fitVals, fitMean));
  const musicDenom = Math.max(MUSIC_STD_FLOOR, smallN || !musicVals.length ? 0 : stddev(musicVals, musicMean));

  for (const s of songs) {
    const fit = s.fitScore;
    const music = effectiveMusic(s);
    // fitNorm / musicNorm are each axis z-scored over the contenders and remapped
    // onto the SAME 75-centered display scale as combinedScore. Because the weights
    // sum to 1, combinedScore === w.fit·fitNorm + w.music·musicNorm exactly — so
    // these two numbers explain every jump (a low-fit / high-music song shows a low
    // fitNorm and a high musicNorm). Null when that axis is absent.
    s.fitNorm = null;
    s.musicNorm = null;
    if (fit == null && music == null) {
      s.combinedScore = null;
    } else if (fit == null) {
      s.combinedScore = s.score; // music-only: clean raw score (no modifier delta)
    } else if (music == null) {
      s.combinedScore = fit;
    } else {
      const zFit = (fit - fitMean) / fitDenom;
      const zMusic = (music - musicMean) / musicDenom;
      s.fitNorm = COMBINED_DISPLAY_CENTER + zFit * COMBINED_DISPLAY_SD;
      s.musicNorm = COMBINED_DISPLAY_CENTER + zMusic * COMBINED_DISPLAY_SD;
      const blend = weights.fit * zFit + weights.music * zMusic;
      s.combinedScore = COMBINED_DISPLAY_CENTER + blend * COMBINED_DISPLAY_SD;
    }
  }
  return songs;
}
// Merge an LLM fit JSON's songs into the parsed round songs, joining by
// rawOrderIndex (then title). Manual fit signals win; the LLM fills only
// fit-silent songs. Context fields (themes/rationale/…) are carried for
// rendering but never override scoring. Sets combinedScore on every song.
export function mergeFit(songs, fitSongs, { weights = DEFAULT_COMBINED_WEIGHTS, gate = null } = {}) {
  const byIndex = new Map();
  const byTitle = new Map();
  for (const f of fitSongs || []) {
    if (f.rawOrderIndex != null) byIndex.set(f.rawOrderIndex, f);
    if (f.title) byTitle.set(normTitle(f.title), f);
  }
  for (const s of songs) {
    const f = byIndex.get(s.rawOrderIndex) ?? byTitle.get(normTitle(s.title));
    if (f) {
      const hasManualFit = s.fitSource === 'manual' && (s.fitScore != null || s.gate != null);
      if (!hasManualFit) {
        const tierWord = String(f.fitTier || '').toLowerCase();
        if (f.fitScore != null) s.fitScore = f.fitScore;
        if (f.fitTier != null && !GATE_WORD_SET.has(tierWord)) s.fitTier = f.fitTier;
        const gate = f.gate ?? (GATE_WORD_SET.has(tierWord) ? tierWord : null);
        if (gate) s.gate = gate;
        if (s.fitScore != null && s.fitTier == null) s.fitTier = fitTierForScore(s.fitScore);
        if (s.fitScore != null || s.gate != null) s.fitSource = 'llm';
      }
      for (const k of ['themesHit', 'rationale', 'confidence', 'flags', 'basis', 'submitterAssist']) {
        if (f[k] != null && s[k] == null) s[k] = f[k];
      }
    }
  }
  // Combined scores are a per-round normalization, so they must be set in one pass
  // over the whole field (not song-by-song) once fit is merged in.
  const fitTrust = resolveFitTrust(songs, gate);
  normalizeCombined(songs, weights, gate, { fitTrust });
  flagMusicLifts(songs);
  return { songs, fitTrust };
}
// Flag songs whose combined rank sits ABOVE a song with a strictly better fit
// tier — i.e. music (not fit) carried them past it. This is surfaced as a
// "music-lifted" callout rather than silently reordering: the user can promote or
// adjust by hand. Names the best-fit song that was leapfrogged. Sets `s.musicLift`
// to `{ overTitle, overTier }` or `null`.
export function flagMusicLifts(songs) {
  for (const s of songs) s.musicLift = null;
  const tierIdx = (t) => {
    const i = FIT_TIER_ORDER.indexOf(String(t || '').toLowerCase());
    return i === -1 ? FIT_TIER_ORDER.length : i; // smaller = better fit
  };
  const ranked = songs
    .filter((s) => s.combinedScore != null && s.fitTier && !s.isDisqualified)
    .sort((a, b) => b.combinedScore - a.combinedScore);
  for (let i = 0; i < ranked.length; i++) {
    const x = ranked[i];
    const xi = tierIdx(x.fitTier);
    let best = null;
    for (let j = i + 1; j < ranked.length; j++) {
      const y = ranked[j];
      const yi = tierIdx(y.fitTier);
      if (yi >= xi) continue; // y is not a better fit tier
      if (
        best == null ||
        yi < tierIdx(best.fitTier) ||
        (yi === tierIdx(best.fitTier) && (y.fitScore ?? 0) > (best.fitScore ?? 0))
      ) {
        best = y;
      }
    }
    if (best) x.musicLift = { overTitle: best.title, overTier: best.fitTier };
  }
  return songs;
}
