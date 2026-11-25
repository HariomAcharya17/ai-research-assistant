import { z } from "zod";
import { getFullText } from "@/lib/server/fulltext";
import { route } from "@/lib/server/http";

export const maxDuration = 90;

const Body = z
  .object({
    pdfUrl: z.url().max(2000).optional(),
    pmcid: z.string().max(20).optional(),
    doi: z.string().max(300).optional(),
    arxivId: z.string().max(40).optional(),
  })
  .refine((b) => b.pdfUrl || b.pmcid || b.doi || b.arxivId, "Give a PDF link, PMC id, DOI or arXiv id");

export async function POST(req: Request) {
  return route(req, Body, async (body) => getFullText(body));
}
