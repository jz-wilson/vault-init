---
updated: 2026-06-30
tags: [meta, conventions]
type: concept
---

# Vault Note Format

## Summary
Single source of truth for every `.md` file in this vault. Frontmatter must parse,
headings must be consistent, references degrade gracefully. Validators enforce this.

## Notes

### Standard frontmatter (all notes)

```yaml
---
updated: YYYY-MM-DD        # bump on every meaningful edit
tags: [primary, secondary] # YAML list, lowercase, no '#'
type: <enum>               # see below
---
```

`type` enum = the keys in `vault.config.json` (`semantic_dirs` + `episodic_dirs`) plus the
universal set: `agent-log`, `handoff`, `concept`, `reference`, `glossary`, `personal`.
**Add a new semantic type by editing `vault.config.json` — nothing else.**

### Body template

```markdown
# Title

## Summary
One or two sentences.

## Notes
Main content. Episodic types use dated bullets: `- YYYY-MM-DD: fact`.

## Related
- [[wiki-link]] — short context after the em dash
```

### Memory tiers

| Tier | Note kinds | Behavior |
|---|---|---|
| Episodic | `agent-log`, `episodic_dirs` types | raw, dated, append-only |
| Semantic | `semantic_dirs` types, `concept`, `glossary` | deduped current facts; distillation target |
| Procedural | tracked `CLAUDE/AGENTS/IDENTITY` + machine-local auto-memory | preferences, working style |

`consolidate.ts` flags completed logs whose `## Related` semantic note predates the log
(`updated:` < `date:`) — facts not yet folded in. Resolve with `capture.ts`.

### Agent-log extension

`type: agent-log` files add: `agent` (quoted), `status`
(`active|blocked|awaiting-approval|completed|error`), `task`, `priority`
(`high|medium|low`), `date`. Optional: `verified`, `completion_signal`, `error_class`
(required when `status: error`), `cost_usd`, `commits`, `model`. Location:
`agents/<name>/reports/`; name `YYYY-MM-DD-slug.md`. Archive at `reports/archive/`.

### Rules

1. `---` delimiters on their own lines; fields ordered `updated`, `tags`, `type`.
2. H1 once, directly under frontmatter.
3. `## Summary`, `## Notes`, `## Related` in that order; `_(none yet)_` when empty.
4. No `file://` URLs or absolute paths (`/mnt/...`, `C:\...`) in bodies — use `[[wiki-links]]`. Code fences exempt.
5. File ends with exactly one newline.

## Related
- [[AGENTS]] — agent operating protocol
- [[README]] — vault overview and scripts
