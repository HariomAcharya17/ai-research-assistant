import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Paper } from "@/lib/types";
import { jatsToPassages } from "./fulltext";
import { mergePapers } from "./sources";
import { basePaper, cleanDoi, publisherLabel } from "./sources/util";

const p = (over: Partial<Paper> & { idHint: string; title: string }) =>
  basePaper({ authors: [], foundVia: ["openalex"], ...over });

describe("source helpers", () => {
  it("cleans DOIs", () => {
    expect(cleanDoi("https://doi.org/10.1000/ABC.1")).toBe("10.1000/ABC.1");
    expect(cleanDoi("doi: 10.1000/x")).toBe("10.1000/x");
    expect(cleanDoi("not a doi")).toBeUndefined();
  });

  it("labels publishers", () => {
    expect(publisherLabel("Multidisciplinary Digital Publishing Institute")).toBe("MDPI");
    expect(publisherLabel("Institute of Electrical and Electronics Engineers")).toBe("IEEE");
    expect(publisherLabel(undefined, "medRxiv")).toBe("bioRxiv/medRxiv");
    expect(publisherLabel("Some Society Press")).toBe("Some Society Press");
  });

  it("flags preprints", () => {
    expect(p({ idHint: "a", title: "A long enough title", venue: "arXiv" }).isPreprint).toBe(true);
    expect(p({ idHint: "b", title: "A long enough title", venue: "Nature" }).isPreprint).toBe(false);
  });
});

describe("mergePapers", () => {
  it("merges by DOI and by title, keeping the richest fields", () => {
    const a = p({ idHint: "oa:1", title: "Deep Learning for Crops", doi: "10.1/X", year: 2020, publisher: "Elsevier BV" });
    const b = { ...p({ idHint: "s2:1", title: "Deep learning for crops", doi: "10.1/x", abstract: "Long abstract text here." }), foundVia: ["semanticscholar" as const] };
    const c = { ...p({ idHint: "arxiv:1", title: "Deep Learning for Crops", venue: "arXiv", pdfUrl: "https://arxiv.org/pdf/1" }), foundVia: ["arxiv" as const] };
    const out = mergePapers([[a], [b], [c]]);
    expect(out).toHaveLength(1);
    expect(out[0].abstract).toBe("Long abstract text here.");
    expect(out[0].pdfUrl).toBe("https://arxiv.org/pdf/1");
    expect(out[0].label).toBe("Elsevier");
    expect(out[0].isPreprint).toBe(false);
    expect(out[0].foundVia).toEqual(["openalex", "semanticscholar", "arxiv"]);
  });
});

describe("jatsToPassages", () => {
  it("keeps sections, drops figures and stops at references", () => {
    const xml = `<article><front><abstract><p>We study rice yields across many farms in detail, using satellite data.</p></abstract></front>
      <body><sec><title>1. Introduction</title><p>Rice is a staple crop for billions of people <xref>[1]</xref> and yields vary greatly.</p>
      <fig><caption><p>Figure caption that should not appear anywhere.</p></caption></fig></sec>
      <sec><title>Limitations</title><p>Our data come from one province only, so results may not generalise to other regions.</p></sec>
      <sec><title>References</title><p>Ignored reference text that is long enough to count.</p></sec></body></article>`;
    const out = jatsToPassages(xml, 50);
    expect(out.map((x) => x.section)).toEqual(["Abstract", "Introduction", "Limitations"]);
    expect(out.some((x) => x.text.includes("Figure caption"))).toBe(false);
    expect(out[1].text).not.toContain("[1]");
  });

  it("parses a real PMC article when a sample is present", () => {
    if (!existsSync("/tmp/pmc.xml")) return;
    const out = jatsToPassages(readFileSync("/tmp/pmc.xml", "utf8"));
    expect(out.length).toBeGreaterThan(10);
  });
});
