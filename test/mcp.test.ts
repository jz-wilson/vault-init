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

const frame = (obj: unknown): string => JSON.stringify(obj) + "\n";

/** Read newline-delimited JSON-RPC responses until every wanted id is seen or the deadline hits.
 *  Polls the stream (races each read against the remaining time) instead of a fixed sleep. */
async function collectResponses(
  stream: ReadableStream<Uint8Array>,
  wantIds: number[],
  deadlineMs = 5000,
): Promise<Map<number, any>> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  const out = new Map<number, any>();
  const deadline = Date.now() + deadlineMs;
  let buf = "";
  try {
    while (out.size < wantIds.length && Date.now() < deadline) {
      const timer = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), Math.max(0, deadline - Date.now())));
      const res = await Promise.race([reader.read(), timer]);
      if (res === "timeout" || res.done) break;
      buf += dec.decode(res.value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (typeof msg.id === "number" && wantIds.includes(msg.id)) out.set(msg.id, msg);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return out;
}

const toolResult = (resp: any) => JSON.parse(resp.result.content[0].text);

test("stdio: tools/list + tools/call for both tools over `bun src/init.ts mcp --dir <vault>`", async () => {
  const dir = setupVault();
  const proc = Bun.spawn({
    cmd: ["bun", "src/init.ts", "mcp", "--dir", dir],
    cwd: join(import.meta.dir, ".."),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(frame({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mcp-test", version: "0.0.1" } },
  }));
  proc.stdin.write(frame({ jsonrpc: "2.0", method: "notifications/initialized" }));
  proc.stdin.write(frame({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
  proc.stdin.write(frame({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vault_search", arguments: { query: "kubernetes", limit: 5 } } }));
  proc.stdin.write(frame({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "vault_snapshot", arguments: {} } }));
  await proc.stdin.flush();

  const resp = await collectResponses(proc.stdout, [2, 3, 4]);
  proc.stdin.end();
  proc.kill();

  // tools/list — both tools advertised
  const names = resp.get(2)?.result?.tools?.map((t: { name: string }) => t.name);
  expect(names).toContain("vault_search");
  expect(names).toContain("vault_snapshot");

  // tools/call vault_search — real hit for the kubernetes note, not the sourdough one
  const hits = toolResult(resp.get(3));
  expect(Array.isArray(hits)).toBe(true);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].path).toBe("alpha.md");

  // tools/call vault_snapshot — structured digest over the wire
  const snap = toolResult(resp.get(4));
  expect(snap.files).toEqual(["IDENTITY.md", "ALWAYS.md"]);
  expect(typeof snap.snapshot).toBe("string");
  expect(snap.budgetTokens).toBeGreaterThan(0);
}, 15000);
