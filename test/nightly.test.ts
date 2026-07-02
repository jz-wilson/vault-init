import { test, expect } from "bun:test";
import { ymd, ym } from "../src/capture.ts";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { derive } from "../src/config.ts";
import { splitLines, parseFrontmatter, extractField } from "../src/frontmatter.ts";
import { listUnprocessed, markProcessed } from "../src/nightly.ts";
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
  expect(log).toContain(`- ${ymd(today)}: folded into concept note ([[wiki/processed/clip.md]])`);

  // fully committed — nothing left dangling (proves markProcessed didn't leave a push pending either)
  const status = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: dir });
  expect(status.stdout.toString().trim()).toBe("");

  const gitLog = Bun.spawnSync(["git", "log", "--oneline"], { cwd: dir });
  expect(gitLog.stdout.toString()).toContain("nightly: process clip.md");

  // no remote configured — if markProcessed had attempted a push it would have thrown above
  const remotes = Bun.spawnSync(["git", "remote"], { cwd: dir });
  expect(remotes.stdout.toString().trim()).toBe("");
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
