# Music League Agent v1

Input: HTML or Raw text copied from the Music League voting page after filling in your notes and scores for each song.
Output: Ranked table allocating the proper number of points to the songs.

Rulesets can be adjusted to the user's preferred notation style.

Use HTML exports when possible.

Recommended workflow:
1. Place round export in rounds/
2. Ask Cursor to analyze the round
3. Save results to analysis/
4. Add regression tests whenever a failure mode is discovered
