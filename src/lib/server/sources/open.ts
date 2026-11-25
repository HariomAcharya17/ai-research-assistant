import "server-only";
import type { Paper } from "@/lib/types";
import { terms } from "@/lib/text";
import { basePaper, getJSON, getText, str, xml, yearOk, type Adapter } from "./util";

// Free regional and subject archives that need no key.

/* ---------------- Europe PMC (includes all of PubMed, PMC and life-science preprints) ---------------- */

interface EPMCResult {
  id: string;
  source?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  authorList?: { author?: { fullName?: string; firstName?: string; lastName?: string; collectiveName?: string }[] };
  pubYear?: string;
  abstractText?: string;
  journalInfo?: { journal?: { title?: string; issn?: string; essn?: string } };
  bookOrReportDetails?: { publisher?: string };
  isOpenAccess?: string;
  inPMC?: string;
  citedByCount?: number;
  pubTypeList?: { pubType?: string[] };
  fullTextUrlList?: { fullTextUrl?: { availabilityCode?: string; documentStyle?: string; url?: string }[] };
}

export const europepmc: Adapter = {
  id: "europepmc",
  coverage: "45M+ life-science and medical records: all of PubMed, PubMed Central and bioRxiv/medRxiv preprints",
  queries: 2,
  async search(query, f) {
    let q = query;
    if (f.yearFrom || f.yearTo) q += ` AND (FIRST_PDATE:[${f.yearFrom ?? 1800}-01-01 TO ${f.yearTo ?? 2100}-12-31])`;
    if (f.openAccessOnly) q += " AND (OPEN_ACCESS:y)";
    const params = new URLSearchParams({ query: q, format: "json", pageSize: "20", resultType: "core" });
    const data = await getJSON<{ resultList?: { result?: EPMCResult[] } }>(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`,
    );
    return (data.resultList?.result ?? [])
      .filter((r) => r.title)
      .map((r) => {
        const preprint = r.source === "PPR";
        const pdf = r.fullTextUrlList?.fullTextUrl?.find((u) => u.documentStyle === "pdf" && u.availabilityCode === "OA")?.url;
        const venue = r.journalInfo?.journal?.title ?? r.bookOrReportDetails?.publisher;
        const authors =
          r.authorList?.author?.map((a) => a.collectiveName ?? ([a.firstName, a.lastName].filter(Boolean).join(" ") || a.fullName || "")) ??
          r.authorString?.replace(/\.$/, "").split(", ") ??
          [];
        return basePaper({
          idHint: `epmc:${r.source}:${r.id}`,
          title: r.title!,
          authors: authors.filter(Boolean),
          year: r.pubYear ? Number(r.pubYear) : undefined,
          abstract: r.abstractText,
          doi: r.doi,
          url: r.pmcid
            ? `https://europepmc.org/article/PMC/${r.pmcid}`
            : r.pmid
              ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`
              : `https://europepmc.org/article/${r.source}/${r.id}`,
          pdfUrl: pdf,
          pmcid: r.inPMC === "Y" && r.isOpenAccess === "Y" ? r.pmcid : undefined,
          venue,
          publisher: preprint ? r.bookOrReportDetails?.publisher : undefined,
          venueType: preprint ? "preprint" : "journal",
          issn: [r.journalInfo?.journal?.issn, r.journalInfo?.journal?.essn].filter((x): x is string => Boolean(x)),
          isOpenAccess: r.isOpenAccess === "Y",
          isPreprint: preprint,
          citedBy: r.citedByCount,
          foundVia: ["europepmc"],
        });
      });
  },
};

/* ---------------- arXiv ---------------- */

interface ArxivEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  author?: { name?: string }[];
  link?: { "@href"?: string; "@title"?: string; "@type"?: string }[];
  doi?: string;
  journal_ref?: string;
  primary_category?: { "@term"?: string };
}

export const arxiv: Adapter = {
  id: "arxiv",
  coverage: "2.5M+ preprints in physics, mathematics, computer science, statistics, economics and biology",
  queries: 1,
  async search(query, f) {
    const words = [...new Set(terms(query))].slice(0, 5);
    if (!words.length) return [];
    // Require the first three terms, and let the rest rank results.
    let q = words.slice(0, 3).map((w) => `all:${w}`).join(" AND ");
    if (f.yearFrom || f.yearTo)
      q += ` AND submittedDate:[${f.yearFrom ?? 1991}01010000 TO ${f.yearTo ?? 2100}12312359]`;
    const params = new URLSearchParams({ search_query: q, max_results: "20", sortBy: "relevance" });
    const text = await getText(`https://export.arxiv.org/api/query?${params}`);
    const feed = xml.parse(text) as { feed?: { entry?: ArxivEntry[] } };
    return (feed.feed?.entry ?? [])
      .filter((e) => e.title && e.id)
      .map((e) => {
        const id = String(e.id).replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "");
        const pdf = e.link?.find((l) => l["@title"] === "pdf")?.["@href"];
        return basePaper({
          idHint: `arxiv:${id}`,
          title: String(e.title).replace(/\s+/g, " "),
          authors: (e.author ?? []).map((a) => str(a.name) ?? "").filter(Boolean),
          year: e.published ? Number(String(e.published).slice(0, 4)) : undefined,
          abstract: str(e.summary)?.replace(/\s+/g, " "),
          // Journal DOI when the authors added one, otherwise arXiv's own DataCite DOI.
          doi: str(e.doi) ?? `10.48550/arXiv.${id}`,
          url: `https://arxiv.org/abs/${id}`,
          pdfUrl: pdf?.replace(/^http:/, "https:"),
          arxivId: id,
          venue: str(e.journal_ref) ?? "arXiv",
          publisher: "arXiv",
          venueType: "preprint",
          isOpenAccess: true,
          isPreprint: !str(e.doi),
          label: "arXiv",
          foundVia: ["arxiv"],
        });
      })
      .filter((p) => yearOk(p.year, f));
  },
};

/* ---------------- DOAJ ---------------- */

interface DOAJArticle {
  id: string;
  bibjson?: {
    title?: string;
    abstract?: string;
    year?: string;
    author?: { name?: string }[];
    identifier?: { id?: string; type?: string }[];
    journal?: { title?: string; publisher?: string; issns?: string[]; country?: string };
    link?: { type?: string; url?: string }[];
  };
}

export const doaj: Adapter = {
  id: "doaj",
  coverage: "10M+ articles from 20,000+ peer-reviewed open-access journals in 130 countries",
  queries: 1,
  async search(query, f) {
    let q = query.replace(/[/:]/g, " ");
    if (f.yearFrom || f.yearTo) q += ` AND bibjson.year:[${f.yearFrom ?? 1800} TO ${f.yearTo ?? 2100}]`;
    const data = await getJSON<{ results?: DOAJArticle[] }>(
      `https://doaj.org/api/search/articles/${encodeURIComponent(q)}?pageSize=20`,
    );
    return (data.results ?? [])
      .filter((r) => r.bibjson?.title)
      .map((r) => {
        const b = r.bibjson!;
        const doi = b.identifier?.find((i) => i.type?.toLowerCase() === "doi")?.id;
        const link = b.link?.find((l) => l.type === "fulltext")?.url;
        return basePaper({
          idHint: `doaj:${r.id}`,
          title: b.title!,
          authors: (b.author ?? []).map((a) => a.name ?? "").filter(Boolean),
          year: b.year ? Number(b.year) : undefined,
          abstract: b.abstract,
          doi,
          url: link ?? (doi ? `https://doi.org/${doi}` : `https://doaj.org/article/${r.id}`),
          venue: b.journal?.title,
          publisher: b.journal?.publisher,
          venueType: "journal",
          issn: b.journal?.issns,
          isOpenAccess: true,
          isPreprint: false,
          foundVia: ["doaj"],
          indexing: { doaj: true, scopus: null },
        });
      });
  },
};

/* ---------------- HAL (France's national open archive) ---------------- */

interface HALDoc {
  docid: string;
  title_s?: string[];
  authFullName_s?: string[];
  producedDateY_i?: number;
  abstract_s?: string[];
  doiId_s?: string;
  uri_s?: string;
  fileMain_s?: string;
  journalTitle_s?: string;
  journalPublisher_s?: string;
  docType_s?: string;
  openAccess_bool?: boolean;
}

export const hal: Adapter = {
  id: "hal",
  coverage: "4M+ records from French and European research institutions, many with full text",
  queries: 1,
  async search(query, f) {
    const params = new URLSearchParams({
      q: query,
      rows: "15",
      wt: "json",
      fl: "docid,title_s,authFullName_s,producedDateY_i,abstract_s,doiId_s,uri_s,fileMain_s,journalTitle_s,journalPublisher_s,docType_s,openAccess_bool",
    });
    if (f.yearFrom || f.yearTo) params.append("fq", `producedDateY_i:[${f.yearFrom ?? "*"} TO ${f.yearTo ?? "*"}]`);
    if (f.openAccessOnly) params.append("fq", "openAccess_bool:true");
    const data = await getJSON<{ response?: { docs?: HALDoc[] } }>(`https://api.archives-ouvertes.fr/search/?${params}`);
    return (data.response?.docs ?? [])
      .filter((d) => d.title_s?.[0])
      .map((d) =>
        basePaper({
          idHint: `hal:${d.docid}`,
          title: d.title_s![0],
          authors: d.authFullName_s ?? [],
          year: d.producedDateY_i,
          abstract: d.abstract_s?.[0],
          doi: d.doiId_s,
          url: d.uri_s,
          pdfUrl: d.fileMain_s,
          venue: d.journalTitle_s ?? "HAL",
          publisher: d.journalPublisher_s,
          venueType: d.docType_s,
          isOpenAccess: d.openAccess_bool,
          isPreprint: d.docType_s === "UNDEFINED" || d.docType_s === "PREPRINT" ? true : undefined,
          label: d.journalPublisher_s ? undefined : "HAL",
          foundVia: ["hal"],
        }),
      );
  },
};

/* ---------------- ERIC (education research, US Dept. of Education) ---------------- */

interface ERICDoc {
  id: string;
  title?: string;
  author?: string[];
  description?: string;
  publicationdateyear?: number;
  source?: string;
  url?: string;
  issn?: string[];
  peerreviewed?: string;
  e_fulltextauth?: number;
}

export const eric: Adapter = {
  id: "eric",
  coverage: "1.9M+ education research records, many with free full text",
  queries: 1,
  async search(query, f) {
    const params = new URLSearchParams({
      search: query,
      rows: "15",
      format: "json",
      fields: "id,title,author,description,publicationdateyear,source,url,issn,peerreviewed,e_fulltextauth",
    });
    const data = await getJSON<{ response?: { docs?: ERICDoc[] } }>(`https://api.ies.ed.gov/eric/?${params}`);
    return (data.response?.docs ?? [])
      .filter((d) => d.title)
      .map((d) => {
        const doi = d.url && /doi\.org\//.test(d.url) ? d.url : undefined;
        return basePaper({
          idHint: `eric:${d.id}`,
          title: d.title!,
          authors: (d.author ?? []).map((a) => a.split(", ").reverse().join(" ")),
          year: d.publicationdateyear,
          abstract: d.description,
          doi,
          url: `https://eric.ed.gov/?id=${d.id}`,
          pdfUrl: d.e_fulltextauth === 1 ? `https://files.eric.ed.gov/fulltext/${d.id}.pdf` : undefined,
          venue: d.source,
          venueType: d.id.startsWith("EJ") ? "journal" : "report",
          issn: d.issn?.map((i) => i.replace(/^ISSN-/, "")),
          isPreprint: false,
          label: "ERIC",
          foundVia: ["eric"],
        });
      })
      .filter((p) => yearOk(p.year, f) && (!f.openAccessOnly || p.isOpenAccess));
  },
};

/* ---------------- INSPIRE-HEP (high-energy physics) ---------------- */

interface InspireHit {
  id: string;
  metadata: {
    titles?: { title?: string }[];
    authors?: { full_name?: string }[];
    abstracts?: { value?: string }[];
    dois?: { value?: string }[];
    publication_info?: { journal_title?: string; year?: number }[];
    arxiv_eprints?: { value?: string }[];
    citation_count?: number;
    earliest_date?: string;
  };
}

export const inspire: Adapter = {
  id: "inspire",
  coverage: "1.6M+ records in high-energy physics, astrophysics and related fields",
  queries: 1,
  async search(query, f) {
    const params = new URLSearchParams({
      q: query,
      size: "10",
      fields: "titles,authors.full_name,abstracts,dois,publication_info,arxiv_eprints,citation_count,earliest_date",
    });
    const data = await getJSON<{ hits?: { hits?: InspireHit[] } }>(`https://inspirehep.net/api/literature?${params}`);
    return (data.hits?.hits ?? [])
      .filter((h) => h.metadata.titles?.[0]?.title)
      .map((h) => {
        const m = h.metadata;
        const arxivId = m.arxiv_eprints?.[0]?.value;
        const journal = m.publication_info?.find((p) => p.journal_title);
        return basePaper({
          idHint: `inspire:${h.id}`,
          title: m.titles![0].title!,
          authors: (m.authors ?? []).slice(0, 50).map((a) => (a.full_name ?? "").split(", ").reverse().join(" ")),
          year: journal?.year ?? (m.earliest_date ? Number(m.earliest_date.slice(0, 4)) : undefined),
          abstract: m.abstracts?.[0]?.value,
          doi: m.dois?.[0]?.value ?? (arxivId ? `10.48550/arXiv.${arxivId}` : undefined),
          url: `https://inspirehep.net/literature/${h.id}`,
          pdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}` : undefined,
          arxivId,
          venue: journal?.journal_title ?? (arxivId ? "arXiv" : undefined),
          isPreprint: !journal,
          citedBy: m.citation_count,
          foundVia: ["inspire"],
        });
      })
      .filter((p) => yearOk(p.year, f) && (!f.openAccessOnly || p.isOpenAccess));
  },
};

/* ---------------- J-STAGE (Japanese journals) ---------------- */

interface JStageEntry {
  article_title?: { en?: unknown; ja?: unknown };
  article_link?: { en?: unknown; ja?: unknown };
  author?: { en?: { name?: unknown[] }; ja?: { name?: unknown[] } }[];
  material_title?: { en?: unknown; ja?: unknown };
  pubyear?: unknown;
  doi?: unknown;
  issn?: unknown;
  eIssn?: unknown;
}

export const jstage: Adapter = {
  id: "jstage",
  coverage: "5M+ articles from 3,000+ Japanese journals and proceedings",
  queries: 1,
  async search(query, f) {
    const params = new URLSearchParams({ service: "3", text: query, count: "15" });
    if (f.yearFrom) params.set("pubyearfrom", String(f.yearFrom));
    if (f.yearTo) params.set("pubyearto", String(f.yearTo));
    const text = await getText(`https://api.jstage.jst.go.jp/searchapi/do?${params}`);
    const feed = xml.parse(text) as { feed?: { entry?: JStageEntry[] } };
    return (feed.feed?.entry ?? [])
      .map((e) => {
        const title = str(e.article_title?.en) ?? str(e.article_title?.ja);
        if (!title) return null;
        const names = e.author?.[0]?.en?.name ?? e.author?.[0]?.ja?.name ?? [];
        return basePaper({
          idHint: `jstage:${str(e.article_link?.en) ?? title}`,
          title,
          authors: names.map((n) => str(n) ?? "").filter(Boolean),
          year: Number(str(e.pubyear)) || undefined,
          doi: str(e.doi),
          url: str(e.article_link?.en) ?? str(e.article_link?.ja),
          venue: str(e.material_title?.en) ?? str(e.material_title?.ja),
          venueType: "journal",
          issn: [str(e.issn), str(e.eIssn)].filter((x): x is string => Boolean(x)),
          // J-STAGE content is free to read in most journals, but the API does not say which.
          isPreprint: false,
          label: "J-STAGE",
          foundVia: ["jstage"],
        });
      })
      .filter((p): p is Paper => p !== null && (!f.openAccessOnly || p.isOpenAccess));
  },
};
