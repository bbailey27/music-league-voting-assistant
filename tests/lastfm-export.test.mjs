import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVariant, parseArtist, normTitle,
  buildRuleIndex, applyRules, loadRules,
  rollup, PROFILES, artistRollup, resolveTable,
} from '../scripts/lastfm-export.mjs';

// ---- parseVariant: version info becomes dimensions, not title text ----
test('parseVariant: parens never differentiate; base title is stripped', () => {
  assert.equal(parseVariant('으르렁 (Growl)').title, parseVariant('으르렁 Growl').title);
  assert.equal(parseVariant('Song (Remix)').title, 'song');
  assert.equal(parseVariant('Song').title, 'song');
});

test('parseVariant: language extracted (labels + abbrevs + EXO-K/M)', () => {
  assert.equal(parseVariant('XOXO (Chinese Version)').language, 'Chinese');
  assert.equal(parseVariant('Song (Eng Ver)').language, 'English');
  assert.equal(parseVariant('Song (English)').language, 'English');
  assert.equal(parseVariant('Growl (EXO-K Version)').language, 'Korean');
  assert.equal(parseVariant('Growl (EXO-M Version)').language, 'Chinese');
  assert.equal(parseVariant('XOXO (Chinese Version)').title, 'xoxo');
});

test('parseVariant: remix/custom-version name captured', () => {
  assert.equal(parseVariant('Butter (Hotter Remix)').remix, 'Hotter Remix');
  assert.equal(parseVariant('놀리러 간다 (Voice Version)').remix, 'Voice Version');
  assert.equal(parseVariant('놀리러 간다 (Voice Version)').title, '놀리러 간다');
});

test('parseVariant: live + instrumental flags', () => {
  assert.equal(parseVariant('Song - Live').live, 'live');
  assert.equal(parseVariant('Song (Instrumental)').instrumental, 'instrumental');
  assert.equal(parseVariant('Song (Instrumental)').title, 'song');
});

test('parseVariant: explicit/clean/feat dropped, not treated as versions', () => {
  assert.equal(parseVariant('Seven (feat. Latto)').title, 'seven');
  assert.equal(parseVariant('Seven (Clean Ver.)').title, 'seven');
  assert.equal(parseVariant('Seven (feat. Latto)').remix, '');
});

test('normTitle is parseVariant().title', () => {
  assert.equal(normTitle('Butter (Hotter Remix)'), 'butter');
});

// ---- parseArtist: main / all / collab ----
test('parseArtist: feat still credits mainArtist; feat name cleaned', () => {
  const a = parseArtist('Stray Kids feat. LiSA');
  assert.equal(a.mainArtist, 'Stray Kids');
  assert.deepEqual(a.artists, ['Stray Kids', 'LiSA']);
  assert.equal(a.collab, true);
});

test('parseArtist: &/, collaborators split; lead is main', () => {
  const a = parseArtist('Alesso, Stray Kids & CORSAK');
  assert.equal(a.mainArtist, 'Alesso');
  assert.deepEqual(a.artists, ['Alesso', 'Stray Kids', 'CORSAK']);
});

test('parseArtist: solo artist is not a collab', () => {
  assert.equal(parseArtist('BTS').collab, false);
});

// ---- rules: override.set + albumRules with precedence ----
test('applyRules: override relabels + sets dims; albumRule sets by album; override wins', () => {
  const idx = buildRuleIndex({
    artistAliases: [], titleAliases: [],
    albumRules: [{ match: { artist: 'Exo', album: 'LIVE ALBUM' }, set: { live: 'live', language: 'Japanese' } }],
    overrides: [{ match: { artist: 'Exo', track: 'Growl', album: 'LIVE ALBUM' }, as: 'Growl', set: { language: 'Korean' } }],
  });
  const r = applyRules({ artist: 'Exo', track: 'Growl', album: 'LIVE ALBUM' }, idx);
  assert.equal(r.track, 'Growl');
  assert.equal(r.set.language, 'Korean'); // override.set beats albumRule.set
  assert.equal(r.set.live, 'live');       // albumRule contributes live
});

// ---- rollup + profiles ----
const BASE = [
  { mainArtist: 'Exo', title: 'growl', album: 'a', language: 'Korean', remix: '', live: '', instrumental: '', artists: ['Exo'], count: 20 },
  { mainArtist: 'Exo', title: 'growl', album: 'live', language: 'Korean', remix: '', live: 'live', instrumental: '', artists: ['Exo'], count: 3 },
  { mainArtist: 'Exo', title: 'growl', album: 'cn', language: 'Chinese', remix: '', live: '', instrumental: '', artists: ['Exo'], count: 5 },
];

test('rollup affinity folds everything into one row', () => {
  const out = rollup(BASE, PROFILES.affinity);
  assert.equal(out.length, 1);
  assert.equal(out[0].count, 28);
});

test('rollup versions splits language, folds live into nearest', () => {
  const out = rollup(BASE, PROFILES.versions).sort((a, b) => b.count - a.count);
  assert.equal(out.length, 2); // Korean (20+3 live folded) + Chinese
  assert.equal(out[0].count, 23);
  assert.equal(out[1].count, 5);
});

test('rollup pandora keeps live split', () => {
  const out = rollup(BASE, PROFILES.pandora);
  assert.equal(out.length, 3);
});

test('artistRollup credits every listed artist', () => {
  const base = [{ artists: ['Alesso', 'Stray Kids'], count: 4 }, { artists: ['Stray Kids'], count: 6 }];
  const out = artistRollup(base);
  const sk = out.find((r) => r.artist === 'Stray Kids');
  assert.equal(sk.count, 10);
});

// ---- resolveTable ----
test('resolveTable: explicit table wins; fallback when no map', () => {
  assert.match(resolveTable('whatever', { table: 'affinity' }), /tracks-affinity\.csv$/);
  assert.match(resolveTable('whatever', { tableMap: '/does/not/exist.json', fallback: 'title' }), /track-titles\.csv$/);
});

// ---- EXO XOXO album-keyed language split (the crux: plain title depends on album) ----
test('seeded rules: plain title is Chinese on XOXO but Korean on the live album', () => {
  const idx = buildRuleIndex(loadRules());
  const XOXO = "The 1st Album 'XOXO' (Repackage)";
  const LIVE = 'EXOLOGY CHAPTER 1: THE LOST PLANET (Live)';
  const dims = (artist, track, album) => {
    const r = applyRules({ artist, track, album }, idx);
    const v = parseVariant(r.track);
    return { title: v.title, language: r.set.language ?? v.language, live: r.set.live ?? v.live };
  };
  // Growl: plain = Chinese on XOXO, Korean(+live) on the live album; Hangul = Korean.
  assert.deepEqual(dims('Exo', 'Growl', XOXO), { title: 'growl', language: 'Chinese', live: '' });
  assert.deepEqual(dims('Exo', 'Growl', LIVE), { title: 'growl', language: 'Korean', live: 'live' });
  assert.equal(dims('Exo', '으르렁 Growl', XOXO).language, 'Korean');
  assert.equal(dims('Exo', '咆哮 Growl', XOXO).language, 'Chinese');
  // Wolf: plain = Chinese on XOXO, Hangul = Korean; both fold to title "wolf".
  assert.deepEqual(dims('Exo', 'Wolf', XOXO), { title: 'wolf', language: 'Chinese', live: '' });
  assert.deepEqual(dims('Exo', '늑대와 미녀 (Wolf)', XOXO), { title: 'wolf', language: 'Korean', live: '' });
  // Other odd XOXO tracks split the same way.
  assert.equal(dims('Exo', "Don't Go", XOXO).language, 'Chinese');
  assert.equal(dims('Exo', "나비소녀 (Don't Go)", XOXO).language, 'Korean');
  assert.equal(dims('Exo', 'Peter Pan', XOXO).language, 'Chinese');
});

// ---- integration: EXO Growl merges to one Korean row in versions ----
test('readVariants + rules: Growl folds to Korean via rules', () => {
  const idx = buildRuleIndex({
    artistAliases: [], titleAliases: [], albumRules: [],
    overrides: [{ match: { artist: 'Exo', track: '으르렁 Growl', album: '' }, as: 'Growl', set: { language: 'Korean' } }],
  });
  const r = applyRules({ artist: 'Exo', track: '으르렁 Growl', album: '' }, idx);
  assert.equal(r.track, 'Growl');
  assert.equal(r.set.language, 'Korean');
  assert.equal(parseVariant(r.track).title, 'growl');
});
