---
name: "Follow-up 2: Client-side web app (desktop + mobile, no CLI)"
overview: A zero-build, fully client-side GitHub Pages app that runs the existing deterministic flow (extract → score → allocate) with no CLI, plus a fit-only copy-prompt and a paste-back merge step. Built in independently-shippable sections so progress is visible on a phone from the very first one.
status: pending
depends_on: "Plan A (deterministic allocation engine) — DONE; Follow-up 1 (text/Live-Text parser) — DONE"
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
                                     │             4. Tradeoffs & decisions
                                     ▼                      │
                              5a. Fit copy-prompt ──▶ 5b. Paste fit JSON back
                                     │
                                     ▼
                              6. Mobile polish + docs
```

Dependencies: 2→1, 3→2, 4→3, 5a→2 (only needs parsed songs; can be pulled earlier),
5b→3+5a, 6→1+2. Sections 1–3 give a complete tool for plain/objective rounds;
4 adds decision handling; 5 adds the LLM fit loop; 6 hardens mobile.

---

## Section 1 — App shell + hosting

Stand up the page and deployment first so the rest is testable on device.

- `docs/index.html`: single page, mobile-first responsive layout, light/dark
  (reuse the `render-fit-html.mjs` design language — card layout, tier hues,
  `prefers-color-scheme`). Loads `docs/app.js` as `<script type="module">`.
- `docs/app.js`: ES-module entry that `import`s `../scripts/score-core.mjs` and
  `../scripts/extract-html.mjs` directly (they're already browser-safe ESM). A
  smoke "it loaded + core is wired" indicator.
- **Hosting**: enable GitHub Pages, Source = `main` `/docs` →
  `https://<user>.github.io/<repo>/`. Document the exact clicks in `README.md`.
- Decide module loading: import `scripts/*.mjs` via relative path from `docs/`
  (no copy/duplication). Confirm `parse-text.mjs` / `extract-html.mjs` only use
  standard DOM + JS (they do) so no shim is needed.

**Acceptance:** page loads on desktop + iOS Safari with no console errors, no
network requests, no build; core functions are callable from the page.

## Section 2 — Paste & parse

Turn pasted input into the canonical song list + round metadata.

- Paste `<textarea>` + a round-mode selector (objective / subjective / thematic).
- Auto-detect input type: HTML (saved round) vs text (Live Text). HTML → native
  `DOMParser` then `parseRoundDocument(document, mode)`; text → `parseRoundText`
  (strict if anchors present, else the footer-anchored lenient path).
- Render the extracted **raw-order table** (#, title, artist, album, comment,
  parsed score/flags) plus the **needs-score / disqualified / needs-review**
  lists. Lenient rows visibly flagged "verify".
- Show parse confidence (strict vs lenient; budget found or not).

**Acceptance:** pasting a saved HTML round and the Live Text K-pop sample both
produce the same songs/scores the CLI does (cross-check against the regression
fixture); empty boxes show as needs-input, `7-?` → 70 −/?.

## Section 3 — Allocation & output display

Run the deterministic allocator and present votes.

- Allocation-profile controls: `rankBy` (music/fit/combined), `shape`
  (auto/bell/compressed/balanced/top-heavy/relative), optional `gate`
  (cutoff axis+min / passFail / passFailMaybe), weights for combined.
- Call `allocate(songs, budget, cap, profile)`; render the **ranked table** and
  the **raw-order vote-transfer table** with a total, mirroring the markdown/HTML
  reports. Per-song final votes + tier coloring.
- Copy buttons: vote-transfer table (the copy-back-into-Music-League view).
- Surface budget/cap and "X of N eligible" summary.

**Acceptance:** votes total the budget exactly; output matches the CLI for the
same round + profile; switching shape/rankBy updates live.

## Section 4 — Tradeoffs & user-interaction / decision flows

Make the `tradeoffs[]` the allocator emits interactive instead of informational.

- Render each tradeoff as a choice card by `kind`:
  - `tier-split` — pick who gets the indivisible extra (sets an `override`).
  - `maybe-band` — slider/buttons for how many questionable entries to fund
    (sets `gate.leniency` or `includeCount`).
  - `preallocation-overflow` — choose which floored song to lower.
  - `forced-spill` — acknowledge / reassign the leftover.
- Selecting an option re-runs `allocate` with the updated profile/overrides and
  re-renders (the engine already supports `overrides` for exactly this).
- Show a clear before/after and a "reset to auto" affordance.

**Acceptance:** each tradeoff kind renders, a choice deterministically changes the
allocation and re-renders, and the budget still totals exactly.

## Section 5a — Fit-only copy-as-prompt (+ fallback toggle)

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

## Section 5b — Paste fit JSON back → merge + allocate → render

Close the loop in-page.

- Second `<textarea>` accepts the LLM's fit JSON; parse + validate.
- Run `mergeFitJson(parsed, fitData, profile)` in the browser (manual fit wins,
  LLM fills fit-silent songs, combined computed, draftVotes written back).
- Render the result reusing the `render-fit-html` card layout (tiers, themes,
  rationale, scores) + the vote-transfer table; re-surface tradeoffs (Section 4).

**Acceptance:** pasting a fit JSON yields the same allocation as
`parse-round.mjs --fit` for the same round/profile.

## Section 6 — Mobile polish + docs

- Verify the OS Live Text paste path end-to-end on iOS (the motivating
  constraint: Music League's third-party login forces an in-app browser where
  page text can't be selected, so Live Text/Lens is the bridge — extraction only,
  no in-app OCR, no LLM).
- Responsive pass: tables collapse to cards on narrow screens, large tap targets,
  copy buttons reachable one-handed.
- README: hosting steps, the mobile capture workflow, and the fit-prompt loop.

**Acceptance:** a full round can be pasted, scored, allocated, and the votes
copied back — entirely on a phone, offline after first load.

## Notes / deferred

- Vision-LLM screenshot input and in-app OCR (Tesseract.js) remain out of scope
  (no recurring cost for routine runs). The copy-prompt covers the opt-in LLM case.
- Downvote support follows the engine's MVP-skippable status.
