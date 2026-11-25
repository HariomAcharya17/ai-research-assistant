import { normalize, sentences } from "./text";

// Draft similarity check: word 5-gram overlap between each draft sentence and the
// texts the app can access (abstracts and any loaded full texts). It finds shared
// wording, not shared ideas, and it cannot see sources the app has not loaded.

export interface SourceDoc {
  paperId: string;
  title: string;
  kind: "abstract" | "fulltext";
  passageId?: string;
  section?: string;
  text: string;
}

export interface SentenceResult {
  start: number;
  end: number;
  text: string;
  words: number;
  /** Share of the sentence's 5-grams found in the best matching source, 0-1. */
  score: number;
  level: "none" | "partial" | "strong";
  quoted: boolean;
  match?: { paperId: string; title: string; kind: SourceDoc["kind"]; passageId?: string; section?: string; snippet: string };
}

export interface SimilarityReport {
  sentences: SentenceResult[];
  totalWords: number;
  strongWords: number;
  partialWords: number;
  quotedWords: number;
  checked: { abstracts: number; fulltexts: number };
  byPaper: { paperId: string; title: string; words: number }[];
}

const N = 5;
export const STRONG = 0.5;
export const PARTIAL = 0.2;

interface Tokens {
  norm: string[];
  /** Index into `orig` for each normalised token. */
  map: number[];
  orig: string[];
}

export function tokenize(text: string): Tokens {
  const orig = text.split(/\s+/).filter(Boolean);
  const norm: string[] = [];
  const map: number[] = [];
  orig.forEach((tok, i) => {
    for (const piece of normalize(tok).split(" ")) {
      if (!piece) continue;
      norm.push(piece);
      map.push(i);
    }
  });
  return { norm, map, orig };
}

function grams(norm: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + N <= norm.length; i++) out.push(norm.slice(i, i + N).join(" "));
  return out;
}

const QUOTE_OPEN = /^["“‘«]/;

export function checkSimilarity(draft: string, docs: SourceDoc[]): SimilarityReport {
  // Index: 5-gram -> list of (doc, position).
  const index = new Map<string, { d: number; pos: number }[]>();
  const docTokens = docs.map((doc) => tokenize(doc.text));
  docTokens.forEach((t, d) => {
    grams(t.norm).forEach((g, pos) => {
      const list = index.get(g);
      if (!list) index.set(g, [{ d, pos }]);
      else if (list.length < 50) list.push({ d, pos });
    });
  });

  const results: SentenceResult[] = [];
  let totalWords = 0;
  let strongWords = 0;
  let partialWords = 0;
  let quotedWords = 0;
  const paperWords = new Map<string, number>();

  for (const s of sentences(draft)) {
    const t = tokenize(s.text);
    const wc = t.norm.length;
    totalWords += wc;
    const quoted = QUOTE_OPEN.test(s.text) || /^[^"“]*["“][^"”]{25,}["”]/.test(s.text);
    const base: SentenceResult = { start: s.start, end: s.end, text: s.text, words: wc, score: 0, level: "none", quoted };
    if (wc < 8) {
      results.push(base);
      continue;
    }
    const g = grams(t.norm);
    const hits = new Map<number, { count: number; firstPos: number }>();
    const seen = new Set<string>();
    for (const gram of g) {
      if (seen.has(gram)) continue;
      seen.add(gram);
      const docsSeen = new Set<number>();
      for (const { d, pos } of index.get(gram) ?? []) {
        if (docsSeen.has(d)) continue;
        docsSeen.add(d);
        const h = hits.get(d);
        if (h) h.count++;
        else hits.set(d, { count: 1, firstPos: pos });
      }
    }
    let best = -1;
    let bestCount = 0;
    for (const [d, h] of hits) if (h.count > bestCount) [best, bestCount] = [d, h.count];
    const score = seen.size ? bestCount / seen.size : 0;
    const level = score >= STRONG ? "strong" : score >= PARTIAL ? "partial" : "none";
    const r: SentenceResult = { ...base, score, level };
    if (best >= 0 && level !== "none") {
      const doc = docs[best];
      const dt = docTokens[best];
      const pos = hits.get(best)!.firstPos;
      const from = dt.map[Math.max(0, pos - 6)] ?? 0;
      const to = dt.map[Math.min(dt.map.length - 1, pos + wc + 6)] ?? dt.orig.length - 1;
      r.match = {
        paperId: doc.paperId,
        title: doc.title,
        kind: doc.kind,
        passageId: doc.passageId,
        section: doc.section,
        snippet: (from > 0 ? "… " : "") + dt.orig.slice(from, to + 1).join(" ") + (to < dt.orig.length - 1 ? " …" : ""),
      };
      if (quoted) quotedWords += wc;
      else {
        if (level === "strong") strongWords += wc;
        else partialWords += wc;
        paperWords.set(doc.paperId, (paperWords.get(doc.paperId) ?? 0) + wc);
      }
    }
    results.push(r);
  }

  const titles = new Map(docs.map((d) => [d.paperId, d.title]));
  return {
    sentences: results,
    totalWords,
    strongWords,
    partialWords,
    quotedWords,
    checked: {
      abstracts: new Set(docs.filter((d) => d.kind === "abstract").map((d) => d.paperId)).size,
      fulltexts: new Set(docs.filter((d) => d.kind === "fulltext").map((d) => d.paperId)).size,
    },
    byPaper: [...paperWords.entries()]
      .map(([paperId, words]) => ({ paperId, title: titles.get(paperId) ?? paperId, words }))
      .sort((a, b) => b.words - a.words),
  };
}
