// link.ts contract: global Claude Code wiring is an idempotent merge — existing user
// settings/CLAUDE.md content is preserved, repeat runs change nothing.
import { test, expect, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeSessionStartHook, upsertPointerBlock, applyGlobalConfig, hasSnapshotHook, isLinked, isPrimaryVault, vaultKey } from "../src/link.ts";

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

test("isPrimaryVault: unset VAULT_DIR = primary, match = primary, mismatch = not", () => {
  const prev = process.env.VAULT_DIR;
  try {
    delete process.env.VAULT_DIR;
    expect(isPrimaryVault("/v/a")).toBe(true);
    process.env.VAULT_DIR = "/v/a";
    expect(isPrimaryVault("/v/a")).toBe(true);
    process.env.VAULT_DIR = "/v/b";
    expect(isPrimaryVault("/v/a")).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.VAULT_DIR;
    else process.env.VAULT_DIR = prev;
  }
});

test("applyGlobalConfig non-primary: pointer written, snapshot hook skipped, still linked", () => {
  const cfgDir = join(base, "nonprimary-cfg");
  const vault = join(base, "vault2");
  mkdirSync(vault, { recursive: true });
  const log = applyGlobalConfig(cfgDir, vault, "biz", false, false);
  expect(log.join("\n")).toContain("skipped SessionStart snapshot hook");
  expect(existsSync(join(cfgDir, "settings.json"))).toBe(false); // hook surface never written
  expect(hasSnapshotHook(cfgDir, vault)).toBe(false);
  expect(isLinked(cfgDir, vault)).toBe(true); // CLAUDE.md pointer block alone counts as linked
});

test("applyGlobalConfig dry-run touches nothing", () => {
  const cfgDir = join(base, "dry-cfg");
  const log = applyGlobalConfig(cfgDir, join(base, "vault"), "work", true);
  expect(existsSync(cfgDir)).toBe(false);
  expect(log.join("\n")).toContain("would add");
});

test("applyGlobalConfig: two vaults sharing a name don't clobber each other's pointer block", () => {
  const cfgDir = join(base, "collision-cfg");
  const vaultA = join(base, "collision-vault-a");
  const vaultB = join(base, "collision-vault-b");
  mkdirSync(vaultA, { recursive: true });
  mkdirSync(vaultB, { recursive: true });
  applyGlobalConfig(cfgDir, vaultA, "work", false);
  applyGlobalConfig(cfgDir, vaultB, "work", false);
  const md = readFileSync(join(cfgDir, "CLAUDE.md"), "utf8");
  expect(md).toContain(vaultA);
  expect(md).toContain(vaultB);
  expect(md.match(/## Vault: work/g)?.length).toBe(2);
  expect(md).toContain(`<!-- vault-init:link:${vaultKey("work", vaultA)} -->`);
  expect(md).toContain(`<!-- vault-init:link:${vaultKey("work", vaultB)} -->`);
});

test("applyGlobalConfig: migrates a legacy un-hashed block to the keyed format without duplicating or touching other vaults' legacy blocks", () => {
  const cfgDir = join(base, "migrate-cfg");
  const vault = join(base, "migrate-vault");
  const otherVault = join(base, "migrate-other-vault");
  mkdirSync(cfgDir, { recursive: true });
  mkdirSync(vault, { recursive: true });
  const legacy = upsertPointerBlock(
    upsertPointerBlock("# rules\n", "biz", `## Vault: biz\nlegacy body \`${otherVault}\``).md,
    "biz",
    `## Vault: biz\nlegacy body \`${vault}\``,
  );
  // simulate: this vault's legacy block was overwritten by a same-named other vault's legacy
  // link (the exact collision bug) — leave the surviving legacy block pointing at `vault`
  const mdPath = join(cfgDir, "CLAUDE.md");
  writeFileSync(mdPath, legacy.md);

  const log = applyGlobalConfig(cfgDir, vault, "biz", false);
  const md = readFileSync(mdPath, "utf8");
  expect(md).not.toContain("<!-- vault-init:link:biz -->"); // legacy marker gone
  expect(md).not.toContain("legacy body"); // stale legacy content removed, not just re-keyed alongside
  expect(md.match(/## Vault: biz/g)?.length).toBe(1); // not duplicated
  expect(md).toContain(`<!-- vault-init:link:${vaultKey("biz", vault)} -->`);
  expect(log.join("\n")).toContain("upserted"); // migration counted as a change

  const second = applyGlobalConfig(cfgDir, vault, "biz", false); // idempotent after migration
  expect(second.join("\n")).toContain("already current");
});
