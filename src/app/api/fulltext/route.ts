import { z } from "zod";
import { fetchPdfPassages } from "@/lib/server/fulltext";
import { route } from "@/lib/server/http";

export const maxDuration = 60;

const Body = z.object({ url: z.url().max(2000) });

export async function POST(req: Request) {
  return route(req, Body, async ({ url }) => fetchPdfPassages(url));
}
