import "server-only";
import type { Paper, SearchFilters } from "@/lib/types";
import { basePaper, cleanDoi, getJSON, TIMEOUT, UA, yearOk, type Adapter } from "./util";

// Large multidisciplinary indexes: OpenAlex, Semantic Scholar and Crossref.

/* ---------------- OpenAlex ---------------- */

interface OAWork {
  id: string;
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  authorships?: { author?: { display_name?: string } }[];
  abstract_inverted_index?: Record<string, number[]> | null;
  ids?: { pmcid?: string; pmid?: string; arxiv?: string };
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
  open_access?: { is_oa?: boolean };
  cited_by_count?: number;
  type?: string;
}

export function invertedToText(inv?: Record<string, number[]> | null): string | undefined {
  if (!inv) return undefined;
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(inv)) for (const p of positions) slots[p] = word;
  return slots.filter(Boolean).join(" ").trim() || undefined;
}

function pmcFrom(v?: string): string | undefined {
  const m = v ? /PMC?(\d+)/i.exec(v.replace(/.*\//, "")) ?? /(\d+)\/?$/.exec(v) : null;
  return m ? `PMC${m[1]}` : undefined;
}

function fromOpenAlex(w: OAWork): Paper | null {
  if (!w.title) return null;
  const src = w.primary_location?.source;
  return basePaper({
    idHint: `openalex:${w.id.split("/").pop()}`,
    title: w.title,
    authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean),
    year: w.publication_year ?? undefined,
    abstract: invertedToText(w.abstract_inverted_index),
    doi: w.doi ?? undefined,
    url: w.primary_location?.landing_page_url ?? (w.doi ? w.doi : w.id),
    pdfUrl: w.best_oa_location?.pdf_url ?? w.primary_location?.pdf_url ?? undefined,
    pmcid: pmcFrom(w.ids?.pmcid),
    arxivId: w.ids?.arxiv?.replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "") || undefined,
    venue: src?.display_name,
    publisher: src?.host_organization_name ?? undefined,
    venueType: src?.type ?? w.type,
    issn: src?.issn ?? undefined,
    isOpenAccess: Boolean(w.open_access?.is_oa),
    isPreprint: w.type === "preprint" || src?.type === "repository" ? true : undefined,
    citedBy: w.cited_by_count,
    foundVia: ["openalex"],
    indexing: { doaj: src?.is_in_doaj ?? undefined, scopus: null },
  });
}

export const openalex: Adapter = {
  id: "openalex",
  coverage: "250M+ works from every field and country, including Springer, IEEE, Elsevier, Wiley, ACM and SciELO",
  key: "OPENALEX_API_KEY",
  queries: 3,
  async search(query, f) {
    const filters = ["is_retracted:false", "is_paratext:false"];
    if (f.yearFrom) filters.push(`from_publication_date:${f.yearFrom}-01-01`);
    if (f.yearTo) filters.push(`to_publication_date:${f.yearTo}-12-31`);
    if (f.openAccessOnly) filters.push("is_oa:true");
    const params = new URLSearchParams({
      search: query,
      filter: filters.join(","),
      "per-page": "25",
      select:
        "id,doi,title,publication_year,authorships,abstract_inverted_index,ids,primary_location,best_oa_location,open_access,cited_by_count,type",
    });
    if (process.env.OPENALEX_API_KEY) params.set("api_key", process.env.OPENALEX_API_KEY);
    const data = await getJSON<{ results: OAWork[] }>(`https://api.openalex.org/works?${params}`);
    return data.results.map(fromOpenAlex).filter((p): p is Paper => p !== null);
  },
};

/** Look up open-access locations for one DOI (used to find full text later). */
export async function openAlexOA(doi: string): Promise<{ pdfUrl?: string; pmcid?: string; arxivId?: string }> {
  const params = new URLSearchParams({ select: "best_oa_location,locations,ids" });
  if (process.env.OPENALEX_API_KEY) params.set("api_key", process.env.OPENALEX_API_KEY);
  const w = await getJSON<{
    best_oa_location?: { pdf_url?: string | null } | null;
    locations?: { pdf_url?: string | null; is_oa?: boolean }[];
    ids?: { pmcid?: string; arxiv?: string };
  }>(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?${params}`);
  const pdfUrl = w.best_oa_location?.pdf_url ?? w.locations?.find((l) => l.is_oa && l.pdf_url)?.pdf_url ?? undefined;
  const arxivId = w.ids?.arxiv?.replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "");
  return { pdfUrl: pdfUrl ?? undefined, pmcid: pmcFrom(w.ids?.pmcid), arxivId: arxivId || undefined };
}

/* ---------------- Semantic Scholar ---------------- */

interface S2Paper {
  paperId: string;
  title?: string;
  abstract?: string | null;
  year?: number | null;
  authors?: { name?: string }[];
  externalIds?: { DOI?: string; ArXiv?: string; PubMedCentral?: string } | null;
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
  const arxiv = p.externalIds?.ArXiv;
  const doi = cleanDoi(p.externalIds?.DOI) ?? (arxiv ? `10.48550/arXiv.${arxiv}` : undefined);
  const venue = p.publicationVenue?.name || p.venue || (arxiv ? "arXiv" : undefined);
  return basePaper({
    idHint: `s2:${p.paperId}`,
    title: p.title,
    authors: (p.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
    year: p.year ?? undefined,
    abstract: p.abstract ?? undefined,
    doi,
    url: doi ? `https://doi.org/${doi}` : p.url,
    pdfUrl: p.openAccessPdf?.url || undefined,
    pmcid: p.externalIds?.PubMedCentral ? `PMC${p.externalIds.PubMedCentral.replace(/^PMC/i, "")}` : undefined,
    arxivId: arxiv,
    venue,
    publisher: p.publicationVenue?.publisher,
    venueType: p.publicationVenue?.type,
    issn: p.publicationVenue?.issn ? [p.publicationVenue.issn] : undefined,
    isOpenAccess: p.isOpenAccess,
    isPreprint: !p.externalIds?.DOI && Boolean(arxiv) ? true : undefined,
    citedBy: p.citationCount,
    foundVia: ["semanticscholar"],
  });
}

export const semanticscholar: Adapter = {
  id: "semanticscholar",
  coverage: "200M+ papers across all fields, with abstracts and open-access PDFs",
  key: "SEMANTIC_SCHOLAR_API_KEY",
  // The shared free pool is tight, so only the main query unless a key is set.
  queries: process.env.SEMANTIC_SCHOLAR_API_KEY ? 2 : 1,
  async search(query, f) {
    const params = new URLSearchParams({ query, limit: "20", fields: S2_FIELDS });
    if (f.yearFrom || f.yearTo) params.set("year", `${f.yearFrom ?? ""}-${f.yearTo ?? ""}`);
    if (f.openAccessOnly) params.set("openAccessPdf", "");
    const data = await getJSON<{ data?: S2Paper[] }>(
      `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
      s2Headers(),
    );
    return (data.data ?? []).map(fromS2).filter((p): p is Paper => p !== null);
  },
};

/** Fill missing abstracts and PDFs from Semantic Scholar's batch endpoint (best effort). */
export async function fillFromS2(papers: Paper[]): Promise<void> {
  const missing = papers.filter((p) => (!p.abstract || !p.pdfUrl) && p.doi).slice(0, 60);
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
      if (!missing[i].abstract && row.abstract) missing[i].abstract = row.abstract;
      if (!missing[i].pdfUrl && row.openAccessPdf?.url) {
        missing[i].pdfUrl = row.openAccessPdf.url;
        missing[i].isOpenAccess = true;
      }
    });
  } catch {
    /* optional enrichment */
  }
}

/* ---------------- Crossref ---------------- */

interface CRItem {
  DOI: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  issued?: { "date-parts"?: (number | null)[][] };
  "container-title"?: string[];
  publisher?: string;
  abstract?: string;
  type?: string;
  ISSN?: string[];
  "is-referenced-by-count"?: number;
  URL?: string;
}

export const crossref: Adapter = {
  id: "crossref",
  coverage: "160M+ DOI records from 20,000+ publishers worldwide",
  queries: 2,
  async search(query, f) {
    const filter: string[] = [];
    if (f.yearFrom) filter.push(`from-pub-date:${f.yearFrom}-01-01`);
    if (f.yearTo) filter.push(`until-pub-date:${f.yearTo}-12-31`);
    // Skip records that are not research outputs.
    const params = new URLSearchParams({
      "query.bibliographic": query,
      rows: "20",
      select: "DOI,title,author,issued,container-title,publisher,abstract,type,ISSN,is-referenced-by-count,URL",
    });
    if (filter.length) params.set("filter", filter.join(","));
    const mailto = process.env.CONTACT_EMAIL;
    if (mailto) params.set("mailto", mailto);
    const data = await getJSON<{ message: { items: CRItem[] } }>(`https://api.crossref.org/works?${params}`);
    return data.message.items
      .filter((it) => it.title?.[0] && /journal-article|proceedings-article|posted-content|book-chapter|report|dissertation/.test(it.type ?? ""))
      .map((it) =>
        basePaper({
          idHint: `crossref:${it.DOI}`,
          title: it.title![0],
          authors: (it.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean),
          year: it.issued?.["date-parts"]?.[0]?.[0] ?? undefined,
          abstract: it.abstract,
          doi: it.DOI,
          url: it.URL ?? `https://doi.org/${it.DOI}`,
          venue: it["container-title"]?.[0],
          publisher: it.publisher,
          venueType: it.type,
          issn: it.ISSN,
          isPreprint: it.type === "posted-content" ? true : undefined,
          citedBy: it["is-referenced-by-count"],
          foundVia: ["crossref"],
        }),
      )
      .filter((p) => yearOk(p.year, f));
  },
};

export type { SearchFilters };
