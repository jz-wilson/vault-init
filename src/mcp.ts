#!/usr/bin/env bun
// MCP stdio server — exposes vault_search / vault_snapshot as read-only tools over a --dir vault
// root. Thin adapter: each tool handler is a plain fn (runSearchTool/runSnapshotTool) that calls
// the same pure fns the CLIs use (search.ts, snapshot.ts); the MCP request handler just wraps the
// fn's return value in the `{ content: [...] }` envelope. Not vendored into scaffolded vaults'
// scripts/ (src/init.ts's OPERATIONAL list) — this is a package-level dev/runtime dep, not a
// zero-dep operational script.
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, type VaultConfig } from "./config.ts";
import { search, loadNotesFromVault, type Result } from "./search.ts";
import { buildSnapshot, loadSnapshotFiles, DEFAULT_SNAPSHOT } from "./snapshot.ts";

const VERSION: string = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")).version;

/** Parse + validate --dir (trust boundary). Confirms a vault root exists there — not that the
 *  tree is well-formed; loadConfig/resolveInside still guard every per-file path inside. */
export function resolveVaultDir(argv: string[]): string {
  const i = argv.indexOf("--dir");
  const raw = i >= 0 ? argv[i + 1] : undefined;
  if (!raw) throw new Error("mcp: --dir <vault> is required");
  const dir = resolve(raw);
  if (!existsSync(join(dir, "vault.config.json")))
    throw new Error(`mcp: '${raw}' is not a vault (no vault.config.json)`);
  return dir;
}

export function runSearchTool(vaultRoot: string, args: { query: string; limit?: number }): Result[] {
  return search(loadNotesFromVault(vaultRoot), args.query).slice(0, args.limit ?? 10);
}

export function runSnapshotTool(
  vaultRoot: string,
  cfg: VaultConfig,
  args: { budgetTokens?: number },
): { budgetTokens: number; files: string[]; snapshot: string } {
  const scfg = cfg.snapshot ?? DEFAULT_SNAPSHOT;
  const files = loadSnapshotFiles(vaultRoot, scfg);
  const budgetTokens = args.budgetTokens ?? scfg.budget_tokens;
  return { budgetTokens, files: files.map((f) => f.path), snapshot: buildSnapshot(files, budgetTokens) };
}

export async function runMcp(argv: string[]) {
  const vaultRoot = resolveVaultDir(argv);
  const cfg = loadConfig(vaultRoot);

  const server = new Server({ name: "vault-init", version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "vault_search",
        description: "BM25 lexical search over the vault's markdown notes",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "search query terms" },
            limit: { type: "integer", description: "max results (default 10)" },
          },
          required: ["query"],
        },
      },
      {
        name: "vault_snapshot",
        description: "Token-capped identity digest from the vault's configured snapshot files",
        inputSchema: {
          type: "object",
          properties: {
            budgetTokens: { type: "integer", description: "token budget override (default from vault.config.json)" },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    let result: unknown;
    if (req.params.name === "vault_search") {
      result = runSearchTool(vaultRoot, args as { query: string; limit?: number });
    } else if (req.params.name === "vault_snapshot") {
      result = runSnapshotTool(vaultRoot, cfg, args as { budgetTokens?: number });
    } else {
      throw new Error(`unknown tool: ${req.params.name}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  await server.connect(new StdioServerTransport());
}
