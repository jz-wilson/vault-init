# Dependency & Integration Landscape

Internal module graph, external systems, and the contract a scaffolded vault relies on.
Siblings: [architecture.md](architecture.md) · [security.md](security.md) ·
[operations.md](operations.md) · [sharp-edges.md](sharp-edges.md).

## Internal module graph (vendored tier)

```text
frontmatter.ts  ←  (everything that parses notes)
config.ts       ←  (everything; loadFromScript resolves vaultRoot = script dir's parent)
capture.ts      →  frontmatter, config, validate-vault (in-process validation)
log-turn.ts     →  config, capture (resolvePath/createNote/insertBullet — NO new insert logic)
consolidate.ts  →  frontmatter, config, validate-logs (findAgentLogs), capture (ymd)
validate-vault.ts → frontmatter, config, validate-logs (dispatches agent-logs to validateAgentLog)
dashboard.ts    →  frontmatter, validate-logs (findAgentLogs), config
index.ts / search.ts / snapshot.ts / nightly.ts → frontmatter and/or config only
```

Vendored scripts locate their vault via `resolve(import.meta.dir, "..")` — they assume they
live in `<vault>/scripts/`.

## External integrations

- **git** — the only external system, invoked exclusively via `Bun.spawnSync`: init/commit (scaffold), `git mv` + commit (nightly, consolidate), `git push` (nightly `--push` only). Failures surface as thrown errors with stderr text.
- **systemd / cron** — probed at scaffold time by `setupNightly()` (`src/init.ts:195`): `systemctl --user show-environment` exit 0 → write `~/.config/systemd/user/vault-nightly-<name>.{service,timer}` (OnCalendar daily 09:00, Persistent) + enable; else `crontab -l` exit ≤1 → append `0 9 * * * <runner> >> <vault>/.nightly.log 2>&1` (idempotent — skips if the runner path already present); else print manual instructions.
- **MCP clients** (Claude Code etc.) — via stdio transport; registration snippet in `templates/mcp/mcp.json`.
- **Obsidian** — passive compatibility only: `[[wiki-link]]` resolution in `checkLinks()` mimics Obsidian semantics (bare `[[foo]]` matches any basename anywhere, path-qualified must match exactly, case-insensitive), and `.obsidian/` is in `NONCONTENT_SUBTREES`.

## Scaffolded-vault contract (what a generated vault expects)

`bun` on PATH (pre-commit degrades to a warning without it; `nightly.sh` hard-fails after
trying `~/.bun/bin`, linuxbrew, homebrew paths), git repo with `core.hooksPath=.githooks`,
and GitHub Actions if pushed to GitHub (`validate.yml` runs the full validator — the backstop
that closes the local-hook-bypass hole; scaffolded vaults get **both** hook and CI).
