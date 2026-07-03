// vault.config.json loader + derived layout. The ONE place dir names are configurable.
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

// Types always valid regardless of config (the fixed spine + universal note kinds).
const UNIVERSAL_TYPES = ["agent-log", "handoff", "concept", "reference", "glossary", "personal", "skill"];

// Scaffolding dirs every vault has, independent of preset.
const SCAFFOLD_DIRS = ["agents", "dashboard", "handoffs"];

export interface SnapshotConfig {
  files: string[]; // vault-root-relative paths, each guarded against traversal
  budget_tokens: number;
}

export interface VaultConfig {
  name: string;
  semantic_dirs: Record<string, string>; // type -> dir; deduped notes, distillation target
  episodic_dirs: Record<string, string>; // type -> dir; monthly dated-bullet logs
  extra_dirs: string[]; // freeform spokes, not type-bound
  index_style?: Record<string, string>; // dir name -> rendering style, e.g. "alphabetical"
  snapshot?: SnapshotConfig; // pre-read file set + token budget for agent context priming
}

export interface Derived {
  cfg: VaultConfig;
  TYPE_DIRS: Record<string, string>; // semantic + episodic merged
  SEMANTIC_DIRS: Record<string, string>;
  EPISODIC_DIRS: Record<string, string>;
  VALID_TYPES: Set<string>;
  ALL_DIRS: string[];
}

/** resolve() that refuses to escape base — the canonical traversal guard for anything
 *  user-supplied that becomes a path (config dirs, CLI dir args, snapshot file lists). */
export function resolveInside(base: string, rel: string, label = "path"): string {
  const full = resolve(base, rel);
  if (full !== base && !full.startsWith(base + sep))
    throw new Error(`${label} '${rel}' escapes the vault root`);
  return full;
}

/** Reject any configured dir value that resolves outside vaultRoot (path traversal via vault.config.json). */
function assertInsideVault(vaultRoot: string, label: string, dir: string): void {
  resolveInside(vaultRoot, dir, `vault.config.json: ${label}`);
}

export function loadConfig(vaultRoot: string): VaultConfig {
  const raw = JSON.parse(readFileSync(join(vaultRoot, "vault.config.json"), "utf8"));
  const semantic_dirs: Record<string, string> = raw.semantic_dirs ?? {};
  const episodic_dirs: Record<string, string> = raw.episodic_dirs ?? {};
  const extra_dirs: string[] = raw.extra_dirs ?? [];
  const index_style: Record<string, string> | undefined = raw.index_style ?? undefined;
  const snapshot: SnapshotConfig | undefined = raw.snapshot ?? undefined;

  for (const [type, dir] of Object.entries(semantic_dirs)) assertInsideVault(vaultRoot, `semantic_dirs.${type}`, dir);
  for (const [type, dir] of Object.entries(episodic_dirs)) assertInsideVault(vaultRoot, `episodic_dirs.${type}`, dir);
  for (const dir of extra_dirs) assertInsideVault(vaultRoot, "extra_dirs", dir);
  if (snapshot) for (const f of snapshot.files ?? []) assertInsideVault(vaultRoot, "snapshot.files", f);

  const cfg: VaultConfig = { name: raw.name ?? "vault", semantic_dirs, episodic_dirs, extra_dirs };
  if (index_style) cfg.index_style = index_style;
  if (snapshot) cfg.snapshot = snapshot;
  return cfg;
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
