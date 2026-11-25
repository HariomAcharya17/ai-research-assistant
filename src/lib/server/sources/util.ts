import "server-only";
import { XMLParser } from "fast-xml-parser";
import { SOURCE_NAMES, type Paper, type SearchFilters, type SourceId } from "@/lib/types";
import { normalize, stripTags } from "@/lib/text";

export const UA = "ai-research-assistant/0.2 (open-source research helper)";
export const TIMEOUT = 20_000;

export interface Adapter {
  id: SourceId;
  coverage: string;
  /** Env var that enables the source (keyRequired) or raises its limits. */
  key?: string;
  keyRequired?: boolean;
  /** How many of the planned queries this source receives. */
  queries: number;
  search: (query: string, filters: SearchFilters) => Promise<Paper[]>;
}

export async function getJSON<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return (await res.json()) as T;
}

export async function getText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.text();
}

export const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  textNodeName: "#text",
  isArray: (name) => ["entry", "link", "author", "name", "category"].includes(name),
});

/** Coerce a parsed XML/JSON node to a trimmed string. */
export function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string" || typeof v === "number") return String(v).trim() || undefined;
  if (Array.isArray(v)) return str(v[0]);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return str((v as Record<string, unknown>)["#text"]);
  return undefined;
}

export function cleanDoi(doi?: string | null): string | undefined {
  if (!doi) return undefined;
  const d = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
  return /^10\.\d{4,9}\/\S+$/.test(d) ? d : undefined;
}

export function yearOk(year: number | undefined, f: SearchFilters): boolean {
  if (!year) return true;
  if (f.yearFrom && year < f.yearFrom) return false;
  if (f.yearTo && year > f.yearTo) return false;
  return true;
}

export function publisherLabel(publisher?: string, venue?: string): string {
  const p = `${publisher ?? ""} ${venue ?? ""}`.toLowerCase();
  if (/arxiv/.test(p)) return "arXiv";
  if (/medrxiv|biorxiv|cold spring/.test(p)) return "bioRxiv/medRxiv";
  if (/springer|nature portfolio|nature research|biomed central|\bbmc\b/.test(p)) return "Springer";
  if (/ieee|institute of electrical/.test(p)) return "IEEE";
  if (/elsevier|cell press/.test(p)) return "Elsevier";
  if (/association for computing machinery|\bacm\b/.test(p)) return "ACM";
  if (/wiley/.test(p)) return "Wiley";
  if (/mdpi|multidisciplinary digital publishing/.test(p)) return "MDPI";
  if (/taylor|routledge|informa/.test(p)) return "Taylor & Francis";
  if (/\bsage\b/.test(p)) return "SAGE";
  if (/oxford university press/.test(p)) return "Oxford";
  if (/cambridge university press/.test(p)) return "Cambridge";
  if (/frontiers/.test(p)) return "Frontiers";
  if (/plos|public library of science/.test(p)) return "PLOS";
  if (/hindawi/.test(p)) return "Hindawi";
  if (/emerald/.test(p)) return "Emerald";
  if (/de gruyter/.test(p)) return "De Gruyter";
  if (/american chemical society/.test(p)) return "ACS";
  if (/royal society of chemistry/.test(p)) return "RSC";
  if (/american physical society/.test(p)) return "APS";
  if (/iop publishing|institute of physics/.test(p)) return "IOP";
  if (/scielo/.test(p)) return "SciELO";
  if (/j-stage|japan science and technology/.test(p)) return "J-STAGE";
  if (/pubmed|ncbi|europe pmc/.test(p)) return "PubMed Central";
  if (/ssrn/.test(p)) return "SSRN";
  if (/zenodo/.test(p)) return "Zenodo";
  if (/\bhal\b|archives ouvertes/.test(p)) return "HAL";
  return publisher?.trim() || venue?.trim() || "Other";
}

const PREPRINT = /arxiv|biorxiv|medrxiv|ssrn|preprint|research square|chemrxiv|psyarxiv|osf preprints|techrxiv|preprints\.org|zenodo/i;

export function looksPreprint(...fields: (string | undefined)[]): boolean {
  return PREPRINT.test(fields.filter(Boolean).join(" "));
}

export function basePaper(
  p: Omit<Paper, "id" | "label" | "indexing" | "isOpenAccess"> & {
    idHint: string;
    label?: string;
    isOpenAccess?: boolean;
    indexing?: Paper["indexing"];
  },
): Paper {
  const { idHint, label, isOpenAccess, indexing, ...rest } = p;
  const doi = cleanDoi(rest.doi);
  const derived = publisherLabel(rest.publisher, rest.venue);
  return {
    ...rest,
    title: stripTags(rest.title),
    abstract: rest.abstract ? stripTags(rest.abstract) || undefined : undefined,
    doi,
    id: doi ? doi.toLowerCase() : `${idHint}`,
    // With no publisher or venue, label the paper by the archive it came from.
    label: label ?? (derived === "Other" && rest.foundVia[0] ? SOURCE_NAMES[rest.foundVia[0]] : derived),
    isOpenAccess: Boolean(isOpenAccess || rest.pdfUrl || rest.pmcid),
    isPreprint: rest.isPreprint ?? looksPreprint(rest.venue, rest.publisher, rest.venueType),
    indexing: indexing ?? { scopus: null },
  };
}

export const titleKey = (title: string) => normalize(title).slice(0, 120);
