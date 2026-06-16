---
name: cleanup-text
description: >-
  Review files for overcorrection artifacts, redundant repetition, bloated
  wording, and structural inconsistencies that accumulate during long iteration
  sessions. Covers prose, comments, and documentation — not code logic. Safe to
  run right before committing. Use after a long back-and-forth editing session
  to tighten up the result. See cleanup-code for code logic cleanup.
---

# Cleanup Text and Documentation

Review files changed during a session and flag overcorrection artifacts, redundant repetition, verbose wording, and structural inconsistencies in prose and documentation. Does not modify code logic — see `cleanup-code` for that. Suggest concrete rewrites.

## File Discovery

1. If the user specifies files explicitly, use those.
2. Otherwise, run `git diff --name-only` (unstaged + staged) to find all files changed in the current session.
3. Filter out generated and lock files (`pnpm-lock.yaml`, `package-lock.json`, `*.plan.md` frontmatter sections, `dist/`, `node_modules/`).
4. Read each remaining file before reviewing it.

## Review Categories

Apply every category to each file, adapted by file type (see [File-Type Adaptations](#file-type-adaptations)).

### 1. Overcorrection artifacts

Phrasing that corrects a specific past mistake rather than stating a general principle. A fresh reader — human or agent — would not make the mistake being warned against, so the warning adds noise.

Signals:

| Signal | Example | Suggested fix |
|--------|---------|---------------|
| Negative guard that restates what positive guidance already covers | "Do not assume forms live in GridEditModal — search by reference instead" | Keep only the positive: "Search by endpoint function reference to find callers" |
| "Not exhaustive" / "not always" disclaimers on things that are obviously variable | "This list is not exhaustive" after a clearly illustrative list | Remove the disclaimer |
| Bold/italic emphasis on instructions that are already unambiguous | "**Always** search by reference" when the sentence is already imperative | Remove the emphasis |
| Extended justification for a straightforward rule | Two sentences explaining *why* a one-line rule is correct | Keep the rule, drop the justification |
| "Do not do X" where "Do Y" is sufficient and clearer | "Do not paper over the mismatch with coercion. Align the declarations." | "Align the declarations" |

### 2. Redundant repetition

The same concept explained in multiple places within a file, or across files in the changeset.

| Signal | Example | Suggested fix |
|--------|---------|---------------|
| A later step re-explains what an earlier step already covered | Step 4 re-explains how to look up grid names after Step 1 already did | Step 4: "Using the grid names from Step 1, ..." |
| A quick-reference section copies details verbatim from the full procedure | Quick check list repeats full-procedure bullet points word for word | Quick reference should summarize or cross-reference |
| Adjacent code comments say the same thing | `// Convert to camelCase` above a function named `convertToCamelCase` | Remove the comment |
| Cross-file: identical guidance in a rule file and a skill file | Same instruction in `.cursor/rules/foo.mdc` and `.cursor/skills/bar/SKILL.md` | Pick one source of truth, reference it from the other |

### 3. Verbose wording

Sentences or structures that could be shorter without losing actionable information.

| Signal | Example | Suggested fix |
|--------|---------|---------------|
| Multi-sentence explanation where one suffices | "The backend sends colDefs. These colDefs define columns. Columns appear in the grid." | "The backend sends colDefs that define grid columns." |
| Bullet list where a single sentence would do | Three bullets that each add one word of nuance | Merge into one sentence |
| Qualifying clauses that add nothing actionable | "It is worth noting that, in general, ..." | Delete the qualifier, state the point directly |

### 4. Structural inconsistencies

Formatting issues introduced by incremental edits.

| Signal | Example | Suggested fix |
|--------|---------|---------------|
| Heading level mismatch | `##` sibling next to `###` siblings under the same parent | Fix the heading level |
| Inconsistent list style | Numbered list mixed with bullet list in the same sequence | Pick one style |
| Orphaned cross-references | "See Step 5" after steps were renumbered, now pointing to the wrong step | Update the reference |
| Inconsistent terminology | Same concept called "grid name" in one place and "GridNames entry" in another | Pick one term and use it throughout |

### 5. Stale references

References to things that no longer exist or have been renamed.

| Signal | Example | Suggested fix |
|--------|---------|---------------|
| Comment references a removed variable or parameter | `// Uses the old fiscalPeriod format` after the field was renamed | Update or remove the comment |
| Instruction references a file path that moved | "Check `utils/helpers.ts`" but the file is now `lib/helpers.ts` | Update the path |
| Example uses old field/interface names | Example shows `IStaffRate` but the interface is now `IStaffLaborRate` | Update the example |

### 6. Non-American spelling

The project standard is American English. Flag British or other non-American spellings in prose, comments, and documentation.

| Signal | Example | Suggested fix |
|--------|---------|---------------|
| British spelling variant | "Behaviour", "synchronise", "colour", "cancelled" | American form: "Behavior", "synchronize", "color", "canceled" |

## File-Type Adaptations

| File type | Categories to apply | Focus |
|-----------|-------------------|-------|
| Skill files (`.md` in `.cursor/skills/`) | All 6 | Prose clarity, structural consistency, procedure accuracy |
| Rule files (`.mdc` in `.cursor/rules/`) | 1, 2, 3, 4, 6 | Conciseness — rules are injected into every conversation, so brevity matters |
| Plan files (`.plan.md`) | 1, 2, 3, 4, 6 | Actionability — plans should be scannable checklists, not essays |
| Code files (`.ts`, `.tsx`, `.py`, etc.) | 2, 3, 5, 6 | Comments and docstrings only — do not touch code logic (use `cleanup-code` for that). Flag comments that narrate what the code does rather than explaining non-obvious intent |

## Procedure

1. **Discover files** per the [File Discovery](#file-discovery) rules.
2. **Read each file.**
3. **Review** each file against all applicable categories.
4. **Report findings** per the [Output Format](#output-format) below.
5. **Ask** whether to apply all fixes, apply selectively, or leave the report for manual review.
6. **Apply** accepted fixes.

## Output Format

### Per file

List findings grouped by category. For each finding, include:
- **Location hint** (see table below)
- The current text (abbreviated if long)
- Suggested rewrite or "remove"

End each file section with a summary count, e.g.: `3 overcorrections, 2 redundancies, 1 structural fix`.

If a file is clean, say so in one line: "No issues found."

Use line numbers for all files except `.plan.md` — those render without line numbers in the Plans UI, so use the section heading + full sentence or bullet text instead.

### Cross-file

If the same concept is repeated across multiple files in the changeset, flag it after the per-file sections:

```
### Cross-file redundancy

The instruction "search by endpoint function reference" appears in both
`SKILL.md` (line 147) and `frontend-project-context.mdc` (line 42).
Recommend: keep in `SKILL.md`, remove from the rule file or replace with
a cross-reference.
```

### Summary

End with a total count across all files:

```
### Summary

4 files reviewed, 3 with findings.
- 5 overcorrection artifacts
- 3 redundancies
- 2 verbose passages
- 1 structural inconsistency
- 0 stale references
- 0 non-American spellings
```
