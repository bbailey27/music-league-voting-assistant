// Prominent CLI warnings for pipeline blockers (blank scores, bad flags).

function missingScoreSongs(songs) {
  return (songs || []).filter((s) => s.needsUserInput);
}

function printMissingScoresBanner(missing) {
  const n = missing.length;
  console.error('');
  console.error('══════════════════════════════════════════════════════════');
  console.error(`  ⚠  ${n} SONG${n === 1 ? '' : 'S'} STILL NEED A SCORE — fix before pick/finalize`);
  console.error('══════════════════════════════════════════════════════════');
  for (const s of missing) {
    console.error(`  • #${s.rawOrderIndex} ${s.title}${s.artist ? ` — ${s.artist}` : ''}`);
  }
  console.error('  Re-export HTML after autosave + reload, then re-parse.');
  console.error('');
}

export function warnMissingScoresCli(songs) {
  const missing = missingScoreSongs(songs);
  if (!missing.length) return 0;
  printMissingScoresBanner(missing);
  return missing.length;
}

// Numeric-fit rounds: songs with a music score but no 2nd number the auto-detect
// could use. Called out like a missing music score.
export function warnMissingFitScoresCli(songs) {
  const missing = (songs || []).filter((s) => s.needsFitScore);
  if (!missing.length) return 0;
  const n = missing.length;
  console.error('');
  console.error('══════════════════════════════════════════════════════════');
  console.error(`  ⚠  ${n} SONG${n === 1 ? '' : 'S'} MISSING A FIT SCORE — this round scores fit from a 2nd number`);
  console.error('══════════════════════════════════════════════════════════');
  for (const s of missing) {
    console.error(`  • #${s.rawOrderIndex} ${s.title}${s.artist ? ` — ${s.artist}` : ''}`);
  }
  console.error('  Add a fit number (e.g. `75. 80`) to each, then re-parse.');
  console.error('');
  return n;
}

const PICK_MISSING_NOTE =
  'Pick will proceed; unpinned blank scores stay at 0 — fix scores before finalizing.';

export function warnPickWithMissingScores(songs) {
  const n = warnMissingScoresCli(songs);
  if (n) {
    console.error(`  ${PICK_MISSING_NOTE}`);
    console.error('');
  }
  return n;
}
