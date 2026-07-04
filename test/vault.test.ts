import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseFrontmatter, extractField, extractTagsList, checkBodyPaths, splitLines,
} from "../src/frontmatter.ts";
import { derive } from "../src/config.ts";
import { validateAgentLog } from "../src/validate-logs.ts";
import { validateVaultNote } from "../src/validate-vault.ts";
import { resolvePath, createNote, insertBullet } from "../src/capture.ts";
import { findArchivalCandidates, findDistillationCandidates } from "../src/consolidate.ts";

const D = derive({
  name: "t",
  semantic_dirs: { project: "projects" },
  episodic_dirs: { decision: "decisions" },
  extra_dirs: [],
});

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---- frontmatter ----
test("parseFrontmatter splits fm/body", () => {
  const p = parseFrontmatter(["---", "type: project", "---", "", "# T"]);
  expect(p).not.toBeNull();
  expect(extractField(p!.fm, "type")).toBe("project");
  expect(p!.closeLineNo).toBe(3);
});

test("extractField strips quotes; missing -> null", () => {
  expect(extractField(['agent: "claude-code"'], "agent")).toBe("claude-code");
  expect(extractField(["type: x"], "nope")).toBeNull();
});

test("extractTagsList handles inline and block", () => {
  expect(extractTagsList(["tags: [a, b]"])).toEqual(["a", "b"]);
  expect(extractTagsList(["tags:", "- a", "- b", "type: x"])).toEqual(["a", "b"]);
});

test("extractTagsList parses malformed brackets leniently, not as one garbage tag", () => {
  expect(extractTagsList(["tags: [a, b"])).toEqual(["a", "b"]);   // missing close
  expect(extractTagsList(["tags: a, b]"])).toEqual(["a", "b"]);   // missing open
  expect(extractTagsList(["tags: agent-log"])).toEqual(["agent-log"]); // bare tag: still one tag
});

test("splitLines mirrors python splitlines for trailing newline", () => {
  expect(splitLines("a\n")).toEqual(["a"]);
  expect(splitLines("a\n\n")).toEqual(["a", ""]);
});

test("checkBodyPaths flags /mnt and file:// but not inside code fence", () => {
  const errs = checkBodyPaths(["see /mnt/foo", "```", "/mnt/ok", "```", "x file://y"], 1);
  const lines = errs.map((e) => e[0]);
  expect(lines).toContain(1);
  expect(lines).toContain(5);
  expect(lines).not.toContain(3);
});

// ---- validate-logs ----
function goodLog(today: string) {
  return `---\nupdated: ${today}\ntags: [agent-log]\ntype: agent-log\nagent: "a"\nstatus: completed\ntask: "t"\npriority: low\ndate: ${today}\nverified: false\ncompletion_signal: true\n---\n\n# T\n\n## Summary\nx\n\n## Notes\n- y\n\n## Related\n_(none yet)_\n`;
}

test("validateAgentLog: good log clean, missing field caught", () => {
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  const today = ymd(new Date());
  const good = join(dir, `${today}-ok.md`);
  writeFileSync(good, goodLog(today));
  expect(validateAgentLog(good, dir)[1]).toEqual([]);

  const bad = join(dir, `${today}-bad.md`);
  writeFileSync(bad, goodLog(today).replace(/priority: low\n/, ""));
  const msgs = validateAgentLog(bad, dir)[1].map((e) => e[1]).join(" ");
  expect(msgs).toContain("priority");
});

test("validateAgentLog: error status requires error_class + Error Log", () => {
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  const today = ymd(new Date());
  const f = join(dir, `${today}-err.md`);
  writeFileSync(f, goodLog(today).replace("status: completed", "status: error"));
  const msgs = validateAgentLog(f, dir)[1].map((e) => e[1]).join(" ");
  expect(msgs).toContain("error_class");
  expect(msgs).toContain("## Error Log");
});

// ---- validate-vault ----
test("validateVaultNote: bad type rejected, good accepted", () => {
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  const today = ymd(new Date());
  const ok = join(dir, "ok.md");
  writeFileSync(ok, `---\nupdated: ${today}\ntags: [project]\ntype: project\n---\n\n# Ok\n\n## Summary\nx\n\n## Notes\n- y\n\n## Related\n_(none yet)_\n`);
  expect(validateVaultNote(ok, dir, D.VALID_TYPES)[1]).toEqual([]);

  const bad = join(dir, "bad.md");
  writeFileSync(bad, readFileSync(ok, "utf8").replace("type: project", "type: nonsense"));
  const msgs = validateVaultNote(bad, dir, D.VALID_TYPES)[1].map((e) => e[1]).join(" ");
  expect(msgs).toContain("'type' must be one of");
});

// ---- capture ----
test("capture: create + insertBullet round-trips and bumps updated", () => {
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  mkdirSync(join(dir, "projects"));
  const today = new Date();
  const path = resolvePath(D, dir, "project", "demo", today);
  createNote(D, path, "project", "demo", today);
  insertBullet(path, "a captured fact", today, dir, D.VALID_TYPES);

  const text = readFileSync(path, "utf8");
  expect(text).toContain(`- ${ymd(today)}: a captured fact`);
  const fm = parseFrontmatter(splitLines(text))!.fm;
  expect(extractField(fm, "updated")).toBe(ymd(today));
});

test("capture: insertBullet inserts updated: when absent, without clobbering the first fm field", () => {
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  mkdirSync(join(dir, "projects"));
  const path = join(dir, "projects", "no-updated.md");
  // valid frontmatter EXCEPT no `updated:` — tags sits on the first fm line, the one
  // the old fmLineNo fallback would clobber.
  const orig = `---\ntags: [project]\ntype: project\n---\n\n# T\n\n## Summary\ns\n\n## Notes\n\n## Related\n_(none yet)_\n`;
  writeFileSync(path, orig);
  const today = new Date();
  insertBullet(path, "fact", today, dir, D.VALID_TYPES);

  const fm = parseFrontmatter(splitLines(readFileSync(path, "utf8")))!.fm;
  expect(extractField(fm, "updated")).toBe(ymd(today)); // inserted, not faked onto another line
  expect(extractField(fm, "tags")).toBe("[project]");   // first fm line preserved, not clobbered
});

test("capture: episodic type routes to monthly file", () => {
  const today = new Date();
  const p = resolvePath(D, "/v", "decision", "", today);
  expect(p).toMatch(/decisions\/\d{4}-\d{2}\.md$/);
});

test("capture: insertBullet restores original if result is invalid", () => {
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  mkdirSync(join(dir, "projects"));
  const path = join(dir, "projects", "broken.md");
  // note missing ## Related — validator will reject after edit; original must be restored
  const orig = `---\nupdated: 2026-01-01\ntags: [project]\ntype: project\n---\n\n# B\n\n## Notes\n`;
  writeFileSync(path, orig);
  expect(() => insertBullet(path, "x", new Date(), dir, D.VALID_TYPES)).toThrow();
  expect(readFileSync(path, "utf8")).toBe(orig);
});

// ---- consolidate ----
function buildVaultForConsolidate() {
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  mkdirSync(join(dir, "agents", "ta", "reports"), { recursive: true });
  mkdirSync(join(dir, "projects"), { recursive: true });
  writeFileSync(join(dir, "vault.config.json"), JSON.stringify({ name: "t", semantic_dirs: { project: "projects" }, episodic_dirs: {}, extra_dirs: [] }));
  // stale semantic note (updated long before logs)
  writeFileSync(join(dir, "projects", "my-project.md"),
    `---\nupdated: 2026-01-01\ntags: [project]\ntype: project\n---\n\n# My Project\n\n## Summary\nx\n\n## Notes\n- 2026-01-01: init\n\n## Related\n_(none yet)_\n`);
  return dir;
}

function logFile(today: string, name: string, status: string) {
  return `---\nupdated: ${today}\ntags: [agent-log]\ntype: agent-log\nagent: "ta"\nstatus: ${status}\ntask: "t"\npriority: low\ndate: ${today}\nverified: true\ncompletion_signal: true\n---\n\n# ${name}\n\n## Summary\nx\n\n## Notes\n- y\n\n## Related\n- [[my-project]] — relates\n`;
}

test("consolidate: archival is age-only, NOT gated on verified (Q8)", () => {
  const dir = buildVaultForConsolidate();
  const today = new Date();
  const old = ymd(new Date(today.getTime() - 100 * 86400_000));
  const recent = ymd(new Date(today.getTime() - 10 * 86400_000));
  writeFileSync(join(dir, "agents", "ta", "reports", `${old}-old.md`), logFile(old, "Old", "completed"));
  writeFileSync(join(dir, "agents", "ta", "reports", `${recent}-new.md`), logFile(recent, "New", "completed"));
  // unverified-but-old: must STILL be a candidate under the decoupled rule
  const unv = logFile(old, "Unv", "completed").replace("verified: true", "verified: false");
  writeFileSync(join(dir, "agents", "ta", "reports", `${old}-unv.md`), unv);

  const cands = findArchivalCandidates(D, dir, today).map(([p]) => p);
  expect(cands.length).toBe(2); // old + old-unverified, NOT recent
  expect(cands.some((p) => p.endsWith("-old.md"))).toBe(true);
  expect(cands.some((p) => p.endsWith("-unv.md"))).toBe(true);
  expect(cands.some((p) => p.endsWith("-new.md"))).toBe(false);
});

test("consolidate: distillation flags log linking a stale semantic note", () => {
  const dir = buildVaultForConsolidate();
  const today = new Date();
  const recent = ymd(new Date(today.getTime() - 10 * 86400_000));
  writeFileSync(join(dir, "agents", "ta", "reports", `${recent}-x.md`), logFile(recent, "X", "completed"));
  const pairs = findDistillationCandidates(D, dir);
  expect(pairs.length).toBeGreaterThanOrEqual(1);
  expect(pairs[0][1]).toContain("my-project.md");
});

test("consolidate: extracts links under a '## Related Notes' heading, not just exact '## Related'", () => {
  // validateVaultNote accepts '## Related Notes' (substring check), so extraction
  // must too — else the linked note is silently dropped from distillation.
  const dir = buildVaultForConsolidate();
  const today = new Date();
  const recent = ymd(new Date(today.getTime() - 10 * 86400_000));
  const log = logFile(recent, "X", "completed").replace("## Related", "## Related Notes");
  writeFileSync(join(dir, "agents", "ta", "reports", `${recent}-x.md`), log);
  const pairs = findDistillationCandidates(D, dir);
  expect(pairs.length).toBeGreaterThanOrEqual(1);
  expect(pairs[0][1]).toContain("my-project.md");
});
