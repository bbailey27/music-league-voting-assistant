#!/usr/bin/env node
// Deterministic Music League round parser + draft vote allocator.
// Usage: node scripts/parse-round.mjs <round.html|round.txt> [--mode objective|subjective] [--no-json] [--lenient]
//
// HTML and text inputs both emit the same canonical song list, then share the
// scorer/allocator/reporter in score-core.mjs. Scoring reads the USER comment
// only; the submitter quote block is preserved for context but never parsed for
// scoring signals.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { allocate, buildMarkdown, buildJsonPayload, mergeFitJson, enrichProfileWithBudget } from './score-core.mjs';
import { parseRoundDocument } from './extract-html.mjs';
import { parseRoundText } from './parse-text.mjs';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {
    file: null,
    mode: 'objective',
    json: true,
    lenient: false,
    shape: 'auto',
    fit: null,
    rank: null,
    gate: null,
    cutoff: null,
    weights: null,
    pin: [],
    tierCount: null,
    bucketCount: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-json') args.json = false;
    else if (a === '--lenient') args.lenient = true;
    else if (a === '--mode') args.mode = argv[++i];
    else if (a.startsWith('--mode=')) args.mode = a.slice('--mode='.length);
    else if (a === '--shape') args.shape = argv[++i];
    else if (a.startsWith('--shape=')) args.shape = a.slice('--shape='.length);
    else if (a === '--fit') args.fit = argv[++i];
    else if (a.startsWith('--fit=')) args.fit = a.slice('--fit='.length);
    else if (a === '--rank') args.rank = argv[++i];
    else if (a.startsWith('--rank=')) args.rank = a.slice('--rank='.length);
    else if (a === '--gate') args.gate = argv[++i];
    else if (a.startsWith('--gate=')) args.gate = a.slice('--gate='.length);
    else if (a === '--cutoff') args.cutoff = argv[++i];
    else if (a.startsWith('--cutoff=')) args.cutoff = a.slice('--cutoff='.length);
    else if (a === '--weights') args.weights = argv[++i];
    else if (a.startsWith('--weights=')) args.weights = a.slice('--weights='.length);
    else if (a === '--pin') args.pin.push(argv[++i]);
    else if (a.startsWith('--pin=')) args.pin.push(a.slice('--pin='.length));
    else if (a === '--tier-count') args.tierCount = argv[++i];
    else if (a.startsWith('--tier-count=')) args.tierCount = a.slice('--tier-count='.length);
    else if (a === '--bucket-count') args.bucketCount = argv[++i];
    else if (a.startsWith('--bucket-count=')) args.bucketCount = a.slice('--bucket-count='.length);
    else if (!a.startsWith('--') && !args.file) args.file = a;
  }
  return args;
}

// Parse manual vote pins from "<rawOrderIndex>:<votes>" specs (repeatable and/or
// comma-separated, e.g. --pin 2:2,8:2). Returns an overrides map { index: votes }
// for profile.overrides, or undefined when nothing is pinned. Throws on garbage.
export function parsePins(specs) {
  const list = (Array.isArray(specs) ? specs : [specs]).filter(Boolean);
  if (!list.length) return undefined;
  const overrides = {};
  for (const chunk of list) {
    for (const pair of String(chunk).split(',')) {
      if (!pair.trim()) continue;
      const [idx, votes] = pair.split(':');
      const i = Number(idx);
      const v = Number(votes);
      if (!Number.isInteger(i) || i < 0 || !Number.isInteger(v) || v < 0) {
        throw new Error(`Invalid --pin "${pair}" (use <rawOrderIndex>:<votes>, e.g. 2:2)`);
      }
      overrides[i] = v;
    }
  }
  return Object.keys(overrides).length ? overrides : undefined;
}

// Validate a positive-integer count flag (shared by --tier-count / --bucket-count).
// Returns the integer, or undefined for falsy input; throws on malformed input.
function parseCountFlag(spec, flag) {
  if (spec == null || spec === '') return undefined;
  const n = Number(spec);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid ${flag} "${spec}" (use a positive integer, e.g. 3)`);
  }
  return n;
}

// Force the number of final POINT tiers (distinct point values, e.g. 0–2 points =
// 3 tiers), overriding the allocator's automatic choice (e.g. to accept a surfaced
// tier-structure option). The allocator picks the best clustering with that many
// tiers.
export function parseTierCount(spec) {
  return parseCountFlag(spec, '--tier-count');
}

// Force the number of score CLUSTERS (buckets, K) the clustering produces — the
// lower-level knob beneath --tier-count. The budget + smoothness still decide how
// many distinct point values those buckets collapse to.
export function parseBucketCount(spec) {
  return parseCountFlag(spec, '--bucket-count');
}

// Parse a combined-rank blend from "<fit>:<music>" (e.g. "0.6:0.4"). Values are
// normalized to sum to 1 so combinedScore stays on the 0–100 scale. Returns
// undefined for falsy input; throws on malformed/degenerate input.
export function parseWeights(spec) {
  if (!spec) return undefined;
  const parts = String(spec).split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid --weights "${spec}" (use <fit>:<music>, e.g. 0.6:0.4)`);
  }
  const fit = Number(parts[0]);
  const music = Number(parts[1]);
  if (!Number.isFinite(fit) || !Number.isFinite(music) || fit < 0 || music < 0 || fit + music <= 0) {
    throw new Error(`Invalid --weights "${spec}" (use non-negative numbers, e.g. 0.6:0.4)`);
  }
  const total = fit + music;
  return { fit: fit / total, music: music / total };
}

// Build the allocation gate from CLI flags. --cutoff takes "axis:min"
// (e.g. fit:68); --gate takes passFail | passFailMaybe.
function buildGate(args) {
  if (args.cutoff) {
    const [axis, min] = args.cutoff.split(':');
    return { type: 'cutoff', axis: axis || 'fit', min: Number(min) };
  }
  if (args.gate === 'passFail' || args.gate === 'passFailMaybe') return { type: args.gate };
  return undefined;
}

// Parse a saved HTML round via linkedom, then the shared DOM extractor.
function parseRoundHtml(html, mode) {
  const { document } = parseHTML(html);
  return parseRoundDocument(document, mode);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error(
      'Usage: node scripts/parse-round.mjs <round.html|round.txt> [--mode objective|subjective] [--no-json] [--lenient] [--shape ...] [--tier-count <n>] [--bucket-count <n>] [--pin <i>:<v>] [--fit <fit.json> [--rank combined] [--weights <fit>:<music>] [--gate ...] [--cutoff ...]]'
    );
    process.exit(1);
  }
  if (!['objective', 'subjective'].includes(args.mode)) {
    console.error(`Invalid --mode "${args.mode}" (use objective or subjective)`);
    process.exit(1);
  }

  const raw = await readFile(args.file, 'utf8');
  const ext = extname(args.file).toLowerCase();
  const parsed =
    ext === '.txt'
      ? parseRoundText(raw, args.mode, { lenient: args.lenient })
      : parseRoundHtml(raw, args.mode);

  if (!parsed.songs.length) {
    console.error(
      `No songs found in ${args.file}. Expected a saved Music League HTML round, or pasted round text.`
    );
    process.exit(1);
  }

  const gate = buildGate(args);
  const weights = parseWeights(args.weights);
  const overrides = parsePins(args.pin);
  const tierCount = parseTierCount(args.tierCount);
  const bucketCount = parseBucketCount(args.bucketCount);
  const profile = enrichProfileWithBudget(
    { shape: args.shape, gate, weights, overrides, tierCount, bucketCount },
    parsed.budget
  );
  if (args.rank) profile.rankBy = args.rank;

  // Merge path: join an LLM fit JSON with the parsed music scores, allocate on
  // the blend, and write draftVotes back into the fit JSON for render-fit-html.
  if (args.fit) {
    const fitRaw = await readFile(args.fit, 'utf8');
    let fitData;
    try {
      fitData = JSON.parse(fitRaw);
    } catch (err) {
      console.error(`Could not parse fit JSON from ${args.fit}: ${err.message}`);
      process.exit(1);
    }
    const { tradeoffs } = mergeFitJson(parsed, fitData, {
      ...enrichProfileWithBudget(profile, parsed.budget),
      rankBy: args.rank || 'combined',
    });
    await writeFile(args.fit, JSON.stringify(fitData, null, 2), 'utf8');
    console.log(`Updated ${args.fit} with draftVotes`);
    if (tradeoffs.length) {
      console.log(`\n${tradeoffs.length} tradeoff(s) need your call:`);
      for (const t of tradeoffs) console.log(`  • ${t.question}`);
    }
    return;
  }

  const { tradeoffs } = allocate(
    parsed.songs,
    parsed.budget.upvoteBankSize ?? 0,
    parsed.budget.maxUpvotesPerSong ?? Infinity,
    profile
  );

  const ctx = { ...parsed, mode: args.mode, tradeoffs };
  const md = buildMarkdown(ctx);

  const base = basename(args.file, extname(args.file));
  const outDir = 'analysis';
  await mkdir(outDir, { recursive: true });
  const mdPath = join(outDir, `${base}.md`);
  await writeFile(mdPath, md, 'utf8');
  console.log(`Wrote ${mdPath}`);

  if (args.json) {
    const jsonPath = join(outDir, `${base}.json`);
    const payload = buildJsonPayload(ctx);
    await writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Wrote ${jsonPath}`);
  }
}

// Only run the CLI when executed directly, so helpers (e.g. parseWeights) can be
// imported by tests without triggering a parse.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
