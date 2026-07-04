# Security Invariants

Path-traversal guards and input hardening. **Extend, never remove.** Siblings:
[architecture.md](architecture.md) · [integrations.md](integrations.md) ·
[operations.md](operations.md) · [sharp-edges.md](sharp-edges.md).

Any new CLI flag or config field that reaches a filesystem path MUST use one of these:

| Guard | Location | Pattern | Protects |
|---|---|---|---|
| `resolveInside(base, rel, label)` | `src/config.ts:46` | `resolve()` + `startsWith(base + sep)` | canonical guard: config dirs (`assertInsideVault` on all semantic/episodic/extra/snapshot entries), `index.ts` CLI dir args, `snapshot.files` |
| `safeJoin(base, rel)` | `src/init.ts:30` | same resolve+startsWith | scaffold mkdir targets, example-note dirs |
| `resolvePath()` note-name check | `src/capture.ts:25` | reject `/`, `\`, `.`, `..` outright | `--note` values |
| `assertPlainFilename()` | `src/nightly.ts:33` | same reject-list | `nightly.ts process <file>` |
| `loadPreset()` name check | `src/init.ts:24` | same reject-list | `--preset` values |
| `resolveVaultDir()` | `src/mcp.ts:21` | resolve + vault.config.json existence | MCP `--dir` trust boundary |

`path.join` does **not** block `..` — that is why every user-supplied fragment routes through
one of the guards above before touching the filesystem.

## Additional hardening already in place

- Dashboard strips C0/C1 control chars from frontmatter fields before ANSI rendering — an
  unvalidated field is an escape-sequence injection vector (`src/dashboard.ts:17-20`).
- `nightly.ts` refuses symlinked clippings (`lstatSync().isSymbolicLink()`) — a symlink could
  point outside the vault and survive the `git mv` still dangling out.
- `insertBullet` / `logTurn` / `markProcessed` reject embedded newlines in facts and log
  entries — an embedded newline would forge extra log lines.
