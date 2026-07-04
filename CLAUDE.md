# CLAUDE.md

`vault-init` — bunx CLI scaffolding an agent-coordination + memory vault (plain markdown + git).
All-Node/Bun port of 4 Python vault-tooling scripts. Published: npm `vault-init@0.3.0`, GitHub
`jz-wilson/vault-init`.

## Commands

- `bun test` — 83 `bun:test` cases across 10 files in `test/` (originals ported from Python `--self-check` asserts)
- `bun src/init.ts --yes --dir <path> --preset sre|homelab|okf|blank [--force] [--no-examples] [--nightly]` — scaffold
- `bunx vault-init` — interactive scaffold (clack prompts)
- `bunx vault-init mcp --dir <vault>` — stdio MCP server exposing vault_search + vault_snapshot (offline, read-only)

## Architecture

- `src/frontmatter.ts`, `validate-logs.ts`, `validate-vault.ts`, `capture.ts`, `consolidate.ts` — ports
  of the Python originals; keep behavior-equivalent unless a design doc says otherwise.
- `src/config.ts` — config-driven dir layout (`vault.config.json`: semantic_dirs + episodic_dirs +
  extra_dirs); `type:` enum is **derived**, not hardcoded.
- `src/dashboard.ts`, `src/init.ts` — new, no Python original.
- `src/index.ts`, `snapshot.ts`, `search.ts`, `nightly.ts`, `log-turn.ts` — agentic-OS layer (issue #1):
  per-folder index.md, token-capped identity digest, BM25 lexical search (injectable `ScoreFn` seam),
  wiki/raw worklist + auditable processing, journal per-turn append. All pure-function-over-a-tree,
  zero network/LLM — LLM-driven steps are the invoking agent's job (see templates/hooks/).
- `src/mcp.ts` — MCP server (issue #3): thin adapter exposing `vault_search` and `vault_snapshot` via
  `@modelcontextprotocol/sdk` (the package's 2nd runtime dep). NOT in `OPERATIONAL` — vendored scripts
  stay zero-dep.
- `OPERATIONAL` scripts (init.ts) are **vendored** into every scaffolded vault's `scripts/` —
  self-contained, no network dep at commit time. Keep that list in sync with new src files meant to ship.

## Design decisions — don't relitigate

- Archival decoupled from `verified` (age-only, `completed` + >90d).
- Nightly runs on the machine the vault lives on — `scripts/nightly.sh` scheduled by
  `setupNightly()` in init.ts (systemd user timer → crontab → printed instructions; opt-in via
  `--nightly` or the interactive prompt), never CI. Scaffold always git-inits and makes an
  initial commit; a remote is optional.
- Pre-commit hook **and** CI both run the validator (closes local-hook bypass).
- No build step — bun runs `.ts` directly.

## Gotchas

- **Any user-supplied path fragment needs a traversal guard.** `--note`, `--dir`, `--preset`, and
  `extra_dirs` (from `vault.config.json` or the interactive custom-dirs prompt) all get concatenated
  via `path.join`, which does **not** block `..`. Canonical guard: `resolveInside()` in config.ts
  (resolve + `startsWith(base)`), used by index/snapshot/config loading; `resolvePath()` in capture.ts
  and `assertPlainFilename()` in nightly.ts reject `/`, `\`, `.`, `..` outright; `safeJoin()` in
  init.ts guards scaffold targets. Apply one of these to any new CLI flag or config field that
  reaches a filesystem path. The MCP `--dir` flag is a trust boundary: validated (resolve +
  `vault.config.json` existence check); all per-file paths inside still go through `resolveInside()`.
- **Date comparisons must be pure calendar-date, not epoch-ms.** `consolidate.ts`'s `dateOrNull()`
  parses `YYYY-MM-DD` as UTC midnight; `todayCalendarDate()` recasts the local Y-M-D the same way
  before comparing. Mixing a UTC-midnight date with a raw `new Date()` instant reintroduces
  off-by-a-day drift near TZ boundaries — always run "today" through `todayCalendarDate()` first.
- **Empty dirs don't survive git.** Any dir the scaffolder creates (`scaffold()`'s `allDirs`) needs
  a `.gitkeep` if it might stay empty — the fix-up pass at the end of `scaffold()` already does this
  for the standard dir set; extend it if new dirs are added there.
- `init.ts scaffold()` refuses to write into a non-empty target unless `force: true` (`--force` CLI
  flag) — don't remove this without an explicit ask.
- Python originals (source of truth for port fidelity): vault repo's
  `scripts/{vault_fm,capture,consolidate,validate-agent-logs,validate-vault}.py`.
