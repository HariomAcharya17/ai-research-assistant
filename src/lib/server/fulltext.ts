import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { toPassages } from "@/lib/passages";
import { decodeEntities } from "@/lib/text";
import type { Passage } from "@/lib/types";
import { cleanDoi, openAlexOA } from "./sources";

const MAX_BYTES = 20 * 1024 * 1024;

export interface FullTextResult {
  passages: Passage[];
  pages?: number;
  /** Where the text came from, shown to the user. */
  via: "PubMed Central" | "PDF";
  sourceUrl: string;
}

function isPublicHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname.replace(/^\[|\]$/g, "");
    // Block local and private targets so the route cannot be used to probe internal hosts.
    if (/^(localhost|0\.0\.0\.0|::1?|::ffff:.*)$/i.test(h)) return false;
    if (/^(127|10|0)\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return false;
    if (/^f[cd][0-9a-f]{2}:|^fe80:/i.test(h)) return false;
    if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return false;
    return true;
  } catch {
    return false;
  }
}

/** arXiv abstract pages have a predictable PDF twin. */
function pdfCandidate(url: string): string {
  const m = /arxiv\.org\/abs\/([^?#]+)/.exec(url);
  return m ? `https://arxiv.org/pdf/${m[1]}` : url;
}

export async function fetchPdfPassages(url: string): Promise<FullTextResult> {
  let target = pdfCandidate(url);
  let res: Response | null = null;
  // Follow redirects by hand so every hop is checked against private addresses.
  for (let hop = 0; hop < 6; hop++) {
    if (!isPublicHttpUrl(target)) throw new Error("Unsupported URL");
    res = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ai-research-assistant/0.2)",
        Accept: "application/pdf,*/*;q=0.5",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(25_000),
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      target = new URL(loc, target).toString();
      continue;
    }
    break;
  }
  if (!res) throw new Error("No response");
  if (!res.ok) throw new Error(`The publisher returned ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error("The PDF is too large");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new Error("The PDF is too large");
  // "%PDF" magic bytes: many publishers answer with an HTML page instead.
  if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) {
    const head = new TextDecoder().decode(buf.slice(0, 4000)).toLowerCase();
    if (/not a bot|captcha|challenge|cloudflare|access denied|are you a robot/.test(head))
      throw new Error("The repository blocks automated downloads. Open the PDF link in your browser, save it and upload it");
    throw new Error("The link did not return a PDF (it may need a subscription)");
  }
  const pdf = await getDocumentProxy(buf);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const passages = toPassages(text as string[]);
  if (!passages.length) throw new Error("No readable text in the PDF (it may be scanned images)");
  return { passages, pages: totalPages, via: "PDF", sourceUrl: target };
}

/* ---------------- PubMed Central full text (structured JATS XML via Europe PMC) ---------------- */

const clean = (s: string) =>
  decodeEntities(s.replace(/<xref[^>]*>[\s\S]*?<\/xref>/g, "").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/\(\s*[,;\s]*\)/g, "")
    .trim();

/** Split JATS XML into passages, keeping section titles. Exported for tests. */
export function jatsToPassages(xmlText: string, target = 900): Passage[] {
  const abstract = /<abstract[^>]*>([\s\S]*?)<\/abstract>/.exec(xmlText)?.[1] ?? "";
  let body = /<body[^>]*>([\s\S]*?)<\/body>/.exec(xmlText)?.[1] ?? "";
  body = body
    .replace(/<fig[\s>][\s\S]*?<\/fig>/g, "")
    .replace(/<table-wrap[\s>][\s\S]*?<\/table-wrap>/g, "")
    .replace(/<disp-formula[\s>][\s\S]*?<\/disp-formula>/g, " ");

  const out: Passage[] = [];
  let section = "Abstract";
  let buf = "";
  const flush = () => {
    const t = buf.trim();
    if (t.length > 60) out.push({ id: `p${out.length + 1}`, section, text: t });
    buf = "";
  };
  const add = (para: string) => {
    const t = clean(para);
    if (!t) return;
    buf += (buf ? " " : "") + t;
    if (buf.length >= target) flush();
  };

  for (const m of abstract.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) add(m[1]);
  if (!/<p[\s>]/.test(abstract) && abstract) add(abstract);
  flush();

  for (const m of body.matchAll(/<title>([\s\S]*?)<\/title>|<p[^>]*>([\s\S]*?)<\/p>/g)) {
    if (m[1] !== undefined) {
      const title = clean(m[1]);
      if (!title) continue;
      flush();
      section = title.replace(/^\d+(\.\d+)*\.?\s*/, "").slice(0, 80) || section;
      if (/^(references|acknowledge?ments?)$/i.test(section)) break;
    } else if (m[2] !== undefined) add(m[2]);
  }
  flush();
  return out.slice(0, 400);
}

async function fetchPmc(pmcid: string): Promise<FullTextResult> {
  const id = pmcid.toUpperCase().startsWith("PMC") ? pmcid.toUpperCase() : `PMC${pmcid}`;
  if (!/^PMC\d+$/.test(id)) throw new Error("Bad PMC id");
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/${id}/fullTextXML`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "ai-research-assistant/0.2" } });
  if (!res.ok) throw new Error(`Europe PMC returned ${res.status}`);
  const passages = jatsToPassages(await res.text());
  if (passages.length < 3) throw new Error("PubMed Central has no full text for this article");
  return { passages, via: "PubMed Central", sourceUrl: `https://europepmc.org/article/PMC/${id}` };
}

/* ---------------- Unpaywall (optional, needs a contact email) ---------------- */

async function unpaywallPdf(doi: string): Promise<string | undefined> {
  const email = process.env.CONTACT_EMAIL;
  if (!email) return undefined;
  try {
    const res = await fetch(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    const j = (await res.json()) as {
      best_oa_location?: { url_for_pdf?: string | null } | null;
      oa_locations?: { url_for_pdf?: string | null }[];
    };
    return j.best_oa_location?.url_for_pdf ?? j.oa_locations?.find((l) => l.url_for_pdf)?.url_for_pdf ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Find and read the full text of a paper. Tries, in order: PubMed Central XML,
 * the known open-access PDF, arXiv, then OpenAlex and Unpaywall lookups by DOI.
 */
export async function getFullText(input: { pdfUrl?: string; pmcid?: string; doi?: string; arxivId?: string }): Promise<FullTextResult> {
  const errors: string[] = [];
  const tried = new Set<string>();
  const tryPdf = async (url?: string) => {
    if (!url || tried.has(url)) return null;
    tried.add(url);
    try {
      return await fetchPdfPassages(url);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return null;
    }
  };
  const tryPmc = async (id?: string) => {
    if (!id || tried.has(id)) return null;
    tried.add(id);
    try {
      return await fetchPmc(id);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  // PMC PDF links are bot-protected, but the same article is available as XML.
  const pmcFromUrl = input.pdfUrl ? /\/(PMC\d+)\b/i.exec(input.pdfUrl)?.[1] : undefined;
  const first = (await tryPmc(input.pmcid ?? pmcFromUrl)) ?? (await tryPdf(input.pdfUrl));
  if (first) return first;
  if (input.arxivId) {
    const r = await tryPdf(`https://arxiv.org/pdf/${input.arxivId}`);
    if (r) return r;
  }
  const doi = cleanDoi(input.doi);
  if (doi) {
    const arxiv = /^10\.48550\/arxiv\.(.+)$/i.exec(doi)?.[1];
    if (arxiv) {
      const r = await tryPdf(`https://arxiv.org/pdf/${arxiv}`);
      if (r) return r;
    }
    try {
      const oa = await openAlexOA(doi);
      const r =
        (await tryPmc(oa.pmcid)) ??
        (oa.arxivId ? await tryPdf(`https://arxiv.org/pdf/${oa.arxivId}`) : null) ??
        (await tryPdf(oa.pdfUrl));
      if (r) return r;
    } catch {
      /* not in OpenAlex */
    }
    const r = await tryPdf(await unpaywallPdf(doi));
    if (r) return r;
  }
  const last = errors.at(-1);
  if (last && /upload it/.test(last)) throw new Error(`${last}.`);
  throw new Error(
    last
      ? `Could not read an open-access copy (${last}). Upload the PDF if you have access.`
      : "No open-access copy was found. Upload the PDF if you have access through your library.",
  );
}
