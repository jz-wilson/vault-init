# Vault

## Summary
Agent-coordination + long-term memory vault. AI agents write structured task logs here; the
operator reviews them. Three-tier memory (episodic → semantic → procedural) maps to note
types. Plain markdown + git — opens as an Obsidian vault, but the agent loop needs nothing
but `bun` + `git`.

## Notes

### Layout

Directories are defined in `vault.config.json`. Fixed spine: `agents/` (task logs),
`dashboard/`, `handoffs/`, `scripts/`. Configurable spokes: `semantic_dirs` (deduped facts),
`episodic_dirs` (monthly dated logs), `extra_dirs` (freeform).

### The loop

```
agent writes log (active)
  → pre-commit hook + CI validate schema       (bun scripts/validate-logs.ts)
  → dashboard surfaces status                  (bun scripts/dashboard.ts)
  → operator reviews → verified: true
  → consolidate flags stale semantic links     (bun scripts/consolidate.ts)
  → capture folds facts into semantic notes    (bun scripts/capture.ts)
  → consolidate --apply archives completed +90d logs
```

Archival is **age-only** — not gated on review — so forgotten verifications never clog the
repo. `verified` is a pure quality signal.

### Scripts (all `bun scripts/<name>.ts`)

| Script | Purpose |
|---|---|
| `validate-logs.ts` | agent-log schema; run after writing a log |
| `validate-vault.ts` | all other notes; config-driven type enum |
| `capture.ts` | append a dated fact to a semantic/episodic note; auto-create + validate |
| `consolidate.ts` | archival (dry-run; `--apply`) + distillation worklist |
| `dashboard.ts` | headless six-bucket status (`--write` for `dashboard/status.txt`) |

### Customizing directories

Edit `vault.config.json`. Add a semantic type → it's instantly a valid `type:`, gets a dir,
and becomes a distillation target. No code changes.

### Setup

```bash
git config core.hooksPath .githooks
bun run dashboard
```

Requires `bun`. Obsidian + Dataview optional (for graph browsing).

## Related
- [[AGENTS]] — agent operating protocol
- [[_format]] — note format + schema
