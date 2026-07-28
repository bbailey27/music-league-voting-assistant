// Shared pick-stage logic: option resolution, pin reconciliation, training log.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildPickRecord, OPTION_LETTERS } from '../score-core.mjs';
import { pickUsageError } from '../cli-commands.mjs';
import { scoresPaths } from '../paths.mjs';

const TRADEOFF_OPTION_LETTERS = OPTION_LETTERS;

function resolveOptionIndex(spec, count) {
  if (!count) return null;
  const s = String(spec).trim();
  let idx = null;
  if (/^[A-Za-z]$/.test(s)) idx = s.toUpperCase().charCodeAt(0) - 65;
  else if (/^\d+$/.test(s)) idx = Number(s) - 1;
  return idx != null && idx >= 0 && idx < count ? idx : null;
}

/** Strip pin overrides so the tier-structure menu is built unpinned first. */
export function menuProfile(profile) {
  return { ...profile, overrides: undefined, downOverrides: undefined };
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
    for (const i of order) {
      if (pinned.has(i)) continue;
      const cur = votes.get(i) || 0;
      if (cur !== 0 || cur >= cap) continue;
      votes.set(i, 1);
      delta++;
      moved = true;
      break;
    }
    if (moved) continue;
    const unfunded = order.filter(
      (i) => !pinned.has(i) && (votes.get(i) || 0) > 0 && (votes.get(i) || 0) < cap
    );
    if (!unfunded.length) break;
    const vMin = Math.min(...unfunded.map((i) => votes.get(i) || 0));
    for (const i of order) {
      if (pinned.has(i)) continue;
      const cur = votes.get(i) || 0;
      if (cur !== vMin || cur >= cap) continue;
      votes.set(i, cur + 1);
      delta++;
      moved = true;
      break;
    }
    if (!moved) break;
  }

  return Object.fromEntries(order.map((i) => [i, votes.get(i) || 0]));
}

/** Down-menu reflow: shed surplus from best-ranked funded, promote worst unfunded first. */
export function reconcileDownOptionPins(perSong, pins, cap = Infinity) {
  return reconcileOptionPins([...(perSong || [])].reverse(), pins, cap);
}

function voteKeyFromPerSong(perSong) {
  const runs = [];
  for (const p of perSong || []) {
    const lvl = p.votes || 0;
    const last = runs[runs.length - 1];
    if (last && last.level === lvl) last.count++;
    else runs.push({ level: lvl, count: 1 });
  }
  return runs.map((r) => `${r.count}:${r.level}`).join('|');
}

export function summarizeVoteShape(perSong) {
  const runs = [];
  for (const p of perSong || []) {
    const lvl = p.votes || 0;
    const last = runs[runs.length - 1];
    if (last && last.level === lvl) last.count++;
    else runs.push({ level: lvl, count: 1 });
  }
  return runs.map((r) => `${r.level}×${r.count}`).join(' / ');
}

function patchLabelShape(label, shape) {
  if (!label) return shape;
  const sep = ' — ';
  const idx = label.indexOf(sep);
  if (idx < 0) return label;
  const prefix = label.slice(0, idx + sep.length);
  const suffix = label.slice(idx + sep.length);
  const noteIdx = suffix.indexOf(' · ');
  const notes = noteIdx >= 0 ? suffix.slice(noteIdx) : '';
  return prefix + shape + notes;
}

function applyReconciledVotes(perSong, reconciled) {
  const byIdx = new Map((perSong || []).map((p) => [p.rawOrderIndex, p]));
  const order = (perSong || []).map((p) => p.rawOrderIndex);
  for (const k of Object.keys(reconciled || {})) {
    const i = Number(k);
    if (!order.includes(i)) order.push(i);
  }
  return order.map((i) => {
    const base = byIdx.get(i) || { rawOrderIndex: i, title: null, score: null };
    return { ...base, votes: reconciled[i] ?? 0 };
  });
}

function reflowMenuOption(opt, reconciled, budget) {
  const total = Object.values(reconciled).reduce((a, v) => a + v, 0);
  const perSong = applyReconciledVotes(opt.perSong, reconciled);
  const shape = summarizeVoteShape(perSong);
  return {
    ...opt,
    perSong,
    shape,
    label: patchLabelShape(opt.label, shape),
    _budgetMismatch: total !== budget,
  };
}

/**
 * Reflow up/down pins across every option column in tier-structure / down-structure
 * tradeoffs. Returns notes (deduped options, budget warnings).
 */
export function applyPinsToMenuTradeoffs(tradeoffs, { overrides, downOverrides, upCap, downCap } = {}) {
  const notes = [];
  const upPins = overrides && Object.keys(overrides).length ? overrides : null;
  const downPins = downOverrides && Object.keys(downOverrides).length ? downOverrides : null;
  if (!upPins && !downPins) return notes;

  for (const t of tradeoffs || []) {
    if (t.kind === 'tier-structure' && upPins) {
      const before = t.options?.length ?? 0;
      const reflowed = (t.options || []).map((opt) => {
        const budget = (opt.perSong || []).reduce((a, p) => a + (p.votes || 0), 0);
        const reconciled = reconcileOptionPins(opt.perSong, upPins, upCap ?? Infinity);
        const next = reflowMenuOption(opt, reconciled, budget);
        if (next._budgetMismatch) {
          notes.push(`Option "${next.shape}" could not fully reconcile up pins (budget ${budget}).`);
        }
        delete next._budgetMismatch;
        return next;
      });
      const seen = new Set();
      t.options = reflowed.filter((opt) => {
        const key = voteKeyFromPerSong(opt.perSong);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (t.options.length < before) {
        notes.push(`Pins merged ${before - t.options.length} identical up option(s).`);
      }
    }
    if (t.kind === 'down-structure' && downPins) {
      const before = t.options?.length ?? 0;
      const reflowed = (t.options || []).map((opt) => {
        const budget = (opt.perSong || []).reduce((a, p) => a + (p.votes || 0), 0);
        const reconciled = reconcileDownOptionPins(opt.perSong, downPins, downCap ?? Infinity);
        const next = reflowMenuOption(opt, reconciled, budget);
        if (next._budgetMismatch) {
          notes.push(`Down option "${next.shape}" could not fully reconcile down pins (budget ${budget}).`);
        }
        delete next._budgetMismatch;
        return next;
      });
      const seen = new Set();
      t.options = reflowed.filter((opt) => {
        const key = voteKeyFromPerSong(opt.perSong);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (t.options.length < before) {
        notes.push(`Pins merged ${before - t.options.length} identical down option(s).`);
      }
    }
  }
  return notes;
}

/** Set song draft votes from option A so the explore Ballot matches the pinned menu. */
export function syncBallotFromExploreMenu(tradeoffs, songs) {
  const up = (tradeoffs || []).find((t) => t.kind === 'tier-structure');
  const down = (tradeoffs || []).find((t) => t.kind === 'down-structure');
  const byIdx = new Map(songs.map((s) => [s.rawOrderIndex, s]));
  if (up?.options?.[0]?.perSong) {
    for (const p of up.options[0].perSong) {
      const s = byIdx.get(p.rawOrderIndex);
      if (s) s.finalVotes = p.votes || 0;
    }
  }
  if (down?.options?.[0]?.perSong) {
    for (const p of down.options[0].perSong) {
      const s = byIdx.get(p.rawOrderIndex);
      if (s) s.finalDownvotes = p.votes || 0;
    }
  }
}

export function resolveOptionPick(tradeoffs, optionSpec, baseOverrides = {}, cap = Infinity, roundId = null) {
  const ts = (tradeoffs || []).find((t) => t.kind === 'tier-structure');
  const presented = (ts?.options || []).filter((o) => Array.isArray(o.perSong) && o.perSong.length);
  const idx = resolveOptionIndex(optionSpec, presented.length);
  if (idx == null) {
    return {
      idx: null,
      presented,
      overrides: null,
      error: pickUsageError(
        roundId,
        optionSpec,
        presented.length,
        presented.map((_, i) => String.fromCharCode(65 + i))
      ),
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
  roundId = null,
}) {
  // Pin reconciliation diffs against the unpinned menu (`initialTradeoffs`). Callers
  // must not pass pin overrides into the merge/allocate that builds that menu — a
  // pinned pre-pass corrupts the option baseline and reflow targets the wrong songs.
  const { idx, presented, overrides, error } = resolveOptionPick(
    initialTradeoffs,
    optionSpec,
    baseOverrides,
    cap,
    roundId
  );
  if (error) {
    if (exitOnError) {
      console.error(error);
      process.exit(1);
    }
    return { error, tradeoffs: initialTradeoffs, pick: null, baseline: null };
  }
  // Clean baseline for the pin comparison: the chosen option's own up split with
  // the down shape allocated around it, and NO pins on either axis. Down eligibility
  // depends on the up split, so this must force the option's exact upvotes (not the
  // menu default) before capturing the baseline downvotes. Run it first, snapshot,
  // then reallocate with pins so `songs` ends in the applied (altered) state.
  const chosen = presented[idx];
  const optionOverrides = Object.fromEntries(
    (chosen?.perSong || []).map((p) => [p.rawOrderIndex, p.votes])
  );
  reallocate(optionOverrides, {});
  const baseline = new Map(
    songs.map((s) => [s.rawOrderIndex, { up: s.finalVotes || 0, down: s.finalDownvotes || 0 }])
  );

  const tradeoffs = reallocate(overrides, downOverrides);
  const pick = buildPickRecord({ options: presented, chosenIndex: idx, songs, reason, downOverrides });
  console.log(
    `Applied option ${pick.chosen} — ${pick.tierCount} tier${pick.tierCount === 1 ? '' : 's'}, ${pick.shape}.` +
      (pick.tweaks.length ? ` (${pick.tweaks.length} manual tweak${pick.tweaks.length === 1 ? '' : 's'})` : '') +
      (pick.reason ? ` Reason: ${pick.reason}` : '')
  );
  return { tradeoffs, pick, baseline };
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
