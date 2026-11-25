import "server-only";
import type { Paper, SearchFilters, SourceId, SourceStatus } from "@/lib/types";
import { SOURCE_NAMES } from "@/lib/types";
import { aiConfigured } from "../groq";
import { crossref, openalex, semanticscholar } from "./core";
import { checkScopus, core, ieee, springer } from "./keyed";
import { arxiv, doaj, eric, europepmc, hal, inspire, jstage } from "./open";
import { titleKey, type Adapter } from "./util";

export { cleanDoi, publisherLabel } from "./util";
export { fillFromS2, openAlexOA } from "./core";

// Order matters: when the same paper comes from several sources, earlier
// sources win for fields like the publisher label.
export const ADAPTERS: Adapter[] = [
  openalex,
  crossref,
  springer,
  ieee,
  europepmc,
  semanticscholar,
  arxiv,
  core,
  doaj,
  hal,
  eric,
  inspire,
  jstage,
];

const enabled = (a: Adapter) => !a.keyRequired || Boolean(a.key && process.env[a.key]);

export function sourceStatus(): SourceStatus {
  return {
    ai: aiConfigured(),
    scopus: Boolean(process.env.ELSEVIER_API_KEY),
    unpaywall: Boolean(process.env.CONTACT_EMAIL),
    sources: ADAPTERS.map((a) => ({
      id: a.id,
      name: SOURCE_NAMES[a.id],
      coverage: a.coverage,
      on: enabled(a),
      key: a.key,
      keyRequired: a.keyRequired,
    })),
  };
}

function mergeInto(a: Paper, b: Paper): Paper {
  const longer = (x?: string, y?: string) => ((y?.length ?? 0) > (x?.length ?? 0) ? y : x);
  return {
    ...a,
    authors: a.authors.length ? a.authors : b.authors,
    year: a.year ?? b.year,
    abstract: longer(a.abstract, b.abstract),
    doi: a.doi ?? b.doi,
    url: a.url ?? b.url,
    pdfUrl: a.pdfUrl ?? b.pdfUrl,
    pmcid: a.pmcid ?? b.pmcid,
    arxivId: a.arxivId ?? b.arxivId,
    venue: a.venue ?? b.venue,
    publisher: a.publisher ?? b.publisher,
    venueType: a.venueType ?? b.venueType,
    issn: a.issn?.length ? a.issn : b.issn,
    isOpenAccess: a.isOpenAccess || b.isOpenAccess,
    // Peer-reviewed if any source has it as a journal or conference version.
    isPreprint: a.isPreprint === false || b.isPreprint === false ? false : Boolean(a.isPreprint || b.isPreprint),
    citedBy: Math.max(a.citedBy ?? 0, b.citedBy ?? 0) || undefined,
    foundVia: [...new Set([...a.foundVia, ...b.foundVia])],
    label: a.label === "Other" || (a.label === "arXiv" && b.isPreprint === false) ? b.label : a.label,
    indexing: { doaj: a.indexing.doaj || b.indexing.doaj || undefined, scopus: a.indexing.scopus ?? b.indexing.scopus },
  };
}

export function mergePapers(lists: Paper[][]): Paper[] {
  const byKey = new Map<string, Paper>();
  const byTitle = new Map<string, string>();
  for (const list of lists) {
    for (const p of list) {
      const tk = titleKey(p.title);
      if (tk.length < 8) continue;
      const doiKey = p.doi?.toLowerCase();
      const key = (doiKey && byKey.has(doiKey) && doiKey) || byTitle.get(tk) || p.id;
      const existing = byKey.get(key);
      byKey.set(key, existing ? mergeInto(existing, p) : p);
      byTitle.set(tk, key);
    }
  }
  return [...byKey.values()];
}

export interface SourceResult {
  id: SourceId;
  ok: boolean;
  count: number;
  error?: string;
}

export async function searchAll(queries: string[], filters: SearchFilters): Promise<{ papers: Paper[]; sources: SourceResult[] }> {
  const active = ADAPTERS.filter(enabled);
  const jobs = active.flatMap((a) => queries.slice(0, a.queries).map((q) => ({ a, run: () => a.search(q, filters) })));
  const settled = await Promise.allSettled(jobs.map((j) => j.run()));

  const perSource = new Map<SourceId, SourceResult>(active.map((a) => [a.id, { id: a.id, ok: false, count: 0 }]));
  const listsBySource = new Map<SourceId, Paper[][]>();
  settled.forEach((r, i) => {
    const id = jobs[i].a.id;
    const cur = perSource.get(id)!;
    if (r.status === "fulfilled") {
      cur.ok = true;
      cur.count += r.value.length;
      cur.error = undefined;
      listsBySource.set(id, [...(listsBySource.get(id) ?? []), r.value]);
    } else if (!cur.ok) {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      cur.error = /timeout|aborted/i.test(msg)
        ? "timed out"
        : / 429$/.test(msg)
          ? "busy: free rate limit reached"
          : msg.replace(/^\S+ (\d{3})$/, "error $1");
    }
  });

  // Merge in adapter order so the most authoritative metadata wins.
  const lists = active.flatMap((a) => listsBySource.get(a.id) ?? []);
  let papers = mergePapers(lists);
  if (filters.openAccessOnly) papers = papers.filter((p) => p.isOpenAccess);
  if (filters.yearFrom) papers = papers.filter((p) => !p.year || p.year >= filters.yearFrom!);
  if (filters.yearTo) papers = papers.filter((p) => !p.year || p.year <= filters.yearTo!);

  await checkScopus(papers);
  return { papers, sources: [...perSource.values()] };
}
