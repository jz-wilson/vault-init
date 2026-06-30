#!/usr/bin/env bun
// Agent-log validator. Port of validate-agent-logs.py.
//   no args  -> scan agents/**/reports/*.md (excluding archive/)
//   file args -> validate only those files
import { readFileSync, existsSync } from "node:fs";
import { relative, resolve, basename } from "node:path";
import {
  DATE_RE, parseFrontmatter, extractField, fmLineNo, checkBodyPaths, splitLines,
  type LineError,
} from "./frontmatter.ts";

const REQUIRED_FIELDS = ["updated", "tags", "type", "agent", "status", "task", "priority", "date"];
const VALID_STATUS = ["active", "blocked", "awaiting-approval", "completed", "error"];
const VALID_PRIORITY = ["high", "medium", "low"];
const VALID_ERROR_CLASS = ["transient", "permanent"];
const FILENAME_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/;

const sortedList = (a: string[]) => "[" + [...a].sort().map((s) => `'${s}'`).join(", ") + "]";

export function validateAgentLog(path: string, vaultRoot: string): [string, LineError[]] {
  const errors: LineError[] = [];
  const rel = relative(vaultRoot, path);
  const fname = basename(path);

  if (!FILENAME_RE.test(fname))
    errors.push([1, `filename does not match YYYY-MM-DD-slug.md pattern: ${fname}`]);

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

  for (const field of REQUIRED_FIELDS)
    if (extractField(fm, field) === null)
      errors.push([fmStart, `missing required frontmatter field: '${field}'`]);

  const typeVal = extractField(fm, "type");
  if (typeVal !== null && typeVal !== "agent-log")
    errors.push([fmLineNo(fm, "type", fmStart), `'type' must be 'agent-log', got: '${typeVal}'`]);

  const statusVal = extractField(fm, "status");
  if (statusVal !== null && !VALID_STATUS.includes(statusVal))
    errors.push([fmLineNo(fm, "status", fmStart), `'status' must be one of ${sortedList(VALID_STATUS)}, got: '${statusVal}'`]);

  const priorityVal = extractField(fm, "priority");
  if (priorityVal !== null && !VALID_PRIORITY.includes(priorityVal))
    errors.push([fmLineNo(fm, "priority", fmStart), `'priority' must be one of ${sortedList(VALID_PRIORITY)}, got: '${priorityVal}'`]);

  for (const field of ["date", "updated"]) {
    const val = extractField(fm, field);
    if (val !== null && !DATE_RE.test(val))
      errors.push([fmLineNo(fm, field, fmStart), `'${field}' must match YYYY-MM-DD, got: '${val}'`]);
  }

  const tagsVal = extractField(fm, "tags");
  if (tagsVal !== null && !tagsVal.includes("agent-log"))
    errors.push([fmLineNo(fm, "tags", fmStart), "'tags' must contain 'agent-log'"]);

  const agentVal = extractField(fm, "agent");
  if (agentVal !== null && agentVal.trim() === "")
    errors.push([fmLineNo(fm, "agent", fmStart), "'agent' value must be non-empty"]);

  if (statusVal === "error") {
    const ec = extractField(fm, "error_class");
    if (ec === null) errors.push([fmStart, "status is 'error' but 'error_class' field is missing"]);
    else if (!VALID_ERROR_CLASS.includes(ec))
      errors.push([fmLineNo(fm, "error_class", fmStart), `'error_class' must be one of ${sortedList(VALID_ERROR_CLASS)}, got: '${ec}'`]);
    if (!body.join("\n").includes("## Error Log"))
      errors.push([closeLineNo + 1, "status is 'error' but body is missing '## Error Log' section"]);
  }

  for (const e of checkBodyPaths(body, closeLineNo + 1)) errors.push(e);
  return [rel, errors];
}

export function findAgentLogs(vaultRoot: string): string[] {
  const glob = new Bun.Glob("agents/**/reports/*.md");
  return [...glob.scanSync(vaultRoot)]
    .filter((p) => !p.split("/").includes("archive"))
    .map((p) => resolve(vaultRoot, p))
    .sort();
}

function main() {
  const args = process.argv.slice(2);
  const vaultRoot = resolve(import.meta.dir, "..");
  const targets = args.length ? args.map((a) => resolve(a)).sort() : findAgentLogs(vaultRoot);

  let total = 0;
  let count = 0;
  for (const path of targets) {
    if (!existsSync(path)) {
      console.log(`${path}:1: file not found`);
      total++;
      continue;
    }
    const [rel, errs] = validateAgentLog(path, vaultRoot);
    count++;
    for (const [ln, msg] of errs) {
      console.log(`${rel}:${ln}: ${msg}`);
      total++;
    }
  }

  if (count === 0) {
    console.log("No files found.");
    process.exit(0);
  }
  if (total === 0) {
    console.log(`✓ ${count} files validated, 0 errors`);
    process.exit(0);
  }
  console.log(`✗ ${count} files validated, ${total} errors found`);
  process.exit(1);
}

if (import.meta.main) main();
