# Agent Protocol

## Summary
Shared operating protocol for every AI agent working in this vault. All agent task reports
follow one schema so the operator can monitor everything from one dashboard.

## Notes

### Workspace rules

1. Your filesystem scope is this vault. Do not modify files outside `agents/<your-name>/`
   unless explicitly told to.
2. All reports go in `agents/<your-name>/reports/`. Lowercase, hyphenated agent name.
3. File naming: `YYYY-MM-DD-short-task-description.md`.
4. **Serialize writes** — one agent writes per working tree at a time. Per-agent dirs
   prevent content conflicts, but git itself is not namespaced.
5. **Journal grounding** — before responding to a `journal/` entry, first read `crm/` (people
   mentioned) and any relevant `wiki/processed/` concept notes. A journal response written
   without that context is not vault-grounded and should not be trusted.
6. **Tool inventory** — "what's connected to this vault" (MCP servers, external tools, APIs) is
   documented as `type: reference` notes, not scattered across agent logs. Check there first.

### Agent role charters (optional)

An agent may keep `agents/<name>/AGENT.md` — a role charter describing its scope, standing
instructions, and boundaries, distinct from its dated `reports/`. Not required, but when present
it is the first thing another agent (or the operator) should read before delegating to `<name>`.

### Required frontmatter

Schema is defined in [[_format]] (Agent-Log Extension) — single source of truth. Quick ref:

```yaml
---
updated: YYYY-MM-DD
tags: [agent-log]
type: agent-log
agent: "<your-name>"
status: active            # active | blocked | awaiting-approval | completed | error
task: "1-sentence description"
priority: medium          # high | medium | low
date: YYYY-MM-DD
---
```

### Task lifecycle

1. **Start** — create the log with `status: active`.
2. **Failure** — `status: error`, add `error_class: transient|permanent`, append `## Error Log`.
3. **Blocked** — `status: blocked`, describe what's needed in the body.
4. **Review gate** — `status: awaiting-approval`, write the decision context in the body.
5. **Success** — `status: completed`, `completion_signal: true`, `verified: false`
   (operator flips to `true`).

After writing any log run `bun scripts/validate-logs.ts` and fix errors.

### Memory writeback

After a meaningful session, fold durable facts into semantic notes:
`bun scripts/capture.ts --type <type> --note <name> "<dense fact>"`. Dense facts only.
Episodic types (`decisions`, `incidents`) take dated bullets; the monthly file is automatic.

### Self-improvement (propose-only)

Recurring lessons from `status: completed` + `verified: true` logs may be drafted as rule-change
proposals in `agents/self-review/proposals/YYYY-MM-DD.md` — see `scripts/hooks/self-review.md`.
Never edit `ALWAYS.md`, `NEVER.md`, or `CLAUDE.md` directly; the operator applies accepted
proposals by hand.

### Archival

`bun scripts/consolidate.ts` lists archival candidates (completed + >90d, **not** gated on
review) and a distillation worklist. `--apply` executes the `git mv` into `reports/archive/`.

### Setup (new clones)

```bash
git config core.hooksPath .githooks   # enable commit-time validation
```

## Related
- [[_format]] — canonical note format + agent-log schema
- [[README]] — vault overview, scripts, memory model
