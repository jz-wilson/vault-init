// link.ts contract: global Claude Code wiring is an idempotent merge — existing user
// settings/CLAUDE.md content is preserved, repeat runs change nothing.
import { test, expect, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeSessionStartHook, upsertPointerBlock, applyGlobalConfig } from "../src/link.ts";

const base = join(tmpdir(), `vault-init-link-test-${process.pid}`);
afterAll(() => rmSync(base, { recursive: true, force: true }));

test("mergeSessionStartHook adds hook once and preserves existing config", () => {
  const settings: any = { permissions: { allow: ["Bash"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] } };
  const first = mergeSessionStartHook(settings, "bun /v/scripts/snapshot.ts");
  expect(first.changed).toBe(true);
  expect(first.settings.permissions.allow).toEqual(["Bash"]); // untouched
  expect(first.settings.hooks.Stop.length).toBe(1); // untouched
  expect(first.settings.hooks.SessionStart[0].hooks[0].command).toBe("bun /v/scripts/snapshot.ts");
  const second = mergeSessionStartHook(first.settings, "bun /v/scripts/snapshot.ts");
  expect(second.changed).toBe(false);
  expect(second.settings.hooks.SessionStart.length).toBe(1);
});

test("upsertPointerBlock appends, is idempotent, and replaces a stale block", () => {
  const a = upsertPointerBlock("# My global rules\n", "work", "## Vault: work\nold path");
  expect(a.changed).toBe(true);
  expect(a.md).toContain("# My global rules"); // existing content preserved
  expect(a.md).toContain("<!-- vault-init:link:work -->");
  const b = upsertPointerBlock(a.md, "work", "## Vault: work\nold path");
  expect(b.changed).toBe(false);
  const c = upsertPointerBlock(b.md, "work", "## Vault: work\nnew path");
  expect(c.changed).toBe(true);
  expect(c.md).toContain("new path");
  expect(c.md).not.toContain("old path");
  expect(c.md.match(/vault-init:link:work/g)?.length).toBe(2); // one begin + one end, not duplicated
});

test("applyGlobalConfig writes settings.json + CLAUDE.md into cfgDir and is idempotent", () => {
  const cfgDir = join(base, "claude-cfg");
  const vault = join(base, "vault");
  mkdirSync(vault, { recursive: true });
  applyGlobalConfig(cfgDir, vault, "work", false);
  const settings = JSON.parse(readFileSync(join(cfgDir, "settings.json"), "utf8"));
  expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(`bun ${join(vault, "scripts", "snapshot.ts")}`);
  const md = readFileSync(join(cfgDir, "CLAUDE.md"), "utf8");
  expect(md).toContain(`Vault: work`);
  expect(md).toContain(vault);
  const log = applyGlobalConfig(cfgDir, vault, "work", false); // second run: no-op
  expect(log.join("\n")).toContain("already present");
  expect(log.join("\n")).toContain("already current");
});

test("applyGlobalConfig dry-run touches nothing", () => {
  const cfgDir = join(base, "dry-cfg");
  const log = applyGlobalConfig(cfgDir, join(base, "vault"), "work", true);
  expect(existsSync(cfgDir)).toBe(false);
  expect(log.join("\n")).toContain("would add");
});
