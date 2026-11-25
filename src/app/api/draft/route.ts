import { z } from "zod";
import { aiConfigured, aiJSON } from "@/lib/server/groq";
import { route } from "@/lib/server/http";
import { keywords } from "@/lib/text";

export const maxDuration = 60;

const Body = z.object({ text: z.string().trim().min(200).max(400_000) });

const Out = z.object({
  title: z.string(),
  idea: z.string(),
  keywords: z.array(z.string()).max(12),
});

/** Turn an uploaded draft into a research idea that the search can use. */
export async function POST(req: Request) {
  return route(
    req,
    Body,
    async ({ text }) => {
      // Title, abstract and introduction carry the idea; later sections add little.
      const head = text.slice(0, 9000);
      if (!aiConfigured()) {
        const firstLine = text.split("\n").find((l) => l.trim().length > 15)?.trim() ?? "Uploaded draft";
        return { title: firstLine.slice(0, 120), idea: head.slice(0, 1500), keywords: keywords(head, 10), ai: false };
      }
      const out = await aiJSON({
        tier: "fast",
        name: "draft_idea",
        schema: Out,
        maxTokens: 700,
        system:
          "Read the start of a draft research paper. Return its working title, a 3-5 sentence description of the research " +
          "idea (problem, approach, setting) written as the author would describe it, and up to 10 key technical terms. " +
          "Use only what the draft says.",
        user: head,
      });
      return { ...out, ai: true };
    },
    { ai: true },
  );
}
