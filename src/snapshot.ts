#!/usr/bin/env bun
// Token-capped identity digest — pre-reads a small, prioritized set of vault files (IDENTITY.md,
// ALWAYS.md, ...) into a budget-bounded string so a fresh agent session can prime on "who am I /
// what matters" without reading the whole vault. Intended to run as a Claude Code SessionStart
// hook (see templates/hooks/session-start-snapshot.md) and have its stdout injected as context.
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadFromScript, resolveInside, type SnapshotConfig } from "./config.ts";

const DEFAULT_SNAPSHOT: SnapshotConfig = {
  files: ["IDENTITY.md", "ALWAYS.md", "NEVER.md", "AGENTS.md"],
  budget_tokens: 1300,
};

const HEADING_RE = /^##(?!#)/; // matches "## Foo" but not "### Foo" — ### stays nested in its parent section

/** Approximate token count: chars/4. No tokenizer dependency by design (zero network, zero deps) —
 *  good enough for a soft budget cap, not exact. */
function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/** Split markdown content into `##`-delimited sections. Element 0 is the "lead" section — everything
 *  before the first `##` heading (may include a `# Title` line and intro prose). Each subsequent
 *  element starts with its `##` heading line through (not including) the next `##` heading.
 *  `###`+ headings are not split points; they stay attached to their enclosing `##` section. */
function splitSections(content: string): string[] {
  const lines = content.split("\n");
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (HEADING_RE.test(line)) {
      sections.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  sections.push(current.join("\n"));
  return sections;
}

/**
 * Build a token-capped digest from files in priority order.
 *
 * Walks files in the given order; for each file, walks its `##` sections in order, including
 * whole sections while they fit the remaining budget. The first section that would exceed the
 * remaining budget is dropped entirely, and processing stops there — no later section, in this
 * file or any later file, is considered. This gives a predictable, priority-order cutoff rather
 * than a best-fit packing. Sections are never truncated mid-sentence.
 *
 * Each included file's content is prefixed with a `# <basename>` marker line so the digest stays
 * navigable; that marker's token cost is charged against the budget alongside the file's first
 * included section (a file that can't fit even its marker + first section contributes nothing).
 */
export function buildSnapshot(files: { path: string; content: string }[], budgetTokens: number): string {
  let remaining = budgetTokens;
  const output: string[] = [];

  for (const file of files) {
    const sections = splitSections(file.content)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (sections.length === 0) continue;

    const marker = `# ${basename(file.path)}`;
    const included: string[] = [];
    let markerCharged = false;
    let stopped = false;

    for (const section of sections) {
      const cost = approxTokens(section) + (markerCharged ? 0 : approxTokens(marker));
      if (cost > remaining) {
        stopped = true;
        break;
      }
      included.push(section);
      remaining -= cost;
      markerCharged = true;
    }

    if (included.length > 0) output.push(`${marker}\n\n${included.join("\n\n")}`);
    if (stopped) break; // priority-order cutoff — do not consider later files
  }

  return output.join("\n\n");
}

/** join+resolve that refuses to escape vaultRoot — same guard pattern as safeJoin() in init.ts. */
function parseBudgetFlag(argv: string[]): number | undefined {
  const i = argv.indexOf("--budget");
  if (i === -1) return undefined;
  const raw = argv[i + 1];
  const val = Number(raw);
  if (!Number.isFinite(val) || val <= 0) throw new Error(`invalid --budget value: '${raw}'`);
  return val;
}

function main() {
  const vaultRoot = resolve(import.meta.dir, "..");
  const { cfg } = loadFromScript(import.meta.dir);
  const snapshotCfg: SnapshotConfig = cfg.snapshot ?? DEFAULT_SNAPSHOT;

  const argv = process.argv.slice(2);
  const budgetOverride = parseBudgetFlag(argv);
  const budgetTokens = budgetOverride ?? snapshotCfg.budget_tokens;

  const files: { path: string; content: string }[] = [];
  for (const rel of snapshotCfg.files) {
    let full: string;
    try {
      full = resolveInside(vaultRoot, rel, "snapshot: path");
    } catch (e: any) {
      console.error(`snapshot: ${e.message}`);
      process.exit(1);
    }
    if (!existsSync(full)) continue; // missing files skipped silently
    files.push({ path: rel, content: readFileSync(full, "utf8") });
  }

  const snapshot = buildSnapshot(files, budgetTokens);
  if (argv.includes("--json"))
    console.log(JSON.stringify({ budgetTokens, files: files.map((f) => f.path), snapshot }, null, 2));
  else console.log(snapshot);
}

if (import.meta.main) main();
