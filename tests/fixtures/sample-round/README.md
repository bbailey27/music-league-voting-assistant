# Sample round fixture

Synthetic Music League round for docs and tests — not a real league export.

| File | Role |
| --- | --- |
| `sample-round.html` | Saved-round HTML with prompt, **description**, and four song slots (one own submission) |
| `music.json` | Representative music-only parse output (regenerate with the command below) |

Regenerate `music.json`:

```bash
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'fs';
import { parseHTML } from 'linkedom';
import { parseRoundDocument } from './scripts/extract-html.mjs';
import { allocate, buildJsonPayload, enrichProfileWithBudget } from './scripts/score-core.mjs';
const html = readFileSync('tests/fixtures/sample-round/sample-round.html','utf8');
const { document } = parseHTML(html);
const parsed = parseRoundDocument(document, 'subjective');
const profile = enrichProfileWithBudget({ shape: 'auto' }, parsed.budget);
const { tradeoffs } = allocate(parsed.songs, parsed.budget.upvoteBankSize, parsed.budget.maxUpvotesPerSong, profile);
writeFileSync('tests/fixtures/sample-round/music.json', JSON.stringify(buildJsonPayload({ ...parsed, mode: 'subjective', tradeoffs }), null, 2));
"
```

Use this path instead of real `rounds/` files in documentation examples so archiving live rounds never breaks tests.
