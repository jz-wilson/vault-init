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
description: <one-liner>   # optional — pre-read summary, see below
---
```

`type` enum = the keys in `vault.config.json` (`semantic_dirs` + `episodic_dirs`) plus the
universal set: `agent-log`, `handoff`, `concept`, `reference`, `glossary`, `personal`, `skill`.
**Add a new semantic type by editing `vault.config.json` — nothing else.**

`description:` is optional frontmatter on any note type: a one-line summary an agent can read
without opening the file, to decide whether it's worth a full read before triaging a queue of
notes (OKF style). Recommended on any note an agent might need to triage before opening —
`person`, `reference`, `concept` notes especially.

### Person notes (`type: person`)

Dir: `crm/` (or whatever `semantic_dirs.person` maps to). On top of the standard frontmatter,
`person` notes require two additional dated fields:

```yaml
met: YYYY-MM-DD           # when you first met/connected
last_contact: YYYY-MM-DD  # most recent contact, bump on every interaction
```

Both must be valid calendar dates in `YYYY-MM-DD` form — validated the same way as `updated`.

### Journal notes (`type: journal`)

Episodic type, dir `journal/` (or `episodic_dirs.journal`). Monthly dated-bullet files, written
via `capture.ts` exactly like `decisions/` — one file per `YYYY-MM.md`, one `- YYYY-MM-DD: fact`
bullet per entry.

### Skill notes (`type: skill`)

Dir `skills/` (or `semantic_dirs.skill`). First-class notes for repeatable workflows — the same
standard frontmatter + body shape as any semantic note, `type: skill`.

### wiki/raw vs wiki/processed

Two-tier landing zone for external material, when the `wiki-raw`/`wiki-processed` preset items
are selected:

- `wiki/raw/` — schema-exempt clippings. No frontmatter/body shape required; the validator skips
  this subtree entirely in full-scan mode (an explicitly-named file under it is still checked).
  Drop raw material here without ceremony.
- `wiki/processed/` — deduped, distilled. Once a raw clipping's facts are folded into a concept
  note (or a new one is written), the concept note lives here under the normal schema.

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
4. No `file://` URLs or absolute paths (`/mnt/...`, `C:\...`) in bodies — link notes with
   `[[wiki-links]]` or relative markdown links (`[Title](dir/note.md)`); the validator resolves
   both. Generated content (indexes, `log.md`) uses markdown links (OKF-portable). Code fences exempt.
5. File ends with exactly one newline.

Vaults scaffolded with `okf_compat: true` in `vault.config.json` (the OKF preset) follow
Open Knowledge Format v0.1 permissive parsing: unknown `type` values and broken links are
reported as warnings, not errors. The recommended type set is unchanged. The bundle-root
`index.md` (generated) is the only file carrying `okf_version`.

## Related
- [[AGENTS]] — agent operating protocol
- [[README]] — vault overview and scripts
