---
name: "Follow-up 4: Allocation presets, overrides, downvotes"
overview: Extend the deterministic allocator beyond the MVP relative draft with selectable distribution shapes, manual overrides, pre-allocation floors, and downvote support.
status: pending
depends_on: MVP (relative draft allocator)
isProject: false
---

# Follow-up 4: Allocation presets, overrides, downvotes

## Scope
- Distribution presets refining the relative round-aware tiering: `compressed` / `balanced` / `top-heavy` (selectable; default balanced).
- Manual per-song vote overrides that re-balance the remaining budget.
- Honor `userAllocatedVotes` (pre-allocated `data-weight`) as a floor; when pre-allocations exceed budget, list candidates to lower instead of silently rebalancing.
- Downvote support when `downvotesEnabled`: spend `downvoteBankSize` (respecting `maxDownvotesPerSong`); `isDisqualified` songs become downvote candidates.

## Notes
- Keep the existing intent from `spec/point-allocation.md`: adaptive, relative to the quality spread actually present, avoid artificial equality.
