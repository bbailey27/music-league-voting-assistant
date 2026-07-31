# Comment Interpretation

## User vs submitter (scoring contract)

| Field | Role |
| --- | --- |
| **User comment** (`userComment`) | **Sole scoring source** — music/fit numbers, gates, modifiers |
| **Submitter comment** (`submitterComment`) | Context only — why they submitted; never changes scores or allocation |

Do not infer scores from the submitter quote. Preserve both strings verbatim in
outputs when practical. Full input rules: [round-input-parsing.md](round-input-parsing.md).

Comments may belong to the submitter or the user; do not assume ownership if unclear.

Comments may contain:

- reactions
- fit analysis
- score notes
- alternate score candidates
- fit and music scores simultaneously

Examples:
'75 for chorus, lower for verses'
'72 music, 8 fit'

These are valid scoring evidence and should not be discarded. See
[scoring-comments.md](scoring-comments.md) for how to write music and fit scores;
[score-parsing.md](score-parsing.md) for parser details.

Terms such as:

- red boxed
- yellow boxed
- beat me to it

are Music League slang and usually indicate the user attempted to submit the same song. Do not automatically convert these into score bonuses. Preserve them and consider them contextually.
