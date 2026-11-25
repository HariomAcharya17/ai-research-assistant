import { describe, expect, it } from "vitest";
import { classify, cleanForModel, MIN_WORDS, prepareChunks, summarize } from "./aidetect";

const sentence = (n: number) => `This is sentence number ${n} and it talks about the results of the study in plain words.`;
const para = (from: number, count: number) => Array.from({ length: count }, (_, i) => sentence(from + i)).join(" ");

describe("prepareChunks", () => {
  it("splits long text into chunks of about 200 words at sentence ends", () => {
    const { chunks } = prepareChunks(para(0, 60)); // about 1000 words in one paragraph
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    for (const c of chunks) {
      expect(c.words).toBeLessThanOrEqual(330);
      expect(c.text.trim().endsWith(".")).toBe(true);
    }
  });

  it("keeps headings as boundaries and records them", () => {
    const { chunks } = prepareChunks(`1. Introduction\n${para(0, 6)}\n\n2. Methods\n${para(10, 6)}`);
    expect(chunks.map((c) => c.heading)).toEqual(["1. Introduction", "2. Methods"]);
  });

  it("rejoins PDF lines wrapped in a two-column layout", () => {
    const wrapped = para(0, 8).replace(/(\S+ \S+ \S+ \S+ \S+ \S+) /g, "$1\n");
    const { chunks } = prepareChunks(wrapped);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading).toBeUndefined();
  });

  it("drops the reference list and quoted passages", () => {
    const text = `${para(0, 10)} As noted, "the model fails badly on every dataset we have tested so far" (Lee, 2020).\n\nReferences\n[1] Lee. A paper about models.`;
    const p = prepareChunks(text);
    expect(p.referencesCut).toBe(true);
    expect(p.chunks.some((c) => c.text.includes("[1] Lee"))).toBe(false);
    expect(p.chunks[0].quotedWords).toBeGreaterThan(10);
    expect(p.chunks[0].scoreText).not.toContain("fails badly");
  });

  it("folds a short tail into the previous chunk", () => {
    const { chunks } = prepareChunks(`${para(0, 12)}\n\nShort ending sentence here.`);
    expect(chunks.every((c) => c.words >= MIN_WORDS)).toBe(true);
  });

  it("flags non-English text", () => {
    expect(prepareChunks(para(0, 5)).likelyEnglish).toBe(true);
    expect(prepareChunks("Este estudio analiza los efectos del cambio climático sobre la producción de arroz en Asia del Sur durante tres décadas.").likelyEnglish).toBe(false);
  });

  it("cleans markdown before scoring", () => {
    expect(cleanForModel("## Title\n**Bold** and [link](http://x.y) text")).toBe("Title Bold and link text");
  });
});

describe("classify and summarize", () => {
  it("needs both models for likely AI", () => {
    expect(classify({ tmr: 0.99, fakespot: 0.97 }, 100)).toBe("likely-ai");
    expect(classify({ tmr: 0.99, fakespot: 0.1 }, 100)).toBe("possible-ai");
    expect(classify({ tmr: 0.5, fakespot: 0.6 }, 100)).toBe("likely-human");
    expect(classify({ tmr: 0.99, fakespot: 0.99 }, 10)).toBe("unscored");
    expect(classify(undefined, 100)).toBe("unscored");
  });

  it("reports shares of scored words", () => {
    const { chunks } = prepareChunks(`${para(0, 12)}\n\n${para(20, 12)}`);
    expect(chunks.length).toBe(2);
    const r = summarize(chunks, [
      { tmr: 0.99, fakespot: 0.99 },
      { tmr: 0.1, fakespot: 0.1 },
    ]);
    expect(r.share.likelyAi + r.share.likelyHuman).toBeCloseTo(100, 0);
    expect(r.share.possibleAi).toBe(0);
  });
});
