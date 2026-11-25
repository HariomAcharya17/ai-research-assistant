import { z } from "zod";
import { AIError, aiJSON } from "@/lib/server/groq";
import { route } from "@/lib/server/http";

export const maxDuration = 90;

const Body = z.object({
  mode: z.enum(["grammar", "clarity", "structure", "paraphrase"]),
  text: z.string().trim().min(20).max(8000),
  source: z
    .object({
      title: z.string().max(1000),
      inText: z.string().max(200),
      excerpt: z.string().max(4000).optional(),
    })
    .optional(),
});

const Out = z.object({
  revised: z.string(),
  changes: z.array(z.string()).max(10),
  note: z.string().optional(),
});

const INTEGRITY =
  "Academic integrity rules: keep the author's meaning and claims; never invent facts, data or references; " +
  "never remove or alter citations already in the text. Your purpose is to improve the writing, not to hide where " +
  "ideas or words came from or to get around plagiarism detection. If the text appears to be copied from a source " +
  "without citation, say so in \"note\".";

const TASKS: Record<z.infer<typeof Body>["mode"], string> = {
  grammar:
    "Fix grammar, spelling, punctuation and agreement only. Change as little as possible and keep the author's wording and voice.",
  clarity:
    "Improve clarity and concision for an academic reader: shorter sentences, precise terms, active voice where it helps, " +
    "no filler. Keep technical terms and every claim.",
  structure:
    "Improve the structure and flow: logical paragraph order, clear topic sentences and transitions. You may reorder and " +
    "merge sentences but must keep all content.",
  paraphrase:
    "Paraphrase the passage from the named source in your own sentence structure and wording, keeping its meaning exactly, " +
    "and attribute it with the given in-text citation. Keep technical terms. If a phrase cannot be reworded without losing " +
    "meaning, keep it in quotation marks with the citation.",
};

export async function POST(req: Request) {
  return route(
    req,
    Body,
    async ({ mode, text, source }) => {
      if (mode === "paraphrase" && !source)
        throw new AIError("Pick the source paper for a cited paraphrase.", 400);
      const out = await aiJSON({
        tier: "smart",
        name: "revision",
        schema: Out,
        maxTokens: 2600,
        effort: "low",
        temperature: 0.3,
        system: `You are an academic writing tutor. ${TASKS[mode]}\n${INTEGRITY}\n"changes": up to 8 short notes on what you changed and why.`,
        user:
          (source
            ? `Source: ${source.title}\nIn-text citation to use: ${source.inText}\n${
                source.excerpt ? `Source excerpt for checking meaning:\n${source.excerpt.slice(0, 2500)}\n` : ""
              }\n`
            : "") + `Text:\n${text}`,
      });
      return out;
    },
    { ai: true },
  );
}
