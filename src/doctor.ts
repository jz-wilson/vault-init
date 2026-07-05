#!/usr/bin/env bun
// doctor.ts — diagnose and repair a vault's setup. Package-only (NOT vendored): repairs pull
// files from the installed package (templates/, src/), which a vendored copy can't reach.
//   bunx vault-init doctor --dir <vault> [--fix] [--force] [--skip-mcp]
// Report-only by default; --fix applies the repairs (--force additionally overwrites drifted
// vendored scripts, and implies --fix). Checks:
//   vault.config.json present · vendored scripts complete · root CLAUDE.md /
//   .claude/settings.json / .mcp.json present · git core.hooksPath · $VAULT_DIR set ·
//   journal episodic type (report-only) · machine-wide link (runs link.ts if missing)
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runMain } from "./config.ts";
import { OPERATIONAL, ensureVaultDirEnv, writeMcpJson } from "./init.ts";
import { claudeConfigDir, isLinked, runLink } from "./link.ts";

const SRC = import.meta.dir;
const TEMPLATES = join(SRC, "..", "templates");

export function runDoctor(argv: string[]): void {
  const force = argv.includes("--force");
  const dryRun = !argv.includes("--fix") && !force; // report-only unless asked to repair
  // vault resolution: explicit --dir > cwd when it is a vault > $VAULT_DIR
  const dirIx = argv.indexOf("--dir");
  const vaultRoot = dirIx >= 0
    ? resolve(argv[dirIx + 1] ?? "")
    : existsSync(join(resolve("."), "vault.config.json")) ? resolve(".") : resolve(process.env.VAULT_DIR ?? ".");
  let fixed = 0, warned = 0;
  const ok = (msg: string) => console.log(`✓ ${msg}`);
  const fix = (msg: string) => { fixed++; console.log(`${dryRun ? "would fix" : "fixed"}: ${msg}`); };
  const warn = (msg: string) => { warned++; console.log(`warn: ${msg}`); };

  if (!existsSync(join(vaultRoot, "vault.config.json")))
    throw new Error(`no vault at '${vaultRoot}' (missing vault.config.json) — doctor repairs existing vaults; scaffold one with 'bunx vault-init'`);
  const config = JSON.parse(readFileSync(join(vaultRoot, "vault.config.json"), "utf8"));
  ok("vault.config.json present and parses");

  // vendored scripts: fill gaps from the package; report drift, overwrite only on --force
  for (const f of OPERATIONAL) {
    const dest = join(vaultRoot, "scripts", f);
    const pkg = readFileSync(join(SRC, f), "utf8");
    if (!existsSync(dest)) {
      if (!dryRun) { mkdirSync(dirname(dest), { recursive: true }); copyFileSync(join(SRC, f), dest); }
      fix(`re-vendored missing scripts/${f}`);
    } else if (readFileSync(dest, "utf8") !== pkg) {
      if (force) {
        if (!dryRun) copyFileSync(join(SRC, f), dest);
        fix(`overwrote drifted scripts/${f} (--force)`);
      } else warn(`scripts/${f} differs from this package version — --force overwrites`);
    }
  }
  ok(`vendored scripts checked (${OPERATIONAL.length})`);

  // Claude Code integration files
  const restore: Array<[string, string]> = [
    [join(TEMPLATES, "docs", "CLAUDE.md"), join(vaultRoot, "CLAUDE.md")],
    [join(TEMPLATES, "claude", "settings.json"), join(vaultRoot, ".claude", "settings.json")],
  ];
  for (const [src, dest] of restore) {
    if (existsSync(dest)) continue;
    if (!dryRun) { mkdirSync(dirname(dest), { recursive: true }); copyFileSync(src, dest); }
    fix(`restored ${dest.slice(vaultRoot.length + 1)}`);
  }
  const linked = isLinked(claudeConfigDir(), vaultRoot);
  if (!existsSync(join(vaultRoot, ".mcp.json"))) {
    // linked vaults have a user-scope MCP registration — a project-scope .mcp.json is redundant,
    // so a deliberately removed one isn't a defect
    if (linked) ok(".mcp.json absent — fine, vault is linked user-scope");
    else {
      if (!dryRun) writeMcpJson(vaultRoot);
      fix("wrote .mcp.json (pinned MCP registration)");
    }
  }
  ok("Claude Code integration files checked (CLAUDE.md, .claude/settings.json, .mcp.json)");

  // git hooks path — commit-time validation depends on it
  if (existsSync(join(vaultRoot, ".git"))) {
    const r = Bun.spawnSync(["git", "config", "core.hooksPath"], { cwd: vaultRoot });
    if (new TextDecoder().decode(r.stdout).trim() !== ".githooks") {
      if (!dryRun) Bun.spawnSync(["git", "config", "core.hooksPath", ".githooks"], { cwd: vaultRoot });
      fix("set git core.hooksPath=.githooks");
    } else ok("git core.hooksPath=.githooks");
  } else warn("not a git repo — run 'git init' in the vault; commit-time validation is off");

  if (!config.episodic_dirs?.journal)
    warn("no 'journal' episodic type in vault.config.json — scripts/log-turn.ts is disabled");

  // $VAULT_DIR — the machine-wide default every command falls back to
  if (!process.env.VAULT_DIR) {
    const env = ensureVaultDirEnv(vaultRoot, dryRun);
    if (env.changed) fix(env.msg);
    else warn(env.msg);
  } else if (resolve(process.env.VAULT_DIR) !== vaultRoot)
    warn(`$VAULT_DIR points at a different vault (${process.env.VAULT_DIR}) — commands without --dir default there`);
  else ok("$VAULT_DIR points at this vault");

  // machine-wide link — the piece mcp refuses to start without
  if (linked) ok("linked machine-wide (global SessionStart hook present)");
  else {
    fix("linking machine-wide (global hook + CLAUDE.md pointer + MCP registration)");
    runLink(["--dir", vaultRoot, ...(dryRun ? ["--dry-run"] : []), ...(argv.includes("--skip-mcp") ? ["--skip-mcp"] : [])]);
  }

  console.log(`doctor: ${fixed} ${dryRun ? "fixable" : "fixed"}, ${warned} warning${warned === 1 ? "" : "s"}${dryRun && fixed > 0 ? " — run again with --fix to apply" : ""}`);
}

if (import.meta.main) runMain(() => runDoctor(process.argv.slice(2)));
