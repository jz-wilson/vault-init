# Sharp Edges

Known traps for future agents and contributors. Siblings: [architecture.md](architecture.md) ·
[integrations.md](integrations.md) · [security.md](security.md) · [operations.md](operations.md).

1. `fmLineNo()`'s `notFound` default equals `fmStart` — callers that *overwrite* the returned line (like `insertBullet`) must pass a `-1` sentinel to distinguish "absent" from "on the first fm line" (`src/frontmatter.ts:61-64`).
2. `extractTagsList()` parses bracket-*mismatched* inline tags (`[a, b`) leniently as an array — any bracket present means inline-array form (`src/frontmatter.ts:84`).
3. `snapshot.ts` cutoff is global: one oversized section in a high-priority file starves ALL later files, by design.
4. Broken-link checking is skipped in explicit (changed-files) mode to keep errors scoped to the named files — pre-commit covers it via `validate-vault.ts --links` (whole-vault link check only, no schema validation); CI's full scan is the backstop.
5. `search.ts` has no stemming/stopwords (explicitly deferred by PRD) and excludes frontmatter from the corpus, but cited line numbers are real file lines.
6. `nightly.ts`'s `RAW_DIR`/`PROCESSED_DIR` are hardcoded `wiki/raw`/`wiki/processed` — vaults without `wiki/raw/` get an explicit "worklist disabled" line from `nightly.ts list` (not a silent zero), but the dirs are still not configurable.
7. Empty scaffolded dirs need `.gitkeep` — the fix-up pass at the end of `scaffold()` handles the standard set; extend it if new dirs are added (`src/init.ts:170-174`).
8. `scaffold()`'s non-empty-target refusal (`--force` override) is a deliberate safety property — don't remove without an explicit ask.
