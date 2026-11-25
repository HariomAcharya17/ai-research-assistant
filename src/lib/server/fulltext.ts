import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { toPassages } from "@/lib/passages";
import type { Passage } from "@/lib/types";

const MAX_BYTES = 20 * 1024 * 1024;

function isPublicHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname;
    // Block local and private targets so the route cannot be used to probe internal hosts.
    if (/^(localhost|0\.0\.0\.0|\[?::1\]?)$/i.test(h)) return false;
    if (/^(127|10)\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (h.endsWith(".local") || h.endsWith(".internal")) return false;
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

export async function fetchPdfPassages(url: string): Promise<{ passages: Passage[]; pages: number }> {
  let target = pdfCandidate(url);
  let res: Response | null = null;
  // Follow redirects by hand so every hop is checked against private addresses.
  for (let hop = 0; hop < 6; hop++) {
    if (!isPublicHttpUrl(target)) throw new Error("Unsupported URL");
    res = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ai-research-assistant/0.1)",
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
  // "%PDF" magic bytes: many publishers answer with an HTML paywall page instead.
  if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46))
    throw new Error("The link did not return a PDF (it may need a subscription or a browser)");
  const pdf = await getDocumentProxy(buf);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const passages = toPassages(text as string[]);
  if (!passages.length) throw new Error("No readable text in the PDF (it may be scanned images)");
  return { passages, pages: totalPages };
}
