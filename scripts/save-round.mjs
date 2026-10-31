#!/usr/bin/env node
// Save clipboard HTML as a round input under the canonical dated round id.
// stdin HTML ← `just save-round <slug>`:
//   1. Strip any leading date from the slug (bare slug families are canonical).
//   2. If exactly one dated sibling exists in rounds/ or analysis/, write the
//      fresh export to that dated file — never a second undated copy.
//   3. Otherwise stamp today's (effective) date: YYYY-MM-DD-<slug>.html.
// Naming-consistency moment: matching a known slug family prints its recent
// concrete slugs; an unknown family gets a digest + (interactive sessions) a
// prompt before writing — y keeps the slug as typed, a word replaces it inline,
// n cancels — then the family auto-registers in the league registry.
// Round ids and artifact layout: spec/analysis-artifacts.md; registry: leagues.mjs.

import { existsSync, writeFileSync, mkdirSync, openSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import {
  ROUNDS_DIR,
  bareSlugOf,
  datePrefixOf,
  datedSiblingsOf,
  listAllRoundIds,
  listArchivedRoundIds,
  writeCurrentRound,
} from './paths.mjs';
import { effectiveDate, formatDateSlug } from './maintain-rounds.mjs';
import { upsertPlainLeague, leagueSlugActivity, loadLeagueRegistry, mostSpecificSlugMatch, mergeRoundIntoLeague } from './leagues.mjs';

const usage = `Usage: just save-round <slug>   # clipboard HTML → data/rounds/<dated slug>.html`;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk.toString('utf8'));
  return chunks.join('');
}

export function resolveSaveTarget(query, ids = listAllRoundIds(), now = new Date()) {
  if (datePrefixOf(query)) return { id: query, created: true };
  const siblings = datedSiblingsOf(query, ids);
  if (siblings.length === 1) return { id: siblings[0], created: false };
  if (siblings.length > 1) {
    return { error: `"${query}" is ambiguous — matches multiple dated rounds:`, siblings };
  }
  return { id: `${formatDateSlug(effectiveDate(now))}-${query}`, created: true };
}

/** Slug-recall lines: family digest across the registry, active recent slugs first. */
export function familyDigestLines(roundId, { now = new Date() } = {}) {
  const ids = [...listAllRoundIds(), ...listArchivedRoundIds()];
  const registry = loadLeagueRegistry();
  const activity = leagueSlugActivity(ids, { leagues: registry, now }).sort(
    (a, b) => (b.ageDays ?? Infinity) - (a.ageDays ?? Infinity)
  );
  const winning = mostSpecificSlugMatch(registry, roundId)?.league || null;
  const mine = winning
    ? leagueSlugActivity(ids, { leagues: registry, now }).find((a) => a.league.id === winning.id)
    : null;
  const lines = [];
  if (mine?.league) {
    const recent = mine.recent.map((r) => `${r.bare} (${r.ageDays}d ago)`);
    lines.push(`Family ${mine.league.slugFamily} — recent: ${recent.join(', ')}`);
  }
  const active = activity.filter((a) => a.active).slice(0, 5);
  for (const { league, latest } of active) {
    if (mine?.league && league.id === mine.league.id) continue;
    lines.push(
      `  ${league.id.padEnd(14)} ${league.slugFamily.padEnd(18)} latest: ${latest ? `${latest.bare} (${activity.find((x) => x.league.id === league.id)?.recent?.[0]?.ageDays ?? '?'}d ago)` : '—'}`
    );
  }
  return { lines, matched: mine?.league ?? null };
}

/** Interactive confirm reading /dev/tty (stdin is the clipboard pipe). Any failure → null. */
async function confirmOnTty(question) {
  if (!existsSync('/dev/tty')) return null; // no device at all (agent/cron runs)
  let fd;
  try {
    fd = openSync('/dev/tty', 'rs'); // throws synchronously when no session backs it
  } catch {
    return null;
  }
  // node:tty ReadStream (uv TTY handle), NOT fs.createReadStream: the fs stream
  // reads on the libuv threadpool, and after the answer it queues another blocking
  // kernel read that cannot be cancelled — the process then never exits until new
  // tty input arrives (uv TTY reads poll in the loop instead, so destroy() ends it).
  const { createInterface } = await import('node:readline/promises');
  const { ReadStream } = await import('node:tty');
  const stream = new ReadStream(fd);
  stream.on('error', () => {}); // late ENXIO between open and read — degrade below
  const rl = createInterface({ input: stream, terminal: true });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase();
  } catch {
    return null; // late ENXIO between open and read — degrade below
  } finally {
    rl.close();
    stream.destroy();
  }
}

/**
 * Families whose bare-slug prefix shares the slug's first token — the merge
 * candidates when a saved round might belong to an existing league (1-round or
 * token families alike; owned slugs never reach this check).
 */
export function relatedExactFamilies(roundId, registry) {
  const bare = bareSlugOf(roundId);
  const first = bare.split('-')[0];
  return (registry || []).filter((lg) =>
    (lg.slugPrefixes || []).some((p) => p && p.split('-')[0] === first)
  );
}

/**
 * Official league name from a round-export `<title>`:
 * "Music League | <league> | <round title>" — the middle segment.
 */
export function leagueNameFromHtml(html) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(String(html || ''));
  if (!m) return null;
  const parts = m[1].split('|').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : null;
}

function nameEquals(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/** Registered names block for prompts: "<family> — Names: a, b (or none yet)". */
function registeredNamesLines(league) {
  const names = (league.names || []).length ? league.names.join(', ') : '(none yet — filled by parse)';
  return [`  Proposed family: ${league.slugFamily} (${league.id}) — Names: ${names}`];
}

/**
 * Resolve the save target with the round's official league name in hand, then
 * run the interactive naming check before anything is written (save-round only
 * prompt surface; /dev/tty because stdin carries the clipboard). Slugs always
 * register as 1-round families when unknown; widening happens on league-name
 * proof (registered name match) or on an explicit owner confirmation:
 *   - matched family but unregistered league name → merge-add vs separate-new;
 *   - unmatched slug sharing a first token with a 1-round family → same options;
 *   - unmatched slug whose league name is already registered → folds into that
 *     entry without asking (the name is the same-league proof).
 */
async function resolveWithNamingCheck(query, leagueName) {
  let slug = query;
  for (;;) {
    const target = resolveSaveTarget(slug);
    if (target.error) {
      console.error(target.error);
      for (const s of target.siblings) console.error(`  ${s}`);
      process.exit(1);
    }

    const digest = familyDigestLines(target.id);
    const owned = digest.matched;
    if (owned) {
      for (const line of digest.lines) console.log(line);
      for (const line of registeredNamesLines(owned)) console.log(line);
      if (!leagueName) {
        return { target, digest };
      }
      if ((owned.names || []).some((n) => nameEquals(n, leagueName))) {
        console.log(`League: ${leagueName} — registered name, no prompt needed.`);
        return { target, digest };
      }
      // Covered slug but an unregistered league name — the classic reuse case
      // (e.g. a fresh last.fm iteration under the same lfm- prefix): ask once.
      if (!(owned.names || []).length) {
        // Nameless family: parse-fill semantics — record the name silently.
        return { target, digest };
      }
      console.log(`This round's league (page title): "${leagueName}" — not registered for this family.`);
      console.log(`Owned by: ${owned.slugFamily} (${owned.id})`);
      // Name-aware suggestion: the league name may already be registered under a
      // DIFFERENT family — the strongest hint for what this round should join.
      const registry = loadLeagueRegistry();
      const nameOwner = leagueName ? registry.find((lg) => (lg.names || []).some((n) => nameEquals(n, leagueName))) : null;
      const candidates = relatedExactFamilies(target.id, registry).filter((lg) => lg.id !== owned.id && lg.id !== nameOwner?.id);
      let ordered = candidates;
      if (nameOwner) {
        for (const line of registeredNamesLines(nameOwner)) console.log(` 1. ${line.trim()}`);
        console.log('  1       correct to the registered family — fold this slug into it (the name is the proof); already claims a matching name, so no alias needed');
        ordered = [nameOwner, ...candidates];
      }
      candidates.forEach((r, i) => {
        const at = nameOwner ? i + 2 : i + 1;
        for (const line of registeredNamesLines(r)) console.log(`  ${at}. ${line.trim()}`);
      });
      if (candidates.length) {
        console.log(`  1..${ordered.length}  same league as that numbered family — merge "${bareSlugOf(target.id)}" into it instead`);
      }
      console.log('  root <x-test->   different league — stake the family root yourself (bare prefix, dash it to make it a series; e.g. "root kpop-test-"); the slug saves under it');
      console.log('  y       different league — keep the FULL round slug as its own 1-round family');
      console.log('  <round-slug>  save under a NEW bare round slug — this round\'s name, NOT a family id; family rules re-check it');
      console.log('  n       cancel — nothing is written; the clipboard is intact');
      const answer = await confirmOnTty(`[m | 1..${ordered.length} | root <…> | y | <round-slug> | n] `);
      if (answer == null) {
        console.log('(no interactive terminal — saving without the name; parse will record it,');
        console.log(' or run "ml leagues <id> --set-family/--set-prefixes" to correct the family)');
        return { target, digest };
      }
      if (answer === 'm' || answer === 'M') return { target, digest, addAlias: true };
      const pick = /^\d+$/.test(answer) ? Number(answer) : 0;
      if (ordered.length && pick >= 1 && pick <= ordered.length) {
        const chosen = ordered[pick - 1];
        try {
          mergeRoundIntoLeague(chosen.id, target.id);
        } catch (err) {
          console.error(String(err.message));
          process.exit(1);
        }
        console.log(`Registered as same league: ${chosen.slugFamily} now covers ${bareSlugOf(target.id)} too.`);
        const firstFill = !(chosen.names || []).length && leagueName ? { addAlias: true } : {};
        return { target, digest: familyDigestLines(target.id), ...firstFill };
      }
      if (answer.toLowerCase().startsWith('root')) {
        const arg = answer.trim().slice(4).trim();
        if (!arg) {
          console.error('("root" needs the family root with it — e.g. "root kpop-test-" — nothing was consumed; answer again to retry.)');
          continue;
        }
        return { target, digest, root: arg };
      }
      if (answer === 'y' || answer === 'yes') return { target, digest, separate: true };
      if (answer === 'n' || answer === '') {
        console.log('Saved nothing.');
        console.log('No file written; the clipboard is intact for the next attempt.');
        process.exit(1);
      }
      slug = answer; // round-slug correction — re-resolved (and re-checked) next pass
      continue;
    }

    // Unmatched slug, uniform ladder: registered-league-name proof first, then
    // merge-or-separate against any family sharing the first token, then the
    // fully-new case which saves without asking.
    const registry = loadLeagueRegistry();
    const proof = leagueName ? registry.find((lg) => (lg.names || []).some((n) => nameEquals(n, leagueName))) : null;
    if (proof) {
      mergeRoundIntoLeague(proof.id, target.id);
      console.log(`League: ${leagueName} — registered for ${proof.slugFamily} (${proof.id});`);
      console.log(`  family now covers "${bareSlugOf(target.id)}" too (${proof.slugPrefixes.join(', ')}).`);
      return { target, digest: familyDigestLines(target.id) };
    }

    const related = relatedExactFamilies(target.id, registry);
    console.log(`No known slug family for "${bareSlugOf(target.id)}". Other recent families:`);
    for (const line of digest.lines) console.log(line);
    if (related.length === 1) {
      const r = related[0];
      const label = r.names[0] || r.id;
      for (const line of registeredNamesLines(r)) console.log(line);
      console.log(`(${r.slugPrefixes.map((p) => (p.endsWith('-') ? 'token' : '1-round')).join('/')} family ${r.slugFamily} — ${label})`);
      if (leagueName) console.log(`This round's league (page title): "${leagueName}"`);
      console.log(`  m       same league as ${r.id} — merges "${bareSlugOf(target.id)}" into its family`);
      console.log('  root <x-test->   different leagues — stake the family root yourself (bare prefix, trailing dash makes it a series; e.g. "root kpop-test-")');
      console.log('  y       different leagues — save as its own new 1-round family');
      console.log('  <round-slug>  save under a NEW bare round slug — this round\'s name, NOT a family id; family rules re-check it');
      console.log('  n       cancel — nothing is written; the clipboard is intact');
      const answer = await confirmOnTty('[m | y | <round-slug> | n] ');
      if (answer == null) {
        console.log('(no interactive terminal — saving as its own 1-round family;');
        console.log(` link via "ml leagues ${r.id} --set-prefixes …" later if same league)`);
        return { target, digest };
      }
      if (answer === 'm' || answer === 'M') {
        try {
          mergeRoundIntoLeague(r.id, target.id);
        } catch (err) {
          console.error(String(err.message));
          process.exit(1);
        }
        console.log(`Registered as same league: ${r.slugFamily} now covers ${bareSlugOf(target.id)} too.`);
        return { target, digest: familyDigestLines(target.id), addAlias: Boolean(leagueName) };
      }
      if (answer.toLowerCase().startsWith('root')) {
        const arg = answer.trim().slice(4).trim();
        if (!arg) {
          console.error('("root" needs the family root with it — e.g. "root kpop-test-". Answer again to retry.)');
          continue;
        }
        return { target, digest, root: arg };
      }
      if (answer === 'y' || answer === 'yes') return { target, digest, separate: true };
      if (answer === 'n' || answer === '') {
        console.log('Saved nothing.');
        console.log('No file written; the clipboard is intact for the next attempt.');
        process.exit(1);
      }
      slug = answer; // round-slug correction — re-resolved (and re-checked) next pass
      continue;
    }
    if (related.length > 1) {
      related.forEach((r, i) => {
        for (const line of registeredNamesLines(r)) console.log(`  ${i + 1}. ${line.trim()}`);
      });
      console.log(`  1..${related.length}  same league as that numbered family — merge into it`);
      console.log('  y       none of these — save as its own new 1-round family');
      console.log('  <round-slug>  save under this round slug instead — bare slug, date-stamped on save (a round name, NOT a family id), then family rules re-check');
      console.log('  n       cancel — nothing is written; the clipboard is intact');
      const answer = await confirmOnTty(`[1-${related.length} | y | <round-slug> | n] `);
      if (answer == null) {
        console.log('(no interactive terminal — saving as its own 1-round family;');
        console.log(' link a sibling manually: "ml leagues <id> --set-prefixes …")');
        return { target, digest };
      }
      const idx = /^[0-9]+$/.test(answer) ? Number(answer) : 0;
      if (idx >= 1 && idx <= related.length) {
        try {
          mergeRoundIntoLeague(related[idx - 1].id, target.id);
        } catch (err) {
          console.error(String(err.message));
          process.exit(1);
        }
        console.log(`Registered as same league: ${related[idx - 1].slugFamily} now covers ${bareSlugOf(target.id)} too.`);
        return { target, digest: familyDigestLines(target.id), addAlias: Boolean(leagueName) };
      }
      if (answer.toLowerCase().startsWith('root')) {
        const arg = answer.trim().slice(4).trim();
        if (!arg) {
          console.error('("root" needs the family root with it — e.g. "root kpop-test-". Answer again to retry.)');
          continue;
        }
        return { target, digest, root: arg };
      }
      if (answer === 'y' || answer === 'yes') return { target, digest, separate: true };
      if (answer === 'n' || answer === '') {
        console.log('Saved nothing.');
        console.log('No file written; the clipboard is intact for the next attempt.');
        process.exit(1);
      }
      slug = answer; // round-slug correction — re-resolved (and re-checked) next pass
      continue;
    }
    // Fully-new league: slug, token, and name all unregistered — saves without
    // asking, as its own 1-round family.
    console.log('Nothing matches (slug, first token, league name) — fully new league: saving without a prompt,');
    console.log(`as its own 1-round family under "${bareSlugOf(target.id)}"${leagueName ? `, league: ${leagueName}` : ' (league name fills from parse)'}.`);
    return { target, digest, separate: true };
  }
}

async function main() {
  const [query] = process.argv.slice(2);
  if (!query || query.startsWith('-')) {
    console.error(usage);
    process.exit(1);
  }

  // Undated ids only linger when a user saved outside just save-round; if one
  // exists, let the (newer-wins) fold logic see it rather than add a second copy.
  const undated = existsSync(join(ROUNDS_DIR, `${query}.html`));

  // Clipboard first: the naming check below prompts with the round's official
  // league name extracted from the export <title>.
  const html = await readStdin();
  if (!html.trim()) {
    console.error('Clipboard is empty — nothing saved.');
    process.exit(1);
  }

  // Content sanity check upfront: a copy that is not the round export (stray text
  // selection, transcript) still saves today and poisons the next `just run` with
  // a confusing "No songs found". Announce it at save time instead.
  if (!/<table[\s>]/i.test(html)) {
    console.log('warning: clipboard content has no <table> — Music League round exports are');
    console.log('HTML with a song table. This may not be the round page. Saved anyway;');
    console.log('re-run after copying the export — same slug replaces the file.');
  }

  // Naming-consistency check BEFORE writing (see resolveWithNamingCheck).
  const { target, separate, addAlias, root } = await resolveWithNamingCheck(query, leagueNameFromHtml(html));

  const bytes = Buffer.byteLength(html, 'utf8');
  const outPath = join(ROUNDS_DIR, `${target.id}.html`);
  mkdirSync(ROUNDS_DIR, { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  if (target.created) {
    console.log(`Saved ${outPath} (${bytes} bytes)`);
  } else {
    console.log(`Round exists as ${target.id} — replaced ${outPath} (${bytes} bytes)`);
  }
  if (undated && !target.created) {
    console.log(`note: undated export data/rounds/${query}.html still exists; run "just tidy" to fold it`);
  }
  writeCurrentRound(target.id);
  console.log(`(current round: ${target.id})`);

  // Separate-leagues answer: register THIS slug as its own fresh 1-round family
  // even though another family already claims the slug prefix. Normal upsert
  // path: covered families stay silent; covered-name widens on name match.
  const upsert = root != null
    ? upsertPlainLeague({ roundId: target.id, leagueName: leagueNameFromHtml(html), forceFresh: true, freshPrefix: root })
    : separate
      ? upsertPlainLeague({ roundId: target.id, leagueName: leagueNameFromHtml(html), forceFresh: true })
      : upsertPlainLeague({ roundId: target.id, leagueName: leagueNameFromHtml(html), addName: Boolean(addAlias) });
  if (upsert.added) {
    console.log(`Registered slug family: ${upsert.descriptor.slugFamily}`);
  }

  console.log(`Next: just parse ${target.id}`);
  console.log('Changed your mind? just rename <new-slug>');
}

if (process.argv[1] && process.argv[1].endsWith('save-round.mjs')) {
  main();
}
