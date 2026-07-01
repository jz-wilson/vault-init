// vault.config.json loader + derived layout. The ONE place dir names are configurable.
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

// Types always valid regardless of config (the fixed spine + universal note kinds).
const UNIVERSAL_TYPES = ["agent-log", "handoff", "concept", "reference", "glossary", "personal"];

// Scaffolding dirs every vault has, independent of preset.
const SCAFFOLD_DIRS = ["agents", "dashboard", "handoffs"];

export interface VaultConfig {
  name: string;
  semantic_dirs: Record<string, string>; // type -> dir; deduped notes, distillation target
  episodic_dirs: Record<string, string>; // type -> dir; monthly dated-bullet logs
  extra_dirs: string[]; // freeform spokes, not type-bound
}

export interface Derived {
  cfg: VaultConfig;
  TYPE_DIRS: Record<string, string>; // semantic + episodic merged
  SEMANTIC_DIRS: Record<string, string>;
  EPISODIC_DIRS: Record<string, string>;
  VALID_TYPES: Set<string>;
  ALL_DIRS: string[];
}

/** Reject any configured dir value that resolves outside vaultRoot (path traversal via vault.config.json). */
function assertInsideVault(vaultRoot: string, label: string, dir: string): void {
  const full = resolve(vaultRoot, dir);
  if (full !== vaultRoot && !full.startsWith(vaultRoot + sep))
    throw new Error(`vault.config.json: ${label} '${dir}' escapes the vault root`);
}

export function loadConfig(vaultRoot: string): VaultConfig {
  const raw = JSON.parse(readFileSync(join(vaultRoot, "vault.config.json"), "utf8"));
  const semantic_dirs: Record<string, string> = raw.semantic_dirs ?? {};
  const episodic_dirs: Record<string, string> = raw.episodic_dirs ?? {};
  const extra_dirs: string[] = raw.extra_dirs ?? [];

  for (const [type, dir] of Object.entries(semantic_dirs)) assertInsideVault(vaultRoot, `semantic_dirs.${type}`, dir);
  for (const [type, dir] of Object.entries(episodic_dirs)) assertInsideVault(vaultRoot, `episodic_dirs.${type}`, dir);
  for (const dir of extra_dirs) assertInsideVault(vaultRoot, "extra_dirs", dir);

  return { name: raw.name ?? "vault", semantic_dirs, episodic_dirs, extra_dirs };
}

export function derive(cfg: VaultConfig): Derived {
  const TYPE_DIRS = { ...cfg.semantic_dirs, ...cfg.episodic_dirs };
  const VALID_TYPES = new Set<string>([...Object.keys(TYPE_DIRS), ...UNIVERSAL_TYPES]);
  const ALL_DIRS = [
    ...SCAFFOLD_DIRS,
    ...Object.values(cfg.semantic_dirs),
    ...Object.values(cfg.episodic_dirs),
    ...cfg.extra_dirs,
  ];
  return {
    cfg,
    TYPE_DIRS,
    SEMANTIC_DIRS: cfg.semantic_dirs,
    EPISODIC_DIRS: cfg.episodic_dirs,
    VALID_TYPES,
    ALL_DIRS,
  };
}

/** Convenience for operational scripts living in <vault>/scripts/. */
export function loadFromScript(importMetaDir: string): Derived {
  const vaultRoot = resolve(importMetaDir, "..");
  return derive(loadConfig(vaultRoot));
}
