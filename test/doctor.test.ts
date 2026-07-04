// doctor contract: finds and repairs a broken vault setup (missing vendored scripts,
// missing Claude Code integration files, unlinked state), and is a no-op on a healthy one.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = join(tmpdir(), `vault-init-doctor-test-${process.pid}`);
const cfgDir = join(tmpdir(), `vault-init-doctor-cfg-${process.pid}`);
const repo = join(import.meta.dir, "..");

// VAULT_DIR pinned in every spawn so ensureVaultDirEnv never touches the real shell profile
function doctor(...extra: string[]) {
  const r = Bun.spawnSync(["bun", "src/init.ts", "doctor", "--dir", dir, "--skip-mcp", ...extra], {
    cwd: repo,
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir, VAULT_DIR: dir },
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

beforeAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(cfgDir, { recursive: true, force: true });
  const r = Bun.spawnSync(["bun", "src/init.ts", "--yes", "--dir", dir, "--preset", "blank"], {
    cwd: repo,
    env: { ...process.env, VAULT_DIR: dir },
  });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  // break the vault: missing vendored script + missing integration files
  rmSync(join(dir, "scripts", "capture.ts"));
  rmSync(join(dir, "CLAUDE.md"));
  rmSync(join(dir, ".mcp.json"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(cfgDir, { recursive: true, force: true });
});

test("doctor is report-only by default and points at --fix", () => {
  const { code, out } = doctor();
  expect(code).toBe(0);
  expect(out).toContain("would fix");
  expect(out).toContain("--fix to apply");
  expect(existsSync(join(dir, "scripts", "capture.ts"))).toBe(false); // nothing written
});

test("doctor --fix repairs missing scripts, integration files, and links the vault", () => {
  const { code, out } = doctor("--fix");
  expect(code).toBe(0);
  expect(out).toContain("re-vendored missing scripts/capture.ts");
  expect(existsSync(join(dir, "scripts", "capture.ts"))).toBe(true);
  expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
  expect(JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8")).mcpServers.vault).toBeDefined();
  // linked into the scratch config dir
  const settings = JSON.parse(readFileSync(join(cfgDir, "settings.json"), "utf8"));
  expect(JSON.stringify(settings.hooks.SessionStart)).toContain(join(dir, "scripts", "snapshot.ts"));
});

test("doctor --fix is a no-op on a healthy vault", () => {
  const { code, out } = doctor("--fix");
  expect(code).toBe(0);
  expect(out).toContain("0 fixed");
  expect(out).toContain("linked machine-wide");
  expect(out).toContain("$VAULT_DIR points at this vault");
});

test("doctor refuses a non-vault dir with a clear error", () => {
  const r = Bun.spawnSync(["bun", "src/init.ts", "doctor", "--dir", "/tmp/definitely-not-a-vault-xyz"], { cwd: repo });
  expect(r.exitCode).toBe(1);
  expect(r.stderr.toString()).toContain("no vault at");
});
