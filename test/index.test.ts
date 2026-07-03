import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, loadNoteMeta, notesInDir, type NoteMeta } from "../src/index.ts";

function note(overrides: Partial<NoteMeta>): NoteMeta {
  return { file: "x.md", title: "X", description: "", tags: [], type: "", updated: "", ...overrides };
}

// ---- buildIndex: rendering ----
test("buildIndex renders title, description, tags, type", () => {
  const notes = [
    note({ file: "alpha.md", title: "Alpha", description: "the first letter", tags: ["greek", "letters"], type: "concept", updated: "2026-01-05" }),
  ];
  const out = buildIndex("concepts", notes, "default");
  expect(out).toContain("Alpha");
  expect(out).toContain("the first letter");
  expect(out).toContain("tags: greek, letters");
  expect(out).toContain("type: concept");
  expect(out).toContain("[[alpha|Alpha]]");
});

test("buildIndex: note without description omits the description segment cleanly", () => {
  const notes = [note({ file: "bare.md", title: "Bare", type: "concept", updated: "2026-01-01" })];
  const out = buildIndex("concepts", notes, "default");
  expect(out).toContain("[[bare|Bare]]");
  expect(out).not.toContain("—  (");
});

// ---- default style: group by type, reverse-chron within group ----
test("buildIndex default style groups by type and sorts reverse-chronological within group", () => {
  const notes = [
    note({ file: "old-proj.md", title: "Old Proj", type: "project", updated: "2026-01-01" }),
    note({ file: "new-proj.md", title: "New Proj", type: "project", updated: "2026-06-01" }),
    note({ file: "a-concept.md", title: "A Concept", type: "concept", updated: "2026-03-01" }),
  ];
  const out = buildIndex("mixed", notes, "default");

  // groups sorted alphabetically by type: concept before project
  const conceptIdx = out.indexOf("## concept");
  const projectIdx = out.indexOf("## project");
  expect(conceptIdx).toBeGreaterThan(-1);
  expect(projectIdx).toBeGreaterThan(conceptIdx);

  // within 'project' group, newest first
  const newIdx = out.indexOf("New Proj");
  const oldIdx = out.indexOf("Old Proj");
  expect(newIdx).toBeGreaterThan(-1);
  expect(oldIdx).toBeGreaterThan(newIdx);
});

// ---- alphabetical style: flat, sorted by title ----
test("buildIndex alphabetical style is flat and sorted by title, ignoring type", () => {
  const notes = [
    note({ file: "zed.md", title: "Zed Person", type: "contact", updated: "2026-01-01" }),
    note({ file: "amy.md", title: "Amy Person", type: "lead", updated: "2020-01-01" }),
  ];
  const out = buildIndex("crm", notes, "alphabetical");
  expect(out).not.toContain("## contact");
  expect(out).not.toContain("## lead");
  const amyIdx = out.indexOf("Amy Person");
  const zedIdx = out.indexOf("Zed Person");
  expect(amyIdx).toBeGreaterThan(-1);
  expect(zedIdx).toBeGreaterThan(amyIdx);
});

// ---- idempotency ----
test("buildIndex is idempotent: identical input produces byte-identical output", () => {
  const notes = [
    note({ file: "one.md", title: "One", type: "project", updated: "2026-02-02", tags: ["x"], description: "d" }),
    note({ file: "two.md", title: "Two", type: "concept", updated: "2026-02-03" }),
  ];
  const a = buildIndex("dir", notes, "default");
  const b = buildIndex("dir", notes, "default");
  expect(a).toBe(b);

  const c = buildIndex("dir", notes, "alphabetical");
  const e = buildIndex("dir", notes, "alphabetical");
  expect(c).toBe(e);
});

test("buildIndex on empty notes list never throws and marks dir as empty", () => {
  expect(() => buildIndex("empty-dir", [], "default")).not.toThrow();
  expect(buildIndex("empty-dir", [], "default")).toContain("no notes yet");
});

// ---- frontmatter-less tolerance (via loadNoteMeta / notesInDir on real files) ----
test("loadNoteMeta tolerates a note with no frontmatter: filename as title, blank fields, never throws", () => {
  const dir = mkdtempSync(join(tmpdir(), "idx-"));
  const path = join(dir, "raw-clipping.md");
  writeFileSync(path, "just some raw text pasted in, no frontmatter, no heading\n");
  const meta = loadNoteMeta(path);
  expect(meta.title).toBe("raw-clipping");
  expect(meta.description).toBe("");
  expect(meta.tags).toEqual([]);
  expect(meta.type).toBe("");
  expect(meta.updated).toBe("");
});

test("loadNoteMeta picks up H1 even without frontmatter", () => {
  const dir = mkdtempSync(join(tmpdir(), "idx-"));
  const path = join(dir, "clipping2.md");
  writeFileSync(path, "some preamble\n# Real Title\nmore text\n");
  const meta = loadNoteMeta(path);
  expect(meta.title).toBe("Real Title");
});

test("notesInDir scans a real directory, skips index.md, and feeds buildIndex end-to-end", () => {
  const dir = mkdtempSync(join(tmpdir(), "idx-"));
  writeFileSync(join(dir, "index.md"), "# should be skipped as a note\n");
  writeFileSync(join(dir, "with-fm.md"),
    `---\nupdated: 2026-05-01\ntags: [concept]\ntype: concept\ndescription: has frontmatter\n---\n\n# With FM\n\n## Summary\nx\n`);
  writeFileSync(join(dir, "no-fm.md"), "# No FM Note\nplain body\n");

  const notes = notesInDir(dir);
  expect(notes.length).toBe(2);
  expect(notes.some((n) => n.file === "index.md")).toBe(false);

  const out = buildIndex("scanned", notes, "default");
  expect(out).toContain("With FM");
  expect(out).toContain("has frontmatter");
  expect(out).toContain("No FM Note");
});
