import { z } from "zod";
import { aiConfigured, aiJSON } from "@/lib/server/groq";
import { route } from "@/lib/server/http";
import { keywords } from "@/lib/text";

export const maxDuration = 60;

const Body = z.object({ idea: z.string().trim().min(10).max(6000) });

const Plan = z.object({
  title: z.string(),
  queries: z.array(z.string()).min(1).max(4),
  keywords: z.array(z.string()).max(12),
});

export async function POST(req: Request) {
  return route(
    req,
    Body,
    async ({ idea }) => {
      const fallback = {
        title: idea.split(/[.\n]/)[0].slice(0, 90),
        queries: [keywords(idea, 6).join(" ")],
        keywords: keywords(idea, 10),
        ai: false,
      };
      if (!aiConfigured()) return fallback;
      try {
        const plan = await aiJSON({
          tier: "fast",
          name: "search_plan",
          schema: Plan,
          maxTokens: 500,
          system:
            "You turn a research idea into academic database searches. Write 3 search queries of 3-7 words each: " +
            "the first states the core problem plus method, the second uses common synonyms or the technical name of the task, " +
            "the third targets the application domain or dataset. Use terms that appear in paper titles and abstracts. " +
            "No boolean operators or quotes. Also give a short title (max 10 words) for the idea and up to 10 key terms.",
          user: `Research idea:\n${idea}`,
        });
        return { ...plan, queries: plan.queries.map((q) => q.replace(/["()]/g, "").trim()).filter(Boolean), ai: true };
      } catch {
        return fallback;
      }
    },
    { ai: true },
  );
}
