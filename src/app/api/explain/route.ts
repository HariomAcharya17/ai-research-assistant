import { z } from "zod";
import { aiJSON, AIError } from "@/lib/server/groq";
import { PaperInput, route } from "@/lib/server/http";
import { selectPassages } from "@/lib/passages";
import type { Claim, Summary } from "@/lib/types";

export const maxDuration = 90;

const Body = z.object({
  paper: PaperInput,
  passages: z
    .array(z.object({ id: z.string().max(20), section: z.string().max(120), page: z.number().optional(), text: z.string().max(4000) }))
    .max(500)
    .optional(),
});

const ClaimOut = z.object({ text: z.string(), refs: z.array(z.string()).max(6) });
const Out = z.object({
  researchQuestion: ClaimOut,
  methods: z.array(ClaimOut).max(6),
  findings: z.array(ClaimOut).max(6),
  limitations: z.array(ClaimOut).max(6),
});

export async function POST(req: Request) {
  return route(
    req,
    Body,
    async ({ paper, passages }) => {
      const basis: Summary["basis"] = passages?.length ? "fulltext" : "abstract";
      const source =
        basis === "fulltext"
          ? selectPassages(passages!)
          : paper.abstract
            ? [{ id: "abs", section: "Abstract", text: paper.abstract }]
            : [];
      if (!source.length) throw new AIError("This paper has no abstract or full text to read. Upload its PDF.", 422);

      const ids = new Set(source.map((p) => p.id));
      const text = source.map((p) => `[${p.id}] (${p.section}) ${p.text}`).join("\n\n");

      const out = await aiJSON({
        tier: "smart",
        name: "paper_summary",
        schema: Out,
        maxTokens: 1800,
        effort: "medium",
        system:
          "You explain academic papers accurately to a researcher. Use ONLY the passages given. " +
          "Every claim must cite the passage ids it comes from in \"refs\" (e.g. [\"p4\"]). Never cite an id that is not listed. " +
          "researchQuestion: the problem or question the paper addresses. methods: how they did it (data, model, design). " +
          "findings: main results, with numbers when the text gives them. limitations: ONLY limitations the authors state themselves; " +
          "return an empty list if the passages state none. Do not add your own opinions. Keep each claim under 45 words.",
        user: `Paper: ${paper.title}${paper.year ? ` (${paper.year})` : ""}\n\nPassages:\n${text}`,
      });

      const clean = (c: Claim): Claim => ({ text: c.text, refs: c.refs.filter((r) => ids.has(r)) });
      const summary: Summary = {
        basis,
        researchQuestion: clean(out.researchQuestion),
        methods: out.methods.map(clean),
        findings: out.findings.map(clean),
        // A stated limitation with no valid source passage cannot be checked, so it is dropped.
        limitations: out.limitations.map(clean).filter((c) => c.refs.length > 0),
        createdAt: Date.now(),
      };
      return { summary, usedPassages: source.map((p) => p.id) };
    },
    { ai: true },
  );
}
