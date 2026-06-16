---
name: cleanup-code
description: >-
  Audit source files for dead code, unnecessary intermediaries, duplicate logic,
  and other refactoring leftovers that accumulate during iteration. Modifies code
  logic — run before testing is finalized. Use after implementing a feature or
  completing a refactor to tighten up the code. See cleanup-text for prose and
  documentation cleanup.
---

# Cleanup Code

**Scope:** Code logic only. For prose, comments, and documentation cleanup, see `cleanup-text`.

**When to run:** After implementation, before testing is finalized. Changes from this skill may affect runtime behavior (e.g., removing an unused function that was accidentally still called).

## File Discovery

1. If the user specifies files explicitly, use those.
2. Otherwise, run `git diff --name-only` (unstaged + staged) to find all files changed in the current session.
3. Filter to source files only (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.vue`, `.svelte`, etc.). Exclude generated files, lock files, config files, and documentation.
4. Read each file before reviewing it.

## Review Categories

Apply every category to each file.

### 1. Dead code

Code that is defined but never used. This is the highest-priority category — dead code is noise that misleads future readers and agents.

| Signal                        | Example                                                                                    | Suggested fix                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Unused imports                | `import { Foo, Bar } from './utils'` where `Bar` is never referenced                       | Remove `Bar` from the import                         |
| Unused type imports           | `import type { AllowedValue } from './templates'` where `AllowedValue` is never referenced | Remove the type import                               |
| Unused variables or constants | `const limit = 50;` declared but never read                                                | Remove the declaration                               |
| Unused types or interfaces    | `type RowKey = string;` defined but never referenced in the file or imported elsewhere     | Remove (verify with grep first)                      |
| Unused function parameters    | `function process(data, options)` where `options` is never used                            | Remove the parameter (check callers first)           |
| Unused functions or methods   | A helper function defined in the file but never called anywhere in the codebase            | Remove (verify with grep first)                      |
| Unnecessary `export`          | `export const INTERNAL_LIMIT = 50;` but no other file imports it                           | Remove the `export` keyword (verify with grep first) |
| Unreachable code              | Code after an unconditional `return`, `throw`, or `break`                                  | Remove the unreachable lines                         |

**Verification:** Before flagging a function, type, or export as dead, grep the codebase to confirm it has no callers or importers. Only flag with confidence.

**Linter assist:** Manual reading misses imports whose names are substrings of other used symbols (e.g. `Button` imported but only `IButton` used). After the manual review, run the linter on each changed file and check for `no-unused-vars` warnings — these catch what visual scanning cannot.

### 2. Unnecessary intermediaries

Variables, assignments, or conversions that add a layer of indirection without adding clarity or enabling reuse.

| Signal                                      | Example                                                            | Suggested fix                                |
| ------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| Variable assigned once and immediately used | `const cols = TEMPLATE; return cols;`                              | `return TEMPLATE;`                           |
| Re-export without transformation            | `const result = someFunc(); return result;` in a simple function   | `return someFunc();`                         |
| Identity conversion                         | `String(alreadyAString)` or `Number(alreadyANumber)`               | Remove the conversion                        |
| Wrapper that just forwards                  | `function getItems() { return fetchItems(); }` with no added logic | Call `fetchItems()` directly, remove wrapper |

**Judgment call:** An intermediary is fine when the variable name adds meaningful documentation that the expression alone doesn't convey, or when it's used for debugging breakpoints.

### 3. Duplicate logic

Repeated patterns that should be extracted or consolidated.

| Signal                                   | Example                                                         | Suggested fix                                    |
| ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| Copy-pasted blocks with minor variations | Two functions that differ only in a field name                  | Extract a shared function parameterized by field |
| Repeated conditional checks              | Same `if (user.role === 'admin')` guard in 3 places in one file | Extract to a helper or constant                  |
| Identical constant definitions           | Same magic number or string literal defined in multiple places  | Extract to a shared constant                     |

**Threshold:** Flag when 3+ lines are duplicated, or when the same 1-2 line pattern appears 3+ times. Don't flag standard patterns like null checks.

### 4. Leftover refactoring artifacts

Remnants of a prior approach that survived the refactor.

| Signal                                    | Example                                                                | Suggested fix                |
| ----------------------------------------- | ---------------------------------------------------------------------- | ---------------------------- |
| Commented-out code                        | `// const oldHandler = ...` from a replaced implementation             | Remove (it's in git history) |
| TODO/FIXME for completed work             | `// TODO: add modifiedBy` when it was already added                    | Remove the comment           |
| Type assertions that are no longer needed | `as SomeType` where the value already has that type                    | Remove the assertion         |
| Overly defensive checks                   | `if (x !== null && x !== undefined)` when `x` is typed as non-nullable | Simplify or remove           |

### 5. Simplifiable logic

Code that works but could be expressed more directly.

| Signal                                    | Example                                                                       | Suggested fix                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| Boolean comparison                        | `if (isReady === true)`                                                       | `if (isReady)`                                        |
| Ternary returning boolean                 | `condition ? true : false`                                                    | `condition`                                           |
| Unnecessary spread                        | `{ ...obj }` when a reference would suffice and mutation isn't a concern      | Use `obj` directly                                    |
| Array method chain that could be combined | `.filter(...).map(...)` where a single `.reduce()` or `.flatMap()` is clearer | Combine (only when it genuinely improves readability) |

**Caution:** Don't "simplify" code in a way that sacrifices readability for cleverness. The goal is clarity, not brevity.

### 6. Project pattern violations

Code that works but violates conventions documented in the project's rule files. Read the relevant rules before reviewing, then check changed files against their Do/Don't lists and documented patterns.

**Which docs to read** (adapt these paths per project):

| Changed file path       | Sources to check                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `scripts/**/*.mjs`      | `spec/*.md` (scoring, allocation, parsing rules), `.cursor/rules/*.mdc`, and the task skills in `.cursor/skills/` |
| `scripts/one-off/*.mjs` | Same, plus `.cursor/skills/round-artifacts/SKILL.md` for artifact paths                                           |
| `tests/*.test.mjs`      | Existing patterns in the neighboring test files                                                                   |

**Examples:**

| Signal                                               | Example                                                      | Suggested fix                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| Hardcoded analysis/round path instead of `paths.mjs` | `join('analysis', id, 'fit.json')` inline                    | Use `fitPaths(id)` / `scoresPaths(id)` from `scripts/paths.mjs` |
| Re-deriving a value `score-core.mjs` already exports | local `FIT_TIER_SCORES` / `formatScore` copy                 | Import from `scripts/score-core.mjs`                            |
| Code behavior contradicts the spec                   | allocation logic disagreeing with `spec/point-allocation.md` | Align code to spec (`spec/` wins over `.cursor/rules/`)         |

**Judgment call:** Only flag violations in files that were changed during this session. Don't audit the entire codebase — focus on new or modified code that should follow current patterns.

## Procedure

1. **Discover files** per the [File Discovery](#file-discovery) rules.
2. **Read project rule files** relevant to the changed files (see category 6 table).
3. **Read each file.**
4. **Review** each file against all applicable categories.
5. **For dead code (category 1),** run the linter on each changed file and check `no-unused-vars` warnings in addition to manual review. Verify unused exports/functions/types have no callers or importers before flagging.
6. **Report findings** per the [Output Format](#output-format) below.
7. **Ask** whether to apply all fixes, apply selectively, or leave the report for manual review.
8. **Apply** accepted fixes.
9. **Format changed files** to catch anything the auto-formatter missed: `pnpm exec prettier --write <space-separated list of changed file paths relative to frontend/>` in the frontend directory.
10. **Run lint and type checks** after applying fixes to confirm nothing broke.

## Output Format

### Per file

List findings grouped by category. For each finding, include:

- Line number or range
- The current code (abbreviated if long)
- Suggested fix or "remove"

End each file section with a summary count.

If a file is clean, say so in one line: "No issues found."

### Cross-file

Flag duplicate logic that spans multiple files:

```
### Cross-file duplication

The same date-formatting logic appears in both
`DynamicRateTable.tsx` (line 85) and `InvoiceTracker.tsx` (line 112).
Recommend: extract to a shared utility.
```

### Summary

End with a total count across all files:

```
### Summary

6 files reviewed, 2 with findings.
- 3 dead code removals
- 1 unnecessary intermediary
- 0 duplicate logic
- 2 leftover artifacts
- 1 simplifiable expression
- 0 pattern violations
```
