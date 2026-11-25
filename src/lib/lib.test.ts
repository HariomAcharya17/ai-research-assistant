import { describe, expect, it } from "vitest";
import { bm25, containsLoose, sentences, terms } from "./text";
import { checkSimilarity } from "./similarity";
import { detectHeading, selectPassages, toPassages } from "./passages";

describe("text", () => {
  it("drops stopwords and stems plurals", () => {
    expect(terms("The networks are using graphs")).toEqual(["network", "graph"]);
  });

  it("ranks the matching document first with BM25", () => {
    const s = bm25("federated learning for medical imaging", [
      "Deep learning for stock prices",
      "Federated learning in medical imaging: a privacy-preserving approach",
      "Medical records management",
    ]);
    expect(s.indexOf(Math.max(...s))).toBe(1);
  });

  it("splits sentences with offsets", () => {
    const text = "First one here. Second one! Third?";
    const out = sentences(text);
    expect(out.map((s) => s.text)).toEqual(["First one here.", "Second one!", "Third?"]);
    expect(text.slice(out[1].start, out[1].end)).toBe("Second one!");
  });

  it("matches quotes loosely", () => {
    expect(containsLoose("We note that the dataset is small, which limits generality.", "the dataset is  small which limits")).toBe(true);
    expect(containsLoose("We note that the dataset is small.", "the dataset is large")).toBe(false);
  });
});

describe("similarity", () => {
  const source =
    "Federated learning enables multiple hospitals to collaboratively train a shared model without exchanging raw patient data, which preserves privacy.";

  it("flags copied sentences and ignores original ones", () => {
    const draft =
      "Federated learning enables multiple hospitals to collaboratively train a shared model without exchanging raw patient data. " +
      "Our study instead examines how small rural clinics with limited bandwidth can join such networks.";
    const r = checkSimilarity(draft, [{ paperId: "x", title: "Paper X", kind: "abstract", text: source }]);
    expect(r.sentences[0].level).toBe("strong");
    expect(r.sentences[0].match?.paperId).toBe("x");
    expect(r.sentences[1].level).toBe("none");
    expect(r.strongWords).toBeGreaterThan(0);
    expect(r.byPaper[0].paperId).toBe("x");
  });

  it("counts quoted text separately", () => {
    const draft = `"Federated learning enables multiple hospitals to collaboratively train a shared model without exchanging raw patient data" (Smith, 2023).`;
    const r = checkSimilarity(draft, [{ paperId: "x", title: "Paper X", kind: "abstract", text: source }]);
    expect(r.quotedWords).toBeGreaterThan(0);
    expect(r.strongWords).toBe(0);
  });
});

describe("passages", () => {
  it("detects numbered headings", () => {
    expect(detectHeading("2. Related Work")).toBe("Related Work");
    expect(detectHeading("IV. EXPERIMENTS")).toBe("Experiments");
    expect(detectHeading("This introduction is long text that is not a heading at all, really")).toBeNull();
  });

  it("splits pages into sections and stops at references", () => {
    const pages = [
      "Abstract\nWe study things in detail and find many interesting outcomes for the field of study here.\n1 Introduction\nThe problem is important because it matters to many people in many places around the world.",
      "5 Limitations\nOur sample is small and drawn from a single site, so results may not generalise widely at all.\nReferences\n[1] Someone. A paper.",
    ];
    const p = toPassages(pages);
    expect(p.map((x) => x.section)).toEqual(["Abstract", "Introduction", "Limitations"]);
    expect(p[2].page).toBe(2);
    expect(p.some((x) => x.text.includes("Someone"))).toBe(false);
    expect(selectPassages(p, 10_000).length).toBe(3);
  });
});
