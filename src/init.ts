#!/usr/bin/env bun
// vault-init — scaffold an agent-coordination + memory vault. Published bunx bin.
// Interactive:     bunx vault-init
// Non-interactive: bunx vault-init --yes --preset sre --name work --dir ./work-vault
import { mkdirSync, writeFileSync, copyFileSync, existsSync, chmodSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join, dirname, sep } from "node:path";
import { homedir } from "node:os";
import { runMain } from "./config.ts";

const SRC = import.meta.dir; // package/src — holds the operational .ts to vendor
const PKG = resolve(SRC, ".."); // package root — holds templates/
const TEMPLATES = join(PKG, "templates");

export const OPERATIONAL = [
  "frontmatter.ts", "config.ts", "validate-logs.ts", "validate-vault.ts",
  "capture.ts", "consolidate.ts", "dashboard.ts",
  "index.ts", "snapshot.ts", "search.ts", "nightly.ts", "log-turn.ts", "link.ts",
];

interface Item { value: string; dir: string; bucket: "semantic" | "episodic" | "extra"; label: string; selected: boolean; }
interface Preset { items: Item[]; }

function loadPreset(name: string): Preset {
  if (!name || /[\/\\]/.test(name) || name === "." || name === "..")
    throw new Error(`invalid --preset '${name}': must be a plain preset name, no path separators`);
  return JSON.parse(readFileSync(join(TEMPLATES, "presets", `${name}.json`), "utf8"));
}

/** join() that refuses to resolve outside `base` — blocks `..`-style traversal in user-supplied dir names. */
function safeJoin(base: string, rel: string): string {
  const full = resolve(base, rel);
  if (full !== base && !full.startsWith(base + sep))
    throw new Error(`unsafe path '${rel}' escapes target directory`);
  return full;
}

function buildConfig(name: string, items: Item[]) {
  const semantic: Record<string, string> = {};
  const episodic: Record<string, string> = {};
  const extra: string[] = [];
  for (const it of items) {
    if (it.bucket === "semantic") semantic[it.value] = it.dir;
    else if (it.bucket === "episodic") episodic[it.value] = it.dir;
    else extra.push(it.dir);
  }
  return { name, semantic_dirs: semantic, episodic_dirs: episodic, extra_dirs: extra };
}

function parseFlags(argv: string[]) {
  const f: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") f.yes = true;
    else if (a === "--no-examples") f.noExamples = true;
    else if (a === "--force") f.force = true;
    else if (a === "--nightly") f.nightly = true;
    else if (a.startsWith("--")) f[a.slice(2)] = argv[++i];
  }
  return f;
}

async function interactive() {
  const p = await import("@clack/prompts");
  p.intro("vault-init — agent-coordination + memory vault");
  const name = await p.text({ message: "Vault name", placeholder: "work", defaultValue: "vault" });
  if (p.isCancel(name)) { p.cancel("cancelled"); process.exit(1); }
  const preset = await p.select({
    message: "Starting preset",
    options: [
      { value: "sre", label: "SRE / work", hint: "runbooks, incidents, postmortems, services, oncall" },
      { value: "homelab", label: "Homelab", hint: "infrastructure, decisions, projects, personal" },
      { value: "okf", label: "Agentic second brain", hint: "wiki, crm, journal, skills — agentic second brain" },
      { value: "blank", label: "Blank", hint: "projects only" },
    ],
  });
  if (p.isCancel(preset)) { p.cancel("cancelled"); process.exit(1); }
  const items = loadPreset(preset as string).items;
  const picked = await p.multiselect({
    message: "Directories (space to toggle, enter to confirm)",
    options: items.map((it) => ({ value: it.value, label: it.label, hint: it.bucket })),
    initialValues: items.filter((it) => it.selected).map((it) => it.value),
    required: false,
  });
  if (p.isCancel(picked)) { p.cancel("cancelled"); process.exit(1); }
  const chosen = items.filter((it) => (picked as string[]).includes(it.value));

  const custom = await p.text({ message: "Extra custom dirs (comma-separated, blank to skip)", defaultValue: "" });
  if (!p.isCancel(custom) && (custom as string).trim()) {
    for (const d of (custom as string).split(",").map((s) => s.trim()).filter(Boolean))
      chosen.push({ value: d, dir: d, bucket: "extra", label: d, selected: true });
  }

  const defaultDir = join(homedir(), name as string);
  const dir = await p.text({ message: "Target directory", placeholder: defaultDir, defaultValue: defaultDir });
  if (p.isCancel(dir)) { p.cancel("cancelled"); process.exit(1); }

  const target = resolve(dir as string);
  let force = false;
  if (existsSync(target) && readdirSync(target).length > 0) {
    const overwrite = await p.confirm({ message: `${dir} already exists and is not empty — overwrite?`, initialValue: false });
    if (p.isCancel(overwrite) || !overwrite) { p.cancel("cancelled"); process.exit(1); }
    force = true;
  }
  try {
    scaffold(target, buildConfig(name as string, chosen), true, force);
  } catch (e: any) {
    p.cancel(e.message);
    process.exit(1);
  }
  const nightly = await p.confirm({ message: "Schedule nightly maintenance on this machine (systemd/cron)?", initialValue: true });
  if (!p.isCancel(nightly) && nightly) p.note(setupNightly(target, name as string), "nightly");
  p.note(ensureVaultDirEnv(target).msg, "env");

  p.outro(`Done. Read SEED-PROMPT.md to populate it with an AI. Run 'bun run link' in the vault to register it with Claude Code machine-wide.`);

  const switchNow = await p.confirm({ message: `Switch to ${dir} now?`, initialValue: true });
  if (!p.isCancel(switchNow) && switchNow) {
    console.log(`(dropping into a shell in ${target} — exit to return)`);
    Bun.spawnSync([process.env.SHELL || "bash"], { cwd: target, stdio: ["inherit", "inherit", "inherit"] });
  }
}

/** $VAULT_DIR is the machine-wide default vault for every vault-init command (--dir overrides).
 *  If unset, persist an export into the user's shell profile so future shells have it.
 *  TTY-gated: non-interactive callers (tests, CI, scripts — piped stdout) never touch the real
 *  profile; they get the export line to apply manually. `interactive` is injectable for tests. */
export function ensureVaultDirEnv(
  target: string,
  dryRun = false,
  interactive: boolean = !!process.stdout.isTTY,
): { msg: string; changed: boolean } {
  if (process.env.VAULT_DIR)
    return { msg: `$VAULT_DIR already set (${process.env.VAULT_DIR})`, changed: false };
  if (!interactive)
    return { msg: `non-interactive shell — add 'export VAULT_DIR="${resolve(target)}"' to your shell profile to set the default vault`, changed: false };
  const shell = (process.env.SHELL ?? "").split("/").pop();
  // $HOME first: Bun's homedir() ignores env mutation, which breaks HOME-redirected callers (tests)
  const profile = join(process.env.HOME ?? homedir(), shell === "zsh" ? ".zshrc" : shell === "bash" ? ".bashrc" : ".profile");
  const line = `export VAULT_DIR="${resolve(target)}"`;
  if (existsSync(profile) && readFileSync(profile, "utf8").includes("VAULT_DIR="))
    return { msg: `$VAULT_DIR export already in ${profile} — restart your shell to pick it up`, changed: false };
  if (!dryRun) writeFileSync(profile, `${existsSync(profile) ? readFileSync(profile, "utf8") : ""}\n# vault-init default vault\n${line}\n`);
  return { msg: `${dryRun ? "would append" : "appended"} '${line}' to ${profile} — restart your shell (or run it now)`, changed: true };
}

/** .mcp.json registers this vault with the vault-init MCP server, pinned to the installed
 *  package version so `bunx vault-init@<version> mcp` matches what scaffolded it. */
export function writeMcpJson(target: string): void {
  const { version } = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
  writeFileSync(join(target, ".mcp.json"), JSON.stringify({
    mcpServers: {
      vault: { command: "bunx", args: [`vault-init@${version}`, "mcp", "--dir", resolve(target)] },
    },
  }, null, 2) + "\n");
}

function scaffold(target: string, config: ReturnType<typeof buildConfig>, examples: boolean, force = false) {
  if (existsSync(target) && readdirSync(target).length > 0 && !force)
    throw new Error(`target directory '${target}' already exists and is not empty — pass --force to overwrite`);

  const allDirs = [
    "agents", "dashboard", "handoffs", "scripts", ".githooks", ".github/workflows",
    ...Object.values(config.semantic_dirs), ...Object.values(config.episodic_dirs), ...config.extra_dirs,
  ];
  for (const d of allDirs) mkdirSync(safeJoin(target, d), { recursive: true });

  writeFileSync(join(target, "vault.config.json"), JSON.stringify(config, null, 2) + "\n");

  for (const f of OPERATIONAL) copyFileSync(join(SRC, f), join(target, "scripts", f));

  // vault-local package.json — convenience scripts, no deps
  writeFileSync(join(target, "package.json"), JSON.stringify({
    name: config.name, private: true, type: "module",
    scripts: {
      validate: "bun scripts/validate-vault.ts",
      "validate-logs": "bun scripts/validate-logs.ts",
      capture: "bun scripts/capture.ts",
      consolidate: "bun scripts/consolidate.ts",
      dashboard: "bun scripts/dashboard.ts",
      index: "bun scripts/index.ts",
      snapshot: "bun scripts/snapshot.ts",
      search: "bun scripts/search.ts",
      nightly: "bun scripts/nightly.ts",
      "log-turn": "bun scripts/log-turn.ts",
      link: "bun scripts/link.ts",
    },
  }, null, 2) + "\n");

  // copy static templates (hooks, ci, docs, seed prompt)
  copyTpl(join(TEMPLATES, "githooks", "pre-commit"), join(target, ".githooks", "pre-commit"));
  chmodSync(join(target, ".githooks", "pre-commit"), 0o755);
  copyTpl(join(TEMPLATES, "ci", "validate.yml"), join(target, ".github", "workflows", "validate.yml"));
  // nightly runs on the machine the vault lives on (scripts/nightly.sh + --nightly), not CI —
  // a remote runner can't see a local-only vault, and the vault needs no remote at all.
  copyTpl(join(TEMPLATES, "scripts", "nightly.sh"), join(target, "scripts", "nightly.sh"));
  chmodSync(join(target, "scripts", "nightly.sh"), 0o755);
  // hook-wiring docs ship next to the scripts they wire; scripts/ is validator-skipped
  for (const h of ["session-start-snapshot.md", "log-turn-hook.md", "nightly-automation.md"])
    copyTpl(join(TEMPLATES, "hooks", h), join(target, "scripts", "hooks", h));
  for (const doc of ["_format.md", "AGENTS.md", "README.md", "IDENTITY.md", "ALWAYS.md", "NEVER.md", "CLAUDE.md"]) copyTpl(join(TEMPLATES, "docs", doc), join(target, doc));
  copyTpl(join(TEMPLATES, "SEED-PROMPT.md"), join(target, "SEED-PROMPT.md"));
  copyTpl(join(TEMPLATES, "claude", "settings.json"), join(target, ".claude", "settings.json"));
  writeFileSync(join(target, ".gitignore"), "handoffs/\ndashboard/status.txt\n.nightly.log\n");

  writeMcpJson(target);

  if (examples) writeExamples(target, config);

  // git doesn't track empty dirs — keep any scaffolded dir that ended up empty
  for (const d of allDirs) {
    const full = safeJoin(target, d);
    if (existsSync(full) && readdirSync(full).length === 0) writeFileSync(join(full, ".gitkeep"), "");
  }

  // git init + hooks path — the vault is always a git repo (local-only is fine, no remote needed)
  if (!existsSync(join(target, ".git"))) {
    Bun.spawnSync(["git", "init", "-q"], { cwd: target });
  }
  Bun.spawnSync(["git", "config", "core.hooksPath", ".githooks"], { cwd: target });

  // initial commit so the scaffold state is captured — only when the repo has no history yet
  if (Bun.spawnSync(["git", "rev-parse", "-q", "--verify", "HEAD"], { cwd: target }).exitCode !== 0) {
    const hasIdentity = Bun.spawnSync(["git", "config", "user.email"], { cwd: target }).exitCode === 0;
    const idFlags = hasIdentity ? [] : ["-c", "user.name=vault-init", "-c", "user.email=vault-init@localhost"];
    Bun.spawnSync(["git", "add", "-A"], { cwd: target });
    const commit = Bun.spawnSync(["git", ...idFlags, "commit", "-q", "-m", "chore: scaffold vault (vault-init)"], { cwd: target });
    if (commit.exitCode !== 0)
      console.error(`warning: initial commit failed — commit manually:\n${commit.stderr.toString().trim()}`);
  }
}

/** Schedule scripts/nightly.sh on this machine — the vault's own machine, not CI.
 *  Prefers a systemd user timer, falls back to crontab, else prints instructions. */
function setupNightly(target: string, name: string): string {
  const unit = "vault-nightly-" + name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const runner = join(target, "scripts", "nightly.sh");

  if (Bun.spawnSync(["systemctl", "--user", "show-environment"]).exitCode === 0) {
    const unitDir = join(homedir(), ".config", "systemd", "user");
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(join(unitDir, `${unit}.service`),
      `[Unit]\nDescription=vault nightly maintenance (${name})\n\n[Service]\nType=oneshot\nExecStart=${runner}\n`);
    writeFileSync(join(unitDir, `${unit}.timer`),
      `[Unit]\nDescription=vault nightly maintenance (${name})\n\n[Timer]\nOnCalendar=*-*-* 09:00:00\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`);
    Bun.spawnSync(["systemctl", "--user", "daemon-reload"]);
    const en = Bun.spawnSync(["systemctl", "--user", "enable", "--now", `${unit}.timer`]);
    if (en.exitCode === 0) return `systemd user timer ${unit}.timer enabled (daily 09:00)`;
  }

  if (Bun.spawnSync(["crontab", "-l"], { stdout: "pipe", stderr: "pipe" }).exitCode <= 1) {
    // exit 0 = has crontab, 1 = none yet — both mean crontab(1) works
    const existing = Bun.spawnSync(["crontab", "-l"], { stdout: "pipe", stderr: "pipe" }).stdout.toString();
    if (existing.includes(runner)) return `cron entry for ${runner} already present`;
    const line = `0 9 * * * ${runner} >> ${join(target, ".nightly.log")} 2>&1\n`;
    const w = Bun.spawnSync(["crontab", "-"], { stdin: Buffer.from((existing.trim() ? existing.trimEnd() + "\n" : "") + line) });
    if (w.exitCode === 0) return `cron entry added (daily 09:00) → ${runner}`;
  }

  return `no scheduler found — run ${runner} daily yourself (see scripts/hooks/nightly-automation.md)`;
}

function copyTpl(src: string, dest: string) {
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(src)) copyFileSync(src, dest);
}

function writeExamples(target: string, config: ReturnType<typeof buildConfig>) {
  const today = new Date().toISOString().slice(0, 10);
  const semType = Object.keys(config.semantic_dirs)[0];
  const semDir = config.semantic_dirs[semType];
  if (semType) {
    writeFileSync(join(safeJoin(target, semDir), "example.md"),
      `---\nupdated: ${today}\ntags: [${semType}]\ntype: ${semType}\n---\n\n# Example\n\n## Summary\nExample ${semType} note — delete me.\n\n## Notes\n- ${today}: scaffolded by vault-init\n\n## Related\n_(none yet)_\n`);
  }
  const logDir = join(target, "agents", "example-agent", "reports");
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, `${today}-example-task.md`),
    `---\nupdated: ${today}\ntags: [agent-log]\ntype: agent-log\nagent: "example-agent"\nstatus: completed\ntask: "scaffold demo log"\npriority: low\ndate: ${today}\nverified: false\ncompletion_signal: true\n---\n\n# Example Task\n\n## Summary\nDemo agent log — delete me.\n\n## Notes\n- Shows the schema the dashboard and validator expect.\n\n## Related\n_(none yet)_\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "mcp") {
    try {
      const { runMcp } = await import("./mcp.ts");
      await runMcp(argv.slice(1));
    } catch (e: any) {
      console.error(`error: ${e.message}`);
      console.error(`  fix: bunx vault-init doctor --dir <vault> diagnoses and repairs vault setup`);
      process.exit(1);
    }
    return;
  }
  if (argv[0] === "link") {
    try {
      const { runLink } = await import("./link.ts");
      runLink(argv.slice(1));
    } catch (e: any) {
      console.error(`error: ${e.message}`);
      console.error(`  fix: bunx vault-init doctor --dir <vault> diagnoses and repairs vault setup`);
      process.exit(1);
    }
    return;
  }
  if (argv[0] === "doctor") {
    try {
      const { runDoctor } = await import("./doctor.ts");
      runDoctor(argv.slice(1));
    } catch (e: any) {
      console.error(`error: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  const f = parseFlags(argv);
  if (!f.yes) { await interactive(); return; }

  const name = (f.name as string) || "vault";
  const preset = (f.preset as string) || "blank";
  const target = resolve((f.dir as string) || join(homedir(), name));
  try {
    const items = loadPreset(preset).items.filter((it) => it.selected);
    scaffold(target, buildConfig(name, items), !f.noExamples, Boolean(f.force));
  } catch (e: any) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
  console.log(`✓ scaffolded ${preset} vault → ${target}`);
  if (f.nightly) console.log(`  nightly: ${setupNightly(target, name)}`);
  else console.log(`  nightly: pass --nightly to schedule scripts/nightly.sh on this machine`);
  console.log(`  next: cd ${target} && bun run dashboard`);
  console.log(`  global: bun run link — register this vault with Claude Code machine-wide (MCP + session hook)`);
  console.log(`  env: ${ensureVaultDirEnv(target).msg}`);
}

if (import.meta.main) runMain(main); // guarded so doctor.ts can import OPERATIONAL/writeMcpJson
