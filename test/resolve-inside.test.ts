import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { resolveInside } from "../src/config.ts";

// resolveInside() is the canonical traversal guard for anything user-supplied that
// becomes a path (config dirs, snapshot.files, CLI dir args). Pure over path.resolve —
// no filesystem needed.

const base = resolve("/tmp/vault-x");

test("resolveInside: allows a plain in-vault dir", () => {
  expect(resolveInside(base, "projects")).toBe(resolve(base, "projects"));
});

test("resolveInside: allows a nested in-vault path", () => {
  expect(resolveInside(base, "a/b/c")).toBe(resolve(base, "a/b/c"));
});

test("resolveInside: allows the base itself (rel '.')", () => {
  expect(resolveInside(base, ".")).toBe(base);
});

test("resolveInside: rejects ../ traversal", () => {
  expect(() => resolveInside(base, "../escape")).toThrow(/escapes the vault root/);
});

test("resolveInside: rejects nested path that climbs back out", () => {
  expect(() => resolveInside(base, "a/../../escape")).toThrow(/escapes the vault root/);
});

test("resolveInside: rejects an absolute path outside base", () => {
  expect(() => resolveInside(base, "/etc/passwd")).toThrow(/escapes the vault root/);
});

test("resolveInside: rejects a sibling that only prefix-matches the base", () => {
  // /tmp/vault-x-evil startsWith('/tmp/vault-x') but NOT '/tmp/vault-x/' — the
  // `base + sep` check is what blocks this, not a bare startsWith(base).
  expect(() => resolveInside(base, "../vault-x-evil")).toThrow(/escapes the vault root/);
});

test("resolveInside: error carries the caller's label", () => {
  expect(() => resolveInside(base, "../x", "semantic_dirs.decision"))
    .toThrow(/semantic_dirs\.decision/);
});
