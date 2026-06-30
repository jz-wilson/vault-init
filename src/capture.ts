#!/usr/bin/env bun
// Append a dated fact to a vault note + bump updated:. Port of capture.py, config-driven.
//   capture.ts --type project --note vkit "v0.3.1 adds folder routing"
//   capture.ts --type decision "decided to defer Phase 4"   (episodic -> monthly file)
// semantic types -> <dir>/<note>.md (--note required)
// episodic types -> <dir>/<YYYY-MM>.md (--note ignored)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { relative, resolve, dirname, join } from "node:path";
import { parseFrontmatter, fmLineNo, splitLines } from "./frontmatter.ts";
import { loadFromScript, type Derived } from "./config.ts";
import { validateVaultNote } from "./validate-vault.ts";

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function ym(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const titleCase = (s: string) =>
  s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function resolvePath(d: Derived, vaultRoot: string, noteType: string, noteName: string, today: Date): string {
  if (noteType in d.EPISODIC_DIRS) return join(vaultRoot, d.EPISODIC_DIRS[noteType], `${ym(today)}.md`);
  if (noteType in d.SEMANTIC_DIRS) return join(vaultRoot, d.SEMANTIC_DIRS[noteType], `${noteName}.md`);
  throw new Error(`unsupported type '${noteType}' (choices: ${Object.keys(d.TYPE_DIRS).join(", ")})`);
}

function titleFor(d: Derived, noteType: string, noteName: string, today: Date): string {
  if (noteType in d.EPISODIC_DIRS) return `${titleCase(noteType)} ${ym(today)}`;
  return titleCase(noteName);
}

export function createNote(d: Derived, path: string, noteType: string, noteName: string, today: Date): void {
  const title = titleFor(d, noteType, noteName, today);
  const content =
    `---\nupdated: ${ymd(today)}\ntags: [${noteType}]\ntype: ${noteType}\n---\n\n` +
    `# ${title}\n\n## Summary\n_(none yet)_\n\n## Notes\n\n## Related\n_(none yet)_\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

/** Insert index inside ## Notes: the next '## ' heading (or EOF). */
function findNotesInsertIdx(lines: string[]): number {
  let inNotes = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "## Notes") {
      inNotes = true;
      continue;
    }
    if (inNotes && lines[i].startsWith("## ")) return i;
  }
  return lines.length;
}

export function insertBullet(path: string, fact: string, today: Date, vaultRoot: string, validTypes: Set<string>): void {
  const original = readFileSync(path);
  const lines = splitLines(original.toString("utf8"));

  const parsed = parseFrontmatter(lines);
  if (parsed === null) throw new Error(`${path}: frontmatter missing or malformed`);

  const todayStr = ymd(today);
  // 1. bump updated: (fmLineNo returns 1-based file line; fm starts at file line 2)
  const updatedFileLine = fmLineNo(parsed.fm, "updated", 2);
  lines[updatedFileLine - 1] = `updated: ${todayStr}`;

  // 2. insert dated bullet at end of ## Notes
  const idx = findNotesInsertIdx(lines);
  lines.splice(idx, 0, `- ${todayStr}: ${fact}`);

  const newText = lines.join("\n") + "\n";
  writeFileSync(path, newText, "utf8");

  // 3. validate in-process; restore on failure
  const [, errs] = validateVaultNote(path, vaultRoot, validTypes);
  if (errs.length) {
    writeFileSync(path, original);
    const detail = errs.map(([ln, m]) => `  :${ln}: ${m}`).join("\n");
    throw new Error(`validator rejected the modified note — restored original.\n${detail}`);
  }
}

function parseArgs(argv: string[]) {
  let type = "", note = "", fact = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--type") type = argv[++i] ?? "";
    else if (argv[i] === "--note") note = argv[++i] ?? "";
    else fact = argv[i];
  }
  return { type, note, fact };
}

function main() {
  const { type, note, fact } = parseArgs(process.argv.slice(2));
  const vaultRoot = resolve(import.meta.dir, "..");
  const d = loadFromScript(import.meta.dir);

  if (!type || !fact) {
    console.error("usage: capture.ts --type <type> [--note <name>] \"<fact>\"");
    process.exit(2);
  }
  const isSemantic = type in d.SEMANTIC_DIRS;
  if (isSemantic && !note) {
    console.error(`error: --note <name> required for semantic type '${type}'`);
    process.exit(2);
  }

  const today = new Date();
  let path: string;
  try {
    path = resolvePath(d, vaultRoot, type, note, today);
  } catch (e: any) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }

  if (!existsSync(path)) {
    console.log(`note not found — creating: ${relative(vaultRoot, path)}`);
    createNote(d, path, type, note, today);
  }

  try {
    insertBullet(path, fact, today, vaultRoot, d.VALID_TYPES);
  } catch (e: any) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
  console.log(`✓ captured → ${relative(vaultRoot, path)}`);
}

if (import.meta.main) main();
