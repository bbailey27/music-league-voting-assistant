---
name: future-unscoped-plans
overview: Make note of potential future changes without a a fully-scoped plan file
status: pending
isProject: false
---

# Future Plans

1. Create a script to identify new round input files without a date in the title. Add today's date following the existing naming pattern. Caveat if run before 5am, add yesterday's date instead. Also run this script at the start of the `run` workflow so names are cleaned up before the associated files are generated.

## Potential refinements (allocation)

Deferred refinements to the center-out smooth allocator (see
[`center-out-smooth-allocation.plan.md`](center-out-smooth-allocation.plan.md)).
Ship R1 + R2 first; only pick these up if real rounds show they're needed.

2. **R3 — semantic score anchors at 75 / 80.** Harden the owner's mental anchors into
   first-class tier behavior rather than just preferred boundary positions:
   - `75` = "definitely actively like the song" → a **funded floor**: a song ≥ 75
     should get at least 1 point in most cases (2 if budget allows). `74` is
     "almost-there" — group it with the 75s when there's space.
   - `76` reads as a **tiebreak** score: clearly clears 75, so promote it ahead of the
     plain 75s when the band has to be split.
   - `80` = "favorite" → the top-tier floor (R2 already merges ≥80; R3 would also
     guarantee the band clears the 1-point baseline).
   Acknowledge that 68–72 is intentionally **fuzzy** — exact scores there are
   inconsistent and shouldn't drive fine-grained tier splits.

3. **R4 — variance-aware gap compression.** Make score distances count for less the
   farther they sit from the center (so `77 → 84` reads as a smaller gap than its raw
   7 points, matching "precise around the average, fuzzier the farther out you get").
   Likely **redundant** once R1 + R2 ship — the unit-step staircase no longer converts
   a large gap into a large point jump — so revisit only if the curve still over-reacts
   to high-end gaps in practice.
