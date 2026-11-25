import "server-only";
import type { Paper, SearchFilters, SourceId, SourceStatus } from "@/lib/types";
import { normalize, stripTags } from "@/lib/text";
import { aiConfigured } from "./groq";

// Search adapters. OpenAlex is free and indexes Springer, IEEE, Elsevier, arXiv and
// most other publishers, so it is the backbone. Semantic Scholar adds coverage and
// abstracts. The Springer Nature and IEEE Xplore APIs need free keys and are used
// only when those keys are set. Google Scholar has no public API, so the app links
// to it instead of scraping it.

const UA = "ai-research-assistant/0.1 (open-source research helper)";
const TIMEOUT = 15_000;

export function sourceStatus(): SourceStatus {
  return {
    ai: aiConfigured(),
    openalex: true,
    openalexKey: Boolean(process.env.OPENALEX_API_KEY),
    semanticscholar: true,
    semanticscholarKey: Boolean(process.env.SEMANTIC_SCHOLAR_API_KEY),
    springer: Boolean(process.env.SPRINGER_API_KEY),
    ieee: Boolean(process.env.IEEE_API_KEY),
    scopus: Boolean(process.env.ELSEVIER_API_KEY),
  };
}

export function cleanDoi(doi?: string | null): string | undefined {
  if (!doi) return undefined;
  const d = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "");
  return /^10\.\d{4,9}\/\S+$/.test(d) ? d : undefined;
}

export function publisherLabel(publisher?: string, venue?: string): string {
  const p = `${publisher ?? ""} ${venue ?? ""}`.toLowerCase();
  if (/arxiv/.test(p)) return "arXiv";
  if (/springer|nature portfolio|nature research|biomed central|bmc/.test(p)) return "Springer";
  if (/ieee|institute of electrical/.test(p)) return "IEEE";
  if (/elsevier|cell press/.test(p)) return "Elsevier";
  if (/association for computing machinery|\bacm\b/.test(p)) return "ACM";
  if (/wiley/.test(p)) return "Wiley";
  if (/mdpi|multidisciplinary digital publishing/.test(p)) return "MDPI";
  if (/taylor|routledge/.test(p)) return "Taylor & Francis";
  if (/sage/.test(p)) return "SAGE";
  if (/oxford university press/.test(p)) return "Oxford";
  if (/cambridge university press/.test(p)) return "Cambridge";
  if (/frontiers/.test(p)) return "Frontiers";
  if (/plos|public library of science/.test(p)) return "PLOS";
  if (/medrxiv|biorxiv|cold spring/.test(p)) return "bioRxiv/medRxiv";
  if (/pubmed|ncbi/.test(p)) return "PubMed Central";
  return publisher?.trim() || venue?.trim() || "Other";
}

async function getJSON<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return (await res.json()) as T;
}

/* ---------------- OpenAlex ---------------- */

interface OAWork {
  id: string;
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  authorships?: { author?: { display_name?: string } }[];
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: {
    landing_page_url?: string | null;
    pdf_url?: string | null;
    source?: {
      display_name?: string;
      issn?: string[] | null;
      is_in_doaj?: boolean;
      host_organization_name?: string | null;
      type?: string;
    } | null;
  } | null;
  best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null } | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null };
  cited_by_count?: number;
  type?: string;
}

export function invertedToText(inv?: Record<string, number[]> | null): string | undefined {
  if (!inv) return undefined;
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(inv)) for (const p of positions) slots[p] = word;
  const text = slots.filter(Boolean).join(" ").trim();
  return text || undefined;
}

function fromOpenAlex(w: OAWork): Paper | null {
  if (!w.title) return null;
  const doi = cleanDoi(w.doi);
  const src = w.primary_location?.source;
  const publisher = src?.host_organization_name ?? undefined;
  const venue = src?.display_name;
  return {
    id: doi ? doi.toLowerCase() : `openalex:${w.id.split("/").pop()}`,
    title: stripTags(w.title),
    authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean),
    year: w.publication_year ?? undefined,
    abstract: invertedToText(w.abstract_inverted_index),
    doi,
    url: w.primary_location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : w.id),
    pdfUrl: w.best_oa_location?.pdf_url ?? w.primary_location?.pdf_url ?? undefined,
    venue,
    publisher,
    venueType: src?.type ?? w.type,
    issn: src?.issn ?? undefined,
    isOpenAccess: Boolean(w.open_access?.is_oa),
    citedBy: w.cited_by_count,
    foundVia: ["openalex"],
    label: publisherLabel(publisher, venue),
    indexing: { doaj: src?.is_in_doaj ?? undefined, scopus: null },
  };
}

async function searchOpenAlex(query: string, f: SearchFilters, perPage = 25): Promise<Paper[]> {
  const filters = ["is_retracted:false", "is_paratext:false"];
  if (f.yearFrom) filters.push(`from_publication_date:${f.yearFrom}-01-01`);
  if (f.yearTo) filters.push(`to_publication_date:${f.yearTo}-12-31`);
  if (f.openAccessOnly) filters.push("is_oa:true");
  const params = new URLSearchParams({
    search: query,
    filter: filters.join(","),
    "per-page": String(perPage),
    select:
      "id,doi,title,publication_year,authorships,abstract_inverted_index,primary_location,best_oa_location,open_access,cited_by_count,type",
  });
  if (process.env.OPENALEX_API_KEY) params.set("api_key", process.env.OPENALEX_API_KEY);
  const data = await getJSON<{ results: OAWork[] }>(`https://api.openalex.org/works?${params}`);
  return data.results.map(fromOpenAlex).filter((p): p is Paper => p !== null);
}

/* ---------------- Semantic Scholar ---------------- */

interface S2Paper {
  paperId: string;
  title?: string;
  abstract?: string | null;
  year?: number | null;
  authors?: { name?: string }[];
  externalIds?: { DOI?: string; ArXiv?: string } | null;
  venue?: string;
  publicationVenue?: { name?: string; type?: string; issn?: string; publisher?: string } | null;
  openAccessPdf?: { url?: string | null } | null;
  isOpenAccess?: boolean;
  citationCount?: number;
  url?: string;
}

const S2_FIELDS =
  "title,abstract,year,authors,externalIds,venue,publicationVenue,openAccessPdf,isOpenAccess,citationCount,url";

function s2Headers(): Record<string, string> {
  return process.env.SEMANTIC_SCHOLAR_API_KEY ? { "x-api-key": process.env.SEMANTIC_SCHOLAR_API_KEY } : {};
}

function fromS2(p: S2Paper): Paper | null {
  if (!p.title) return null;
  const doi = cleanDoi(p.externalIds?.DOI) ?? (p.externalIds?.ArXiv ? `10.48550/arXiv.${p.externalIds.ArXiv}` : undefined);
  const venue = p.publicationVenue?.name || p.venue || (p.externalIds?.ArXiv ? "arXiv" : undefined);
  const publisher = p.publicationVenue?.publisher;
  return {
    id: doi ? doi.toLowerCase() : `s2:${p.paperId}`,
    title: stripTags(p.title),
    authors: (p.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
    year: p.year ?? undefined,
    abstract: p.abstract ?? undefined,
    doi,
    url: doi ? `https://doi.org/${doi}` : p.url,
    pdfUrl: p.openAccessPdf?.url || undefined,
    venue,
    publisher,
    venueType: p.publicationVenue?.type,
    issn: p.publicationVenue?.issn ? [p.publicationVenue.issn] : undefined,
    isOpenAccess: Boolean(p.isOpenAccess || p.openAccessPdf?.url),
    citedBy: p.citationCount,
    foundVia: ["semanticscholar"],
    label: publisherLabel(publisher, venue),
    indexing: { scopus: null },
  };
}

async function searchSemanticScholar(query: string, f: SearchFilters, limit = 20): Promise<Paper[]> {
  const params = new URLSearchParams({ query, limit: String(limit), fields: S2_FIELDS });
  if (f.yearFrom || f.yearTo) params.set("year", `${f.yearFrom ?? ""}-${f.yearTo ?? ""}`);
  if (f.openAccessOnly) params.set("openAccessPdf", "");
  const data = await getJSON<{ data?: S2Paper[] }>(
    `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
    s2Headers(),
  );
  return (data.data ?? []).map(fromS2).filter((p): p is Paper => p !== null);
}

/** Fill missing abstracts from Semantic Scholar's batch endpoint (best effort). */
async function fillAbstracts(papers: Paper[]): Promise<void> {
  const missing = papers.filter((p) => !p.abstract && p.doi).slice(0, 40);
  if (!missing.length) return;
  try {
    const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/batch?fields=abstract,openAccessPdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA, ...s2Headers() },
      body: JSON.stringify({ ids: missing.map((p) => `DOI:${p.doi}`) }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return;
    const rows = (await res.json()) as (S2Paper | null)[];
    rows.forEach((row, i) => {
      if (!row) return;
      if (row.abstract) missing[i].abstract = row.abstract;
      if (!missing[i].pdfUrl && row.openAccessPdf?.url) {
        missing[i].pdfUrl = row.openAccessPdf.url;
        missing[i].isOpenAccess = true;
      }
    });
  } catch {
    /* optional enrichment */
  }
}

/* ---------------- Springer Nature (free key) ---------------- */

interface SpringerRecord {
  title?: string;
  creators?: { creator?: string }[];
  publicationName?: string;
  doi?: string;
  publicationDate?: string;
  abstract?: string | { p?: string | string[] };
  url?: { format?: string; value?: string }[];
  openaccess?: string;
  publisher?: string;
  issn?: string;
  eissn?: string;
  contentType?: string;
}

function springerAbstract(a: SpringerRecord["abstract"]): string | undefined {
  if (!a) return undefined;
  if (typeof a === "string") return stripTags(a);
  const p = a.p;
  return p ? stripTags(Array.isArray(p) ? p.join(" ") : p) : undefined;
}

async function searchSpringer(query: string, f: SearchFilters): Promise<Paper[]> {
  const key = process.env.SPRINGER_API_KEY;
  if (!key) return [];
  let q = query;
  if (f.yearFrom) q += ` onlinedatefrom:${f.yearFrom}-01-01`;
  if (f.yearTo) q += ` onlinedateto:${f.yearTo}-12-31`;
  if (f.openAccessOnly) q += " openaccess:true";
  const params = new URLSearchParams({ q, p: "20", api_key: key });
  const data = await getJSON<{ records?: SpringerRecord[] }>(`https://api.springernature.com/meta/v2/json?${params}`);
  return (data.records ?? [])
    .filter((r) => r.title)
    .map((r): Paper => {
      const doi = cleanDoi(r.doi);
      const html = r.url?.find((u) => u.format === "html" || u.format === "")?.value;
      const pdf = r.url?.find((u) => u.format === "pdf")?.value;
      const oa = r.openaccess === "true";
      return {
        id: doi ? doi.toLowerCase() : `springer:${normalize(r.title!).slice(0, 60)}`,
        title: stripTags(r.title!),
        authors: (r.creators ?? []).map((c) => (c.creator ?? "").split(", ").reverse().join(" ").trim()).filter(Boolean),
        year: r.publicationDate ? Number(r.publicationDate.slice(0, 4)) : undefined,
        abstract: springerAbstract(r.abstract),
        doi,
        url: html ?? (doi ? `https://doi.org/${doi}` : undefined),
        pdfUrl: oa ? pdf : undefined,
        venue: r.publicationName,
        publisher: r.publisher ?? "Springer",
        venueType: r.contentType,
        issn: [r.issn, r.eissn].filter((x): x is string => Boolean(x)),
        isOpenAccess: oa,
        foundVia: ["springer"],
        label: "Springer",
        indexing: { scopus: null },
      };
    });
}

/* ---------------- IEEE Xplore (free key) ---------------- */

interface IEEEArticle {
  title?: string;
  authors?: { authors?: { full_name?: string }[] };
  publication_year?: string | number;
  abstract?: string;
  doi?: string;
  html_url?: string;
  pdf_url?: string;
  publication_title?: string;
  publisher?: string;
  access_type?: string;
  issn?: string;
  content_type?: string;
  citing_paper_count?: number;
}

async function searchIEEE(query: string, f: SearchFilters): Promise<Paper[]> {
  const key = process.env.IEEE_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({ querytext: query, apikey: key, max_records: "20", format: "json" });
  if (f.yearFrom) params.set("start_year", String(f.yearFrom));
  if (f.yearTo) params.set("end_year", String(f.yearTo));
  if (f.openAccessOnly) params.set("open_access", "true");
  const data = await getJSON<{ articles?: IEEEArticle[] }>(
    `https://ieeexploreapi.ieee.org/api/v1/search/articles?${params}`,
  );
  return (data.articles ?? [])
    .filter((a) => a.title)
    .map((a): Paper => {
      const doi = cleanDoi(a.doi);
      const oa = /open/i.test(a.access_type ?? "");
      return {
        id: doi ? doi.toLowerCase() : `ieee:${normalize(a.title!).slice(0, 60)}`,
        title: stripTags(a.title!),
        authors: (a.authors?.authors ?? []).map((x) => x.full_name ?? "").filter(Boolean),
        year: a.publication_year ? Number(a.publication_year) : undefined,
        abstract: a.abstract ? stripTags(a.abstract) : undefined,
        doi,
        url: a.html_url ?? (doi ? `https://doi.org/${doi}` : undefined),
        pdfUrl: oa ? a.pdf_url : undefined,
        venue: a.publication_title,
        publisher: a.publisher ?? "IEEE",
        venueType: a.content_type,
        issn: a.issn ? [a.issn] : undefined,
        isOpenAccess: oa,
        citedBy: a.citing_paper_count,
        foundVia: ["ieee"],
        label: "IEEE",
        indexing: { scopus: null },
      };
    });
}

/* ---------------- Scopus indexing check (free Elsevier key) ---------------- */

const scopusCache = new Map<string, boolean>();

async function checkScopus(papers: Paper[]): Promise<void> {
  const key = process.env.ELSEVIER_API_KEY;
  if (!key) return;
  const issns = [...new Set(papers.flatMap((p) => p.issn ?? []))].slice(0, 25);
  await Promise.all(
    issns
      .filter((i) => !scopusCache.has(i))
      .map(async (issn) => {
        try {
          const res = await fetch(`https://api.elsevier.com/content/serial/title/issn/${encodeURIComponent(issn)}`, {
            headers: { "X-ELS-APIKey": key, Accept: "application/json" },
            signal: AbortSignal.timeout(TIMEOUT),
          });
          if (res.status === 404) scopusCache.set(issn, false);
          else if (res.ok) {
            const j = (await res.json()) as { "serial-metadata-response"?: { entry?: unknown[] } };
            scopusCache.set(issn, Boolean(j["serial-metadata-response"]?.entry?.length));
          }
        } catch {
          /* leave unchecked */
        }
      }),
  );
  for (const p of papers) {
    const results = (p.issn ?? []).map((i) => scopusCache.get(i)).filter((v) => v !== undefined);
    if (results.length) p.indexing.scopus = results.some(Boolean);
  }
}

/* ---------------- Merge ---------------- */

function mergeInto(a: Paper, b: Paper): Paper {
  return {
    ...a,
    authors: a.authors.length ? a.authors : b.authors,
    year: a.year ?? b.year,
    abstract: (b.abstract?.length ?? 0) > (a.abstract?.length ?? 0) ? b.abstract : a.abstract,
    doi: a.doi ?? b.doi,
    url: a.url ?? b.url,
    pdfUrl: a.pdfUrl ?? b.pdfUrl,
    venue: a.venue ?? b.venue,
    publisher: a.publisher ?? b.publisher,
    venueType: a.venueType ?? b.venueType,
    issn: a.issn?.length ? a.issn : b.issn,
    isOpenAccess: a.isOpenAccess || b.isOpenAccess,
    citedBy: Math.max(a.citedBy ?? 0, b.citedBy ?? 0) || undefined,
    foundVia: [...new Set([...a.foundVia, ...b.foundVia])],
    label: a.label === "Other" ? b.label : a.label,
    indexing: { doaj: a.indexing.doaj ?? b.indexing.doaj, scopus: a.indexing.scopus ?? b.indexing.scopus },
  };
}

export function mergePapers(lists: Paper[][]): Paper[] {
  const byKey = new Map<string, Paper>();
  const titleKey = new Map<string, string>();
  for (const list of lists) {
    for (const p of list) {
      const tk = normalize(p.title).slice(0, 120);
      const key = (p.doi && byKey.has(p.doi.toLowerCase()) && p.doi.toLowerCase()) || titleKey.get(tk) || p.id;
      const existing = byKey.get(key);
      byKey.set(key, existing ? mergeInto(existing, p) : p);
      titleKey.set(tk, key);
    }
  }
  return [...byKey.values()];
}

export interface SearchOutcome {
  papers: Paper[];
  sources: { id: SourceId; ok: boolean; count: number; error?: string }[];
}

export async function searchAll(queries: string[], filters: SearchFilters): Promise<SearchOutcome> {
  type Job = { id: SourceId; run: () => Promise<Paper[]> };
  const jobs: Job[] = [];
  queries.forEach((q, i) => {
    jobs.push({ id: "openalex", run: () => searchOpenAlex(q, filters, i === 0 ? 30 : 20) });
    if (i < 2) jobs.push({ id: "springer", run: () => searchSpringer(q, filters) });
    if (i < 2) jobs.push({ id: "ieee", run: () => searchIEEE(q, filters) });
  });
  // Semantic Scholar's shared free pool is tight, so send only the main query.
  jobs.push({ id: "semanticscholar", run: () => searchSemanticScholar(queries[0], filters) });

  const settled = await Promise.allSettled(jobs.map((j) => j.run()));
  const agg = new Map<SourceId, { ok: boolean; count: number; error?: string }>();
  const lists: Paper[][] = [];
  settled.forEach((r, i) => {
    const id = jobs[i].id;
    const cur = agg.get(id) ?? { ok: false, count: 0 };
    if (r.status === "fulfilled") {
      lists.push(r.value);
      cur.ok = true;
      cur.count += r.value.length;
    } else if (!cur.ok) {
      cur.error = r.reason instanceof Error ? r.reason.message : String(r.reason);
    }
    agg.set(id, cur);
  });

  const status = sourceStatus();
  const sources = [...agg.entries()]
    .filter(([id]) => (id === "springer" ? status.springer : id === "ieee" ? status.ieee : true))
    .map(([id, v]) => ({ id, ...v }));

  let papers = mergePapers(lists);
  if (filters.openAccessOnly) papers = papers.filter((p) => p.isOpenAccess);
  if (filters.yearFrom) papers = papers.filter((p) => !p.year || p.year >= filters.yearFrom!);
  if (filters.yearTo) papers = papers.filter((p) => !p.year || p.year <= filters.yearTo!);

  await Promise.all([fillAbstracts(papers), checkScopus(papers)]);
  return { papers, sources };
}
