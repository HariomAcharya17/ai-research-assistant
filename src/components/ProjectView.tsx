"use client";

import {
  AlertTriangle,
  BookMarked,
  Check,
  ChevronDown,
  FileSearch,
  Info,
  Lightbulb,
  ListOrdered,
  PenLine,
  RotateCw,
  ScanText,
  Sparkles,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { runResearch } from "@/lib/client/research";
import type { Project, StepState } from "@/lib/client/store";
import { SOURCE_NAMES, type SourceStatus } from "@/lib/types";
import { DraftTab } from "./DraftTab";
import { GapsTab } from "./GapsTab";
import { PaperDrawer } from "./PaperDrawer";
import { PapersTab } from "./PapersTab";
import { ReferencesTab } from "./ReferencesTab";
import { Badge, Button, Callout, cn, Spinner } from "./ui";
import { WritingTab } from "./WritingTab";

type Tab = "papers" | "gaps" | "refs" | "draft" | "write";

const TAB_HELP: Record<Tab, string> = {
  papers: "Best matches first. Open a paper to read its summary, or press Cite to add it to your references.",
  gaps: "Compare papers to see the limits their authors admit and the questions they leave open.",
  refs: "Your reference list, formatted from each paper's official DOI record. Copy it or export BibTeX.",
  draft: "Check your draft for wording that overlaps the papers here, or estimate how much reads as AI-written.",
  write: "Improve grammar, clarity and structure, or paraphrase a source while keeping its citation.",
};

function StepIcon({ state }: { state: StepState }) {
  if (state === "active") return <Spinner />;
  if (state === "done") return <Check className="size-4 text-good" />;
  if (state === "error") return <X className="size-4 text-bad" />;
  if (state === "skipped") return <AlertTriangle className="size-4 text-warn" />;
  return <span className="block size-2 rounded-full bg-border-strong" />;
}

function Progress({ project }: { project: Project }) {
  const steps = [
    { key: "plan" as const, label: "Understanding your idea", sub: "Turning it into database searches" },
    { key: "search" as const, label: "Searching scholarly sources", sub: "OpenAlex, Crossref, Europe PMC, arXiv, DOAJ and more" },
    { key: "rank" as const, label: "Ranking and explaining matches", sub: "Scoring each paper against your idea" },
  ];
  return (
    <div className="mt-6 rounded-xl border border-border bg-surface p-2">
      {steps.map((s) => {
        const st = project.steps[s.key];
        return (
          <div key={s.key} className={cn("flex items-start gap-3 rounded-lg px-3 py-3", st.state === "active" && "bg-surface-2/70")}>
            <div className="grid size-5 place-items-center pt-0.5">
              <StepIcon state={st.state} />
            </div>
            <div className="min-w-0">
              <div className={cn("text-[14px] font-medium", st.state === "pending" && "text-faint")}>{s.label}</div>
              <div className="text-[12.5px] text-muted">{st.detail ?? s.sub}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProjectView({ project, status }: { project: Project; status: SourceStatus | null }) {
  const [tab, setTab] = useState<Tab>("papers");
  const [openPaper, setOpenPaper] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const running = project.status === "running";
  const paper = project.papers.find((p) => p.id === openPaper) ?? null;

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "papers", label: "Papers", icon: <FileSearch />, count: project.papers.length },
    { id: "gaps", label: "Gaps", icon: <Lightbulb /> },
    { id: "refs", label: "References", icon: <BookMarked />, count: project.refs.length },
    { id: "draft", label: "Draft check", icon: <ScanText /> },
    { id: "write", label: "Writing", icon: <PenLine /> },
  ];

  const failedSources = project.sources.filter((s) => !s.ok);
  const okSources = project.sources.filter((s) => s.ok && s.count > 0).sort((a, b) => b.count - a.count);
  const aiRanked = project.papers.some((p) => p.relevance?.method === "ai");
  // Without AI the title is just the start of the idea, so showing both repeats the same words.
  const titleIsIdea = !project.title || project.idea.startsWith(project.title.replace(/…$/, "").trim());

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-10">
      <header>
        {project.fromDraft && project.draft && (
          <div className="mb-1.5 text-[12px] text-muted">
            From your draft · <span className="font-medium">{project.draft.name}</span>
          </div>
        )}
        <div className="flex items-start justify-between gap-4">
          <h1 className="min-w-0 font-serif text-[26px] leading-tight tracking-tight sm:text-[32px]">
            {project.title || (running ? "Reading your idea…" : "Untitled research")}
          </h1>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => runResearch(project.id)}
            disabled={running}
            icon={<RotateCw className={cn("size-3.5", running && "animate-spin")} />}
            title="Run the search again"
          >
            <span className="hidden sm:inline">Search again</span>
          </Button>
        </div>
        {!titleIsIdea && <p className="mt-2 line-clamp-2 text-[14.5px] leading-relaxed text-muted">{project.idea}</p>}

        {(project.papers.length > 0 || project.queries.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
            {project.papers.length > 0 && (
              <span>
                <span className="font-semibold text-text">{project.papers.length}</span> papers
              </span>
            )}
            {okSources.length > 0 && (
              <span>
                from <span className="font-semibold text-text">{okSources.length}</span> databases
              </span>
            )}
            {project.papers.length > 0 && !running && (
              <Badge tone={aiRanked ? "ai" : "neutral"}>
                {aiRanked ? <Sparkles className="size-3" /> : <ListOrdered className="size-3" />}
                {aiRanked ? "Ranked by AI" : "Ranked by keyword match"}
              </Badge>
            )}
            <button
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-accent-soft"
            >
              Search details
              <ChevronDown className={cn("size-3.5 transition", detailsOpen && "rotate-180")} />
            </button>
          </div>
        )}

        <AnimatePresence initial={false}>
          {detailsOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <dl className="mt-3 space-y-3 rounded-xl border border-border bg-surface p-4 text-[13px]">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-faint">Your idea</dt>
                  <dd className="mt-1 leading-relaxed text-muted">{project.idea}</dd>
                </div>
                {project.queries.length > 0 && (
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-faint">Searched for</dt>
                    <dd className="mt-1.5 flex flex-wrap gap-1.5">
                      {project.queries.map((q) => (
                        <span key={q} className="rounded-md bg-surface-2 px-2 py-0.5 text-[12.5px] text-muted">
                          {q}
                        </span>
                      ))}
                    </dd>
                  </div>
                )}
                {okSources.length > 0 && (
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-faint">Results per database</dt>
                    <dd className="mt-1.5 flex flex-wrap gap-1.5">
                      {okSources.map((s) => (
                        <span key={s.id} className="rounded-md border border-border px-2 py-0.5 text-[12.5px] text-muted">
                          {SOURCE_NAMES[s.id]} <span className="tabular-nums text-text">{s.count}</span>
                        </span>
                      ))}
                    </dd>
                    <p className="mt-1.5 text-[12px] text-faint">
                      {project.total} records in total, merged so each paper appears once.
                    </p>
                  </div>
                )}
                {failedSources.length > 0 && (
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-faint">Didn&apos;t respond this time</dt>
                    <dd className="mt-1 text-muted">
                      {failedSources.map((s) => `${SOURCE_NAMES[s.id]} (${s.error ?? "no response"})`).join(", ")}. The other
                      databases covered the search.
                    </dd>
                  </div>
                )}
              </dl>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {(running || project.status === "error") && <Progress project={project} />}
      {project.status === "error" && project.error && (
        <Callout tone="bad" icon={<AlertTriangle />} className="mt-4">
          {project.error}
        </Callout>
      )}

      {running && project.papers.length === 0 && (
        <div className="mt-6 space-y-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-5">
              <div className="skeleton h-5 w-3/4" />
              <div className="skeleton mt-2 h-3.5 w-1/2" />
              <div className="skeleton mt-4 h-3 w-full" />
              <div className="skeleton mt-1.5 h-3 w-11/12" />
            </div>
          ))}
        </div>
      )}

      {project.papers.length > 0 && (
        <>
          {/* When AI is simply off, the "Ranked by keyword match" badge says enough. */}
          {!running && project.steps.rank.state === "skipped" && status?.ai !== false && (
            <Callout tone="warn" icon={<Info />} className="mt-4">
              AI ranking didn&apos;t finish ({project.steps.rank.detail?.replace(/\.$/, "")}), so papers are ordered by keyword
              match.{" "}
              <button className="font-medium underline" onClick={() => runResearch(project.id)}>
                Try again
              </button>
            </Callout>
          )}

          <div className="sticky top-[57px] z-20 -mx-4 mt-6 border-b border-border bg-bg/90 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:top-0">
            <nav className="scroll-thin -mb-px flex gap-1 overflow-x-auto" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "relative flex items-center gap-2 whitespace-nowrap px-3 py-3 text-[13.5px] font-medium transition [&>svg]:size-4",
                    tab === t.id ? "text-text" : "text-muted hover:text-text",
                  )}
                >
                  {t.icon}
                  {t.label}
                  {t.count ? (
                    <span className="rounded-full bg-surface-2 px-1.5 text-[11px] tabular-nums text-muted">{t.count}</span>
                  ) : null}
                  {tab === t.id && (
                    <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
                  )}
                </button>
              ))}
            </nav>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="pt-4"
            >
              <p className="mb-4 text-[13px] leading-relaxed text-muted">{TAB_HELP[tab]}</p>
              {tab === "papers" && <PapersTab project={project} running={running} onOpen={setOpenPaper} ai={status?.ai ?? true} />}
              {tab === "gaps" && <GapsTab project={project} ai={status?.ai ?? true} onOpen={setOpenPaper} onTab={setTab} />}
              {tab === "refs" && <ReferencesTab project={project} onBrowse={() => setTab("papers")} />}
              {tab === "draft" && <DraftTab project={project} onOpen={setOpenPaper} />}
              {tab === "write" && <WritingTab project={project} ai={status?.ai ?? true} onTab={setTab} />}
            </motion.div>
          </AnimatePresence>
        </>
      )}

      <PaperDrawer project={project} paper={paper} onClose={() => setOpenPaper(null)} ai={status?.ai ?? true} />
    </div>
  );
}
