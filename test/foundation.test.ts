import { test, expect } from "bun:test";
import { ymd } from "../src/capture.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { derive, loadConfig } from "../src/config.ts";
import { validateVaultNote, shouldSkip } from "../src/validate-vault.ts";

const D = derive({
  name: "t",
  semantic_dirs: { project: "projects", person: "crm" },
  episodic_dirs: { decision: "decisions" },
  extra_dirs: ["wiki/raw", "wiki/processed"],
});


function noteBody(type: string, extraFm: string) {
  const today = ymd(new Date());
  return `---\nupdated: ${today}\ntags: [${type}]\ntype: ${type}\n${extraFm}---\n\n# T\n\n## Summary\nx\n\n## Notes\n- y\n\n## Related\n_(none yet)_\n`;
}

// ---- person type ----
test("validateVaultNote: person note with met/last_contact accepted", () => {
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  const today = ymd(new Date());
  const p = join(dir, "ok.md");
  writeFileSync(p, noteBody("person", `met: ${today}\nlast_contact: ${today}\n`));
  expect(validateVaultNote(p, dir, D.VALID_TYPES)[1]).toEqual([]);
});

test("validateVaultNote: person note missing met/last_contact rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  const p = join(dir, "bad.md");
  writeFileSync(p, noteBody("person", ""));
  const msgs = validateVaultNote(p, dir, D.VALID_TYPES)[1].map((e) => e[1]);
  expect(msgs).toContain("missing required frontmatter field: 'met'");
  expect(msgs).toContain("missing required frontmatter field: 'last_contact'");
});

test("validateVaultNote: person note with invalid calendar date rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  const p = join(dir, "bad2.md");
  writeFileSync(p, noteBody("person", "met: 2026-02-30\nlast_contact: 2026-01-01\n"));
  const msgs = validateVaultNote(p, dir, D.VALID_TYPES)[1].map((e) => e[1]).join(" ");
  expect(msgs).toContain("'met' is not a real calendar date");
});

// ---- skill type ----
test("validateVaultNote: skill type (universal) accepted", () => {
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  const p = join(dir, "skill.md");
  writeFileSync(p, noteBody("skill", ""));
  expect(validateVaultNote(p, dir, D.VALID_TYPES)[1]).toEqual([]);
});

// ---- shouldSkip: wiki/raw + index.md ----
test("shouldSkip: wiki clipping subtrees skipped in full-scan mode", () => {
  expect(shouldSkip("wiki/raw/clipping.md")).toBe(true);
  expect(shouldSkip("wiki/raw/nested/dir/clipping.md")).toBe(true);
  // processed clippings stay unformatted after nightly.ts's move — also exempt
  expect(shouldSkip("wiki/processed/clipping.md")).toBe(true);
  expect(shouldSkip("wiki/other.md")).toBe(false);
});

test("shouldSkip: index.md basename skipped anywhere", () => {
  expect(shouldSkip("index.md")).toBe(true);
  expect(shouldSkip("projects/index.md")).toBe(true);
  expect(shouldSkip("projects/real-note.md")).toBe(false);
});

test("wiki/raw file with no frontmatter still gets checked when passed explicitly", () => {
  // shouldSkip only governs the full-scan filter; the explicit-args bypass in validate-vault.ts's
  // main() never consults it, so a raw clipping named directly is still run through the validator
  // and correctly flagged as malformed.
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  mkdirSync(join(dir, "wiki", "raw"), { recursive: true });
  const p = join(dir, "wiki", "raw", "clipping.md");
  writeFileSync(p, "just some raw text, no frontmatter\n");
  expect(shouldSkip("wiki/raw/clipping.md")).toBe(true);
  const [, errs] = validateVaultNote(p, dir, D.VALID_TYPES);
  expect(errs.length).toBeGreaterThan(0);
});

// ---- config: index_style + snapshot ----
test("loadConfig round-trips index_style + snapshot fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  writeFileSync(join(dir, "vault.config.json"), JSON.stringify({
    name: "t",
    semantic_dirs: { project: "projects" },
    episodic_dirs: {},
    extra_dirs: [],
    index_style: { crm: "alphabetical" },
    snapshot: { files: ["IDENTITY.md", "ALWAYS.md", "NEVER.md", "AGENTS.md"], budget_tokens: 1300 },
  }));
  const cfg = loadConfig(dir);
  expect(cfg.index_style).toEqual({ crm: "alphabetical" });
  expect(cfg.snapshot).toEqual({ files: ["IDENTITY.md", "ALWAYS.md", "NEVER.md", "AGENTS.md"], budget_tokens: 1300 });
});

test("loadConfig rejects a snapshot file escaping the vault root", () => {
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  writeFileSync(join(dir, "vault.config.json"), JSON.stringify({
    name: "t",
    semantic_dirs: {},
    episodic_dirs: {},
    extra_dirs: [],
    snapshot: { files: ["../../etc/passwd"], budget_tokens: 1300 },
  }));
  expect(() => loadConfig(dir)).toThrow(/escapes the vault root/);
});

test("loadConfig: index_style/snapshot are absent when not configured", () => {
  const dir = mkdtempSync(join(tmpdir(), "vt-"));
  writeFileSync(join(dir, "vault.config.json"), JSON.stringify({
    name: "t", semantic_dirs: {}, episodic_dirs: {}, extra_dirs: [],
  }));
  const cfg = loadConfig(dir);
  expect(cfg.index_style).toBeUndefined();
  expect(cfg.snapshot).toBeUndefined();
});
