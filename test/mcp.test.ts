import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveVaultDir, runSearchTool, runSnapshotTool } from "../src/mcp.ts";
import { loadConfig } from "../src/config.ts";
import { search, loadNotesFromVault } from "../src/search.ts";
import { buildSnapshot, loadSnapshotFiles, DEFAULT_SNAPSHOT } from "../src/snapshot.ts";

function setupVault(): string {
  const dir = mkdtempSync(join(tmpdir(), "mcp-"));
  writeFileSync(
    join(dir, "vault.config.json"),
    JSON.stringify({ name: "t", semantic_dirs: {}, episodic_dirs: {}, extra_dirs: [] }),
  );
  // notes for vault_search
  writeFileSync(
    join(dir, "alpha.md"),
    "---\nupdated: 2026-01-01\ntags: [note]\ntype: reference\n---\n\n# Alpha\n\n## Notes\n- kubernetes cluster upgrade notes\n",
  );
  writeFileSync(
    join(dir, "beta.md"),
    "---\nupdated: 2026-01-01\ntags: [note]\ntype: reference\n---\n\n# Beta\n\n## Notes\n- sourdough bread recipe\n",
  );
  // default snapshot files (IDENTITY.md, ALWAYS.md, NEVER.md, AGENTS.md)
  writeFileSync(join(dir, "IDENTITY.md"), "## Who\nThe Architect.\n");
  writeFileSync(join(dir, "ALWAYS.md"), "## Rule\nGrep the vault first.\n");
  return dir;
}

// ---- handler === backing fn (thin-adapter invariant) ----

test("runSearchTool matches search(loadNotesFromVault(...)).slice(0, limit) exactly", () => {
  const dir = setupVault();
  const expected = search(loadNotesFromVault(dir), "kubernetes cluster").slice(0, 10);
  const actual = runSearchTool(dir, { query: "kubernetes cluster" });
  expect(actual).toEqual(expected);
  expect(actual.length).toBeGreaterThan(0);
});

test("runSearchTool respects a custom limit", () => {
  const dir = setupVault();
  const expected = search(loadNotesFromVault(dir), "notes").slice(0, 1);
  const actual = runSearchTool(dir, { query: "notes", limit: 1 });
  expect(actual).toEqual(expected);
  expect(actual.length).toBeLessThanOrEqual(1);
});

test("runSnapshotTool's snapshot field matches buildSnapshot(loadSnapshotFiles(...)) exactly", () => {
  const dir = setupVault();
  const cfg = loadConfig(dir);
  const scfg = cfg.snapshot ?? DEFAULT_SNAPSHOT;
  const expected = buildSnapshot(loadSnapshotFiles(dir, scfg), scfg.budget_tokens);

  const actual = runSnapshotTool(dir, cfg, {});
  expect(actual.snapshot).toBe(expected);
  expect(actual.budgetTokens).toBe(scfg.budget_tokens);
  expect(actual.files).toEqual(["IDENTITY.md", "ALWAYS.md"]); // NEVER.md/AGENTS.md missing, skipped
});

test("runSnapshotTool honors a budgetTokens override", () => {
  const dir = setupVault();
  const cfg = loadConfig(dir);
  const scfg = cfg.snapshot ?? DEFAULT_SNAPSHOT;
  const expected = buildSnapshot(loadSnapshotFiles(dir, scfg), 5);

  const actual = runSnapshotTool(dir, cfg, { budgetTokens: 5 });
  expect(actual.snapshot).toBe(expected);
  expect(actual.budgetTokens).toBe(5);
});

// ---- resolveVaultDir: --dir trust boundary ----

test("resolveVaultDir returns the resolved dir when vault.config.json exists", () => {
  const dir = setupVault();
  expect(resolveVaultDir(["--dir", dir])).toBe(dir);
});

test("resolveVaultDir throws when --dir is missing", () => {
  expect(() => resolveVaultDir([])).toThrow("--dir <vault> is required");
});

test("resolveVaultDir throws when the dir has no vault.config.json", () => {
  expect(() => resolveVaultDir(["--dir", "/tmp/definitely-not-a-vault-xyz"])).toThrow("is not a vault");
});

// ---- stdio smoke: SDK-on-Bun contract via `bun src/init.ts mcp --dir <vault>` ----

test("stdio smoke: tools/list over `bun src/init.ts mcp --dir <vault>` returns both tools", async () => {
  const dir = setupVault();
  const repoRoot = join(import.meta.dir, "..");

  const proc = Bun.spawn({
    cmd: ["bun", "src/init.ts", "mcp", "--dir", dir],
    cwd: repoRoot,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  function frame(obj: unknown): string {
    return JSON.stringify(obj) + "\n";
  }

  proc.stdin.write(
    frame({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-test", version: "0.0.1" },
      },
    }),
  );
  await proc.stdin.flush();
  proc.stdin.write(frame({ jsonrpc: "2.0", method: "notifications/initialized" }));
  await proc.stdin.flush();
  proc.stdin.write(frame({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
  await proc.stdin.flush();

  await new Promise((r) => setTimeout(r, 800));
  proc.stdin.end();

  const stdoutBuf = await new Response(proc.stdout).text();
  proc.kill();

  const lines = stdoutBuf.split("\n").filter((l) => l.trim().length > 0);
  const parsed = lines.map((l) => JSON.parse(l));
  const listResp = parsed.find((p) => p.id === 2);

  expect(Array.isArray(listResp?.result?.tools)).toBe(true);
  const names = listResp.result.tools.map((t: { name: string }) => t.name);
  expect(names).toContain("vault_search");
  expect(names).toContain("vault_snapshot");
});
