// Scaffold contract: vault is always a git repo with an initial commit, and nightly
// runs belong to the vault's machine — scripts/nightly.sh, not a CI workflow.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, statSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ensureVaultDirEnv } from "../src/init.ts";

const dir = join(tmpdir(), `vault-init-scaffold-test-${process.pid}`);

beforeAll(() => {
  rmSync(dir, { recursive: true, force: true });
  // VAULT_DIR set so scaffold's ensureVaultDirEnv doesn't touch the real shell profile
  const r = Bun.spawnSync(["bun", "src/init.ts", "--yes", "--dir", dir, "--preset", "blank"], {
    env: { ...process.env, VAULT_DIR: dir },
  });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("scaffold leaves a git repo with an initial commit", () => {
  expect(existsSync(join(dir, ".git"))).toBe(true);
  const head = Bun.spawnSync(["git", "rev-parse", "-q", "--verify", "HEAD"], { cwd: dir });
  expect(head.exitCode).toBe(0);
  const status = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: dir });
  expect(status.stdout.toString().trim()).toBe(""); // everything committed
});

test("nightly is a local executable runner, not a CI workflow", () => {
  const runner = join(dir, "scripts", "nightly.sh");
  expect(existsSync(runner)).toBe(true);
  expect(statSync(runner).mode & 0o100).toBe(0o100); // owner-executable
  expect(existsSync(join(dir, ".github", "workflows", "nightly.yml"))).toBe(false);
});

test("nightly.sh runs clean on a fresh scaffold", () => {
  const r = Bun.spawnSync([join(dir, "scripts", "nightly.sh")], { cwd: dir });
  expect(r.exitCode).toBe(0);
});

test("CLAUDE.md is scaffolded at vault root and bridges to AGENTS.md", () => {
  const claudeMd = readFileSync(join(dir, "CLAUDE.md"), "utf8");
  expect(claudeMd).toContain("@AGENTS.md");
});

test(".claude/settings.json wires the SessionStart snapshot hook", () => {
  const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
  expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("snapshot.ts");
});

test(".mcp.json registers the vault MCP server pinned to this package version", () => {
  const mcp = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"));
  const args = mcp.mcpServers.vault.args;
  expect(args.some((a: string) => a.startsWith("vault-init@"))).toBe(true);
  expect(args).toContain(resolve(dir));
});

test("ensureVaultDirEnv persists $VAULT_DIR into the shell profile when unset (interactive)", () => {
  const home = join(tmpdir(), `vault-init-home-${process.pid}`);
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  const saved = { HOME: process.env.HOME, SHELL: process.env.SHELL, VAULT_DIR: process.env.VAULT_DIR };
  process.env.HOME = home;
  process.env.SHELL = "/bin/zsh";
  delete process.env.VAULT_DIR;
  try {
    const first = ensureVaultDirEnv(dir, false, true);
    expect(first.changed).toBe(true);
    expect(readFileSync(join(home, ".zshrc"), "utf8")).toContain(`export VAULT_DIR="${resolve(dir)}"`);
    // profile already carries the export: no duplicate
    const second = ensureVaultDirEnv(dir, false, true);
    expect(second.changed).toBe(false);
    expect(readFileSync(join(home, ".zshrc"), "utf8").match(/VAULT_DIR=/g)?.length).toBe(1);
  } finally {
    process.env.HOME = saved.HOME;
    process.env.SHELL = saved.SHELL;
    if (saved.VAULT_DIR === undefined) delete process.env.VAULT_DIR;
    else process.env.VAULT_DIR = saved.VAULT_DIR;
    rmSync(home, { recursive: true, force: true });
  }
});

test("TTY gate: non-interactive scaffold never writes the shell profile", () => {
  const home = join(tmpdir(), `vault-init-notty-${process.pid}`);
  const vdir = join(tmpdir(), `vault-init-nottyv-${process.pid}`);
  rmSync(home, { recursive: true, force: true });
  rmSync(vdir, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, SHELL: "/bin/zsh" };
  delete env.VAULT_DIR;
  // spawned with piped stdout → no TTY → profile untouched even without VAULT_DIR pinned
  const r = Bun.spawnSync(["bun", "src/init.ts", "--yes", "--dir", vdir, "--preset", "blank"], { env });
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString()).toContain("non-interactive shell");
  expect(existsSync(join(home, ".zshrc"))).toBe(false);
  rmSync(home, { recursive: true, force: true });
  rmSync(vdir, { recursive: true, force: true });
});
