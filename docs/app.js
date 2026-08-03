// Music League vote assistant — browser UI over the same parse + allocate core as the CLI.

import {
  applyNumericFitAutoDetect,
  formatScore,
  scoreComment,
} from './lib/score-core.mjs';
import { parseRoundDocument } from './lib/extract-html.mjs';
import { parseRoundText } from './lib/parse-text.mjs';
import { buildBallotTable, buildPickTables } from './lib/web-table.mjs';
import { exploreAllocate } from './lib/web-explore.mjs';
import { prepareRoundForAllocate } from './lib/web-profile.mjs';

const $ = (sel) => document.querySelector(sel);

const PICK_TRADEOFF_KINDS = new Set(['tier-structure', 'down-structure']);

/** @type {{ songs: object[], ownSongs: object[], budget: object, round: object, tradeoffs: object[], selectedOption: number, selectedDownOption: number, mode: string, inputKind: string, pickReason: string|null, pinNotes: string[], profile: object|null } | null} */
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
  try {
    const { profile, pickReason } = prepareRoundForAllocate({
      songs: state.songs,
      budget: state.budget,
      mode: state.mode,
      $,
    });
    state.profile = profile;
    state.pickReason = pickReason;
    const { tradeoffs, pinNotes } = exploreAllocate({
      songs: state.songs,
      budget: state.budget,
      profile,
    });
    state.tradeoffs = tradeoffs;
    state.pinNotes = pinNotes;
    const upOpts = tradeoffs.find((t) => t.kind === 'tier-structure')?.options?.length ?? 0;
    const downOpts = tradeoffs.find((t) => t.kind === 'down-structure')?.options?.length ?? 0;
    if (state.selectedOption >= upOpts) state.selectedOption = 0;
    if (state.selectedDownOption >= downOpts) state.selectedDownOption = 0;
    applySelectedOption();
    renderAllocatorNotes();
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), true);
  }
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
  const downT = state.tradeoffs.find((t) => t.kind === 'down-structure');
  const down = downT?.options?.[state.selectedDownOption];
  if (down?.perSong) {
    const byIdx = new Map(state.songs.map((s) => [s.rawOrderIndex, s]));
    for (const p of down.perSong) {
      const s = byIdx.get(p.rawOrderIndex);
      if (s) s.finalDownvotes = p.votes || 0;
    }
  }
  renderTradeoffTables();
  renderBallot();
  renderBlockers();
}

function renderAllocatorNotes() {
  if (!state) return;
  const el = $('#allocator-notes');
  const parts = [];
  for (const n of state.pinNotes || []) parts.push(n);
  for (const t of state.tradeoffs || []) {
    if (PICK_TRADEOFF_KINDS.has(t.kind)) continue;
    if (t.question) parts.push(t.question);
  }
  if (!parts.length) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = parts.map((p) => `<div>${esc(p)}</div>`).join('');
}

function numericCols(headers) {
  const numeric = new Set(['#', 'Score', 'Music', 'Fit', 'Combined', 'Mod', 'Votes']);
  const cols = new Set();
  headers.forEach((h, i) => {
    if (numeric.has(h) || /^[A-F]$/.test(h) || /^(cv|fl|cc)$/.test(h)) cols.add(i);
  });
  return cols;
}

function mountCliTable(table, { selectable = false, selectedCol = 0, onSelectCol = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'cli-table-block';

  const heading = document.createElement('h3');
  heading.className = 'cli-table-title';
  heading.textContent = table.title;
  wrap.appendChild(heading);

  const tableEl = document.createElement('table');
  tableEl.className = 'cli-table';

  const numCols = numericCols(table.headers);
  const canSelect = selectable && ((selectable === 'down' && table.down) || (selectable === 'up' && !table.down));
  const thead = document.createElement('thead');
  const headTr = document.createElement('tr');
  table.headers.forEach((h, colIdx) => {
    const th = document.createElement('th');
    th.textContent = h;
    if (numCols.has(colIdx)) th.classList.add('num');
    const isOptionCol =
      canSelect &&
      colIdx >= table.optionStartCol &&
      colIdx < table.optionStartCol + table.optionColCount;
    if (isOptionCol) {
      const optIdx = colIdx - table.optionStartCol;
      th.classList.add('option-col');
      if (optIdx === selectedCol) th.classList.add('selected');
      th.title = `Apply ${table.down ? 'down' : 'up'} option ${h}`;
      th.addEventListener('click', () => onSelectCol?.(optIdx));
    }
    headTr.appendChild(th);
  });
  thead.appendChild(headTr);
  tableEl.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of table.rows) {
    const tr = document.createElement('tr');
    if (row.excluded) tr.classList.add('row-excluded');
    row.cells.forEach((cell, colIdx) => {
      const td = document.createElement('td');
      td.textContent = cell;
      if (numCols.has(colIdx)) td.classList.add('num');
      if (
        canSelect &&
        colIdx >= table.optionStartCol &&
        colIdx < table.optionStartCol + table.optionColCount
      ) {
        const optIdx = colIdx - table.optionStartCol;
        td.classList.add('option-col');
        if (optIdx === selectedCol) td.classList.add('selected');
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  if (table.totals?.length) {
    const tr = document.createElement('tr');
    tr.className = 'totals-row';
    table.totals.forEach((cell, colIdx) => {
      const td = document.createElement('td');
      td.textContent = cell;
      if (numCols.has(colIdx)) td.classList.add('num');
      if (
        canSelect &&
        colIdx >= table.optionStartCol &&
        colIdx < table.optionStartCol + table.optionColCount
      ) {
        const optIdx = colIdx - table.optionStartCol;
        td.classList.add('option-col');
        if (optIdx === selectedCol) td.classList.add('selected');
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  tableEl.appendChild(tbody);
  wrap.appendChild(tableEl);

  if (table.legends?.length) {
    const ul = document.createElement('ul');
    ul.className = 'option-legends';
    for (const { letter, label } of table.legends) {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${esc(letter)}.</strong> ${esc(label)}`;
      ul.appendChild(li);
    }
    wrap.appendChild(ul);
  }

  if (table.tiebreakLimited) {
    const note = document.createElement('p');
    note.className = 'tiebreak-note';
    note.textContent =
      "Can't add more distinct tiers without a tiebreak — adjust a score in step 3, then re-run allocation.";
    wrap.appendChild(note);
  }

  return wrap;
}

function renderTradeoffTables() {
  if (!state) return;
  const container = $('#tradeoff-tables');
  container.innerHTML = '';
  const profile = menuProfile(state.profile || {});
  const tables = buildPickTables(state.tradeoffs, state.songs, state.ownSongs, profile);
  if (!tables.length) {
    container.textContent = 'No distributions yet — fix blank scores first.';
    return;
  }
  for (const table of tables) {
    const kind = table.down ? 'down' : 'up';
    container.appendChild(
      mountCliTable(table, {
        selectable: kind,
        selectedCol: table.down ? state.selectedDownOption : state.selectedOption,
        onSelectCol: (i) => {
          if (table.down) state.selectedDownOption = i;
          else state.selectedOption = i;
          applySelectedOption();
          const label = table.down
            ? table.headers[table.optionStartCol + i]
            : String.fromCharCode(65 + i);
          setStatus(`Applied ${kind} option ${label}.`);
          $('#output-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      })
    );
  }
}

function renderBallot() {
  if (!state) return;
  const signed = (state.budget?.downvoteBankSize ?? 0) > 0;
  const table = buildBallotTable(state.songs, state.ownSongs, { signed });
  const container = $('#ballot-table');
  container.innerHTML = '';
  if (!table) return;
  container.appendChild(mountCliTable(table));

  const budget = state.budget?.upvoteBankSize;
  $('#budget-line').textContent = budget
    ? `Budget ${budget} · allocated ${table.upTotal}${table.upTotal === budget ? ' ✓' : ''}`
    : '';
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
      selectedDownOption: 0,
      pickReason: null,
      pinNotes: [],
      profile: null,
      mode,
      inputKind: parsed.inputKind,
    };
    applyNumericFitAutoDetect(state.songs);
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
    setStatus(`Parsed ${state.songs.length} songs. Pick an option in step 4.`);
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

for (const sel of [
  '#rankBy',
  '#shape',
  '#down-shape',
  '#weights',
  '#gate',
  '#cutoff',
  '#tier-count',
  '#bucket-count',
  '#option-count',
  '#favorite-band',
  '#no-favorite-band',
  '#pins',
  '#score-overrides',
  '#fit-score-overrides',
]) {
  $(sel)?.addEventListener('change', () => {
    if (!state) return;
    runAllocate();
  });
}
for (const sel of ['#pins', '#score-overrides', '#fit-score-overrides', '#weights', '#cutoff']) {
  $(sel)?.addEventListener('input', () => {
    if (!state) return;
    clearTimeout($(sel)._debounce);
    $(sel)._debounce = setTimeout(() => runAllocate(), 400);
  });
}
