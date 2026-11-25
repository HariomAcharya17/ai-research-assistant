import "server-only";
import type { Paper } from "@/lib/types";
import { stripTags } from "@/lib/text";
import { basePaper, getJSON, TIMEOUT, yearOk, type Adapter } from "./util";

// Sources that need a free API key. Each is skipped when its key is not set.

/* ---------------- CORE (open-access aggregator, free key) ---------------- */

interface CoreWork {
  id: number;
  title?: string;
  authors?: { name?: string }[];
  abstract?: string;
  yearPublished?: number;
  doi?: string;
  downloadUrl?: string;
  publisher?: string;
  journals?: { title?: string; identifiers?: string[] }[];
  documentType?: string;
  citationCount?: number;
}

export const core: Adapter = {
  id: "core",
  coverage: "300M+ open-access papers harvested from 14,000+ repositories and journals worldwide",
  key: "CORE_API_KEY",
  keyRequired: true,
  queries: 1,
  async search(query, f) {
    const key = process.env.CORE_API_KEY;
    if (!key) return [];
    let q = query;
    if (f.yearFrom) q += ` AND yearPublished>=${f.yearFrom}`;
    if (f.yearTo) q += ` AND yearPublished<=${f.yearTo}`;
    const params = new URLSearchParams({ q, limit: "15" });
    const data = await getJSON<{ results?: CoreWork[] }>(`https://api.core.ac.uk/v3/search/works?${params}`, {
      Authorization: `Bearer ${key}`,
    });
    return (data.results ?? [])
      .filter((w) => w.title)
      .map((w) =>
        basePaper({
          idHint: `core:${w.id}`,
          title: w.title!,
          authors: (w.authors ?? []).map((a) => (a.name ?? "").split(", ").reverse().join(" ")).filter(Boolean),
          year: w.yearPublished,
          abstract: w.abstract,
          doi: w.doi,
          url: `https://core.ac.uk/works/${w.id}`,
          pdfUrl: w.downloadUrl || undefined,
          venue: w.journals?.[0]?.title,
          publisher: w.publisher,
          venueType: w.documentType,
          issn: w.journals?.[0]?.identifiers?.filter((i) => /^issn:/i.test(i)).map((i) => i.replace(/^issn:/i, "")),
          isOpenAccess: true,
          citedBy: w.citationCount,
          foundVia: ["core"],
        }),
      )
      .filter((p) => yearOk(p.year, f));
  },
};

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

export const springer: Adapter = {
  id: "springer",
  coverage: "Direct search of Springer, Nature and BMC journals and books",
  key: "SPRINGER_API_KEY",
  keyRequired: true,
  queries: 2,
  async search(query, f) {
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
      .map((r) => {
        const oa = r.openaccess === "true";
        return basePaper({
          idHint: `springer:${r.doi ?? r.title}`,
          title: r.title!,
          authors: (r.creators ?? []).map((c) => (c.creator ?? "").split(", ").reverse().join(" ").trim()).filter(Boolean),
          year: r.publicationDate ? Number(r.publicationDate.slice(0, 4)) : undefined,
          abstract: springerAbstract(r.abstract),
          doi: r.doi,
          url: r.url?.find((u) => u.format === "html" || u.format === "")?.value ?? (r.doi ? `https://doi.org/${r.doi}` : undefined),
          pdfUrl: oa ? r.url?.find((u) => u.format === "pdf")?.value : undefined,
          venue: r.publicationName,
          publisher: r.publisher ?? "Springer",
          venueType: r.contentType,
          issn: [r.issn, r.eissn].filter((x): x is string => Boolean(x)),
          isOpenAccess: oa,
          isPreprint: false,
          label: "Springer",
          foundVia: ["springer"],
        });
      });
  },
};

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

export const ieee: Adapter = {
  id: "ieee",
  coverage: "Direct search of IEEE journals, magazines, conferences and standards",
  key: "IEEE_API_KEY",
  keyRequired: true,
  queries: 2,
  async search(query, f) {
    const key = process.env.IEEE_API_KEY;
    if (!key) return [];
    const params = new URLSearchParams({ querytext: query, apikey: key, max_records: "20", format: "json" });
    if (f.yearFrom) params.set("start_year", String(f.yearFrom));
    if (f.yearTo) params.set("end_year", String(f.yearTo));
    if (f.openAccessOnly) params.set("open_access", "true");
    const data = await getJSON<{ articles?: IEEEArticle[] }>(`https://ieeexploreapi.ieee.org/api/v1/search/articles?${params}`);
    return (data.articles ?? [])
      .filter((a) => a.title)
      .map((a) => {
        const oa = /open/i.test(a.access_type ?? "");
        return basePaper({
          idHint: `ieee:${a.doi ?? a.title}`,
          title: a.title!,
          authors: (a.authors?.authors ?? []).map((x) => x.full_name ?? "").filter(Boolean),
          year: a.publication_year ? Number(a.publication_year) : undefined,
          abstract: a.abstract,
          doi: a.doi,
          url: a.html_url ?? (a.doi ? `https://doi.org/${a.doi}` : undefined),
          pdfUrl: oa ? a.pdf_url : undefined,
          venue: a.publication_title,
          publisher: a.publisher ?? "IEEE",
          venueType: a.content_type,
          issn: a.issn ? [a.issn] : undefined,
          isOpenAccess: oa,
          isPreprint: false,
          label: "IEEE",
          citedBy: a.citing_paper_count,
          foundVia: ["ieee"],
        });
      });
  },
};

/* ---------------- Scopus indexing check (free Elsevier key) ---------------- */

const scopusCache = new Map<string, boolean>();

export async function checkScopus(papers: Paper[]): Promise<void> {
  const key = process.env.ELSEVIER_API_KEY;
  if (!key) return;
  const issns = [...new Set(papers.flatMap((p) => p.issn ?? []))].slice(0, 30);
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
