// Shared frontmatter parsing primitives. Port of vault_fm.py.
// Operates on arrays of lines WITHOUT trailing newline chars.

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

/** Split text into lines without newline chars, mirroring Python splitlines(). */
export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
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
