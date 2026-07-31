// Music League vote assistant — browser UI over the same parse + allocate core as the CLI.

import {
  allocate,
  enrichProfileWithBudget,
  formatScore,
  scoreComment,
} from './lib/score-core.mjs';
import { parseRoundDocument } from './lib/extract-html.mjs';
import { parseRoundText } from './lib/parse-text.mjs';

const $ = (sel) => document.querySelector(sel);

/** @type {{ songs: object[], ownSongs: object[], budget: object, round: object, tradeoffs: object[], selectedOption: number, mode: string, inputKind: string } | null} */
let state = null;

function looksLikeHtml(text) {
  const t = text.trim().slice(0, 500).toLowerCase();
  return (
    t.startsWith('<!doctype') ||
    t.startsWith('<html') ||
    t.includes('div class="song"') ||
    t.includes('id="song-')
  );
}

function menuProfile(profile) {
  return { ...profile, overrides: undefined, downOverrides: undefined };
}

function buildProfile() {
  const profile = {
    shape: $('#shape').value,
    rankBy: $('#rankBy').value,
  };
  if (state?.budget) enrichProfileWithBudget(profile, state.budget);
  return profile;
}

function parseInput(text, mode, lenient) {
  if (looksLikeHtml(text)) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return { ...parseRoundDocument(doc, mode), inputKind: 'html' };
  }
  return { ...parseRoundText(text, mode, { lenient }), inputKind: lenient ? 'lenient' : 'text' };
}

function rescoreSong(song, mode) {
  const signals = scoreComment(song.userComment || '', mode);
  Object.assign(song, signals);
  song.finalVotes = 0;
  song.finalDownvotes = 0;
}

function runAllocate() {
  if (!state) return;
  const profile = buildProfile();
  const upBudget = state.budget?.upvoteBankSize ?? 0;
  const cap = state.budget?.maxUpvotesPerSong ?? Infinity;
  const { tradeoffs } = allocate(state.songs, upBudget, cap, menuProfile(profile));
  state.tradeoffs = tradeoffs;
  const optCount = tradeoffs.find((t) => t.kind === 'tier-structure')?.options?.length ?? 0;
  if (state.selectedOption >= optCount) state.selectedOption = 0;
  applySelectedOption();
}

function applySelectedOption() {
  if (!state) return;
  const ts = state.tradeoffs.find((t) => t.kind === 'tier-structure');
  const opt = ts?.options?.[state.selectedOption];
  if (opt?.perSong) {
    const byIdx = new Map(state.songs.map((s) => [s.rawOrderIndex, s]));
    for (const s of state.songs) {
      s.finalVotes = 0;
      s.finalDownvotes = 0;
    }
    for (const p of opt.perSong) {
      const s = byIdx.get(p.rawOrderIndex);
      if (s) s.finalVotes = p.votes || 0;
    }
  }
  const down = state.tradeoffs.find((t) => t.kind === 'down-structure')?.options?.[0];
  if (down?.perSong) {
    const byIdx = new Map(state.songs.map((s) => [s.rawOrderIndex, s]));
    for (const p of down.perSong) {
      const s = byIdx.get(p.rawOrderIndex);
      if (s) s.finalDownvotes = p.votes || 0;
    }
  }
  renderOptions();
  renderBallot();
  renderBlockers();
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parsedLabel(s) {
  if (s.needsUserInput) return 'blank — add a score';
  if (s.isDisqualified) return 'DQ';
  if (s.needsReview) return `${formatScore(s.score)} ? review`;
  if (s.score == null) return '—';
  let t = formatScore(s.score);
  if (s.plus) t += '+';
  if (s.minus) t += '−';
  if (s.uncertain) t += '?';
  return t;
}

function renderBlockers() {
  if (!state) return;
  const blanks = state.songs.filter((s) => s.needsUserInput);
  const review = state.songs.filter((s) => s.needsReview && !s.needsUserInput && !s.isDisqualified);
  const el = $('#blockers');
  if (!blanks.length && !review.length) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  const parts = [];
  if (blanks.length) {
    parts.push(`<strong>${blanks.length} song(s) still need a score</strong> — edit in step 3.`);
  }
  if (review.length) parts.push(`${review.length} row(s) flagged after Live Text — verify scores.`);
  el.innerHTML = parts.join(' ');
}

function renderScoresTable() {
  if (!state) return;
  const tbody = $('#scores-table tbody');
  tbody.innerHTML = '';
  const rows = [...state.songs].sort((a, b) => (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0));
  for (const s of rows) {
    const tr = document.createElement('tr');
    if (s.needsUserInput) tr.classList.add('row-blank');
    if (s.needsReview) tr.classList.add('row-review');
    tr.innerHTML = `
      <td>${s.rawOrderIndex}</td>
      <td>${esc(s.title)}<div class="artist">${esc(s.artist || '')}</div></td>
      <td class="comment-cell"></td>
      <td class="parsed">${esc(parsedLabel(s))}</td>
    `;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'comment-input';
    input.value = s.userComment || '';
    input.placeholder = 'e.g. 78+ or 72 music, 8 fit';
    input.addEventListener('change', () => {
      s.userComment = input.value.trim();
      rescoreSong(s, state.mode);
      tr.querySelector('.parsed').textContent = parsedLabel(s);
      tr.classList.toggle('row-blank', !!s.needsUserInput);
      tr.classList.toggle('row-review', !!s.needsReview);
      setStatus('Score updated — re-run allocation or pick an option.');
    });
    tr.querySelector('.comment-cell').appendChild(input);
    tbody.appendChild(tr);
  }
}

function renderOptions() {
  if (!state) return;
  const ts = state.tradeoffs.find((t) => t.kind === 'tier-structure');
  const container = $('#options');
  container.innerHTML = '';
  if (!ts?.options?.length) {
    container.textContent = 'No distributions yet — fix blank scores first.';
    return;
  }
  ts.options.forEach((opt, i) => {
    const letter = String.fromCharCode(65 + i);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option-card' + (i === state.selectedOption ? ' selected' : '');
    btn.textContent = `${letter}. ${opt.label || opt.shape || 'option'}`;
    btn.addEventListener('click', () => {
      state.selectedOption = i;
      applySelectedOption();
      setStatus(`Applied option ${letter}.`);
      $('#output-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    container.appendChild(btn);
  });
}

function renderBallot() {
  if (!state) return;
  const rows = [...state.songs, ...(state.ownSongs || [])].sort(
    (a, b) => (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0)
  );
  const tbody = $('#ballot-table tbody');
  tbody.innerHTML = '';
  let total = 0;
  for (const s of rows) {
    const eligible = !s.isOwn && !s.isDisqualified && !s.needsUserInput;
    const votes = eligible ? s.finalVotes ?? 0 : null;
    if (eligible) total += votes;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.rawOrderIndex}</td>
      <td>${esc(s.title)}</td>
      <td>${s.score != null ? formatScore(s.score) : '—'}</td>
      <td class="votes">${votes == null ? '—' : votes > 0 ? '+' + votes : votes}</td>
    `;
    tbody.appendChild(tr);
  }
  $('#vote-total').textContent = String(total);
  const budget = state.budget?.upvoteBankSize;
  $('#budget-line').textContent = budget
    ? `Budget ${budget} · allocated ${total}${total === budget ? ' ✓' : ''}`
    : '';
}

function setStatus(msg, isError = false) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

function showResults() {
  $('#scores-section').classList.remove('hidden');
  $('#pick-section').classList.remove('hidden');
  $('#output-section').classList.remove('hidden');
}

function copyLines() {
  if (!state) return [];
  return [...state.songs, ...(state.ownSongs || [])]
    .sort((a, b) => (a.rawOrderIndex ?? 0) - (b.rawOrderIndex ?? 0))
    .map((s) => {
      if (s.isOwn || s.isDisqualified || s.needsUserInput) {
        return `#${s.rawOrderIndex} ${s.title}\t—`;
      }
      return `#${s.rawOrderIndex} ${s.title}\t${s.finalVotes ?? 0}`;
    });
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

if (/iPhone|iPad|Android/i.test(navigator.userAgent)) {
  $('#lenient').checked = true;
}

$('#run').addEventListener('click', () => {
  const text = $('#input').value.trim();
  if (!text) {
    setStatus('Paste your round text first (step 2).', true);
    return;
  }
  try {
    const mode = $('#mode').value;
    const lenient = $('#lenient').checked;
    const parsed = parseInput(text, mode, lenient);
    state = {
      songs: parsed.songs,
      ownSongs: parsed.ownSongs || [],
      budget: parsed.budget || {},
      round: parsed.round || {},
      tradeoffs: [],
      selectedOption: 0,
      mode,
      inputKind: parsed.inputKind,
    };
    const upBudget = state.budget?.upvoteBankSize ?? 0;
    $('#round-meta').textContent = [
      state.round?.prompt || state.round?.title || 'Round',
      state.inputKind === 'html' ? 'from HTML' : state.inputKind === 'lenient' ? 'Live Text' : 'text',
      `${state.songs.length} songs`,
      upBudget ? `budget ${upBudget}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    runAllocate();
    renderScoresTable();
    renderBlockers();
    showResults();
    setStatus(`Parsed ${state.songs.length} songs. Pick an option (step 4), then copy votes (step 5).`);
    $('#scores-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), true);
  }
});

$('#reallocate').addEventListener('click', () => {
  if (!state) return;
  runAllocate();
  renderScoresTable();
  setStatus('Allocation refreshed.');
});

$('#copy-ballot').addEventListener('click', async () => {
  await copyText(copyLines().join('\n'));
  setStatus('Votes copied — use submission order in Music League.');
});
