"use client";

import { BookmarkCheck, BookmarkPlus, Info, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { authorLine } from "@/lib/cite";
import { toggleRef } from "@/lib/client/research";
import type { Project } from "@/lib/client/store";
import type { Paper } from "@/lib/types";
import { PaperLinks, RelevanceMeter, SourceBadges } from "./PaperBits";
import { Badge, Button, cn, Empty } from "./ui";

type Sort = "relevance" | "newest" | "cited";

function PaperCard({
  paper,
  rank,
  project,
  onOpen,
}: {
  paper: Paper;
  rank: number;
  project: Project;
  onOpen: (id: string) => void;
}) {
  const inRefs = project.refs.includes(paper.id);
  const summarized = Boolean(project.summaries[paper.id]);
  return (
    <article className="group relative rounded-xl border border-border bg-surface p-4 transition hover:border-border-strong hover:shadow-card sm:p-5">
      <div className="flex gap-3 sm:gap-4">
        <div className="hidden w-7 shrink-0 pt-0.5 text-right font-serif text-[20px] leading-none text-faint tabular-nums sm:block">
          {rank}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <button onClick={() => onOpen(paper.id)} className="text-left">
              <h3 className="font-serif text-[18.5px] leading-snug tracking-tight decoration-accent/40 underline-offset-4 group-hover:underline">
                {paper.title}
              </h3>
            </button>
            <RelevanceMeter paper={paper} />
          </div>
          <p className="mt-1 text-[13px] text-muted">
            {authorLine(paper.authors)}
            {paper.year && <> · {paper.year}</>}
            {paper.venue && (
              <>
                {" "}
                · <span className="italic">{paper.venue}</span>
              </>
            )}
            {paper.citedBy ? <> · {paper.citedBy.toLocaleString()} citations</> : null}
          </p>
          <div className="mt-2.5">
            <SourceBadges paper={paper} />
          </div>

          {paper.relevance && paper.relevance.method === "ai" && (
            <div className="mt-3 rounded-lg bg-surface-2/70 px-3 py-2.5">
              <p className="text-[13.5px] leading-relaxed">
                <span className="font-medium">Why it matches: </span>
                {paper.relevance.why}
              </p>
              {paper.relevance.aspects.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {paper.relevance.aspects.map((a) => (
                    <span key={a} className="rounded border border-border bg-surface px-1.5 py-px text-[11.5px] text-muted">
                      {a}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {paper.abstract ? (
            <p className="mt-3 line-clamp-3 text-[13.5px] leading-relaxed text-muted">{paper.abstract}</p>
          ) : (
            <p className="mt-3 text-[13px] italic text-faint">No abstract available from the sources.</p>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <PaperLinks paper={paper} className="-ml-1.5" />
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => toggleRef(project.id, paper.id)} icon={inRefs ? <BookmarkCheck className="size-4 text-accent" /> : <BookmarkPlus className="size-4" />}>
                {inRefs ? "In references" : "Cite"}
              </Button>
              <Button size="sm" variant={summarized ? "secondary" : "primary"} onClick={() => onOpen(paper.id)} icon={<Sparkles className="size-3.5" />}>
                {summarized ? "View summary" : "Explain"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function PapersTab({ project, running, onOpen }: { project: Project; running: boolean; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<Sort>("relevance");
  const [label, setLabel] = useState<string>("all");
  const [oaOnly, setOaOnly] = useState(false);
  const [q, setQ] = useState("");

  const labels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of project.papers) counts.set(p.label, (counts.get(p.label) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [project.papers]);

  const rankOf = useMemo(() => new Map(project.papers.map((p, i) => [p.id, i + 1])), [project.papers]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = project.papers.filter(
      (p) =>
        (label === "all" || p.label === label) &&
        (!oaOnly || p.isOpenAccess) &&
        (!needle || `${p.title} ${p.authors.join(" ")} ${p.venue ?? ""}`.toLowerCase().includes(needle)),
    );
    if (sort === "newest") list = [...list].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    if (sort === "cited") list = [...list].sort((a, b) => (b.citedBy ?? 0) - (a.citedBy ?? 0));
    return list;
  }, [project.papers, label, oaOnly, q, sort]);

  const aiRanked = project.papers.some((p) => p.relevance?.method === "ai");

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by title, author or venue"
              className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[13.5px] outline-none placeholder:text-faint focus:border-accent"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-9 rounded-lg border border-border bg-surface px-2.5 text-[13.5px]"
            aria-label="Sort papers"
          >
            <option value="relevance">Most relevant</option>
            <option value="newest">Newest</option>
            <option value="cited">Most cited</option>
          </select>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] text-muted">
            <input type="checkbox" checked={oaOnly} onChange={(e) => setOaOnly(e.target.checked)} className="accent-[var(--accent)]" />
            Open access
          </label>
        </div>
        <div className="scroll-thin flex gap-1.5 overflow-x-auto pb-1">
          {[["all", project.papers.length] as [string, number], ...labels].map(([l, n]) => (
            <button
              key={l}
              onClick={() => setLabel(l)}
              className={cn(
                "whitespace-nowrap rounded-full border px-2.5 py-1 text-[12.5px] transition",
                label === l ? "border-accent bg-accent-soft text-accent-text" : "border-border bg-surface text-muted hover:text-text",
              )}
            >
              {l === "all" ? "All sources" : l} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex items-start gap-2 text-[12.5px] text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {aiRanked ? (
          <span>
            Ordered by a relevance score: an AI rates each paper&apos;s title and abstract against your idea on a fixed
            0–100 rubric (hover a score for the scale). It is a ranking aid, not a measured similarity percentage.
          </span>
        ) : (
          <span>Ordered by keyword overlap (BM25) between your idea and each title and abstract.</span>
        )}
      </div>

      <div className="space-y-3">
        {shown.map((p) => (
          <PaperCard key={p.id} paper={p} rank={rankOf.get(p.id) ?? 0} project={project} onOpen={onOpen} />
        ))}
        {running && project.steps.rank.state === "active" && (
          <div className="flex items-center gap-2 px-1 text-[13px] text-muted">
            <Badge tone="ai">
              <Sparkles className="size-3" /> Ranking
            </Badge>
            Scoring papers against your idea. The list will reorder when done.
          </div>
        )}
        {!running && shown.length === 0 && (
          <Empty icon={<Search className="size-5" />} title="No papers match these filters" />
        )}
      </div>
    </div>
  );
}
