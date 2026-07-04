# Sharp Edges

Known traps for future agents and contributors. Siblings: [architecture.md](architecture.md) ·
[integrations.md](integrations.md) · [security.md](security.md) · [operations.md](operations.md).

1. `fmLineNo()`'s `notFound` default equals `fmStart` — callers that *overwrite* the returned line (like `insertBullet`) must pass a `-1` sentinel to distinguish "absent" from "on the first fm line" (`src/frontmatter.ts:61-64`).
2. `extractTagsList()` parses bracket-*mismatched* inline tags (`[a, b`) leniently as an array — any bracket present means inline-array form (`src/frontmatter.ts:84`).
3. `snapshot.ts` packing is greedy-skip: an oversized section is skipped but the walk continues, so later sections/files can still land — a file whose sections all get skipped emits no `#` marker line. (Changed 2026-07-04 from stop-everything cutoff.)
4. Broken-link checking is skipped in explicit (changed-files) mode to keep errors scoped to the named files — pre-commit covers it via `validate-vault.ts --links` (whole-vault link check only, no schema validation); CI's full scan is the backstop.
5. `search.ts` has no stemming/stopwords (explicitly deferred by PRD) and excludes frontmatter from the corpus, but cited line numbers are real file lines.
6. `nightly.ts`'s `RAW_DIR`/`PROCESSED_DIR` are hardcoded `wiki/raw`/`wiki/processed` — vaults without `wiki/raw/` get an explicit "worklist disabled" line from `nightly.ts list` (not a silent zero), but the dirs are still not configurable.
7. Empty scaffolded dirs need `.gitkeep` — the fix-up pass at the end of `scaffold()` handles the standard set; extend it if new dirs are added (`src/init.ts:170-174`).
8. `scaffold()`'s non-empty-target refusal (`--force` override) is a deliberate safety property — don't remove without an explicit ask.
9. `runMcp` has a setup gate: it throws at startup unless the vault is linked machine-wide (`isLinked()` — global SessionStart snapshot hook in `CLAUDE_CONFIG_DIR ?? ~/.claude`/settings.json). A scaffolded vault's own `.mcp.json` therefore does NOT work until `link`/`doctor` has run once; tests spawning the server must pre-link a scratch `CLAUDE_CONFIG_DIR` (see `linkedCfgDir()` in test/mcp.test.ts).
10. `src/init.ts` is import-safe only because its `runMain(main)` is behind `import.meta.main` — doctor.ts imports `OPERATIONAL`/`writeMcpJson`/`ensureVaultDirEnv` from it. Don't add module-level side effects to init.ts.
11. Scaffold and `doctor --fix` write `export VAULT_DIR=...` into the user's shell profile (`~/.zshrc`/`~/.bashrc`/`~/.profile`) when `$VAULT_DIR` is unset — but only when stdout is a TTY (`ensureVaultDirEnv`'s `interactive` param, `src/init.ts`). Piped/spawned runs (tests, CI, scripts) print the export line instead of writing. The residual trap is TTY-inheriting wrappers like `task scaffold` run from a terminal — those still must pin `VAULT_DIR` in env (Taskfile does).
