#!/usr/bin/env bun
// link.ts — register this vault globally with Claude Code so ANY session on this machine,
// in any project directory, knows the vault exists. Three surfaces:
//   1. user-scope MCP server (`claude mcp add --scope user`) — vault tools everywhere
//   2. global SessionStart hook (~/.claude/settings.json) — identity snapshot injected every session
//   3. pointer block in ~/.claude/CLAUDE.md — tells the agent the vault path + how to use it
// All writes are idempotent merges — existing user config is preserved, never clobbered.
// Vendored:  bun scripts/link.ts [--dry-run]
// Package:   bunx vault-init link --dir <vault> [--dry-run]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { runMain } from "./config.ts";

function snapshotCommand(vaultRoot: string): string {
  return `bun ${join(vaultRoot, "scripts", "snapshot.ts")}`;
}

/** Is this vault linked machine-wide? True when the global SessionStart snapshot hook for it
 *  exists in cfgDir/settings.json — the load-bearing surface `link`/`doctor` write. */
export function isLinked(cfgDir: string, vaultRoot: string): boolean {
  const settingsPath = join(cfgDir, "settings.json");
  if (!existsSync(settingsPath)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    for (const entry of settings.hooks?.SessionStart ?? [])
      for (const h of entry.hooks ?? [])
        if (h.command === snapshotCommand(vaultRoot)) return true;
  } catch {}
  return false;
}

/** Default Claude Code config dir — link/doctor/mcp all resolve it identically. */
export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

/** Add a SessionStart command hook to a Claude Code settings object unless already present. */
export function mergeSessionStartHook(settings: any, command: string): { settings: any; changed: boolean } {
  settings.hooks ??= {};
  settings.hooks.SessionStart ??= [];
  for (const entry of settings.hooks.SessionStart)
    for (const h of entry.hooks ?? [])
      if (h.command === command) return { settings, changed: false };
  settings.hooks.SessionStart.push({
    matcher: "startup|resume|clear",
    hooks: [{ type: "command", command }],
  });
  return { settings, changed: true };
}

/** Insert or replace a marker-delimited block in a markdown document. */
export function upsertPointerBlock(md: string, name: string, body: string): { md: string; changed: boolean } {
  const begin = `<!-- vault-init:link:${name} -->`;
  const end = `<!-- /vault-init:link:${name} -->`;
  const block = `${begin}\n${body.trim()}\n${end}\n`;
  const i = md.indexOf(begin);
  if (i >= 0) {
    const j = md.indexOf(end, i);
    if (j < 0) throw new Error(`corrupt vault-init block in CLAUDE.md: '${begin}' has no closing marker`);
    const current = md.slice(i, j + end.length + 1);
    if (current === block) return { md, changed: false };
    return { md: md.slice(0, i) + block + md.slice(j + end.length + 1), changed: true };
  }
  const sep = md.length === 0 || md.endsWith("\n\n") ? "" : md.endsWith("\n") ? "\n" : "\n\n";
  return { md: md + sep + block, changed: true };
}

function pointerBody(name: string, vaultRoot: string): string {
  return `## Vault: ${name}
Persistent memory vault at \`${vaultRoot}\` (MCP server \`${name}\`, available in every project).
- Look up context: \`vault_search {query}\`, then \`vault_read {path}\` for full notes; \`vault_snapshot\` for the identity/rules digest.
- Write back durable facts: \`bun ${join(vaultRoot, "scripts", "capture.ts")} --type <type> --note <name> "<dense fact>"\`.`;
}

/** Merge the global SessionStart hook + CLAUDE.md pointer into cfgDir. Returns human-readable change log. */
export function applyGlobalConfig(cfgDir: string, vaultRoot: string, name: string, dryRun: boolean): string[] {
  const log: string[] = [];
  const snapshotCmd = snapshotCommand(vaultRoot);

  const settingsPath = join(cfgDir, "settings.json");
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
  const hookRes = mergeSessionStartHook(settings, snapshotCmd);
  if (hookRes.changed) {
    if (!dryRun) {
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(settingsPath, JSON.stringify(hookRes.settings, null, 2) + "\n");
    }
    log.push(`${dryRun ? "would add" : "added"} SessionStart snapshot hook → ${settingsPath}`);
  } else log.push(`SessionStart hook already present in ${settingsPath}`);

  const mdPath = join(cfgDir, "CLAUDE.md");
  const md = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "";
  const mdRes = upsertPointerBlock(md, name, pointerBody(name, vaultRoot));
  if (mdRes.changed) {
    if (!dryRun) {
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(mdPath, mdRes.md);
    }
    log.push(`${dryRun ? "would upsert" : "upserted"} vault pointer block → ${mdPath}`);
  } else log.push(`vault pointer already current in ${mdPath}`);

  return log;
}

/** Pinned `vault-init@<version>` spec from the vault's scaffolded .mcp.json, else unpinned. */
function packageSpec(vaultRoot: string): string {
  try {
    const mcp = JSON.parse(readFileSync(join(vaultRoot, ".mcp.json"), "utf8"));
    for (const srv of Object.values<any>(mcp.mcpServers ?? {}))
      for (const a of srv.args ?? []) if (typeof a === "string" && a.startsWith("vault-init")) return a;
  } catch {}
  return "vault-init";
}

function registerMcp(vaultRoot: string, name: string, dryRun: boolean): string {
  const add = ["claude", "mcp", "add", "--scope", "user", name, "--", "bunx", packageSpec(vaultRoot), "mcp", "--dir", vaultRoot];
  const manual = add.join(" ");
  if (dryRun) return `would run: ${manual}`;
  try {
    const r = Bun.spawnSync(add, { stdout: "pipe", stderr: "pipe" });
    if (r.exitCode === 0) return `registered user-scope MCP server '${name}'`;
    const err = new TextDecoder().decode(r.stderr);
    if (/already exists/i.test(err)) return `MCP server '${name}' already registered`;
    return `claude mcp add failed (${err.trim().split("\n")[0]}) — run manually:\n  ${manual}`;
  } catch {
    return `'claude' CLI not found — run manually once it's installed:\n  ${manual}`;
  }
}

export function runLink(argv: string[]): void {
  const dryRun = argv.includes("--dry-run");
  const skipMcp = argv.includes("--skip-mcp"); // file merges only — no `claude mcp add` spawn
  // vault resolution: explicit --dir > the vault this script is vendored into > $VAULT_DIR
  const dirIx = argv.indexOf("--dir");
  const local = resolve(import.meta.dir, "..");
  const vaultRoot = dirIx >= 0
    ? resolve(argv[dirIx + 1] ?? "")
    : existsSync(join(local, "vault.config.json")) ? local : resolve(process.env.VAULT_DIR ?? local);
  if (!existsSync(join(vaultRoot, "vault.config.json")))
    throw new Error(`no vault at '${vaultRoot}' (missing vault.config.json) — pass --dir <vault> or set $VAULT_DIR`);

  const rawName = JSON.parse(readFileSync(join(vaultRoot, "vault.config.json"), "utf8")).name ?? "vault";
  const name = String(rawName).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const cfgDir = claudeConfigDir();

  for (const line of applyGlobalConfig(cfgDir, vaultRoot, name, dryRun)) console.log(line);
  if (!skipMcp) console.log(registerMcp(vaultRoot, name, dryRun));
  console.log(`vault '${name}' is ${dryRun ? "ready to be " : ""}linked machine-wide — new Claude Code sessions anywhere will see it.`);
}

if (import.meta.main) runMain(() => runLink(process.argv.slice(2)));
