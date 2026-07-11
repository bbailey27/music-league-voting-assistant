// Pure CLI flag validators for parse / merge / pick stages.

import { normalizeDownShape } from '../score/allocate.mjs';

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

export function buildGate(args) {
  if (args.cutoff) {
    const [axis, min] = args.cutoff.split(':');
    return { type: 'cutoff', axis: axis || 'fit', min: Number(min) };
  }
  if (args.gate === 'passFail' || args.gate === 'passFailMaybe') return { type: args.gate };
  return undefined;
}
