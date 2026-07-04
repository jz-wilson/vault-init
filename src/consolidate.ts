#!/usr/bin/env bun
// Archival + distillation worklist. Port of consolidate.py.
// CHANGE (Q8): archival is decoupled from verified — age-only (completed + >90d).
//   consolidate.ts           dry-run
//   consolidate.ts --apply   git mv eligible logs to archive/
//   consolidate.ts --archive-only
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { relative, resolve, join, basename, dirname } from "node:path";
import { parseFrontmatter, extractField, splitLines, isValidCalendarDate } from "./frontmatter.ts";
import { loadFromScript, type Derived } from "./config.ts";
import { findAgentLogs } from "./validate-logs.ts";

const ARCHIVE_THRESHOLD_DAYS = 90;
const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

function dateOrNull(val: string | null): Date | null {
  if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val) || !isValidCalendarDate(val)) return null;
  const d = new Date(val + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

/** Local calendar date (Y-M-D of `now`) recast as a UTC-midnight Date, so it's
 * comparable to dateOrNull()'s output without local-instant-vs-UTC-midnight drift. */
function todayCalendarDate(now: Date): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function readFm(path: string): { fm: string[]; body: string[] } | null {
  try {
    const parsed = parseFrontmatter(splitLines(readFileSync(path, "utf8")));
    return parsed ? { fm: parsed.fm, body: parsed.body } : null;
  } catch {
    return null;
  }
}

function resolveWikiLink(d: Derived, vaultRoot: string, name: string): string | null {
  const trimmed = name.trim();
  const stem = trimmed.includes("/") ? trimmed.split("/").pop()! : trimmed;
  for (const dir of Object.values(d.SEMANTIC_DIRS)) {
    const cand = join(vaultRoot, dir, `${stem}.md`);
    if (existsSync(cand)) return cand;
  }
  const asIs = join(vaultRoot, `${trimmed}.md`);
  return existsSync(asIs) ? asIs : null;
}

function wikiLinksFromRelated(body: string[]): string[] {
  let inRelated = false;
  const links: string[] = [];
  for (const line of body) {
    if (line.startsWith("## Related")) {
      inRelated = true;
      continue;
    }
    if (inRelated && line.startsWith("## ")) break;
    if (inRelated) {
      for (const m of line.matchAll(WIKI_LINK_RE)) links.push(m[1]);
    }
  }
  return links;
}

export function findArchivalCandidates(d: Derived, vaultRoot: string, today: Date): [string, string][] {
  const threshold = new Date(todayCalendarDate(today).getTime() - ARCHIVE_THRESHOLD_DAYS * 86400_000);
  const out: [string, string][] = [];
  for (const path of findAgentLogs(vaultRoot)) {
    const f = readFm(path);
    if (!f) continue;
    if (extractField(f.fm, "status") !== "completed") continue; // Q8: no verified check
    const logDate = dateOrNull(extractField(f.fm, "date"));
    if (logDate === null || logDate >= threshold) continue;
    const parts = relative(vaultRoot, path).split("/");
    const agentName = parts[parts.indexOf("agents") + 1];
    out.push([path, agentName]);
  }
  return out;
}

function archiveLogs(candidates: [string, string][], vaultRoot: string, apply: boolean): boolean {
  if (!candidates.length) {
    console.log("archive: 0 candidates (nothing to do)");
    return true;
  }
  console.log(`archive: ${candidates.length} candidate(s)${apply ? "" : "  [DRY RUN — use --apply to execute]"}`);
  let ok = true;
  for (const [path, agentName] of candidates) {
    const archiveDir = join(vaultRoot, "agents", agentName, "reports", "archive");
    const dest = join(archiveDir, basename(path));
    if (apply) {
      mkdirSync(archiveDir, { recursive: true });
      const r = Bun.spawnSync(["git", "mv", relative(vaultRoot, path), relative(vaultRoot, dest)], { cwd: vaultRoot });
      if (r.exitCode !== 0) {
        console.log(`  ERROR git mv ${basename(path)}: ${r.stderr.toString().trim()}`);
        ok = false;
      } else {
        console.log(`  archived → ${relative(vaultRoot, dest)}`);
      }
    } else {
      console.log(`  would archive → ${relative(vaultRoot, dest)}`);
    }
  }
  return ok;
}

export function findDistillationCandidates(d: Derived, vaultRoot: string): [string, string][] {
  const pairs: [string, string][] = [];
  const seen = new Set<string>();
  const semanticDirs = new Set(Object.values(d.SEMANTIC_DIRS));
  for (const path of findAgentLogs(vaultRoot)) {
    const f = readFm(path);
    if (!f) continue;
    if (extractField(f.fm, "status") !== "completed") continue;
    const logDate = dateOrNull(extractField(f.fm, "date"));
    if (logDate === null) continue;
    for (const linkName of wikiLinksFromRelated(f.body)) {
      const linked = resolveWikiLink(d, vaultRoot, linkName);
      if (!linked) continue;
      if (!semanticDirs.has(basename(dirname(linked)))) continue;
      const key = `${path}|${linked}`;
      if (seen.has(key)) continue; // dedup: same log linking the same note via multiple [[...|x]]/[[...#y]] forms
      seen.add(key);
      const lf = readFm(linked);
      if (!lf) continue;
      const linkedUpdated = dateOrNull(extractField(lf.fm, "updated"));
      if (linkedUpdated === null) continue;
      if (linkedUpdated < logDate) pairs.push([path, linked]);
    }
  }
  return pairs;
}

function printDistillation(pairs: [string, string][], vaultRoot: string): void {
  if (!pairs.length) {
    console.log("distillation: 0 stale links found — semantic notes appear up to date");
    return;
  }
  console.log(`distillation: ${pairs.length} log(s) may have facts not yet in semantic notes`);
  console.log("  → use capture.ts to fold each fact in, then re-run to confirm resolution\n");
  for (const [logPath, notePath] of pairs) {
    console.log(`  [ ] ${relative(vaultRoot, logPath)}`);
    console.log(`        → update: ${relative(vaultRoot, notePath)}`);
  }
}

function main() {
  const apply = process.argv.includes("--apply");
  const archiveOnly = process.argv.includes("--archive-only");
  const vaultRoot = resolve(import.meta.dir, "..");
  const d = loadFromScript(import.meta.dir);
  const today = new Date();

  const archiveOk = archiveLogs(findArchivalCandidates(d, vaultRoot, today), vaultRoot, apply);
  if (!archiveOnly) {
    console.log();
    printDistillation(findDistillationCandidates(d, vaultRoot), vaultRoot);
  }
  if (!archiveOk) process.exit(1);
}

if (import.meta.main) main();
