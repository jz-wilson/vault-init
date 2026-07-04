#!/usr/bin/env bun
// Nightly raw-clipping worklist + auditable processing. No LLM calls live here —
// nightly.ts only computes the deterministic worklist and performs the auditable
// git mv + log.md append + commit. Theme extraction / folding into concept notes /
// interlinking is the invoking agent's job (via capture.ts + judgment) — see
// templates/hooks/nightly-automation.md for the division of labor.
//   nightly.ts list                                   (default) print the worklist
//   nightly.ts process <file> --log "entry" [--apply] [--push]
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, lstatSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { ymd } from "./capture.ts";
import { runMain } from "./config.ts";

const RAW_DIR = "wiki/raw";
const PROCESSED_DIR = "wiki/processed";
const EXCLUDE = new Set([".gitkeep", "index.md"]);

/** Plain filenames in wiki/raw/ (excluding .gitkeep, index.md) with no same-named
 *  mirror in wiki/processed/. Pure — reads the filesystem, changes nothing. */
export function listUnprocessed(vaultRoot: string): string[] {
  const rawDir = join(vaultRoot, RAW_DIR);
  if (!existsSync(rawDir)) return [];
  const processedDir = join(vaultRoot, PROCESSED_DIR);
  const processed = new Set(existsSync(processedDir) ? readdirSync(processedDir) : []);
  return readdirSync(rawDir)
    .filter((f) => !EXCLUDE.has(f))
    .filter((f) => statSync(join(rawDir, f)).isFile())
    .filter((f) => !processed.has(f))
    .sort();
}

/** Reject anything but a plain filename — same guard shape as capture.ts's resolvePath. */
function assertPlainFilename(filename: string): void {
  if (!filename || /[\/\\]/.test(filename) || filename === "." || filename === "..")
    throw new Error(`invalid filename '${filename}': must be a plain filename with no path separators`);
}

function appendLogEntry(vaultRoot: string, bullet: string): void {
  const logPath = join(vaultRoot, "log.md");
  let content = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  if (content && !content.endsWith("\n")) content += "\n";
  content += bullet + "\n";
  writeFileSync(logPath, content, "utf8");
}

/** Dry-run (default, apply=false): print what would happen, touch nothing.
 *  Apply: `git mv wiki/raw/<filename> wiki/processed/<filename>`, append a dated
 *  bullet to root log.md (creating it if missing), `git add log.md`, then commit.
 *  Never pushes — see pushToRemote(), only called by the CLI when --push is passed. */
export function markProcessed(
  vaultRoot: string,
  filename: string,
  logEntry: string,
  apply: boolean,
  today: Date,
): void {
  assertPlainFilename(filename);
  if (!logEntry || !logEntry.trim()) throw new Error("logEntry must be a non-empty string");
  // one bullet per entry — an embedded newline would forge extra log.md lines (same guard as log-turn.ts)
  if (logEntry.includes("\n")) throw new Error("logEntry must be a single line");

  const rawRel = `${RAW_DIR}/${filename}`;
  const processedRel = `${PROCESSED_DIR}/${filename}`;
  const rawPath = join(vaultRoot, RAW_DIR, filename);
  const bullet = `- ${ymd(today)}: ${logEntry} ([[${processedRel}]])`;

  if (!existsSync(rawPath)) throw new Error(`not found: ${rawRel}`);
  // a symlink here could point outside the vault and survive the move still dangling out
  if (lstatSync(rawPath).isSymbolicLink()) throw new Error(`refusing to process symlink: ${rawRel}`);

  if (!apply) {
    console.log(`[DRY RUN] would git mv ${rawRel} → ${processedRel}`);
    console.log(`[DRY RUN] would append to log.md: ${bullet}`);
    console.log(`[DRY RUN] would git add log.md && git commit — use --apply to execute`);
    return;
  }

  mkdirSync(join(vaultRoot, PROCESSED_DIR), { recursive: true });
  // fresh clippings are usually untracked — git mv requires a tracked source
  const track = Bun.spawnSync(["git", "add", rawRel], { cwd: vaultRoot });
  if (track.exitCode !== 0) throw new Error(`git add ${rawRel} failed: ${track.stderr.toString().trim()}`);
  const mv = Bun.spawnSync(["git", "mv", rawRel, processedRel], { cwd: vaultRoot });
  if (mv.exitCode !== 0) throw new Error(`git mv failed: ${mv.stderr.toString().trim()}`);

  appendLogEntry(vaultRoot, bullet);

  const add = Bun.spawnSync(["git", "add", "log.md"], { cwd: vaultRoot });
  if (add.exitCode !== 0) throw new Error(`git add log.md failed: ${add.stderr.toString().trim()}`);

  const commit = Bun.spawnSync(
    ["git", "commit", "-m", `nightly: process ${filename}\n\n${logEntry}`],
    { cwd: vaultRoot },
  );
  if (commit.exitCode !== 0) throw new Error(`git commit failed: ${commit.stderr.toString().trim()}`);
}

/** Only called by the CLI after a successful --apply commit, and only with explicit --push. */
export function pushToRemote(vaultRoot: string): void {
  const push = Bun.spawnSync(["git", "push"], { cwd: vaultRoot });
  if (push.exitCode !== 0) throw new Error(`git push failed: ${push.stderr.toString().trim()}`);
}

function printList(vaultRoot: string): void {
  if (!existsSync(join(vaultRoot, RAW_DIR))) {
    console.log(`nightly: no ${RAW_DIR}/ dir — clipping worklist disabled (create it to enable)`);
    return;
  }
  const files = listUnprocessed(vaultRoot);
  if (!files.length) {
    console.log(`nightly: 0 unprocessed clipping(s) in ${RAW_DIR}/`);
    return;
  }
  console.log(`nightly: ${files.length} unprocessed clipping(s) in ${RAW_DIR}/`);
  for (const f of files) console.log(`  ${f}`);
}

function parseProcessArgs(argv: string[]) {
  const filename = argv[0] && !argv[0].startsWith("--") ? argv[0] : "";
  let logEntry = "";
  let apply = false;
  let push = false;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--log") logEntry = argv[++i] ?? "";
    else if (argv[i] === "--apply") apply = true;
    else if (argv[i] === "--push") push = true;
  }
  return { filename, logEntry, apply, push };
}

function main() {
  const vaultRoot = resolve(import.meta.dir, "..");
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === "list") {
    printList(vaultRoot);
    return;
  }

  if (cmd === "process") {
    const { filename, logEntry, apply, push } = parseProcessArgs(rest);
    if (!filename) {
      console.error('usage: nightly.ts process <file> --log "entry" [--apply] [--push]');
      process.exit(2);
    }
    if (!logEntry) {
      console.error('error: --log "<entry>" is required');
      process.exit(2);
    }
    try {
      markProcessed(vaultRoot, filename, logEntry, apply, new Date());
      if (apply) {
        console.log(`✓ processed → ${PROCESSED_DIR}/${filename}`);
        if (push) {
          pushToRemote(vaultRoot);
          console.log("✓ pushed");
        }
      }
    } catch (e: any) {
      console.error(`error: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  console.error('usage: nightly.ts [list | process <file> --log "entry" [--apply] [--push]]');
  process.exit(2);
}

if (import.meta.main) runMain(main);
