// Client-side Music League parse + allocate (Sections 1–3).
// Reuses the same deterministic modules as the CLI — no build step.

import { allocate, enrichProfileWithBudget, formatScore } from '../scripts/score-core.mjs';
import { parseRoundDocument } from '../scripts/extract-html.mjs';
import { parseRoundText } from '../scripts/parse-text.mjs';

const $ = (sel) => document.querySelector(sel);

const coreStatus = $('#core-status');
coreStatus.textContent = 'Core modules loaded.';

function looksLikeHtml(text) {
  const t = text.trim().slice(0, 500).toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html') || t.includes('div class="song"') || t.includes("id=\"song-");
}

function menuProfile(profile) {
  return { ...profile, overrides: undefined, downOverrides: undefined };
}

function modFlags(s) {
  const parts = [];
  if (s.plus) parts.push('+');
  if (s.minus) parts.push('−');
  if (s.uncertain) parts.push('?');
  if (s.playlistAdd) parts.push('play');
  return parts.join(' ') || '·';
}

function syncBallotFromMenu(tradeoffs, songs) {
  const opt = tradeoffs.find((t) => t.kind === 'tier-structure')?.options?.[0];
  if (!opt?.perSong) return;
  const byIdx = new Map(songs.map((s) => [s.rawOrderIndex, s]));
  for (const p of opt.perSong) {
    const s = byIdx.get(p.rawOrderIndex);
    if (s) s.finalVotes = p.votes || 0;
  }
  const down = tradeoffs.find((t) => t.kind === 'down-structure')?.options?.[0];
  if (down?.perSong) {
    for (const p of down.perSong) {
      const s = byIdx.get(p.rawOrderIndex);
      if (s) s.finalDownvotes = p.votes || 0;
    }
  }
}

function parseInput(text, mode, lenient) {
  if (looksLikeHtml(text)) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return { ...parseRoundDocument(doc, mode), inputKind: 'html' };
  }
  return { ...parseRoundText(text, mode, { lenient }), inputKind: lenient ? 'lenient' : 'text' };
}

function collectBlockers(songs) {
  const blanks = songs.filter((s) => s.needsUserInput);
  const dq = songs.filter((s) => s.isDisqualified);
  const review = songs.filter((s) => s.needsReview && !s.needsUserInput && !s.isDisqualified);
  return { blanks, dq, review };
}

function renderBlockers({ blanks, dq, review }) {
  const el = $('#blockers');
  const parts = [];
  if (blanks.length) {
    parts.push(`<strong>${blanks.length} blank score(s)</strong> — add numbers before trusting the allocation:`);
    parts.push('<ul>' + blanks.map((s) => `<li>#${s.rawOrderIndex} ${esc(s.title)}</li>`).join('') + '</ul>');
  }
  if (review.length) {
    parts.push(`<strong>${review.length} need review</strong> (lenient/OCR rows):`);
    parts.push('<ul>' + review.slice(0, 8).map((s) => `<li>#${s.rawOrderIndex} ${esc(s.title)}</li>`).join('') + '</ul>');
  }
  if (dq.length) {
    parts.push(`${dq.length} disqualified (words-only / invalid).`);
  }
  if (!parts.length) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = parts.join('');
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderOptions(tradeoffs) {
  const ts = tradeoffs.find((t) => t.kind === 'tier-structure');
  const container = $('#options');
  container.innerHTML = '';
  if (!ts?.options?.length) {
    container.textContent = 'No option menu (check budget / blank scores).';
    return;
  }
  ts.options.forEach((opt, i) => {
    const letter = String.fromCharCode(65 + i);
    const card = document.createElement('div');
    card.className = 'option-card' + (i === 0 ? ' selected' : '');
    card.textContent = `${letter}. ${opt.label || opt.shape || 'option'}`;
    container.appendChild(card);
  });
}

function renderBallot(songs, ownSongs) {
  const rows = [...songs, ...(ownSongs || [])].sort(
    (a, b) => (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0)
  );
  const tbody = $('#ballot-table tbody');
  tbody.innerHTML = '';
  for (const s of rows) {
    const tr = document.createElement('tr');
    const votes =
      s.isOwn || s.isDisqualified || s.needsUserInput
        ? '—'
        : fmtVotes(s.finalVotes, s.finalDownvotes);
    tr.innerHTML = `
      <td>${s.rawOrderIndex}</td>
      <td>${esc(s.title)}</td>
      <td>${s.score != null ? formatScore(s.score) : '—'}</td>
      <td>${modFlags(s)}</td>
      <td>${votes}</td>
      <td class="comment">${esc((s.userComment || '').slice(0, 120))}</td>
    `;
    tbody.appendChild(tr);
  }
}

function fmtVotes(up, down) {
  const u = up || 0;
  const d = down || 0;
  if (d) return `${u > 0 ? '+' + u : u}/${d < 0 ? d : '-' + d}`;
  return u > 0 ? `+${u}` : String(u);
}

function renderRanked(songs) {
  const eligible = songs.filter((s) => !s.isDisqualified && !s.needsUserInput && s.score != null);
  eligible.sort(
    (a, b) =>
      (b.finalVotes || 0) - (a.finalVotes || 0) ||
      (b.score ?? 0) - (a.score ?? 0) ||
      String(a.title).localeCompare(String(b.title))
  );
  const tbody = $('#ranked-table tbody');
  tbody.innerHTML = '';
  for (const s of eligible) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(s.title)}</td>
      <td>${esc(s.artist || '')}</td>
      <td>${formatScore(s.score)}</td>
      <td>${s.finalVotes ?? 0}</td>
    `;
    tbody.appendChild(tr);
  }
}

function copyText(text) {
  return navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

let lastCopyLines = [];

$('#run').addEventListener('click', () => {
  const status = $('#status');
  status.classList.remove('error');
  const text = $('#input').value.trim();
  if (!text) {
    status.textContent = 'Paste round HTML or Live Text first.';
    status.classList.add('error');
    return;
  }

  try {
    const mode = $('#mode').value;
    const lenient = $('#lenient').checked;
    const parsed = parseInput(text, mode, lenient);
    const { songs, ownSongs, budget, round, inputKind } = parsed;

    const profile = {
      shape: $('#shape').value,
      rankBy: $('#rankBy').value,
    };
    enrichProfileWithBudget(profile, budget);

    const upBudget = budget?.upvoteBankSize ?? 0;
    const cap = budget?.maxUpvotesPerSong ?? Infinity;
    const menu = menuProfile(profile);
    const { tradeoffs } = allocate(songs, upBudget, cap, menu);
    syncBallotFromMenu(tradeoffs, songs);

    const blockers = collectBlockers(songs);
    renderBlockers(blockers);

    $('#round-title').textContent = round?.prompt || round?.title || 'Round';
    $('#round-meta').textContent = [
      inputKind === 'html' ? 'HTML export' : inputKind === 'lenient' ? 'Live Text (lenient)' : 'Text paste',
      upBudget ? `budget ${upBudget}` : 'budget unknown',
      `${songs.length} scored songs`,
      ownSongs?.length ? `${ownSongs.length} own skipped` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    renderOptions(tradeoffs);
    renderBallot(songs, ownSongs);
    renderRanked(songs);

    lastCopyLines = [...songs, ...(ownSongs || [])]
      .sort((a, b) => (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0))
      .map((s) => {
        if (s.isOwn || s.isDisqualified || s.needsUserInput) return `${s.rawOrderIndex}\t${s.title}\t—`;
        return `${s.rawOrderIndex}\t${s.title}\t${s.finalVotes ?? 0}`;
      });

    $('#results').classList.remove('hidden');
    status.textContent = `Parsed ${songs.length} songs. Option A applied to ballot preview.`;
  } catch (err) {
    console.error(err);
    status.textContent = err.message || String(err);
    status.classList.add('error');
  }
});

$('#copy-ballot').addEventListener('click', async () => {
  const text = lastCopyLines.join('\n');
  await copyText(text);
  $('#status').textContent = 'Vote column copied (tab-separated #, title, votes).';
});
