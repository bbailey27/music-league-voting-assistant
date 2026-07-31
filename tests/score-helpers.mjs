// Shared helpers for score-core test modules.

export const mk = (scores, extra = {}) =>
  scores.map((score, i) => ({ title: `s${i}`, rawOrderIndex: i, score, ...extra }));

export function sum(songs) {
  return songs.reduce((a, s) => a + (s.finalVotes || 0), 0);
}

export function sumDown(songs) {
  return songs.reduce((a, s) => a + (s.finalDownvotes || 0), 0);
}

export function downProfile(extra = {}) {
  return {
    shape: 'auto',
    downvotesEnabled: true,
    downvoteBudget: 3,
    downvoteCap: 1,
    downShape: 'curved',
    ...extra,
  };
}

export function distinctVotes(songs) {
  return new Set(songs.map((s) => s.finalVotes)).size;
}

export function assertMonotonicSmooth(g, label = '') {
  for (let i = 1; i < g.length; i++) {
    const gap = g[i - 1].score - g[i].score;
    const jump = g[i - 1].finalVotes - g[i].finalVotes;
    if (gap <= 2 && jump > 1) {
      throw new Error(`${label}: small score gap ${gap} caused large vote jump ${jump}`);
    }
  }
}

export function assertContiguous(votes, label = '') {
  const uniq = [...new Set(votes)].sort((a, b) => b - a);
  for (let i = 1; i < uniq.length; i++) {
    if (uniq[i - 1] - uniq[i] > 1) {
      throw new Error(`${label}: non-contiguous tiers ${uniq.join(', ')}`);
    }
  }
}
