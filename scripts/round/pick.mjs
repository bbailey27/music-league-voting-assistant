// Shared pick-stage logic: option resolution, pin reconciliation, training log.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildPickRecord } from '../score-core.mjs';
import { scoresPaths } from '../paths.mjs';

const TRADEOFF_OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function resolveOptionIndex(spec, count) {
  if (!count) return null;
  const s = String(spec).trim();
  let idx = null;
  if (/^[A-Za-z]$/.test(s)) idx = s.toUpperCase().charCodeAt(0) - 65;
  else if (/^\d+$/.test(s)) idx = Number(s) - 1;
  return idx != null && idx >= 0 && idx < count ? idx : null;
}

export function reconcileOptionPins(perSong, pins, cap = Infinity) {
  const order = perSong.map((p) => p.rawOrderIndex);
  const votes = new Map(perSong.map((p) => [p.rawOrderIndex, p.votes || 0]));
  const budget = perSong.reduce((a, p) => a + (p.votes || 0), 0);
  const pinned = new Set();
  for (const [k, v] of Object.entries(pins || {})) {
    if (!Number.isFinite(v)) continue;
    const i = Number(k);
    votes.set(i, v);
    pinned.add(i);
    if (!order.includes(i)) order.push(i);
  }
  const total = () => order.reduce((a, i) => a + (votes.get(i) || 0), 0);

  let delta = total() - budget;
  while (delta > 0) {
    let moved = false;
    for (let k = order.length - 1; k >= 0 && delta > 0; k--) {
      const i = order[k];
      if (pinned.has(i) || (votes.get(i) || 0) <= 0) continue;
      votes.set(i, votes.get(i) - 1);
      delta--;
      moved = true;
    }
    if (!moved) break;
  }

  delta = total() - budget;
  while (delta < 0) {
    let moved = false;
    for (const unfundedOnly of [true, false]) {
      for (let k = 0; k < order.length && delta < 0; k++) {
        const i = order[k];
        if (pinned.has(i)) continue;
        const cur = votes.get(i) || 0;
        if (unfundedOnly && cur !== 0) continue;
        if (cur >= cap) continue;
        votes.set(i, cur + 1);
        delta++;
        moved = true;
      }
      if (delta >= 0) break;
    }
    if (!moved) break;
  }

  return Object.fromEntries(order.map((i) => [i, votes.get(i) || 0]));
}

export function resolveOptionPick(tradeoffs, optionSpec, baseOverrides = {}, cap = Infinity) {
  const ts = (tradeoffs || []).find((t) => t.kind === 'tier-structure');
  const presented = (ts?.options || []).filter((o) => Array.isArray(o.perSong) && o.perSong.length);
  const idx = resolveOptionIndex(optionSpec, presented.length);
  if (idx == null) {
    return {
      idx: null,
      presented,
      overrides: null,
      error: `--option "${optionSpec}" is not available (this round has ${presented.length || 0} option(s): ${
        presented.map((_, i) => String.fromCharCode(65 + i)).join(', ') || 'none'
      }).`,
    };
  }
  const chosen = presented[idx];
  const overrides = reconcileOptionPins(chosen.perSong, baseOverrides || {}, cap);
  return { idx, presented, overrides, error: null };
}

export function applyOptionPick({
  optionSpec,
  reason,
  reallocate,
  initialTradeoffs,
  baseOverrides,
  downOverrides,
  songs,
  cap = Infinity,
  exitOnError = true,
}) {
  const hasPins = baseOverrides && Object.keys(baseOverrides).length > 0;
  const menuTradeoffs = hasPins ? reallocate(undefined) : initialTradeoffs;
  const { idx, presented, overrides, error } = resolveOptionPick(menuTradeoffs, optionSpec, baseOverrides, cap);
  if (error) {
    if (exitOnError) {
      console.error(error);
      process.exit(1);
    }
    return { error, tradeoffs: initialTradeoffs, pick: null };
  }
  const tradeoffs = reallocate(overrides);
  const pick = buildPickRecord({ options: presented, chosenIndex: idx, songs, reason, downOverrides });
  console.log(
    `Applied option ${pick.chosen} — ${pick.tierCount} tier${pick.tierCount === 1 ? '' : 's'}, ${pick.shape}.` +
      (pick.tweaks.length ? ` (${pick.tweaks.length} manual tweak${pick.tweaks.length === 1 ? '' : 's'})` : '') +
      (pick.reason ? ` Reason: ${pick.reason}` : '')
  );
  return { tradeoffs, pick };
}

export async function recordPickToTrainingLog(roundId, songs, pick) {
  const logPath = join(dirname(scoresPaths(roundId).dir), 'picks.jsonl');
  const entry = {
    round: roundId,
    pickedAt: pick.pickedAt,
    chosen: pick.chosen,
    tierCount: pick.tierCount,
    shape: pick.shape,
    reason: pick.reason,
    tweaks: pick.tweaks,
    options: pick.options.map((o) => ({
      letter: o.letter,
      tierCount: o.tierCount,
      bucketCount: o.bucketCount,
      shape: o.shape,
      isChosen: o.isChosen,
      votesByIndex: Object.fromEntries(o.perSong.map((s) => [s.rawOrderIndex, s.votes])),
    })),
    field: (songs || []).map((s) => ({
      rawOrderIndex: s.rawOrderIndex,
      title: s.title,
      artist: s.artist,
      fitScore: s.fitScore ?? null,
      fitTier: s.fitTier ?? null,
      musicScore: s.musicScore ?? s.score ?? null,
      combinedScore: s.combinedScore ?? null,
      draftVotes: s.draftVotes ?? s.finalVotes ?? 0,
    })),
  };
  let prior = [];
  try {
    prior = (await readFile(logPath, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .filter((l) => {
        try {
          return JSON.parse(l).round !== roundId;
        } catch {
          return true;
        }
      });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  await writeFile(logPath, `${[...prior, JSON.stringify(entry)].join('\n')}\n`, 'utf8');
  console.log(`Logged pick to ${logPath}`);
}

export { TRADEOFF_OPTION_LETTERS };
