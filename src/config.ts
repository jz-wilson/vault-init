// vault.config.json loader + derived layout. The ONE place dir names are configurable.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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

/** Walk up from a starting dir until vault.config.json is found; fallback to parent-of-start. */
export function findVaultRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "vault.config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(resolve(start));
}

export function loadConfig(vaultRoot: string): VaultConfig {
  const raw = JSON.parse(readFileSync(join(vaultRoot, "vault.config.json"), "utf8"));
  return {
    name: raw.name ?? "vault",
    semantic_dirs: raw.semantic_dirs ?? {},
    episodic_dirs: raw.episodic_dirs ?? {},
    extra_dirs: raw.extra_dirs ?? [],
  };
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
