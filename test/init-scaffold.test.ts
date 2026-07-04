// Scaffold contract: vault is always a git repo with an initial commit, and nightly
// runs belong to the vault's machine — scripts/nightly.sh, not a CI workflow.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = join(tmpdir(), `vault-init-scaffold-test-${process.pid}`);

beforeAll(() => {
  rmSync(dir, { recursive: true, force: true });
  const r = Bun.spawnSync(["bun", "src/init.ts", "--yes", "--dir", dir, "--preset", "blank"]);
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
