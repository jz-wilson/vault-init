# CLAUDE.md

`vault-init` — bunx CLI scaffolding an agent-coordination + memory vault (plain markdown + git).
Bun port of 4 Python vault-tooling scripts + agentic-OS layer. npm `vault-init@0.4.2`, GitHub `jz-wilson/vault-init`.

**`docs/` is the architecture memory** — `architecture.md` (flows, data structures, topography),
`integrations.md` (module graph, git/systemd/MCP), `security.md` (traversal-guard table),
`operations.md` (conventions), `sharp-edges.md` (known traps). Read the relevant file before
nontrivial changes; keep docs current when architecture shifts. This file holds only commands +
rules that prevent breakage.

## Commands

- `bun test` — 114 cases, 13 files. The only gate (CI runs exactly this); no lint/typecheck.
- `bun src/init.ts --yes --dir <path> --preset sre|homelab|okf|blank [--force] [--no-examples] [--nightly]`
- `bunx vault-init` — interactive scaffold · `bunx vault-init mcp --dir <vault>` — MCP server
- `bunx vault-init link --dir <vault>` (or `bun run link` in vault) — register vault machine-wide
  with Claude Code: user-scope MCP + global SessionStart hook + `~/.claude/CLAUDE.md` pointer
- `bunx vault-init doctor [--dir <vault>] [--fix|--force|--skip-mcp]` — report-only by default;
  `--fix` repairs (re-vendor missing scripts, restore integration files, hooksPath, $VAULT_DIR
  export, link). `mcp` refuses to start for an unlinked vault and points here; `runMain` errors
  carry the same hint.
- `--dir` defaults to `$VAULT_DIR` everywhere (scaffold/doctor persist the export into the shell
  profile when unset — TTY-gated, so piped/spawned runs never write it). TTY-inheriting wrappers
  (`task scaffold` from a terminal) still pin `VAULT_DIR` in env.
- `task scaffold` / `task dashboard` / `task clean` — smoke-vault dev loop (`/tmp/vault-init-smoke`)

## Hard rules

- **Two tiers in `src/`**: the `OPERATIONAL` list in init.ts (13 files) is vendored into every
  scaffolded vault's `scripts/` — must stay zero-dep (`node:*` + each other only). `init.ts` and
  `mcp.ts` are package-only (`mcp.ts` uses the MCP SDK — never add it to OPERATIONAL). New src
  files meant to ship go on the list.
- **Any user-supplied path fragment needs a traversal guard** — `path.join` doesn't block `..`.
  Use `resolveInside()` (config.ts), `safeJoin()` (init.ts), or the plain-filename rejects in
  capture.ts/nightly.ts. Full table: docs/security.md.
- **Route note mutations through `insertBullet()`** (capture.ts) — its validate-or-rollback is
  the write-safety pattern; no parallel insert logic.
- **Date comparisons are pure calendar-date**: run "today" through `todayCalendarDate()`
  (consolidate.ts) before comparing to `dateOrNull()` output — raw `new Date()` drifts a day
  near TZ boundaries.
- **Ports stay behavior-equivalent to Python originals** (`frontmatter`, `capture`, `consolidate`,
  `validate-logs`, `validate-vault`) unless a design doc says otherwise. Originals: vault repo's
  `scripts/{vault_fm,capture,consolidate,validate-agent-logs,validate-vault}.py`.
- Zero network/LLM in this codebase — LLM steps belong to the invoking agent (templates/hooks/).
- No build step — bun runs `.ts` directly.

## Design decisions — don't relitigate

- Archival age-only (`completed` + >90d), decoupled from `verified`.
- Nightly runs on the vault's machine (`setupNightly()`: systemd user timer → crontab →
  instructions), never CI. Scaffold always git-inits + initial commit; remote optional.
- Scaffolded vault gets **both** pre-commit hook and CI validator (closes local-hook bypass).
- Search: no stemming/stopwords, in-memory corpus per invocation. Snapshot: greedy-skip
  packing (oversized section skipped, walk continues), chars/4 token estimate.
- `scaffold()` refuses non-empty target without `--force` — don't remove.

## Gotchas (edit-time traps)

- Empty scaffolded dirs need `.gitkeep` — extend `scaffold()`'s fix-up pass if adding dirs.
- `fmLineNo()` `notFound` defaults to `fmStart` — pass `-1` sentinel when overwriting the line.
- Broken-link check: full scans + `--links` mode (pre-commit uses the latter); skipped in explicit changed-files mode.
- `nightly.ts` hardcodes `wiki/raw`/`wiki/processed`; those dirs are schema-exempt on full scans.
