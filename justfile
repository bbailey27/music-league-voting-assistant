# Pass recipe args as "$@" so quoted values (e.g. --reason "…") reach node intact.
set positional-arguments

default:
    @just --list

# Parse a round HTML → data/analysis/<round>/music.md + music.json (fuzzy name; flags optional)
parse *args:
    node scripts/ml.mjs parse "$@"

# Merge music.json + fit.json → scores.json (thematic rounds; fuzzy name)
merge *args:
    node scripts/ml.mjs merge "$@"

# Record a distribution pick (JSON-only; no HTML re-read)
pick *args:
    node scripts/ml.mjs pick "$@"

# Re-weight/re-shape + re-allocate the draft menu from JSON (no HTML re-read; resets any pick)
rescore *args:
    node scripts/ml.mjs rescore "$@"

# Render fit-only JSON → data/analysis/<round>/fit.html (fuzzy name; extra flags pass through)
fit *args:
    node scripts/ml.mjs fit "$@"

# Render merged scores JSON → data/analysis/<round>/scores.html (the deliverable)
scores *args:
    node scripts/ml.mjs scores "$@"

# Render draft-vote report → scores.html or music.html depending on round state
final *args:
    node scripts/ml.mjs final "$@"

# Run the next scriptable step for a round (parse or render-fit), or print the manual reminder
run *args:
    node scripts/ml.mjs run "$@"

# Pipeline checklist + next step (no name = all rounds)
status *args:
    node scripts/ml.mjs status "$@"

# Show workflow overview or per-command help (parse | merge | pick | final | fit | scores | pin | flags | tidy | config)
help *args:
    node scripts/ml.mjs help "$@"

# Date-slug undated rounds + archive stale ones (also runs at the start of `run`)
tidy *args:
    node scripts/ml.mjs tidy "$@"

# Local CLI preferences (.ml-config.json — comment column width, etc.)
config *args:
    node scripts/ml.mjs config "$@"

# Diff pipeline output for the sample fixture against the committed baseline
# (add `-- --update` to regenerate the baseline after an intended change)
test-regression *args:
    node scripts/regression-snapshot.mjs "$@"

# Lint JS (eslint) + Markdown (markdownlint) without changing files
lint:
    npm run --silent lint

# Auto-fix JS (eslint --fix) + Markdown (markdownlint --fix)
fix:
    npm run --silent fix
