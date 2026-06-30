# Seed prompt — hand this to an AI to flesh out your vault

The scaffold gave you structure. This prompt gives you content. Paste it into any
capable AI agent (Claude Code, etc.) running with this repo as its working directory.

---

You are bootstrapping a fresh agent-coordination + memory vault. The structure already
exists. Read `vault.config.json`, `_format.md`, and `AGENTS.md` first — they define the
note schema, the directory layout, and the agent protocol. Then:

1. **Replace the examples.** Delete the `example.md` semantic note and the
   `agents/example-agent/` demo log once you understand the schema they demonstrate.

2. **Write the identity layer.** Create `IDENTITY.md` (who operates this vault, working
   style, priorities) and `STACK.md` (the tools/systems this vault tracks) at the root.
   These are the portable procedural tier — keep them dense and current.

3. **Seed each semantic directory** with one real note in the correct schema. For an SRE
   vault: a real runbook, a real service note. Use `bun scripts/capture.ts --type <type>
   --note <name> "<fact>"` so the format and `updated:` bump are handled for you.

4. **Wire the distillation routine.** Set up a scheduled agent (cron / CI) that runs
   `bun scripts/consolidate.ts`, distills each flagged fact into its semantic note via
   `capture.ts`, and commits. This keeps the semantic tier fresh hands-off.

5. **Confirm the gates.** Make a deliberately malformed agent log, `git commit`, and verify
   BOTH the pre-commit hook and the CI workflow reject it. Then delete it.

Output a short summary of what you created and what the operator should fill in by hand.
