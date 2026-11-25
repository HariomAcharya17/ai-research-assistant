import { z } from "zod";
import { route } from "@/lib/server/http";
import { searchAll } from "@/lib/server/sources";
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

const MAX_RESULTS = 40;

export async function POST(req: Request) {
  return route(req, Body, async ({ idea, queries, keywords, filters }) => {
    const { papers, sources } = await searchAll(queries, filters);
    // Keyword relevance (BM25) over title and abstract. The title counts twice.
    const query = `${idea} ${keywords.join(" ")} ${queries.join(" ")}`;
    const scores = bm25(
      query,
      papers.map((p) => `${p.title} ${p.title} ${p.abstract ?? ""}`),
    );
    const max = Math.max(...scores, 1e-9);
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
      .slice(0, MAX_RESULTS);
    return { papers: ranked, sources, total: papers.length };
  });
}
