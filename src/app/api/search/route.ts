import { z } from "zod";
import { route } from "@/lib/server/http";
import { fillFromS2, searchAll } from "@/lib/server/sources";
import { bm25 } from "@/lib/text";
import type { Paper } from "@/lib/types";

export const maxDuration = 60;

const Body = z.object({
  idea: z.string().trim().min(10).max(6000),
  queries: z.array(z.string().trim().min(2).max(200)).min(1).max(4),
  keywords: z.array(z.string().max(80)).max(12).default([]),
  filters: z
    .object({
      yearFrom: z.number().int().min(1900).max(2100).optional(),
      yearTo: z.number().int().min(1900).max(2100).optional(),
      openAccessOnly: z.boolean().optional(),
    })
    .default({}),
});

const MAX_RESULTS = 50;

export async function POST(req: Request) {
  return route(req, Body, async ({ idea, queries, keywords, filters }) => {
    const { papers: all, sources } = await searchAll(queries, filters);
    // Keyword relevance (BM25) over title and abstract. The title counts twice.
    const query = `${idea} ${keywords.join(" ")} ${queries.join(" ")}`;
    const score = (list: Paper[]) => bm25(query, list.map((p) => `${p.title} ${p.title} ${p.abstract ?? ""}`));
    // Fill missing abstracts for the strongest candidates, then score again.
    const first = score(all);
    const candidates = all
      .map((p, i) => ({ p, s: first[i] }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 90)
      .map((x) => x.p);
    await fillFromS2(candidates);
    const scores = score(candidates);
    const max = Math.max(...scores, 1e-9);
    const papers = candidates;
    const ranked: Paper[] = papers
      .map((p, i) => {
        const lexical = scores[i] / max;
        const score = Math.round(lexical * 100);
        return {
          ...p,
          lexical,
          relevance: {
            score,
            level: score >= 70 ? "high" : score >= 40 ? "medium" : "low",
            why: "Ranked by keyword overlap with your idea (AI ranking not applied).",
            aspects: [],
            method: "keyword",
          } satisfies Paper["relevance"],
        };
      })
      .sort((a, b) => (b.lexical ?? 0) - (a.lexical ?? 0))
      // Drop papers that share almost no terms with the idea (other fields' noise).
      .filter((p, i) => i < 15 || (p.lexical ?? 0) >= 0.18)
      .slice(0, MAX_RESULTS);
    return { papers: ranked, sources, total: all.length };
  });
}
