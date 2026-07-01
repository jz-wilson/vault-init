// Shared frontmatter parsing primitives. Port of vault_fm.py.
// Operates on arrays of lines WITHOUT trailing newline chars.
import { readFileSync } from "node:fs";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FILE_URL_RE = /file:\/\//;
const MNT_PATH_RE = /(?:^|[\s"'(])(\/mnt\/)/;
const WIN_PATH_RE = /(?:^|[\s"'(])([Cc][:/\\])/;
const INLINE_CODE_RE = /`[^`]*`/g;
const FENCE_RE = /^(`{3,}|~{3,})/;

export interface ParsedFm {
  fm: string[]; // frontmatter lines (between the --- delimiters)
  body: string[]; // body lines (after closing ---)
  closeLineNo: number; // 1-based file line of the closing ---
}

/** Split text into lines without newline chars, mirroring Python splitlines() (handles CRLF). */
export function splitLines(text: string): string[] {
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** True if `val` (already DATE_RE-matched) is a real calendar date, not a JS-normalized overflow (e.g. 2026-02-30). */
export function isValidCalendarDate(val: string): boolean {
  const [y, m, day] = val.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, day));
  return d.getUTCFullYear() === y && d.getUTCMonth() === m - 1 && d.getUTCDate() === day;
}

export function parseFrontmatter(lines: string[]): ParsedFm | null {
  if (lines.length === 0 || lines[0] !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      return { fm: lines.slice(1, i), body: lines.slice(i + 1), closeLineNo: i + 1 };
    }
  }
  return null;
}

export function extractField(fm: string[], field: string): string | null {
  const prefix = field + ":";
  for (const line of fm) {
    const s = line.trim();
    if (s.startsWith(prefix)) {
      let val = s.slice(prefix.length).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      return val;
    }
  }
  return null;
}

export function fmLineNo(fm: string[], field: string, fmStart = 2): number {
  const prefix = field + ":";
  for (let i = 0; i < fm.length; i++) {
    if (fm[i].trim().startsWith(prefix)) return fmStart + i;
  }
  return fmStart;
}

/** Extract tags list, handling inline [a, b] and block (- a) forms. null if absent. */
export function extractTagsList(fm: string[]): string[] | null {
  const prefix = "tags:";
  for (let i = 0; i < fm.length; i++) {
    const stripped = fm[i].trim();
    if (!stripped.startsWith(prefix)) continue;
    const inlineVal = stripped.slice(prefix.length).trim();
    if (inlineVal) {
      if (inlineVal.startsWith("[") && inlineVal.endsWith("]")) {
        const inner = inlineVal.slice(1, -1);
        return inner
          .split(",")
          .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
          .filter((t) => t.length > 0);
      }
      return [inlineVal];
    }
    // block list form
    const tags: string[] = [];
    for (let j = i + 1; j < fm.length; j++) {
      const sub = fm[j].trim();
      if (sub.startsWith("- ")) tags.push(sub.slice(2).trim());
      else if (sub === "" || sub.includes(":")) break;
    }
    return tags.length ? tags : null;
  }
  return null;
}

export type LineError = [number, string];

export interface NoteShape {
  fm: string[];
  body: string[];
  closeLineNo: number;
  fmStart: number;
}

/** Readable/trailing-newline/frontmatter-delimiter check shared by validate-logs.ts and
 *  validate-vault.ts. `shape` is null when a fatal shape error means parsing can't continue —
 *  `errors` is always populated in that case. */
export function validateCommonNoteShape(path: string): { errors: LineError[]; shape: NoteShape | null } {
  const errors: LineError[] = [];
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (e) {
    errors.push([1, `cannot read file: ${e}`]);
    return { errors, shape: null };
  }

  const text = raw.toString("utf8");
  if (!text.endsWith("\n")) errors.push([0, "file does not end with a newline"]);
  else if (text.endsWith("\n\n")) errors.push([0, "file has trailing blank lines (must end with exactly one newline)"]);

  const nlines = splitLines(text);
  if (nlines.length === 0 || nlines[0] !== "---") {
    errors.push([1, "file does not start with '---' frontmatter delimiter"]);
    return { errors, shape: null };
  }

  const parsed = parseFrontmatter(nlines);
  if (parsed === null) {
    errors.push([1, "frontmatter opening '---' has no matching closing '---'"]);
    return { errors, shape: null };
  }
  return { errors, shape: { fm: parsed.fm, body: parsed.body, closeLineNo: parsed.closeLineNo, fmStart: 2 } };
}

export function checkBodyPaths(body: string[], startLineNo: number): LineError[] {
  const errors: LineError[] = [];
  let inFence = false;
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    const lineno = startLineNo + i;
    if (FENCE_RE.test(line)) inFence = !inFence;
    if (inFence) continue;
    const check = line.replace(INLINE_CODE_RE, "");
    if (FILE_URL_RE.test(check)) errors.push([lineno, "body contains forbidden 'file://' URL"]);
    if (MNT_PATH_RE.test(check))
      errors.push([lineno, "body contains absolute /mnt/ path (use [[wiki-links]] instead)"]);
    if (WIN_PATH_RE.test(check))
      errors.push([lineno, "body contains absolute Windows path C:\\ or C:/ (use [[wiki-links]] instead)"]);
  }
  return errors;
}
