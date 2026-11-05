// Prominent CLI warnings for pipeline blockers (blank scores, bad flags).

function missingScoreSongs(songs) {
  return (songs || []).filter((s) => s.needsUserInput);
}

function printMissingScoresBanner(missing) {
  const n = missing.length;
  console.error('');
  console.error('══════════════════════════════════════════════════════════');
  console.error(`  ⚠  ${n} SONG${n === 1 ? '' : 'S'} NEED${n === 1 ? 'S' : ''} A SCORE`);
  console.error('══════════════════════════════════════════════════════════');
  console.error('');
  for (const s of missing) {
    console.error(`  • #${s.rawOrderIndex} ${s.title}${s.artist ? ` — ${s.artist}` : ''}`);
  }
  console.error('');
  console.error('  → Set the score directly:');
  console.error('');
  console.error('      $ just r <round> -sc <i>:<v>            # short form');
  console.error('      $ just rescore <round> --score <i>:<v>  # long form');
  console.error('');
  console.error('  → Or re-export HTML after autosave + reload, then re-parse.');
  console.error('');
}

export function warnMissingScoresCli(songs) {
  const missing = missingScoreSongs(songs);
  if (!missing.length) return 0;
  printMissingScoresBanner(missing);
  return missing.length;
}

// Fit-graded rounds: songs with a music score but no fit signal (numeric, tier, or
// gate) while most of the round has one. Called out like a missing music score.
export function warnMissingFitScoresCli(songs) {
  const missing = (songs || []).filter((s) => s.needsFitScore);
  if (!missing.length) return 0;
  const n = missing.length;
  console.error('');
  console.error('══════════════════════════════════════════════════════════');
  console.error(`  ⚠  ${n} SONG${n === 1 ? '' : 'S'} MISSING A FIT SIGNAL — most of this round is fit-graded`);
  console.error('══════════════════════════════════════════════════════════');
  console.error('');
  for (const s of missing) {
    console.error(`  • #${s.rawOrderIndex} ${s.title}${s.artist ? ` — ${s.artist}` : ''}`);
  }
  console.error('');
  console.error('  → Add a fit score, tier word, or gate word to each, then re-parse.');
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
