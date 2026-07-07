# Self-review — propose-only rule improvement

## Summary
A nightly judgment step for the **invoking agent** (vault-init ships no engine for this —
zero network/LLM calls stays true): read what past agent runs actually did, extract recurring
lessons, and **draft proposals** for rule changes. Proposals are files a human reviews;
nothing here ever edits `ALWAYS.md`, `NEVER.md`, or `CLAUDE.md` directly.

## Notes

### The loop

1. **Read the evidence.** Scan `agents/*/reports/*.md` (skip `archive/`) for logs with
   `status: completed` and `verified: true` — verified means an operator reviewed the work,
   so lessons drawn from it stand on confirmed outcomes, not agent self-assessment.
   Unverified or `error` logs may still signal anti-patterns; cite them only as supporting
   evidence, never as the sole basis for a proposal.
2. **Extract recurring lessons.** One-off events are not rules. Look for the same failure
   mode, workaround, or convention appearing across ≥2 independent runs.
3. **Draft a proposal.** Write `agents/self-review/proposals/YYYY-MM-DD.md` (create the
   directory if missing; one file per day, append if it exists). For each proposed change:
   - the exact diff-style edit to `ALWAYS.md`, `NEVER.md`, or `CLAUDE.md`
   - the evidence: links to the agent logs that motivated it
   - blast radius: what behavior changes if adopted
4. **Stop.** Do not apply the edit. Do not touch the rule files.

### Human approval

Pending proposals surface in the nightly worklist (`bun scripts/nightly.ts list`). The
operator reviews each file, applies what they accept to the rule files by hand (or asks an
agent to apply a specific accepted diff), then deletes or archives the proposal file —
an empty `proposals/` dir means nothing is pending.

### Boundaries

- **Propose-only.** A proposal file is the only artifact this step may write.
- **No engine.** vault-init provides the worklist line and this doc — the judgment is
  yours (the invoking agent's), per the zero-LLM-in-codebase rule.
- **Evidence-linked.** A proposal without log citations should be rejected on sight.

## Related
- [[nightly-automation]] — scheduling; this step rides the same nightly invocation
- [[_format]] — agent-log schema (`status`, `verified` fields)
