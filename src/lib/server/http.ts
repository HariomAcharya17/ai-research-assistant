import "server-only";
import { z } from "zod";
import { AIError } from "./groq";

// Small helpers shared by the API routes: body validation, error mapping and a
// per-IP rate limit that keeps a public deployment inside the free AI quota.

const buckets = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = Number(process.env.AI_REQUESTS_PER_10_MIN ?? 60);

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

export function rateLimited(req: Request): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.reset < now) {
    buckets.set(ip, { count: 1, reset: now + WINDOW_MS });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return false;
  }
  b.count++;
  return b.count > LIMIT;
}

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function route<T extends z.ZodType>(
  req: Request,
  schema: T,
  handler: (body: z.infer<T>) => Promise<unknown>,
  opts: { ai?: boolean } = {},
): Promise<Response> {
  if (opts.ai && rateLimited(req)) return jsonError("Too many requests. Please wait a few minutes.", 429);
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return jsonError(`Invalid request: ${parsed.error.issues[0]?.message}`, 400);
  try {
    return Response.json(await handler(parsed.data));
  } catch (e) {
    if (e instanceof AIError) return jsonError(e.message, e.status);
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "Something went wrong", 500);
  }
}

/** The subset of Paper fields the routes accept from the client. */
export const PaperInput = z.object({
  id: z.string().max(300),
  title: z.string().max(1000),
  authors: z.array(z.string().max(200)).max(100).default([]),
  year: z.number().int().optional(),
  abstract: z.string().max(12_000).optional(),
  doi: z.string().max(300).optional(),
  venue: z.string().max(500).optional(),
});
