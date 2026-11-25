import type { Passage } from "./types";

// Splits extracted PDF text into numbered passages with best-guess section names,
// so summaries can point back to the exact place they came from.

const HEADING =
  /^\s*(?:(?:\d{1,2}(?:\.\d{1,2})*|[IVX]{1,5})\.?\s+)?(abstract|introduction|background|related work|literature review|preliminaries|problem (?:statement|formulation)|methods?|methodology|materials and methods|approach|proposed (?:method|approach|framework|model|system)|system (?:design|model|overview)|experiments?|experimental (?:setup|results|evaluation)|evaluation|results(?: and discussion)?|discussion|limitations?|threats to validity|future work|conclusions?(?: and future work)?|concluding remarks|acknowledge?ments?|references|bibliography)\b[:.]?\s*$/i;

const STOP = /^(references|bibliography|acknowledge?ments?)$/i;

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function detectHeading(line: string): string | null {
  const t = line.trim();
  if (t.length > 70) return null;
  const m = HEADING.exec(t);
  return m ? titleCase(m[1].toLowerCase()) : null;
}

/** Turn per-page text into passages of roughly `target` characters. */
export function toPassages(pages: string[], target = 900): Passage[] {
  const out: Passage[] = [];
  let section = "Front matter";
  let buf = "";
  let bufPage = 1;
  let stopped = false;

  const flush = () => {
    const text = buf.replace(/\s+/g, " ").replace(/-\s(?=[a-z])/g, "").trim();
    if (text.length > 60) out.push({ id: `p${out.length + 1}`, section, page: bufPage, text });
    buf = "";
  };

  pages.forEach((pageText, pi) => {
    if (stopped) return;
    const lines = pageText.split(/\n+/);
    for (const line of lines) {
      const heading = detectHeading(line);
      if (heading) {
        flush();
        if (STOP.test(heading)) {
          stopped = true;
          return;
        }
        section = heading;
        bufPage = pi + 1;
        continue;
      }
      if (!buf) bufPage = pi + 1;
      buf += (buf ? " " : "") + line.trim();
      if (buf.length >= target && /[.!?]["')\]]?$/.test(line.trim())) flush();
      else if (buf.length >= target * 1.6) flush();
    }
  });
  if (!stopped) flush();
  return out.slice(0, 400);
}

const SECTION_PRIORITY: [RegExp, number][] = [
  [/abstract/i, 10],
  [/limitation|threats|future work/i, 10],
  [/conclusion|concluding/i, 9],
  [/discussion/i, 8],
  [/result|evaluation|experiment/i, 7],
  [/method|approach|proposed|system|materials/i, 7],
  [/introduction/i, 6],
  [/front matter/i, 5],
];

const CUE = /\b(we propose|we present|this (paper|study|work)|our (results|findings|method)|results (show|indicate|suggest)|limitation|future work|however|we found|outperform|accuracy|significant)/i;

/**
 * Pick passages for the model within a character budget, keeping a spread of
 * sections and reading order. Returns them in document order.
 */
export function selectPassages(passages: Passage[], budget = 14_000): Passage[] {
  const scored = passages.map((p, i) => {
    const sec = SECTION_PRIORITY.find(([re]) => re.test(p.section))?.[1] ?? 4;
    const cue = CUE.test(p.text) ? 3 : 0;
    // The first passage of each section usually states its point.
    const first = i === 0 || passages[i - 1].section !== p.section ? 2 : 0;
    return { p, i, score: sec + cue + first };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const picked: typeof scored = [];
  let used = 0;
  for (const s of scored) {
    const len = Math.min(s.p.text.length, 1400);
    if (used + len > budget) continue;
    picked.push(s);
    used += len;
  }
  return picked.sort((a, b) => a.i - b.i).map((s) => ({ ...s.p, text: s.p.text.slice(0, 1400) }));
}
