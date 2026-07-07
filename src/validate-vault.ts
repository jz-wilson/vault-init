#!/usr/bin/env bun
// Non-agent-log vault note validator. Port of validate-vault.py, config-driven types.
//   no args -> scan all *.md under vault root (minus skip subtrees)
//   file args -> validate only those
import { readFileSync, existsSync } from "node:fs";
import { relative, resolve, basename } from "node:path";
import {
  DATE_RE, extractField, fmLineNo, extractTagsList, isValidCalendarDate,
  checkBodyPaths, splitLines, validateCommonNoteShape, parseFrontmatter,
  FENCE_RE, INLINE_CODE_RE, type LineError,
} from "./frontmatter.ts";
import { loadFromScript, NONCONTENT_SUBTREES, inSkippedSubtree, runMain } from "./config.ts";
import { validateAgentLog } from "./validate-logs.ts";

const ROOT_SKIP_FILES = new Set(["CLAUDE.md", "AGENTS.md", "README.md", "RTK.md", "_format.md", "IDENTITY.md", "STACK.md", "SEED-PROMPT.md", "log.md", "ALWAYS.md", "NEVER.md", "SOUL.md"]);
// agents/ + handoffs/ are validated by their own path (validate-logs.ts / isAgentLog dispatch), not here.
const SKIP_SUBTREES = new Set([...NONCONTENT_SUBTREES, "agents", "handoffs"]);

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

/** okfCompat=true (OKF permissive parsing): an unknown 'type' is a warning (third tuple slot),
 *  not an error — the recommended set stays UNIVERSAL_TYPES + configured dirs either way. */
export function validateVaultNote(path: string, vaultRoot: string, validTypes: Set<string>, okfCompat = false): [string, LineError[], LineError[]] {
  const errors: LineError[] = [];
  const warnings: LineError[] = [];
  const rel = relative(vaultRoot, path);

  const { errors: shapeErrors, shape } = validateCommonNoteShape(path);
  errors.push(...shapeErrors);
  if (shape === null) return [rel, errors, warnings];
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
    (okfCompat ? warnings : errors).push([fmLineNo(fm, "type", fmStart), `'type' must be one of ${sortedTypes(validTypes)}, got: '${typeVal}'`]);

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
  return [rel, errors, warnings];
}

export function shouldSkip(rel: string): boolean {
  const parts = rel.split("/");
  if (parts.length === 1 && ROOT_SKIP_FILES.has(parts[0])) return true;
  if (inSkippedSubtree(rel, SKIP_SUBTREES)) return true;
  // clippings are schema-exempt in full-scan mode (explicit-args bypass still checks them):
  // wiki/raw/ holds unedited drops, wiki/processed/ the same files after nightly.ts's move —
  // neither is ever hand-formatted; the schema applies to the concept notes they fold into.
  if (parts.length >= 2 && parts[0] === "wiki" && (parts[1] === "raw" || parts[1] === "processed")) return true;
  // generated index files carry no frontmatter.
  if (basename(rel) === "index.md") return true;
  return false;
}

// Cross-file broken-link detection (stolen from P.O.W.E.R's lint_brain.py, kept pure/offline).
// Whole-vault pass: per-file validateVaultNote can't see whether [[X]] resolves.
// ponytail: dropped orphan-detection — warn-only, fired on every fresh note = ignored noise.
const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g; // mirrors consolidate.ts
const MD_LINK_RE = /\]\(([^)]+?)\)/g;
const stripMd = (rel: string) => rel.replace(/\\/g, "/").replace(/\.md$/, "");

export interface LinkReport {
  broken: [string, number, string][]; // [rel, line, msg] — hard errors
}

/** Broken-link detection over the whole vault. Obsidian-style resolution: a bare [[foo]]
 *  resolves if any note basename `foo.md` exists anywhere; a path-qualified [[dir/foo]]
 *  must match that exact relative path. Resolution is case-insensitive (Obsidian default).
 *  Existence set spans ALL notes (incl. skip-files like README that are valid link targets);
 *  only non-skipped notes are linted as sources. */
export function checkLinks(vaultRoot: string): LinkReport {
  const allMd = [...new Bun.Glob("**/*.md").scanSync(vaultRoot)];
  const existStems = new Set(allMd.map((rel) => basename(rel).replace(/\.md$/, "").toLowerCase()));
  const existPaths = new Set(allMd.map((rel) => stripMd(rel).toLowerCase()));
  const broken: [string, number, string][] = [];

  for (const rel of allMd) {
    if (shouldSkip(rel)) continue; // only non-skipped notes are linted as sources
    let text: string;
    try { text = readFileSync(resolve(vaultRoot, rel), "utf8"); }
    catch { continue; } // dangling symlink / EACCES / delete-race — skip, don't crash the gate
    // Parse frontmatter off so YAML fields (related:, description:) aren't scanned as body links,
    // and body line numbers stay file-accurate. splitLines mirrors the rest of the validator.
    const parsed = parseFrontmatter(splitLines(text));
    const body = parsed ? parsed.body : splitLines(text);
    const startLine = parsed ? parsed.closeLineNo + 1 : 1;

    let inFence = false;
    for (let i = 0; i < body.length; i++) {
      if (FENCE_RE.test(body[i])) { inFence = !inFence; continue; }
      if (inFence) continue;
      const lineNo = startLine + i;
      const line = body[i].replace(INLINE_CODE_RE, ""); // don't flag links inside `inline code`
      for (const m of line.matchAll(WIKI_LINK_RE)) {
        const target = m[1].trim();
        const ok = target.includes("/")
          ? existPaths.has(target.toLowerCase())
          : existStems.has(target.toLowerCase());
        if (!ok) broken.push([rel, lineNo, `broken wiki-link [[${target}]] — no matching note`]);
      }
      for (const m of line.matchAll(MD_LINK_RE)) {
        const target = m[1].split("#")[0].trim();
        if (!target.endsWith(".md") || /^(https?:|mailto:|\/\/)/.test(target)) continue;
        if (!existsSync(resolve(vaultRoot, rel, "..", target)))
          broken.push([rel, lineNo, `broken link (${target}) — file not found`]);
      }
    }
  }
  return { broken };
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
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const linksOnly = argv.includes("--links");
  const args = argv.filter((a) => a !== "--json" && a !== "--links");
  const vaultRoot = resolve(import.meta.dir, "..");
  const d = loadFromScript(import.meta.dir);
  const VALID_TYPES = d.VALID_TYPES;
  // OKF permissive mode (vault.config.json okf_compat: true): unknown types and broken
  // links are reported as warnings and never fail the run — mirrors OKF v0.1's
  // "tolerate unknown types / unresolvable links" parsing rule.
  const okfCompat = d.cfg.okf_compat === true;
  const explicit = args.length > 0;

  // --links: whole-vault broken-link check only, no per-file schema validation.
  // Link health is a whole-vault property, so this is the mode pre-commit uses —
  // it can't schema-flag skip-files (README etc.) the way explicit file args would.
  if (linksOnly) {
    const broken = checkLinks(vaultRoot).broken;
    const fatal = okfCompat ? 0 : broken.length;
    if (json) {
      const list = broken.map(([path, line, msg]) => ({ path, line, msg }));
      console.log(JSON.stringify(okfCompat
        ? { ok: true, errorCount: 0, errors: [], warningCount: list.length, warnings: list }
        : { ok: list.length === 0, errorCount: list.length, errors: list }, null, 2));
      process.exit(fatal === 0 ? 0 : 1);
    }
    for (const [path, line, msg] of broken) console.log(`${path}:${line}: ${okfCompat ? "warning: " : ""}${msg}`);
    if (fatal === 0)
      console.log(broken.length ? `✓ links ok (${broken.length} warning(s) — okf_compat)` : "✓ links ok");
    else console.log(`✗ ${broken.length} broken link(s)`);
    process.exit(fatal === 0 ? 0 : 1);
  }

  const targets = explicit
    ? args.map((a) => resolve(a)).sort()
    : [...new Bun.Glob("**/*.md").scanSync(vaultRoot)].map((p) => resolve(vaultRoot, p)).sort();

  const errors: { path: string; line: number; msg: string }[] = [];
  const warnings: { path: string; line: number; msg: string }[] = [];
  let count = 0;
  for (const path of targets) {
    if (!existsSync(path)) {
      errors.push({ path: relative(vaultRoot, path), line: 1, msg: "file not found" });
      continue;
    }
    const rel = relative(vaultRoot, path);
    // shouldSkip is a full-scan filter — an explicitly named file is always checked.
    if (!explicit && shouldSkip(rel)) continue;

    const [r, errs, warns = []] = isAgentLog(path)
      ? validateAgentLog(path, vaultRoot)
      : validateVaultNote(path, vaultRoot, VALID_TYPES, okfCompat);
    count++;
    for (const [ln, msg] of errs) errors.push({ path: r, line: ln, msg });
    for (const [ln, msg] of warns) warnings.push({ path: r, line: ln, msg });
  }

  // Link health is a whole-vault property — skipped in explicit (changed-files) mode
  // to keep errors scoped to the named files. Pre-commit covers links via `--links`;
  // CI's full scan is the backstop.
  if (!explicit)
    for (const [path, line, msg] of checkLinks(vaultRoot).broken)
      (okfCompat ? warnings : errors).push({ path, line, msg });

  if (json) {
    const out: Record<string, unknown> = { ok: errors.length === 0, count, errorCount: errors.length, errors };
    if (okfCompat) { out.warningCount = warnings.length; out.warnings = warnings; }
    console.log(JSON.stringify(out, null, 2));
    process.exit(errors.length === 0 ? 0 : 1);
  }

  for (const w of warnings) console.log(`${w.path}:${w.line}: warning: ${w.msg}`);
  for (const e of errors) console.log(`${e.path}:${e.line}: ${e.msg}`);
  if (errors.length === 0) {
    console.log(`✓ ${count} files validated, 0 errors${warnings.length ? ` (${warnings.length} warning(s) — okf_compat)` : ""}`);
    process.exit(0);
  }
  console.log(`✗ ${count} files validated, ${errors.length} errors found`);
  process.exit(1);
}

if (import.meta.main) runMain(main);
