# ── Start every round here ─────────────────────────────────────────
# Copy the round HTML to your clipboard, then:
#     just save-round <slug>    e.g. just save-round 5th-gen-bg
# After that: just run <slug> walks you through the pipeline (or "just help").

# Pass recipe args as "$@" so quoted values (e.g. --reason "…") reach node intact.
set positional-arguments

default:
    @just --list

# Sync browser-safe modules into docs/lib/ (required before deploy — GitHub Pages only publishes docs/)
sync-web:
    node scripts/sync-web-lib.mjs

# Preview the phone/web vote assistant locally (serves docs/ as site root)
web:
    just sync-web
    npx --yes serve docs

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

# Lint JS (eslint) + Markdown (markdownlint) without changing files.
# Also fails if AGENTS.md is stale (rules changed without `just agents`).
lint:
    npm run --silent lint
    @node scripts/sync-agents-md.mjs --check

# Regenerate AGENTS.md from .cursor/rules/*.mdc (run after editing any rule there)
agents:
    node scripts/sync-agents-md.mjs

# Auto-fix JS (eslint --fix) + Markdown (markdownlint --fix)
fix:
    npm run --silent fix

# Save clipboard HTML as a round file. Example: just save-round 5th-gen-bg
save-round slug:
    pbpaste > data/rounds/{{slug}}.html
    @echo "Saved data/rounds/{{slug}}.html ($(wc -c < data/rounds/{{slug}}.html | tr -d ' ') bytes)"
