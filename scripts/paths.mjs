// Shared path conventions for rounds/ inputs and analysis/ outputs.
// Full folder layout and artifact naming: see spec/analysis-artifacts.md.

import { readdirSync, existsSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

export const ROUNDS_DIR = 'rounds';
export const ANALYSIS_DIR = 'analysis';
export const ARCHIVE_DIR = 'archive';

export const ARTIFACT = {
  music: { md: 'music.md', json: 'music.json', html: 'music.html' },
  fit: { json: 'fit.json', html: 'fit.html', md: 'fit.md' },
  scores: { json: 'scores.json', html: 'scores.html' },
  versions: 'versions',
};

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
