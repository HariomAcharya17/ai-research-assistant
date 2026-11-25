// Text utilities shared by ranking, passage splitting and the similarity check.
// Pure functions only, so they run on the server and in the browser.

const STOPWORDS = new Set(
  (
    "a about above after again against all also am an and any are as at be because been before being below between both but by " +
    "can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how " +
    "i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own " +
    "same she should so some such than that the their theirs them themselves then there these they this those through to too under until up " +
    "very was we were what when where which while who whom why will with would you your yours yourself yourselves using use used based " +
    "via within without toward towards paper study approach new novel propose proposed research work show results method methods"
  ).split(" "),
);

export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lower-case word tokens without punctuation. */
export function words(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(" ").filter(Boolean) : [];
}

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("es") && !w.endsWith("ses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Content terms for ranking: no stopwords, light stemming. */
export function terms(text: string): string[] {
  return words(text)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map(stem);
}

/** Top keywords by frequency, for building a search query without AI. */
export function keywords(text: string, max = 8): string[] {
  const counts = new Map<string, number>();
  for (const w of words(text)) {
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([w]) => w);
}

/** Okapi BM25 scores of each document against the query. */
export function bm25(query: string, docs: string[], k1 = 1.4, b = 0.75): number[] {
  const q = [...new Set(terms(query))];
  const docTerms = docs.map(terms);
  const N = docs.length || 1;
  const avgdl = docTerms.reduce((s, d) => s + d.length, 0) / N || 1;
  const df = new Map<string, number>();
  for (const d of docTerms) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  return docTerms.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgdl)));
    }
    return score;
  });
}

/** Split prose into sentences, keeping the character offsets. */
export function sentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const re = /[^.!?\n]+(?:[.!?]+["')\]]*|\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t) out.push({ text: t, start: m.index + lead, end: m.index + lead + t.length });
  }
  return out;
}

/** Word n-gram shingles of normalised text. */
export function shingles(text: string, n = 5): string[] {
  const w = words(text);
  if (w.length < n) return w.length ? [w.join(" ")] : [];
  const out: string[] = [];
  for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(" "));
  return out;
}

/** True when `needle` appears in `haystack` after normalising spacing and punctuation. */
export function containsLoose(haystack: string, needle: string): boolean {
  const n = normalize(needle);
  if (n.length < 12) return false;
  return normalize(haystack).includes(n);
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}
