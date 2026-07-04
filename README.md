# vault-init

Scaffold an **agent-coordination + memory vault** — a plain-markdown + git workspace where
multiple AI agents write structured task logs, an operator reviews them, and durable facts
distill into a deduped semantic tier. Opens as an [Obsidian](https://obsidian.md) vault, but
the agent loop needs nothing but [`bun`](https://bun.sh) and `git`.

```bash
bunx vault-init                 # interactive
bunx vault-init --yes --preset sre --name work --dir ./work-vault   # scripted
```

## What you get

```
work-vault/
  agents/<name>/reports/   per-agent task logs (the coordination layer)
  runbooks/ services/ …    semantic notes — deduped current facts
  incidents/ decisions/    episodic notes — monthly dated logs
  scripts/*.ts             validate · capture · consolidate · dashboard (vendored, no deps)
  .githooks/pre-commit     schema gate (local)
  .github/workflows/       schema gate (server-side — closes the MCP/API bypass)
  vault.config.json        the one place directories are configured
  _format.md AGENTS.md     the schema + agent protocol (single source of truth)
  SEED-PROMPT.md           hand to an AI to populate content
```

## The model

Three memory tiers, mapped to note types:

| Tier | Notes | Behavior |
|---|---|---|
| **Episodic** | agent logs, `episodic_dirs` | raw, dated, append-only |
| **Semantic** | `semantic_dirs`, concepts | deduped current facts; distillation target |
| **Procedural** | tracked `AGENTS`/`IDENTITY` + agent auto-memory | preferences, working style |

The loop, all `bun scripts/<name>.ts`:

```
agent writes log (active)
  → pre-commit hook + CI validate schema     validate-logs.ts
  → dashboard surfaces status                dashboard.ts   (headless, no Obsidian)
  → operator reviews → verified: true
  → consolidate flags stale semantic links   consolidate.ts
  → capture folds facts into semantic notes  capture.ts
  → consolidate --apply archives logs >90d   (age-only, not gated on review)
```

## Presets

| Preset | Directories |
|---|---|
| `sre` | runbooks, services, projects, incidents, decisions, postmortems |
| `homelab` | projects, infrastructure, decisions, (glossary, personal) |
| `blank` | projects, decisions |

Pick any subset interactively, add custom dirs, or edit `vault.config.json` after — adding a
semantic type there makes it a valid `type:`, gives it a directory, and registers it as a
distillation target with **zero code changes**.

## MCP server

Expose your vault to Claude Code, Claude Desktop, and other MCP clients:

```bash
bunx vault-init mcp --dir /path/to/your/vault
```

Exposes two read-only tools:
- **`vault_search`** — BM25 lexical search across notes (input: `query`, optional `limit`)
- **`vault_snapshot`** — token-capped identity + rules digest (input: optional `budgetTokens`)

Both are offline, deterministic adapters over the same functions used for validation and capture.
See `templates/mcp/` for setup docs: wire into Claude Code `.mcp.json` or Claude Desktop `claude_desktop_config.json`.

## Requirements

- [`bun`](https://bun.sh) ≥ 1.1 — runs the TypeScript directly, no build step.
- `git` — the lifecycle is git-native.
- Obsidian + Dataview — optional, for graph browsing.

## Development

```bash
bun install      # @clack/prompts for the interactive CLI
bun test         # 13 tests: validators, capture round-trip, archival, distillation
```

## License

MIT © Johnzell Wilson
