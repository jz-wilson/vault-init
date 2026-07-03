#!/usr/bin/env bun
// Zero-dep lexical recall over vault notes. Standard BM25 (k1=1.2, b=0.75), in-memory,
// rebuilt fresh each invocation — vaults are small, no persistent index needed.
//   search.ts <query terms...> [--limit N]      (default limit: 10)
// Citation format matches validate-vault.ts's `path:line: msg` convention:
//   path:line: snippet  (score)
import { readFileSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseFrontmatter, splitLines } from "./frontmatter.ts";
import { NONCONTENT_SUBTREES, inSkippedSubtree } from "./config.ts";

// NONCONTENT_SUBTREES (shared) newly closes a search-side gap: .claude/.omc tool state is no
// longer indexed (previously only validate skipped those). On top, skip agents/ + handoffs/ —
// internal coordination state, not recall material. Flip: drop those two to index them in search.
const SKIP_SUBTREES = new Set([...NONCONTENT_SUBTREES, "agents", "handoffs"]);

const K1 = 1.2;
const B = 0.75;

/** Lowercase, split on runs of non-alphanumerics, drop empties. No stemming, no stopwords
 *  (both explicitly deferred by the PRD). */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Minimal per-document shape a ScoreFn needs — deliberately doesn't leak the indexer's
 *  internals (line-level data) so an embedding backend can swap in without touching search(). */
export interface Doc {
  path: string;
  length: number; // token count of the note body
  termFreq: Map<string, number>;
}

export interface CorpusStats {
  N: number; // doc count
  avgdl: number; // average doc length in tokens
  df: Map<string, number>; // term -> number of docs containing it at least once
}

/** Injectable scoring seam — swap in an embedding-backed scorer later without touching
 *  search()'s call sites. */
export type ScoreFn = (queryTokens: string[], doc: Doc, corpus: CorpusStats) => number;

export function bm25(queryTokens: string[], doc: Doc, corpus: CorpusStats): number {
  const avgdl = corpus.avgdl || 1;
  let score = 0;
  for (const term of new Set(queryTokens)) {
    const tf = doc.termFreq.get(term);
    if (!tf) continue;
    const df = corpus.df.get(term) ?? 0;
    // +1 inside the log keeps idf non-negative even when a term appears in >50% of docs
    // (Elasticsearch/Lucene's BM25 variant, vs. the raw Robertson-Sparck Jones formula).
    const idf = Math.log(1 + (corpus.N - df + 0.5) / (df + 0.5));
    const denom = tf + K1 * (1 - B + B * (doc.length / avgdl));
    score += idf * ((tf * (K1 + 1)) / denom);
  }
  return score;
}

export interface NoteInput {
  path: string;
  text: string;
}

export interface Result {
  path: string;
  line: number;
  snippet: string;
  score: number;
}

interface IndexedLine {
  lineNo: number; // 1-based, matches the raw file
  text: string;
  tokens: string[];
}

interface IndexedNote {
  path: string;
  lines: IndexedLine[];
  doc: Doc;
}

/** Body = everything after the closing frontmatter '---' (or the whole file, if it has none).
 *  Frontmatter is metadata, not body — excluded from the BM25 corpus per spec, but line
 *  numbers reported for citation are still real file line numbers. */
function indexNote(note: NoteInput): IndexedNote {
  const allLines = splitLines(note.text);
  const parsed = parseFrontmatter(allLines);
  const bodyLines = parsed ? parsed.body : allLines;
  const bodyStart = parsed ? parsed.closeLineNo + 1 : 1;

  const termFreq = new Map<string, number>();
  let length = 0;
  const lines: IndexedLine[] = bodyLines.map((text, i) => {
    const tokens = tokenize(text);
    length += tokens.length;
    for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
    return { lineNo: bodyStart + i, text, tokens };
  });

  return { path: note.path, lines, doc: { path: note.path, length, termFreq } };
}

function buildCorpusStats(indexed: IndexedNote[]): CorpusStats {
  const N = indexed.length;
  let totalLen = 0;
  const df = new Map<string, number>();
  for (const n of indexed) {
    totalLen += n.doc.length;
    for (const term of n.doc.termFreq.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }
  return { N, avgdl: N > 0 ? totalLen / N : 0, df };
}

/** The single best-matching line in a note, for citation — the line covering the most
 *  distinct query terms. Ties keep the earliest line. */
function bestLine(note: IndexedNote, queryTokens: string[]): IndexedLine | null {
  const qSet = new Set(queryTokens);
  let best: IndexedLine | null = null;
  let bestHits = 0;
  for (const line of note.lines) {
    const hits = new Set(line.tokens.filter((t) => qSet.has(t))).size;
    if (hits > bestHits) {
      best = line;
      bestHits = hits;
    }
  }
  return best;
}

/** Rank `notes` against `query`. Corpus is rebuilt in-memory on every call (small vaults,
 *  no persistent index). Zero-score docs are dropped; the rest are sorted descending. */
export function search(notes: NoteInput[], query: string, scoreFn: ScoreFn = bm25): Result[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const indexed = notes.map(indexNote);
  const corpus = buildCorpusStats(indexed);

  const results: Result[] = [];
  for (const note of indexed) {
    const score = scoreFn(queryTokens, note.doc, corpus);
    if (score <= 0) continue;
    const line = bestLine(note, queryTokens);
    if (!line) continue; // defensive: a positive score implies a match somewhere in the body
    results.push({ path: note.path, line: line.lineNo, snippet: line.text.trim(), score });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

export function loadNotesFromVault(vaultRoot: string): NoteInput[] {
  const paths = [...new Bun.Glob("**/*.md").scanSync(vaultRoot)].map((p) => resolve(vaultRoot, p)).sort();
  const notes: NoteInput[] = [];
  for (const path of paths) {
    const rel = relative(vaultRoot, path);
    if (inSkippedSubtree(rel, SKIP_SUBTREES)) continue;
    if (!existsSync(path)) continue;
    notes.push({ path: rel, text: readFileSync(path, "utf8") });
  }
  return notes;
}

function parseArgs(argv: string[]): { queryTerms: string[]; limit: number; json: boolean } {
  const queryTerms: string[] = [];
  let limit = 10;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) limit = n;
    } else if (argv[i] === "--json") {
      json = true;
    } else {
      queryTerms.push(argv[i]);
    }
  }
  return { queryTerms, limit, json };
}

function main() {
  const { queryTerms, limit, json } = parseArgs(process.argv.slice(2));
  if (queryTerms.length === 0) {
    console.error("usage: search.ts <query terms...> [--limit N] [--json]");
    process.exit(1);
  }

  const vaultRoot = resolve(import.meta.dir, "..");
  const notes = loadNotesFromVault(vaultRoot);
  const results = search(notes, queryTerms.join(" ")).slice(0, limit);

  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  for (const r of results) console.log(`${r.path}:${r.line}: ${r.snippet}  (${r.score.toFixed(3)})`);
}

if (import.meta.main) main();
