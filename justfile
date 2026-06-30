default:
    @just --list

# Parse a round HTML → data/analysis/<round>/music.md + music.json (fuzzy name; flags optional)
parse *args:
    node scripts/ml.mjs parse {{args}}

# Merge music.json + fit.json → scores.json (thematic rounds; fuzzy name)
merge *args:
    node scripts/ml.mjs merge {{args}}

# Record a distribution pick (JSON-only; no HTML re-read)
pick *args:
    node scripts/ml.mjs pick {{args}}

# Render fit-only JSON → data/analysis/<round>/fit.html (fuzzy name; extra flags pass through)
fit *args:
    node scripts/ml.mjs fit {{args}}

# Render merged scores JSON → data/analysis/<round>/scores.html (the deliverable)
scores *args:
    node scripts/ml.mjs scores {{args}}

# Render draft-vote report → scores.html or music.html depending on round state
final *args:
    node scripts/ml.mjs final {{args}}

# Run the next scriptable step for a round (parse or render-fit), or print the manual reminder
run *args:
    node scripts/ml.mjs run {{args}}

# Pipeline checklist + next step (no name = all rounds)
status *args:
    node scripts/ml.mjs status {{args}}

# Show workflow overview or per-command help (parse | merge | pick | final | fit | scores | pin | flags | tidy | config)
help topic="":
    node scripts/ml.mjs help {{topic}}

# Date-slug undated rounds + archive stale ones (also runs at the start of `run`)
tidy *flags:
    node scripts/ml.mjs tidy {{flags}}

# Local CLI preferences (.ml-config.json — comment column width, etc.)
config *args:
    node scripts/ml.mjs config {{args}}

# Lint JS (eslint) + Markdown (markdownlint) without changing files
lint:
    npm run --silent lint

# Auto-fix JS (eslint --fix) + Markdown (markdownlint --fix)
fix:
    npm run --silent fix
