# Nightly automation — systemd timer + cron

## Summary
Runs `bun scripts/nightly.ts` on a recurring local schedule (as an alternative or
complement to `templates/ci/nightly.yml`'s Forgejo/GitHub Actions `schedule:` trigger).

## Notes

### Division of labor — read this first

`nightly.ts` has exactly two jobs:

1. `list` — compute the deterministic worklist: filenames in `wiki/raw/` with no
   same-named mirror in `wiki/processed/`.
2. `process <file> --log "<entry>" --apply` — the auditable move+commit: `git mv
   wiki/raw/<file> wiki/processed/<file>`, append a dated bullet to root `log.md`, commit.
   Dry-run by default; never pushes unless a separate explicit `--push` is also passed.

Everything else — theme extraction, folding facts into concept notes, interlinking related
notes — is **judgment work done by the invoked agent**, using `capture.ts` and its own
reasoning. `nightly.ts` does not summarize, does not call an LLM, and does not decide what a
clipping means. It only tracks what's unprocessed and provides one safe, auditable way to
mark something processed.

A typical nightly run:

```bash
bun scripts/nightly.ts list                                   # what needs attention
# → an agent reads each raw clipping, folds relevant facts into semantic notes via
#   capture.ts, writes/updates interlinks, then per file:
bun scripts/nightly.ts process clip-2026-07-01.md \
  --log "folded infra facts into infrastructure/proxmox-cluster.md" --apply
# → review the resulting commit(s) locally before pushing, or pass --push once you trust
#   the automation:
bun scripts/nightly.ts process clip-2026-07-02.md --log "..." --apply --push
```

### systemd timer

`~/.config/systemd/user/vault-nightly.service`:

```ini
[Unit]
Description=vault-init nightly worklist processing

[Service]
Type=oneshot
WorkingDirectory=%h/path/to/vault
ExecStart=/usr/bin/env bash -c 'bun scripts/nightly.ts list && your-agent-runner --worklist-from "bun scripts/nightly.ts list"'
```

`~/.config/systemd/user/vault-nightly.timer`:

```ini
[Unit]
Description=Run vault-init nightly processing daily

[Timer]
OnCalendar=*-*-* 09:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable:

```bash
systemctl --user enable --now vault-nightly.timer
systemctl --user list-timers vault-nightly.timer   # confirm next run
```

`your-agent-runner` is whatever invokes an agent against the worklist — vault-init doesn't
ship one; it only guarantees `nightly.ts list`'s output is stable and `process --apply` is
safe to call repeatedly (already-processed files simply drop out of the worklist).

### cron (fallback, no systemd)

```cron
0 9 * * * cd /path/to/vault && bun scripts/nightly.ts list && your-agent-runner >> /path/to/vault/.nightly.log 2>&1
```

### Manual dry run

```bash
bun scripts/nightly.ts list
bun scripts/nightly.ts process <file> --log "preview only"   # no --apply: prints the plan, changes nothing
```

## Related
- [[log-turn-hook]] — the per-turn counterpart (journal, not raw clippings)
- [[_format]] — note format + schema
