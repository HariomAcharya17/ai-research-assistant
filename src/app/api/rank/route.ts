import { z } from "zod";
import { aiJSON } from "@/lib/server/groq";
import { route } from "@/lib/server/http";

export const maxDuration = 120;

const Body = z.object({
  idea: z.string().trim().min(10).max(6000),
  papers: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().max(1000),
        year: z.number().optional(),
        abstract: z.string().max(12_000).optional(),
      }),
    )
    .min(1)
    .max(30),
});

const Ranking = z.object({
  items: z.array(
    z.object({
      n: z.number().int(),
      score: z.number().min(0).max(100),
      why: z.string(),
      aspects: z.array(z.string()).max(4),
    }),
  ),
});

const RUBRIC = `Score how closely each paper matches the user's research idea, 0-100, using this rubric:
90-100: same research problem AND same or very similar method.
70-89: same problem with a different method, or the same method applied to a closely related problem.
40-69: shares an important sub-problem, technique, dataset or domain.
10-39: loosely related background.
0-9: unrelated.
Judge only from the title and abstract given. If there is no abstract, judge from the title and stay below 80.
"why": one plain sentence (max 30 words) naming the specific overlap or difference.
"aspects": up to 3 short labels for what overlaps (e.g. "same dataset", "transformer model", "clinical setting").`;

const BATCH = 12;

export async function POST(req: Request) {
  return route(
    req,
    Body,
    async ({ idea, papers }) => {
      const batches: (typeof papers)[] = [];
      for (let i = 0; i < papers.length; i += BATCH) batches.push(papers.slice(i, i + BATCH));
      const ranks: { id: string; score: number; why: string; aspects: string[] }[] = [];
      // Sequential batches stay under the free tier's tokens-per-minute limit.
      for (const batch of batches) {
        const list = batch
          .map(
            (p, i) =>
              `[${i + 1}] ${p.title}${p.year ? ` (${p.year})` : ""}\n${
                p.abstract ? p.abstract.slice(0, 650) : "(no abstract available)"
              }`,
          )
          .join("\n\n");
        const out = await aiJSON({
          tier: "smart",
          name: "relevance",
          schema: Ranking,
          maxTokens: 1600,
          effort: "low",
          temperature: 0,
          system: `You are a careful research librarian. ${RUBRIC}\nReturn one item per paper, using its number as "n".`,
          user: `Research idea:\n${idea.slice(0, 2500)}\n\nPapers:\n${list}`,
        });
        for (const item of out.items) {
          const p = batch[item.n - 1];
          if (p) ranks.push({ id: p.id, score: Math.round(item.score), why: item.why, aspects: item.aspects });
        }
      }
      return { ranks };
    },
    { ai: true },
  );
}
