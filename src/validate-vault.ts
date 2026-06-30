#!/usr/bin/env bun
// Non-agent-log vault note validator. Port of validate-vault.py, config-driven types.
//   no args -> scan all *.md under vault root (minus skip subtrees)
//   file args -> validate only those
import { readFileSync, existsSync } from "node:fs";
import { relative, resolve, basename } from "node:path";
import {
  DATE_RE, parseFrontmatter, extractField, fmLineNo, extractTagsList,
  checkBodyPaths, splitLines, type LineError,
} from "./frontmatter.ts";
import { loadFromScript } from "./config.ts";
import { validateAgentLog } from "./validate-logs.ts";

const ROOT_SKIP_FILES = new Set(["CLAUDE.md", "AGENTS.md", "README.md", "RTK.md", "_format.md", "IDENTITY.md", "STACK.md", "SEED-PROMPT.md"]);
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

  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (e) {
    errors.push([1, `cannot read file: ${e}`]);
    return [rel, errors];
  }

  const text = raw.toString("utf8");
  if (!text.endsWith("\n")) errors.push([0, "file does not end with a newline"]);
  else if (text.endsWith("\n\n")) errors.push([0, "file has trailing blank lines (must end with exactly one newline)"]);

  const nlines = splitLines(text);
  if (nlines.length === 0 || nlines[0] !== "---") {
    errors.push([1, "file does not start with '---' frontmatter delimiter"]);
    return [rel, errors];
  }

  const parsed = parseFrontmatter(nlines);
  if (parsed === null) {
    errors.push([1, "frontmatter opening '---' has no matching closing '---'"]);
    return [rel, errors];
  }
  const { fm, body, closeLineNo } = parsed;
  const fmStart = 2;

  const updatedVal = extractField(fm, "updated");
  if (updatedVal === null) errors.push([fmStart, "missing required frontmatter field: 'updated'"]);
  else if (!DATE_RE.test(updatedVal))
    errors.push([fmLineNo(fm, "updated", fmStart), `'updated' must match YYYY-MM-DD, got: '${updatedVal}'`]);

  for (const e of validateTags(fm, fmStart)) errors.push(e);

  const typeVal = extractField(fm, "type");
  if (typeVal === null) errors.push([fmStart, "missing required frontmatter field: 'type'"]);
  else if (!validTypes.has(typeVal))
    errors.push([fmLineNo(fm, "type", fmStart), `'type' must be one of ${sortedTypes(validTypes)}, got: '${typeVal}'`]);

  const bodyStart = closeLineNo + 1;
  if (!body.some((bl) => /^# \S/.test(bl)))
    errors.push([bodyStart, "body missing H1 heading (a line starting with '# ')"]);

  const bodyText = body.join("\n");
  for (const section of ["## Summary", "## Notes", "## Related"])
    if (!bodyText.includes(section)) errors.push([bodyStart, `body missing required section '${section}'`]);

  for (const e of checkBodyPaths(body, bodyStart)) errors.push(e);
  return [rel, errors];
}

function shouldSkip(rel: string): boolean {
  const parts = rel.split("/");
  if (parts.length === 1 && ROOT_SKIP_FILES.has(parts[0])) return true;
  if (parts.length && SKIP_SUBTREES.has(parts[0])) return true;
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

  const targets = args.length
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
    if (shouldSkip(rel)) continue;

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
