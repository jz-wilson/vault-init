import { test, expect } from "bun:test";
import { ymd, ym } from "../src/capture.ts";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { derive } from "../src/config.ts";
import { splitLines, parseFrontmatter, extractField } from "../src/frontmatter.ts";
import { listUnprocessed, listPendingProposals, markProcessed } from "../src/nightly.ts";
import { logTurn } from "../src/log-turn.ts";


function initGitVault(): string {
  const dir = mkdtempSync(join(tmpdir(), "nt-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  Bun.spawnSync(["git", "config", "user.email", "test@example.com"], { cwd: dir });
  Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: dir });
  mkdirSync(join(dir, "wiki", "raw"), { recursive: true });
  mkdirSync(join(dir, "wiki", "processed"), { recursive: true });
  return dir;
}

// ---- listUnprocessed ----
test("listUnprocessed: returns only un-mirrored raw clippings, excludes .gitkeep/index.md", () => {
  const dir = initGitVault();
  writeFileSync(join(dir, "wiki", "raw", ".gitkeep"), "");
  writeFileSync(join(dir, "wiki", "raw", "index.md"), "");
  writeFileSync(join(dir, "wiki", "raw", "a.md"), "clip A");
  writeFileSync(join(dir, "wiki", "raw", "b.md"), "clip B");
  writeFileSync(join(dir, "wiki", "processed", "b.md"), "processed B");

  expect(listUnprocessed(dir)).toEqual(["a.md"]);
});

test("listUnprocessed: missing wiki/raw yields empty list", () => {
  const dir = mkdtempSync(join(tmpdir(), "nt-"));
  expect(listUnprocessed(dir)).toEqual([]);
});

// ---- listPendingProposals ----
test("listPendingProposals: missing dir yields empty; .md files sorted, non-md ignored", () => {
  const dir = mkdtempSync(join(tmpdir(), "nt-"));
  expect(listPendingProposals(dir)).toEqual([]);

  const pdir = join(dir, "agents", "self-review", "proposals");
  mkdirSync(pdir, { recursive: true });
  writeFileSync(join(pdir, ".gitkeep"), "");
  writeFileSync(join(pdir, "2026-07-06.md"), "proposal");
  writeFileSync(join(pdir, "2026-07-01.md"), "older proposal");
  expect(listPendingProposals(dir)).toEqual(["2026-07-01.md", "2026-07-06.md"]);
});

// ---- markProcessed: dry-run ----
test("markProcessed: dry-run changes nothing on disk", () => {
  const dir = initGitVault();
  writeFileSync(join(dir, "wiki", "raw", "clip.md"), "clip content");
  Bun.spawnSync(["git", "add", "-A"], { cwd: dir });
  Bun.spawnSync(["git", "commit", "-q", "-m", "seed"], { cwd: dir });

  markProcessed(dir, "clip.md", "folded into concept note", false, new Date());

  expect(existsSync(join(dir, "wiki", "raw", "clip.md"))).toBe(true);
  expect(existsSync(join(dir, "wiki", "processed", "clip.md"))).toBe(false);
  expect(existsSync(join(dir, "log.md"))).toBe(false);
});

// ---- markProcessed: apply ----
test("markProcessed: apply performs mv + log.md append + commit, and does not push", () => {
  const dir = initGitVault();
  writeFileSync(join(dir, "wiki", "raw", "clip.md"), "clip content");
  Bun.spawnSync(["git", "add", "-A"], { cwd: dir });
  Bun.spawnSync(["git", "commit", "-q", "-m", "seed"], { cwd: dir });

  const today = new Date();
  expect(() => markProcessed(dir, "clip.md", "folded into concept note", true, today)).not.toThrow();

  expect(existsSync(join(dir, "wiki", "raw", "clip.md"))).toBe(false);
  expect(existsSync(join(dir, "wiki", "processed", "clip.md"))).toBe(true);
  expect(readFileSync(join(dir, "wiki", "processed", "clip.md"), "utf8")).toBe("clip content");

  const log = readFileSync(join(dir, "log.md"), "utf8");
  expect(log).toContain(`## ${ymd(today)}`);
  expect(log).toContain(`- **Update:** folded into concept note ([clip.md](wiki/processed/clip.md))`);

  // fully committed — nothing left dangling (proves markProcessed didn't leave a push pending either)
  const status = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: dir });
  expect(status.stdout.toString().trim()).toBe("");

  const gitLog = Bun.spawnSync(["git", "log", "--oneline"], { cwd: dir });
  expect(gitLog.stdout.toString()).toContain("nightly: process clip.md");

  // no remote configured — if markProcessed had attempted a push it would have thrown above
  const remotes = Bun.spawnSync(["git", "remote"], { cwd: dir });
  expect(remotes.stdout.toString().trim()).toBe("");
});

test("markProcessed: log.md groups entries under date headings, newest first", () => {
  const dir = initGitVault();
  for (const f of ["one.md", "two.md", "three.md"]) writeFileSync(join(dir, "wiki", "raw", f), f);
  Bun.spawnSync(["git", "add", "-A"], { cwd: dir });
  Bun.spawnSync(["git", "commit", "-q", "-m", "seed"], { cwd: dir });

  const day1 = new Date("2026-07-05T12:00:00");
  const day2 = new Date("2026-07-06T12:00:00");
  markProcessed(dir, "one.md", "first", true, day1);
  markProcessed(dir, "two.md", "second", true, day1);
  markProcessed(dir, "three.md", "third", true, day2);

  const log = readFileSync(join(dir, "log.md"), "utf8");
  // newest day heading first
  expect(log.indexOf("## 2026-07-06")).toBeLessThan(log.indexOf("## 2026-07-05"));
  // newest entry first within a day
  expect(log.indexOf("second")).toBeLessThan(log.indexOf("first"));
  // exactly one heading per day
  expect(log.match(/^## 2026-07-05$/gm)!.length).toBe(1);
  expect(log).toContain("- **Update:** third ([three.md](wiki/processed/three.md))");
});

test("markProcessed: apply errors (does not throw silently) when raw file is missing", () => {
  const dir = initGitVault();
  expect(() => markProcessed(dir, "ghost.md", "x", true, new Date())).toThrow(/not found/);
});

// ---- traversal guard ----
test("markProcessed: rejects traversal / non-plain filenames", () => {
  const dir = initGitVault();
  for (const bad of ["../escape.md", "sub/dir.md", ".", "..", ""]) {
    expect(() => markProcessed(dir, bad, "x", false, new Date())).toThrow();
  }
});

// ---- log-turn ----
test("log-turn: round-trips a fact into this month's journal file", () => {
  const dir = mkdtempSync(join(tmpdir(), "nt-"));
  const D = derive({ name: "t", semantic_dirs: {}, episodic_dirs: { journal: "journal" }, extra_dirs: [] });
  const today = new Date();

  const path = logTurn(D, dir, "a per-turn fact", today);
  expect(path).toBe(join(dir, "journal", `${ym(today)}.md`));

  const text = readFileSync(path, "utf8");
  expect(text).toContain(`- ${ymd(today)}: a per-turn fact`);
  const fm = parseFrontmatter(splitLines(text))!.fm;
  expect(extractField(fm, "updated")).toBe(ymd(today));
});

test("log-turn: errors clearly when journal type isn't configured", () => {
  const dir = mkdtempSync(join(tmpdir(), "nt-"));
  const D = derive({ name: "t", semantic_dirs: { project: "projects" }, episodic_dirs: {}, extra_dirs: [] });
  expect(() => logTurn(D, dir, "x", new Date())).toThrow(/journal/);
});

test("log-turn: rejects empty or multi-line facts", () => {
  const dir = mkdtempSync(join(tmpdir(), "nt-"));
  const D = derive({ name: "t", semantic_dirs: {}, episodic_dirs: { journal: "journal" }, extra_dirs: [] });
  expect(() => logTurn(D, dir, "", new Date())).toThrow();
  expect(() => logTurn(D, dir, "line one\nline two", new Date())).toThrow();
});
