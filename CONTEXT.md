# Context — vault-init

Ubiquitous language for vault-init. Glossary only — implementation lives in `docs/`.

## Terms

**Vault** — a plain-markdown + git knowledge repository scaffolded and operated by vault-init. Self-contained: carries its own vendored scripts, config, hooks, and CI.

**Vendored script (operational tier)** — a copy of an `OPERATIONAL` src file placed into a vault's `scripts/` at scaffold time. Owned by the vault after scaffolding; upgraded only explicitly (`doctor --fix` restores missing ones, `doctor --force` overwrites drifted ones). Zero-dep by contract.

**Package-only script** — src file that runs from the npm package, never vendored (`init.ts`, `mcp.ts`, `doctor.ts`, `link.ts`).

**Generated file** — output of a vendored script (`index.md` files, `dashboard/`, `log.md` entries). Ephemeral: carries a "regenerate, don't hand-edit" contract, and a script upgrade may reshape it wholesale (decided 2026-07-06: acceptable — e.g. wikilink→markdown-link flip in indexes after re-vendor). Distinct from **content** (hand- or agent-written notes), which no upgrade may rewrite.

**Content note** — a hand- or agent-authored markdown note subject to schema validation (frontmatter + section shape). Never restructured by tooling except through `insertBullet()`-style validated mutations.

**okf_compat** — per-vault mode (config flag, set by the `okf` preset) adopting Open Knowledge Format v0.1 permissive parsing: unknown types and broken links are warnings, not errors. Applies to content-note validation only.

**Linked vault** — a vault registered machine-wide with Claude Code: named MCP server + pointer block in the global CLAUDE.md. Many vaults may be linked at once.

**Primary vault** — the single linked vault `$VAULT_DIR` points at. Only the primary vault's snapshot injects at SessionStart (decided 2026-07-07: other linked vaults stay on-demand via their MCP tools — keeps blast radii separated and context lean).

**Agent log** — a dated report in `agents/<name>/reports/` following the agent-log schema (`status`, `verified`, …). The coordination backbone: dashboard, consolidation, and self-review all read it.

**Proposal (self-review)** — a propose-only rule-change draft in `agents/self-review/proposals/`, written by an invoking agent from verified agent logs. Pending until an operator applies it by hand and removes the file. No tooling ever edits rule files (`ALWAYS.md`/`NEVER.md`/`CLAUDE.md`).
