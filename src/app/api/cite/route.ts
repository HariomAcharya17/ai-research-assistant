import { z } from "zod";
import { route } from "@/lib/server/http";
import { decodeEntities } from "@/lib/text";
import { CITATION_STYLES } from "@/lib/types";

export const maxDuration = 60;

// Citations come from the DOI registration agencies (Crossref, DataCite) through
// doi.org content negotiation, so the details are the publisher-registered ones.
// Items without a DOI are formatted locally and marked as unverified.

const STYLE_IDS = CITATION_STYLES.map((s) => s.id) as [string, ...string[]];

const Body = z.object({
  style: z.enum([...STYLE_IDS, "bibtex"]),
  items: z
    .array(
      z.object({
        id: z.string().max(300),
        doi: z.string().max(300).optional(),
        title: z.string().max(1000),
        authors: z.array(z.string().max(200)).max(100).default([]),
        year: z.number().optional(),
        venue: z.string().max(500).optional(),
        url: z.string().max(2000).optional(),
      }),
    )
    .min(1)
    .max(100),
});

const cache = new Map<string, string>();

async function fromDoi(doi: string, style: string): Promise<string | null> {
  const key = `${style}|${doi.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const accept = style === "bibtex" ? "application/x-bibtex" : `text/x-bibliography; style=${style}; locale=en-US`;
  try {
    const res = await fetch(`https://doi.org/${encodeURI(doi)}`, {
      headers: { Accept: accept, "User-Agent": "ai-research-assistant/0.1" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    if (!text || /^<!doctype|<html/i.test(text)) return null;
    if (cache.size > 2000) cache.clear();
    cache.set(key, text);
    return text;
  } catch {
    return null;
  }
}

function fallback(it: z.infer<typeof Body>["items"][number], style: string): string {
  const year = it.year ?? "n.d.";
  const a = it.authors;
  const venue = it.venue ? ` ${it.venue}.` : "";
  const link = it.url ? ` ${it.url}` : "";
  if (style === "bibtex") {
    const key = `${(a[0] ?? "anon").split(" ").pop()}${it.year ?? ""}`.replace(/[^A-Za-z0-9]/g, "");
    return `@misc{${key},\n  title = {${it.title}},\n  author = {${a.join(" and ")}},\n  year = {${it.year ?? ""}}${
      it.url ? `,\n  url = {${it.url}}` : ""
    }\n}`;
  }
  if (style === "ieee") {
    const names = a.slice(0, 6).map((n) => {
      const parts = n.split(" ");
      return `${parts.slice(0, -1).map((p) => p[0] + ".").join(" ")} ${parts.at(-1)}`.trim();
    });
    return `${names.join(", ")}${a.length > 6 ? " et al." : ""}, “${it.title},”${venue ? ` ${it.venue},` : ""} ${year}.${link}`;
  }
  const names = a.slice(0, 3).map((n) => {
    const parts = n.split(" ");
    return `${parts.at(-1)}, ${parts.slice(0, -1).map((p) => p[0] + ".").join(" ")}`.trim();
  });
  return `${names.join(", ")}${a.length > 3 ? ", et al." : ""} (${year}). ${it.title}.${venue}${link}`;
}

export async function POST(req: Request) {
  return route(req, Body, async ({ style, items }) => {
    const results: { id: string; text: string; verified: boolean }[] = new Array(items.length);
    let next = 0;
    // Six requests at a time is polite to doi.org and fast enough.
    await Promise.all(
      Array.from({ length: Math.min(6, items.length) }, async () => {
        while (next < items.length) {
          const i = next++;
          const it = items[i];
          const raw = it.doi ? await fromDoi(it.doi, style) : null;
          results[i] = raw
            ? { id: it.id, text: style === "bibtex" ? raw : decodeEntities(raw), verified: true }
            : { id: it.id, text: fallback(it, style), verified: false };
        }
      }),
    );
    return { citations: results };
  });
}
