import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { search, bm25, tokenize, type NoteInput, type Doc, type CorpusStats } from "../src/search.ts";

function note(dir: string, name: string, updated: string, body: string): NoteInput {
  const path = join(dir, name);
  const text = `---\nupdated: ${updated}\ntags: [note]\ntype: reference\n---\n\n# ${name}\n\n## Summary\n_(none yet)_\n\n## Notes\n${body}\n\n## Related\n_(none yet)_\n`;
  writeFileSync(path, text);
  return { path: name, text: readFileSync(path, "utf8") };
}

// ---- (a) known-relevant ranks above known-irrelevant ----
test("search: relevant note outranks irrelevant note", () => {
  const dir = mkdtempSync(join(tmpdir(), "search-"));
  const relevant = note(dir, "kubernetes.md", "2026-01-01", "- kubernetes cluster upgrade notes for the homelab kubernetes nodes");
  const irrelevant = note(dir, "recipe.md", "2026-01-01", "- sourdough bread recipe with a long rise time");
  const notes = [irrelevant, relevant];

  const results = search(notes, "kubernetes cluster");
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].path).toBe("kubernetes.md");
  // irrelevant doc shares no query terms -> shouldn't appear at all
  expect(results.some((r) => r.path === "recipe.md")).toBe(false);
});

// ---- (b) path:line resolves to a line actually containing a matched term ----
test("search: result line actually contains a matched query term", () => {
  const dir = mkdtempSync(join(tmpdir(), "search-"));
  const n = note(
    dir,
    "multi.md",
    "2026-01-01",
    "- unrelated first bullet about gardening\n- second bullet mentions zellnet forgejo deployment\n- third bullet about laundry"
  );
  const results = search([n], "forgejo deployment");
  expect(results.length).toBe(1);
  const [r] = results;

  // re-derive the exact file line and confirm it contains at least one matched term
  const fileLines = readFileSync(join(dir, "multi.md"), "utf8").split("\n");
  const citedLine = fileLines[r.line - 1];
  expect(citedLine).toBeDefined();
  expect(citedLine.toLowerCase()).toContain("forgejo");
  expect(citedLine.trim()).toBe(r.snippet);
});

// ---- (c) rarer term weighs more than a term present in all docs (IDF sanity) ----
test("search: rare term contributes more score than a term present in every doc", () => {
  const dir = mkdtempSync(join(tmpdir(), "search-"));
  // "common" appears in every doc; "zephyrium" appears only in doc A.
  const a = note(dir, "a.md", "2026-01-01", "- common word zephyrium appears here");
  const b = note(dir, "b.md", "2026-01-01", "- common word appears here too");
  const c = note(dir, "c.md", "2026-01-01", "- common word also appears in this one");
  const notes = [a, b, c];

  const rareResults = search(notes, "zephyrium");
  const commonResults = search(notes, "common");

  expect(rareResults.length).toBe(1);
  expect(commonResults.length).toBe(3);
  // the rare term's score for the one doc it appears in must exceed the common term's
  // score for that same doc (a.md), since idf(rare) > idf(common).
  const commonScoreForA = commonResults.find((r) => r.path === "a.md")!.score;
  expect(rareResults[0].score).toBeGreaterThan(commonScoreForA);
});

// ---- (d) custom ScoreFn injection changes ranking ----
test("search: injected ScoreFn overrides default bm25 ranking", () => {
  const dir = mkdtempSync(join(tmpdir(), "search-"));
  const a = note(dir, "a.md", "2026-01-01", "- widget widget widget appears many times");
  const b = note(dir, "b.md", "2026-01-01", "- widget appears once only");
  const notes = [a, b];

  const defaultResults = search(notes, "widget");
  expect(defaultResults[0].path).toBe("a.md"); // higher term frequency wins under bm25

  // constant scorer: every doc that matches gets the same score, order determined by
  // input order (stable sort) rather than term frequency -> b.md should now lead.
  const reversedInput = [b, a];
  const constantScorer = (queryTokens: string[], doc: Doc, _corpus: CorpusStats) => {
    const hasMatch = queryTokens.some((t) => doc.termFreq.has(t));
    return hasMatch ? 1 : 0;
  };
  const constantResults = search(reversedInput, "widget", constantScorer);
  expect(constantResults.length).toBe(2);
  expect(constantResults[0].score).toBe(1);
  expect(constantResults[1].score).toBe(1);
  expect(constantResults[0].path).toBe("b.md"); // input order preserved, not bm25 order

  // sanity: constant scorer's numbers really came from our function, not bm25's.
  expect(constantResults[0].score).not.toBe(defaultResults[0].score);
});

// ---- tokenize sanity ----
test("tokenize: lowercases, splits on non-alphanumerics, drops empties", () => {
  expect(tokenize("Kubernetes-Cluster_Upgrade v1.2!")).toEqual(["kubernetes", "cluster", "upgrade", "v1", "2"]);
  expect(tokenize("   ")).toEqual([]);
});

// ---- bm25 export sanity ----
test("bm25: zero when query term absent from doc", () => {
  const doc: Doc = { path: "x.md", length: 10, termFreq: new Map([["foo", 2]]) };
  const corpus: CorpusStats = { N: 5, avgdl: 10, df: new Map([["foo", 1]]) };
  expect(bm25(["bar"], doc, corpus)).toBe(0);
  expect(bm25(["foo"], doc, corpus)).toBeGreaterThan(0);
});
