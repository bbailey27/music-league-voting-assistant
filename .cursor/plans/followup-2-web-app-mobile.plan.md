---
name: "Follow-up 2: Client-side web app (GitHub Pages)"
overview: Package the parser + scorer as a zero-build, fully client-side GitHub Pages app so a round can be pasted, extracted, and scored from mobile.
status: pending
depends_on: MVP + Follow-up 1 (text/Live-Text)
isProject: false
---

# Follow-up 2: Client-side web app (GitHub Pages)

## Scope
- Refactor the core to be environment-agnostic: standard DOM `querySelector` + pure string logic, with the HTML parser injected (native `DOMParser` in browser, `linkedom` in Node CLI). Move shared logic to `docs/extract-core.mjs` + `docs/score-core.mjs`.
- `docs/index.html` + `docs/app.js`: paste textarea, round-mode selector, Extract+Score button, computed final tables, a `needsResearch` / `needsUserInput` list, and Copy / Copy-as-prompt buttons. No network calls, no deps in the browser.
- Enable GitHub Pages: Source = `main` `/docs` → `https://<user>.github.io/<repo>/`.

## Notes
- Motivating constraint: the Music League third-party login flow forces the mobile in-app browser where page text can't be copied. Mitigation = OS Live Text paste (Follow-up 1) into this page.
- Extraction/scoring only; research still happens in the assistant.
