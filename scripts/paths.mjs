// Shared path conventions for rounds/ inputs and analysis/ outputs.
// Full folder layout and artifact naming: see spec/analysis-artifacts.md.

import { readdirSync, existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

// Private round inputs, analysis outputs, and reference data live in the
// `music-league-data` git submodule mounted at data/ (kept out of the public
// repo). See spec/analysis-artifacts.md and README "Private data" section.
export const DATA_DIR = 'data';
export const ROUNDS_DIR = join(DATA_DIR, 'rounds');
export const ANALYSIS_DIR = join(DATA_DIR, 'analysis');
export const REF_DIR = join(DATA_DIR, 'ref');
export const ARCHIVE_DIR = 'archive';
/** Last round explicitly named on the CLI (`data/.current-round`, one id per line). */
export const CURRENT_ROUND_FILE = join(DATA_DIR, '.current-round');

export const ARTIFACT = {
  music: { md: 'music.md', json: 'music.json', html: 'music.html' },
  fit: { json: 'fit.json', html: 'fit.html', md: 'fit.md' },
  scores: { json: 'scores.json', html: 'scores.html' },
  versions: 'versions',
};

// Round ids are slugged with a leading ISO date: 2026-06-09-tarot-hanged-man.
export const DATE_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})-/;

/** True when a round id already starts with a YYYY-MM-DD- date slug. */
export function hasDatePrefix(roundId) {
  return DATE_PREFIX_RE.test(roundId);
}

/** The YYYY-MM-DD date slug at the start of a round id, or null if undated. */
export function datePrefixOf(roundId) {
  const m = DATE_PREFIX_RE.exec(roundId);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Round slug with any leading YYYY-MM-DD- prefix removed (e.g. lfm-art). */
export function bareSlugOf(roundId) {
  return roundId.replace(DATE_PREFIX_RE, '');
}

/** Dated round ids whose bare slug matches (sorted; earliest date first). */
export function datedSiblingsOf(bareSlug, ids = listAllRoundIds()) {
  return ids.filter((id) => hasDatePrefix(id) && bareSlugOf(id) === bareSlug).sort();
}

/** Round id from a saved input or output basename (e.g. 2026-06-09-tarot-hanged-man). */
function roundIdFromBasename(name) {
  return basename(name, extname(name));
}

/** Round id from a rounds/ input file path. */
export function roundIdFromInput(file) {
  return roundIdFromBasename(file);
}

export function roundAnalysisDir(roundId) {
  return join(ANALYSIS_DIR, roundId);
}

export function musicPaths(roundId) {
  const dir = roundAnalysisDir(roundId);
  return {
    dir,
    md: join(dir, ARTIFACT.music.md),
    json: join(dir, ARTIFACT.music.json),
    html: join(dir, ARTIFACT.music.html),
  };
}

export function fitPaths(roundId) {
  const dir = roundAnalysisDir(roundId);
  return {
    dir,
    json: join(dir, ARTIFACT.fit.json),
    html: join(dir, ARTIFACT.fit.html),
    md: join(dir, ARTIFACT.fit.md),
  };
}

export function scoresPaths(roundId) {
  const dir = roundAnalysisDir(roundId);
  return {
    dir,
    json: join(dir, ARTIFACT.scores.json),
    html: join(dir, ARTIFACT.scores.html),
  };
}

export function versionsDir(roundId) {
  return join(roundAnalysisDir(roundId), ARTIFACT.versions);
}

/** Entries under dir that are not dotfiles and not archive/. */
export function listDirEntries(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => !f.startsWith('.') && f !== ARCHIVE_DIR);
}

/** Basenames of round inputs in rounds/ (skips archive/). */
export function listRoundInputIds() {
  const ids = new Set();
  for (const f of listDirEntries(ROUNDS_DIR)) {
    if (f.endsWith('.html')) ids.add(f.slice(0, -'.html'.length));
    else if (f.endsWith('.txt')) ids.add(f.slice(0, -'.txt'.length));
  }
  return [...ids].sort();
}

/** Round ids that have an analysis/ folder (skips analysis/archive/). */
export function listAnalysisRoundIds() {
  return listDirEntries(ANALYSIS_DIR).filter((f) => {
    try {
      return statSync(join(ANALYSIS_DIR, f)).isDirectory();
    } catch {
      return false;
    }
  }).sort();
}

/** All known round ids from inputs and analysis folders. */
export function listAllRoundIds() {
  return [...new Set([...listRoundInputIds(), ...listAnalysisRoundIds()])].sort();
}

/** Round id last set by an explicit `ml <cmd> <name>` (null when unset). */
export function readCurrentRound() {
  if (!existsSync(CURRENT_ROUND_FILE)) return null;
  try {
    const id = readFileSync(CURRENT_ROUND_FILE, 'utf8').trim();
    return id || null;
  } catch {
    return null;
  }
}

/** Persist the canonical round id after the user names a round on the CLI. */
export function writeCurrentRound(roundId) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CURRENT_ROUND_FILE, `${roundId}\n`, 'utf8');
}

/** Default input path for a round id (HTML preferred over .txt). */
export function inputPathFor(roundId) {
  const html = join(ROUNDS_DIR, `${roundId}.html`);
  const txt = join(ROUNDS_DIR, `${roundId}.txt`);
  if (existsSync(html)) return html;
  if (existsSync(txt)) return txt;
  return html;
}

/** Strip merge/allocate fields so a scores payload can be stored as fit-only. */
export function stripScoresFields(fitData) {
  const out = JSON.parse(JSON.stringify(fitData));
  for (const s of out.songs || []) {
    delete s.draftVotes;
    delete s.draftDownvotes;
    delete s.musicScore;
    delete s.musicComment;
    delete s.combinedScore;
  }
  delete out.combineWeights;
  return out;
}
