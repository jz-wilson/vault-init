# SessionStart snapshot hook

A fresh Claude Code session normally has zero context on this vault — "who am I, what matters,
what am I never supposed to do" all have to be re-read from files. `scripts/snapshot.ts` builds a
token-capped digest of the highest-priority vault files (default: `IDENTITY.md`, `ALWAYS.md`,
`NEVER.md`, `AGENTS.md`, capped at ~1300 tokens — see `snapshot` in `vault.config.json`) so a new
session can prime on that instead of reading the whole vault.

Claude Code's `SessionStart` hook runs a shell command and injects its stdout as session context.

**Scaffolded vaults already ship this wiring** — `.claude/settings.json` at the vault root carries
the hook, so sessions launched *inside the vault* prime automatically. To prime sessions launched
**anywhere on this machine**, run `bun run link` (wraps `scripts/link.ts`): it merges the same hook
(with an absolute script path) into `~/.claude/settings.json`, adds a vault pointer to
`~/.claude/CLAUDE.md`, and registers the MCP server user-scope. Idempotent; `--dry-run` previews.

For manual wiring in some other project's `.claude/settings.json`, the shape is:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun scripts/snapshot.ts"
          }
        ]
      }
    ]
  }
}
```

The hook's cwd is the project directory Claude Code was launched in — from outside the vault, use
an absolute path: `"command": "bun /abs/path/to/vault/scripts/snapshot.ts"`.
To use a different token budget for this hook without touching `vault.config.json`, pass
`"command": "bun scripts/snapshot.ts --budget 2000"` instead.
