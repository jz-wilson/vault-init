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

const CONTROL_CHARS_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;
/** Strip C0/C1 control chars (incl. ESC) — frontmatter fields render straight into ANSI
 *  table output, and an unvalidated field is an escape-sequence injection vector. */
const sanitize = (s: string) => s.replace(CONTROL_CHARS_RE, "");

function load(vaultRoot: string): Log[] {
  const out: Log[] = [];
  for (const path of findAgentLogs(vaultRoot)) {
    const parsed = parseFrontmatter(splitLines(readFileSync(path, "utf8")));
    if (!parsed) continue;
    const g = (k: string) => {
      const v = extractField(parsed.fm, k);
      return v === null ? null : sanitize(v);
    };
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
const ANSI: Record<string, string> = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", cyan: "\x1b[36m" };

/** Box-drawing table. `accent` colors the border + header of tables that need attention (errors, stale, etc). */
function table(rows: string[][], color: boolean, accent?: keyof typeof ANSI): string {
  const wrap = (s: string, code: keyof typeof ANSI) => (color ? `${ANSI[code]}${s}${ANSI.reset}` : s);
  if (rows.length <= 1) return "  " + wrap("(none)", "dim") + "\n";

  const w = rows[0].map((_, c) => Math.max(...rows.map((r) => (r[c] ?? "").length)));
  const border = accent ?? "dim";
  const rule = (l: string, m: string, r: string) => wrap(l + w.map((n) => "─".repeat(n + 2)).join(m) + r, border);
  const row = (r: string[], bold: boolean) => {
    const cells = "│" + r.map((c, i) => ` ${(c ?? "").padEnd(w[i])} `).join("│") + "│";
    return wrap(cells, bold ? "bold" : border === "dim" ? "reset" : border);
  };

  return [
    rule("┌", "┬", "┐"),
    row(rows[0], true),
    rule("├", "┼", "┤"),
    ...rows.slice(1).map((r) => row(r, false)),
    rule("└", "┴", "┘"),
  ].map((l) => "  " + l).join("\n") + "\n";
}

function section(title: string, body: string, color: boolean): string {
  const heading = color ? `${ANSI.bold}${ANSI.cyan}### ${title}${ANSI.reset}` : `### ${title}`;
  return `\n${heading}\n${body}`;
}

export function render(logs: Log[], today: Date, color = false): string {
  const out: string[] = [`# Agent Status — ${today.toISOString().slice(0, 10)}`];
  const byPrio = (a: Log, b: Log) => (PRIO[a.priority] ?? 9) - (PRIO[b.priority] ?? 9);
  const head = ["agent", "task", "priority", "date"];
  const rowOf = (l: Log) => [l.agent, l.task.slice(0, 50), l.priority, l.date];

  const attn = logs.filter((l) => l.status === "awaiting-approval" || l.status === "blocked").sort(byPrio);
  out.push(section("🔔 Awaiting approval / Blocked", table([head, ...attn.map(rowOf)], color, attn.length ? "yellow" : undefined), color));

  const active = logs.filter((l) => l.status === "active").sort(byPrio);
  out.push(section("Active", table([head, ...active.map(rowOf)], color), color));

  const errs = logs.filter((l) => l.status === "error");
  out.push(section("Errors", table([["agent", "task", "error_class", "date"],
    ...errs.map((l) => [l.agent, l.task.slice(0, 50), l.error_class ?? "?", l.date])], color, errs.length ? "red" : undefined), color));

  const completed = logs.filter((l) => l.status === "completed").sort((a, b) => b.date.localeCompare(a.date));
  out.push(section("Recently completed", table([["agent", "task", "date"],
    ...completed.slice(0, 15).map((l) => [l.agent, l.task.slice(0, 50), l.date])], color, completed.length ? "green" : undefined), color));

  const unverified = completed.filter((l) => l.verified !== "true");
  out.push(section("✅ Completed but unverified", table([head.slice(0, 1).concat("task", "completion_signal", "date"),
    ...unverified.map((l) => [l.agent, l.task.slice(0, 50), l.completion_signal ?? "—", l.date])], color), color));

  const cutoff = new Date(today.getTime() - 2 * 86400_000).toISOString().slice(0, 10);
  const stale = logs.filter((l) => l.status === "active" && l.updated && l.updated < cutoff)
    .sort((a, b) => a.updated.localeCompare(b.updated));
  out.push(section("⚠️ Stale active (>2d)", table([["agent", "task", "updated", "date"],
    ...stale.map((l) => [l.agent, l.task.slice(0, 50), l.updated, l.date])], color, stale.length ? "yellow" : undefined), color));

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
  out.push(section("Per-agent rollup", table([["agent", "total", "active", "errors", "needs-attn", "cost", "last"], ...rollup], color), color));

  return out.join("\n") + "\n";
}

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function renderOnce(vaultRoot: string, clear: boolean): void {
  const logs = load(vaultRoot);
  const today = new Date();
  if (clear) process.stdout.write("\x1b[2J\x1b[H"); // ANSI: clear screen + move cursor home
  process.stdout.write(render(logs, today, useColor));
  if (process.argv.includes("--write")) {
    const dest = join(vaultRoot, "dashboard", "status.txt");
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, render(logs, today, false), "utf8"); // plain text — no ANSI codes in the file
    if (!clear) console.log(`\n(written → ${relative(vaultRoot, dest)})`);
  }
}

function main() {
  const vaultRoot = resolve(import.meta.dir, "..");
  const watchIdx = process.argv.indexOf("--watch");
  let intervalSec = 0;
  if (watchIdx !== -1) {
    const raw = process.argv[watchIdx + 1];
    if (raw === undefined) {
      intervalSec = 5;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`error: --watch value must be a positive number of seconds, got '${raw}'`);
        process.exit(2);
      }
      intervalSec = n;
    }
  }

  renderOnce(vaultRoot, intervalSec > 0);
  if (intervalSec > 0) setInterval(() => renderOnce(vaultRoot, true), intervalSec * 1000);
}

if (import.meta.main) main();
