default:
    @just --list

# Parse a round HTML → data/analysis/<round>/music.md + music.json (fuzzy name; extra flags pass through)
parse name *flags:
    node scripts/ml.mjs parse "{{name}}" {{flags}}

# Render fit-only JSON → data/analysis/<round>/fit.html (fuzzy name; extra flags pass through)
fit name *flags:
    node scripts/ml.mjs fit "{{name}}" {{flags}}

# Render merged scores JSON → data/analysis/<round>/scores.html (the deliverable)
scores name *flags:
    node scripts/ml.mjs scores "{{name}}" {{flags}}

# Render draft-vote report → scores.html or music.html depending on round state
final name *flags:
    node scripts/ml.mjs final "{{name}}" {{flags}}

# Run the next scriptable step for a round (parse or render-fit), or print the manual reminder
run name:
    node scripts/ml.mjs run "{{name}}"

# Pipeline checklist + next step (no name = one line per round)
status name="":
    node scripts/ml.mjs status "{{name}}"

# Date-slug undated rounds + archive stale ones (also runs at the start of `run`)
tidy *flags:
    node scripts/ml.mjs tidy {{flags}}

# Lint JS (eslint) + Markdown (markdownlint) without changing files
lint:
    npm run --silent lint

# Auto-fix JS (eslint --fix) + Markdown (markdownlint --fix)
fix:
    npm run --silent fix
