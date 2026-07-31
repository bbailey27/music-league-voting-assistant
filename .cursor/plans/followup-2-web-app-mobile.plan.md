---
name: "Follow-up 2: Client-side web app (desktop + mobile, no CLI)"
overview: A zero-build, fully client-side GitHub Pages app that runs the existing deterministic flow (extract → score → allocate) with slugged offline export for later CLI import, plus fit-only copy-prompt. Sections 1–3 shipped; Section 4 (export bundle) is next.
status: partial
depends_on: "Plan A (deterministic allocation engine) — DONE; Follow-up 1 (text/Live-Text parser) — DONE; CLI explore/pin pipeline — DONE (2026-07-31)"
isProject: false
---

# Follow-up 2: Client-side web app (desktop + mobile, no CLI)

The deterministic core is already done and tested in `scripts/`:
`score-core.mjs` (scoring + profile allocator + `mergeFitJson`), `extract-html.mjs`
(env-agnostic DOM extractor), `parse-text.mjs` (footer-anchored Live Text parser).
This plan only adds a browser front-end that reuses those modules unchanged — no
build step, no browser dependencies, no network calls.

## How this is sliced (incremental order)

Each section ships something usable on its own and builds on the previous one.
The order matches the natural pipeline; hosting is pulled into Section 1 so every
later section is immediately viewable on your phone, and the prompt-copy work is
split so the copy-out half ships before the paste-back half.

```
1. App shell + hosting   ──▶ 2. Paste & parse ──▶ 3. Allocation & output
                                     │                      │
                                     │                      ▼
                                     │             4. Slug + export bundle  ◀── NEXT
                                     │                      │
                                     │                      ▼
                                     │             5. Tradeoffs, pins, rescore UI
                                     ▼                      │
                              6a. Fit copy-prompt ──▶ 6b. Paste fit JSON back
                                     │
                                     ▼
                              7. Mobile polish + import docs
```

Dependencies: 2→1, 3→2, **4→3**, 5→4, 6a→2, 6b→3+5a+6a, 7→1–5. Sections 1–3 =
music-only on phone (clipboard only). **Section 4** = named rounds + downloadable
artifacts for desktop import. Section 5 = CLI parity (pins, etc.) on phone.

---

## Section 1 — App shell + hosting ✅ shipped 2026-07-31

- `docs/index.html`, `docs/styles.css`, `docs/app.js` — mobile-first shell, ES module imports from `scripts/`.
- README: local preview (`npx serve`), GitHub Pages `/docs`, iPhone Live Text workflow.
- **Acceptance:** page loads; core modules import without console errors.

## Section 2 — Paste & parse ✅ shipped 2026-07-31

- Paste textarea; HTML vs text auto-detect; lenient toggle.
- Parsed raw-order ballot table; blocker banner for blanks/DQ/review.
- **Acceptance:** sample HTML + `livetext-kpop-group.txt` parse in-browser (smoke-tested via Node).

## Section 3 — Allocation & output display ✅ shipped 2026-07-31

- Profile controls: rankBy, shape; `allocate` + option A ballot preview.
- Ranked table + copy vote column button.
- **Acceptance:** budget-exact allocation for music-only paste; option cards listed.

---

## Section 4 — Slug + offline export bundle ◀ **NEXT**

Phone sessions stay isolated from `data/` until the user explicitly exports.
Type a **bare slug** (e.g. `bg-2021`, `story-10` — same families as
[round-slug-naming.mdc](../rules/round-slug-naming.mdc); no date prefix typed by
hand). The app stamps **`YYYY-MM-DD-<bareSlug>`** using the same date rules as
`maintain-rounds.mjs` (`effectiveDate`, 5am local rollover → yesterday before 5am).
Show the computed `roundId` on screen before export.

### UI (web)

- **Round slug** field at top of workflow (step 2 or persistent header) — bare slug
  only; validate `[a-z0-9-]+`.
- **Optional pick reason** text field (stored in `pick.reason` like `just pick --reason`).
- **Export** button (enabled after parse + option chosen): triggers a browser
  download saveable to iOS **Files** / macOS Downloads / iCloud.
- **Session list** (optional same section): `localStorage` index of exported +
  in-progress slugs so you can work multiple rounds on one phone before syncing
  desktop (export clears or marks complete).

### Export artifact: one ZIP per round

Single file e.g. `2026-07-31-bg-2021-web-export.zip` via `Blob` + ZIP
(`fflate` or `CompressionStream` — stay zero-build, no server). Contents:

| File | Source | Purpose |
| --- | --- | --- |
| `manifest.json` | new | `roundId`, `bareSlug`, `exportedAt` (ISO), `inputKind`, `mode`, `profile`, `webAppVersion` |
| `music.json` | `buildJsonPayload()` | Same shape CLI `parse`/`pick` writes — includes `pick`, `tradeoffs`, `menuTradeoffs`, `profile`, songs with `finalVotes` |
| `music.md` | `buildMarkdown()` | Human-readable report (optional but cheap) |
| `picks.jsonl` | one line | **Append patch** — single JSONL line identical to `recordPickToTrainingLog` entry (`round`, `pickedAt`, `chosen`, `options`, `field`, …) |
| `round-input.txt` | raw paste | Optional preserved input for `data/rounds/<roundId>.txt` re-parse on desktop |

Wire pick export through existing browser-safe helpers (add to `docs/lib/` sync):
`buildJsonPayload`, `buildMarkdown`, `buildPickRecord` from `score/render.mjs`;
port `effectiveDate` / `formatDateSlug` from `maintain-rounds.mjs` into
`docs/lib/date-slug.mjs` (no `node:fs`).

**Requires:** when exporting, call `buildPickRecord` with the chosen option index,
presented menu, and songs (same as `applyOptionPick`) so `music.json` and the
picks line match CLI semantics.

### Desktop import (companion CLI — same effort)

New command: `just import-web <path-to.zip>` → `scripts/import-web-export.mjs`

1. Unzip to temp; read `manifest.json`.
2. Write `data/analysis/<roundId>/music.json` + `music.md`.
3. **Merge `picks.jsonl` patch:** append the exported line to
   `data/analysis/picks.jsonl`, **replacing any prior line with the same
   `round`** (same dedup rule as `recordPickToTrainingLog` in
   `scripts/round/pick.mjs`).
4. If `round-input.txt` present → `data/rounds/<roundId>.txt`.
5. Print next steps: `just status <bareSlug>`, `just final <bareSlug>`, remind
   to commit **`data` repo first** then parent pointer.

If `data/analysis/` already has a folder for the same bare slug with a **different
date**, import does **not** silently overwrite — warn and offer `--merge-into
<existing-roundId>` or let `just tidy` fold on next parse (document choice in
import help).

### Acceptance

- [ ] Type `bg-2021` on phone → UI shows `2026-07-31-bg-2021` (date matches local
      effectiveDate rules).
- [ ] Export downloads one ZIP; Files app receives it.
- [ ] `just import-web ~/Downloads/…zip` places artifacts under
      `data/analysis/<roundId>/` and appends/replaces one picks.jsonl row.
- [ ] Re-importing the same round replaces that round's picks line, does not
      duplicate.
- [ ] Two different slugs exported same day → two dated folders / two pick lines.
- [ ] Imported `music.json` loads in `just status` / `just final` without re-pick.

### Out of scope (Section 4)

- Auto-upload to cloud / git (manual Files → iCloud → desktop import only).
- Thematic `fit.json` / `scores.json` (Section 6b).
- Pin/rescore UI (Section 5).

---

## Section 5 — Tradeoffs, pins, and rescore UI

Make `tradeoffs[]` interactive; expose CLI explore knobs (`--pin`, `--weights`,
`--cutoff`, `--tier-count`, …) as mobile controls. Reuse `exploreAllocate` /
`applyPinsToMenuTradeoffs` (sync via `docs/lib/`). Export (Section 4) must include
`profile.overrides` / `menuTradeoffs` when pins are used.

- Render each tradeoff as a choice card by `kind`:
  - `tier-split` — pick who gets the indivisible extra (sets an `override`).
  - `maybe-band` — slider/buttons for how many questionable entries to fund
    (sets `gate.leniency` or `includeCount`).
  - `preallocation-overflow` — choose which floored song to lower.
  - `forced-spill` — acknowledge / reassign the leftover.
- Pin UI: index:vote inputs, reflow all option columns, sync ballot preview.
- Selecting an option or pin change re-runs allocate and re-renders.

**Acceptance:** pin reflow matches CLI `rescore --pin`; export bundle includes pinned
menu; budget stays exact.

## Section 6a — Fit-only copy-as-prompt (+ fallback toggle)

For thematic/subjective rounds that need external research, build the prompt to
paste into any LLM (no recurring cost, nothing about music scores by default).

- Builder emits: round prompt + description + theme keywords; the song list
  **minus your own**; your **existing fit comments** (manual fit tokens / notes)
  with a "build on these" hint; an explicit "evaluate fit only, ignore music";
  the fit scale; and the required output = the pared-down fit JSON
  (`rawOrderIndex,title,fitTier,fitScore,themesHit,basis,confidence,flags,rationale`).
- Variants: graded, `passFail` (valid/invalid), `passFailMaybe` (pass/questionable/
  fail — ask the LLM to tag arguable entries `maybe` and rank by defensibility).
- **Fallback toggle**: additionally inject music scores + concise point rules +
  budget and ask for `draftVotes` — only for rounds the allocator can't handle.
- Copy button; works without 5b (you can paste back later / use the CLI).

**Acceptance:** the copied prompt contains only fit info by default, excludes your
own song, includes your prior fit notes, and specifies the fit-JSON shape; the
fallback toggle adds music + rules.

## Section 6b — Paste fit JSON back → merge + allocate → render

Close the loop in-page.

- Second `<textarea>` accepts the LLM's fit JSON; parse + validate.
- Run `mergeFitJson(parsed, fitData, profile)` in the browser (manual fit wins,
  LLM fills fit-silent songs, combined computed, draftVotes written back).
- Render the result reusing the `render-fit-html` card layout (tiers, themes,
  rationale, scores) + the vote-transfer table; re-surface tradeoffs (Section 5).

**Acceptance:** pasting a fit JSON yields the same allocation as
`parse-round.mjs --fit` for the same round/profile.

## Section 7 — Mobile polish + import docs (was §6)

- Verify Live Text path on iOS end-to-end.
- Document export → Files → iCloud → `just import-web` loop in README and on-page
  help (step 6 after export ships).
- Responsive pass: tables → cards, large tap targets.

## Notes / deferred

- Vision-LLM / in-app OCR remain out of scope.
- Downvote support follows engine MVP-skippable status.
- Web app never writes `data/` directly — export/import bridge only (Section 4).
