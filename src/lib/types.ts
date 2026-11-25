// Shared types used by the API routes and the client.

export type SourceId =
  | "openalex"
  | "semanticscholar"
  | "crossref"
  | "europepmc"
  | "arxiv"
  | "doaj"
  | "hal"
  | "eric"
  | "inspire"
  | "jstage"
  | "core"
  | "springer"
  | "ieee";

export const SOURCE_NAMES: Record<SourceId, string> = {
  openalex: "OpenAlex",
  semanticscholar: "Semantic Scholar",
  crossref: "Crossref",
  europepmc: "Europe PMC / PubMed",
  arxiv: "arXiv",
  doaj: "DOAJ",
  hal: "HAL",
  eric: "ERIC",
  inspire: "INSPIRE-HEP",
  jstage: "J-STAGE",
  core: "CORE",
  springer: "Springer Nature API",
  ieee: "IEEE Xplore API",
};

export interface Relevance {
  /** 0-100. With method "ai" it is a rubric score; with "keyword" it is scaled BM25. */
  score: number;
  level: "high" | "medium" | "low";
  why: string;
  aspects: string[];
  method: "ai" | "keyword";
}

export interface Paper {
  /** Stable key: lower-case DOI when present, otherwise a source-specific id. */
  id: string;
  title: string;
  authors: string[];
  year?: number;
  abstract?: string;
  doi?: string;
  /** Publisher or landing page. */
  url?: string;
  /** Open-access PDF, when one is known. */
  pdfUrl?: string;
  /** PubMed Central id: open full text as structured XML from Europe PMC. */
  pmcid?: string;
  arxivId?: string;
  /** Preprints and other work not (yet) peer reviewed. */
  isPreprint?: boolean;
  venue?: string;
  publisher?: string;
  venueType?: string;
  issn?: string[];
  isOpenAccess: boolean;
  citedBy?: number;
  /** Which search APIs returned this paper. */
  foundVia: SourceId[];
  /** Short publisher label shown as a badge, e.g. "Springer", "IEEE", "arXiv". */
  label: string;
  indexing: {
    /** From OpenAlex source metadata. */
    doaj?: boolean;
    /** true/false when checked with the Elsevier Serial Title API; null when not checked. */
    scopus: boolean | null;
  };
  lexical?: number;
  relevance?: Relevance;
}

export interface Passage {
  id: string;
  section: string;
  page?: number;
  text: string;
}

export interface Claim {
  text: string;
  /** Passage ids the claim is based on. */
  refs: string[];
}

export interface Summary {
  basis: "fulltext" | "abstract";
  researchQuestion: Claim;
  methods: Claim[];
  findings: Claim[];
  limitations: Claim[];
  createdAt: number;
}

export interface StatedLimitation {
  paperId: string;
  limitation: string;
  /** Exact text from the paper, checked on the server. */
  quote: string;
  basis: "fulltext" | "abstract";
}

export interface SuggestedQuestion {
  question: string;
  rationale: string;
  buildsOn: string[];
}

export interface Gaps {
  stated: StatedLimitation[];
  suggested: SuggestedQuestion[];
  createdAt: number;
}

export interface SearchFilters {
  yearFrom?: number;
  yearTo?: number;
  openAccessOnly?: boolean;
}

export interface SourceInfo {
  id: SourceId;
  name: string;
  /** What the source covers, shown to the user. */
  coverage: string;
  on: boolean;
  /** Environment variable that turns it on or raises its limits. */
  key?: string;
  keyRequired?: boolean;
}

export interface SourceStatus {
  ai: boolean;
  scopus: boolean;
  unpaywall: boolean;
  sources: SourceInfo[];
}

export const CITATION_STYLES = [
  { id: "apa", name: "APA 7th" },
  { id: "ieee", name: "IEEE" },
  { id: "modern-language-association", name: "MLA 9th" },
  { id: "chicago-author-date", name: "Chicago (author-date)" },
  { id: "harvard-cite-them-right", name: "Harvard" },
  { id: "vancouver", name: "Vancouver" },
] as const;

export type CitationStyle = (typeof CITATION_STYLES)[number]["id"];
