import type { CitationStyle, Paper } from "./types";

function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.at(-1) ?? full;
}

/** In-text citation for the chosen style. `n` is the reference number for numeric styles. */
export function inTextCitation(paper: Paper, style: CitationStyle, n: number): string {
  if (style === "ieee" || style === "vancouver") return `[${n}]`;
  const a = paper.authors;
  const year = paper.year ?? "n.d.";
  const who =
    a.length === 0 ? paper.title.split(" ").slice(0, 3).join(" ") : a.length === 1 ? lastName(a[0]) : a.length === 2 ? `${lastName(a[0])} & ${lastName(a[1])}` : `${lastName(a[0])} et al.`;
  if (style === "modern-language-association") return `(${who.replace(" & ", " and ")})`;
  return `(${who}, ${year})`;
}

export function scholarUrl(paper: Paper): string {
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(`"${paper.title}"`)}`;
}

export function authorLine(authors: string[], max = 3): string {
  if (!authors.length) return "Unknown authors";
  return authors.length > max ? `${authors.slice(0, max).join(", ")} et al.` : authors.join(", ");
}
