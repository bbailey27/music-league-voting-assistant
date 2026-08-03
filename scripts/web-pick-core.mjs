// Browser-safe pick explore helpers (pin reflow, menu profile) — from round/pick.mjs.

export function menuProfile(profile) {
  return { ...profile, overrides: undefined, downOverrides: undefined };
}

export function cloneTradeoffs(tradeoffs) {
  return JSON.parse(JSON.stringify(tradeoffs));
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

function summarizeVoteShape(perSong) {
  const runs = [];
  for (const p of perSong || []) {
    const lvl = p.votes || 0;
    const last = runs[runs.length - 1];
    if (last && last.level === lvl) last.count++;
    else runs.push({ level: lvl, count: 1 });
  }
  return runs.map((r) => `${r.level}×${r.count}`).join(' / ');
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
