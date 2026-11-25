"use client";

import { toPassages } from "@/lib/passages";
import type { Passage } from "@/lib/types";

// Files are read in the browser, so drafts and PDFs are never uploaded to a server.

export const ACCEPT = ".pdf,.docx,.txt,.md,.tex";
const MAX = 30 * 1024 * 1024;

async function pdfPages(file: File): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  const { text } = await extractText(pdf, { mergePages: false });
  return text as string[];
}

export async function readDocument(file: File): Promise<string> {
  if (file.size > MAX) throw new Error("The file is larger than 30 MB.");
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return (await pdfPages(file)).join("\n\n");
  if (name.endsWith(".docx")) {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value;
  }
  if (/\.(txt|md|tex)$/.test(name)) return file.text();
  throw new Error("Use a PDF, DOCX, TXT, MD or TEX file.");
}

export async function readPaperPdf(file: File): Promise<{ passages: Passage[]; pages: number }> {
  if (!file.name.toLowerCase().endsWith(".pdf")) throw new Error("Upload the paper as a PDF.");
  if (file.size > MAX) throw new Error("The file is larger than 30 MB.");
  const pages = await pdfPages(file);
  const passages = toPassages(pages);
  if (!passages.length) throw new Error("No readable text found. The PDF may be scanned images.");
  return { passages, pages: pages.length };
}
