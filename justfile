default:
    @just --list

# Parse a round HTML → analysis/NAME.md + .json (fuzzy name; extra flags pass through)
parse name *flags:
    node scripts/ml.mjs parse "{{name}}" {{flags}}

# Render a fit JSON → analysis/NAME-fit.html (fuzzy name; extra flags pass through)
fit name *flags:
    node scripts/ml.mjs fit "{{name}}" {{flags}}

# Render the final draft-vote report → analysis/NAME.html (cards; merges fit when present)
final name *flags:
    node scripts/ml.mjs final "{{name}}" {{flags}}

# Run the next scriptable step for a round (parse or render-fit), or print the manual reminder
run name:
    node scripts/ml.mjs run "{{name}}"

# Pipeline checklist + next step (no name = one line per round)
status name="":
    node scripts/ml.mjs status "{{name}}"

# Lint JS (eslint) + Markdown (markdownlint) without changing files
lint:
    npm run --silent lint

# Auto-fix JS (eslint --fix) + Markdown (markdownlint --fix)
fix:
    npm run --silent fix
