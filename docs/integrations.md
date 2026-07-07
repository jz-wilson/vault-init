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

- **claude CLI** — `link.ts` shells out `claude mcp add --scope user` (`Bun.spawnSync`) for machine-wide MCP registration; missing/failed CLI degrades to printed manual instructions, and the settings.json/CLAUDE.md merges (`CLAUDE_CONFIG_DIR` ?? `~/.claude`) proceed regardless.
- **git** — invoked exclusively via `Bun.spawnSync`: init/commit (scaffold), `git mv` + commit (nightly, consolidate), `git push` (nightly `--push` only). Failures surface as thrown errors with stderr text.
- **systemd / cron** — probed at scaffold time by `setupNightly()` (`src/init.ts:195`): `systemctl --user show-environment` exit 0 → write `~/.config/systemd/user/vault-nightly-<name>.{service,timer}` (OnCalendar daily 09:00, Persistent) + enable; else `crontab -l` exit ≤1 → append `0 9 * * * <runner> >> <vault>/.nightly.log 2>&1` (idempotent — skips if the runner path already present); else print manual instructions.
- **MCP clients** (Claude Code etc.) — via stdio transport; `scaffold()` writes a ready `.mcp.json` at the vault root (pinned `vault-init@<version>`, absolute `--dir`); generic snippet remains in `templates/mcp/mcp.json` for registering from other projects/clients. The server refuses to start for an unlinked vault (error points at `vault-init doctor`).
- **shell profile** — `ensureVaultDirEnv()` (`src/init.ts`, used by scaffold + `doctor --fix`) appends `export VAULT_DIR="<vault>"` to `~/.zshrc`/`~/.bashrc`/`~/.profile` ($SHELL-derived) when `$VAULT_DIR` is unset; idempotent (skips if the profile already mentions `VAULT_DIR=`) and TTY-gated (non-interactive callers get the export line printed, nothing written). `$VAULT_DIR` is the machine-wide default `--dir` for `mcp`/`link`/`doctor`.
- **Obsidian** — passive compatibility only: `[[wiki-link]]` resolution in `checkLinks()` mimics Obsidian semantics (bare `[[foo]]` matches any basename anywhere, path-qualified must match exactly, case-insensitive), and `.obsidian/` is in `NONCONTENT_SUBTREES`. Relative markdown links (`[T](dir/note.md)`) validate co-equally (`MD_LINK_RE`, existsSync relative to the source file); generated content (index.ts, nightly.ts log entries) emits markdown links for OKF portability.
- **OKF (Open Knowledge Format v0.1)** — opt-in via `okf_compat: true` in vault.config.json (set by the `okf` preset): validate-vault demotes unknown `type` values and broken links to warnings (exit 0), `index.ts` writes a bundle-root `index.md` carrying `okf_version: "0.1"` (the only generated file with frontmatter), and `nightly.ts` writes `log.md` date-grouped newest-first with `**Update:**` labels. Other presets keep strict validation.

## Scaffolded-vault contract (what a generated vault expects)

`bun` on PATH (pre-commit degrades to a warning without it; `nightly.sh` hard-fails after
trying `~/.bun/bin`, linuxbrew, homebrew paths), git repo with `core.hooksPath=.githooks`,
and GitHub Actions if pushed to GitHub (`validate.yml` runs the full validator — the backstop
that closes the local-hook-bypass hole; scaffolded vaults get **both** hook and CI).
