# vault-init

Scaffold an **agent-coordination + memory vault** — a plain-markdown + git workspace where
multiple AI agents write structured task logs, an operator reviews them, and durable facts
distill into a deduped semantic tier. Opens as an [Obsidian](https://obsidian.md) vault, but
the agent loop needs nothing but [`bun`](https://bun.sh) and `git`.

```bash
bunx vault-init                 # interactive
bunx vault-init --yes --preset sre --name work --dir ./work-vault    # scripted
```

Scripted flags: `--force` (overwrite non-empty target), `--no-examples` (skip demo notes),
`--nightly` (schedule nightly maintenance on this machine — see below).

Every scaffold git-inits the vault and makes an initial commit. A remote is optional; the
vault is fully functional local-only.

## What you get

```
work-vault/
  agents/<name>/reports/   per-agent task logs (the coordination layer)
  runbooks/ services/ …    semantic notes — deduped current facts
  incidents/ decisions/    episodic notes — monthly dated logs
  scripts/*.ts             12 vendored zero-dep scripts (full list below)
  scripts/nightly.sh       nightly maintenance runner (validate → index → dashboard → worklist)
  scripts/hooks/*.md       wiring docs: session-start snapshot, per-turn logging, nightly automation
  .githooks/pre-commit     schema gate (local) + auto-regenerated per-folder indexes
  .github/workflows/       schema gate (server-side — closes the local-hook bypass)
  vault.config.json        the one place directories are configured
  _format.md AGENTS.md     the schema + agent protocol (single source of truth)
  IDENTITY.md ALWAYS.md NEVER.md   snapshot source files (who am I / hard rules)
  SEED-PROMPT.md           hand to an AI to populate content
```

## The model

Three memory tiers, mapped to note types:

| Tier | Notes | Behavior |
|---|---|---|
| **Episodic** | agent logs, `episodic_dirs` | raw, dated, append-only monthly files |
| **Semantic** | `semantic_dirs`, concepts | deduped current facts; distillation target |
| **Procedural** | tracked `AGENTS`/`IDENTITY` + agent auto-memory | preferences, working style |

The review loop, all `bun scripts/<name>.ts`:

```
agent writes log (active)
  → pre-commit hook + CI validate schema     validate-logs.ts / validate-vault.ts
  → dashboard surfaces status                dashboard.ts   (headless, no Obsidian)
  → operator reviews → verified: true
  → consolidate flags stale semantic links   consolidate.ts
  → capture folds facts into semantic notes  capture.ts
  → consolidate --apply archives logs >90d   (age-only, not gated on review)
```

## The scripts

Vendored into `scripts/` — self-contained, zero dependencies, run with `bun scripts/<name>.ts`
or the `bun run <alias>` entries in the vault's package.json:

| Script | Does |
|---|---|
| `validate-vault.ts` | schema check on all notes + whole-vault broken-link detection (`--json`) |
| `validate-logs.ts` | agent-log schema check (`agents/**/reports/*.md`) |
| `capture.ts` | append a dated fact bullet to a note, bump `updated:`, validate-or-rollback |
| `log-turn.ts` | per-turn journal append (needs a `journal` episodic type configured) |
| `consolidate.ts` | archival (>90d completed logs) + distillation worklist |
| `dashboard.ts` | agent-status dashboard by status bucket (`--write`, `--watch [sec]`) |
| `index.ts` | regenerate per-folder `index.md` (deterministic, byte-identical output) |
| `search.ts` | zero-dep BM25 lexical search, `path:line: snippet (score)` citations (`--json`) |
| `snapshot.ts` | token-capped identity digest from IDENTITY/ALWAYS/NEVER/AGENTS (`--budget`, `--json`) |
| `nightly.ts` | `wiki/raw` → `wiki/processed` clipping worklist + auditable `git mv` + `log.md` append |

No script here ever calls an LLM or the network — everything is a pure function over the file
tree. LLM-driven steps (summarizing turns, distilling clippings into concept notes) belong to
the *invoking agent*; `scripts/hooks/*.md` documents where each hook plugs in.

## Nightly maintenance

Runs **on the machine the vault lives on** — never CI (a remote runner can't see a
local-only vault). `--nightly` (or the interactive prompt) schedules `scripts/nightly.sh`
daily at 09:00 via a systemd user timer, falling back to crontab, else printing manual
instructions. The runner: validate → regenerate indexes → dashboard → print the unprocessed
clipping worklist → optionally invoke your agent via `$VAULT_AGENT_CMD` → commit. It never
pushes; add that yourself once you trust the automation.

## Presets

| Preset | Directories |
|---|---|
| `sre` | runbooks, services, projects, incidents, decisions, postmortems |
| `homelab` | projects, infrastructure, decisions (+ optional glossary, personal, crm, skills, journal, wiki) |
| `okf` | wiki, crm, journal, skills — agentic second brain, [OKF v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog)-permissive validation (`okf_compat: true`) |
| `blank` | projects only |

Pick any subset interactively, add custom dirs, or edit `vault.config.json` after — adding a
semantic type there makes it a valid `type:`, gives it a directory, and registers it as a
distillation target with **zero code changes**. Optional config keys: `index_style`
(`{"crm": "alphabetical"}`) and `snapshot` (`{"files": [...], "budget_tokens": 1300}`).

## MCP server

Expose your vault to Claude Code, Claude Desktop, and other MCP clients:

```bash
bunx vault-init mcp --dir /path/to/your/vault
```

Two read-only tools:
- **`vault_search`** — BM25 lexical search across notes (input: `query`, optional `limit`)
- **`vault_snapshot`** — token-capped identity + rules digest (input: optional `budgetTokens`)

Both are offline, deterministic adapters over the same functions the CLI scripts use.
See `templates/mcp/` for setup docs: wire into Claude Code `.mcp.json` or Claude Desktop
`claude_desktop_config.json`.

## Requirements

- [`bun`](https://bun.sh) ≥ 1.1 — runs the TypeScript directly, no build step.
- `git` — the lifecycle is git-native.
- Obsidian + Dataview — optional, for graph browsing.

## Development

```bash
bun install      # @clack/prompts (interactive CLI) + @modelcontextprotocol/sdk (MCP server)
bun test         # 95 tests across 11 files: validators, capture round-trip, search, snapshot, nightly, MCP
task scaffold    # throwaway smoke vault at /tmp/vault-init-smoke (see Taskfile.yml)
```

Architecture deep-dive for contributors and AI agents: [`docs/`](docs/) —
[architecture](docs/architecture.md) · [integrations](docs/integrations.md) ·
[security](docs/security.md) · [operations](docs/operations.md) · [sharp edges](docs/sharp-edges.md).

## License

MIT © Johnzell Wilson
