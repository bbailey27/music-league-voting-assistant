// Pure CLI flag validators for parse / merge / pick stages.

import { normalizeDownShape } from './score/allocate.mjs';
import { scaleScoreToken } from './score/comment.mjs';

export function parsePins(specs) {
  const list = (Array.isArray(specs) ? specs : [specs]).filter(Boolean);
  if (!list.length) return undefined;
  const overrides = {};
  const downOverrides = {};
  for (const chunk of list) {
    for (const pair of String(chunk).split(',')) {
      if (!pair.trim()) continue;
      const [idx, votes] = pair.split(':');
      const i = Number(idx);
      const v = Number(votes);
      if (!Number.isInteger(i) || i < 0 || !Number.isInteger(v)) {
        throw new Error(`Invalid --pin "${pair}" (use <rawOrderIndex>:<votes>, negative for downvotes, 0 to force no vote, e.g. 2:2, 6:-2, or 6:0)`);
      }
      // 0 pins the song to no vote on EITHER axis (excluded from up shaping and the
      // down pool) — the way to break a tie by removing one song's shape downvote.
      if (v === 0) {
        overrides[i] = 0;
        downOverrides[i] = 0;
      } else if (v < 0) {
        downOverrides[i] = -v;
      } else {
        overrides[i] = v;
      }
    }
  }
  const hasUp = Object.keys(overrides).length > 0;
  const hasDown = Object.keys(downOverrides).length > 0;
  if (!hasUp && !hasDown) return undefined;
  return { overrides: hasUp ? overrides : undefined, downOverrides: hasDown ? downOverrides : undefined };
}

export function pinCapError(overrides, downOverrides, upCap, downCap) {
  const check = (map, cap, label, sign) => {
    if (!map || !Number.isFinite(cap)) return null;
    for (const [i, v] of Object.entries(map)) {
      if (v > cap) {
        return (
          `Invalid --pin ${i}:${sign}${v} — exceeds max ${label} per song (${cap}). ` +
          `Lower the pin or check the round's per-song limit.`
        );
      }
    }
    return null;
  };
  return check(overrides, upCap, 'upvotes', '') || check(downOverrides, downCap, 'downvotes', '-');
}

/** Reject pins on songs that cannot receive allocation votes (own, unknown, DQ). */
export function pinEligibilityError(songs, overrides, downOverrides) {
  const byIdx = new Map((songs || []).map((s) => [s.rawOrderIndex, s]));
  const check = (map, sign) => {
    if (!map) return null;
    for (const [k, v] of Object.entries(map)) {
      const i = Number(k);
      const s = byIdx.get(i);
      const label = `#${i}${s?.title ? ` ${s.title}` : ''}`;
      if (!s) {
        return `Invalid --pin ${i}:${sign}${v} — ${label} is not in this round.`;
      }
      if (s.isOwn) {
        return `Invalid --pin ${i}:${sign}${v} — ${label} is your own submission (not votable).`;
      }
      if (s.isDisqualified) {
        return `Invalid --pin ${i}:${sign}${v} — ${label} is disqualified and cannot receive votes.`;
      }
    }
    return null;
  };
  return check(overrides, '') || check(downOverrides, '-');
}

function parseCountFlag(spec, flag) {
  if (spec == null || spec === '') return undefined;
  const n = Number(spec);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid ${flag} "${spec}" (use a positive integer, e.g. 3)`);
  }
  return n;
}

export function parseTierCount(spec) {
  return parseCountFlag(spec, '--tier-count');
}

export function parseBucketCount(spec) {
  return parseCountFlag(spec, '--bucket-count');
}

// How many options the point-split menu should surface (default 5). More options ask
// the allocator to backfill deeper with merge/jump and tie-split alternatives.
export function parseOptionCount(spec) {
  return parseCountFlag(spec, '--options');
}

// Manual raw-score overrides for `rescore --score` / `--fit-score`. Each spec is
// `<rawOrderIndex|title>:<score>` where the ref may be a rawOrderIndex or a title
// fragment (resolveSongRefs maps the fragment to the index after the round's
// songs are loaded). <score> may carry a modifier suffix: `+` / `-` nudge a tie,
// `?` marks uncertainty, `+?` / `-?` combine them, and `play` / `play?` nudge the
// playlist tiebreak — with or without a space ("76 play" ≡ "76play"). A bare `=`
// is read as `+` (typo), the same word. Returns a list of
// `{ idx, score, plus, minus, uncertain, plusUncertain, minusUncertain,
//    playlistAdd, playlistUncertain, disqualified }`.
export function parseScoreValue(valRaw, flag = '--score') {
  const raw = String(valRaw ?? '').trim();
  if (/^dq$/i.test(raw)) {
    return {
      score: null,
      plus: false,
      minus: false,
      uncertain: false,
      plusUncertain: false,
      minusUncertain: false,
      playlistAdd: false,
      playlistUncertain: false,
      disqualified: true,
    };
  }
  // Compact modifier spacing so "76 play" and "76play" parse identically.
  const m = raw.replace(/\s+/g, '').match(/^(\d+(?:\.\d+)?)([+\-=?]*)(play\??)?$/i);
  if (!m) {
    throw new Error(
      `Invalid ${flag} "${raw}" — use <score> with +, -, ?, or play (e.g. 74.5+, 75?, 76play?), or DQ.`
    );
  }
  const rawNum = m[1];
  const dotIdx = rawNum.indexOf('.');
  const intPart = dotIdx >= 0 ? rawNum.slice(0, dotIdx) : rawNum;
  const decPart = dotIdx >= 0 ? rawNum.slice(dotIdx) : '';
  const score = scaleScoreToken(intPart, decPart);
  const mods = m[2] || '';
  const playlist = /play/i.test(m[3] || '');
  const plus = mods.includes('+') || mods.includes('=');
  const minus = mods.includes('-');
  const q = mods.includes('?');
  if (plus && minus) {
    throw new Error(`Invalid ${flag} "${raw}" — a score can't be both + and -.`);
  }
  return {
    score,
    plus,
    minus,
    uncertain: q && !plus && !minus,
    plusUncertain: q && plus,
    minusUncertain: q && minus,
    // `?` may sit on the play modifier itself (76play?) rather than the mod run.
    playlistAdd: playlist,
    playlistUncertain: playlist && (q || /\?/.test(m[3] || '')),
    disqualified: false,
  };
}

export function parseScoreOverrides(specs, flag = '--score') {
  const list = (Array.isArray(specs) ? specs : [specs]).filter(Boolean);
  if (!list.length) return undefined;
  const out = [];
  for (const chunk of list) {
    for (const pair of String(chunk).split(',')) {
      if (!pair.trim()) continue;
      const ci = pair.indexOf(':');
      if (ci < 0) {
        throw new Error(`Invalid ${flag} "${pair}" (use <rawOrderIndex>:<score|DQ>, e.g. 5:74.5+ or 7:DQ)`);
      }
      const idx = Number(pair.slice(0, ci).trim());
      const valRaw = pair.slice(ci + 1).trim();
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error(`Invalid ${flag} "${pair}" — rawOrderIndex must be a non-negative integer.`);
      }
      out.push({ idx, ...parseScoreValue(valRaw, flag) });
    }
  }
  return out.length ? out : undefined;
}

export function parseFavoriteBand(spec) {
  if (spec === false) return false;
  if (spec == null || spec === '') return undefined;
  const value = parseScoreValue(spec, '--favorite-band');
  if (
    value.disqualified ||
    value.plus ||
    value.minus ||
    value.uncertain ||
    value.plusUncertain ||
    value.minusUncertain ||
    value.playlistAdd
  ) {
    throw new Error(`Invalid --favorite-band "${spec}" (use a plain score floor, e.g. 80, or --no-favorite-band)`);
  }
  if (value.score <= 0) {
    throw new Error(`Invalid --favorite-band "${spec}" (use a score floor, e.g. 80, or --no-favorite-band)`);
  }
  if (value.score > 100) {
    throw new Error(`Invalid --favorite-band "${spec}" — needs to be ≤ 100.`);
  }
  return { min: value.score };
}

export function parseDownShape(spec) {
  if (spec == null || spec === '') return undefined;
  const canon = normalizeDownShape(spec);
  if (!canon) {
    throw new Error(`Invalid --down-shape "${spec}" (use concentrated, flat, or curved)`);
  }
  return canon;
}

export function parseWeights(spec) {
  if (!spec) return undefined;
  const parts = String(spec).split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid --weights "${spec}" (use <fit>:<music>, e.g. 0.6:0.4)`);
  }
  const fit = Number(parts[0]);
  const music = Number(parts[1]);
  if (!Number.isFinite(fit) || !Number.isFinite(music) || fit < 0 || music < 0 || fit + music <= 0) {
    throw new Error(`Invalid --weights "${spec}" (use non-negative numbers, e.g. 0.6:0.4)`);
  }
  const total = fit + music;
  return { fit: fit / total, music: music / total };
}

export const CUTOFF_AXES = ['fit', 'music', 'combined'];

/** `--cutoff m:65` shorthand (full axis names always work; bare value = music). */
const CUTOFF_AXIS_ALIASES = { m: 'music', f: 'fit', c: 'combined' };

export function buildGate(args) {
  if (args.cutoff) {
    const raw = String(args.cutoff);
    const ci = raw.indexOf(':');
    // A bare value ("--cutoff 70") assumes the music axis (owner decision).
    const axisTok = (ci < 0 ? '' : raw.slice(0, ci)).trim().toLowerCase() || 'music';
    const minRaw = ci < 0 ? raw.trim() : raw.slice(ci + 1).trim();
    const axis = CUTOFF_AXIS_ALIASES[axisTok] ?? axisTok;
    if (!CUTOFF_AXES.includes(axis)) {
      throw new Error(
        `Invalid --cutoff axis "${axisTok}" (use fit | music | combined — shorts f | m | c; ` +
          `e.g. fit:70, music:65, combined:76; a bare value assumes music)`
      );
    }
    if (!minRaw) {
      throw new Error(`Invalid --cutoff "${raw}" (use <axis>:<min>, e.g. music:65)`);
    }
    const value = parseScoreValue(minRaw, '--cutoff');
    if (
      value.disqualified ||
      value.plus ||
      value.minus ||
      value.uncertain ||
      value.playlistAdd
    ) {
      throw new Error(
        `Invalid --cutoff "${raw}" — modifiers and DQ are score-override-only; use a plain score floor (e.g. music:65)`
      );
    }
    if (value.score > 100) {
      throw new Error(`Invalid --cutoff "${raw}" — needs to be ≤ 100.`);
    }
    return { type: 'cutoff', axis, min: value.score };
  }
  if (args.gate === 'passFail' || args.gate === 'passFailMaybe') return { type: args.gate };
  return undefined;
}

// ---------------------------------------------------------------------------
// Song references: `--score foxtrot:74` / `--pin "watch out":2`
// resolve a title fragment to a rawOrderIndex using the same fuzzy ladder the
// dispatcher uses for round names (exact → substring → subsequence,
// case-insensitive). All-numeric heads stay indices — a song titled "3:5" is
// addressed by its index, never by title.
// ---------------------------------------------------------------------------
function isSubsequenceRef(query, target) {
  let i = 0;
  for (let j = 0; j < target.length && i < query.length; j++) {
    if (target[j] === query[i]) i++;
  }
  return i === query.length;
}

function fuzzySongMatches(q, songs) {
  const needle = String(q).trim().toLowerCase();
  if (!needle) return [];
  const titled = songs.filter((s) => s.title != null);
  const exact = titled.filter((s) => s.title.toLowerCase() === needle);
  if (exact.length) return exact;
  const substr = titled.filter((s) => s.title.toLowerCase().includes(needle));
  if (substr.length) return substr;
  return titled.filter((s) => isSubsequenceRef(needle, s.title.toLowerCase()));
}

/** Resolve any title-fragment refs in pin / score-overrides spec strings. */
export function resolveSongRefs(specs, songs, flag = '--score') {
  const list = (Array.isArray(specs) ? specs : [specs]).filter(Boolean);
  if (!list.length || !songs || !songs.length) return specs;
  const out = [];
  for (const chunk of list) {
    const segments = String(chunk).split(',');
    const resolved = [];
    for (const seg of segments) {
      if (!seg.trim()) {
        resolved.push(seg);
        continue;
      }
      const ci = seg.indexOf(':');
      if (ci < 0 || /^\d+$/.test(seg.slice(0, ci).trim())) {
        resolved.push(seg);
        continue;
      }
      const matches = fuzzySongMatches(seg.slice(0, ci), songs);
      if (matches.length === 1) {
        resolved.push(`${matches[0].rawOrderIndex}${seg.slice(ci)}`);
      } else if (matches.length > 1) {
        const names = matches.map((s) => `#${s.rawOrderIndex} ${s.title}`).join(', ');
        throw new Error(`${flag} ref "${seg.slice(0, ci)}" matches multiple songs — be specific: ${names}`);
      } else {
        throw new Error(`${flag}: no song's title matches "${seg.slice(0, ci)}".`);
      }
    }
    out.push(resolved.join(','));
  }
  return out;
}
