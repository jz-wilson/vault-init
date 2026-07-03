#!/usr/bin/env bun
// Per-turn journal append. Thin wrapper over capture.ts's existing bullet-insertion +
// episodic routing — NO new insert logic lives here. vault-init never calls an LLM;
// the caller (a Claude Code hook, cron job, etc.) passes an already-summarized fact
// string. See templates/hooks/log-turn-hook.md for where the summarization step lives.
//   log-turn.ts "decided to defer phase 4 to next sprint"
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { loadFromScript, type Derived } from "./config.ts";
import { resolvePath, createNote, insertBullet } from "./capture.ts";

const JOURNAL_TYPE = "journal";

/** Append `fact` as a dated bullet to this month's journal file, creating the file if
 *  needed. Requires an episodic `journal` type in vault.config.json — throws a clear
 *  error otherwise. Returns the path written. */
export function logTurn(d: Derived, vaultRoot: string, fact: string, today: Date): string {
  if (!fact || !fact.trim()) throw new Error("fact must be a non-empty string");
  if (fact.includes("\n")) throw new Error("fact must be a single line (no newlines)");
  if (!(JOURNAL_TYPE in d.EPISODIC_DIRS)) {
    throw new Error(
      `no '${JOURNAL_TYPE}' episodic type configured in vault.config.json — add one ` +
        `(e.g. "episodic_dirs": {"journal": "journal"}) before using log-turn`,
    );
  }

  const path = resolvePath(d, vaultRoot, JOURNAL_TYPE, "", today);
  if (!existsSync(path)) createNote(d, path, JOURNAL_TYPE, "", today);
  insertBullet(path, fact, today, vaultRoot, d.VALID_TYPES);
  return path;
}

function main() {
  const fact = process.argv[2];
  const vaultRoot = resolve(import.meta.dir, "..");

  if (!fact) {
    console.error('usage: log-turn.ts "<fact>"');
    process.exit(2);
  }

  let d: Derived;
  try {
    d = loadFromScript(import.meta.dir);
  } catch (e: any) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }

  const today = new Date();
  try {
    const path = logTurn(d, vaultRoot, fact, today);
    console.log(`✓ logged → ${relative(vaultRoot, path)}`);
  } catch (e: any) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}

if (import.meta.main) main();
