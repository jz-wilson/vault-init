# SessionStart snapshot hook

A fresh Claude Code session normally has zero context on this vault — "who am I, what matters,
what am I never supposed to do" all have to be re-read from files. `scripts/snapshot.ts` builds a
token-capped digest of the highest-priority vault files (default: `IDENTITY.md`, `ALWAYS.md`,
`NEVER.md`, `AGENTS.md`, capped at ~1300 tokens — see `snapshot` in `vault.config.json`) so a new
session can prime on that instead of reading the whole vault.

Claude Code's `SessionStart` hook runs a shell command and injects its stdout as session context.
Wire the snapshot in by adding this to the vault's `.claude/settings.json` (create the file if it
doesn't exist):

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

Run it from the vault root (the hook's cwd is the project directory Claude Code was launched in).
To use a different token budget for this hook without touching `vault.config.json`, pass
`"command": "bun scripts/snapshot.ts --budget 2000"` instead.
