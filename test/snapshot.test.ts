import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSnapshot, loadSnapshotFiles, DEFAULT_SNAPSHOT } from "../src/snapshot.ts";

const approxTokens = (s: string) => Math.ceil(s.length / 4);

// ---- buildSnapshot: purity, section-awareness ----

test("buildSnapshot: whole file included when budget is generous", () => {
  const files = [{ path: "IDENTITY.md", content: "# Identity\n\n## Who\nA.\n\n## Style\nB.\n" }];
  const out = buildSnapshot(files, 1000);
  expect(out).toContain("# IDENTITY.md");
  expect(out).toContain("## Who\nA.");
  expect(out).toContain("## Style\nB.");
  expect(approxTokens(out)).toBeLessThanOrEqual(1000);
});

test("buildSnapshot: a section never appears partially — cut lands on a section boundary", () => {
  // Each "## " section body is padded so a mid-section budget would otherwise slice it.
  const secA = "## A\n" + "x".repeat(40); // ~45 chars -> ~12 tokens incl heading
  const secB = "## B\n" + "y".repeat(40);
  const files = [{ path: "IDENTITY.md", content: `# Lead\n\n${secA}\n\n${secB}\n` }];

  // Budget fits the marker + lead + section A comfortably, but not enough left for all of B.
  const marker = "# IDENTITY.md";
  const lead = "# Lead";
  const budget = approxTokens(marker) + approxTokens(lead) + approxTokens(secA) + 3; // a few tokens short of B
  const out = buildSnapshot(files, budget);

  expect(out).toContain(secA);
  // Section B must be either fully absent or fully present — never a partial "## B\nyyy..." fragment.
  const bIndex = out.indexOf("## B");
  expect(bIndex === -1 || out.includes(secB)).toBe(true);
  if (bIndex !== -1) expect(out).toContain(secB);
  else expect(out).not.toContain("yyyy");
});

test("buildSnapshot: priority order respected — later file's sections dropped before earlier file's", () => {
  const fileA = { path: "IDENTITY.md", content: "# A\n\n## Sec1\n" + "a".repeat(200) };
  const fileB = { path: "ALWAYS.md", content: "# B\n\n## Sec1\n" + "b".repeat(200) };

  // Budget large enough for A in full, but nothing meaningful left for B.
  const budgetForAOnly = approxTokens("# IDENTITY.md") + approxTokens(fileA.content) + 2;
  const out = buildSnapshot([fileA, fileB], budgetForAOnly);

  expect(out).toContain("# IDENTITY.md");
  expect(out).toContain("a".repeat(200));
  expect(out).not.toContain("# ALWAYS.md");
  expect(out).not.toContain("b".repeat(200));
});

test("buildSnapshot: tiny budget drops everything rather than emit a partial fragment", () => {
  const files = [{ path: "IDENTITY.md", content: "# Identity\n\n## Who\nSomething moderately long here.\n" }];
  const out = buildSnapshot(files, 1);
  expect(out).toBe("");
});

test("buildSnapshot: output stays at or under the token budget (chars/4 approximation)", () => {
  const files = [
    { path: "IDENTITY.md", content: "# Identity\n\n## Who\n" + "z".repeat(500) + "\n\n## Style\n" + "q".repeat(500) },
    { path: "ALWAYS.md", content: "# Always\n\n## Rule1\n" + "w".repeat(500) },
  ];
  for (const budget of [10, 50, 120, 400, 900]) {
    const out = buildSnapshot(files, budget);
    expect(approxTokens(out)).toBeLessThanOrEqual(budget);
  }
});

test("buildSnapshot: empty lead section (content starts directly with ##) is handled", () => {
  const files = [{ path: "AGENTS.md", content: "## First\nHello.\n" }];
  const out = buildSnapshot(files, 1000);
  expect(out).toBe("# AGENTS.md\n\n## First\nHello.");
});

test("buildSnapshot: file with no ## headings at all is treated as one lead section", () => {
  const files = [{ path: "NEVER.md", content: "# Never\nJust prose, no subsections.\n" }];
  const out = buildSnapshot(files, 1000);
  expect(out).toBe("# NEVER.md\n\n# Never\nJust prose, no subsections.");
});

test("buildSnapshot: multiple files all fit and are concatenated in given order", () => {
  const files = [
    { path: "IDENTITY.md", content: "## Who\nI.\n" },
    { path: "ALWAYS.md", content: "## Rule\nR.\n" },
  ];
  const out = buildSnapshot(files, 1000);
  expect(out.indexOf("# IDENTITY.md")).toBeLessThan(out.indexOf("# ALWAYS.md"));
});

test("buildSnapshot: ### subsections stay attached to their parent ## section, not split points", () => {
  const files = [{ path: "AGENTS.md", content: "## Parent\nintro\n### Child\nnested detail\n" }];
  const out = buildSnapshot(files, 1000);
  expect(out).toContain("## Parent\nintro\n### Child\nnested detail");
});

// ---- main() / CLI: missing-file skip, config defaults, --budget override ----

function setupVault(opts: { snapshotField?: unknown } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "snap-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  copyFileSync(join(import.meta.dir, "..", "src", "config.ts"), join(dir, "scripts", "config.ts"));
  copyFileSync(join(import.meta.dir, "..", "src", "snapshot.ts"), join(dir, "scripts", "snapshot.ts"));

  const cfg: Record<string, unknown> = { name: "t", semantic_dirs: {}, episodic_dirs: {}, extra_dirs: [] };
  if ("snapshotField" in opts) cfg.snapshot = opts.snapshotField;
  writeFileSync(join(dir, "vault.config.json"), JSON.stringify(cfg));
  return dir;
}

function runSnapshot(dir: string, args: string[] = []) {
  const proc = Bun.spawnSync(["bun", "scripts/snapshot.ts", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return { out: proc.stdout.toString("utf8"), err: proc.stderr.toString("utf8"), code: proc.exitCode };
}

test("CLI: default file list, missing files skipped silently, present ones included", () => {
  const dir = setupVault();
  // Only create ALWAYS.md and AGENTS.md — IDENTITY.md and NEVER.md (also defaults) are missing.
  writeFileSync(join(dir, "ALWAYS.md"), "## Rule\nDo the thing.\n");
  writeFileSync(join(dir, "AGENTS.md"), "## Protocol\nFollow it.\n");

  const { out, code } = runSnapshot(dir);
  expect(code).toBe(0);
  expect(out).toContain("# ALWAYS.md");
  expect(out).toContain("# AGENTS.md");
  expect(out).not.toContain("IDENTITY.md");
  expect(out).not.toContain("NEVER.md");
});

test("CLI: --budget flag overrides configured budget_tokens", () => {
  // Configured budget is tiny — without an override the content would be dropped entirely.
  const dir = setupVault({ snapshotField: { files: ["ALWAYS.md"], budget_tokens: 5 } });
  writeFileSync(join(dir, "ALWAYS.md"), "## Rule\n" + "n".repeat(400) + "\n");

  const usingConfig = runSnapshot(dir);
  const overridden = runSnapshot(dir, ["--budget", "10000"]);
  expect(usingConfig.out.trim()).toBe("");
  expect(overridden.out).toContain("n".repeat(400));
});

// ---- loadSnapshotFiles: loader parity ----

test("loadSnapshotFiles: returns both present files, skips missing ones", () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), "loader-"));
  const cfg = { files: ["ALWAYS.md", "NEVER.md", "MISSING.md"], budget_tokens: 1000 };

  writeFileSync(join(vaultRoot, "ALWAYS.md"), "## Always\nContent A");
  writeFileSync(join(vaultRoot, "NEVER.md"), "## Never\nContent B");
  // MISSING.md is not created

  const files = loadSnapshotFiles(vaultRoot, cfg);

  expect(files).toHaveLength(2);
  expect(files[0].path).toBe("ALWAYS.md");
  expect(files[0].content).toBe("## Always\nContent A");
  expect(files[1].path).toBe("NEVER.md");
  expect(files[1].content).toBe("## Never\nContent B");
});
