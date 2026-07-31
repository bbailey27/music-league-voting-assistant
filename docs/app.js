// Music League vote assistant — browser UI over the same parse + allocate core as the CLI.

import {
  allocate,
  enrichProfileWithBudget,
  formatScore,
  scoreComment,
} from './lib/score-core.mjs';
import { parseRoundDocument } from './lib/extract-html.mjs';
import { parseRoundText } from './lib/parse-text.mjs';
import { buildBallotTable, buildPickTables } from './lib/web-table.mjs';

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
  renderTradeoffTables();
  renderBallot();
  renderBlockers();
}

function numericCols(headers) {
  const numeric = new Set(['#', 'Score', 'Music', 'Fit', 'Combined', 'Mod', 'Votes']);
  const cols = new Set();
  headers.forEach((h, i) => {
    if (numeric.has(h) || /^[A-F]$/.test(h) || /^(cv|fl|cc)$/.test(h)) cols.add(i);
  });
  return cols;
}

function mountCliTable(table, { selectableOption = false, selectedOption = 0, onSelectOption = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'cli-table-block';

  const heading = document.createElement('h3');
  heading.className = 'cli-table-title';
  heading.textContent = table.title;
  wrap.appendChild(heading);

  const tableEl = document.createElement('table');
  tableEl.className = 'cli-table';

  const numCols = numericCols(table.headers);
  const thead = document.createElement('thead');
  const headTr = document.createElement('tr');
  table.headers.forEach((h, colIdx) => {
    const th = document.createElement('th');
    th.textContent = h;
    if (numCols.has(colIdx)) th.classList.add('num');
    const isOptionCol =
      selectableOption &&
      !table.down &&
      colIdx >= table.optionStartCol &&
      colIdx < table.optionStartCol + table.optionColCount;
    if (isOptionCol) {
      const optIdx = colIdx - table.optionStartCol;
      th.classList.add('option-col');
      if (optIdx === selectedOption) th.classList.add('selected');
      th.title = `Apply option ${h}`;
      th.addEventListener('click', () => onSelectOption?.(optIdx));
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
        selectableOption &&
        !table.down &&
        colIdx >= table.optionStartCol &&
        colIdx < table.optionStartCol + table.optionColCount
      ) {
        const optIdx = colIdx - table.optionStartCol;
        td.classList.add('option-col');
        if (optIdx === selectedOption) td.classList.add('selected');
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
        selectableOption &&
        !table.down &&
        colIdx >= table.optionStartCol &&
        colIdx < table.optionStartCol + table.optionColCount
      ) {
        const optIdx = colIdx - table.optionStartCol;
        td.classList.add('option-col');
        if (optIdx === selectedOption) td.classList.add('selected');
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
  const profile = menuProfile(buildProfile());
  const tables = buildPickTables(state.tradeoffs, state.songs, state.ownSongs, profile);
  if (!tables.length) {
    container.textContent = 'No distributions yet — fix blank scores first.';
    return;
  }
  for (const table of tables) {
    container.appendChild(
      mountCliTable(table, {
        selectableOption: !table.down,
        selectedOption: state.selectedOption,
        onSelectOption: (i) => {
          state.selectedOption = i;
          applySelectedOption();
          setStatus(`Applied option ${String.fromCharCode(65 + i)}.`);
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
