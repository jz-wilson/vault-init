# Claude Code hook — log-turn.ts

## Summary
Wires `bun scripts/log-turn.ts "<fact>"` into a Claude Code hook so each turn (or each
session end) appends a dated bullet to this month's journal file. `log-turn.ts` is a thin
wrapper over `capture.ts`'s existing bullet-insertion + episodic routing — it does **no**
summarization itself. vault-init never calls an LLM.

## Notes

### Division of labor

`log-turn.ts` only appends an already-written fact string. Turning a transcript/turn into
that one-line fact is a **separate, external** step that lives in the hook wiring below —
not in vault-init. Point it at whatever fast/cheap model or script you like; vault-init
doesn't care how the fact was produced, only that it's a single line with no newlines.

### Requires

The vault's `vault.config.json` must have a `journal` episodic type, e.g.:

```json
{
  "episodic_dirs": { "journal": "journal" }
}
```

`log-turn.ts` exits with a clear error if `journal` isn't configured.

### `Stop` hook — summarize the finished turn, then log it

`.claude/settings.json` (or global `~/.claude/settings.json`):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "FACT=$(your-fast-summarizer --transcript \"$CLAUDE_TRANSCRIPT_PATH\") && bun /path/to/vault/scripts/log-turn.ts \"$FACT\""
          }
        ]
      }
    ]
  }
}
```

`your-fast-summarizer` is anything that reads the transcript and prints one line — a small
local model, a haiku-tier API call, a regex-based heuristic, whatever fits your budget. That
step is entirely outside vault-init's scope.

### `PostToolUse` hook — log one specific tool's outcome

Useful when only certain tool calls are worth journaling (e.g. only after `Bash` commands
that mutate infra):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "FACT=$(your-fast-summarizer --tool-output \"$CLAUDE_TOOL_OUTPUT\") && [ -n \"$FACT\" ] && bun /path/to/vault/scripts/log-turn.ts \"$FACT\" || true"
          }
        ]
      }
    ]
  }
}
```

The `|| true` keeps a summarizer miss (empty `$FACT`) from failing the hook — `log-turn.ts`
itself would also reject an empty fact with a non-zero exit, so the guard just avoids noisy
hook errors for the common "nothing worth logging" case.

### Manual / testing

```bash
bun scripts/log-turn.ts "decided to defer phase 4 rollout to next sprint"
```

## Related
- [[nightly-automation]] — the nightly counterpart (raw-clipping worklist, not per-turn)
- [[_format]] — note format + schema
