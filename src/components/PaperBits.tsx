"use client";

import { BadgeCheck, ExternalLink, FileText, GraduationCap, Unlock } from "lucide-react";
import { scholarUrl } from "@/lib/cite";
import { SOURCE_NAMES, type Paper } from "@/lib/types";
import { Badge, cn } from "./ui";

export function RelevanceMeter({ paper, compact }: { paper: Paper; compact?: boolean }) {
  const r = paper.relevance;
  if (!r) return null;
  const color = r.level === "high" ? "bg-good" : r.level === "medium" ? "bg-warn" : "bg-border-strong";
  const label = r.level === "high" ? "High" : r.level === "medium" ? "Medium" : "Low";
  return (
    <div
      className={cn("flex items-center gap-2", compact ? "" : "min-w-[120px]")}
      title={
        r.method === "ai"
          ? `AI rubric score ${r.score}/100. 90+: same problem and method · 70+: same problem or same method on a close problem · 40+: shared sub-problem, technique or data · below 40: background.`
          : `Keyword score ${r.score}/100: BM25 overlap with your idea, scaled so the best match is 100.`
      }
    >
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.max(4, r.score)}%` }} />
      </div>
      <span className="text-[12px] tabular-nums text-muted">
        <span className="font-semibold text-text">{r.score}</span> · {label}
        {r.method === "keyword" && " (keywords)"}
      </span>
    </div>
  );
}

export function SourceBadges({ paper }: { paper: Paper }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone="accent" title={paper.publisher ? `Publisher: ${paper.publisher}` : undefined}>
        {paper.label}
      </Badge>
      {paper.isOpenAccess && (
        <Badge tone="good">
          <Unlock className="size-3" /> Open access
        </Badge>
      )}
      {paper.indexing.scopus === true && (
        <Badge tone="good" title="Journal found in Scopus via the Elsevier Serial Title API">
          <BadgeCheck className="size-3" /> Scopus
        </Badge>
      )}
      {paper.indexing.scopus === false && (
        <Badge tone="warn" title="This journal's ISSN was not found in Scopus">
          Not in Scopus
        </Badge>
      )}
      {paper.indexing.doaj && (
        <Badge tone="neutral" title="Journal listed in the Directory of Open Access Journals (OpenAlex metadata)">
          <BadgeCheck className="size-3" /> DOAJ
        </Badge>
      )}
      {paper.venueType && /preprint|repository|posted/i.test(paper.venueType + paper.label) && (
        <Badge tone="warn" title="Not peer reviewed">
          Preprint
        </Badge>
      )}
      <span className="text-[11.5px] text-faint" title="Which search services returned this paper">
        via {paper.foundVia.map((s) => SOURCE_NAMES[s]).join(" + ")}
      </span>
    </div>
  );
}

export function PaperLinks({ paper, className }: { paper: Paper; className?: string }) {
  const link = "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] text-muted transition hover:bg-surface-2 hover:text-text";
  return (
    <div className={cn("flex flex-wrap items-center gap-0.5", className)}>
      {paper.doi && (
        <a className={link} href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer" title={paper.doi}>
          DOI <ExternalLink className="size-3" />
        </a>
      )}
      {paper.url && !paper.url.includes("doi.org") && (
        <a className={link} href={paper.url} target="_blank" rel="noreferrer">
          Publisher <ExternalLink className="size-3" />
        </a>
      )}
      {paper.pdfUrl && (
        <a className={link} href={paper.pdfUrl} target="_blank" rel="noreferrer">
          <FileText className="size-3" /> PDF
        </a>
      )}
      <a className={link} href={scholarUrl(paper)} target="_blank" rel="noreferrer" title="Search for this title on Google Scholar">
        <GraduationCap className="size-3.5" /> Scholar
      </a>
    </div>
  );
}
