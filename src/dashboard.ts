#!/usr/bin/env bun
// Headless agent-status dashboard (Q2). Mirrors the Dataview buckets, no Obsidian needed.
//   dashboard.ts            print to stdout
//   dashboard.ts --write    also write dashboard/status.txt
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { parseFrontmatter, extractField, splitLines } from "./frontmatter.ts";
import { findAgentLogs } from "./validate-logs.ts";

interface Log {
  agent: string; status: string; task: string; priority: string;
  date: string; updated: string; verified: string | null;
  error_class: string | null; completion_signal: string | null; cost: number | null;
}

function load(vaultRoot: string): Log[] {
  const out: Log[] = [];
  for (const path of findAgentLogs(vaultRoot)) {
    const parsed = parseFrontmatter(splitLines(readFileSync(path, "utf8")));
    if (!parsed) continue;
    const g = (k: string) => extractField(parsed.fm, k);
    const cost = g("cost_usd");
    out.push({
      agent: g("agent") ?? "?", status: g("status") ?? "?", task: g("task") ?? "",
      priority: g("priority") ?? "?", date: g("date") ?? "", updated: g("updated") ?? "",
      verified: g("verified"), error_class: g("error_class"), completion_signal: g("completion_signal"),
      cost: cost !== null ? Number(cost) : null,
    });
  }
  return out;
}

const PRIO: Record<string, number> = { high: 0, medium: 1, low: 2 };

function table(rows: string[][]): string {
  if (!rows.length) return "  (none)\n";
  const w = rows[0].map((_, c) => Math.max(...rows.map((r) => (r[c] ?? "").length)));
  return rows.map((r) => "  " + r.map((c, i) => (c ?? "").padEnd(w[i])).join("  ").trimEnd()).join("\n") + "\n";
}

function section(title: string, body: string): string {
  return `\n### ${title}\n${body}`;
}

export function render(logs: Log[], today: Date): string {
  const out: string[] = [`# Agent Status — ${today.toISOString().slice(0, 10)}`];
  const byPrio = (a: Log, b: Log) => (PRIO[a.priority] ?? 9) - (PRIO[b.priority] ?? 9);
  const head = ["agent", "task", "priority", "date"];
  const rowOf = (l: Log) => [l.agent, l.task.slice(0, 50), l.priority, l.date];

  const attn = logs.filter((l) => l.status === "awaiting-approval" || l.status === "blocked").sort(byPrio);
  out.push(section("🔔 Awaiting approval / Blocked", table([head, ...attn.map(rowOf)])));

  const active = logs.filter((l) => l.status === "active").sort(byPrio);
  out.push(section("Active", table([head, ...active.map(rowOf)])));

  const errs = logs.filter((l) => l.status === "error");
  out.push(section("Errors", table([["agent", "task", "error_class", "date"],
    ...errs.map((l) => [l.agent, l.task.slice(0, 50), l.error_class ?? "?", l.date])])));

  const completed = logs.filter((l) => l.status === "completed").sort((a, b) => b.date.localeCompare(a.date));
  out.push(section("Recently completed", table([["agent", "task", "date"],
    ...completed.slice(0, 15).map((l) => [l.agent, l.task.slice(0, 50), l.date])])));

  const unverified = completed.filter((l) => l.verified !== "true");
  out.push(section("✅ Completed but unverified", table([head.slice(0, 1).concat("task", "completion_signal", "date"),
    ...unverified.map((l) => [l.agent, l.task.slice(0, 50), l.completion_signal ?? "—", l.date])])));

  const cutoff = new Date(today.getTime() - 2 * 86400_000).toISOString().slice(0, 10);
  const stale = logs.filter((l) => l.status === "active" && l.updated && l.updated < cutoff)
    .sort((a, b) => a.updated.localeCompare(b.updated));
  out.push(section("⚠️ Stale active (>2d)", table([["agent", "task", "updated", "date"],
    ...stale.map((l) => [l.agent, l.task.slice(0, 50), l.updated, l.date])])));

  const agents = [...new Set(logs.map((l) => l.agent))].sort();
  const rollup = agents.map((a) => {
    const rs = logs.filter((l) => l.agent === a);
    const cost = rs.reduce((s, l) => s + (l.cost ?? 0), 0);
    return [a, String(rs.length),
      String(rs.filter((l) => l.status === "active").length),
      String(rs.filter((l) => l.status === "error").length),
      String(rs.filter((l) => l.status === "awaiting-approval" || l.status === "blocked").length),
      cost ? `$${cost.toFixed(2)}` : "—",
      rs.map((l) => l.date).sort().at(-1) ?? "—"];
  });
  out.push(section("Per-agent rollup", table([["agent", "total", "active", "errors", "needs-attn", "cost", "last"], ...rollup])));

  return out.join("\n") + "\n";
}

function main() {
  const vaultRoot = resolve(import.meta.dir, "..");
  const text = render(load(vaultRoot), new Date());
  process.stdout.write(text);
  if (process.argv.includes("--write")) {
    const dest = join(vaultRoot, "dashboard", "status.txt");
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text, "utf8");
    console.log(`\n(written → ${relative(vaultRoot, dest)})`);
  }
}

if (import.meta.main) main();
