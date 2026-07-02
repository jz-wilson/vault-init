#!/usr/bin/env bun
// Non-agent-log vault note validator. Port of validate-vault.py, config-driven types.
//   no args -> scan all *.md under vault root (minus skip subtrees)
//   file args -> validate only those
import { readFileSync, existsSync } from "node:fs";
import { relative, resolve, basename } from "node:path";
import {
  DATE_RE, extractField, fmLineNo, extractTagsList, isValidCalendarDate,
  checkBodyPaths, splitLines, validateCommonNoteShape, parseFrontmatter, type LineError,
} from "./frontmatter.ts";
import { loadFromScript } from "./config.ts";
import { validateAgentLog } from "./validate-logs.ts";

const ROOT_SKIP_FILES = new Set(["CLAUDE.md", "AGENTS.md", "README.md", "RTK.md", "_format.md", "IDENTITY.md", "STACK.md", "SEED-PROMPT.md", "log.md", "ALWAYS.md", "NEVER.md", "SOUL.md"]);
const SKIP_SUBTREES = new Set(["scripts", "dashboard", ".git", ".claude", ".omc", "agents", "handoffs", ".obsidian"]);

const sortedTypes = (s: Set<string>) => "[" + [...s].sort().map((t) => `'${t}'`).join(", ") + "]";

function validateTags(fm: string[], fmStart: number): LineError[] {
  const errors: LineError[] = [];
  const ln = fmLineNo(fm, "tags", fmStart);
  const tags = extractTagsList(fm);
  if (tags === null) {
    errors.push([ln, "missing required frontmatter field: 'tags'"]);
    return errors;
  }
  for (const tag of tags) {
    if (tag.startsWith("#")) errors.push([ln, `tag '${tag}' must not have a '#' prefix`]);
    if (tag !== tag.toLowerCase()) errors.push([ln, `tag '${tag}' must be lowercase`]);
  }
  return errors;
}

export function validateVaultNote(path: string, vaultRoot: string, validTypes: Set<string>): [string, LineError[]] {
  const errors: LineError[] = [];
  const rel = relative(vaultRoot, path);

  const { errors: shapeErrors, shape } = validateCommonNoteShape(path);
  errors.push(...shapeErrors);
  if (shape === null) return [rel, errors];
  const { fm, body, closeLineNo, fmStart } = shape;

  const updatedVal = extractField(fm, "updated");
  if (updatedVal === null) errors.push([fmStart, "missing required frontmatter field: 'updated'"]);
  else if (!DATE_RE.test(updatedVal))
    errors.push([fmLineNo(fm, "updated", fmStart), `'updated' must match YYYY-MM-DD, got: '${updatedVal}'`]);
  else if (!isValidCalendarDate(updatedVal))
    errors.push([fmLineNo(fm, "updated", fmStart), `'updated' is not a real calendar date: '${updatedVal}'`]);

  for (const e of validateTags(fm, fmStart)) errors.push(e);

  const typeVal = extractField(fm, "type");
  if (typeVal === null) errors.push([fmStart, "missing required frontmatter field: 'type'"]);
  else if (!validTypes.has(typeVal))
    errors.push([fmLineNo(fm, "type", fmStart), `'type' must be one of ${sortedTypes(validTypes)}, got: '${typeVal}'`]);

  // person notes layer met:/last_contact: on top of the common shape, mirroring how
  // validate-logs.ts layers agent-log-specific fields (same error message style).
  if (typeVal === "person") {
    for (const field of ["met", "last_contact"]) {
      const val = extractField(fm, field);
      if (val === null) errors.push([fmStart, `missing required frontmatter field: '${field}'`]);
      else if (!DATE_RE.test(val))
        errors.push([fmLineNo(fm, field, fmStart), `'${field}' must match YYYY-MM-DD, got: '${val}'`]);
      else if (!isValidCalendarDate(val))
        errors.push([fmLineNo(fm, field, fmStart), `'${field}' is not a real calendar date: '${val}'`]);
    }
  }

  const bodyStart = closeLineNo + 1;
  if (!body.some((bl) => /^# \S/.test(bl)))
    errors.push([bodyStart, "body missing H1 heading (a line starting with '# ')"]);

  const bodyText = body.join("\n");
  for (const section of ["## Summary", "## Notes", "## Related"])
    if (!bodyText.includes(section)) errors.push([bodyStart, `body missing required section '${section}'`]);

  for (const e of checkBodyPaths(body, bodyStart)) errors.push(e);
  return [rel, errors];
}

export function shouldSkip(rel: string): boolean {
  const parts = rel.split("/");
  if (parts.length === 1 && ROOT_SKIP_FILES.has(parts[0])) return true;
  if (parts.length && SKIP_SUBTREES.has(parts[0])) return true;
  // clippings are schema-exempt in full-scan mode (explicit-args bypass still checks them):
  // wiki/raw/ holds unedited drops, wiki/processed/ the same files after nightly.ts's move —
  // neither is ever hand-formatted; the schema applies to the concept notes they fold into.
  if (parts.length >= 2 && parts[0] === "wiki" && (parts[1] === "raw" || parts[1] === "processed")) return true;
  // generated index files carry no frontmatter.
  if (basename(rel) === "index.md") return true;
  return false;
}

function isAgentLog(path: string): boolean {
  try {
    const parsed = parseFrontmatter(splitLines(readFileSync(path, "utf8")));
    return parsed !== null && extractField(parsed.fm, "type") === "agent-log";
  } catch {
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  const vaultRoot = resolve(import.meta.dir, "..");
  const { VALID_TYPES } = loadFromScript(import.meta.dir);
  const explicit = args.length > 0;

  const targets = explicit
    ? args.map((a) => resolve(a)).sort()
    : [...new Bun.Glob("**/*.md").scanSync(vaultRoot)].map((p) => resolve(vaultRoot, p)).sort();

  let total = 0;
  let count = 0;
  for (const path of targets) {
    if (!existsSync(path)) {
      console.log(`${path}:1: file not found`);
      total++;
      continue;
    }
    const rel = relative(vaultRoot, path);
    // shouldSkip is a full-scan filter — an explicitly named file is always checked.
    if (!explicit && shouldSkip(rel)) continue;

    const [r, errs] = isAgentLog(path)
      ? validateAgentLog(path, vaultRoot)
      : validateVaultNote(path, vaultRoot, VALID_TYPES);
    count++;
    for (const [ln, msg] of errs) {
      console.log(`${r}:${ln}: ${msg}`);
      total++;
    }
  }

  if (total === 0) {
    console.log(`✓ ${count} files validated, 0 errors`);
    process.exit(0);
  }
  console.log(`✗ ${count} files validated, ${total} errors found`);
  process.exit(1);
}

if (import.meta.main) main();
