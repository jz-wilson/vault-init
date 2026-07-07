#!/usr/bin/env bash
# Nightly vault maintenance — runs locally on the machine the vault lives on.
# Installed to a schedule by vault-init (--nightly); safe to run by hand anytime.
set -euo pipefail
# cron/systemd start with a minimal PATH — cover the common bun install locations
export PATH="$HOME/.bun/bin:/home/linuxbrew/.linuxbrew/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v bun >/dev/null || { echo "nightly: bun not found in PATH" >&2; exit 1; }
cd "$(dirname "$0")/.."

bun scripts/validate-vault.ts
bun scripts/index.ts
bun scripts/dashboard.ts

# Deterministic worklist: unprocessed clippings + pending self-review proposals.
# Distillation and rule-change drafting are agent work (see scripts/hooks/
# nightly-automation.md and scripts/hooks/self-review.md) — point VAULT_AGENT_CMD
# at your runner to process it, e.g.:
#   VAULT_AGENT_CMD='claude -p "process the vault nightly worklist per scripts/hooks/nightly-automation.md"'
bun scripts/nightly.ts list
if [ -n "${VAULT_AGENT_CMD:-}" ]; then
  eval "$VAULT_AGENT_CMD"
fi

git add -A
git diff --cached --quiet || git commit -m "nightly: maintenance $(date +%F)"
# Never pushes. Add a push here (or in VAULT_AGENT_CMD) once you trust the automation.
