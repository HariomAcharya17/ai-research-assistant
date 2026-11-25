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
        // Without AI: title from the opening lines, idea from the abstract when one is marked.
        const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 3);
        let title = lines.find((l) => l.length > 15) ?? "Uploaded draft";
        const next = lines[lines.indexOf(title) + 1];
        if (next && title.length < 80 && !/[.:;]$/.test(title) && /^[A-Z]/.test(next) && next.length < 80 && !/@|university|department/i.test(next))
          title = `${title} ${next}`;
        if (title.length > 120) title = title.slice(0, 120).replace(/\s+\S*$/, "") + "…";
        const abs = /\babstract\b[\s.:—-]*/i.exec(head);
        const idea = (abs ? head.slice(abs.index + abs[0].length) : head).slice(0, 1500);
        return { title, idea: `${title}. ${idea}`, keywords: keywords(idea, 10), ai: false };
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
