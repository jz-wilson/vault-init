# Architecture

System overview, stack, directory topography, and core flows. Grounded in the literal
implementation as of v0.4.1. Siblings: [integrations.md](integrations.md) ·
[security.md](security.md) · [operations.md](operations.md) · [sharp-edges.md](sharp-edges.md).

## 1. System Overview & Core Purpose

- **Elevator Pitch:** `vault-init` scaffolds and operates an *agent-coordination + memory vault* — a plain-markdown, git-versioned Obsidian-compatible knowledge base that AI agents read from (BM25 search, token-capped identity snapshots), write to (dated fact capture, per-turn journaling), and maintain (validation, archival, nightly clipping-processing worklists). It is the all-Bun/TypeScript port of 4 Python vault-tooling scripts, extended with an "agentic OS" layer (per-folder indexes, snapshot digests, search, nightly maintenance) and an MCP server.
- **Primary Archetype:** Bun-native TypeScript CLI scaffolder + a suite of self-contained operational scripts that get **vendored** (copied verbatim) into every scaffolded vault's `scripts/` directory. One optional long-running process: a stdio MCP server (`bunx vault-init mcp --dir <vault>`).
- **Critical Constraints (architectural axioms — do not relitigate):**
  - **Zero network, zero LLM calls in this codebase.** Every script is a pure function over a file tree. LLM-driven steps (summarization, distillation, theme extraction) are explicitly the *invoking agent's* job, wired via hook docs in `templates/hooks/`.
  - **Vendored scripts must stay zero-dep.** The `OPERATIONAL` list in `src/init.ts:14` (13 files) is copied into vaults with no `node_modules`; they may only import each other and `node:*` builtins. `src/mcp.ts` is deliberately NOT in that list because it imports `@modelcontextprotocol/sdk`.
  - **No build step.** Bun executes `.ts` directly; `package.json` `bin` points straight at `src/init.ts`.
  - **Behavior-equivalence to the Python originals** for the 5 ported files (`frontmatter.ts`, `capture.ts`, `consolidate.ts`, `validate-logs.ts`, `validate-vault.ts`) unless a design doc says otherwise. Originals live in the author's vault repo as `scripts/{vault_fm,capture,consolidate,validate-agent-logs,validate-vault}.py`.
  - **Every user-supplied path fragment gets a traversal guard** (see [security.md](security.md)).
  - **Nightly maintenance runs on the machine the vault lives on, never CI** — a remote runner can't see a local-only vault (`src/init.ts:157-158`).

## 2. Technical Stack & Dependencies

- **Runtime/Language Version:** Bun `>=1.1.0` (enforced via `engines` in `package.json`). TypeScript executed directly, ESM (`"type": "module"`). Bun-specific APIs used: `Bun.Glob().scanSync()` (file discovery in search/validators), `Bun.spawnSync()` (all git operations, systemctl/crontab probing, shell drop-in).
- **Core Frameworks & Tools:**
  - `bun:test` — 114 test cases across 13 files in `test/`; the only quality gate (`bun test` in CI).
  - Taskfile (`Taskfile.yml`) — dev conveniences: `task scaffold` (throwaway vault at `/tmp/vault-init-smoke`), `task dashboard`, `task watch`, `task link/unlink`, `task clean`.
- **Key External Dependencies (only 2 runtime deps, by design):**
  - `@clack/prompts ^0.7.0` — interactive scaffold wizard (`interactive()` in `src/init.ts:62`). Lazy-imported (`await import`) so `--yes` non-interactive runs never load it.
  - `@modelcontextprotocol/sdk ^1.29.0` — MCP stdio server (`src/mcp.ts`). Lazy-imported by the `mcp` subcommand only.
- **Published surface:** npm `vault-init` (v0.4.1), GitHub `jz-wilson/vault-init`. `files: ["src", "templates"]` — tests and Taskfile are not shipped.

## 3. Directory Topography

```text
vault-init/
├── package.json              # bin: vault-init → src/init.ts; 2 deps; no build
├── Taskfile.yml              # dev loop: scaffold smoke vault under /tmp, run dashboard against it
├── CLAUDE.md                 # agent guardrails (commands + must-not-break rules)
├── docs/                     # this documentation set
├── .github/workflows/ci.yml  # ONLY gate: bun install --frozen-lockfile && bun test
│
├── src/                      # ALL business logic. Two tiers:
│   │
│   │   ── tier 1: vendored OPERATIONAL scripts (copied into every vault's scripts/) ──
│   ├── frontmatter.ts        # shared parsing primitives (port of vault_fm.py): parseFrontmatter,
│   │                         #   extractField, extractTagsList, validateCommonNoteShape, checkBodyPaths
│   ├── config.ts             # vault.config.json loader + derived layout; resolveInside() traversal
│   │                         #   guard; runMain() error wrapper; NONCONTENT_SUBTREES skip set
│   ├── capture.ts            # append dated fact bullet to a note + bump `updated:` (port of capture.py)
│   ├── log-turn.ts           # per-turn journal append — thin wrapper over capture.ts's insertBullet
│   ├── consolidate.ts        # archival (completed + >90d → agents/*/reports/archive/) +
│   │                         #   distillation worklist (port of consolidate.py)
│   ├── validate-logs.ts      # agent-log schema validator (port of validate-agent-logs.py)
│   ├── validate-vault.ts     # general note validator + whole-vault broken-link checker
│   ├── dashboard.ts          # headless ANSI agent-status dashboard (buckets by status)
│   ├── index.ts              # per-folder index.md generator (deterministic, byte-identical output)
│   ├── snapshot.ts           # token-capped identity digest (priority-order section packing)
│   ├── search.ts             # zero-dep BM25 lexical search, injectable ScoreFn seam
│   ├── nightly.ts            # wiki/raw → wiki/processed worklist + auditable git mv + log.md append
│   ├── link.ts               # register vault machine-wide with Claude Code: user-scope MCP +
│   │                         #   global SessionStart hook + ~/.claude/CLAUDE.md pointer (idempotent merges)
│   │
│   │   ── tier 2: package-only (NOT vendored) ──
│   ├── init.ts               # ENTRY POINT: scaffolder CLI (interactive + --yes), setupNightly(),
│   │                         #   safeJoin() guard, OPERATIONAL vendor list
│   ├── mcp.ts                # MCP stdio server: vault_search + vault_snapshot + vault_read
│   │                         #   (read-only adapters over search.ts/snapshot.ts pure fns);
│   │                         #   refuses to start for an unlinked vault (isLinked gate → doctor hint)
│   └── doctor.ts             # diagnose + repair vault setup; package-only (repairs pull from
│                             #   package src/ + templates/)
│
├── templates/                # static files copied into scaffolded vaults
│   ├── presets/              # blank | homelab | sre | okf .json — Item[] {value,dir,bucket,label,selected}
│   ├── docs/                 # _format.md, AGENTS.md, README.md, IDENTITY.md, ALWAYS.md, NEVER.md,
│   │                         #   CLAUDE.md (imports @AGENTS/@ALWAYS/@NEVER — Claude Code reads only this name)
│   ├── claude/settings.json  # scaffolded to <vault>/.claude/settings.json — SessionStart snapshot hook
│   ├── githooks/pre-commit   # validate-logs + regenerate index.md for staged .md dirs
│   ├── ci/validate.yml       # scaffolded vault's own CI: full validator run (closes hook-bypass hole)
│   ├── scripts/nightly.sh    # local scheduler target: validate → index → dashboard → worklist →
│   │                         #   optional $VAULT_AGENT_CMD → git commit (never pushes)
│   ├── hooks/*.md            # wiring docs: session-start-snapshot, log-turn-hook, nightly-automation
│   ├── mcp/                  # README + mcp.json snippet for registering the MCP server
│   └── SEED-PROMPT.md        # prompt for an AI to populate the fresh vault
│
└── test/                     # 13 bun:test files — foundation, vault, index, search, snapshot, nightly,
                              #   mcp, link, doctor, link-check, skip-subtrees, resolve-inside, init-scaffold
```

## 4. Core Flows

### 4.1 Entry points

| Invocation | Path | What runs |
|---|---|---|
| `bunx vault-init` | `src/init.ts` `main()` → `interactive()` | clack wizard: name → preset → multiselect dirs → custom dirs → target dir → scaffold → nightly prompt → optional shell drop-in |
| `bunx vault-init --yes [--dir --preset --name --force --no-examples --nightly]` | `src/init.ts` `main()` | non-interactive scaffold of the preset's `selected: true` items |
| `bunx vault-init mcp [--dir <vault>]` | `src/init.ts` → lazy `import("./mcp.ts")` → `runMcp()` | stdio MCP server; `--dir` defaults to `$VAULT_DIR` (`requestedVaultDir()`, `src/config.ts`) |
| `bunx vault-init link --dir <vault>` / `bun scripts/link.ts` | `src/init.ts` → lazy `import("./link.ts")` → `runLink()` | machine-wide Claude Code registration: user-scope MCP (`claude mcp add`), global SessionStart hook, `~/.claude/CLAUDE.md` pointer (all idempotent; `--dry-run`/`--skip-mcp` supported; `CLAUDE_CONFIG_DIR` respected) |
| `bunx vault-init doctor [--dir <vault>]` | `src/init.ts` → lazy `import("./doctor.ts")` → `runDoctor()` | report-only diagnosis; `--fix` applies repairs (`--force` also overwrites drifted vendored scripts, implies `--fix`): re-vendor missing OPERATIONAL scripts, restore CLAUDE.md/.claude/settings.json/.mcp.json, hooksPath, $VAULT_DIR profile export, run `link` if unlinked. Vault resolution: `--dir` > cwd-if-vault > `$VAULT_DIR`. Package-only — repairs need package templates/src |
| `bun scripts/<name>.ts` (inside a vault) | vendored copy of each tier-1 script | each has `if (import.meta.main) runMain(main)` — importable as a library AND runnable as a CLI |

Every script entry goes through `runMain()` (`src/config.ts:60`) which converts any throw/rejection into clean `error: <msg>` + `exit(1)` — no raw stack traces to users.

### 4.2 Primary data structures

- **`vault.config.json`** — the single source of dir-layout truth, written by `scaffold()`, loaded by `loadConfig()` (`src/config.ts:73`): `{ name, semantic_dirs: {type→dir}, episodic_dirs: {type→dir}, extra_dirs: [dir], index_style?: {dir→style}, snapshot?: {files, budget_tokens} }`.
- **`Derived`** (`src/config.ts:25`) — computed per-run by `derive()`: `TYPE_DIRS` (semantic+episodic merged), `VALID_TYPES` (config types ∪ `UNIVERSAL_TYPES` = agent-log, handoff, concept, reference, glossary, personal, skill), `ALL_DIRS`. The `type:` frontmatter enum is **derived from config, never hardcoded**.
- **Note anatomy** (enforced by validators): `---` YAML-ish frontmatter (`updated: YYYY-MM-DD`, `tags: [...]` lowercase no-`#`, `type:` ∈ VALID_TYPES) + body with H1 + required sections `## Summary`, `## Notes`, `## Related`. Agent logs add `agent/status/task/priority/date` (+ `error_class` + `## Error Log` when status=error) and filename `YYYY-MM-DD-slug.md`.
- **Semantic vs episodic routing** (`resolvePath()`, `src/capture.ts:22`): semantic type → `<dir>/<note>.md` (`--note` required, plain-filename-guarded); episodic type → `<dir>/<YYYY-MM>.md` (monthly file, `--note` ignored).
- **Search corpus** (`src/search.ts`): `Doc {path, length, termFreq}` + `CorpusStats {N, avgdl, df}` — rebuilt in-memory on every invocation (vaults are small; no persistent index). `ScoreFn` is an injectable seam so an embedding backend can replace `bm25` without touching `search()` call sites.

### 4.3 Lifecycle execution paths

- **Scaffold** (`scaffold()`, `src/init.ts:122`): refuse non-empty target unless `force` → mkdir all dirs via `safeJoin` → write `vault.config.json` → vendor 13 OPERATIONAL scripts → write vault-local `package.json` (script aliases, no deps) → copy pre-commit hook (0o755), `validate.yml`, `nightly.sh` (0o755), hook docs, root docs (incl. `CLAUDE.md`), SEED-PROMPT, `.claude/settings.json` (SessionStart snapshot hook) → write `.gitignore` (`handoffs/`, `dashboard/status.txt`, `.nightly.log`) → write `.mcp.json` (MCP registration pinned to `vault-init@<version>`, absolute `--dir`) → optional example notes → `.gitkeep` any still-empty dir (git won't track empty dirs) → **always** `git init` + `core.hooksPath=.githooks` + initial commit (with fallback identity `vault-init@localhost` if none configured).
- **Capture/write path** (`insertBullet()`, `src/capture.ts:64`): read original → bump or insert `updated:` (inserts after opening `---` if absent — never clobbers first fm line) → splice `- YYYY-MM-DD: fact` after last bullet in `## Notes` → write → **validate in-process via `validateVaultNote()`; on any error, restore the original bytes and throw**. This validate-or-rollback transaction is the core write-safety pattern.
- **Nightly maintenance** (two halves):
  1. *Deterministic* (`nightly.sh` scheduled by `setupNightly()`, `src/init.ts:195` — systemd user timer preferred, crontab fallback, else printed instructions; daily 09:00): validate → regenerate indexes → dashboard → print worklist → optional `$VAULT_AGENT_CMD` → `git commit` (never pushes).
  2. *Auditable processing* (`nightly.ts process <file> --log "..." [--apply] [--push]`): dry-run by default; apply = `git add` (fresh clippings are untracked; `git mv` needs a tracked source) → `git mv wiki/raw/<f> wiki/processed/<f>` → append dated bullet to root `log.md` → commit. Symlinks refused (`lstatSync().isSymbolicLink()` — could dangle outside the vault). Push only on explicit `--push`.
- **Consolidation** (`src/consolidate.ts`): archival = agent logs with `status: completed` AND `date` older than 90 days → `git mv` to `agents/<agent>/reports/archive/` (**decoupled from `verified` by design decision Q8 — age-only**). Distillation = completed logs whose `## Related` wiki-links point at semantic notes with `updated:` older than the log's `date` → printed checklist for the agent to fold facts in via capture.ts.
- **Snapshot** (`buildSnapshot()`, `src/snapshot.ts:56`): walks configured files (default `IDENTITY.md, ALWAYS.md, NEVER.md, AGENTS.md`, budget 1300 tokens) in priority order, packs whole `##` sections while they fit; **a section that would overflow is skipped and the walk continues** (greedy-skip packing — later sections/files still get a chance; never truncates mid-sentence). Token estimate = `chars/4` — deliberately no tokenizer dep. Intended as a Claude Code SessionStart hook.
- **MCP** (`src/mcp.ts`): `resolveVaultDir()` validates `--dir` (trust boundary: resolve + `vault.config.json` existence). Three read-only tools — `vault_search` (BM25, default limit 10), `vault_snapshot` (budget override param, clamped to 8000 tokens), and `vault_read` (full note text by vault-relative path, `.md` only, `resolveInside`-guarded, 100k-char truncation) — each a thin `{content:[{type:"text",...}]}` wrapper over the same pure fns the CLIs use.

### 4.4 State management

There is no in-process state anywhere. All state is **the file tree + git history**. Concurrency is unhandled by design (single-operator vaults). The dashboard's `--watch` mode is the only polling loop (`setInterval` re-render, `src/dashboard.ts:152`).
