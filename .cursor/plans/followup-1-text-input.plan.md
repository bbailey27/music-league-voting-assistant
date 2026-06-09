---
name: "Follow-up 1: Text + Live-Text input"
overview: Add a zero-dependency raw-text (.txt) parser path and a lenient visible-text mode (for OS Live Text / Lens paste), feeding the same canonical schema and scorer as the HTML MVP.
status: pending
depends_on: MVP (Pride Round MVP Parser)
isProject: false
---

# Follow-up 1: Text + Live-Text input

Independent of the HTML MVP; reuses its canonical schema and `score-core`.

## Scope
- Refactor the MVP parser so HTML and text both emit the same canonical song list, then share one scorer.
- Text path against [rounds/2026-06-08-pride.txt](rounds/2026-06-08-pride.txt):
  - `Album art` block delimiter; positional `title` / `artist` / `album`; standalone integer = `userAllocatedVotes`.
  - `\d+ / 1000` footer is the user-comment length anchor (`0` = empty → `needsUserInput`).
  - Leading-space-indented block(s) = `submitterComment` (scoring-neutral); text before the footer at column 0 = `userComment`.
  - `You submitted this song` → skip block; `N of M` line above the list = budget.
  - On ambiguity (count vs indent disagree) → `needsReview`.
- Lenient/Live-Text mode: when `Album art` / `N / 1000` anchors are absent, group visible lines into songs heuristically and set `needsReview` generously.

## Done when
- Text output matches HTML output for the committed sample (counts, own-skip, budget, a few specific songs).
