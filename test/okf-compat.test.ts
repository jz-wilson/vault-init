import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

/** Scaffold a fresh okf-preset vault into a tmp dir and return its path. */
function scaffoldOkf(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "okf-")), "v");
  const init = Bun.spawnSync(
    ["bun", join(ROOT, "src/init.ts"), "--yes", "--preset", "okf", "--dir", dir, "--no-examples"],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(init.exitCode).toBe(0);
  return dir;
}

test("okf preset scaffolds okf_compat: true into vault.config.json", () => {
  const dir = scaffoldOkf();
  const cfg = JSON.parse(readFileSync(join(dir, "vault.config.json"), "utf8"));
  expect(cfg.okf_compat).toBe(true);
});

test("okf_compat vault: unknown type + broken link warn and exit 0; --links also passes", () => {
  const dir = scaffoldOkf();
  writeFileSync(join(dir, "projects", "note.md"),
    `---\nupdated: 2026-07-06\ntags: [x]\ntype: weird-type\n---\n\n# N\n\n## Summary\nsee [[nope-missing]]\n\n## Notes\n- y\n\n## Related\n_(none yet)_\n`);

  const v = Bun.spawnSync(["bun", "scripts/validate-vault.ts"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const out = v.stdout.toString();
  expect(v.exitCode).toBe(0);
  expect(out).toContain("warning:");
  expect(out).toContain("'type' must be one of");
  expect(out).toContain("broken wiki-link");

  const links = Bun.spawnSync(["bun", "scripts/validate-vault.ts", "--links"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  expect(links.exitCode).toBe(0);
  expect(links.stdout.toString()).toContain("warning:");
});

test("non-okf vault stays strict: same note fails validation", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "okf-")), "v");
  Bun.spawnSync(["bun", join(ROOT, "src/init.ts"), "--yes", "--preset", "blank", "--dir", dir, "--no-examples"],
    { stdout: "pipe", stderr: "pipe" });
  writeFileSync(join(dir, "projects", "note.md"),
    `---\nupdated: 2026-07-06\ntags: [x]\ntype: weird-type\n---\n\n# N\n\n## Summary\nsee [[nope-missing]]\n\n## Notes\n- y\n\n## Related\n_(none yet)_\n`);
  const v = Bun.spawnSync(["bun", "scripts/validate-vault.ts"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  expect(v.exitCode).toBe(1);
});

test("okf_compat vault: index.ts writes bundle-root index.md with okf_version", () => {
  const dir = scaffoldOkf();
  writeFileSync(join(dir, "projects", "p.md"),
    `---\nupdated: 2026-07-06\ntags: [project]\ntype: project\ndescription: d\n---\n\n# P\n\n## Summary\nx\n\n## Notes\n- y\n\n## Related\n_(none yet)_\n`);
  const idx = Bun.spawnSync(["bun", "scripts/index.ts"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  expect(idx.exitCode).toBe(0);

  const root = join(dir, "index.md");
  expect(existsSync(root)).toBe(true);
  const text = readFileSync(root, "utf8");
  expect(text).toContain('okf_version: "0.1"');
  expect(text).toContain("- [projects](projects/index.md)");
  // per-dir index uses markdown links now
  expect(readFileSync(join(dir, "projects", "index.md"), "utf8")).toContain("[P](p.md)");
});
