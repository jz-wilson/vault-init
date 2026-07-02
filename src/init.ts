#!/usr/bin/env bun
// vault-init — scaffold an agent-coordination + memory vault. Published bunx bin.
// Interactive:     bunx vault-init
// Non-interactive: bunx vault-init --yes --preset sre --name work --dir ./work-vault
import { mkdirSync, writeFileSync, copyFileSync, existsSync, chmodSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join, dirname, sep } from "node:path";
import { homedir } from "node:os";

const SRC = import.meta.dir; // package/src — holds the operational .ts to vendor
const PKG = resolve(SRC, ".."); // package root — holds templates/
const TEMPLATES = join(PKG, "templates");

const OPERATIONAL = [
  "frontmatter.ts", "config.ts", "validate-logs.ts", "validate-vault.ts",
  "capture.ts", "consolidate.ts", "dashboard.ts",
  "index.ts", "snapshot.ts", "search.ts", "nightly.ts", "log-turn.ts",
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
  p.outro(`Done. Read SEED-PROMPT.md to populate it with an AI.`);

  const switchNow = await p.confirm({ message: `Switch to ${dir} now?`, initialValue: true });
  if (!p.isCancel(switchNow) && switchNow) {
    console.log(`(dropping into a shell in ${target} — exit to return)`);
    Bun.spawnSync([process.env.SHELL || "bash"], { cwd: target, stdio: ["inherit", "inherit", "inherit"] });
  }
}

function scaffold(target: string, config: ReturnType<typeof buildConfig>, examples: boolean, force = false) {
  if (existsSync(target) && readdirSync(target).length > 0 && !force)
    throw new Error(`target directory '${target}' already exists and is not empty — pass --force to overwrite`);

  const allDirs = [
    "agents", "dashboard", "handoffs", "scripts", ".githooks", ".forgejo/workflows",
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
    },
  }, null, 2) + "\n");

  // copy static templates (hooks, ci, docs, seed prompt)
  copyTpl(join(TEMPLATES, "githooks", "pre-commit"), join(target, ".githooks", "pre-commit"));
  chmodSync(join(target, ".githooks", "pre-commit"), 0o755);
  copyTpl(join(TEMPLATES, "ci", "validate.yml"), join(target, ".forgejo", "workflows", "validate.yml"));
  copyTpl(join(TEMPLATES, "ci", "nightly.yml"), join(target, ".forgejo", "workflows", "nightly.yml"));
  // hook-wiring docs ship next to the scripts they wire; scripts/ is validator-skipped
  for (const h of ["session-start-snapshot.md", "log-turn-hook.md", "nightly-automation.md"])
    copyTpl(join(TEMPLATES, "hooks", h), join(target, "scripts", "hooks", h));
  for (const doc of ["_format.md", "AGENTS.md", "README.md", "IDENTITY.md", "ALWAYS.md", "NEVER.md"]) copyTpl(join(TEMPLATES, "docs", doc), join(target, doc));
  copyTpl(join(TEMPLATES, "SEED-PROMPT.md"), join(target, "SEED-PROMPT.md"));
  writeFileSync(join(target, ".gitignore"), "handoffs/\ndashboard/status.txt\n");

  if (examples) writeExamples(target, config);

  // git doesn't track empty dirs — keep any scaffolded dir that ended up empty
  for (const d of allDirs) {
    const full = safeJoin(target, d);
    if (existsSync(full) && readdirSync(full).length === 0) writeFileSync(join(full, ".gitkeep"), "");
  }

  // git init + hooks path
  if (!existsSync(join(target, ".git"))) {
    Bun.spawnSync(["git", "init", "-q"], { cwd: target });
  }
  Bun.spawnSync(["git", "config", "core.hooksPath", ".githooks"], { cwd: target });
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
    writeFileSync(join(target, semDir, "example.md"),
      `---\nupdated: ${today}\ntags: [${semType}]\ntype: ${semType}\n---\n\n# Example\n\n## Summary\nExample ${semType} note — delete me.\n\n## Notes\n- ${today}: scaffolded by vault-init\n\n## Related\n_(none yet)_\n`);
  }
  const logDir = join(target, "agents", "example-agent", "reports");
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, `${today}-example-task.md`),
    `---\nupdated: ${today}\ntags: [agent-log]\ntype: agent-log\nagent: "example-agent"\nstatus: completed\ntask: "scaffold demo log"\npriority: low\ndate: ${today}\nverified: false\ncompletion_signal: true\n---\n\n# Example Task\n\n## Summary\nDemo agent log — delete me.\n\n## Notes\n- Shows the schema the dashboard and validator expect.\n\n## Related\n_(none yet)_\n`);
}

async function main() {
  const f = parseFlags(process.argv.slice(2));
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
  console.log(`  next: cd ${target} && bun run dashboard`);
}

main();
