import { z } from "zod";
import { aiJSON } from "@/lib/server/groq";
import { route } from "@/lib/server/http";
import { containsLoose } from "@/lib/text";
import type { Gaps } from "@/lib/types";

export const maxDuration = 90;

const Body = z.object({
  idea: z.string().trim().min(10).max(6000),
  papers: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().max(1000),
        year: z.number().optional(),
        basis: z.enum(["fulltext", "abstract"]),
        /** Abstract, or the limitation/conclusion passages of a full text. */
        text: z.string().max(8000),
      }),
    )
    .min(2)
    .max(12),
});

const Out = z.object({
  stated: z.array(z.object({ n: z.number().int(), limitation: z.string(), quote: z.string() })).max(16),
  suggested: z
    .array(z.object({ question: z.string(), rationale: z.string(), buildsOn: z.array(z.number().int()).max(5) }))
    .max(6),
});

export async function POST(req: Request) {
  return route(
    req,
    Body,
    async ({ idea, papers }) => {
      const corpus = papers
        .map((p, i) => `[${i + 1}] ${p.title}${p.year ? ` (${p.year})` : ""}\n${p.text.slice(0, 2400)}`)
        .join("\n\n");
      const out = await aiJSON({
        tier: "smart",
        name: "research_gaps",
        schema: Out,
        maxTokens: 2200,
        effort: "medium",
        temperature: 0.3,
        system:
          "You help a researcher find gaps in the literature. Do two separate things.\n" +
          "1) stated: list limitations or open problems that the AUTHORS THEMSELVES state in the text. For each, copy an exact " +
          "quote (8-40 words) from that paper's text as \"quote\", word for word, and give the paper number as \"n\". " +
          "If a paper states none, skip it. Never invent quotes.\n" +
          "2) suggested: propose 3-6 research questions the user could pursue that connect their idea to what the papers have " +
          "not covered. These are your own suggestions. Give a one-sentence rationale and the paper numbers each builds on.",
        user: `User's research idea:\n${idea.slice(0, 2500)}\n\nPapers:\n${corpus}`,
      });

      // Keep only stated limitations whose quote really appears in the paper text.
      const stated: Gaps["stated"] = out.stated
        .map((s) => ({ s, p: papers[s.n - 1] }))
        .filter(({ s, p }) => p && containsLoose(p.text, s.quote))
        .map(({ s, p }) => ({ paperId: p.id, limitation: s.limitation, quote: s.quote, basis: p.basis }));

      const gaps: Gaps = {
        stated,
        suggested: out.suggested.map((q) => ({
          question: q.question,
          rationale: q.rationale,
          buildsOn: q.buildsOn.map((n) => papers[n - 1]?.id).filter((x): x is string => Boolean(x)),
        })),
        createdAt: Date.now(),
      };
      return { gaps, droppedUnverified: out.stated.length - stated.length };
    },
    { ai: true },
  );
}
