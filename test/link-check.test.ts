import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkLinks } from "../src/validate-vault.ts";

function vault() {
  const dir = mkdtempSync(join(tmpdir(), "vt-link-"));
  mkdirSync(join(dir, "projects"), { recursive: true });
  return dir;
}
const msgs = (dir: string) => checkLinks(dir).broken.map((b) => b[2]).join(" ");

test("checkLinks: flags broken wiki-link, accepts resolving one", () => {
  const dir = vault();
  writeFileSync(join(dir, "projects", "hub.md"), "# Hub\n\nlinks [[leaf]] and [[missing]]\n");
  writeFileSync(join(dir, "projects", "leaf.md"), "# Leaf\n\nno links\n");
  const m = msgs(dir);
  expect(m).toContain("[[missing]]");
  expect(m).not.toContain("[[leaf]]");
});

test("checkLinks: broken markdown .md link flagged, http/anchor ignored", () => {
  const dir = vault();
  writeFileSync(join(dir, "projects", "a.md"),
    "# A\n\n[gone](./nope.md) [ok](./b.md) [site](https://x.md)\n");
  writeFileSync(join(dir, "projects", "b.md"), "# B\n");
  const m = msgs(dir);
  expect(m).toContain("nope.md");
  expect(m).not.toContain("b.md");
  expect(m).not.toContain("x.md");
});

test("checkLinks: links inside fenced (incl. indented) and inline code ignored", () => {
  const dir = vault();
  writeFileSync(join(dir, "projects", "a.md"),
    "# A\n\nWrite `[[inline-ghost]]` or `[x](./inline.md)` to link.\n\n" +
    "1. Example:\n   ```\n   [[fenced-ghost]]\n   ```\n");
  expect(checkLinks(dir).broken).toEqual([]);
});

test("checkLinks: frontmatter fields are not scanned as body links", () => {
  const dir = vault();
  writeFileSync(join(dir, "projects", "a.md"),
    "---\ntype: project\nrelated: [[fm-ghost]]\n---\n\n# A\n\n[[a]]\n");
  expect(checkLinks(dir).broken).toEqual([]);
});

test("checkLinks: path-qualified link must resolve at that path, not just basename", () => {
  const dir = vault();
  mkdirSync(join(dir, "areas"), { recursive: true });
  writeFileSync(join(dir, "areas", "foo.md"), "# Foo A\n");            // basename exists elsewhere
  writeFileSync(join(dir, "projects", "b.md"), "# B\n\n[[projects/foo]]\n"); // but not at this path
  expect(msgs(dir)).toContain("[[projects/foo]]");
  // bare [[foo]] still resolves via basename
  writeFileSync(join(dir, "projects", "c.md"), "# C\n\n[[foo]]\n");
  expect(checkLinks(dir).broken.some((b) => b[0] === "projects/c.md")).toBe(false);
});

test("checkLinks: resolution is case-insensitive", () => {
  const dir = vault();
  writeFileSync(join(dir, "projects", "foo.md"), "# Foo\n");
  writeFileSync(join(dir, "projects", "a.md"), "# A\n\n[[Foo]]\n");
  expect(checkLinks(dir).broken).toEqual([]);
});

test("checkLinks: skip-subtrees are not linted as sources", () => {
  const dir = vault();
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "tool.md"), "# Tool\n\n[[ghost]]\n"); // skip subtree: ignored
  expect(checkLinks(dir).broken).toEqual([]);
});

test("checkLinks: reports correct file line number past frontmatter", () => {
  const dir = vault();
  writeFileSync(join(dir, "projects", "a.md"),
    "---\ntype: project\n---\n\n# A\n\nline seven [[missing]]\n");
  const [b] = checkLinks(dir).broken;
  expect(b[0]).toBe("projects/a.md");
  expect(b[1]).toBe(7);
});
