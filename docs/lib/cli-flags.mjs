// Pure CLI flag validators for parse / merge / pick stages.

import { normalizeDownShape } from './score/allocate.mjs';

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
// `<rawOrderIndex>:<score>` where <score> may carry a modifier suffix: `+` / `-` nudge
// a tie, `?` marks uncertainty, and `+?` / `-?` combine them (e.g. `5:74.5+`, `7:75?`,
// `9:76-`). A bare number clears any modifier. Returns a list of
// `{ idx, score, plus, minus, uncertain, plusUncertain, minusUncertain }`.
export function parseScoreOverrides(specs, flag = '--score') {
  const list = (Array.isArray(specs) ? specs : [specs]).filter(Boolean);
  if (!list.length) return undefined;
  const out = [];
  for (const chunk of list) {
    for (const pair of String(chunk).split(',')) {
      if (!pair.trim()) continue;
      const ci = pair.indexOf(':');
      if (ci < 0) {
        throw new Error(`Invalid ${flag} "${pair}" (use <rawOrderIndex>:<score>, e.g. 5:74.5+)`);
      }
      const idx = Number(pair.slice(0, ci).trim());
      const valRaw = pair.slice(ci + 1).trim();
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error(`Invalid ${flag} "${pair}" — rawOrderIndex must be a non-negative integer.`);
      }
      const m = valRaw.match(/^(\d+(?:\.\d+)?)([+\-?]*)$/);
      if (!m) {
        throw new Error(
          `Invalid ${flag} "${pair}" — use <score> optionally with +, -, or ? (e.g. 74.5+, 75?, 76-).`
        );
      }
      const score = Number(m[1]);
      const mods = m[2] || '';
      const plus = mods.includes('+');
      const minus = mods.includes('-');
      const q = mods.includes('?');
      if (plus && minus) {
        throw new Error(`Invalid ${flag} "${pair}" — a score can't be both + and -.`);
      }
      out.push({
        idx,
        score,
        plus,
        minus,
        uncertain: q && !plus && !minus,
        plusUncertain: q && plus,
        minusUncertain: q && minus,
      });
    }
  }
  return out.length ? out : undefined;
}

export function parseFavoriteBand(spec) {
  if (spec === false) return false;
  if (spec == null || spec === '') return undefined;
  const n = Number(spec);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid --favorite-band "${spec}" (use a score floor, e.g. 80, or --no-favorite-band)`);
  }
  return { min: n };
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

export function buildGate(args) {
  if (args.cutoff) {
    const [rawAxis, min] = args.cutoff.split(':');
    const axis = rawAxis || 'fit';
    if (!CUTOFF_AXES.includes(axis)) {
      throw new Error(
        `Invalid --cutoff axis "${axis}" (use ${CUTOFF_AXES.join(', ')}, e.g. fit:70, music:65, or combined:76)`
      );
    }
    const value = Number(min);
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid --cutoff "${args.cutoff}" (use <axis>:<min>, e.g. fit:70)`);
    }
    return { type: 'cutoff', axis, min: value };
  }
  if (args.gate === 'passFail' || args.gate === 'passFailMaybe') return { type: args.gate };
  return undefined;
}
