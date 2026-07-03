import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NONCONTENT_SUBTREES } from "../src/config.ts";
import { loadNotesFromVault } from "../src/search.ts";
import { shouldSkip } from "../src/validate-vault.ts";

// ---- NONCONTENT_SUBTREES: shared base set ----

test("NONCONTENT_SUBTREES contains node_modules, .claude, .omc", () => {
  expect(NONCONTENT_SUBTREES.has("node_modules")).toBe(true);
  expect(NONCONTENT_SUBTREES.has(".claude")).toBe(true);
  expect(NONCONTENT_SUBTREES.has(".omc")).toBe(true);
});

// ---- search's loader: node_modules/.claude/agents excluded, real notes kept ----

test("loadNotesFromVault excludes node_modules, .claude, agents — keeps real notes", () => {
  const dir = mkdtempSync(join(tmpdir(), "skip-"));
  writeFileSync(join(dir, "vault.config.json"), JSON.stringify({ name: "t", semantic_dirs: {}, episodic_dirs: {}, extra_dirs: [] }));

  mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "foo.md"), "# SDK doc\n");

  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "bar.md"), "# tool config\n");

  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(join(dir, "agents", "log.md"), "# agent log\n");

  mkdirSync(join(dir, "projects"), { recursive: true });
  writeFileSync(join(dir, "projects", "real.md"), "# Real note\n");

  const notes = loadNotesFromVault(dir);
  const paths = notes.map((n) => n.path).sort();
  expect(paths).toEqual(["projects/real.md"]);
});

// ---- validate's shouldSkip: same set, path-string form ----

test("shouldSkip: node_modules, .claude, agents, handoffs skipped; real note not", () => {
  expect(shouldSkip("node_modules/x.md")).toBe(true);
  expect(shouldSkip(".claude/y.md")).toBe(true);
  expect(shouldSkip("agents/z.md")).toBe(true);
  expect(shouldSkip("handoffs/w.md")).toBe(true);
  expect(shouldSkip("projects/real.md")).toBe(false);
});

// ---- issue #9: skip names NESTED below the vault root (a repo cloned into a content dir) ----

test("shouldSkip: nested node_modules/.git skipped; sibling real note not", () => {
  expect(shouldSkip("projects/x/node_modules/y.md")).toBe(true);
  expect(shouldSkip("projects/x/.git/COMMIT.md")).toBe(true);
  expect(shouldSkip("projects/x/notes.md")).toBe(false);
});

test("loadNotesFromVault excludes nested node_modules — keeps sibling note", () => {
  const dir = mkdtempSync(join(tmpdir(), "skip-nested-"));
  writeFileSync(join(dir, "vault.config.json"), JSON.stringify({ name: "t", semantic_dirs: {}, episodic_dirs: {}, extra_dirs: [] }));

  mkdirSync(join(dir, "projects", "x", "node_modules"), { recursive: true });
  writeFileSync(join(dir, "projects", "x", "node_modules", "dep.md"), "# vendored\n");
  writeFileSync(join(dir, "projects", "x", "notes.md"), "# Real note\n");

  const paths = loadNotesFromVault(dir).map((n) => n.path).sort();
  expect(paths).toEqual(["projects/x/notes.md"]);
});
